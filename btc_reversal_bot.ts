#!/usr/bin/env ts-node
/**
 * btc_reversal_bot.ts — BTC 15dk Streak Reversal Bot
 *
 * Son N market aynı yönde kapanırsa bir sonraki markette
 * ters token için 0.40 GTC limit BUY koyar.
 * Fill sonrası 0.99 GTC limit SELL koyar.
 *
 * Kullanım:
 *   npx ts-node btc_reversal_bot.ts scan          # Streak kontrol + emir aç
 *   npx ts-node btc_reversal_bot.ts check-fills   # Fill + auto-sell
 *   npx ts-node btc_reversal_bot.ts cancel-stale  # Eski/biten market emirlerini iptal
 *   npx ts-node btc_reversal_bot.ts status        # Açık pozisyonlar
 *
 * Cron (önerilen):
 *   *\/5 * * * *   npx ts-node /opt/polymarket/bot/btc_reversal_bot.ts scan
 *   *\/5 * * * *   npx ts-node /opt/polymarket/bot/btc_reversal_bot.ts check-fills
 *   *\/20 * * * *  npx ts-node /opt/polymarket/bot/btc_reversal_bot.ts cancel-stale
 *
 * Filtreler (4 katman):
 *   1. Streak: son N market aynı yön (ör. 5× UP → DOWN al)
 *   2. Streak tazeliği: son kapanış < 25dk önce
 *   3. Timing: market dakika 2-11 arasında (limit fill için pencere)
 *   4. Duplicate koruması: aynı market'te zaten açık varsa atla
 *   5. Market-close iptal: market bittikten sonra fill olmayan order otomatik iptal
 */

import { Side, OrderType } from '@polymarket/clob-client-v2';
import { getClobClient }   from './live/client';
import * as fs    from 'fs';
import * as path  from 'path';
import * as https from 'https';
import * as http  from 'http';

// ── Parametreler ─────────────────────────────────────────────────────────────
const BUY_SHARES         = 6;
const BUY_PRICE          = 0.40;   // GTC limit BUY fiyatı
const SELL_PRICE         = 0.99;   // Fill sonrası GTC limit SELL
const FEE_BPS            = 1000;   // CLOB zorunlu feeRateBps

const STREAK_N           = 5;      // Kaç ardışık aynı yön = sinyal
const ENTRY_MIN_ELAPSED  = 120;    // Markette min 2dk geçmiş olmalı (fiyat stabilize)
const ENTRY_MAX_ELAPSED  = 660;    // Markette max 11dk geçmiş (4dk kala limit şansı biter)
const STREAK_STALE_MIN   = 25;     // Son kapanış max 25dk önce — daha eski streak = geçersiz
const MAX_OPEN           = 3;      // Eş zamanlı max açık pozisyon (pending+filled+sell_pending)
const STALE_CANCEL_HOURS = 0.5;    // 30dk dolmamış pending = stale yedek güvencesi

const GAMMA_API   = 'https://gamma-api.polymarket.com';
const TRADES_FILE = path.join(__dirname, 'data', 'btc_reversal_trades.json');
const TICK_SIZE   = '0.01' as const;

// ── Tipler ───────────────────────────────────────────────────────────────────
interface BtcTrade {
  id:              string;
  market_id:       string;
  question:        string;
  direction:       'UP' | 'DOWN';
  token_id:        string;
  buy_price:       number;
  shares:          number;
  order_id:        string;
  status:          'pending_fill' | 'filled' | 'sell_pending' | 'sold' | 'cancelled';
  fill_price?:     number;
  fill_time?:      string;
  sell_order_id?:  string;
  sell_placed_at?: string;
  created_at:      string;
  streak_info:     string;   // örn: "5×UP→DOWN"
  market_close:    number;   // unix timestamp — market-close iptal için kritik
  notes?:          string;
}

interface ParsedMarket {
  id:        string;
  question:  string;
  tokenUp:   string;
  tokenDown: string;
  closeTime: number;
  openTime:  number;
  upPrice:   number;
  downPrice: number;
  outcome:   'UP' | 'DOWN' | null;
}

interface StreakResult {
  direction:   'UP' | 'DOWN';
  count:       number;
  lastCloseTs: number;
  reversal:    'UP' | 'DOWN';
}

