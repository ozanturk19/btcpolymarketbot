/**
 * analyze.ts — Strateji faktör analizi
 *
 * Çalıştırma: ts-node analyze.ts
 *
 * Analiz edilen faktörler:
 *   1. Spread filtresi      — dar/geniş spread ve WR ilişkisi
 *   2. Volatilite filtresi  — düşük/yüksek BTC volatilitesi ve WR ilişkisi
 *   3. Zaman dilimi         — saate göre WR dağılımı
 *   4. BTC momentum         — giriş anındaki BTC yönü ve WR ilişkisi
 */

import { openDb } from './db/schema';

const db = openDb();

// ─────────────────────────────────────────────────────────────────
// Yardımcı: tablo yazdır
// ─────────────────────────────────────────────────────────────────
function printTable(title: string, rows: Record<string, any>[]): void {
  if (!rows.length) { console.log(`\n${title}\n  (veri yok)\n`); return; }
  const cols = Object.keys(rows[0]);
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const line = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const header = cols.map((c, i) => c.padEnd(widths[i])).join(' │ ');
  console.log(`\n${'═'.repeat(line.length)}`);
  console.log(title);
  console.log('─' + line + '─');
  console.log(' ' + header);
  console.log('─' + line + '─');
  for (const row of rows) {
    console.log(' ' + cols.map((c, i) => String(row[c] ?? '—').padEnd(widths[i])).join(' │ '));
  }
  console.log('─' + line + '─');
}

// ─────────────────────────────────────────────────────────────────
// 0. Genel bakış
// ─────────────────────────────────────────────────────────────────
function overview(): void {
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM markets)                           AS markets,
      (SELECT COUNT(*) FROM markets WHERE outcome IS NOT NULL) AS resolved,
      (SELECT COUNT(*) FROM snapshots)                         AS snapshots,
      (SELECT COUNT(*) FROM paper_trades WHERE strategy='scalp') AS paper,
      (SELECT COUNT(*) FROM live_trades)                       AS live,
      (SELECT COUNT(*) FROM btc_prices)                        AS btc_ticks
  `).get() as Record<string, number>;

  console.log('\n══════════════════════════════════════════════════');
  console.log('  POLYMARKET BTC BOT — STRATEJİ ANALİZ RAPORU');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Toplam market   : ${counts.markets} (${counts.resolved} resolve edildi)`);
  console.log(`  Snapshot sayısı : ${counts.snapshots.toLocaleString()}`);
  console.log(`  Paper trade     : ${counts.paper}`);
  console.log(`  Live trade      : ${counts.live}`);
  console.log(`  BTC fiyat tick  : ${counts.btc_ticks.toLocaleString()} (~${Math.round(counts.btc_ticks * 5 / 3600)} saat)`);
  console.log('══════════════════════════════════════════════════');
}

// ─────────────────────────────────────────────────────────────────
// Her trade için temel snapshot verisi
// ─────────────────────────────────────────────────────────────────
type TradeRow = {
  id: number;
  market_id: string;
  side: string;
  entry_price: number;
  entry_ts: number;
  outcome: string;
  duration_min: number;
  spread: number | null;
  bid_depth: number | null;
  ask_depth: number | null;
  elapsed_sec: number | null;
  source: 'paper' | 'live';
};

