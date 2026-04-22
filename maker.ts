/**
 * maker.ts — Strateji 3: Her iki taraf 49¢, spread yakala
 * SADECE market açılışının ilk 60 saniyesinde, her iki taraf dolarsa geçerli
 * En riskli strateji — simülasyonda fill olasılığını modelleriz
 */

import type { Db } from '../db/schema';
import type { BtcMarket } from '../discovery';

const BID_PRICE = 0.49;
const ASK_PRICE = 0.51;
const SIZE      = 50;     // $50 per side

export function checkMaker(
  db: Db,
  market: BtcMarket,
  upBid: number | null,
  upAsk: number | null,
  downBid: number | null,
  downAsk: number | null,
  elapsed: number,
): void {
  // İlk 3 dakikada çalış (orderbook oturması için süre ver)
  if (elapsed > 180 || elapsed < 0) return;

  const exists = db.prepare(`
    SELECT id FROM paper_trades
    WHERE market_id=? AND strategy='maker'
  `).get(market.id);
  if (exists) return;

  // Her iki taraf da ~50¢ civarında mı?
  if (!upAsk || !downAsk) return;
  if (upAsk > 0.53 || downAsk > 0.53) return;

  // Paper trade simülasyonu:
  // Gerçekte her iki tarafın dolması gerekiyor.
  // Simülasyonda: ask <= 0.53 ise "fill oldu" sayıyoruz
  const upFilled   = upAsk   <= BID_PRICE + 0.04;
  const downFilled = downAsk <= BID_PRICE + 0.04;

  if (upFilled && downFilled) {
    // Her iki taraf doldu — spread trade
    const now = Math.floor(Date.now() / 1000);

    // UP tarafı
    db.prepare(`
      INSERT INTO paper_trades
        (market_id, strategy, side, entry_price, entry_ts, target_price, size_usd, outcome)
      VALUES (?, 'maker', 'UP', ?, ?, ?, ?, 'OPEN')
    `).run(market.id, BID_PRICE, now, ASK_PRICE, SIZE);

    // DOWN tarafı
    db.prepare(`
      INSERT INTO paper_trades
        (market_id, strategy, side, entry_price, entry_ts, target_price, size_usd, outcome)
      VALUES (?, 'maker', 'DOWN', ?, ?, ?, ?, 'OPEN')
    `).run(market.id, BID_PRICE, now, ASK_PRICE, SIZE);

    console.log(`[maker] ENTER both sides @ ${BID_PRICE} | market=${market.question.slice(0,40)}`);

  } else if (upFilled && !downFilled) {
    console.warn(`[maker] SKIP — sadece UP doldu, DOWN dolmadı (risk: tek taraflı) | ${market.id}`);
  } else if (downFilled && !upFilled) {
    console.warn(`[maker] SKIP — sadece DOWN doldu, UP dolmadı (risk: tek taraflı) | ${market.id}`);
  }
}

/** Maker trade'leri resolve et */
export function resolveMakerTrades(db: Db, market: BtcMarket): void {
  if (!market.outcome) return;

  const openTrades = db.prepare(`
    SELECT * FROM paper_trades
    WHERE market_id=? AND strategy='maker' AND outcome='OPEN'
  `).all(market.id) as {
    id: number; side: string; entry_price: number; target_price: number; size_usd: number;
  }[];

  const now = Math.floor(Date.now() / 1000);

  for (const t of openTrades) {
    const won = t.side === market.outcome;
    // Market maker: kazanan taraf 1¢'ye gider (bid 0.49 → değer 1.00)
    // Kaybeden taraf 0¢'ye gider (bid 0.49 → değer 0.00)
    const exitPrice = won ? 1.0 : 0.0;
    const pnl = (exitPrice - t.entry_price) * t.size_usd;
    const pnlPct = ((exitPrice - t.entry_price) / t.entry_price) * 100;

    db.prepare(`
      UPDATE paper_trades SET
        exit_price=?, exit_ts=?, exit_reason='expiry', pnl=?, pnl_pct=?, outcome=?
      WHERE id=?
    `).run(exitPrice, now, pnl, pnlPct, won ? 'WIN' : 'LOSS', t.id);
  }

  if (openTrades.length > 0) {
    const totalPnl = openTrades.reduce((s, t) => {
      const won = t.side === market.outcome;
      return s + (won ? 1.0 - t.entry_price : -t.entry_price) * t.size_usd;
    }, 0);
    console.log(`[maker] RESOLVE ${market.outcome} | net pnl=$${totalPnl.toFixed(2)}`);
  }
}
