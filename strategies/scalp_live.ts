/**
 * strategies/scalp_live.ts — Gerçek para ile scalp
 *
 * Paper scalp ile aynı sinyal mantığı, sadece 5dk marketler.
 * Her işlem $5 USDC.e — CLOB min order = 5 shares integer.
 *
 * Polymarket CLOB parametreleri (doğrulandı):
 *   - tickSize: '0.01'   — minimum tick size
 *   - feeRateBps: 1000   — taker FOK emirleri için zorunlu
 *   - feeRateBps: 0      — GTC maker emirleri için
 *
 * Flow:
 *   sinyal → FOK BUY @ ask  → OPEN kaydı + hemen GTC SELL @ 0.99 (target)
 *                           + hemen GTC SELL @ stop_price (stop order)
 *   stop tetiklenir         → GTC stop dolu mu kontrol et; dolmadıysa iptal + FOK cascade
 *   settlement              → Polymarket otomatik ödeme (WIN=1.00, LOSS=0.00)
 *
 * Stop Loss Güvencesi (2 katmanlı):
 *   1. GTC maker SELL @ stop_price — fiyat oraya gelince otomatik dolar (slippage yok)
 *   2. FOK cascade fallback — crash/gap durumunda 4 kademeli fiyat:
 *     1. mid - 0.01  (mid'e en yakın, spread dar ise dolar)
 *     2. mid - 0.03  (büyük olasılıkla dolar)
 *     3. mid - 0.06  (agresif, neredeyse garantili)
 *     4. mid - 0.10  (son çare, %99.9 garanti)
 *   Tüm denemeler başarısız olursa → stop_pending (sonraki tick tekrar dener)
 *
 * Bakiye tespiti: CLOB "not enough balance" hata mesajından gerçek bakiye
 *   parse edilir ve doğru size kullanılır.
 */

import type { Db }      from '../db/schema';
import type { BtcMarket } from '../discovery';
import { getClobClient } from '../live/client';
import { Side, OrderType } from '@polymarket/clob-client';

const SIZE_USD   = 5;     // ~$4.60 per trade — CLOB min order = 5 shares
const ENTRY_MIN  = 0.91;
const ENTRY_MAX  = 0.93;
const TARGET     = 0.99;
const STOP_DIST  = 0.06;
const TAKER_FEE  = 0.02;  // %2 tahmini — gerçek işlemle doğrulanacak

// Fake stop engelleme: giriş sonrası bu kadar saniye geçmeden stop tetiklenemez.
// İstisna: remaining < 30s ise market kapanmadan önce acil çıkış yapılır.
// Etki: T10019(17s), T10020(19s), T10021(20s), T10023(29s) → engellendi
//        T10022(130s) → hâlâ yakalanır (doğru davranış)
const MIN_HOLD_BEFORE_STOP = 60;  // saniye

// CLOB order parametreleri
const TICK_SIZE   = '0.01';  // BTC 5dk marketlerinin minimum tick'i
const FOK_FEE_BPS = 1000;    // Taker FOK için zorunlu minimum
const GTC_FEE_BPS = 1000;  // Market zorunlu kılıyor — aynı FOK ile aynı

