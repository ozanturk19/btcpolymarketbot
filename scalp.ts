/**
 * scalp.ts — Limit order ile scalp stratejisi
 *
 * State machine: PENDING → OPEN → WIN / LOSS / CANCELLED
 *
 *   PENDING  : Limit emir verildi, fill bekleniyor
 *   OPEN     : Fill oldu, pozisyon aktif
 *   WIN      : Target'a ulaştı
 *   LOSS     : Stop'a düştü
 *   CANCELLED: Market kapandı, emir hiç dolmadı (P&L = 0)
 *
 * Parametreler (51 kapanmış trade verisiyle optimize edildi):
 *   ENTRY_MIN = 0.88   — 0.85-0.87 bandı %40 WR, elendi
 *   ENTRY     = 0.95   — üstünde hedef için margin kalmaz
 *   TARGET    = 0.97   — kazanç: (0.97 - entry) × 10 shares
 *   STOP      = 0.83   — kayıp:  (0.83 - entry) × 10 shares
 *   SIZE      = 10     — share sayısı ($9-$9.50 maliyet)
 *   elapsed   ≥ 90s    — ilk 90s %56 WR, sonrası %70+
 *   elapsed   ≤ 240s   — çok geç girmek margin bırakmaz
 *   remaining ≥ 60s    — fill için süre kalmalı
 *
 * Fee modeli: limit order = maker = %0 fee (Polymarket)
 * Limit fiyatı = midpoint (spread içinde, taker fee ödenmez)
 * Fill koşulu: ask ≤ limit_price (birisi bizim fiyatımızı kabul etti)
 */

import type { Db } from '../db/schema';
import type { BtcMarket } from '../discovery';

const ENTRY_MIN = 0.88;
const ENTRY     = 0.95;
const TARGET    = 0.97;
const STOP      = 0.83;
const SIZE      = 10;    // 10 share (~$9)

/** Limit emir ver — fill olmayabilir, o zaman CANCELLED */
export function checkScalp(
  db: Db,
  market: BtcMarket,
  upMid: number | null,
  downMid: number | null,
  elapsed: number,
): void {
  const now       = Math.floor(Date.now() / 1000);
  const remaining = market.closeTime - now;

  // Giriş penceresi: 90-240s elapsed, en az 60s kalsın
  if (elapsed < 90 || elapsed > 240 || remaining < 60) return;

  for (const [side, mid] of [['UP', upMid], ['DOWN', downMid]] as [string, number | null][]) {
    if (mid === null) continue;
    if (mid < ENTRY_MIN || mid > ENTRY) continue;

    // Bu market+taraf için herhangi trade var mı? (her durumda — re-entry yok)
    const exists = db.prepare(`
      SELECT id FROM paper_trades
      WHERE market_id=? AND strategy='scalp' AND side=?
    `).get(market.id, side);
    if (exists) continue;

    // Limit fiyatı = midpoint (maker order, spread içinde)
    const limitPrice = Math.round(mid * 1000) / 1000;

    db.prepare(`
      INSERT INTO paper_trades
        (market_id, strategy, side, entry_price, entry_ts, target_price, stop_price, size_usd, outcome)
      VALUES (?, 'scalp', ?, ?, ?, ?, ?, ?, 'PENDING')
    `).run(market.id, side, limitPrice, now, TARGET, STOP, SIZE);

    console.log(
      `[scalp] PENDING ${side} limit@${limitPrice.toFixed(3)}` +
      ` | elapsed=${elapsed}s remaining=${remaining}s` +
      ` | ${market.question.slice(0, 35)}`
    );
    break; // aynı tick'te tek taraf
  }
}