function loadTrades(): TradeRow[] {
  // Paper trades — en yakın snapshot ile birleştir
  const paper = db.prepare(`
    SELECT
      pt.id, pt.market_id, pt.side, pt.entry_price, pt.entry_ts,
      pt.outcome, m.duration_min,
      s.spread_up, s.spread_down,
      s.up_bid_depth, s.up_ask_depth,
      s.down_bid_depth, s.down_ask_depth,
      s.elapsed_sec,
      'paper' AS source
    FROM paper_trades pt
    JOIN markets m ON m.id = pt.market_id
    LEFT JOIN snapshots s ON s.market_id = pt.market_id
      AND s.ts = (
        SELECT MAX(ts) FROM snapshots
        WHERE market_id = pt.market_id AND ts <= pt.entry_ts + 10
      )
    WHERE pt.strategy = 'scalp'
      AND pt.outcome IN ('WIN', 'LOSS')
      AND pt.entry_price BETWEEN 0.88 AND 0.95
  `).all() as any[];

  // Live trades — aynı mantık
  const live = db.prepare(`
    SELECT
      lt.id, lt.market_id, lt.side, lt.entry_price, lt.entry_ts,
      lt.outcome, m.duration_min,
      s.spread_up, s.spread_down,
      s.up_bid_depth, s.up_ask_depth,
      s.down_bid_depth, s.down_ask_depth,
      s.elapsed_sec,
      'live' AS source
    FROM live_trades lt
    JOIN markets m ON m.id = lt.market_id
    LEFT JOIN snapshots s ON s.market_id = lt.market_id
      AND s.ts = (
        SELECT MAX(ts) FROM snapshots
        WHERE market_id = lt.market_id AND ts <= lt.entry_ts + 10
      )
    WHERE lt.outcome IN ('WIN', 'LOSS')
      AND lt.entry_price BETWEEN 0.88 AND 0.95
  `).all() as any[];

  return [...paper, ...live].map(r => ({
    id: r.id,
    market_id: r.market_id,
    side: r.side,
    entry_price: r.entry_price,
    entry_ts: r.entry_ts,
    outcome: r.outcome,
    duration_min: r.duration_min,
    spread: r.side === 'UP' ? r.spread_up : r.spread_down,
    bid_depth: r.side === 'UP' ? r.up_bid_depth : r.down_bid_depth,
    ask_depth: r.side === 'UP' ? r.up_ask_depth : r.down_ask_depth,
    elapsed_sec: r.elapsed_sec,
    source: r.source,
  }));
}

// ─────────────────────────────────────────────────────────────────
// Yardımcı: WR hesapla
// ─────────────────────────────────────────────────────────────────
function wr(trades: TradeRow[]): string {
  if (!trades.length) return '— (0)';
  const wins = trades.filter(t => t.outcome === 'WIN').length;
  return `%${((wins / trades.length) * 100).toFixed(1)} (${wins}W/${trades.length - wins}L)`;
}

function ev(trades: TradeRow[]): string {
  if (!trades.length) return '—';
  // Basit EV: (exit-entry) bazlı; settlement WR × 0.08 yaklaşımı
  const winRate = trades.filter(t => t.outcome === 'WIN').length / trades.length;
  const avgEntry = trades.reduce((s, t) => s + t.entry_price, 0) / trades.length;
  const avgWin  = (1.00 - avgEntry);
  const avgLoss = 0.06; // STOP_DIST
  const evVal   = winRate * avgWin - (1 - winRate) * avgLoss;
  return `$${(evVal * 6).toFixed(3)}/trade`; // 6 share baz alındı
}