/** DB'ye live trade INSERT */
function insertLiveTrade(
  db: Db,
  market: BtcMarket,
  side: string,
  tokenId: string,
  entryOrderId: string,
  exitOrderId: string | null,
  stopOrderId: string | null,   // ← NEW: GTC stop order ID
  shares: number,
  entryPrice: number,
  stopPrice: number,
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO live_trades
      (market_id, token_id, side, entry_order_id, exit_order_id, stop_order_id,
       shares, entry_price, entry_ts, target_price, stop_price, size_usd, outcome)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'OPEN')
  `).run(
    market.id, tokenId, side,
    entryOrderId, exitOrderId, stopOrderId,
    shares, entryPrice, now,
    TARGET, stopPrice, SIZE_USD,
  );
}

/** Fiyatı 0.01 tick'e yuvarla */
function roundTick(price: number): number {
  return Math.round(price * 100) / 100;
}

/**
 * CLOB "not enough balance" hata mesajından gerçek token bakiyesini parse et.
 * Örnek: "the balance is not enough -> balance: 4974800, order amount: 5000000"
 * → 4974800 / 1e6 = 4.9748 → floor 2 decimal = 4.97
 */
function parseBalanceFromError(errMsg: string): number | null {
  const m = errMsg.match(/balance:\s*(\d+)/);
  if (!m) return null;
  const raw = parseInt(m[1], 10);
  if (isNaN(raw) || raw <= 0) return null;
  return Math.floor((raw / 1e6) * 100) / 100;  // microshares → shares, 2 decimal floor
}

/**
 * Her snapshot'ta çağrılır.
 * Şart sağlanırsa FOK BUY atar, fill olursa GTC SELL (target) + GTC SELL (stop) koyar.
 */
export async function checkScalpLive(
  db: Db,
  market: BtcMarket,
  upMid:   number | null,
  downMid: number | null,
  upAsk:   number | null,
  downAsk: number | null,
  elapsed: number,
): Promise<void> {
  // Sadece 5dk — kanıtlı performans
  if (market.durationMin !== 5) return;

  const now       = Math.floor(Date.now() / 1000);
  const remaining = market.closeTime - now;

  // Giriş penceresi: 90-240s (paper ile aynı)
  if (elapsed < 90 || elapsed > 240 || remaining < 60) return;

  const sides: [string, number | null, string | null][] = [
    ['UP',   upAsk,   market.tokenUp],
    ['DOWN', downAsk, market.tokenDown],
  ];

  for (const [side, ask, tokenId] of sides) {
    if (!ask || !tokenId) continue;
    if (ask < ENTRY_MIN || ask > ENTRY_MAX) continue;

    // Herhangi bir markette açık live trade var mı? (eş zamanlı pozisyon önle)
    const exists = db.prepare(`
      SELECT id FROM live_trades WHERE outcome='OPEN'
    `).get();
    if (exists) continue;

    // --- Sipariş ver ---
    const entryPrice = roundTick(ask);  // 0.01 tick'e yuvarla
    // Shares: +1 ekle → fee sonrası (×0.98) ≥5 garantili, GTC stop için minimum 5 sağlanır.
    // Örn: 0.92'de: 6 × 0.98 = 5.88 → GTC stop @ stop_price için yeterli.
    const shares = Math.max(6, Math.round(SIZE_USD / entryPrice) + 1);  // +1 → fee sonrası ≥5 garantili
    const stopPrice  = roundTick(entryPrice - STOP_DIST);
    const fee        = entryPrice * shares * TAKER_FEE;

    console.log(
      `[live] SİNYAL ${side} @${entryPrice} | ${shares} share` +
      ` | stop@${stopPrice} target@${TARGET} | fee≈$${fee.toFixed(3)}` +
      ` | ${market.question.slice(0, 35)}`
    );

    try {
      const client = await getClobClient();

      // BUY — FOK taker order (anında fill ya da iptal)
      const buyOrder = await client.createOrder(
        { tokenID: tokenId, price: entryPrice, side: Side.BUY, size: shares, feeRateBps: FOK_FEE_BPS },
        { tickSize: TICK_SIZE, negRisk: false },
      );
      const buyResult = await client.postOrder(buyOrder, OrderType.FOK);

      // Hata veya fill yok kontrolü
      const orderError = (buyResult as any).error ?? (buyResult as any).errorMsg;
      const orderStatus = (buyResult as any).status;
      const orderSuccess = (buyResult as any).success;

      if (!buyResult || orderError || orderStatus === 400 || orderSuccess === false) {
        console.log(`[live] BUY FILL YOK | ${JSON.stringify(buyResult).slice(0, 200)}`);
        continue;
      }

      const entryOrderId = (buyResult as any).orderID ?? 'unknown';
      const sizeMatched = (buyResult as any).size_matched ?? (buyResult as any).sizeMatched ?? shares;
      console.log(`[live] ✅ BUY FILL @${entryPrice} | order=${entryOrderId.slice(0,10)}... | filled=${sizeMatched}`);

      // SELL — GTC limit @ target (maker, ücretsiz)
      // Not: CLOB taker fee sonrası bakiye shares'tan az olabilir (örn. 6 → 5.88).
      // Önce shares ile dene; "not enough balance" alırsak hata mesajından bakiyeyi parse et ve tekrar dene.
      let exitOrderId: string | null = null;
      try {
        let sellSize = shares;
        const sellOrder = await client.createOrder(
          { tokenID: tokenId, price: TARGET, side: Side.SELL, size: sellSize, feeRateBps: GTC_FEE_BPS },
          { tickSize: TICK_SIZE, negRisk: false },
        );
        const sellResult = await client.postOrder(sellOrder, OrderType.GTC);
        let sellError: string | undefined = (sellResult as any).error ?? (sellResult as any).errorMsg;

        // "not enough balance" → bakiyeyi parse et, tekrar dene
        if (sellError && sellError.includes('not enough balance')) {
          const parsedBal = parseBalanceFromError(sellError);
          if (parsedBal && parsedBal >= 5) {
            console.warn(`[live] SELL LIMIT retry: bakiye ${sellSize} yetersiz, gerçek bakiye ${parsedBal}`);
            sellSize = parsedBal;
            const sellOrder2 = await client.createOrder(
              { tokenID: tokenId, price: TARGET, side: Side.SELL, size: sellSize, feeRateBps: GTC_FEE_BPS },
              { tickSize: TICK_SIZE, negRisk: false },
            );
            const sellResult2 = await client.postOrder(sellOrder2, OrderType.GTC);
            sellError = (sellResult2 as any).error ?? (sellResult2 as any).errorMsg;
            exitOrderId = sellError ? null : ((sellResult2 as any).orderID ?? null);
          } else {
            // Bakiye < 5: minimum altında, GTC kurulamaz — settlement'a bırak
            console.warn(`[live] SELL LIMIT atlandı: bakiye ${parsedBal ?? '?'} < 5 minimum`);
          }
        } else {
          exitOrderId = sellError ? null : ((sellResult as any).orderID ?? null);
        }

        if (exitOrderId) {
          console.log(`[live] 📋 SELL LIMIT @${TARGET} set | size=${sellSize} | order=${exitOrderId.slice(0,10)}...`);
        } else if (sellError && !sellError.includes('not enough balance')) {
          console.warn(`[live] SELL LIMIT kurulamadı: ${sellError} — settlement'a bırakıldı`);
        }
      } catch(e: any) {
        console.warn(`[live] SELL LIMIT hatası: ${e.message}`);
      }

      // GTC STOP emri: stop seviyesine maker order koy (alıcı bekliyoruz)
      // FOK cascade'den çok daha iyi: fiyat oraya gelince otomatik dolar
      let stopOrderId: string | null = null;
      try {
        const stopOrder = await client.createOrder(
          { tokenID: tokenId, price: stopPrice, side: Side.SELL, size: 5, feeRateBps: GTC_FEE_BPS },
          { tickSize: TICK_SIZE, negRisk: false },
        );
        const stopResult = await client.postOrder(stopOrder, OrderType.GTC);
        const stopErr = (stopResult as any).error ?? (stopResult as any).errorMsg;
        if (!stopErr) {
          stopOrderId = (stopResult as any).orderID ?? null;
          console.log(`[live] 🎯 GTC STOP @${stopPrice} set | order=${stopOrderId?.slice(0,10)}...`);
        } else {
          console.warn(`[live] GTC STOP kurulamadı: ${stopErr} — FOK cascade fallback aktif`);
        }
      } catch(e: any) {
        console.warn(`[live] GTC STOP hatası: ${e.message}`);
      }

      // DB'ye kaydet
      insertLiveTrade(db, market, side, tokenId, entryOrderId, exitOrderId, stopOrderId, shares, entryPrice, stopPrice);
      break; // aynı tick'te tek taraf

    } catch(e: any) {
      console.error(`[live] HATA (${side}): ${e.message}`);
    }
  }
}

