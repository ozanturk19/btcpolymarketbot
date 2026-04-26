#!/usr/bin/env ts-node
/**
 * weather_no_bot.ts — Weather NO Position Bot
 *
 * Model (port 8001) blend tahminini Polymarket bucket fiyatıyla karşılaştırır.
 * Yeterli mesafe varsa GTC maker NO order açar, fill sonrası 0.997 limit SELL koyar.
 *
 * Kullanım:
 *   npx ts-node weather_no_bot.ts scan        # Fırsat tara, yeni BUY NO aç
 *   npx ts-node weather_no_bot.ts check-fills # Fill kontrolü + auto-sell
 *   npx ts-node weather_no_bot.ts status       # Açık pozisyonlar
 *   npx ts-node weather_no_bot.ts cancel-stale # 4+ saat dolmamış emirleri iptal et
 *
 * Bağımsız çalışır — /root/weather/ botuna dokunmaz.
 */

import { Side, OrderType } from '@polymarket/clob-client';
import { getClobClient }   from './live/client';
import * as fs   from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http  from 'http';

// ── Parametreler ────────────────────────────────────────────────────────────
const BUY_SHARES         = 7;           // BUY emri: 7 sipariş → ~6.99 token gelir (negRisk 0.001/share kaybı; 6→5.994 sınıra yakın, 7→6.993 güvenli buffer)
const MIN_SELL_SHARES    = 5;           // CLOB minimum sell size
const SHARES             = BUY_SHARES;  // alias — scan loop içinde kullanılır
const AUTO_SELL_PRICE    = 0.99;        // hedef çıkış fiyatı (0.997'den düşürüldü — fill kolaylığı)
const AUTO_SELL_FALLBACK = 0.99;        // tick 0.01 ise fallback
const AUTO_SELL_MIN_EDGE = 0.005;       // fill sonrası en az 0.5 cent kar
const FEE_BPS            = 1000;        // market zorunlu fee bps (maker'a rebate edilir)
const TICK_SIZE_DEFAULT  = '0.01' as const;

const WEATHER_API        = 'http://localhost:8001';
const GAMMA_API          = 'https://gamma-api.polymarket.com';

// ── İki katlı strateji ────────────────────────────────────────────────────
// TIER 1 — CAPPED: server ENS% = %3 cap (0 üye), trend filtresi YOK
//   Mantık: model hiç üye koymuyor → settlement ihtimali neredeyse sıfır
//   PM fiyatı %1.5+ ise küçük mispricing yeterli → 0.98 al, 0.99 sat
const YES_MIN_CAPPED  = 0.015;  // PM en az %1.5 (gerçek likit, 0.985'ten NO alınır)
const YES_MAX_CAPPED  = 0.40;   // PM en fazla %40 (consensus değil ama likit)

// TIER 2 — NEAR-MISS: 1-3 üye (ENS=%3-7%), trend + mesafe filtresi ZORUNLU
//   Mantık: birkaç ensemble üyesi bu bucket'ı gösteriyor → yön analizi gerekli
const ENS_MAX_NEAR    = 0.07;   // ≤%7: 1-3 üye bandı
const YES_MIN_NEAR    = 0.05;   // PM en az %5
const EDGE_MIN_NEAR   = 0.04;   // PM - ENS farkı ≥%4

// ── Ortak filtreler ────────────────────────────────────────────────────────
const MIN_LIQUIDITY   = 300;    // her iki tier için minimum likidite ($)

// ── Trend-tabanlı yön filtresi (TIER 2'ye özgü) ────────────────────────────
// ISINMA  (mean - mode > TREND_THRESHOLD): sadece mode'un ALTINDAKI bucket'lar güvenli
// SOGUMA  (mean - mode < -TREND_THRESHOLD): sadece mode'un ÜSTÜNDEKİ bucket'lar güvenli
// NOTR: Tier 2 için atla; Tier 1 (CAPPED) için trend filtresi uygulanmaz
const TREND_THRESHOLD = 0.3;   // mean-mode farkı bu değeri geçmezse NOTR
const MIN_MODE_DIST   = 2;     // mode'dan en az 2°C uzak olmalı (Tier 2)

const MAX_OPEN         = 20;
const MIN_USDC_RESERVE = 5.0;

const TRADES_FILE = path.join(__dirname, 'data', 'weather_no_trades.json');

const STATIONS = [
  'eglc','ltac','limc','ltfm','lemd','lfpg',
  'eham','eddm','epwa','efhk','omdb','rjtt','rksi','vhhh',
];

