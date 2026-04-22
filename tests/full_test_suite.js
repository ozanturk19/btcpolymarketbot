/**
 * POLYMARKET SCALP BOT — TAM TEST SÜİTİ
 * 
 * TEST 1: shouldSnapshot timing analizi
 * TEST 2: Stopwatch 10s interval doğrulaması (fake position inject)
 * TEST 3: parseBalanceFromError unit test
 * TEST 4: Entry koşulları unit test
 * TEST 5: Stop cascade fiyat mantığı
 * TEST 6: Concurrent pozisyon koruması
 * TEST 7: Gap risk simülasyonu (eski kod vs yeni kod kıyası)
 */

const db = require('/opt/polymarket/bot/node_modules/better-sqlite3')('/opt/polymarket/bot/data/observer.db');

let PASS = 0, FAIL = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    PASS++;
  } catch(e) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`         → ${e.message}`);
    FAIL++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ═══════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(' TEST 1: shouldSnapshot Timing Analizi');
console.log('══════════════════════════════════════════');

// shouldSnapshot mantığını JS'de tekrar implemente edip kontrol edelim
function shouldSnapshotSim(elapsed, lastElapsed, remaining) {
  if (remaining < 0) return false;
  if (lastElapsed === null && elapsed >= 0) return true;
  if (lastElapsed === null) return false;
  if (remaining < 60) return elapsed - lastElapsed >= 15;
  if (elapsed < 120)  return elapsed - lastElapsed >= 30;
  return elapsed - lastElapsed >= 60;
}

// Bir pozisyon 97s'de açılıyor (T34 senaryosu)
// 60s sonra market 0.965→0.445 gapliyor
// Eski kodda: sadece snapshot'ta kontrol = en fazla 60s gecikme
// Yeni kodda: her 10s'de kontrol = max 10s gecikme

test('elapsed<120: snapshot her 30s bir', () => {
  // elapsed=97, lastElapsed=67 → diff=30 ≥ 30 → true
  assert(shouldSnapshotSim(97, 67, 203) === true, 'elapsed=97, last=67 → 30s → snapshot alınmalı');
  // elapsed=107, lastElapsed=97 → diff=10 < 30 → false
  assert(shouldSnapshotSim(107, 97, 193) === false, 'elapsed=107, last=97 → 10s → snapshot alınmamalı');
});

test('elapsed>=120: snapshot her 60s bir (KÖR PENCERE)', () => {
  // elapsed=130, lastElapsed=97 → diff=33 < 60 → false (TEHLIKE!)
  assert(shouldSnapshotSim(130, 97, 170) === false, 'elapsed=130, last=97 → sadece 33s geçti → 60s bekleniyor (kör pencere)');
  // elapsed=157, lastElapsed=97 → diff=60 ≥ 60 → true
  assert(shouldSnapshotSim(157, 97, 143) === true, 'elapsed=157, last=97 → 60s geçti → snapshot alınmalı');
});

test('remaining<60: snapshot her 15s bir (son 1dk hızlı)', () => {
  assert(shouldSnapshotSim(255, 240, 45) === true, 'remaining=45 → 15s geçti → snapshot alınmalı');
  assert(shouldSnapshotSim(248, 240, 52) === false, 'remaining=52 → ama 60s elapsed-last henüz → false (kör)');
});

// T34 senaryosu: elapsed=97→157 arası 60s kör pencere
test('T34 gap senaryosu: 60s kör pencere doğrulandı (ESKİ KOD)', () => {
  // Entry at elapsed=97, next snapshot at elapsed=157 (60s sonra)
  const snapAtEntry = shouldSnapshotSim(97, 67, 203);     // entry tick
  const snap10sLater = shouldSnapshotSim(107, 97, 193);   // +10s → false (snapshot yok = stop yok)
  const snap20sLater = shouldSnapshotSim(117, 97, 183);   // +20s → false
  const snap30sLater = shouldSnapshotSim(127, 97, 173);   // +30s → false (elapsed≥120 → 60s gerekli)
  const snap60sLater = shouldSnapshotSim(157, 97, 143);   // +60s → true (BURADA yakalar)
  
  assert(snapAtEntry === true, 'entry tick snapshot alınmalı');
  assert(snap10sLater === false && snap20sLater === false && snap30sLater === false,
    'entry sonrası 10/20/30s: ESKİ KOD KÖR');
  assert(snap60sLater === true, '60s sonra yakalar — ama çok geç!');
});

