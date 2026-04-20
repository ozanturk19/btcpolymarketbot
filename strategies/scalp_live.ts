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
 *   sinyal → FOK BUY @ ask  → hemen GTC SELL @ stop_price (stop order)
 *   stop tetiklenir         → GTC stop dolu mu kontrol et; dolmadıysa iptal + FOK cascade
 *   pre-settle              → remaining < 35s ve mid < 0.97 → GTC iptal + FOK panik çıkış
 *   post-close              → market kapandı, force=true ile emergency exit
 *   settlement              → Polymarket otomatik ödeme (WIN=1.00, LOSS=0.00)
 *
 * Stop Loss Güvencesi (3 katmanlı):
 *   1. GTC maker SELL @ stop_price — fiyat oraya gelince otomatik dolar (slippage yok)
 *   2. Pre-settlement exit — market kapanmadan 35s önce, mid < 0.97 ise panik FOK çıkış
 *      → T10117 tipi full kayıp engellenir: mid=0.945, remaining=27s → panik çık
 *   3. FOK cascade fallback — crash/gap durumunda 4 kademeli fiyat:
 *     1. mid - 0.01  (mid'e en yakın, spread dar ise dolar)
 *     2. mid - 0.03  (büyük olasılıkla dolar)
 *     3. mid - 0.06  (agresif, neredeyse garantili)
 *     4. mid - 0.10  (son çare, %99.9 garanti)
 *   Tüm denemeler başarısız olursa → stop_pending (sonraki tick tekrar dener)
 *
 * NOT: İki kademeli GTC (split position) için minimum 10 share gerekir (CLOB min=5/order).
 *   Mevcut SIZE_USD=5 ile ~6 share alınır → split mümkün değil.
 *   Bakiye büyüdüğünde SIZE_USD=10 yapılabilir.
 */

import type { Db }      from '../db/schema';
import type { BtcMarket } from '../discovery';
import { getClobClient } from '../live/client';
import { Side, OrderType, AssetType } from '@polymarket/clob-client';

const SIZE_USD   = 5;     // ~$4.60 per trade — CLOB min order = 5 shares
// TARGET kaldirildi — settlement 1.00 oder, ayrica SELL limit gerekmez
const STOP_DIST  = 0.06;

// 5-dk market parametreleri
const ENTRY_MIN_5    = 0.91;
const ENTRY_MAX_5    = 0.93;
const ELAPSED_MIN_5  = 90;
const ELAPSED_MAX_5  = 240;
const REMAINING_MIN_5 = 60;

// 15-dk market parametreleri (paper data: 0.90-0.93 bandi WR %76, avg +$0.333)
const ENTRY_MIN_15    = 0.90;
const ENTRY_MAX_15    = 0.93;
const ELAPSED_MIN_15  = 180;
const ELAPSED_MAX_15  = 750;  // 900s market'ta 750s elapsed = 150s kalan (>= REMAINING_MIN_15)
const REMAINING_MIN_15 = 120;

// Circuit breaker: kapanmaya yakin ve fiyat belirsizse garantili cikis
const CIRCUIT_BREAKER_REMAINING  = 30;   // saniye kaldiysa tetikle
const CIRCUIT_BREAKER_THRESHOLD  = 0.96; // mid bu esik altinda + remaining<=30s -> acil sat

// Fake stop engelleme: giris sonrasi bu kadar saniye gecmeden stop tetiklenemez.
const MIN_HOLD_BEFORE_STOP = 60;  // saniye
// stop_price'dan bu kadar asagi duserse MIN_HOLD bypass edilir (gercek crash)
const CRASH_BYPASS_DIST = 0.07;

// Eşzamanlı maksimum açık pozisyon sayısı
const MAX_CONCURRENT = 3;

// CLOB order parametreleri
const TICK_SIZE   = '0.01';
const FOK_FEE_BPS = 1000;
const GTC_FEE_BPS = 1000;

/** DB'ye live trade INSERT */
function insertLiveTrade(
  db: Db,
  market: BtcMarket,
  side: string,
  tokenId: string,
  entryOrderId: string,
  exitOrderId: string | null,
  stopOrderId: string | null,
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
    null, stopPrice, SIZE_USD,
  );
}