// ── I/O ──────────────────────────────────────────────────────────────────────
function loadTrades(): BtcTrade[] {
  if (!fs.existsSync(TRADES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8')); }
  catch { return []; }
}

function saveTrades(trades: BtcTrade[]): void {
  fs.mkdirSync(path.dirname(TRADES_FILE), { recursive: true });
  const tmp = TRADES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(trades, null, 2));
  fs.renameSync(tmp, TRADES_FILE);
}

function shortId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse: ' + url)); }
      });
    }).on('error', reject);
  });
}

// ── Gamma API yardımcıları ───────────────────────────────────────────────────

function parseGammaMarket(m: any): ParsedMarket | null {
  const q = (m.question as string) ?? '';
  if (!q.includes('Bitcoin Up or Down')) return null;

  const tryArr = (v: any): any[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch {} }
    return [];
  };

  const outcomes = tryArr(m.outcomes);
  const prices   = tryArr(m.outcomePrices).map(Number);
  const tokens   = tryArr(m.clobTokenIds);
  if (tokens.length < 2) return null;

  const upIdx   = outcomes.findIndex((o: string) => o.toLowerCase().includes('up') || o === 'Yes');
  const safeUp  = upIdx >= 0 ? upIdx : 0;
  const dnIdx   = safeUp === 0 ? 1 : 0;

  const closeTime = m.endDate   ? Math.floor(new Date(m.endDate).getTime()   / 1000) : 0;
  const openTime  = m.startDate ? Math.floor(new Date(m.startDate).getTime() / 1000) : 0;

  const upFinal = prices[safeUp] ?? 0;
  const dnFinal = prices[dnIdx]  ?? 0;

  let outcome: 'UP' | 'DOWN' | null = null;
  if      (upFinal > 0.9)  outcome = 'UP';
  else if (dnFinal > 0.9)  outcome = 'DOWN';
  else if (m.winnerIndex == safeUp || m.winnerIndex === String(safeUp)) outcome = 'UP';
  else if (m.winnerIndex == dnIdx  || m.winnerIndex === String(dnIdx))  outcome = 'DOWN';

  return {
    id:        m.id as string,
    question:  q,
    tokenUp:   tokens[safeUp] ?? tokens[0],
    tokenDown: tokens[dnIdx]  ?? tokens[1],
    closeTime,
    openTime,
    upPrice:   prices[safeUp] ?? 0.5,
    downPrice: prices[dnIdx]  ?? 0.5,
    outcome,
  };
}

async function fetchResolvedMarkets(limit = 30): Promise<ParsedMarket[]> {
  const url  = `${GAMMA_API}/markets?tag=crypto&closed=true&limit=${limit}&order=end_date_iso&ascending=false`;
  const data = await fetchJson(url);
  const raw: any[] = Array.isArray(data) ? data : (data.markets ?? []);
  return raw
    .map(parseGammaMarket)
    .filter((m): m is ParsedMarket => m !== null && m.outcome !== null);
}

async function fetchActiveMarkets(): Promise<ParsedMarket[]> {
  const url  = `${GAMMA_API}/markets?tag=crypto&active=true&limit=20`;
  const data = await fetchJson(url);
  const raw: any[] = Array.isArray(data) ? data : (data.markets ?? []);
  return raw
    .map(parseGammaMarket)
    .filter((m): m is ParsedMarket => m !== null && m.closeTime > 0);
}

// ── Streak Hesaplama ─────────────────────────────────────────────────────────

function calculateStreak(markets: ParsedMarket[]): StreakResult | null {
  if (!markets.length) return null;

  const sorted = [...markets].sort((a, b) => b.closeTime - a.closeTime);
  const dir    = sorted[0].outcome!;
  let count    = 0;

  for (const m of sorted) {
    if (m.outcome !== dir) break;
    count++;
  }

  return {
    direction:   dir,
    count,
    lastCloseTs: sorted[0].closeTime,
    reversal:    dir === 'UP' ? 'DOWN' : 'UP',
  };
}

