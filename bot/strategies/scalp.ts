/**
 * scalp.ts — Strateji 1: 92¢'de al, 97¢'de sat, stop 88¢
 * 5-dk ve 15-dk marketler için — candle'ın 60-240. saniyesinde aktif
 */

import type { Db } from '../db/schema';
import type { BtcMarket } from '../discovery';

const ENTRY  = 0.92;
const TARGET = 0.97;
const STOP   = 0.88;
const SIZE   = 50;    // $50 paper trade

export function checkScalp(
  db: Db,
  market: BtcMarket,
  upAsk: number | null,
  downAsk: number | null,
  elapsed: number,
): void {
  const remaining = market.closeTime - Math.floor(Date.now() / 1000);

  // Sadece candle ortasında çalış (30s-240s arası) ve en az 60s kalsın
  if (elapsed < 30 || elapsed > 240 || remaining < 60) return;

  for (const [side, ask] of [['UP', upAsk], ['DOWN', downAsk]] as [string, number | null][]) {
    if (ask === null || ask > ENTRY) continue;

    // Bu market+strateji+taraf için zaten açık trade var mı?
    const exists = db.prepare(`
      SELECT id FROM paper_trades
      WHERE market_id=? AND strategy='scalp' AND side=? AND outcome='OPEN'
    `).get(market.id, side);
    if (exists) continue;

    db.prepare(`
      INSERT INTO paper_trades
        (market_id, strategy, side, entry_price, entry_ts, target_price, stop_price, size_usd, outcome)
      VALUES (?, 'scalp', ?, ?, ?, ?, ?, ?, 'OPEN')
    `).run(market.id, side, ask, Math.floor(Date.now() / 1000), TARGET, STOP, SIZE);

    console.log(`[scalp] ENTER ${side} @ ${ask} | market=${market.question.slice(0,40)}`);
  }
}

/** Açık scalp trade'lerini güncelle (target/stop/expiry kontrolü) */
export function updateScalpTrades(
  db: Db,
  market: BtcMarket,
  upMid: number | null,
  downMid: number | null,
): void {
  const openTrades = db.prepare(`
    SELECT * FROM paper_trades
    WHERE market_id=? AND strategy='scalp' AND outcome='OPEN'
  `).all(market.id) as {
    id: number; side: string; entry_price: number; size_usd: number;
    target_price: number; stop_price: number;
  }[];

  const now = Math.floor(Date.now() / 1000);
  const remaining = market.closeTime - now;

  for (const t of openTrades) {
    const mid = t.side === 'UP' ? upMid : downMid;
    if (mid === null) continue;

    let exitPrice: number | null = null;
    let exitReason: string | null = null;

    if (mid >= t.target_price) {
      exitPrice = t.target_price;
      exitReason = 'target';
    } else if (mid <= t.stop_price) {
      exitPrice = t.stop_price;
      exitReason = 'stop';
    } else if (remaining <= 10) {
      exitPrice = mid;
      exitReason = 'expiry';
    }

    if (exitPrice !== null && exitReason !== null) {
      const pnl = (exitPrice - t.entry_price) * t.size_usd;
      const pnlPct = ((exitPrice - t.entry_price) / t.entry_price) * 100;
      const outcome = pnl >= 0 ? 'WIN' : 'LOSS';

      db.prepare(`
        UPDATE paper_trades SET
          exit_price=?, exit_ts=?, exit_reason=?, pnl=?, pnl_pct=?, outcome=?
        WHERE id=?
      `).run(exitPrice, now, exitReason, pnl, pnlPct, outcome, t.id);

      console.log(`[scalp] EXIT ${t.side} @ ${exitPrice} | reason=${exitReason} | pnl=$${pnl.toFixed(2)}`);
    }
  }
}