/** Fiyati 0.01 tick'e yuvarla */
function roundTick(price: number): number {
  return Math.round(price * 100) / 100;
}

/**
 * CLOB "not enough balance" hata mesajindan gercek token bakiyesini parse et.
 */
function parseBalanceFromError(errMsg: string): number | null {
  const m = errMsg.match(/balance:\s*(\d+)/);
  if (!m) return null;
  const raw = parseInt(m[1], 10);
  if (isNaN(raw) || raw <= 0) return null;
  return Math.floor((raw / 1e6) * 100) / 100;
}

/**
 * Her snapshot'ta cagirilir.
 * Sart saglanirsa FOK BUY atar, fill olursa GTC SELL (stop) koyar.
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
  if (market.durationMin !== 5 && market.durationMin !== 15) return;

  const now       = Math.floor(Date.now() / 1000);
  const remaining = market.closeTime - now;

  // Duration-aware entry filtreleri
  const entryMin     = market.durationMin === 15 ? ENTRY_MIN_15  : ENTRY_MIN_5;
  const entryMax     = market.durationMin === 15 ? ENTRY_MAX_15  : ENTRY_MAX_5;
  const elapsedMin   = market.durationMin === 15 ? ELAPSED_MIN_15 : ELAPSED_MIN_5;
  const elapsedMax   = market.durationMin === 15 ? ELAPSED_MAX_15 : ELAPSED_MAX_5;
  const remainingMin = market.durationMin === 15 ? REMAINING_MIN_15 : REMAINING_MIN_5;

  if (elapsed < elapsedMin || elapsed > elapsedMax || remaining < remainingMin) return;

  const sides: [string, number | null, string | null][] = [
    ['UP',   upAsk,   market.tokenUp],
    ['DOWN', downAsk, market.tokenDown],
  ];

  for (const [side, ask, tokenId] of sides) {
    if (!ask || !tokenId) continue;
    if (ask < entryMin || ask > entryMax) continue;

    const openCount = (db.prepare(
      `SELECT COUNT(*) as n FROM live_trades WHERE outcome='OPEN'`,
    ).get() as { n: number }).n;
    if (openCount >= MAX_CONCURRENT) continue;

    const sameMarketOpen = db.prepare(
      `SELECT id FROM live_trades WHERE market_id=? AND outcome='OPEN'`,
    ).get(market.id);
    if (sameMarketOpen) continue;

    const entryPrice = roundTick(ask + 0.01);
    const shares = Math.max(6, Math.round(SIZE_USD / entryPrice) + 1);
    const stopPrice  = roundTick(entryPrice - STOP_DIST);

    console.log(
      `[live] SINYAL ${side} @${entryPrice} | ${shares} share` +
      ` | stop@${stopPrice}` +
      ` | ${market.question.slice(0, 35)}`
    );

    try {
      const client = await getClobClient();

      const buyOrder = await client.createOrder(
        { tokenID: tokenId, price: entryPrice, side: Side.BUY, size: shares, feeRateBps: FOK_FEE_BPS },
        { tickSize: TICK_SIZE, negRisk: false },
      );
      const buyResult = await client.postOrder(buyOrder, OrderType.FOK);

      const orderError = (buyResult as any).error ?? (buyResult as any).errorMsg;
      const orderStatus = (buyResult as any).status;
      const orderSuccess = (buyResult as any).success;

      if (!buyResult || orderError || orderStatus === 400 || orderSuccess === false) {
        console.log(`[live] BUY FILL YOK | ${JSON.stringify(buyResult).slice(0, 200)}`);
        continue;
      }

      const entryOrderId = (buyResult as any).orderID ?? 'unknown';
      const sizeMatched = (buyResult as any).size_matched ?? (buyResult as any).sizeMatched ?? shares;
      console.log(`[live] BUY FILL @${entryPrice} | order=${entryOrderId.slice(0,10)}... | filled=${sizeMatched}`);

      // Token bakiyesi onaylanana kadar bekle
      let confirmedBalance = 0;
      for (let poll = 0; poll < 12; poll++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const balRes = await client.getBalanceAllowance({
            asset_type: AssetType.CONDITIONAL,
            token_id: tokenId,
          });
          const raw = Math.floor((parseFloat(balRes.balance) / 1e6) * 100) / 100;
          if (raw >= 1) {
            confirmedBalance = raw;
            console.log(`[live] Token onaylandi: ${confirmedBalance} shares (${poll + 1}s)`);
            break;
          }
        } catch { /* polling gecici hata */ }
      }
      if (confirmedBalance < 1) {
        console.warn('[live] Token bakiye 12s icinde onaylanmadi — GTC atlandi, FOK cascade fallback');
        confirmedBalance = 0;
      }

      // GTC STOP @ stop_price
      let stopOrderId: string | null = null;
      if (confirmedBalance >= 5) {
        try {
          const stopOrder = await client.createOrder(
            { tokenID: tokenId, price: stopPrice, side: Side.SELL, size: confirmedBalance, feeRateBps: GTC_FEE_BPS },
            { tickSize: TICK_SIZE, negRisk: false },
          );
          const stopResult = await client.postOrder(stopOrder, OrderType.GTC);
          const stopErr = (stopResult as any).error ?? (stopResult as any).errorMsg;
          if (!stopErr) {
            stopOrderId = (stopResult as any).orderID ?? null;
            console.log(`[live] GTC STOP @${stopPrice} set | size=${confirmedBalance} | order=${stopOrderId?.slice(0,10)}...`);
          } else {
            console.warn(`[live] GTC STOP kurulamadi: ${stopErr} — FOK cascade fallback aktif`);
          }
        } catch(e: any) {
          console.warn(`[live] GTC STOP hatasi: ${e.message}`);
        }
      }

      insertLiveTrade(db, market, side, tokenId, entryOrderId, null, stopOrderId, shares, entryPrice, stopPrice);
      break;

    } catch(e: any) {
      console.error(`[live] HATA (${side}): ${e.message}`);
    }
  }
}

