/**
 * index.ts — Ana orchestrator
 * Kullanım:
 *   ts-node index.ts --mode=observe   (sadece veri topla)
 *   ts-node index.ts --mode=paper     (veri topla + paper trade)
 *   ts-node index.ts --mode=report    (özet rapor yazdır)
 */

import { openDb } from './db/schema';
import { fetchActiveMarkets, upsertMarkets, resolveMarkets } from './discovery';
import { takeSnapshot, shouldSnapshot } from './collector';
import { BtcPriceFeed } from './btcFeed';
import { checkScalp, updateScalpTrades } from './strategies/scalp';
import { checkReversal, resolveReversalTrades } from './strategies/reversal';
import { checkMaker, resolveMakerTrades } from './strategies/maker';
import type { BtcMarket } from './discovery';

const MODE = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'observe';
const DURATION_FILTER = [5, 15]; // sadece 5-dk ve 15-dk marketler

// Market başına son snapshot elapsed süresini tut
const lastSnapshotElapsed = new Map<string, number | null>();

async function tick(
  db: ReturnType<typeof openDb>,
  btcFeed: BtcPriceFeed,
  activeMarkets: Map<string, BtcMarket>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const btcPrice = btcFeed.current;

  for (const market of activeMarkets.values()) {
    const elapsed  = now - market.openTime;
    const remaining = market.closeTime - now;
    if (remaining < 0) continue;

    const lastElapsed = lastSnapshotElapsed.get(market.id) ?? null;

    // Snapshot al
    if (shouldSnapshot(market, lastElapsed)) {
      await takeSnapshot(db, market, btcPrice);
      lastSnapshotElapsed.set(market.id, elapsed);

      // Son snapshot'tan fiyatları oku
      const snap = db.prepare(`
        SELECT up_bid, up_ask, up_best_price, down_bid, down_ask, down_best_price
        FROM snapshots WHERE market_id=? ORDER BY ts DESC LIMIT 1
      `).get(market.id) as {
        up_bid: number|null; up_ask: number|null; up_best_price: number|null;
        down_bid: number|null; down_ask: number|null; down_best_price: number|null;
      } | null;

      if (!snap) continue;
      const { up_bid, up_ask, up_best_price, down_bid, down_ask, down_best_price } = snap;

      if (MODE === 'paper') {
        // Strateji 1: Scalp
        checkScalp(db, market, up_ask, down_ask, elapsed);
        updateScalpTrades(db, market, up_best_price, down_best_price);

        // Strateji 2: Reversal (düşük vol filtresiyle)
        checkReversal(db, market, up_ask, down_ask, btcFeed.isLowVolatility());

        // Strateji 3: Market Maker (sadece ilk 60s)
        checkMaker(db, market, up_bid, up_ask, down_bid, down_ask, elapsed);
      }

      // Log
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

  const activeMarkets = new Map<string, BtcMarket>();

  // Her 60 saniyede yeni marketleri tara
  async function refreshMarkets(): Promise<void> {
    try {
      const markets = await fetchActiveMarkets(DURATION_FILTER);
      const newCount = upsertMarkets(db, markets);
      if (newCount > 0) console.log(`[discovery] ${newCount} yeni market eklendi`);

      // Aktif listeyi güncelle
      activeMarkets.clear();
      for (const m of markets) {
        activeMarkets.set(m.id, m);
        if (!lastSnapshotElapsed.has(m.id)) {
          lastSnapshotElapsed.set(m.id, null);
        }
      }

      // Biten marketleri resolve et
      await resolveMarkets(db);

      // Paper trade'lerdeki biten marketleri kapat
      if (MODE === 'paper') {
        for (const [id, market] of activeMarkets) {
          if (market.outcome) {
            resolveReversalTrades(db, market);
            resolveMakerTrades(db, market);
          }
        }
      }
    } catch (e) {
      console.error('[discovery] Hata:', e);
    }
  }

  // Başlangıç
  await refreshMarkets();
  setInterval(refreshMarkets, 60_000);

  // Her 10 saniyede tick
  setInterval(() => tick(db, btcFeed, activeMarkets).catch(console.error), 10_000);

  // Her saat başı kısa rapor
  setInterval(() => printQuickStats(db), 3_600_000);

  console.log('✅ Bot çalışıyor. Ctrl+C ile dur.\n');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[bot] Durduruluyor...');
    btcFeed.stop();
    db.close();
    process.exit(0);
  });
}