// ─────────────────────────────────────────────────────────────────
// 1. SPREAD ANALİZİ
// ─────────────────────────────────────────────────────────────────
function analyzeSpread(trades: TradeRow[]): void {
  const withSpread = trades.filter(t => t.spread !== null && t.spread > 0);

  if (withSpread.length < 5) {
    console.log('\n[SPREAD] Yeterli spread verisi yok (snapshot join başarısız olabilir)');
    return;
  }

  // Bucket'lara ayır
  const buckets = [
    { label: '≤0.01', min: 0,    max: 0.011 },
    { label: '0.02',  min: 0.011, max: 0.025 },
    { label: '0.03',  min: 0.025, max: 0.035 },
    { label: '0.04',  min: 0.035, max: 0.045 },
    { label: '≥0.05', min: 0.045, max: 1.0   },
  ];

  const rows = buckets.map(b => {
    const group = withSpread.filter(t => t.spread! >= b.min && t.spread! < b.max);
    const avgSpread = group.length ? (group.reduce((s,t) => s + t.spread!, 0) / group.length).toFixed(3) : '—';
    return {
      'Spread Aralığı': b.label,
      'Trade Sayısı': group.length,
      'Ort. Spread': avgSpread,
      'Win Rate': wr(group),
      'EV/trade': ev(group),
    };
  });

  printTable('1. SPREAD FİLTRESİ — Spread Aralığına Göre Win Rate', rows);

  // Median spread
  const sorted = [...withSpread].sort((a, b) => a.spread! - b.spread!);
  const median = sorted[Math.floor(sorted.length / 2)].spread!;
  const low  = withSpread.filter(t => t.spread! <= median);
  const high = withSpread.filter(t => t.spread! > median);
  console.log(`  Median spread: ${median.toFixed(3)}`);
  console.log(`  Dar spread (≤${median.toFixed(3)}): ${wr(low)}`);
  console.log(`  Geniş spread (>${median.toFixed(3)}): ${wr(high)}`);

  // Depth imbalance
  const withDepth = trades.filter(t => t.bid_depth !== null && t.ask_depth !== null && (t.bid_depth! + t.ask_depth!) > 0);
  if (withDepth.length >= 5) {
    const imb = withDepth.map(t => ({
      ...t,
      imbalance: t.bid_depth! / (t.bid_depth! + t.ask_depth!),
    }));
    const strongBid = imb.filter(t => t.imbalance >= 0.65);
    const neutral   = imb.filter(t => t.imbalance >= 0.40 && t.imbalance < 0.65);
    const weakBid   = imb.filter(t => t.imbalance < 0.40);
    printTable('  DEPTH İMBALANCE — bid/(bid+ask)', [
      { 'Kategori': 'Güçlü bid (≥0.65)', 'Trade': strongBid.length, 'Win Rate': wr(strongBid) },
      { 'Kategori': 'Nötr (0.40-0.65)',  'Trade': neutral.length,   'Win Rate': wr(neutral)   },
      { 'Kategori': 'Zayıf bid (<0.40)', 'Trade': weakBid.length,   'Win Rate': wr(weakBid)   },
    ]);
  } else {
    console.log('  Depth imbalance verisi yetersiz.');
  }
}

// ─────────────────────────────────────────────────────────────────
// 2. VOLATİLİTE ANALİZİ
// ─────────────────────────────────────────────────────────────────
function calcVolatility(entryTs: number, windowSec = 300): number | null {
  const prices = (db.prepare(`
    SELECT price FROM btc_prices
    WHERE ts >= ? AND ts <= ?
    ORDER BY ts ASC
  `).all(entryTs - windowSec, entryTs) as { price: number }[]).map(r => r.price);

  if (prices.length < 10) return null;

  const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  const mean    = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100; // % cinsinden std dev
}