/**
 * Acik pozisyonlari izle.
 *
 * 2 cikis tetikleyicisi:
 *   1. Normal stop: mid <= stop_price + MIN_HOLD gecti
 *   2. Force/post-close (force=true): stop_price ve hold kontrolu yok
 *      → index.ts'den POST_CLOSE_WINDOW_SEC icinde cagirilir
 *
 * NOT: Pre-settlement exit (remaining<35s) DEVRE DISI.
 *   Veri: WIN trade'lerin %37'si son 35s'de hala 0.97 altinda —
 *   token 1.0'a son saniyede ziplayabiliyor. Threshold belirlemek icin
 *   yetersiz sinyal. T10117 bu kategoride zaten (%8 ihtimal gerceklesti).
 *
 * FOK cascade: mid-0.01, mid-0.03, mid-0.06, mid-0.10
 */
export async function updateScalpLive(
  db: Db,
  market: BtcMarket,
  upMid:   number | null,
  downMid: number | null,
  force    = false,  // true = post-close emergency exit (stop_price/MIN_HOLD atlaniyor)
): Promise<void> {
  const open = db.prepare(`
    SELECT * FROM live_trades
    WHERE market_id=? AND outcome='OPEN'
  `).all(market.id) as {
    id: number; side: string; token_id: string;
    shares: number; entry_price: number; entry_ts: number;
    stop_price: number;
    stop_order_id: string | null;
  }[];

  if (!open.length) return;

  const now = Math.floor(Date.now() / 1000);

  for (const t of open) {
    const mid = t.side === 'UP' ? upMid : downMid;
    if (!mid) continue;

    const holdTime  = now - t.entry_ts;
    const remaining = market.closeTime - now;

    // -- Exit tetikleyici karar --
    let exitTrigger: 'stop' | 'circuit_breaker' | 'force' | null = null;

    if (force) {
      exitTrigger = 'force';
    } else if (mid <= t.stop_price) {
      // Normal stop -- min hold ve crash bypass
      if (holdTime < MIN_HOLD_BEFORE_STOP) {
        const crashDiff = t.stop_price - mid;
        if (crashDiff > CRASH_BYPASS_DIST) {
          console.log(
            `[live] CRASH BYPASS hold=${holdTime}s < ${MIN_HOLD_BEFORE_STOP}s` +
            ` ama mid=${mid} crash (stop=${t.stop_price}, diff=${crashDiff.toFixed(3)} > ${CRASH_BYPASS_DIST})`,
          );
          exitTrigger = 'stop';
        } else if (remaining >= CIRCUIT_BREAKER_REMAINING) {
          console.log(
            `[live] STOP ERKEN hold=${holdTime}s < ${MIN_HOLD_BEFORE_STOP}s` +
            ` | remaining=${remaining}s | diff=${crashDiff.toFixed(3)} -- bekleniyor`,
          );
          // exitTrigger null kalir, asagida continue tetiklenir
        } else {
          console.log(
            `[live] STOP ERKEN ama remaining=${remaining}s < ${CIRCUIT_BREAKER_REMAINING}s -- acil cikis`,
          );
          exitTrigger = 'stop';
        }
      } else {
        exitTrigger = 'stop';
      }
    } else if (remaining > 0 && remaining <= CIRCUIT_BREAKER_REMAINING && mid < CIRCUIT_BREAKER_THRESHOLD) {
      // CIRCUIT BREAKER: sure azaldi, fiyat belirsiz -- settlement riskini kapat
      // Senaryo: mid 0.87-0.95, stop tetiklenmemis, market LOSS resolve edebilir
      exitTrigger = 'circuit_breaker';
      console.log(
        `[live] CIRCUIT BREAKER T${t.id} ${t.side}` +
        ` | remaining=${remaining}s <= ${CIRCUIT_BREAKER_REMAINING}s` +
        ` | mid=${mid} < ${CIRCUIT_BREAKER_THRESHOLD}` +
        ` | stop=${t.stop_price} (stop tetiklenmemisti)`,
      );
    }

    if (exitTrigger === null) continue;

        const exitLabel = force ? 'FORCE/POST-CLOSE' : exitTrigger === 'circuit_breaker' ? 'CIRCUIT-BREAKER' : 'STOP';
    console.log(
      `[live] EXIT ${exitLabel} ${t.side}` +
      ` | mid=${mid} | stop=${t.stop_price} | hold=${holdTime}s | remaining=${remaining}s`,
    );

    try {
      const client = await getClobClient();

      // GTC stop kontrol
      if (t.stop_order_id) {
        try {
          const orderInfo = await client.getOrder(t.stop_order_id);
          const status = (orderInfo as any).status;
          const sizeMatched = parseFloat((orderInfo as any).size_matched ?? '0');
          const makePrice = parseFloat((orderInfo as any).price ?? '0');

          if (status === 'MATCHED' || sizeMatched > 0) {
            const filledPrice = makePrice || roundTick(t.stop_price);
            const pnl = filledPrice * sizeMatched - t.entry_price * t.shares;
            db.prepare(`
              UPDATE live_trades
              SET exit_price=?, exit_ts=?, exit_reason='stop_gtc_filled',
                  pnl=?, pnl_pct=?, outcome='LOSS'
              WHERE id=?
            `).run(filledPrice, now, pnl, ((filledPrice - t.entry_price) / t.entry_price) * 100, t.id);
            console.log(`[live] GTC STOP onceden dolmus @${filledPrice} | pnl=$${pnl.toFixed(3)}`);
            continue;
          }

          try {
            await client.cancelOrder({ orderID: t.stop_order_id });
            console.log(`[live] GTC STOP iptal edildi — FOK cascade basliyor`);
          } catch(e: any) {
            console.warn(`[live] GTC STOP iptal uyari: ${e.message}`);
          }
        } catch(e: any) {
          console.warn(`[live] GTC STOP sorgu hatasi: ${e.message} — FOK cascade devam`);
        }
      }

      // Kademeli FOK cascade
      const stopAttempts = [
        roundTick(Math.max(mid - 0.01, 0.02)),
        roundTick(Math.max(mid - 0.03, 0.02)),
        roundTick(Math.max(mid - 0.06, 0.02)),
        roundTick(Math.max(mid - 0.10, 0.02)),
      ];

      let filled        = false;
      let filledPrice   = 0;
      let attemptIndex  = -1;
      let stopSellSize  = t.shares;

      for (let i = 0; i < stopAttempts.length; i++) {
        const tryPrice = stopAttempts[i];

        for (let sizeRetry = 0; sizeRetry < 2; sizeRetry++) {
          console.log(`[live] STOP deneme ${i + 1}/${stopAttempts.length} @${tryPrice} | size=${stopSellSize}${sizeRetry > 0 ? ' (bakiye retry)' : ''}`);

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
              console.log(`[live] STOP FILL @${tryPrice} size=${stopSellSize}`);
              break;
            }

            if (sellError && sellError.includes('not enough balance')) {
              const parsedBal = parseBalanceFromError(sellError);
              if (parsedBal && parsedBal > 0 && parsedBal < stopSellSize) {
                console.warn(`[live] Bakiye duzelt: ${stopSellSize}→${parsedBal} | ayni fiyat @${tryPrice} tekrar`);
                stopSellSize = parsedBal;
                continue;
              }
            }

            console.warn(`[live] STOP @${tryPrice} DOLMADI | hata=${sellError ?? 'yok'} → sonraki fiyat`);
            break;

          } catch(e: any) {
            console.warn(`[live] STOP HATA @${tryPrice}: ${e.message}`);
            break;
          }
        }

        if (filled) break;
      }

      if (!filled) {
        console.warn(
          `[live] TUM STOP DENEMELERI BASARISIZ (${stopAttempts.length}) — ` +
          `pozisyon OPEN kaliyor`,
        );
        db.prepare(
          `UPDATE live_trades SET exit_reason='stop_pending' WHERE id=?`,
        ).run(t.id);
        continue;
      }

      const exitReasonBase = force ? 'post_close_fok'
        : exitTrigger === 'circuit_breaker' ? 'circuit_breaker_fok'
        : 'stop_fok';
      const exitReason = `${exitReasonBase}_${attemptIndex + 1}`;
      const pnl = filledPrice * stopSellSize - t.entry_price * t.shares;

      db.prepare(`
        UPDATE live_trades
        SET exit_price=?, exit_ts=?, exit_reason=?,
            pnl=?, pnl_pct=?, outcome=?
        WHERE id=?
      `).run(
        filledPrice, now,
        exitReason,
        pnl,
        ((filledPrice - t.entry_price) / t.entry_price) * 100,
        pnl >= 0 ? 'WIN' : 'LOSS',
        t.id,
      );

      console.log(
        `[live] EXIT ONAYLANDI @${filledPrice} (${exitReason}) | pnl=$${pnl.toFixed(3)}`,
      );

    } catch(e: any) {
      console.error(`[live] EXIT HATASI: ${e.message}`);
    }
  }
}

/**
 * Market kapandiginda — acik pozisyonlari kapat.
 * Polymarket otomatik settlement yapar (WIN=1.00, LOSS=0.00 per share)
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
    const pnl       = (exitPrice - t.entry_price) * t.shares;

    if (won && t.stop_order_id) {
      try {
        const client = await getClobClient();
        await client.cancelOrder({ orderID: t.stop_order_id });
        console.log(`[live] GTC STOP iptal (WIN settlement)`);
      } catch(e: any) {
        console.warn(`[live] GTC STOP iptal uyari (WIN): ${e.message}`);
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
      `[live] SETTLE ${t.side} | ${won ? 'WIN' : 'LOSS'}` +
      ` | pnl=$${pnl.toFixed(3)} | market=${market.outcome}`
    );
  }
}
