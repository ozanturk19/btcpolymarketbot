/**
 * reversal.ts — Strateji 2: 1-2¢'de al, kapanışa kadar tut
 * Sadece düşük volatilite koşulunda gir
 */

import type { Db } from '../db/schema';
import type { BtcMarket } from '../discovery';

const MAX_ENTRY = 0.02;   // maksimum giriş fiyatı
const SIZE      = 10;     // $10 sabit (lotteri bileti mantığı)
const MAX_CONCURRENT = 5; // aynı anda max 5 açık reversal

export function checkReversal(
  db: Db,
  market: BtcMarket,
  upAsk: number | null,
  downAsk: number | null,
  isLowVol: boolean,
): void {
  // Sadece düşük volatilitede gir
  if (!isLowVol) return;

  // Toplam açık reversal sayısını kontrol et
  const openCount = (db.prepare(`
    SELECT COUNT(*) as cnt FROM paper_trades
    WHERE strategy='reversal' AND outcome='OPEN'
  `).get() as { cnt: number }).cnt;

  if (openCount >= MAX_CONCURRENT) return;

  for (const [side, ask] of [['UP', upAsk], ['DOWN', downAsk]] as [string, number | null][]) {
    if (ask === null || ask > MAX_ENTRY || ask <= 0) continue;
    if (openCount >= MAX_CONCURRENT) break;

    const exists = db.prepare(`
      SELECT id FROM paper_trades
      WHERE market_id=? AND strategy='reversal' AND side=? AND outcome='OPEN'
    `).get(market.id, side);
    if (exists) continue;

    db.prepare(`
      INSERT INTO paper_trades
        (market_id, strategy, side, entry_price, entry_ts, size_usd, outcome)
      VALUES (?, 'reversal', ?, ?, ?, ?, 'OPEN')
    `).run(market.id, side, ask, Math.floor(Date.now() / 1000), SIZE);

    console.log(`[reversal] ENTER ${side} @ ${ask}¢ | low-vol lottery | market=${market.question.slice(0,40)}`);
  }
}

/** Reversal trade'leri kapanışta resolve et */
export function resolveReversalTrades(db: Db, market: BtcMarket): void {
  if (!market.outcome) return;  // henüz bitmemiş

  const openTrades = db.prepare(`
    SELECT * FROM paper_trades
    WHERE market_id=? AND strategy='reversal' AND outcome='OPEN'
  `).all(market.id) as {
    id: number; side: string; entry_price: number; size_usd: number;
  }[];

  const now = Math.floor(Date.now() / 1000);

  for (const t of openTrades) {
    const won = t.side === market.outcome;  // 'UP' veya 'DOWN' eşleşiyor mu?
    const exitPrice = won ? 1.0 : 0.0;
    const pnl = (exitPrice - t.entry_price) * t.size_usd;
    const pnlPct = ((exitPrice - t.entry_price) / t.entry_price) * 100;

    db.prepare(`
      UPDATE paper_trades SET
        exit_price=?, exit_ts=?, exit_reason='expiry', pnl=?, pnl_pct=?, outcome=?
      WHERE id=?
    `).run(exitPrice, now, pnl, pnlPct, won ? 'WIN' : 'LOSS', t.id);

    console.log(`[reversal] RESOLVE ${t.side} | won=${won} | pnl=$${pnl.toFixed(2)} (${pnlPct.toFixed(0)}%)`);
  }
}
