/**
 * BTC 15dk Hourly Momentum Strategy — Monte Carlo Backtest
 *
 * Strateji:
 *   Her 15dk markete 0.40 GTC limit BUY emri koy.
 *   Saatlik ortalama (son 4 market = 60dk) referansına göre yönü seç:
 *     - currPrice > avg → UP token alacağız
 *     - currPrice < avg → DOWN token alacağız
 *   Fill olursa 0.99'da auto-sell.
 *
 * Model parametreleri:
 *   BTC fiyat süreci: GBM + mild mean reversion (AR1 β=-0.05)
 *   15dk vol (σ_15m): %0.45 (yaklaşık $300/15dk @ $66k)
 *   Saatlik (1h) σ:  %0.90 (4× 15dk birikim ama korelasyon nedeniyle <2x)
 *   Drift: günlük ~0 (kısa vadede)
 *
 * Token fiyat modeli:
 *   pUP(t) = N( BS-benzeri prob | path-so-far, σ_remaining )
 *   t=0'da pUP = 0.50 (assume symmetric)
 *   t=T'de pUP ∈ {0,1} (resolve)
 *   Aradaki path: Brownian bridge benzeri
 */

const N_DAYS    = 365;          // 1 yıl simülasyon
const MARKETS_PER_DAY = 96;     // 24h × 4
const N_MARKETS = N_DAYS * MARKETS_PER_DAY;
const MARKET_DUR_S = 900;       // 15 dakika
const STEP_S = 60;              // 1dk granülerlik (15 step/market)

// Strateji parametreleri
const BUY_PRICE  = 0.40;
const SELL_PRICE = 0.99;
const SHARES     = 6;
const COST       = BUY_PRICE * SHARES;            // $2.40
const WIN_PNL    = (SELL_PRICE - BUY_PRICE) * SHARES; // $3.54
const LOSS_PNL   = -COST;                          // -$2.40

// BTC model
const PRICE0     = 66000;
const SIGMA_15M  = 0.0045;      // %0.45 — gerçekçi 2025-2026 BTC vol
const DRIFT      = 0.0;         // kısa vadeli drift sıfır kabul
const AR1_BETA   = -0.05;       // hafif mean reversion (gözlemlenen)

// RNG — deterministik tohum
let _seed = 42;
function rand() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 0x100000000;
}
function randn() {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
}

/**
 * BTC fiyat serisi üret (1dk granül)
 * AR(1): r_t = β * r_{t-1} + ε_t,  ε_t ~ N(0, σ²)
 * Toplam dakika sayısı: N_MARKETS * 15
 */
function generateBtcPath() {
  const totalSteps = N_MARKETS * 15;  // 1dk step
  const sigma1m    = SIGMA_15M / Math.sqrt(15);  // 1dk vol
  const prices     = new Float64Array(totalSteps + 1);
  prices[0] = PRICE0;
  let prevRet = 0;
  for (let i = 1; i <= totalSteps; i++) {
    const eps = randn() * sigma1m;
    const ret = AR1_BETA * prevRet + eps;
    prices[i] = prices[i-1] * (1 + ret);
    prevRet = ret;
  }
  return prices;
}

/**
 * Her market için: open, close, outcome (UP/DOWN), saatlik ref (son 60dk avg)
 */