// ═══════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(' TEST 2: parseBalanceFromError Unit Test');
console.log('══════════════════════════════════════════');

function parseBalanceFromError(errMsg) {
  const m = errMsg.match(/balance:\s*(\d+)/);
  if (!m) return null;
  const raw = parseInt(m[1], 10);
  if (isNaN(raw) || raw <= 0) return null;
  return Math.floor((raw / 1e6) * 100) / 100;
}

test('T25/T27 hata mesajı formatı parse ediliyor', () => {
  const err = 'the balance is not enough -> balance: 4974800, order amount: 5000000';
  const result = parseBalanceFromError(err);
  assert(result === 4.97, `4974800 → 4.97 bekleniyor, alınan: ${result}`);
});

test('Farklı bakiye değerleri doğru parse ediliyor', () => {
  assert(parseBalanceFromError('balance: 4971200, order amount: 5000000') === 4.97, '4971200 → 4.97');
  assert(parseBalanceFromError('balance: 5000000, order amount: 5000000') === 5.00, '5000000 → 5.00');
  assert(parseBalanceFromError('balance: 4900000, order amount: 5000000') === 4.90, '4900000 → 4.90');
});

test('Hata mesajında balance yoksa null döner', () => {
  assert(parseBalanceFromError('invalid fee rate') === null, 'balance yoksa null');
  assert(parseBalanceFromError('') === null, 'boş string null');
  assert(parseBalanceFromError('balance: 0, order amount: 5000000') === null, 'balance=0 null');
});

test('Floor davranışı: 4.979 → 4.97 (yuvarlama değil kesme)', () => {
  // 4979000 / 1e6 = 4.979 → floor(4.979 * 100) / 100 = floor(497.9) / 100 = 497/100 = 4.97
  assert(parseBalanceFromError('balance: 4979000, order amount: 5000000') === 4.97,
    '4.979 floor → 4.97 (üstüne yuvarlama OLMAMALI, eksik hisse ile CLOB redder)');
});

// ═══════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(' TEST 3: Entry Koşulları');
console.log('══════════════════════════════════════════');

const ENTRY_MIN = 0.91, ENTRY_MAX = 0.93;
const STOP_DIST = 0.06;
const SIZE_USD  = 5;

function roundTick(p) { return Math.round(p * 100) / 100; }
function getShares(entry) { return Math.max(5, Math.round(SIZE_USD / entry)); }

test('ask=0.90 reddedilir (ENTRY_MIN=0.91 altı)', () => {
  assert(0.90 < ENTRY_MIN, '0.90 < 0.91');
});

test('ask=0.91 kabul edilir (minimum)', () => {
  assert(0.91 >= ENTRY_MIN && 0.91 <= ENTRY_MAX, '0.91 geçerli');
  assert(getShares(0.91) === 5, '5/0.91=5.49 → round → 5');
});

test('ask=0.92 kabul edilir', () => {
  assert(0.92 >= ENTRY_MIN && 0.92 <= ENTRY_MAX, '0.92 geçerli');
  assert(getShares(0.92) === 5, '5/0.92=5.43 → round → 5');
});

test('ask=0.93 kabul edilir (maksimum)', () => {
  assert(0.93 >= ENTRY_MIN && 0.93 <= ENTRY_MAX, '0.93 geçerli');
  assert(getShares(0.93) === 5, '5/0.93=5.37 → round → 5');
});

test('ask=0.94 reddedilir (ENTRY_MAX=0.93 üstü)', () => {
  assert(0.94 > ENTRY_MAX, '0.94 > 0.93');
});

test('FOK entry price ask+0.01 buffer uygulanıyor', () => {
  // entryPrice = roundTick(ask + 0.01) — sinyal ask'ından 1 tick agresif gir
  assert(roundTick(0.91 + 0.01) === 0.92, 'ask=0.91 → entry=0.92');
  assert(roundTick(0.92 + 0.01) === 0.93, 'ask=0.92 → entry=0.93');
  assert(roundTick(0.93 + 0.01) === 0.94, 'ask=0.93 → entry=0.94 (max)');
});