function printQuickStats(db: ReturnType<typeof openDb>): void {
  const stats = db.prepare(`
    SELECT
      strategy,
      COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) as losses,
      ROUND(SUM(COALESCE(pnl,0)), 2) as total_pnl
    FROM paper_trades
    WHERE outcome != 'OPEN'
    GROUP BY strategy
  `).all() as { strategy: string; total: number; wins: number; losses: number; total_pnl: number }[];

  if (!stats.length) return;

  console.log('\n📊 Paper Trade Özeti:');
  for (const s of stats) {
    const wr = s.total > 0 ? ((s.wins / s.total) * 100).toFixed(1) : '0';
    console.log(`  ${s.strategy.padEnd(10)} | ${s.total} işlem | %${wr} WR | $${s.total_pnl} PnL`);
  }
  console.log();
}

function printReport(): void {
  const db = openDb();

  console.log('\n📈 KAPSAMLI RAPOR\n' + '='.repeat(60));

  // Market istatistikleri
  const marketStats = db.prepare(`
    SELECT
      duration_min,
      COUNT(*) as total,
      SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN outcome='UP' THEN 1 ELSE 0 END) as up_wins,
      SUM(CASE WHEN outcome='DOWN' THEN 1 ELSE 0 END) as down_wins
    FROM markets GROUP BY duration_min
  `).all() as { duration_min: number; total: number; resolved: number; up_wins: number; down_wins: number }[];

  console.log('\n🕐 Market İstatistikleri:');
  for (const m of marketStats) {
    console.log(`  ${m.duration_min}dk: ${m.resolved}/${m.total} çözüldü | UP=${m.up_wins} DOWN=${m.down_wins}`);
  }

  // Scalp analizi: 92¢ görüldüğünde 97¢'ye ulaşma oranı
  const scalpAnalysis = db.prepare(`
    SELECT
      COUNT(*) as total_entries,
      SUM(CASE WHEN up_best_price >= 0.97 THEN 1 ELSE 0 END) as reached_97
    FROM snapshots
    WHERE up_best_price >= 0.92
  `).get() as { total_entries: number; reached_97: number };

  if (scalpAnalysis.total_entries > 0) {
    const rate = ((scalpAnalysis.reached_97 / scalpAnalysis.total_entries) * 100).toFixed(1);
    console.log(`\n🎯 Scalp Analizi (92¢ → 97¢ oranı): %${rate} (${scalpAnalysis.reached_97}/${scalpAnalysis.total_entries})`);
  }

  // Reversal analizi: 1-2¢ outcome'ların win rate'i
  const reversalAnalysis = db.prepare(`
    SELECT
      COUNT(*) as total_snapshots,
      COUNT(DISTINCT s.market_id) as markets
    FROM snapshots s
    JOIN markets m ON s.market_id = m.id
    WHERE s.up_best_price <= 0.02 AND m.outcome IS NOT NULL
  `).get() as { total_snapshots: number; markets: number };

  const reversalWins = db.prepare(`
    SELECT COUNT(DISTINCT s.market_id) as wins
    FROM snapshots s
    JOIN markets m ON s.market_id = m.id
    WHERE s.up_best_price <= 0.02 AND m.outcome = 'UP'
  `).get() as { wins: number };

  if (reversalAnalysis.markets > 0) {
    const wr = ((reversalWins.wins / reversalAnalysis.markets) * 100).toFixed(1);
    console.log(`\n🎲 Reversal Analizi (1-2¢ Up win rate): %${wr} (${reversalWins.wins}/${reversalAnalysis.markets})`);
  }

  // Paper trade sonuçları
  printQuickStats(db);

  db.close();
}

main().catch(console.error);