function buildMarkets(btcPath) {
  const markets = [];
  for (let m = 0; m < N_MARKETS; m++) {
    const startStep = m * 15;
    const endStep   = startStep + 15;
    const openPx    = btcPath[startStep];
    const closePx   = btcPath[endStep];
    const outcome   = closePx > openPx ? 'UP' : 'DOWN';

    // Saatlik ortalama: önceki 60dk (4 market × 15dk) fiyat ortalaması
    let hourAvg = openPx;
    if (startStep >= 60) {
      let sum = 0;
      for (let k = startStep - 60; k < startStep; k++) sum += btcPath[k];
      hourAvg = sum / 60;
    }

    const change1h = (openPx - hourAvg) / hourAvg;  // şu an avg'nin ne kadar üstünde

    // 15dk intramarket path (1dk granül)
    const path = [];
    for (let k = startStep; k <= endStep; k++) path.push(btcPath[k]);

    // Token fiyat yörüngesi: Brownian bridge-vari approx
    // pUP(t) = Φ( (path[t] - implied_threshold) / σ_remaining )
    // Basitleştirme: pUP(t) ≈ 0.5 + 0.5 * sign(path[t]-openPx) * (1 - sqrt(rem/total))
    // Daha iyi: gerçek "kazanma olasılığı" = Φ( (path[t] - openPx) / (σ_remaining × path[t]) )
    const tokenPath = [];
    for (let t = 0; t < path.length; t++) {
      const remMin = 15 - t;
      if (remMin <= 0) {
        tokenPath.push(outcome === 'UP' ? 1 : 0);
        continue;
      }
      const driftSoFar = (path[t] - openPx) / openPx;
      const sigmaRem   = SIGMA_15M * Math.sqrt(remMin / 15);
      // z = driftSoFar / sigmaRem
      const z = driftSoFar / Math.max(sigmaRem, 1e-6);
      // Φ(z) yaklaşımı (erf)
      const pUP = 0.5 * (1 + erf(z / Math.SQRT2));
      tokenPath.push(pUP);
    }

    markets.push({
      idx: m,
      openPx, closePx, outcome,
      hourAvg, change1h,
      hourUtc: Math.floor((m * 15 / 60)) % 24,
      dayIdx:  Math.floor(m / MARKETS_PER_DAY),
      tokenPath,   // pUP[0..15], pDOWN = 1 - pUP
    });
  }
  return markets;
}

function erf(x) {
  // Abramowitz/Stegun erf approximation
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p*x);
  const y = 1.0 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * Math.exp(-x*x);
  return sign * y;
}

/**
 * Bir markette belirli token (UP veya DOWN) için fill simülasyonu:
 *   GTC limit BUY @ 0.40
 *   t=0..15 arası fiyat 0.40'a dokunuyor mu?
 *   Maker order için: token fiyatı <= 0.40 olunca fill olur (basitleştirme)
 *
 *   Returns: { filled: bool, fillTime: int|null, finalOutcome: 'WIN'|'LOSS' }
 */
function simulateFill(market, side /* 'UP'|'DOWN' */, entryStartMin = 0) {
  const path = side === 'UP'
    ? market.tokenPath
    : market.tokenPath.map(p => 1 - p);

  for (let t = entryStartMin; t < path.length; t++) {
    if (path[t] <= BUY_PRICE) {
      // Fill oldu
      const won = side === market.outcome;
      return { filled: true, fillTime: t, won };
    }
  }
  return { filled: false, fillTime: null, won: false };
}

// ============== SCENARIOS ==============