const STATION_LABELS: Record<string, string> = {
  eglc:'Londra  ', lfpg:'Paris   ', limc:'Milano  ',
  lemd:'Madrid  ', ltfm:'İstanbul', ltac:'Ankara  ',
  eham:'Amsterdam',eddm:'Münih   ', epwa:'Varşova ',
  efhk:'Helsinki', omdb:'Dubai   ', rjtt:'Tokyo   ',
  rksi:'Seoul   ', vhhh:'HongKong',
};

// ── Veri Tipleri ────────────────────────────────────────────────────────────
interface Trade {
  id:             string;
  station:        string;
  date:           string;
  bucket:         string;
  threshold:      number;
  blend_max:      number;   // en olası settlement bucket (ENS mode °C)
  dist_c:         number;   // edge % (PM% - ENS%), eski alan adı korundu
  yes_price:      number;
  buy_price:      number;
  no_token_id:    string;
  condition_id:   string;
  shares:         number;
  order_id:       string;
  status:         'pending_fill' | 'filled' | 'sell_pending' | 'sold' | 'settled' | 'settled_pending' | 'cancelled';
  fill_price?:    number;
  fill_time?:     string;
  sell_price?:    number;
  sell_order_id?: string;
  sell_placed_at?:string;
  created_at:     string;
  notes?:         string;
}

// ── Yardımcı fonksiyonlar ───────────────────────────────────────────────────
function loadTrades(): Trade[] {
  if (!fs.existsSync(TRADES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8')); }
  catch { return []; }
}

function saveTrades(trades: Trade[]): void {
  fs.mkdirSync(path.dirname(TRADES_FILE), { recursive: true });
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse: ' + url)); }
      });
    }).on('error', reject);
  });
}

type TickSize = '0.1' | '0.01' | '0.001' | '0.0001';

function snapToTick(price: number, tick: string): number {
  const t       = parseFloat(tick);
  const ticks   = Math.floor(price / t);
  const snapped = parseFloat((ticks * t).toFixed(6));
  return Math.min(snapped, 0.99); // CLOB max = 0.99
}