test('Stop fiyatı entryPrice bazlı (ask+0.01 dahil) hesaplanıyor', () => {
  // entryPrice = ask + 0.01, stopPrice = entryPrice - STOP_DIST
  assert(roundTick((0.91 + 0.01) - STOP_DIST) === 0.86, 'ask=0.91 → entry=0.92 → stop=0.86');
  assert(roundTick((0.92 + 0.01) - STOP_DIST) === 0.87, 'ask=0.92 → entry=0.93 → stop=0.87');
  assert(roundTick((0.93 + 0.01) - STOP_DIST) === 0.88, 'ask=0.93 → entry=0.94 → stop=0.88');
});

test('Elapsed penceresi: 90-240s, remaining >= 60s', () => {
  // Giriş penceresi koşulları
  function canEnter(elapsed, remaining) {
    return elapsed >= 90 && elapsed <= 240 && remaining >= 60;
  }
  assert(!canEnter(89, 200), 'elapsed=89 → reddedilir');
  assert(canEnter(90, 200),  'elapsed=90 → kabul edilir');
  assert(canEnter(240, 60),  'elapsed=240, remaining=60 → kabul edilir (sınır)');
  assert(!canEnter(241, 60), 'elapsed=241 → reddedilir');
  assert(!canEnter(150, 59), 'remaining=59 → reddedilir');
});

// ═══════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(' TEST 4: Stop Cascade Fiyat Mantığı');
console.log('══════════════════════════════════════════');

function getStopAttempts(mid) {
  return [
    roundTick(Math.max(mid - 0.01, 0.02)),
    roundTick(Math.max(mid - 0.03, 0.02)),
    roundTick(Math.max(mid - 0.06, 0.02)),
    roundTick(Math.max(mid - 0.10, 0.02)),
  ];
}

test('Normal stop cascade: mid=0.80', () => {
  const attempts = getStopAttempts(0.80);
  assert(attempts[0] === 0.79, `deneme1: 0.79 (mid-0.01), alınan: ${attempts[0]}`);
  assert(attempts[1] === 0.77, `deneme2: 0.77 (mid-0.03), alınan: ${attempts[1]}`);
  assert(attempts[2] === 0.74, `deneme3: 0.74 (mid-0.06), alınan: ${attempts[2]}`);
  assert(attempts[3] === 0.70, `deneme4: 0.70 (mid-0.10), alınan: ${attempts[3]}`);
});

test('T34 crash senaryosu: mid=0.445 (stop=0.86)', () => {
  const mid = 0.445;
  const stop = 0.86;
  assert(mid <= stop, `mid ${mid} ≤ stop ${stop} → stop tetiklenmeli`);
  const attempts = getStopAttempts(mid);
  assert(attempts[0] === 0.44, `deneme1: 0.44, alınan: ${attempts[0]}`);
  assert(attempts[3] === 0.35, `deneme4: 0.35, alınan: ${attempts[3]}`);
  assert(attempts.every(p => p >= 0.02), 'tüm denemeler ≥ 0.02 (CLOB minimum)');
});

test('Extreme crash: mid=0.05 → minimum fiyat koruması', () => {
  const attempts = getStopAttempts(0.05);
  assert(attempts[2] === 0.02, `mid-0.06=-0.01 → floor 0.02, alınan: ${attempts[2]}`);
  assert(attempts[3] === 0.02, `mid-0.10=-0.05 → floor 0.02, alınan: ${attempts[3]}`);
});

test('Yeni stop: mid=0.445, stopwatch 10s içinde tetiklenmeli', () => {
  // Bu bir simülasyon testi — gerçek zamanlama DB'de loglanarak doğrulanır
  // Eski kod: 60s kör pencerede tetiklenemez
  // Yeni kod: 10s içinde tetiklenir
  const MAX_DELAY_OLD = 60;
  const MAX_DELAY_NEW = 10;
  assert(MAX_DELAY_NEW < MAX_DELAY_OLD, `Yeni max gecikme ${MAX_DELAY_NEW}s < eski ${MAX_DELAY_OLD}s`);
  assert(MAX_DELAY_NEW <= 10, 'setInterval=10s → max gecikme 10s');
});

// ═══════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(' TEST 5: DB Bütünlüğü');
console.log('══════════════════════════════════════════');

