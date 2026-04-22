const Database = require('better-sqlite3');
const db = new Database('/opt/polymarket/bot/data/observer.db');

// FOK başarısızlığının daha derin analizi: hangi saatlerde daha kötü?
const fs = require('fs');
const log = fs.readFileSync('/root/.pm2/logs/polymarket-live-out-4.log', 'utf8');

// FOK başarısız satırlarını çıkar
const failLines = log.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}: \[live\] BUY FILL YOK/g) || [];
const succLines = log.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}: \[live\] ✅ BUY FILL @/g) || [];

// Saatlik FOK fail oranı
const failByHour = {};
const succByHour = {};
failLines.forEach(l => { const h = l.slice(11,13); failByHour[h] = (failByHour[h]||0)+1; });
succLines.forEach(l => { const h = l.slice(11,13); succByHour[h] = (succByHour[h]||0)+1; });

console.log('Saatlik FOK başarı oranı:');
const hours = [...new Set([...Object.keys(failByHour), ...Object.keys(succByHour)])].sort();
hours.forEach(h => {
  const f = failByHour[h]||0, s = succByHour[h]||0, t = f+s;
  if (t>0) console.log(`  ${h}:00 → başarı: ${Math.round(s/t*100)}% (${s}/${t})`);
});

// Kârlılık analizi: paper 15dk
const paper15 = db.prepare(`
  SELECT 
    COUNT(*) as cnt,
    SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
    ROUND(SUM(COALESCE(pnl,0)),2) as pnl,
    ROUND(AVG(CASE WHEN outcome='WIN' THEN 1.0 ELSE 0.0 END)*100,1) as wr
  FROM paper_trades p JOIN markets m ON p.market_id=m.id
  WHERE p.strategy='scalp' AND m.duration_min=15 AND p.outcome IN ('WIN','LOSS')
`).get();
console.log('\nPaper 15dk:', paper15);

// paper 15dk giriş fiyat dağılımı
const paper15ep = db.prepare(`
  SELECT entry_price, COUNT(*) as cnt FROM paper_trades p JOIN markets m ON p.market_id=m.id
  WHERE p.strategy='scalp' AND m.duration_min=15 AND p.outcome IN ('WIN','LOSS')
  GROUP BY entry_price ORDER BY cnt DESC LIMIT 8
`).get();
console.log('Paper 15dk entry price en yaygın:', paper15ep);

// Eğer 2 eşzamanlı pozisyona izin versek ne kadar ekstra sinyal alırdık?
const openPeriods = db.prepare(`SELECT entry_ts, exit_ts FROM live_trades WHERE exit_ts IS NOT NULL ORDER BY entry_ts`).all();
const paperSigs = db.prepare(`
  SELECT p.entry_ts, p.market_id FROM paper_trades p JOIN markets m ON p.market_id=m.id
  WHERE p.strategy='scalp' AND m.duration_min=5 AND p.entry_ts > 1776196957
  ORDER BY p.entry_ts
`).all();

let extraIfTwo = 0;
for (const ps of paperSigs) {
  const openCount = openPeriods.filter(op => op.entry_ts <= ps.entry_ts && op.exit_ts >= ps.entry_ts).length;
  if (openCount === 1) extraIfTwo++; // 1 açık varken yeni sinyal: 2'ye izin verse alırdık
}
console.log('\n2 eşzamanlı pozisyon izni ile ek sinyal:', extraIfTwo);