function analyzeVolatility(trades: TradeRow[]): void {
  console.log('\n  [VOLATİLİTE] BTC fiyat verileri işleniyor...');

  const enriched = trades.map(t => ({
    ...t,
    vol: calcVolatility(t.entry_ts, 300),
  })).filter(t => t.vol !== null);

  if (enriched.length < 5) {
    console.log('  Yeterli BTC fiyat verisi yok — btc_prices tablosu boş olabilir.');
    return;
  }

  const vols = enriched.map(t => t.vol!).sort((a, b) => a - b);
  const p25  = vols[Math.floor(vols.length * 0.25)];
  const p50  = vols[Math.floor(vols.length * 0.50)];
  const p75  = vols[Math.floor(vols.length * 0.75)];

  console.log(`  Volatilite dağılımı (${enriched.length} trade): p25=${p25.toFixed(4)}% p50=${p50.toFixed(4)}% p75=${p75.toFixed(4)}%`);

  const buckets = [
    { label: `Çok düşük (<${p25.toFixed(4)}%)`, group: enriched.filter(t => t.vol! < p25) },
    { label: `Düşük (${p25.toFixed(4)}-${p50.toFixed(4)}%)`, group: enriched.filter(t => t.vol! >= p25 && t.vol! < p50) },
    { label: `Orta (${p50.toFixed(4)}-${p75.toFixed(4)}%)`,  group: enriched.filter(t => t.vol! >= p50 && t.vol! < p75) },
    { label: `Yüksek (≥${p75.toFixed(4)}%)`,   group: enriched.filter(t => t.vol! >= p75) },
  ];

  printTable('2. VOLATİLİTE FİLTRESİ — BTC 5dk Realized Vol ile Win Rate', buckets.map(b => ({
    'Volatilite Seviyesi': b.label,
    'Trade': b.group.length,
    'Win Rate': wr(b.group),
    'EV/trade': ev(b.group),
    'Ort. Vol': b.group.length ? (b.group.reduce((s,t) => s + t.vol!, 0) / b.group.length).toFixed(5) + '%' : '—',
  })));

  // isLowVolatility eşiği (0.15) ile test
  const low15  = enriched.filter(t => t.vol! < 0.15);
  const high15 = enriched.filter(t => t.vol! >= 0.15);
  console.log(`  Mevcut eşik (vol<0.15%): ${wr(low15)} | Üstü: ${wr(high15)}`);
}

// ─────────────────────────────────────────────────────────────────
// 3. ZAMAN DİLİMİ ANALİZİ
// ─────────────────────────────────────────────────────────────────
function analyzeTimeOfDay(trades: TradeRow[]): void {
  // UTC saat dilimine göre grupla
  const enriched = trades.map(t => ({
    ...t,
    hour: new Date(t.entry_ts * 1000).getUTCHours(),
  }));

  // 6 saatlik session'lara böl
  const sessions = [
    { label: 'Asia     (00-06 UTC)', hours: [0,1,2,3,4,5] },
    { label: 'London   (06-10 UTC)', hours: [6,7,8,9] },
    { label: 'NY Open  (13-17 UTC)', hours: [13,14,15,16] },
    { label: 'NY Close (17-22 UTC)', hours: [17,18,19,20,21] },
    { label: 'Gece     (22-00 UTC)', hours: [22,23] },
    { label: 'Diğer    (10-13 UTC)', hours: [10,11,12] },
  ];

  printTable('3. ZAMAN DİLİMİ — Session Bazında Win Rate', sessions.map(s => {
    const group = enriched.filter(t => s.hours.includes(t.hour));
    return {
      'Session': s.label,
      'Trade': group.length,
      'Win Rate': wr(group),
      'EV/trade': ev(group),
    };
  }));

  // Saatlik granüler
  const hourlyRows = Array.from({ length: 24 }, (_, h) => {
    const group = enriched.filter(t => t.hour === h);
    if (!group.length) return null;
    return {
      'Saat (UTC)': `${String(h).padStart(2,'0')}:00`,
      'Trade': group.length,
      'Win Rate': wr(group),
    };
  }).filter(Boolean) as Record<string, any>[];

  if (hourlyRows.length > 0) {
    printTable('  SAATLIK DETAY', hourlyRows);
  }
}

// ─────────────────────────────────────────────────────────────────
// 4. BTC MOMENTUM ANALİZİ
// ─────────────────────────────────────────────────────────────────
function calcMomentum(entryTs: number, side: string, windowSec = 120): number | null {
  const now = (db.prepare(
    `SELECT price FROM btc_prices WHERE ts <= ? ORDER BY ts DESC LIMIT 1`,
  ).get(entryTs) as { price: number } | undefined)?.price;

  const before = (db.prepare(
    `SELECT price FROM btc_prices WHERE ts <= ? ORDER BY ts DESC LIMIT 1`,
  ).get(entryTs - windowSec) as { price: number } | undefined)?.price;

  if (!now || !before) return null;

  // momentum: BTC yüzdesi × yon
  // side=UP → pozitif momentum beklenen yönde
  const pct = (now - before) / before * 100;
  return side === 'UP' ? pct : -pct; // taraf bazında normalize
}

