/**
 * scalp.ts — Taker order ile scalp stratejisi
 *
 * State machine: OPEN → WIN / LOSS
 *
 *   OPEN     : Taker order anında fill oldu, pozisyon aktif
 *   WIN      : Target'a ulaştı veya settlement_win
 *   LOSS     : Stop'a düştü veya settlement_stop
 *
 * Parametreler (veri destekli, 11 Nisan 2026 — taker güncelleme):
 *   ENTRY_MIN = 0.91   — 0.91: %91-96 WR (5dk+15dk data), 0.90 daha az güvenilir
 *   ENTRY     = 0.93   — ask bazlı üst sınır (0.94+: %2 fee ile kârsız)
 *                         0.94 bucket WR=%60, break-even WR=%66 → elendi
 *                         0.93 bucket WR=%83, break-even WR=%59 → güvenli ✓
 *                         0.92 bucket WR=%84, break-even WR=%54 → en iyi ✓
 *   TARGET    = 0.99   — settlement'ta kazanan 1.00'a gidiyor
 *   STOP_DIST = 0.06   — dinamik: entry - 0.06
 *                         ask=0.92: stop=0.86, win=$0.516, R/R=0.86 (WR=%84 ile karlı)
 *                         ask=0.93: stop=0.87, win=$0.414, R/R=0.69 (WR=%83 ile karlı)
 *   TAKER_FEE = 0.02   — Polymarket taker fee %2 (ask'tan giriş = taker order)
 *   SIZE      = 10     — share sayısı (~$9 maliyet)
 *   elapsed   5dk: 90-240s   — ilk 90s direction signal zayıf
 *   elapsed   15dk: 240-720s  — 15dk markette ilk 4dk beklenir, sonrası net
 *   remaining ≥ 60s    — pozisyon için yeterli süre
 *
 * Neden taker? Kritik keşif (11 Nisan 2026):
 *   Maker order (limit=mid): ask 0.005 üstünde kalırsa fill olmaz (CANCEL)
 *   → Stabil piyasalar (ask az hareket): %95.8 WR ama CANCEL → KAÇIYOR
 *   → Volatil piyasalar (ask çöküyor): fill oluyor ama %0-44 WR → ZARARA GİRİYORUZ
 *   Taker order (limit=ask): anında fill, stabil piyasaları yakala, fee öde ama WR yüksek
 */

import type { Db } from '../db/schema';
import type { BtcMarket } from '../discovery';

const ENTRY_MIN  = 0.91;
const ENTRY      = 0.93;   // ask bazlı üst sınır (eskiden 0.95)
const TARGET     = 0.99;
const STOP_DIST  = 0.06;
const TAKER_FEE  = 0.02;   // %2 taker fee (Polymarket)
const SIZE       = 10;     // 10 share (~$9)

/** Taker order: ask fiyatından anında gir, doğrudan OPEN */
export function checkScalp(
  db: Db,
  market: BtcMarket,
  upMid:   number | null,
  downMid: number | null,
  upAsk:   number | null,
  downAsk: number | null,
  elapsed: number,
): void {
  const now       = Math.floor(Date.now() / 1000);
  const remaining = market.closeTime - now;

  // Giriş penceresi: duration'a göre dinamik, en az 60s kalsın
  // 5dk market:  elapsed 90-240s  (ilk 90s belirsiz, 240s+ margin kalmaz)
  // 15dk market: elapsed 240-720s (ilk 4dk belirsiz, 720s+ margin kalmaz)
  const is15min    = market.durationMin >= 10;
  const elapsedMin = is15min ? 240 : 90;
  const elapsedMax = is15min ? 750 : 240;
  if (elapsed < elapsedMin || elapsed > elapsedMax || remaining < 60) return;

  for (const [side, mid, ask] of [
    ['UP',   upMid,   upAsk],
    ['DOWN', downMid, downAsk],
  ] as [string, number | null, number | null][]) {
    if (mid === null || ask === null) continue;

    // Fiyat bandı: ASK bazlı kontrol (taker entry = ask fiyatı)
    if (ask < ENTRY_MIN || ask > ENTRY) continue;

    // Bu market+taraf için herhangi trade var mı? (re-entry yok)
    const exists = db.prepare(`
      SELECT id FROM paper_trades
      WHERE market_id=? AND strategy='scalp' AND side=? AND outcome IN ('OPEN','PENDING')
    `).get(market.id, side);
    if (exists) continue;

    // Taker order: ask fiyatından anında fill
    const limitPrice = Math.round(ask * 1000) / 1000;
    const stopPrice  = Math.round((limitPrice - STOP_DIST) * 1000) / 1000;

    // Doğrudan OPEN (PENDING bypass — taker = anında fill)
    db.prepare(`
      INSERT INTO paper_trades
        (market_id, strategy, side, entry_price, entry_ts, target_price, stop_price, size_usd, outcome)
      VALUES (?, 'scalp', ?, ?, ?, ?, ?, ?, 'OPEN')
    `).run(market.id, side, limitPrice, now, TARGET, stopPrice, SIZE);

    const fee = (limitPrice * SIZE * TAKER_FEE).toFixed(3);
    console.log(
      `[scalp] OPEN(taker) ${side} @${limitPrice.toFixed(3)}` +
      ` stop@${stopPrice.toFixed(3)} target@${TARGET}` +
      ` fee=$${fee}` +
      ` | elapsed=${elapsed}s remaining=${remaining}s` +
      ` | ${market.question.slice(0, 35)}`
    );
    break; // aynı tick'te tek taraf
  }
}

