/**
 * index.ts — Ana orchestrator
 * Kullanim:
 *   ts-node index.ts --mode=observe   (sadece veri topla)
 *   ts-node index.ts --mode=paper     (veri topla + paper trade)
 *   ts-node index.ts --mode=live      (gercek para, trade)
 *   ts-node index.ts --mode=report    (ozet rapor yazdir)
 */

import { openDb } from './db/schema';
import { fetchActiveMarkets, upsertMarkets, resolveMarkets } from './discovery';
import { takeSnapshot, shouldSnapshot, fetchBook } from './collector';
import { BtcPriceFeed } from './btcFeed';
import { checkScalp, updateScalpTrades, resolveScalpTrades } from './strategies/scalp';
import type { BtcMarket } from './discovery';
import { checkScalpLive, updateScalpLive, resolveScalpLive } from './strategies/scalp_live';
import { initClobClient, isClobReady } from './live/client';
import { autoRedeemWins } from './live/redeem';

const MODE = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'observe';
const DURATION_FILTER = [5, 15]; // 5dk + 15dk BTC marketleri

// Post-close monitoring: market activeMarkets'tan cikinca acik pozisyon varsa
// bu pencere kadar daha izlemeye devam et.
const POST_CLOSE_WINDOW_SEC = 300; // 5 dakika

// Son 30s yoğun izleme: bu Set'te olan market_id'ler için async 2s poll başlatılmış
const intensivePollActive = new Set<string>();

const lastSnapshotElapsed = new Map<string, number | null>();