// ── SCAN ─────────────────────────────────────────────────────────────────────
async function cmdScan(): Promise<void> {
  console.log('\n🔍 BTC Reversal — Scan\n');

  const client     = await getClobClient();
  const trades     = loadTrades();
  const openCount  = trades.filter(t =>
    ['pending_fill', 'filled', 'sell_pending'].includes(t.status)
  ).length;

  if (openCount >= MAX_OPEN) {
    console.log(`⚠️  Max açık pozisyon (${MAX_OPEN}) — tarama atlandı.`);
    return;
  }

  // 1. Resolved marketlerden streak hesapla
  let resolved: ParsedMarket[];
  try {
    resolved = await fetchResolvedMarkets(30);
    console.log(`📊 Resolved 15dk BTC market: ${resolved.length}`);
  } catch (e: any) {
    console.error(`❌ Gamma API hatası: ${e.message}`);
    return;
  }

  if (resolved.length < STREAK_N) {
    console.log(`⚠️  Yeterli geçmiş yok (${resolved.length} < ${STREAK_N})`);
    return;
  }

  const streak = calculateStreak(resolved);
  if (!streak) { console.log('⚠️  Streak hesaplanamadı'); return; }

  console.log(`📈 Streak: ${streak.count}× ${streak.direction} | Son kapanış: ${new Date(streak.lastCloseTs * 1000).toISOString()}`);

  // Filtre 1: Yeterli streak
  if (streak.count < STREAK_N) {
    console.log(`⏳ Streak ${streak.count}/${STREAK_N} — sinyal yok.`);
    return;
  }

  // Filtre 2: Streak tazeliği
  const nowSec   = Math.floor(Date.now() / 1000);
  const staleAge = nowSec - streak.lastCloseTs;
  if (staleAge > STREAK_STALE_MIN * 60) {
    const age = Math.round(staleAge / 60);
    console.log(`⚠️  Streak bayat (${age}dk önce kapandı > ${STREAK_STALE_MIN}dk) — atlandı`);
    return;
  }

  console.log(`✅ SİNYAL: ${streak.count}× ${streak.direction} → ${streak.reversal} al`);

  // 2. Aktif marketleri çek
  let active: ParsedMarket[];
  try {
    active = await fetchActiveMarkets();
    console.log(`🟢 Aktif 15dk BTC market: ${active.length}`);
  } catch (e: any) {
    console.error(`❌ Aktif market hatası: ${e.message}`);
    return;
  }

  let newOrders = 0;

  for (const m of active) {
    if (openCount + newOrders >= MAX_OPEN) break;

    // Filtre 3: Timing penceresi (dakika 2-11)
    const elapsed   = nowSec - m.openTime;
    const remaining = m.closeTime - nowSec;

    if (elapsed < ENTRY_MIN_ELAPSED) {
      console.log(`  ⏰ Çok erken (${elapsed}s geçti) — ${m.question.slice(0, 45)}`);
      continue;
    }
    if (elapsed > ENTRY_MAX_ELAPSED) {
      console.log(`  ⏰ Çok geç  (${elapsed}s geçti) — ${m.question.slice(0, 45)}`);
      continue;
    }

    // Filtre 4: Aynı market'te zaten açık pozisyon var mı?
    const dup = trades.find(t =>
      t.market_id === m.id &&
      ['pending_fill', 'filled', 'sell_pending'].includes(t.status)
    );
    if (dup) {
      console.log(`  🔁 Zaten açık — ${m.question.slice(0, 45)}`);
      continue;
    }

    // Hedef token: streak ters yönü
    const tokenId  = streak.reversal === 'UP' ? m.tokenUp  : m.tokenDown;
    const curPrice = streak.reversal === 'UP' ? m.upPrice  : m.downPrice;

    console.log(`\n📍 ${m.question.slice(0, 60)}`);
    console.log(`   Streak: ${streak.count}× ${streak.direction} → ${streak.reversal} al @ ${BUY_PRICE}`);
    console.log(`   Mevcut fiyat: ${curPrice.toFixed(2)} | elapsed: ${elapsed}s | remaining: ${remaining}s`);

    // GTC Limit BUY @ 0.40
    try {
      const order  = await client.createOrder(
        { tokenID: tokenId, price: BUY_PRICE, side: Side.BUY, size: BUY_SHARES, feeRateBps: FEE_BPS },
        { tickSize: TICK_SIZE, negRisk: false }
      );
      const result  = await client.postOrder(order, OrderType.GTC) as any;
      const orderId = result?.orderID ?? result?.order_id ?? result?.id;

      if (!orderId || result?.error) {
        console.log(`   ❌ Emir hatası: ${result?.error ?? result?.errorMsg ?? 'bilinmiyor'}`);
        continue;
      }

      const trade: BtcTrade = {
        id:           shortId(),
        market_id:    m.id,
        question:     m.question,
        direction:    streak.reversal,
        token_id:     tokenId,
        buy_price:    BUY_PRICE,
        shares:       BUY_SHARES,
        order_id:     orderId,
        status:       'pending_fill',
        created_at:   new Date().toISOString(),
        streak_info:  `${streak.count}×${streak.direction}→${streak.reversal}`,
        market_close: m.closeTime,
      };

      trades.push(trade);
      saveTrades(trades);
      newOrders++;

      console.log(`   ✅ BUY emri: ${orderId.slice(0, 22)}... | ${BUY_SHARES}sh @ ${BUY_PRICE} | maks: $${(BUY_PRICE * BUY_SHARES).toFixed(2)}`);

    } catch (e: any) {
      console.log(`   ❌ Emir gönderme hatası: ${e.message}`);
    }
  }

  if (newOrders === 0) console.log('\n  ℹ️  Uygun timing penceresi bulunamadı.');
  else console.log(`\n✅ ${newOrders} yeni emir açıldı.`);

  saveTrades(trades);
}