function runScenario(markets, config) {
  const stats = {
    name: config.name,
    signals: 0,
    fills: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
    pnlSeries: [],
    fillsByHour: Array(24).fill(0),
    winsByHour: Array(24).fill(0),
    pnlByHour: Array(24).fill(0),
    fillTimes: [],
  };

  for (const m of markets) {
    let side = null;
    if (config.strategy === 'hourly_momentum') {
      // currPrice > hourAvg ise UP'a, < ise DOWN'a
      if (Math.abs(m.change1h) < (config.minSignal || 0)) continue;
      side = m.change1h > 0 ? 'UP' : 'DOWN';
    } else if (config.strategy === 'hourly_contrarian') {
      // Tersi: yukarıdaysa DOWN al (mean reversion)
      if (Math.abs(m.change1h) < (config.minSignal || 0)) continue;
      side = m.change1h > 0 ? 'DOWN' : 'UP';
    } else if (config.strategy === 'every_market_up') {
      side = 'UP';
    } else if (config.strategy === 'every_market_down') {
      side = 'DOWN';
    } else if (config.strategy === 'blind_alternating') {
      side = m.idx % 2 === 0 ? 'UP' : 'DOWN';
    } else if (config.strategy === 'both_sides') {
      // Her markete HEM up HEM down emir koy (ayrı simulate et)
      const upRes   = simulateFill(m, 'UP');
      const downRes = simulateFill(m, 'DOWN');
      if (upRes.filled) {
        stats.signals++; stats.fills++;
        if (upRes.won) { stats.wins++; stats.pnl += WIN_PNL; }
        else           { stats.losses++; stats.pnl += LOSS_PNL; }
      }
      if (downRes.filled) {
        stats.signals++; stats.fills++;
        if (downRes.won) { stats.wins++; stats.pnl += WIN_PNL; }
        else             { stats.losses++; stats.pnl += LOSS_PNL; }
      }
      stats.pnlSeries.push(stats.pnl);
      continue;
    }
    if (!side) continue;

    // Hour filter
    if (config.hourMin !== undefined && m.hourUtc < config.hourMin) continue;
    if (config.hourMax !== undefined && m.hourUtc > config.hourMax) continue;

    stats.signals++;
    const res = simulateFill(m, side, config.entryStartMin || 0);
    if (res.filled) {
      stats.fills++;
      stats.fillsByHour[m.hourUtc]++;
      stats.fillTimes.push(res.fillTime);
      if (res.won) {
        stats.wins++;
        stats.pnl += WIN_PNL;
        stats.winsByHour[m.hourUtc]++;
        stats.pnlByHour[m.hourUtc] += WIN_PNL;
      } else {
        stats.losses++;
        stats.pnl += LOSS_PNL;
        stats.pnlByHour[m.hourUtc] += LOSS_PNL;
      }
    }
    stats.pnlSeries.push(stats.pnl);
  }

  stats.fillRate = stats.signals > 0 ? stats.fills / stats.signals : 0;
  stats.wr       = stats.fills > 0 ? stats.wins / stats.fills : 0;
  stats.evPerFill   = stats.fills > 0 ? stats.pnl / stats.fills : 0;
  stats.evPerSignal = stats.signals > 0 ? stats.pnl / stats.signals : 0;
  stats.dailyPnl    = stats.pnl / N_DAYS;
  stats.monthlyPnl  = stats.dailyPnl * 30;
  stats.avgFillTime = stats.fillTimes.length > 0
    ? stats.fillTimes.reduce((a,b)=>a+b,0) / stats.fillTimes.length
    : 0;

  // Max drawdown
  let peak = 0, dd = 0;
  for (const p of stats.pnlSeries) {
    if (p > peak) peak = p;
    const curDD = peak - p;
    if (curDD > dd) dd = curDD;
  }
  stats.maxDD = dd;

  // Sharpe (per-trade)
  const trades = [];
  let last = 0;
  for (const p of stats.pnlSeries) {
    if (p !== last) trades.push(p - last);
    last = p;
  }
  if (trades.length > 1) {
    const mean = trades.reduce((a,b)=>a+b,0) / trades.length;
    const variance = trades.reduce((a,b)=>a+(b-mean)*(b-mean),0) / trades.length;
    stats.sharpe = variance > 0 ? mean / Math.sqrt(variance) * Math.sqrt(96 * 365) : 0;
  } else {
    stats.sharpe = 0;
  }

  return stats;
}

// ============== MAIN ==============