async function tick(
  db: ReturnType<typeof openDb>,
  btcFeed: BtcPriceFeed,
  activeMarkets: Map<string, BtcMarket>,
): Promise<void> {
  const now      = Math.floor(Date.now() / 1000);
  const btcPrice = btcFeed.current;

  for (const market of activeMarkets.values()) {
    const elapsed   = now - market.openTime;
    const remaining = market.closeTime - now;
    if (remaining < 0) continue;

    const lastElapsed = lastSnapshotElapsed.get(market.id) ?? null;

    // HIZLI STOP KONTROLU — Snapshot dongusu ile bagimsiz, her 10s calisir.
    if ((MODE === 'live' || MODE === 'both') && isClobReady()) {
      const openForMarket = db.prepare(
        `SELECT id, side, token_id, stop_price FROM live_trades WHERE market_id=? AND outcome='OPEN'`
      ).get(market.id) as { id: number; side: string; token_id: string; stop_price: number } | undefined;

      if (openForMarket) {
        try {
          const book = await fetchBook(openForMarket.token_id);
          const swNow = new Date().toISOString().slice(11,19);
          console.log(`[stopwatch] ${swNow} | T${openForMarket.id} ${openForMarket.side} stop=${openForMarket.stop_price}`);
          if (book && book.bids.length > 0 && book.asks.length > 0) {
            const bestBid = Number(book.bids.at(-1)!.price);
            const bestAsk = Number(book.asks.at(-1)!.price);
            const fastMid = (bestBid + bestAsk) / 2;
            if (fastMid <= openForMarket.stop_price) {
              const upMid   = openForMarket.side === 'UP'   ? fastMid : null;
              const downMid = openForMarket.side === 'DOWN' ? fastMid : null;
              console.log(`[stopwatch] mid=${fastMid.toFixed(3)} <= stop=${openForMarket.stop_price} — hizli stop!`);
              await updateScalpLive(db, market, upMid, downMid);
            }
          }
        } catch(e: any) {
          // Stop watch hatalari session'i engellemez
        }

        // SON 30S YOGUN IZLEME — her 2s'de bir poll (10s gozluk penceresi kapatilir)
        // Ornek: fiyat 0.85'e iner, 2s sonra 0.88'e cikabilir.
        // 10s stopwatch bu dipi kacirir; 2s poll yakalar.
        // NOT: T10117 gibi stop HICBIR ZAMAN tetiklenmemis senaryolara yardimi yok.
        if (remaining <= 30 && remaining > 0 && !intensivePollActive.has(market.id)) {
          intensivePollActive.add(market.id);
          const capturedMarket = { ...market };
          const capturedOpen   = { ...openForMarket };

          // Non-blocking: tick() bloklanmaz, arka planda calisir
          (async () => {
            const polls = Math.ceil(remaining / 2) + 5; // close'a kadar + 5 ekstra
            console.log(`[last30s] T${capturedOpen.id} yogun izleme basliyor — ${remaining}s kaldi, ${polls} poll x 2s`);
            for (let i = 0; i < polls; i++) {
              await new Promise(r => setTimeout(r, 2000));
              try {
                // Hala OPEN mi?
                const stillOpen = db.prepare(
                  `SELECT id, side, token_id, stop_price FROM live_trades WHERE market_id=? AND outcome='OPEN' LIMIT 1`
                ).get(capturedMarket.id) as { id: number; side: string; token_id: string; stop_price: number } | undefined;
                if (!stillOpen) break; // Kapatilmis, izlemeyi bitirelim

                const freshBook = await fetchBook(stillOpen.token_id);
                if (freshBook && freshBook.bids.length > 0 && freshBook.asks.length > 0) {
                  const bid = Number(freshBook.bids.at(-1)!.price);
                  const ask = Number(freshBook.asks.at(-1)!.price);
                  const fastMid = (bid + ask) / 2;
                  const nowTs   = Math.floor(Date.now() / 1000);
                  const rem     = capturedMarket.closeTime - nowTs;
                  console.log(`[last30s] T${stillOpen.id} mid=${fastMid.toFixed(3)} stop=${stillOpen.stop_price} rem=${rem}s`);
                  if (fastMid <= stillOpen.stop_price) {
                    const upMid   = stillOpen.side === 'UP'   ? fastMid : null;
                    const downMid = stillOpen.side === 'DOWN' ? fastMid : null;
                    console.log(`[last30s] STOP TETIKLENDI mid=${fastMid.toFixed(3)} — FOK cascade!`);
                    await updateScalpLive(db, capturedMarket as BtcMarket, upMid, downMid);
                    break;
                  }
                }
              } catch { /* devam et */ }
            }
            intensivePollActive.delete(capturedMarket.id);
            console.log(`[last30s] T${capturedOpen.id} yogun izleme bitti`);
          })();
        }
      } else if (
        market.durationMin === 5 &&
        elapsed >= 90 && elapsed <= 250 &&
        remaining >= 50
      ) {
        // HIZLI GIRIS TARAMASI — her 3s book cek, snapshot beklemeden entry kontrol
        // Cozulen problem: checkScalpLive sadece shouldSnapshot icinde calisiyor (~30-60s).
        // 30s bos pencerede fiyat 0.91-0.92 bandina girip cikabiliyor, bot kacirir.
        try {
          if (market.tokenUp && market.tokenDown) {
            const [upBook, downBook] = await Promise.all([
              fetchBook(market.tokenUp),
              fetchBook(market.tokenDown),
            ]);
            const upBid = upBook?.bids?.length  ? Number(upBook.bids.at(-1)!.price)   : null;
            const upAsk = upBook?.asks?.length  ? Number(upBook.asks.at(-1)!.price)   : null;
            const dnBid = downBook?.bids?.length ? Number(downBook.bids.at(-1)!.price) : null;
            const dnAsk = downBook?.asks?.length ? Number(downBook.asks.at(-1)!.price) : null;
            const upMid = (upBid !== null && upAsk !== null) ? (upBid + upAsk) / 2 : null;
            const dnMid = (dnBid !== null && dnAsk !== null) ? (dnBid + dnAsk) / 2 : null;
            if (upAsk !== null || dnAsk !== null) {
              await checkScalpLive(db, market, upMid, dnMid, upAsk, dnAsk, elapsed);
            }
          }
        } catch { /* hizli giris taramasi hatalari session engellenmez */ }
      }
    }

    if (shouldSnapshot(market, lastElapsed)) {
      await takeSnapshot(db, market, btcPrice);
      lastSnapshotElapsed.set(market.id, elapsed);

      const snap = db.prepare(`
        SELECT up_bid, up_ask, up_best_price, down_bid, down_ask, down_best_price
        FROM snapshots WHERE market_id=? ORDER BY ts DESC LIMIT 1
      `).get(market.id) as {
        up_bid: number|null; up_ask: number|null; up_best_price: number|null;
        down_bid: number|null; down_ask: number|null; down_best_price: number|null;
      } | null;

      if (!snap) continue;
      const { up_ask, up_best_price, down_ask, down_best_price } = snap;

      if (MODE === 'paper' || MODE === 'both') {
        checkScalp(db, market, up_best_price, down_best_price, up_ask, down_ask, elapsed);
        updateScalpTrades(db, market, up_best_price, down_best_price, up_ask, down_ask);
      }
      if ((MODE === 'live' || MODE === 'both') && isClobReady()) {
        await checkScalpLive(db, market, up_best_price, down_best_price, up_ask, down_ask, elapsed);
        await updateScalpLive(db, market, up_best_price, down_best_price);
      }

      console.log(
        `[tick] ${market.durationMin}min | ${market.question.slice(0,35).padEnd(35)}` +
        ` | ${remaining}s kaldi | up=${up_best_price?.toFixed(3)} dn=${down_best_price?.toFixed(3)}` +
        ` | BTC=$${btcPrice?.toFixed(0) ?? '?'}`
      );
    }
  }

  // POST-CLOSE MONITORING
  // activeMarkets'tan cikmis ama henuz settle olmamis marketlerdeki
  // acik pozisyonlari POST_CLOSE_WINDOW_SEC boyunca izle.
  // Senaryo: market 08:35'te kapandi, bot 08:36'da activeMarkets'tan cikardi.
  // Ama outcome onaylama 5-10 dk surer → bu pencerede emergency exit dene.
  if ((MODE === 'live' || MODE === 'both') && isClobReady()) {
    type PostCloseRow = {
      id: string; question: string; duration_min: number;
      token_up: string|null; token_down: string|null;
      open_time: number; close_time: number; outcome: string|null;
      lt_side: string; lt_token_id: string;
    };

    const closedWithOpen = db.prepare(`
      SELECT DISTINCT m.id, m.question, m.duration_min, m.token_up, m.token_down,
             m.open_time, m.close_time, m.outcome,
             lt.side as lt_side, lt.token_id as lt_token_id
      FROM markets m
      JOIN live_trades lt ON lt.market_id = m.id
      WHERE lt.outcome = 'OPEN'
        AND m.close_time < ?
        AND m.close_time > ?
    `).all(now, now - POST_CLOSE_WINDOW_SEC) as PostCloseRow[];

    for (const row of closedWithOpen) {
      // Hala activeMarkets'ta ise ana dongu zaten izliyor
      if (activeMarkets.has(row.id)) continue;

      const secsAfterClose = now - row.close_time;
      console.log(
        `[post-close] Market ${row.id.slice(0,8)} kapali ${secsAfterClose}s — ` +
        `acik pozisyon var, emergency exit deneniyor...`
      );

      try {
        const book = await fetchBook(row.lt_token_id);
        if (book && book.bids.length > 0 && book.asks.length > 0) {
          const bestBid = Number(book.bids.at(-1)!.price);
          const bestAsk = Number(book.asks.at(-1)!.price);
          const fastMid = (bestBid + bestAsk) / 2;

          console.log(
            `[post-close] ${row.lt_side} token mid=${fastMid.toFixed(3)}` +
            ` | bid=${bestBid.toFixed(3)} ask=${bestAsk.toFixed(3)}`
          );

          const mkt: BtcMarket = {
            id: row.id, question: row.question, durationMin: row.duration_min,
            tokenUp: row.token_up, tokenDown: row.token_down,
            openTime: row.open_time, closeTime: row.close_time,
            outcome: (row.outcome as 'UP' | 'DOWN') ?? null,
            upPrice: 0, downPrice: 0, upBid: null, upAsk: null,
            downBid: null, downAsk: null, volume24h: 0, liquidity: 0,
            acceptingOrders: false,
          };

          const upMid   = row.lt_side === 'UP'   ? fastMid : null;
          const downMid = row.lt_side === 'DOWN' ? fastMid : null;

          // force=true: stop_price ve MIN_HOLD kontrolu yok, direkt FOK cascade
          await updateScalpLive(db, mkt, upMid, downMid, true);
        } else {
          console.log(`[post-close] Order book bos — piyasa ilikidit yok, settlement bekleniyor`);
        }
      } catch(e: any) {
        console.error(`[post-close] Hata: ${e.message}`);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(`\n Polymarket BTC Bot — mode=${MODE.toUpperCase()}`);
  console.log('='.repeat(60));

  if (MODE === 'report') {
    printReport();
    return;
  }

  const db = openDb();
  const btcFeed = new BtcPriceFeed(db);
  btcFeed.start();

  if (MODE === 'live' || MODE === 'both') {
    await initClobClient();
  }

  const activeMarkets = new Map<string, BtcMarket>();

  async function refreshMarkets(): Promise<void> {
    try {
      const markets = await fetchActiveMarkets(DURATION_FILTER);
      const newCount = upsertMarkets(db, markets);
      const t = new Date().toISOString().slice(11, 16);
      if (newCount > 0)         console.log(`[discovery] ${t} UTC — ${newCount} yeni market eklendi`);
      else if (!markets.length) console.log(`[discovery] ${t} UTC — aktif market yok, bekleniyor...`);
      else                      console.log(`[discovery] ${t} UTC — ${markets.length} market izleniyor`);

      activeMarkets.clear();
      for (const m of markets) {
        activeMarkets.set(m.id, m);
        if (!lastSnapshotElapsed.has(m.id)) lastSnapshotElapsed.set(m.id, null);
      }

      // Biten marketleri resolve et (DB'de outcome guncelle)
      await resolveMarkets(db);

      // Paper/Live: kapanmis marketlerdeki trade'leri kapat
      if (MODE === 'paper' || MODE === 'live' || MODE === 'both') {
        const resolvedMarkets = db.prepare(`
          SELECT DISTINCT m.id, m.outcome, m.question, m.duration_min,
                 m.open_time, m.close_time, m.token_up, m.token_down
          FROM markets m
          WHERE m.outcome IS NOT NULL AND (
            EXISTS (SELECT 1 FROM paper_trades pt WHERE pt.market_id=m.id AND pt.strategy='scalp' AND pt.outcome IN ('OPEN','PENDING'))
            OR EXISTS (SELECT 1 FROM live_trades lt WHERE lt.market_id=m.id AND lt.outcome='OPEN')
          )
        `).all() as {
          id: string; outcome: string; question: string; duration_min: number;
          open_time: number; close_time: number; token_up: string|null; token_down: string|null;
        }[];

        for (const row of resolvedMarkets) {
          const mkt: BtcMarket = {
            id: row.id, question: row.question, durationMin: row.duration_min,
            tokenUp: row.token_up, tokenDown: row.token_down,
            openTime: row.open_time, closeTime: row.close_time,
            outcome: row.outcome as 'UP' | 'DOWN',
            upPrice: 0, downPrice: 0, upBid: null, upAsk: null,
            downBid: null, downAsk: null, volume24h: 0, liquidity: 0,
            acceptingOrders: false,
          };
          if (MODE === 'paper' || MODE === 'both') resolveScalpTrades(db, mkt);
          if (MODE === 'live' || MODE === 'both') await resolveScalpLive(db, mkt);
        }
        if (MODE === 'live' || MODE === 'both') {
          await autoRedeemWins(db);
        }
      }
    } catch (e) {
      console.error('[discovery] Hata:', e);
    }
  }

  await refreshMarkets();
  setInterval(refreshMarkets, 20_000);
  setInterval(() => tick(db, btcFeed, activeMarkets).catch(console.error), 3_000);
  setInterval(() => printQuickStats(db), 3_600_000);

  console.log('Bot calisiyor. Ctrl+C ile dur.\n');

  const shutdown = (sig: string) => {
    console.log(`\n[bot] Durduruluyor (${sig})...`);
    btcFeed.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    console.error('[bot] Unhandled rejection:', reason);
  });
}

function printQuickStats(db: ReturnType<typeof openDb>): void {
  const t = new Date().toISOString().slice(11, 16);
  console.log(`\n RAPOR ${t} UTC`);

  const live = db.prepare(`
    SELECT
      SUM(CASE WHEN outcome='WIN'  THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN outcome='OPEN' THEN 1 ELSE 0 END) as open,
      ROUND(SUM(CASE WHEN outcome IN ('WIN','LOSS') THEN COALESCE(pnl,0) ELSE 0 END),3) as total_pnl,
      ROUND(AVG(CASE WHEN outcome='WIN'  THEN pnl END),3) as avg_win,
      ROUND(AVG(CASE WHEN outcome='LOSS' THEN pnl END),3) as avg_loss
    FROM live_trades
  `).get() as { wins: number; losses: number; open: number; total_pnl: number; avg_win: number; avg_loss: number } | null;

  if (live) {
    const total = (live.wins ?? 0) + (live.losses ?? 0);
    const wr    = total > 0 ? (((live.wins ?? 0) / total) * 100).toFixed(1) : '—';
    console.log(
      `LIVE   | ${live.wins ?? 0}W / ${live.losses ?? 0}L | %${wr} WR` +
      ` | Net: $${(live.total_pnl ?? 0).toFixed(3)}` +
      ` | AvgWin: $${(live.avg_win ?? 0).toFixed(3)} AvgLoss: $${(live.avg_loss ?? 0).toFixed(3)}` +
      (live.open ? ` | ${live.open} ACIK` : ' | 0 acik'),
    );
  }

  const pstats = db.prepare(`
    SELECT outcome,
           COUNT(*) as c,
           ROUND(SUM(COALESCE(pnl,0)), 2) as pnl
    FROM paper_trades WHERE strategy='scalp'
    GROUP BY outcome ORDER BY outcome
  `).all() as { outcome: string; c: number; pnl: number }[];

  if (pstats.length) {
    const pw   = pstats.find(s => s.outcome === 'WIN');
    const pl   = pstats.find(s => s.outcome === 'LOSS');
    const po   = pstats.find(s => s.outcome === 'OPEN');
    const pp   = pstats.find(s => s.outcome === 'PENDING');
    const ptot = (pw?.c ?? 0) + (pl?.c ?? 0);
    const pwr  = ptot > 0 ? (((pw?.c ?? 0) / ptot) * 100).toFixed(1) : '—';
    const pnl  = (pw?.pnl ?? 0) + (pl?.pnl ?? 0);
    console.log(
      `PAPER  | ${pw?.c ?? 0}W / ${pl?.c ?? 0}L | %${pwr} WR` +
      ` | Net: $${pnl.toFixed(2)}` +
      (po?.c ? ` | ${po.c} acik` : '') +
      (pp?.c ? ` | ${pp.c} bekliyor` : ''),
    );
  }

  console.log('='.repeat(35));
}

function printReport(): void {
  const db = openDb();
  console.log('\n KAPSAMLI RAPOR\n' + '='.repeat(60));

  const marketStats = db.prepare(`
    SELECT duration_min, COUNT(*) as total,
           SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) as resolved,
           SUM(CASE WHEN outcome='UP' THEN 1 ELSE 0 END) as up_wins,
           SUM(CASE WHEN outcome='DOWN' THEN 1 ELSE 0 END) as down_wins
    FROM markets GROUP BY duration_min
  `).all() as { duration_min: number; total: number; resolved: number; up_wins: number; down_wins: number }[];

  console.log('\n Market Istatistikleri:');
  for (const m of marketStats) {
    console.log(`  ${m.duration_min}dk: ${m.resolved}/${m.total} cozuldu | UP=${m.up_wins} DOWN=${m.down_wins}`);
  }

  printQuickStats(db);
  db.close();
}

main().catch(console.error);