async function getTickSize(client: any, tokenId: string): Promise<TickSize> {
  try {
    const ts = await client.getTickSize(tokenId);
    return (ts as TickSize) ?? TICK_SIZE_DEFAULT;
  } catch { return TICK_SIZE_DEFAULT; }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function shortId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Ensemble istatistiklerini çek — /api/ens-buckets (TEK KAYNAK) ──────────
// Server-side endpoint: bias correction + CAP_LO dashboard ile %100 aynı.
// Bot ASLA kendi bias hesaplamaz — her zaman bu endpoint'i kullanır.
interface EnsStats {
  bucketProbs: Map<number, number>;   // threshold → ENS% (bias-corrected, capped)
  cappedSet:   Set<number>;           // threshold → capped=true olanlar (0 üye, ENS=3%)
  mode:        number;                 // en olası settlement °C (bias-corrected)
  modePct:     number;                 // mode'un ENS%'i
  mean:        number;                 // bias-corrected ensemble mean
  trend:       'warming' | 'cooling' | 'neutral';
  memberCount: number;
  bias:        number;                 // uygulanan bias (negatif = model soğuk)
}

async function getEnsStats(
  station: string,
  date: string,
  _buckets: any[]   // artık kullanılmıyor, server hesaplıyor
): Promise<EnsStats | null> {
  try {
    // Tek API çağrısı — bias correction + CAP_LO server tarafında yapılıyor
    const data = await fetchJson(
      `${WEATHER_API}/api/ens-buckets?station=${station}&date=${encodeURIComponent(date)}`
    );

    if (!data || data.detail) return null;  // 404 / hata

    const bucketProbs = new Map<number, number>();
    const cappedSet   = new Set<number>();
    for (const b of (data.buckets ?? [])) {
      bucketProbs.set(b.threshold as number, b.ens_pct as number);
      if (b.capped) cappedSet.add(b.threshold as number);
    }

    const trend = data.trend === 'warming' ? 'warming'
                : data.trend === 'cooling' ? 'cooling'
                : 'neutral';

    return {
      bucketProbs,
      cappedSet,
      mode:        data.corrected_mode  as number,
      modePct:     data.mode_pct        as number,
      mean:        data.corrected_mean  as number,
      trend,
      memberCount: data.member_count    as number,
      bias:        data.bias            as number,
    };
  } catch { return null; }
}

// ── Polymarket bucket'larını çek ───────────────────────────────────────────
// Polymarket bucket'larını ve event slug'ını çek
interface BucketData {
  buckets: any[];
  slug:    string | null;
}
async function getPolymarketBuckets(station: string, date: string): Promise<BucketData> {
  try {
    const data = await fetchJson(`${WEATHER_API}/api/polymarket?station=${station}&date=${date}`);
    return { buckets: data?.buckets ?? [], slug: data?.slug ?? null };
  } catch { return { buckets: [], slug: null }; }
}

// ── NO token ID'leri gamma events API'den çek (event-level, negRisk doğru) ─
// Bucket başına individual market sorgusu yerine event slug ile tümünü al
// → negRisk durumu tutarsız dönebilen individual market sorgusunu bypass eder
async function getEventNoTokenMap(slug: string): Promise<Map<string, string>> {
  // KEY: YES token ID (decimal string) = condition_id from weather API
  // VAL: NO token ID (decimal string)
  // → condition_id'yi doğrudan YES token olarak kullan, hex dönüşümüne gerek yok
  const map = new Map<string, string>();
  try {
    const data = await fetchJson(`${GAMMA_API}/events?slug=${encodeURIComponent(slug)}`);
    const events = Array.isArray(data) ? data : [data];
    if (events.length === 0) return map;

    const markets: any[] = events[0]?.markets ?? [];
    for (const mkt of markets) {
      const tids = mkt?.clobTokenIds;
      const arr  = typeof tids === 'string' ? JSON.parse(tids) : (Array.isArray(tids) ? tids : []);
      if (arr.length > 1) {
        // arr[0] = YES token ID (decimal), arr[1] = NO token ID (decimal)
        // Weather API'nin condition_id'si = YES token ID → doğrudan eşleşir
        map.set(String(arr[0]), String(arr[1]));
      }
    }
  } catch { /* sessizce devam */ }
  return map;
}

// ── SCAN: Fırsat tara, BUY NO aç ───────────────────────────────────────────
async function cmdScan(): Promise<void> {
  console.log('\n🔍 Weather NO Scanner başlıyor...\n');

  const client = await getClobClient();
  const trades  = loadTrades();

  // Bakiye kontrol
  const { AssetType } = await import('@polymarket/clob-client');
  const balRaw = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  const balance = parseFloat((balRaw as any).balance ?? '0') / 1e6;
  console.log(`💰 USDC bakiye: $${balance.toFixed(2)}`);

  if (balance < MIN_USDC_RESERVE) {
    console.log('⛔ Bakiye rezerv altında, tarama durduruldu.');
    return;
  }

  const openTrades = trades.filter(t =>
    ['pending_fill','filled','sell_pending','settled_pending'].includes(t.status)
  );
  if (openTrades.length >= MAX_OPEN) {
    console.log(`⛔ Max açık pozisyon (${MAX_OPEN}) doldu.`);
    return;
  }

  // Saat 20:00 (TR saati = UTC+3) sonrasında yarının marketi de taranır
  // → gece kapanmadan önce ertesi gün için pozisyon kurmak mümkün olur
  const hourUTC  = new Date().getUTCHours();
  const hourTR   = (hourUTC + 3) % 24;
  const dates    = hourTR >= 20
    ? [todayStr(), tomorrowStr()]   // akşam 20:00+ → bugün + yarın
    : [todayStr()];                 // gündüz → sadece bugün
  console.log(`🕐 TR saati: ${hourTR}:xx | Taranan günler: ${dates.join(', ')}\n`);
  let   newOrders = 0;

  for (const date of dates) {
    for (const station of STATIONS) {
      try {
        // Aynı station+date için zaten açık pozisyon var mı?
        const alreadyOpen = trades.some(t =>
          t.station === station && t.date === date &&
          ['pending_fill','filled','sell_pending','settled_pending'].includes(t.status)
        );
        if (alreadyOpen) continue;

        const { buckets, slug } = await getPolymarketBuckets(station, date);
        if (buckets.length === 0) continue;

        // Ensemble istatistiklerini hesapla (mode, mean, trend + bucket probs)
        const ens = await getEnsStats(station, date, buckets);
        if (!ens) { console.log(`  ⚠️  ${station} ensemble verisi yok, atlanıyor`); continue; }

        const trendLabel = ens.trend === 'warming' ? '🔴 ISINMA' : ens.trend === 'cooling' ? '🔵 SOGUMA' : '⚪ NOTR';
        const diffStr    = (ens.mean - ens.mode >= 0 ? '+' : '') + (ens.mean - ens.mode).toFixed(2);
        const biasStr    = ens.bias !== 0 ? ` bias=${ens.bias > 0 ? '+' : ''}${ens.bias.toFixed(2)}°C` : '';
        console.log(`  📋 ${station.toUpperCase()} | mode=${ens.mode}°C (${(ens.modePct*100).toFixed(0)}%) | mean=${ens.mean.toFixed(1)}°C | diff=${diffStr}°C${biasStr} | ${trendLabel}`);

        // Event-level NO token map
        const noTokenMap = slug ? await getEventNoTokenMap(slug) : new Map<string, string>();
        console.log(`     ${noTokenMap.size} token yüklendi\n`);

        for (const b of buckets) {
          const yes     = b.yes_price as number;
          const thr     = b.threshold as number;
          const isAbove = b.is_above  as boolean;
          const isBelow = b.is_below  as boolean;
          const ensPct  = ens.bucketProbs.get(thr) ?? 0;
          const isCapped = ens.cappedSet.has(thr);   // sunucu: 0 üye, ENS=%3 cap
          const edge    = yes - ensPct;   // PM% - ENS%

          // ── Ortak filtre: minimum likidite ─────────────────────────────────
          if ((b.liquidity ?? 0) < MIN_LIQUIDITY) continue;

          let tier = '';
          if (isCapped) {
            // ────────────────────────────────────────────────────────────────
            // TIER 1 — CAPPED: 0 ensemble üyesi → settlement ihtimali ~0
            // Minimal trend filtresi: ISINMA+isAbove ve SOGUMA+isBelow engelle
            // (GFS model soğuk çalışıyor olabilir → isAbove settle riski var)
            // ────────────────────────────────────────────────────────────────
            if (ens.trend === 'warming' && isAbove) continue;  // ISINMA'da üst extreme
            if (ens.trend === 'cooling' && isBelow) continue;  // SOGUMA'da alt extreme
            if (yes < YES_MIN_CAPPED || yes > YES_MAX_CAPPED) continue;
            // CAPPED kabul — aşağıya devam (emir ver)
            tier = 'T1-capped';
            console.log(`     🎯 TIER1-CAPPED thr=${thr}°C | PM=${(yes*100).toFixed(1)}% ENS=cap(3%) liq=$${Math.round(b.liquidity??0)}`);
          } else {
            // ────────────────────────────────────────────────────────────────
            // TIER 2 — NEAR-MISS: 1-3 ensemble üyesi (ENS=3-7%)
            // Trend filtresi ZORUNLU — yön hatalıysa zararın var
            // ────────────────────────────────────────────────────────────────
            if (ensPct > ENS_MAX_NEAR) continue;              // 3-7% bandı dışı
            if (yes < YES_MIN_NEAR || yes > YES_MAX_CAPPED) continue;
            if (edge < EDGE_MIN_NEAR) continue;               // PM-ENS < 4%

            // NOTR: Tier 2 için yön belirsiz → atla
            if (ens.trend === 'neutral') continue;

            // ISINMA: sıcaklık yukarı → sadece mode - MIN_MODE_DIST ve altı güvenli
            if (ens.trend === 'warming') {
              if (isAbove) continue;
              if (isBelow && thr >= ens.mode - MIN_MODE_DIST) continue;
              if (!isAbove && !isBelow && thr > ens.mode - MIN_MODE_DIST) continue;
            }
            // SOGUMA: sıcaklık aşağı → sadece mode + MIN_MODE_DIST ve üstü güvenli
            if (ens.trend === 'cooling') {
              if (isBelow) continue;
              if (isAbove && thr <= ens.mode + MIN_MODE_DIST) continue;
              if (!isAbove && !isBelow && thr < ens.mode + MIN_MODE_DIST) continue;
            }
            tier = 'T2-near';
            console.log(`     🎯 TIER2-NEAR  thr=${thr}°C | PM=${(yes*100).toFixed(1)}% ENS=${(ensPct*100).toFixed(1)}% edge=+${(edge*100).toFixed(1)}% liq=$${Math.round(b.liquidity??0)}`);
          }

          // NO token ID — event map'ten al (condition_id = YES token ID)
          const condId    = b.condition_id as string;
          const noTokenId = noTokenMap.get(condId) ?? null;
          if (!noTokenId) { console.log(`  ⚠️  NO token bulunamadı: ${b.title}`); continue; }

          // Fiyat hesabı:
          // T1-CAPPED (YES < 3%): NO = 0.97-0.99, thin market → at-market (noPrice)
          //   noPrice - 0.01 yaparsak 10 saatte fill olmaz (stale cancel)
          // T2-NEAR  (YES 5-35%): 1 tick altından maker emir → iyi fill oranı
          const noPrice  = parseFloat((1 - yes).toFixed(2));
          const buyPrice = isCapped
            ? Math.min(noPrice, 0.99)                                          // T1: at-market
            : Math.min(parseFloat((noPrice - 0.01).toFixed(2)), 0.99);        // T2: -1 tick

          console.log(`\n📍 ${station.toUpperCase()} ${STATION_LABELS[station] ?? ''} | ${date} | ${b.title}`);
          console.log(`   ENS=${(ensPct*100).toFixed(1)}% | PM=${(yes*100).toFixed(1)}% | EDGE=+${(edge*100).toFixed(1)}% | NO≈${noPrice} → BUY@${buyPrice}`);
          console.log(`   ${trendLabel} mode=${ens.mode}°C thr=${thr}°C dist=${Math.abs(thr - ens.mode)}°C | liq=$${Math.round(b.liquidity ?? 0)} | shares=${SHARES}`);

          // Emir ver
          const order = await client.createOrder(
            { tokenID: noTokenId, price: buyPrice, side: Side.BUY, size: SHARES, feeRateBps: FEE_BPS },
            { tickSize: TICK_SIZE_DEFAULT, negRisk: true }
          );
          const result = await client.postOrder(order, OrderType.GTC) as any;
          const orderId = result?.orderID ?? result?.order_id ?? result?.id;

          if (!orderId || result?.error) {
            console.log(`   ❌ Emir hatası: ${result?.error ?? result?.errorMsg ?? 'bilinmiyor'}`);
            continue;
          }

          const trade: Trade = {
            id:           shortId(),
            station,
            date,
            bucket:       b.title as string,
            threshold:    thr,
            blend_max:    ens.mode,      // en olası settlement (ENS mode)
            dist_c:       parseFloat((edge * 100).toFixed(1)), // edge % olarak
            yes_price:    yes,
            buy_price:    buyPrice,
            no_token_id:  noTokenId,
            condition_id: condId,
            shares:       SHARES,
            order_id:     orderId,
            status:       'pending_fill',
            created_at:   new Date().toISOString(),
            notes:        `${tier} trend=${ens.trend} mode=${ens.mode}°C mean=${ens.mean.toFixed(1)}°C bias=${ens.bias.toFixed(2)} | ens=${(ensPct*100).toFixed(1)}% pm=${(yes*100).toFixed(1)}% edge=+${(edge*100).toFixed(1)}%`,
          };

          trades.push(trade);
          saveTrades(trades);
          newOrders++;

          console.log(`   ✅ BUY NO emri: ${orderId.slice(0, 20)}... | status=${result?.status}`);

          // Bakiye güncelle (tahmin)
          const spent = buyPrice * SHARES;
          console.log(`   💸 Harcanan: ~$${spent.toFixed(2)}`);

          // Station başına max 1 emir — ilk başarılı emir sonrası bu station'ı kapat
          break;
        }

        if (openTrades.length + newOrders >= MAX_OPEN) break;
      } catch (e: any) {
        console.log(`  ⚠️  ${station} ${date} hata: ${e.message}`);
      }
    }
    if (openTrades.length + newOrders >= MAX_OPEN) break;
  }

  console.log(`\n✅ Tarama tamamlandı. Yeni emir: ${newOrders}`);
  saveTrades(trades);
}

// ── CHECK-FILLS: Fill kontrolü + auto-sell ─────────────────────────────────
async function cmdCheckFills(): Promise<void> {
  console.log('\n🔄 Fill kontrolü...\n');

  const client = await getClobClient();
  const trades  = loadTrades();
  const pending = trades.filter(t => t.status === 'pending_fill');

  if (pending.length === 0) { console.log('  ℹ️  Bekleyen BUY emri yok.'); }

  let updated = 0;
  for (const t of pending) {
    try {
      const resp = await (client as any).getOrder(t.order_id) as any;
      const status  = (resp?.status ?? '').toUpperCase();
      const matched = parseFloat(resp?.size_matched ?? '0');
      const size    = parseFloat(resp?.original_size ?? String(t.shares));

      if (status === 'MATCHED' || matched >= size) {
        t.status     = 'filled';
        t.fill_price = parseFloat(resp?.price ?? String(t.buy_price));
        t.fill_time  = new Date().toISOString();
        console.log(`  ✅ FILL  ${t.station.toUpperCase()} | ${t.bucket} | @ ${t.fill_price}`);
        updated++;

        // Auto-sell hemen koy
        await placeAutoSell(client, t, trades);
      }
    } catch (e: any) {
      console.log(`  ⚠️  Order sorgu hatası ${t.id}: ${e.message}`);
    }
  }

  // ── BUG FIX: filled ama sell emri olmayan tradeleri tekrar dene ─────────
  // placeAutoSell başarısız olursa status='filled' kalır ama sell_order_id yok.
  // Sonraki check-fills çalışmalarında bunları da yakala.
  const filledNoSell = trades.filter(t => t.status === 'filled' && !t.sell_order_id);
  for (const t of filledNoSell) {
    console.log(`  🔁 RETRY sell: ${t.station.toUpperCase()} | ${t.bucket} | fill@${t.fill_price}`);
    await placeAutoSell(client, t, trades);
    updated++;
  }

  // sell_pending emirlerini de kontrol et
  const sellPending = trades.filter(t => t.status === 'sell_pending');
  for (const t of sellPending) {
    try {
      const resp = await (client as any).getOrder(t.sell_order_id!) as any;
      const status  = (resp?.status ?? '').toUpperCase();
      const matched = parseFloat(resp?.size_matched ?? '0');
      const size    = parseFloat(resp?.original_size ?? String(t.shares));
      if (status === 'MATCHED' || matched >= size) {
        t.status = 'sold';
        console.log(`  💰 SOLD  ${t.station.toUpperCase()} | ${t.bucket} | @ ${t.sell_price}`);
        const pnl = ((t.sell_price! - t.fill_price!) * t.shares).toFixed(3);
        console.log(`     P&L: $${pnl}`);
        updated++;
      }
    } catch {}
  }

  saveTrades(trades);
  if (updated > 0) console.log(`\n✅ ${updated} pozisyon güncellendi.`);
}

// ── AUTO-SELL: Fill sonrası 0.997 limit SELL ───────────────────────────────
async function placeAutoSell(client: any, t: Trade, trades: Trade[]): Promise<void> {
  const fillPx = t.fill_price ?? t.buy_price;

  // Tick size'ı çek
  const tick      = await getTickSize(client, t.no_token_id);
  let   sellPrice = snapToTick(AUTO_SELL_PRICE, tick);

  // Tick nedeniyle fiyat çok düştüyse fallback
  const tickNum = parseFloat(tick);
  if (sellPrice < AUTO_SELL_PRICE - tickNum) {
    sellPrice = snapToTick(AUTO_SELL_FALLBACK, tick);
  }

  // Kâr marjı koruması
  if (sellPrice < fillPx + AUTO_SELL_MIN_EDGE) {
    console.log(`  ⏭️  AUTO-SELL atlandı: fill=${fillPx} + min_edge > sell=${sellPrice}`);
    return;
  }

  // ── Gerçek token bakiyesini sorgula (negRisk micro-unit kaybı telafisi) ──
  // 6 sipariş edilse bile 5.994 token gelebilir → floor = 5, satış için yeterli
  let actualShares = t.shares;
  try {
    const { AssetType } = await import('@polymarket/clob-client');
    const balResp = await client.getBalanceAllowance({
      asset_type: AssetType.CONDITIONAL,
      token_id:   t.no_token_id,
    }) as any;
    const rawBal = parseFloat(balResp?.balance ?? '0');
    const tokenBal = Math.floor(rawBal / 1e6);
    if (tokenBal > 0) {
      actualShares = tokenBal;
      console.log(`     token balance: ${tokenBal} (ordered ${t.shares})`);
    }
  } catch { /* balance sorgusu başarısız, kayıtlı shares kullan */ }

  if (actualShares < MIN_SELL_SHARES) {
    console.log(`  🔒 SELL YAPILAMAZ: ${actualShares} token < min ${MIN_SELL_SHARES}. Settlement beklenecek.`);
    t.notes = ((t.notes ?? '') + ` | min_size_stuck:${actualShares}sh`);
    t.status = 'filled'; // filled kalır (sell emri yok), settlement'ta resolve olur
    return;
  }

  try {
    const order = await client.createOrder(
      { tokenID: t.no_token_id, price: sellPrice, side: Side.SELL, size: actualShares, feeRateBps: FEE_BPS },
      { tickSize: tick, negRisk: true }
    );
    const result = await client.postOrder(order, OrderType.GTC) as any;
    const orderId = result?.orderID ?? result?.order_id;

    if (!orderId || result?.error) {
      console.log(`  ⚠️  AUTO-SELL hata: ${result?.error ?? result?.errorMsg}`);
      return;
    }

    t.status          = 'sell_pending';
    t.sell_price      = sellPrice;
    t.sell_order_id   = orderId;
    t.sell_placed_at  = new Date().toISOString();
    t.shares          = actualShares; // gerçek miktarı kaydet
    t.notes           = ((t.notes ?? '') + ` | AUTOSELL@${sellPrice}`).replace(/^\s*\|\s*/, '');

    console.log(`  📤 AUTO-SELL  ${t.station.toUpperCase()} | ${t.bucket} | ${actualShares} share @ ${sellPrice}`);
    console.log(`     tick=${tick} | orderID: ${orderId.slice(0, 20)}...`);
  } catch (e: any) {
    console.log(`  ⚠️  AUTO-SELL exception: ${e.message}`);
  }
}

// ── STATUS: Açık pozisyonları göster ──────────────────────────────────────
async function cmdStatus(): Promise<void> {
  const trades = loadTrades();
  const active = trades.filter(t =>
    ['pending_fill','filled','sell_pending','settled_pending'].includes(t.status)
  );
  const sold   = trades.filter(t => ['sold','settled'].includes(t.status));

  console.log(`\n📊 Weather NO Bot — Pozisyon Durumu`);
  console.log(`   Toplam trade: ${trades.length} | Aktif: ${active.length} | Kapandı: ${sold.length}\n`);

  if (active.length === 0) { console.log('  ℹ️  Açık pozisyon yok.'); }

  for (const t of active) {
    const label  = STATION_LABELS[t.station] ?? t.station;
    const statusMap: Record<string, string> = { pending_fill:'⏳ BEKLE', filled:'✅ FILL', sell_pending:'📤 SATIŞTA', sold:'💰 SATILDI', settled:'🏁 SETTLE', cancelled:'❌ İPTAL' };
    const status = statusMap[t.status] ?? t.status;
    console.log(`  ${status}  ${t.station.toUpperCase()} ${label} | ${t.date} | ${t.bucket}`);
    console.log(`    blend=${t.blend_max}°C | dist=${t.dist_c}°C | buy@${t.buy_price} | shares=${t.shares}`);
    if (t.fill_price) console.log(`    fill@${t.fill_price} | sell@${t.sell_price ?? '?'}`);
    console.log();
  }

  // Gerçekleşmiş P&L
  if (sold.length > 0) {
    let totalPnl = 0;
    for (const t of sold) {
      if (t.sell_price && t.fill_price) {
        totalPnl += (t.sell_price - t.fill_price) * t.shares;
      }
    }
    console.log(`  💰 Toplam gerçekleşmiş P&L: $${totalPnl.toFixed(3)}`);
  }
}

// ── CANCEL-STALE: 4+ saat dolmamış emirleri iptal et ─────────────────────
async function cmdCancelStale(): Promise<void> {
  console.log('\n🗑️  Stale emir iptali...\n');
  const client = await getClobClient();
  const trades  = loadTrades();
  const pending = trades.filter(t => t.status === 'pending_fill');
  const STALE_HOURS = 4;

  let cancelled = 0;
  for (const t of pending) {
    const age = (Date.now() - new Date(t.created_at).getTime()) / 3600000;
    if (age < STALE_HOURS) continue;

    try {
      await (client as any).cancelOrder({ orderID: t.order_id });
      t.status = 'cancelled';
      t.notes  = ((t.notes ?? '') + ' | stale-cancel').trim();
      console.log(`  🗑️  İptal: ${t.station.toUpperCase()} ${t.bucket} (${age.toFixed(1)}h)`);
      cancelled++;
    } catch (e: any) {
      console.log(`  ⚠️  İptal hatası ${t.id}: ${e.message}`);
    }
  }

  saveTrades(trades);
  console.log(`\n✅ ${cancelled} stale emir iptal edildi.`);
}


// ── REDEEM: Settled pozisyonları on-chain redeem et ─────────────────────────
async function cmdRedeem(): Promise<void> {
  console.log('\n🔄 Redeem kontrolü (settled_pending pozisyonlar)...\n');

  const ethers = require('ethers');
  require('dotenv').config({ path: '/root/.polymarket_secrets' });

  const NR_ADAPTER   = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
  const CTF_ADDRESS  = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
  const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
  const WCOL_ADDRESS = '0x3A3BD7bb9528E159577F7C2e685CC81A765002E2';

  const CTF_ABI = [
    'function redeemPositions(address,bytes32,bytes32,uint256[]) external',
    'function payoutDenominator(bytes32) view returns (uint256)',
    'function payoutNumerators(bytes32,uint256) view returns (uint256)',
    'function isApprovedForAll(address,address) view returns (bool)',
    'function setApprovalForAll(address,bool) external',
    'function getCollectionId(bytes32,bytes32,uint256) view returns (bytes32)',
    'function getPositionId(address,bytes32) view returns (uint256)',
    'function balanceOf(address,uint256) view returns (uint256)',
  ];
  const NR_ABI  = ['function redeemPositions(bytes32,uint256[]) external'];
  const ERC20   = ['function balanceOf(address) view returns (uint256)'];
  const WCOL_ABI = ['function balanceOf(address) view returns (uint256)', 'function unwrap(address,uint256) external'];

  const RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'];
  let provider: any = null;
  for (const rpc of RPCS) {
    try {
      const p = new ethers.providers.StaticJsonRpcProvider(rpc);
      await Promise.race([p.getBlockNumber(), new Promise((_: any, r: any) => setTimeout(() => r(new Error('timeout')), 8000))]);
      provider = p; break;
    } catch(e) { /* try next */ }
  }
  if (!provider) { console.log('❌ RPC bağlantısı başarısız'); return; }

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const ctf    = new ethers.Contract(CTF_ADDRESS, CTF_ABI, wallet);
  const nr     = new ethers.Contract(NR_ADAPTER, NR_ABI, wallet);
  const wcol   = new ethers.Contract(WCOL_ADDRESS, WCOL_ABI, wallet);
  const usdc   = new ethers.Contract(USDC_ADDRESS, ERC20, provider);

  // setApprovalForAll — NegRiskAdapter için
  const approved = await ctf.isApprovedForAll(wallet.address, NR_ADAPTER);
  if (!approved) {
    console.log('  🔑 setApprovalForAll...');
    await (await ctf.setApprovalForAll(NR_ADAPTER, true, { gasLimit: 100000 })).wait();
  }

  const trades = loadTrades();
  const stuck  = trades.filter((t: Trade) => t.status === 'settled_pending');

  if (stuck.length === 0) {
    console.log('  ℹ️  Redeem edilecek pozisyon yok.');
    return;
  }

  const usdcBefore = await usdc.balanceOf(wallet.address);

  let redeemed = 0;
  for (const t of stuck) {
    const label = t.station.toUpperCase() + ' ' + t.bucket + ' ' + t.date;
    try {
      if (!t.condition_id) { console.log('  ⚠️  condition_id yok: ' + label); continue; }

      const condBytes32 = ethers.utils.hexZeroPad(ethers.BigNumber.from(t.condition_id).toHexString(), 32);

      // payoutDenominator kontrolü
      const denom = await ctf.payoutDenominator(condBytes32);
      if (denom.eq(0)) { console.log('  ⏳ Henüz settle olmadı: ' + label); continue; }

      // NO payout kontrolü
      const noNumerator = await ctf.payoutNumerators(condBytes32, 1);
      const paysFull    = noNumerator.gt(0);

      // On-chain NO token bakiyesi (wcol-based)
      const colId = await ctf.getCollectionId(ethers.constants.HashZero, condBytes32, 2);
      const posId = await ctf.getPositionId(WCOL_ADDRESS, colId);
      const noBal = await ctf.balanceOf(wallet.address, posId);

      console.log('  ✅ Settled: ' + label + ' | NO bal:' + (Number(noBal)/1e6).toFixed(4) + ' | pays:' + (paysFull?'YES':'NO'));

      if (noBal.isZero()) {
        console.log('     On-chain bakiye 0, zaten redeem edildi');
        t.status = 'settled'; redeemed++; continue;
      }

      let ok = false;
      // 1. Önce NegRiskAdapter.redeemPositions dene
      try {
        const tx1 = await nr.redeemPositions(condBytes32, [0, noBal], { gasLimit: 300000 });
        await tx1.wait();
        console.log('     ✅ NegRiskAdapter redeem OK');
        ok = true;
      } catch(e1: any) {
        console.log('     NegRiskAdapter fail, CTF direkt deneniyor...');
        // 2. CTF.redeemPositions(wcol, HashZero, condId, [2])
        try {
          const tx2 = await ctf.redeemPositions(WCOL_ADDRESS, ethers.constants.HashZero, condBytes32, [2], { gasLimit: 250000 });
          await tx2.wait();
          // wcol bakiyesi varsa unwrap et
          const wcolBal = await wcol.balanceOf(wallet.address);
          if (wcolBal.gt(0)) {
            const tx3 = await wcol.unwrap(wallet.address, wcolBal, { gasLimit: 100000 });
            await tx3.wait();
            console.log('     ✅ CTF+unwrap OK');
          } else {
            console.log('     ✅ CTF redeem OK (0 payout - position lost)');
          }
          ok = true;
        } catch(e2: any) {
          console.log('     ❌ Hata: ' + (e2.message || '').slice(0, 80));
        }
      }

      if (ok) {
        t.status = 'settled';
        redeemed++;
        saveTrades(trades);
      }

    } catch (e: any) {
      console.log('  ⚠️  Hata ' + label + ': ' + (e.message || '').slice(0,80));
    }
  }

  const usdcAfter  = await usdc.balanceOf(wallet.address);
  const usdcGained = (Number(usdcAfter) - Number(usdcBefore)) / 1e6;

  saveTrades(trades);
  console.log('\n✅ ' + redeemed + ' pozisyon settle edildi | USDC kazanıldı: +$' + usdcGained.toFixed(4));
}


// ── Main ────────────────────────────────────────────────────────────────────
const cmd = process.argv[2] ?? 'status';

(async () => {
  switch (cmd) {
    case 'scan':         await cmdScan();        break;
    case 'check-fills':  await cmdCheckFills();   break;
    case 'status':       await cmdStatus();       break;
    case 'cancel-stale': await cmdCancelStale();  break;
    case 'redeem':       await cmdRedeem();       break;
    default:
      console.log('Kullanım: ts-node weather_no_bot.ts [scan|check-fills|status|cancel-stale|redeem]');
  }
  process.exit(0);
})().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