// ── CHECK-FILLS ───────────────────────────────────────────────────────────────
async function cmdCheckFills(): Promise<void> {
  console.log('\n🔄 Fill kontrolü...\n');

  const client = await getClobClient();
  const trades = loadTrades();
  const nowSec = Math.floor(Date.now() / 1000);
  let updated  = 0;

  // Pending BUY kontrolü
  for (const t of trades.filter(t => t.status === 'pending_fill')) {

    // Market bitmişse → order'ı iptal et (bir sonraki markete taşınmasın!)
    if (nowSec > t.market_close + 30) {
      try { await (client as any).cancelOrder({ orderID: t.order_id }); } catch {}
      t.status = 'cancelled';
      t.notes  = 'market-kapandi-iptal';
      console.log(`  🚫 Market bitti → iptal: ${t.direction} | ${t.question.slice(0, 42)}`);
      updated++;
      continue;
    }

    try {
      const resp = await (client as any).getOrder(t.order_id) as any;

      if (!resp || !resp.status) {
        t.status = 'cancelled';
        t.notes  = 'clob-null-cancel';
        console.log(`  🚫 CLOB-NULL → cancelled: ${t.direction} | ${t.question.slice(0, 42)}`);
        updated++;
        continue;
      }

      const status  = (resp.status as string).toUpperCase();
      const matched = parseFloat(resp?.size_matched ?? '0');
      const size    = parseFloat(resp?.original_size ?? String(t.shares));

      if (status === 'MATCHED' || matched >= size) {
        t.status     = 'filled';
        t.fill_price = parseFloat(resp?.price ?? String(t.buy_price));
        t.fill_time  = new Date().toISOString();
        console.log(`  ✅ FILL  ${t.direction} | ${t.question.slice(0, 42)} | @ ${t.fill_price}`);
        updated++;
        await placeAutoSell(client, t, trades);
      }

    } catch (e: any) {
      console.log(`  ⚠️  Order sorgu hatası ${t.id}: ${e.message}`);
    }
  }

  // filled ama sell emri olmayan tradeleri tekrar dene
  for (const t of trades.filter(t => t.status === 'filled' && !t.sell_order_id)) {
    console.log(`  🔁 RETRY sell: ${t.direction} | ${t.question.slice(0, 42)}`);
    await placeAutoSell(client, t, trades);
    updated++;
  }

  // sell_pending kontrolü
  for (const t of trades.filter(t => t.status === 'sell_pending')) {
    try {
      const resp    = await (client as any).getOrder(t.sell_order_id!) as any;
      const status  = (resp?.status ?? '').toUpperCase();
      const matched = parseFloat(resp?.size_matched ?? '0');
      const size    = parseFloat(resp?.original_size ?? String(t.shares));

      if (status === 'MATCHED' || matched >= size) {
        t.status      = 'sold';
        const fillPx  = t.fill_price ?? t.buy_price;
        const pnl     = ((SELL_PRICE - fillPx) * t.shares).toFixed(2);
        console.log(`  💰 SOLD  ${t.direction} | ${t.streak_info} | @ ${SELL_PRICE} | P&L: +$${pnl}`);
        updated++;
      }
    } catch {}
  }

  saveTrades(trades);
  if (updated > 0) console.log(`\n✅ ${updated} pozisyon güncellendi.`);
  else             console.log('  ℹ️  Değişiklik yok.');
}