function analyzeMomentum(trades: TradeRow[]): void {
  console.log('\n  [MOMENTUM] BTC momentum hesaplanıyor...');

  const enriched = trades.map(t => ({
    ...t,
    momentum: calcMomentum(t.entry_ts, t.side, 120),
  })).filter(t => t.momentum !== null);

  if (enriched.length < 5) {
    console.log('  Yeterli BTC fiyat verisi yok.');
    return;
  }

  // Yön bazında
  const aligned  = enriched.filter(t => t.momentum! > 0);   // BTC sinyale uygun yönde
  const flat     = enriched.filter(t => t.momentum! === 0);
  const opposing = enriched.filter(t => t.momentum! < 0);   // BTC sinyale ters yönde

  printTable('4. BTC MOMENTUM (120s) — Yön Uyumu ile Win Rate', [
    { 'Momentum Durumu': 'Uyumlu  (BTC aynı yönde)', 'Trade': aligned.length,  'Win Rate': wr(aligned),  'EV/trade': ev(aligned)  },
    { 'Momentum Durumu': 'Flat    (BTC değişmedi)',   'Trade': flat.length,     'Win Rate': wr(flat),     'EV/trade': ev(flat)     },
    { 'Momentum Durumu': 'Ters    (BTC zıt yönde)',   'Trade': opposing.length, 'Win Rate': wr(opposing), 'EV/trade': ev(opposing) },
  ]);

  // Momentum büyüklüğüne göre
  const moms = enriched.map(t => t.momentum!).sort((a, b) => Math.abs(a) - Math.abs(b));
  const p50  = moms[Math.floor(moms.length / 2)];
  const strongAligned  = enriched.filter(t => t.momentum! > Math.abs(p50));
  const weakAligned    = enriched.filter(t => t.momentum! > 0 && t.momentum! <= Math.abs(p50));
  const weakOpposing   = enriched.filter(t => t.momentum! < 0 && t.momentum! >= -Math.abs(p50));
  const strongOpposing = enriched.filter(t => t.momentum! < -Math.abs(p50));

  printTable('  MOMENTUM GÜCÜ — |BTC değişim %| bazında', [
    { 'Kategori': `Güçlü uyumlu  (>${p50.toFixed(4)}%)`,  'Trade': strongAligned.length,  'Win Rate': wr(strongAligned)  },
    { 'Kategori': `Zayıf uyumlu  (0-${p50.toFixed(4)}%)`, 'Trade': weakAligned.length,    'Win Rate': wr(weakAligned)    },
    { 'Kategori': `Zayıf ters    (0-${p50.toFixed(4)}%)`, 'Trade': weakOpposing.length,   'Win Rate': wr(weakOpposing)   },
    { 'Kategori': `Güçlü ters    (>${p50.toFixed(4)}%)`,  'Trade': strongOpposing.length, 'Win Rate': wr(strongOpposing) },
  ]);

  // Farklı pencereler: 60s, 120s, 300s
  console.log('\n  PENCERE KARŞILAŞTIRMASI:');
  for (const win of [60, 120, 300]) {
    const e2 = trades.map(t => ({ ...t, m: calcMomentum(t.entry_ts, t.side, win) })).filter(t => t.m !== null);
    const al = e2.filter(t => t.m! > 0);
    const op = e2.filter(t => t.m! < 0);
    console.log(`  ${String(win).padStart(3)}s pencere: uyumlu ${wr(al).padEnd(20)} | ters ${wr(op)}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// 5. KOMBİNASYON: En İyi Filtre Seti
// ─────────────────────────────────────────────────────────────────
function analyzeCombined(trades: TradeRow[]): void {
  console.log('\n  [KOMBİNASYON] Filtreler birleştiriliyor...');

  const enriched = trades.map(t => {
    const vol = calcVolatility(t.entry_ts, 300);
    const mom = calcMomentum(t.entry_ts, t.side, 120);
    const hour = new Date(t.entry_ts * 1000).getUTCHours();
    return { ...t, vol, mom, hour };
  });

  // Tüm veri mevcut olanlar
  const full = enriched.filter(t => t.vol !== null && t.mom !== null && t.spread !== null);

  if (full.length < 5) {
    console.log('  Yeterli veri yok kombinasyon analizi için.');
    return;
  }

  // Senaryo A: Sadece momentum uyumu
  const momOk  = full.filter(t => t.mom! > 0);
  // Senaryo B: Sadece düşük volatilite
  const volOk  = full.filter(t => t.vol! < 0.15);
  // Senaryo C: Dar spread
  const sprOk  = full.filter(t => t.spread !== null && t.spread! <= 0.02);
  // Senaryo D: Momentum + Düşük Vol
  const momVol = full.filter(t => t.mom! > 0 && t.vol! < 0.15);
  // Senaryo E: Momentum + Dar Spread
  const momSpr = full.filter(t => t.mom! > 0 && t.spread! <= 0.02);
  // Senaryo F: Üçlü filtre
  const triple = full.filter(t => t.mom! > 0 && t.vol! < 0.15 && t.spread! <= 0.02);
  // Tüm veriler (baseline)
  const base   = full;

  printTable('5. KOMBİNASYON ANALİZİ', [
    { 'Senaryo': 'Baseline (filtre yok)',        'Trade': base.length,   'Win Rate': wr(base),   'EV/trade': ev(base)   },
    { 'Senaryo': 'Sadece momentum uyumu',         'Trade': momOk.length,  'Win Rate': wr(momOk),  'EV/trade': ev(momOk)  },
    { 'Senaryo': 'Sadece düşük vol (<0.15%)',     'Trade': volOk.length,  'Win Rate': wr(volOk),  'EV/trade': ev(volOk)  },
    { 'Senaryo': 'Sadece dar spread (≤0.02)',     'Trade': sprOk.length,  'Win Rate': wr(sprOk),  'EV/trade': ev(sprOk)  },
    { 'Senaryo': 'Momentum + düşük vol',          'Trade': momVol.length, 'Win Rate': wr(momVol), 'EV/trade': ev(momVol) },
    { 'Senaryo': 'Momentum + dar spread',         'Trade': momSpr.length, 'Win Rate': wr(momSpr), 'EV/trade': ev(momSpr) },
    { 'Senaryo': 'Üçlü filtre (mom+vol+spread)',  'Trade': triple.length, 'Win Rate': wr(triple), 'EV/trade': ev(triple) },
  ]);

  console.log('\n  NOT: Trade sayısı düşükse filtre çok kısıtlayıcı demektir.');
  console.log('  Hedef: Trade sayısı makul kalırken WR anlamlı iyileşmeli.');
}

// ─────────────────────────────────────────────────────────────────
// ANA ÇALIŞTIRICI
// ─────────────────────────────────────────────────────────────────
function main(): void {
  overview();

  const trades = loadTrades();
  console.log(`\n  Analiz için yüklenen trade: ${trades.length} (paper + live, WIN+LOSS)`);
  console.log(`  Kaynak dağılımı: ${trades.filter(t => t.source === 'paper').length} paper | ${trades.filter(t => t.source === 'live').length} live`);

  if (trades.length < 10) {
    console.log('\n  UYARI: Trade sayısı çok az (< 10). Sonuçlar istatistiksel anlam taşımayabilir.');
    console.log('  Minimum güvenilir analiz için 100+ trade önerilir.');
  }

  analyzeSpread(trades);
  analyzeVolatility(trades);
  analyzeTimeOfDay(trades);
  analyzeMomentum(trades);
  analyzeCombined(trades);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  ANALİZ TAMAMLANDI');
  console.log('══════════════════════════════════════════════════\n');
  db.close();
}

main();