/**
 * Açık pozisyonları izle — stop tetiklenirse önce GTC stop kontrol et, yoksa FOK cascade.
 *
 * Stop fiyat kademeleri (FOK cascade, hepsi mid-relative, mümkün az kayıp):
 *   1. mid - 0.01  — mid'e en yakın, spread dar ise dolar
 *   2. mid - 0.03  — büyük ihtimalle dolar
 *   3. mid - 0.06  — agresif, neredeyse garantili
 *   4. mid - 0.10  — son çare, %99.9 garanti
 *
 * KRİTİK: İlk denemede "not enough balance" alınırsa hata mesajından
 *   gerçek bakiye parse edilir ve kalan denemeler o size ile yapılır.
 */
export async function updateScalpLive(
  db: Db,
  market: BtcMarket,
  upMid:   number | null,
  downMid: number | null,
): Promise<void> {
  const open = db.prepare(`
    SELECT * FROM live_trades
    WHERE market_id=? AND outcome='OPEN'
  `).all(market.id) as {
    id: number; side: string; token_id: string;
    shares: number; entry_price: number; entry_ts: number;
    target_price: number; stop_price: number;
    exit_order_id: string | null;
    stop_order_id: string | null;
  }[];

  if (!open.length) return;

  const now = Math.floor(Date.now() / 1000);

  for (const t of open) {
    const mid = t.side === 'UP' ? upMid : downMid;
    if (!mid) continue;

    // Stop tetiklendi mi? mid <= stop_price ise çık
    if (mid > t.stop_price) continue;

    // ── Minimum hold süresi kontrolü (fake stop engelleme) ─────────────────
    const holdTime  = now - t.entry_ts;
    const remaining = market.closeTime - now;

    if (holdTime < MIN_HOLD_BEFORE_STOP) {
      if (remaining >= 30) {
        // Henüz erken — bekle, sonraki tick'te tekrar kontrol edilecek
        console.log(
          `[live] ⏱ STOP ERKEN — hold=${holdTime}s < ${MIN_HOLD_BEFORE_STOP}s` +
          ` | remaining=${remaining}s → bekleniyor (fake stop engellendi)`,
        );
        continue;
      } else {
        // Market kapanmak üzere — erken ama acil çıkış yap
        console.log(
          `[live] ⚠️ STOP ERKEN ama remaining=${remaining}s < 30s` +
          ` — acil çıkış yapılıyor (market kapanmadan önce)`,
        );
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    console.log(`[live] 🛑 STOP tetiklendi ${t.side} | mid=${mid} ≤ stop=${t.stop_price} | hold=${holdTime}s`);

    try {
      const client = await getClobClient();

      // Önce GTC stop emrini kontrol et: zaten doldu mu?
      if (t.stop_order_id) {
        try {
          const orderInfo = await client.getOrder(t.stop_order_id);
          const status = (orderInfo as any).status;
          const sizeMatched = parseFloat((orderInfo as any).size_matched ?? '0');
          const makePrice = parseFloat((orderInfo as any).price ?? '0');

          if (status === 'MATCHED' || sizeMatched > 0) {
            // GTC stop emri zaten dolmuş — harika, stop_price'tan çıktık
            const filledPrice = makePrice || roundTick(t.stop_price);
            const fee = t.entry_price * sizeMatched * TAKER_FEE;
            const pnl = (filledPrice - t.entry_price) * sizeMatched - fee;
            db.prepare(`
              UPDATE live_trades
              SET exit_price=?, exit_ts=?, exit_reason='stop_gtc_filled',
                  pnl=?, pnl_pct=?, outcome='LOSS'
              WHERE id=?
            `).run(filledPrice, now, pnl, ((filledPrice - t.entry_price) / t.entry_price) * 100, t.id);
            console.log(`[live] ✅ GTC STOP önceden dolmuş @${filledPrice} | pnl=$${pnl.toFixed(3)}`);
            continue;
          }

          // GTC dolmadı — iptal et ve FOK cascade yap
          try {
            await client.cancelOrder({ orderID: t.stop_order_id });
            console.log(`[live] GTC STOP iptal edildi — FOK cascade başlıyor`);
          } catch(e: any) {
            console.warn(`[live] GTC STOP iptal uyarı: ${e.message}`);
          }
        } catch(e: any) {
          console.warn(`[live] GTC STOP sorgu hatası: ${e.message} — FOK cascade devam`);
        }
      }

      // Önce mevcut SELL limitini (target order) iptal et (varsa)
      if (t.exit_order_id) {
        try {
          await client.cancelOrder({ orderID: t.exit_order_id });
          console.log(`[live] SELL limit iptal edildi`);
        } catch(e: any) {
          console.warn(`[live] Limit iptal uyarı: ${e.message}`);
        }
      }

      // ✅ KRİTİK: Kademeli FOK fiyatları — çıkışı garanti altına al
      // stop tetiklendiğinde mid <= stop_price, yani stop_price'ta alıcı yok.
      // Tüm kademeler mid-relative: mümkün olduğunca az kayıpla çıkış.
      const stopAttempts = [
        roundTick(Math.max(mid - 0.01, 0.02)),           // 1. mid'e en yakın, tight spread varsa dolar
        roundTick(Math.max(mid - 0.03, 0.02)),           // 2. biraz altında, büyük ihtimalle dolar
        roundTick(Math.max(mid - 0.06, 0.02)),           // 3. agresif, neredeyse garantili
        roundTick(Math.max(mid - 0.10, 0.02)),           // 4. son çare, %99.9 garanti
      ];

      let filled        = false;
      let filledPrice   = 0;
      let attemptIndex  = -1;
      let stopSellSize  = t.shares;  // Başlangıçta ordered shares ile dene

      for (let i = 0; i < stopAttempts.length; i++) {
        const tryPrice = stopAttempts[i];
        console.log(`[live] STOP deneme ${i + 1}/${stopAttempts.length} @${tryPrice} | size=${stopSellSize}`);

        try {
          const sellOrder = await client.createOrder(
            { tokenID: t.token_id, price: tryPrice, side: Side.SELL, size: stopSellSize, feeRateBps: FOK_FEE_BPS },
            { tickSize: TICK_SIZE, negRisk: false },
          );
          const sellResult = await client.postOrder(sellOrder, OrderType.FOK);

          const sellError   = (sellResult as any).error ?? (sellResult as any).errorMsg;
          const sizeMatched = parseFloat((sellResult as any).size_matched ?? (sellResult as any).sizeMatched ?? '0');
          const orderFilled = !sellError && (
            (sellResult as any).success === true     ||
            (sellResult as any).status === 'matched' ||
            sizeMatched > 0
          );

          if (orderFilled) {
            filled       = true;
            filledPrice  = tryPrice;
            attemptIndex = i;
            console.log(`[live] ✅ STOP FILL @${tryPrice} (deneme ${i + 1})`);
            break;
          }

          // "not enough balance" → hata mesajından gerçek bakiyeyi parse et
          if (sellError && sellError.includes('not enough balance')) {
            const parsedBal = parseBalanceFromError(sellError);
            if (parsedBal && parsedBal > 0 && parsedBal < stopSellSize) {
              console.warn(`[live] ⚠️  Bakiye düzeltme: ${stopSellSize} → ${parsedBal} (hata mesajından)`);
              stopSellSize = parsedBal;  // Sonraki denemeler için güncelle
            }
          }

          console.warn(
            `[live] ⚠️  STOP deneme ${i + 1} DOLMADI @${tryPrice} | ` +
            `hata=${sellError ?? 'yok'} | matched=${sizeMatched}`,
          );
        } catch(e: any) {
          console.warn(`[live] STOP deneme ${i + 1} HATA: ${e.message}`);
        }
      }

      if (!filled) {
        // Tüm denemeler başarısız — sonraki tick'te tekrar dene
        console.warn(
          `[live] ❌ TÜM STOP DENEMELERİ BAŞARISIZ (${stopAttempts.length} deneme) — ` +
          `pozisyon OPEN kalıyor, sonraki snapshot'ta tekrar denenecek`,
        );
        db.prepare(
          `UPDATE live_trades SET exit_reason='stop_pending' WHERE id=?`,
        ).run(t.id);
        continue;
      }

      // Fill başarılı → LOSS kaydet
      const fee = t.entry_price * stopSellSize * TAKER_FEE;
      const pnl = (filledPrice - t.entry_price) * stopSellSize - fee;

      db.prepare(`
        UPDATE live_trades
        SET exit_price=?, exit_ts=?, exit_reason=?,
            pnl=?, pnl_pct=?, outcome='LOSS'
        WHERE id=?
      `).run(
        filledPrice, now,
        `stop_fok_${attemptIndex + 1}`,
        pnl,
        ((filledPrice - t.entry_price) / t.entry_price) * 100,
        t.id,
      );

      console.log(
        `[live] ✅ STOP çıkış ONAYLANDI @${filledPrice} (FOK deneme ${attemptIndex + 1}) | pnl=$${pnl.toFixed(3)}`,
      );

    } catch(e: any) {
      console.error(`[live] STOP ÇIKIŞ HATASI: ${e.message}`);
    }
  }
}

/**
 * Market kapandığında — açık pozisyonları kapat.
 * Polymarket otomatik settlement yapar (WIN→1.00, LOSS→0.00 per share)
 */
export async function resolveScalpLive(db: Db, market: BtcMarket): Promise<void> {
  if (!market.outcome) return;

  const now = Math.floor(Date.now() / 1000);

  const open = db.prepare(`
    SELECT * FROM live_trades WHERE market_id=? AND outcome='OPEN'
  `).all(market.id) as {
    id: number; side: string; shares: number;
    entry_price: number; stop_price: number;
    stop_order_id: string | null;
  }[];

  for (const t of open) {
    const won       = t.side === market.outcome;
    const exitPrice = won ? 1.0 : 0.0;
    const fee       = t.entry_price * t.shares * TAKER_FEE;
    const pnl       = (exitPrice - t.entry_price) * t.shares - fee;

    // WIN ise GTC stop order'ı iptal et (artık gerek yok)
    if (won && t.stop_order_id) {
      try {
        const client = await getClobClient();
        await client.cancelOrder({ orderID: t.stop_order_id });
        console.log(`[live] ✅ GTC STOP iptal (WIN settlement)`);
      } catch(e: any) {
        // CLOB zaten iptal etmiş olabilir (market kapanınca)
        console.warn(`[live] GTC STOP iptal uyarı (WIN): ${e.message}`);
      }
    }

    db.prepare(`
      UPDATE live_trades
      SET exit_price=?, exit_ts=?, exit_reason=?,
          pnl=?, pnl_pct=?, outcome=?
      WHERE id=?
    `).run(
      exitPrice, now,
      won ? 'settlement_win' : 'settlement_loss',
      pnl, ((exitPrice - t.entry_price) / t.entry_price) * 100,
      won ? 'WIN' : 'LOSS',
      t.id,
    );

    console.log(
      `[live] SETTLE ${t.side} | ${won ? '✅ WIN' : '❌ LOSS'}` +
      ` | pnl=$${pnl.toFixed(3)} | market=${market.outcome}`
    );
  }
}