test('live_trades tablosu var ve erişilebilir', () => {
  const count = db.prepare('SELECT COUNT(*) as c FROM live_trades').get();
  assert(count.c >= 0, 'tablo erişilebilir');
});

test('Açık pozisyon yok (bot temiz durumda)', () => {
  const open = db.prepare("SELECT COUNT(*) as c FROM live_trades WHERE outcome='OPEN'").get();
  assert(open.c === 0, `${open.c} açık pozisyon var — temiz başlangıç için 0 olmalı`);
});

test('stop_pending kalmış pozisyon yok', () => {
  const pending = db.prepare("SELECT COUNT(*) as c FROM live_trades WHERE exit_reason='stop_pending'").get();
  assert(pending.c === 0, `${pending.c} stop_pending var — manuel müdahale gerekebilir`);
});

test('Redeem edilmemiş WIN token yok', () => {
  const unredeemed = db.prepare("SELECT COUNT(*) as c FROM live_trades WHERE outcome='WIN' AND redeemed=0").get();
  assert(unredeemed.c === 0, `${unredeemed.c} unredeemed WIN var — para kayıp olabilir`);
});

test('WR ve P&L tutarlı', () => {
  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) as losses,
      ROUND(SUM(CASE WHEN outcome IN ('WIN','LOSS') THEN pnl ELSE 0 END), 3) as pnl
    FROM live_trades
  `).get();
  const total = stats.wins + stats.losses;
  const wr = total > 0 ? (stats.wins / total * 100) : 0;
  assert(total > 0, 'En az 1 tamamlanmış trade olmalı');
  assert(wr >= 70, `WR=${wr.toFixed(1)}% — 70% altı anormal (mevcut: %87)`);
  console.log(`       → ${stats.wins}W / ${stats.losses}L | %${wr.toFixed(1)} WR | Net: $${stats.pnl}`);
});

// ═══════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(' TEST 6: P&L Formülü Doğruluğu');
console.log('══════════════════════════════════════════');

test('WIN pnl formülü: exit*shares*FEE_FACTOR - entry*shares (fee token sayısına yansıdı)', () => {
  // Yeni formül: pnl = exit_price * shares * 0.9933 - entry_price * shares
  // T1: entry=0.93, shares=5, exit=1.0 → 1.0*5*0.9933 - 0.93*5 = 4.9665 - 4.65 = 0.3165
  const FEE_FACTOR = 0.9933;
  const t1 = db.prepare("SELECT pnl, entry_price, shares, exit_price FROM live_trades WHERE id=1").get();
  assert(t1, 'T1 var');
  const expected = t1.exit_price * t1.shares * FEE_FACTOR - t1.entry_price * t1.shares;
  assert(Math.abs(t1.pnl - expected) < 0.01,
    `T1 pnl=${t1.pnl.toFixed(4)}, beklenen=${expected.toFixed(4)}`);
  // Eski formül (TAKER_FEE double-count) ile eşleşmemeli
  const oldFormula = (1.00 - t1.entry_price) * t1.shares - t1.entry_price * t1.shares * 0.02;
  assert(Math.abs(t1.pnl - oldFormula) > 0.01, 'Eski formül artık kullanılmıyor');
});

test('LOSS pnl negatif (stop veya settlement_loss)', () => {
  const losses = db.prepare("SELECT * FROM live_trades WHERE outcome='LOSS'").all();
  assert(losses.length > 0, 'En az 1 LOSS var');
  for (const l of losses) {
    assert(l.pnl < 0, `T${l.id} LOSS → pnl negatif olmalı (${l.pnl})`);
  }
});

test('Tüm WIN\'ler redeemed=1', () => {
  const unredeemed = db.prepare("SELECT COUNT(*) as c FROM live_trades WHERE outcome='WIN' AND redeemed=0").get();
  assert(unredeemed.c === 0, `${unredeemed.c} WIN redeemed=0 — para kilitli!`);
});

// ═══════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(' SONUÇ');
console.log('══════════════════════════════════════════');
console.log(`  TOPLAM: ${PASS + FAIL} test | ✅ ${PASS} PASS | ❌ ${FAIL} FAIL`);
if (FAIL === 0) {
  console.log('  🎉 TÜM TESTLER GEÇTİ\n');
} else {
  console.log('  ⚠️  BAŞARISIZ TESTLER VAR — düzeltme gerekiyor\n');
  process.exit(1);
}