/** Açık pozisyonları yönet: target / stop / expiry */
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

  // --- 1. PENDING fill kontrolü (geriye dönük uyumluluk — eski trades) ---
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
      db.prepare(`UPDATE paper_trades SET outcome='OPEN' WHERE id=?`).run(t.id);
      console.log(`[scalp] FILL(legacy) ${t.side} @${t.entry_price.toFixed(3)} | ask=${ask.toFixed(3)}`);
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
    }

    if (exitPrice !== null && exitReason !== null) {
      // P&L: fiyat farkı - taker fee (entry'de ödendi)
      const fee    = t.entry_price * t.size_usd * TAKER_FEE;
      const pnl    = (exitPrice - t.entry_price) * t.size_usd - fee;
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
        ` | ${exitReason} | pnl=$${pnl.toFixed(2)} (fee=$${fee.toFixed(2)})`
      );
    }
  }
}

/**
 * Market kapandığında:
 *  - PENDING → CANCELLED (eski sistem kalıntısı)
 *  - OPEN    → settlement fiyatıyla kapat
 *
 * Settlement: kazanan → 1.00, kaybeden → stop_price
 */
export function resolveScalpTrades(db: Db, market: BtcMarket): void {
  if (!market.outcome) return;

  const now = Math.floor(Date.now() / 1000);

  // PENDING → CANCELLED (eski sistem kalıntısı)
  const cancelledCount = db.prepare(`
    UPDATE paper_trades
    SET outcome='CANCELLED', exit_ts=?, exit_reason='no_fill', pnl=0, pnl_pct=0
    WHERE market_id=? AND strategy='scalp' AND outcome='PENDING'
  `).run(now, market.id).changes;

  if (cancelledCount > 0) {
    console.log(`[scalp] CANCEL ${cancelledCount} pending(legacy) | market=${market.id.slice(0,8)}…`);
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
    const exitPrice  = won ? 1.0 : t.stop_price;
    const exitReason = won ? 'settlement_win' : 'settlement_stop';
    const fee    = t.entry_price * t.size_usd * TAKER_FEE;
    const pnl    = (exitPrice - t.entry_price) * t.size_usd - fee;
    const pnlPct = ((exitPrice - t.entry_price) / t.entry_price) * 100;
    const outcome = won ? 'WIN' : 'LOSS';

    db.prepare(`
      UPDATE paper_trades
      SET exit_price=?, exit_ts=?, exit_reason=?, pnl=?, pnl_pct=?, outcome=?
      WHERE id=?
    `).run(exitPrice, now, exitReason, pnl, pnlPct, outcome, t.id);

    console.log(
      `[scalp] SETTLE ${t.side} | ${won ? 'WIN' : 'LOSS'}` +
      ` | exit@${exitPrice.toFixed(3)} | pnl=$${pnl.toFixed(2)} (fee=$${fee.toFixed(2)})`
    );
  }
}
