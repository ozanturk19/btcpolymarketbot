/**
 * index.ts — Ana orchestrator
 * Kullanım:
 *   ts-node index.ts --mode=observe   (sadece veri topla)
 *   ts-node index.ts --mode=paper     (veri topla + paper trade)
 *   ts-node index.ts --mode=live      (gerçek para,  trade)
 *   ts-node index.ts --mode=report    (özet rapor yazdır)
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

const MODE = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'observe'; // observe|paper|live|both|report
const DURATION_FILTER = [5]; // sadece 5dk — trade + snapshot

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

    // ─── HIZLI STOP KONTROLÜ ───────────────────────────────────────────────
    // Snapshot döngüsünden BAĞIMSIZ — her 10s'de çalışır.
    // Sorun: shouldSnapshot elapsed=120-240s arasında 60s'de bir true döner.
    // Bu 60s'lik körlük penceresinde market stop seviyesini gap-through edebilir.
    // Fix: Açık pozisyon varsa her tick'te fresh orderbook çekip stop kontrol et.
    if ((MODE === 'live' || MODE === 'both') && isClobReady()) {
      const openForMarket = db.prepare(
        `SELECT id, side, token_id, stop_price FROM live_trades WHERE market_id=? AND outcome='OPEN'`
      ).get(market.id) as { id: number; side: string; token_id: string; stop_price: number } | undefined;

      if (openForMarket) {
        try {
          const book = await fetchBook(openForMarket.token_id);
          // Monitoring log: her 10s'de bir timing testi için
          const swNow = new Date().toISOString().slice(11,19);
          console.log(`[stopwatch] 🔍 ${swNow} | T${openForMarket.id} ${openForMarket.side} stop=${openForMarket.stop_price}`);
          if (book && book.bids.length > 0 && book.asks.length > 0) {
            const bestBid = Number(book.bids.at(-1)!.price);
            const bestAsk = Number(book.asks.at(-1)!.price);
            const fastMid = (bestBid + bestAsk) / 2;
            if (fastMid <= openForMarket.stop_price) {
              const upMid   = openForMarket.side === 'UP'   ? fastMid : null;
              const downMid = openForMarket.side === 'DOWN' ? fastMid : null;
              console.log(`[stopwatch] ⚡ mid=${fastMid.toFixed(3)} ≤ stop=${openForMarket.stop_price} — hızlı stop!`);
              await updateScalpLive(db, market, upMid, downMid);
            }
          }
        } catch(e: any) {
          // Stop watch hataları session'ı engellemez
        }
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

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
        ` | ${remaining}s kaldı | up=${up_best_price?.toFixed(3)} dn=${down_best_price?.toFixed(3)}` +
        ` | BTC=$${btcPrice?.toFixed(0) ?? '?'}`
      );
    }
  }
}

async function main(): Promise<void> {
  console.log(`\n🤖 Polymarket BTC Bot — mode=${MODE.toUpperCase()}`);
  console.log('='.repeat(60));

  if (MODE === 'report') {
    printReport();
    return;
  }

  const db = openDb();
  const btcFeed = new BtcPriceFeed(db);
  btcFeed.start();

  // Live mod: CLOB client'ı startup'ta başlat ve test et
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

      // Biten marketleri resolve et (DB'de outcome güncelle)
      await resolveMarkets(db);

      // Paper/Live: kapanmış marketlerdeki trade'leri kapat
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
          if (MODE === 'live' || MODE === 'both') resolveScalpLive(db, mkt);
        }
        // WIN tokenları otomatik redeem et (live modda)
        if (MODE === 'live' || MODE === 'both') {
          await autoRedeemWins(db);
        }
      }
    } catch (e) {
      console.error('[discovery] Hata:', e);
    }
  }

  await refreshMarkets();
  setInterval(refreshMarkets, 60_000);
  setInterval(() => tick(db, btcFeed, activeMarkets).catch(console.error), 10_000);
  setInterval(() => printQuickStats(db), 3_600_000);

  console.log('✅ Bot çalışıyor. Ctrl+C ile dur.\n');

  process.on('SIGINT', () => {
    console.log('\n[bot] Durduruluyor...');
    btcFeed.stop();
    db.close();
    process.exit(0);
  });
}

function printQuickStats(db: ReturnType<typeof openDb>): void {
  const t = new Date().toISOString().slice(11, 16);
  console.log(`\n📊 ===== RAPOR ${t} UTC =====`);

  // ── LIVE ──────────────────────────────────────────
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
      `💰 LIVE   | ${live.wins ?? 0}W / ${live.losses ?? 0}L | %${wr} WR` +
      ` | Net: $${(live.total_pnl ?? 0).toFixed(3)}` +
      ` | AvgWin: $${(live.avg_win ?? 0).toFixed(3)} AvgLoss: $${(live.avg_loss ?? 0).toFixed(3)}` +
      (live.open ? ` | ⚠️  ${live.open} AÇIK` : ' | 0 açık'),
    );
  }

  // ── PAPER ─────────────────────────────────────────
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
      `📄 PAPER  | ${pw?.c ?? 0}W / ${pl?.c ?? 0}L | %${pwr} WR` +
      ` | Net: $${pnl.toFixed(2)}` +
      (po?.c ? ` | ${po.c} açık` : '') +
      (pp?.c ? ` | ${pp.c} bekliyor` : ''),
    );
  }

  console.log('='.repeat(35));
}

function printReport(): void {
  const db = openDb();
  console.log('\n📈 KAPSAMLI RAPOR\n' + '='.repeat(60));

  const marketStats = db.prepare(`
    SELECT duration_min, COUNT(*) as total,
           SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) as resolved,
           SUM(CASE WHEN outcome='UP' THEN 1 ELSE 0 END) as up_wins,
           SUM(CASE WHEN outcome='DOWN' THEN 1 ELSE 0 END) as down_wins
    FROM markets GROUP BY duration_min
  `).all() as { duration_min: number; total: number; resolved: number; up_wins: number; down_wins: number }[];

  console.log('\n🕐 Market İstatistikleri:');
  for (const m of marketStats) {
    console.log(`  ${m.duration_min}dk: ${m.resolved}/${m.total} çözüldü | UP=${m.up_wins} DOWN=${m.down_wins}`);
  }

  printQuickStats(db);
  db.close();
}

main().catch(console.error);