// ── AUTO-SELL: 0.99 GTC limit SELL ───────────────────────────────────────────
async function placeAutoSell(client: any, t: BtcTrade, trades: BtcTrade[]): Promise<void> {
  const fillPx = t.fill_price ?? t.buy_price;

  if (SELL_PRICE - fillPx < 0.005) {
    t.status = 'sold';
    console.log(`  ⚠️  Fill@${fillPx}: edge < 0.5¢ — direkt sold`);
    return;
  }

  try {
    const order  = await client.createOrder(
      { tokenID: t.token_id, price: SELL_PRICE, side: Side.SELL, size: t.shares, feeRateBps: FEE_BPS },
      { tickSize: TICK_SIZE, negRisk: false }
    );
    const result  = await client.postOrder(order, OrderType.GTC) as any;
    const sellId  = result?.orderID ?? result?.order_id ?? result?.id;

    if (!sellId || result?.error) {
      console.log(`  ⚠️  Sell hatası: ${result?.error ?? 'bilinmiyor'}`);
      return;
    }

    t.sell_order_id  = sellId;
    t.sell_placed_at = new Date().toISOString();
    t.status         = 'sell_pending';

    const targetPnl = ((SELL_PRICE - fillPx) * t.shares).toFixed(2);
    console.log(`  📤 SELL emri: ${sellId.slice(0, 22)}... @ ${SELL_PRICE} | hedef kâr: +$${targetPnl}`);

  } catch (e: any) {
    console.log(`  ⚠️  Sell gönderme hatası: ${e.message}`);
  }
}

// ── CANCEL-STALE ─────────────────────────────────────────────────────────────
async function cmdCancelStale(): Promise<void> {
  console.log('\n🧹 Stale emir temizliği...\n');

  const client   = await getClobClient();
  const trades   = loadTrades();
  const nowSec   = Math.floor(Date.now() / 1000);
  const cutoffMs = Date.now() - STALE_CANCEL_HOURS * 3600 * 1000;

  // Stale: 30dk+ bekleyen VEYA market zaten bitmiş
  const stale = trades.filter(t =>
    t.status === 'pending_fill' && (
      new Date(t.created_at).getTime() < cutoffMs ||
      nowSec > t.market_close + 30
    )
  );

  if (!stale.length) { console.log('  ℹ️  Stale emir yok.'); return; }

  let cancelled = 0;
  for (const t of stale) {
    try {
      await (client as any).cancelOrder({ orderID: t.order_id });
      t.status = 'cancelled';
      t.notes  = 'stale-cancel';
      console.log(`  🚫 İptal: ${t.direction} | ${t.question.slice(0, 42)}`);
      cancelled++;
    } catch (e: any) {
      console.log(`  ⚠️  İptal hatası ${t.id}: ${e.message}`);
    }
  }

  saveTrades(trades);
  console.log(`\n✅ ${cancelled} emir iptal edildi.`);
}

// ── STATUS ────────────────────────────────────────────────────────────────────
async function cmdStatus(): Promise<void> {
  const trades = loadTrades();
  const open   = trades.filter(t => ['pending_fill', 'filled', 'sell_pending'].includes(t.status));
  const sold   = trades.filter(t => t.status === 'sold');
  const nowSec = Math.floor(Date.now() / 1000);

  console.log('\n📊 BTC Reversal Bot — Durum\n');
  console.log(`  Toplam: ${trades.length} | Açık: ${open.length} | Satıldı: ${sold.length}\n`);

  for (const t of open) {
    const remaining = Math.max(0, t.market_close - nowSec);
    const tag = t.status === 'pending_fill' ? '⏳' : t.status === 'sell_pending' ? '📤' : '✅';
    console.log(`  ${tag} [${t.status.padEnd(12)}] ${t.direction} | ${t.streak_info.padEnd(15)} | entry: ${t.buy_price} | kalan: ${remaining}s`);
    console.log(`       ${t.question.slice(0, 58)}`);
  }

  if (sold.length > 0) {
    const totalPnl = sold.reduce((sum, t) =>
      sum + (SELL_PRICE - (t.fill_price ?? t.buy_price)) * t.shares, 0
    );
    console.log(`\n  Gerçekleşen P&L: +$${totalPnl.toFixed(2)} (${sold.length} trade)`);
  }
}

// ── Giriş Noktası ─────────────────────────────────────────────────────────────
const cmd = process.argv[2];
(async () => {
  try {
    if      (cmd === 'scan')          await cmdScan();
    else if (cmd === 'check-fills')   await cmdCheckFills();
    else if (cmd === 'cancel-stale')  await cmdCancelStale();
    else if (cmd === 'status')        await cmdStatus();
    else {
      console.log('Kullanım: npx ts-node btc_reversal_bot.ts [scan|check-fills|cancel-stale|status]');
      process.exit(1);
    }
  } catch (e: any) {
    console.error('Beklenmeyen hata:', e.message);
    process.exit(1);
  }
})();