/** Açık trade'leri yönet: fill kontrolü + target/stop/expiry */
export function updateScalpTrades(
  db: Db,
  market: BtcMarket,
  upMid:  number | null,
  downMid: number | null,
  upAsk:  number | null,
  downAsk: number | null,
): void {
  const now       = Math.floor(Date.now() / 1000);
  const remaining = market.closeTime - now;

  // --- 1. PENDING fill kontrolü ---
  const pending = db.prepare(`
    SELECT * FROM paper_trades
    WHERE market_id=? AND strategy='scalp' AND outcome='PENDING'
  `).all(market.id) as {
    id: number; side: string; entry_price: number; size_usd: number;
    target_price: number; stop_price: number;
  }[];

  for (const t of pending) {
    const ask = t.side === 'UP' ? upAsk : downAsk;
    if (ask === null) continue;

    if (ask <= t.entry_price) {
      // Fill! Ask fiyatı limit'e indi, emir doldu
      db.prepare(`UPDATE paper_trades SET outcome='OPEN' WHERE id=?`).run(t.id);
      console.log(
        `[scalp] FILL ${t.side} @${t.entry_price.toFixed(3)}` +
        ` | ask was ${ask.toFixed(3)} | remaining=${remaining}s`
      );
    }
  }

  // --- 2. OPEN pozisyon takibi: target / stop / expiry ---
  const open = db.prepare(`
    SELECT * FROM paper_trades
    WHERE market_id=? AND strategy='scalp' AND outcome='OPEN'
  `).all(market.id) as {
    id: number; side: string; entry_price: number; size_usd: number;
    target_price: number; stop_price: number;
  }[];

  for (const t of open) {
    const mid = t.side === 'UP' ? upMid : downMid;
    if (mid === null) continue;

    let exitPrice:  number | null = null;
    let exitReason: string | null = null;

    if (mid >= t.target_price) {
      exitPrice  = t.target_price;
      exitReason = 'target';
    } else if (mid <= t.stop_price) {
      exitPrice  = t.stop_price;
      exitReason = 'stop';
    } else if (remaining <= 10) {
      exitPrice  = mid;
      exitReason = 'expiry';
    }

    if (exitPrice !== null && exitReason !== null) {
      const pnl    = (exitPrice - t.entry_price) * t.size_usd;
      const pnlPct = ((exitPrice - t.entry_price) / t.entry_price) * 100;
      const outcome = exitReason === 'stop'   ? 'LOSS'
                    : exitReason === 'target' ? 'WIN'
                    : (pnl >= 0 ? 'WIN' : 'LOSS');

      db.prepare(`
        UPDATE paper_trades
        SET exit_price=?, exit_ts=?, exit_reason=?, pnl=?, pnl_pct=?, outcome=?
        WHERE id=?
      `).run(exitPrice, now, exitReason, pnl, pnlPct, outcome, t.id);

      console.log(
        `[scalp] EXIT ${t.side} @${exitPrice.toFixed(3)}` +
        ` | ${exitReason} | pnl=$${pnl.toFixed(2)}`
      );
    }
  }
}

/**
 * Market kapandığında:
 *  - PENDING → CANCELLED (fill olmadan kapandı, kayıp yok)
 *  - OPEN    → settlement fiyatıyla kapat
 *
 * Settlement: kazanan taraf 1.00, kaybeden taraf stop_price
 * (stop emri defterde duruyordu, bir noktada fill olurdu)
 */
export function resolveScalpTrades(db: Db, market: BtcMarket): void {
  if (!market.outcome) return;

  const now = Math.floor(Date.now() / 1000);

  // PENDING → CANCELLED
  const cancelledCount = db.prepare(`
    UPDATE paper_trades
    SET outcome='CANCELLED', exit_ts=?, exit_reason='no_fill', pnl=0, pnl_pct=0
    WHERE market_id=? AND strategy='scalp' AND outcome='PENDING'
  `).run(now, market.id).changes;

  if (cancelledCount > 0) {
    console.log(`[scalp] CANCEL ${cancelledCount} pending | market=${market.id.slice(0,8)}…`);
  }

  // OPEN → settlement
  const openTrades = db.prepare(`
    SELECT * FROM paper_trades
    WHERE market_id=? AND strategy='scalp' AND outcome='OPEN'
  `).all(market.id) as {
    id: number; side: string; entry_price: number;
    size_usd: number; stop_price: number;
  }[];

  for (const t of openTrades) {
    const won = t.side === market.outcome;
    // Kazanan: 1.00 (token tam değerine ulaştı)
    // Kaybeden: stop_price (limit stop emri defterdeydi, fill olurdu)
    const exitPrice = won ? 1.0 : t.stop_price;
    const exitReason = won ? 'settlement_win' : 'settlement_stop';
    const pnl    = (exitPrice - t.entry_price) * t.size_usd;
    const pnlPct = ((exitPrice - t.entry_price) / t.entry_price) * 100;
    const outcome = won ? 'WIN' : 'LOSS';

    db.prepare(`
      UPDATE paper_trades
      SET exit_price=?, exit_ts=?, exit_reason=?, pnl=?, pnl_pct=?, outcome=?
      WHERE id=?
    `).run(exitPrice, now, exitReason, pnl, pnlPct, outcome, t.id);

    console.log(
      `[scalp] SETTLE ${t.side} | ${won ? 'WIN' : 'LOSS'}` +
      ` | exit@${exitPrice.toFixed(3)} | pnl=$${pnl.toFixed(2)}`
    );
  }
}