console.log('═══════════════════════════════════════════════════════════════');
console.log('BTC 15dk Hourly Momentum Backtest — Monte Carlo Simulation');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Days simulated:    ${N_DAYS}`);
console.log(`Markets/day:       ${MARKETS_PER_DAY}`);
console.log(`Total markets:     ${N_MARKETS.toLocaleString()}`);
console.log(`BTC σ_15m:         ${(SIGMA_15M*100).toFixed(3)}%`);
console.log(`BTC initial:       $${PRICE0.toLocaleString()}`);
console.log(`AR(1) β:           ${AR1_BETA}`);
console.log(`Strategy:          BUY 6sh @ $${BUY_PRICE} → SELL @ $${SELL_PRICE}`);
console.log(`Break-even WR:     ${(COST/(WIN_PNL+COST)*100).toFixed(1)}%`);
console.log('');

console.log('Generating BTC price path... (might take 10-30s)');
const t0 = Date.now();
const btcPath = generateBtcPath();
console.log(`  ✓ Path generated in ${((Date.now()-t0)/1000).toFixed(1)}s`);
console.log(`  ✓ Start: $${btcPath[0].toFixed(0)}  End: $${btcPath[btcPath.length-1].toFixed(0)}`);

console.log('Building market resolutions...');
const t1 = Date.now();
const markets = buildMarkets(btcPath);
console.log(`  ✓ Markets built in ${((Date.now()-t1)/1000).toFixed(1)}s`);
const upCnt = markets.filter(m=>m.outcome==='UP').length;
console.log(`  ✓ Distribution: UP=${upCnt} (${(upCnt/markets.length*100).toFixed(1)}%) DOWN=${markets.length-upCnt}`);

// Saatlik momentum gücü dağılımı
const c1h = markets.map(m=>m.change1h);
const c1hAbs = c1h.map(Math.abs).sort((a,b)=>a-b);
console.log(`  ✓ |change1h| dist: p50=${(c1hAbs[Math.floor(c1hAbs.length*0.5)]*100).toFixed(3)}% p90=${(c1hAbs[Math.floor(c1hAbs.length*0.9)]*100).toFixed(3)}%`);

// Sanity check: change1h > 0 olan marketlerde UP outcome %'si
let posChangeUpRate = 0, posChangeCount = 0;
let negChangeUpRate = 0, negChangeCount = 0;
for (const m of markets) {
  if (m.change1h > 0) { posChangeCount++; if (m.outcome === 'UP') posChangeUpRate++; }
  else if (m.change1h < 0) { negChangeCount++; if (m.outcome === 'UP') negChangeUpRate++; }
}
console.log(`  ✓ change1h>0 → UP rate: ${(posChangeUpRate/posChangeCount*100).toFixed(2)}% (n=${posChangeCount})`);
console.log(`  ✓ change1h<0 → UP rate: ${(negChangeUpRate/negChangeCount*100).toFixed(2)}% (n=${negChangeCount})`);

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('SCENARIO RESULTS');
console.log('═══════════════════════════════════════════════════════════════');

const scenarios = [
  { name: 'A. Pure hourly momentum (signal>0)', strategy: 'hourly_momentum', minSignal: 0 },
  { name: 'B. Strong momentum (|chg1h|>0.1%)',  strategy: 'hourly_momentum', minSignal: 0.001 },
  { name: 'C. Very strong (|chg1h|>0.3%)',      strategy: 'hourly_momentum', minSignal: 0.003 },
  { name: 'D. Extreme (|chg1h|>0.5%)',          strategy: 'hourly_momentum', minSignal: 0.005 },
  { name: 'E. Hourly CONTRARIAN (mean rev)',    strategy: 'hourly_contrarian', minSignal: 0 },
  { name: 'F. Every market → UP token',         strategy: 'every_market_up' },
  { name: 'G. Every market → DOWN token',       strategy: 'every_market_down' },
  { name: 'H. Blind alternating',               strategy: 'blind_alternating' },
  { name: 'I. BOTH sides every market',         strategy: 'both_sides' },
];

const results = scenarios.map(s => runScenario(markets, s));

console.log('');
console.log('Strategy                              | Sig    | Fill% | WR%    | EV/fill | EV/sig  | Daily$  | MaxDD');
console.log('--------------------------------------|--------|-------|--------|---------|---------|---------|--------');
for (const r of results) {
  const sig = r.signals.toString().padStart(6);
  const fr  = (r.fillRate*100).toFixed(1).padStart(5);
  const wr  = (r.wr*100).toFixed(2).padStart(6);
  const evf = ('$' + r.evPerFill.toFixed(3)).padStart(7);
  const evs = ('$' + r.evPerSignal.toFixed(3)).padStart(7);
  const dly = ('$' + r.dailyPnl.toFixed(2)).padStart(7);
  const dd  = ('$' + r.maxDD.toFixed(0)).padStart(6);
  console.log(`${r.name.padEnd(38)} | ${sig} | ${fr} | ${wr} | ${evf} | ${evs} | ${dly} | ${dd}`);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('HOUR-OF-DAY SEGMENTATION (Strategy A: hourly_momentum)');
console.log('═══════════════════════════════════════════════════════════════');
const sA = results[0];
console.log('UTC  | Fills | Wins | WR%   | Net$');
console.log('-----|-------|------|-------|-------');
for (let h = 0; h < 24; h++) {
  const f = sA.fillsByHour[h];
  const w = sA.winsByHour[h];
  const wr = f > 0 ? (w/f*100).toFixed(1) : '-';
  const p  = sA.pnlByHour[h];
  console.log(`${h.toString().padStart(2,'0')}   | ${f.toString().padStart(5)} | ${w.toString().padStart(4)} | ${wr.toString().padStart(5)} | $${p.toFixed(1)}`);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('FILL TIMING DISTRIBUTION (Strategy A)');
console.log('═══════════════════════════════════════════════════════════════');
const ftHist = Array(16).fill(0);
for (const t of sA.fillTimes) ftHist[t]++;
for (let t = 0; t < 16; t++) {
  if (ftHist[t] > 0) {
    const pct = (ftHist[t] / sA.fillTimes.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor(ftHist[t] / sA.fillTimes.length * 100));
    console.log(`t=${t.toString().padStart(2,'0')}min | ${pct.padStart(4)}% ${bar}`);
  }
}
console.log(`Avg fill time: ${sA.avgFillTime.toFixed(2)} min`);

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('RECOMMENDATIONS');
console.log('═══════════════════════════════════════════════════════════════');

// Find best scenario by EV per signal (rate-of-return basis)
const ranked = [...results].sort((a,b) => b.evPerSignal - a.evPerSignal);
console.log('\nBy EV/signal (capital efficiency):');
for (let i = 0; i < Math.min(3, ranked.length); i++) {
  const r = ranked[i];
  console.log(`  ${i+1}. ${r.name}: EV/signal=$${r.evPerSignal.toFixed(4)} | Daily=$${r.dailyPnl.toFixed(2)}`);
}

const rankedByPnl = [...results].sort((a,b) => b.pnl - a.pnl);
console.log('\nBy total P&L (absolute return):');
for (let i = 0; i < Math.min(3, rankedByPnl.length); i++) {
  const r = rankedByPnl[i];
  console.log(`  ${i+1}. ${r.name}: Total=$${r.pnl.toFixed(0)} | Daily=$${r.dailyPnl.toFixed(2)} | MaxDD=$${r.maxDD.toFixed(0)}`);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('CRITICAL CAVEATS');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`
1. Monte Carlo model assumes:
   - GBM with mild AR(1) mean reversion (β=${AR1_BETA})
   - Token price = Φ((drift_so_far)/σ_remaining) — BS-style fair value
   - Maker fills at any touch of 0.40 (no queue priority issues)
2. Real markets have:
   - Adverse selection: 0.40 fills are NOT random; token dipped because price moved opposite
   - Spread/depth: limit at 0.40 may not be top of book
   - Fees: Polymarket maker rebate ~0% on BTC; no negRisk discount
   - Settlement risk: oracle delay between bot fill and resolution
3. CRITICAL: The "fair value at touch" assumption is conservative.
   Real WR for 0.40 limits typically falls 2-5 points below model WR
   because the order only fills when the market moves against you.
   (Selection bias — see hourly-avg-strategy-analysis.md table.)

CONCLUSION: Adjust simulated WR DOWN by 3-5 percentage points for
realistic expected return.
`);
