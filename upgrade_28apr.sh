#!/bin/bash
# =============================================================================
# upgrade_28apr.sh — Polymarket Exchange Upgrade 2026-04-28
# Otomatik: API hazır olunca çalışır, işlemi tamamlar, kendini siler.
# =============================================================================
set -uo pipefail

BOT="/opt/polymarket/bot"
LOG="$BOT/logs/upgrade_28apr.log"
TRADES="$BOT/data/weather_no_trades.json"
CRON_TAG="polymarket-upgrade-28apr"
SECRETS="/root/.polymarket_secrets"

mkdir -p "$BOT/logs"
exec >> "$LOG" 2>&1   # tüm çıktı log'a

ts() { date -u '+%H:%M:%S UTC'; }
log() { echo "[$(ts)] $*"; }

log "======================================================================"
log "POLYMARKET UPGRADE 2026-04-28 — SCRIPT BAŞLADI"
log "======================================================================"

# ── Env ───────────────────────────────────────────────────────────────────
[ -f "$SECRETS" ] && source "$SECRETS"
[ -f "$BOT/.env" ] && source "$BOT/.env"

# ── 1. CLOB API hazır mı? (max 3 × 5dk = 15dk bekle) ─────────────────────
log ""
log "1. Polymarket CLOB API erişilebilirlik testi..."
API_READY=false
for attempt in 1 2 3; do
    CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
           --max-time 15 "https://clob.polymarket.com/" 2>/dev/null || echo "000")
    if [ "$CODE" = "200" ]; then
        log "   ✓ API HAZIR (deneme $attempt)"
        API_READY=true
        break
    fi
    log "   ⏳ HTTP $CODE — henüz hazır değil (deneme $attempt/3). 5dk bekleniyor..."
    sleep 300
done

if [ "$API_READY" != "true" ]; then
    log "   ✗ API 15dk sonra da hazır değildi. Cron 30dk sonra tekrar çalıştırılacak."
    log "   Script yeniden planlandı (13:05 UTC)."
    # Cron'u 13:05'e kaydır (tek seferlik, tekrar kendini silecek)
    (crontab -l 2>/dev/null | grep -v "$CRON_TAG") | crontab -
    echo "5 13 28 4 * $BOT/upgrade_28apr.sh  # $CRON_TAG" | crontab -
    exit 0
fi

# ── 2. @polymarket/clob-client güncelle ───────────────────────────────────
log ""
log "2. @polymarket/clob-client güncelleniyor..."
cd "$BOT"
OLD_VER=$(node -e "try{console.log(require('./node_modules/@polymarket/clob-client/package.json').version)}catch(e){console.log('?')}" 2>/dev/null)
npm install @polymarket/clob-client@latest --save --silent 2>&1 || true
NEW_VER=$(node -e "try{console.log(require('./node_modules/@polymarket/clob-client/package.json').version)}catch(e){console.log('?')}" 2>/dev/null)
log "   Versiyon: $OLD_VER → $NEW_VER"

# ── 3. Yeni contract adreslerini SDK'dan çıkar ────────────────────────────
log ""
log "3. Yeni contract adresleri çıkarılıyor..."

node << 'NODEOF' | tee /tmp/new_addrs.json || echo '{}'
const fs   = require('fs');
const path = require('path');
const DIR  = '/opt/polymarket/bot/node_modules/@polymarket/clob-client';
const addrs = {};

// Yöntem 1: module exports'tan
try {
  const c = require(DIR);
  function scanObj(obj, prefix) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v)) {
        addrs[prefix ? prefix+'_'+k : k] = v;
      } else if (typeof v === 'object') {
        scanObj(v, k);
      }
    }
  }
  scanObj(c, '');
} catch(e) { process.stderr.write('exports scan: ' + e.message + '\n'); }

// Yöntem 2: derlenmiş dist/index.js içinde regex tarama
const distFiles = ['dist/index.js', 'dist/index.cjs', 'src/config.ts'];
for (const rel of distFiles) {
  const fp = path.join(DIR, rel);
  if (!fs.existsSync(fp)) continue;
  try {
    const src = fs.readFileSync(fp, 'utf8');
    const patterns = [
      [/CTF_EXCHANGE[_A-Z0-9]*\s*[=:]\s*["'`](0x[a-fA-F0-9]{40})/, 'CTF_EXCHANGE_V2'],
      [/NEG_RISK[_A-Z0-9]*\s*[=:]\s*["'`](0x[a-fA-F0-9]{40})/,    'NEG_RISK_ADAPTER_V2'],
      [/pUSD[_A-Z0-9]*\s*[=:]\s*["'`](0x[a-fA-F0-9]{40})/,        'PUSD_TOKEN'],
      [/COLLATERAL[_A-Z0-9]*\s*[=:]\s*["'`](0x[a-fA-F0-9]{40})/,  'COLLATERAL_TOKEN'],
    ];
    for (const [re, name] of patterns) {
      const m = src.match(re);
      if (m && !addrs[name]) { addrs[name] = m[1]; }
    }
  } catch(e) {}
}

// Yöntem 3: Polymarket Gamma API'den (opsiyonel)
// https://gamma-api.polymarket.com/exchanges gibi endpoint varsa eklenebilir

process.stdout.write(JSON.stringify(addrs, null, 2) + '\n');
NODEOF

log "   Çıkarılan adresler: $(cat /tmp/new_addrs.json | tr '\n' ' ')"

# ── 4. Contract adresleri güncelle (bulunabildiyse) ───────────────────────
log ""
log "4. Contract adresleri güncelleniyor..."

python3 << 'PYEOF'
import json, re, os, sys

try:
    with open('/tmp/new_addrs.json') as f:
        addrs = json.load(f)
except:
    addrs = {}

print(f"  Bulunan: {list(addrs.keys())}")

# Hangi adresler önemli
CTF_V2    = addrs.get('CTF_EXCHANGE_V2')
NR_V2     = addrs.get('NEG_RISK_ADAPTER_V2')
PUSD      = addrs.get('PUSD_TOKEN') or addrs.get('COLLATERAL_TOKEN')

changed = []

# ── auto_redeem.js ───────────────────────────────────────────────
AR_FILE = '/opt/polymarket/bot/auto_redeem.js'
if os.path.exists(AR_FILE):
    with open(AR_FILE) as f:
        src = f.read()
    orig = src

    if CTF_V2:
        src = re.sub(
            r"(const CTF\s*=\s*')[^']+(')",
            rf"\g<1>{CTF_V2}\g<2>", src
        )
        print(f"  auto_redeem.js: CTF → {CTF_V2}")

    if NR_V2:
        src = re.sub(
            r"(const NR_ADAPTER\s*=\s*')[^']+(')",
            rf"\g<1>{NR_V2}\g<2>", src
        )
        print(f"  auto_redeem.js: NR_ADAPTER → {NR_V2}")

    if PUSD:
        # USDCE → PUSD değişim
        src = re.sub(
            r"(const USDCE\s*=\s*')[^']+(')",
            rf"\g<1>{PUSD}\g<2>", src
        )
        print(f"  auto_redeem.js: USDCE → {PUSD}")

    if src != orig:
        with open(AR_FILE, 'w') as f:
            f.write(src)
        changed.append('auto_redeem.js')

# ── weather_no_bot.ts (redeem bölümü) ─────────────────────────────
BOT_FILE = '/opt/polymarket/bot/weather_no_bot.ts'
if os.path.exists(BOT_FILE):
    with open(BOT_FILE) as f:
        src = f.read()
    orig = src

    if CTF_V2:
        src = re.sub(
            r"(const CTF_ADDRESS\s*=\s*')[^']+(')",
            rf"\g<1>{CTF_V2}\g<2>", src
        )
        print(f"  weather_no_bot.ts: CTF_ADDRESS → {CTF_V2}")

    if NR_V2:
        src = re.sub(
            r"(const NR_ADAPTER\s*=\s*')[^']+(')",
            rf"\g<1>{NR_V2}\g<2>", src
        )
        print(f"  weather_no_bot.ts: NR_ADAPTER → {NR_V2}")

    if src != orig:
        with open(BOT_FILE, 'w') as f:
            f.write(src)
        changed.append('weather_no_bot.ts')

if changed:
    print(f"  ✓ Güncellenen dosyalar: {changed}")
else:
    print("  ⚠️  Contract adresi otomatik bulunamadı — MANUEL GÜNCELLEME GEREKİYOR")
    print("     → auto_redeem.js içindeki CTF, NR_ADAPTER, USDCE adreslerini")
    print("       Polymarket Discord / dev migration guide'dan al ve güncelle")
PYEOF

# ── 5. pUSD / yeni sözleşme onayları ─────────────────────────────────────
log ""
log "5. pUSD onayı — clob-client initialization ile tetikleniyor..."
# ClobClient başladığında setApprovals() otomatik çalıştırır.
# check-fills bunu tetikler. Başarısız olursa log'a yazar.

# ── 6. pending_fill → cancelled (tüm buy emirleri upgrade'de silindi) ──────
log ""
log "6. Silinen pending_fill emirleri temizleniyor..."
python3 << 'PYEOF'
import json, os

path = '/opt/polymarket/bot/data/weather_no_trades.json'
try:
    with open(path) as f:
        trades = json.load(f)
    n = 0
    for t in trades:
        if t.get('status') == 'pending_fill':
            t['status'] = 'cancelled'
            t['notes'] = ((t.get('notes') or '') + ' | upgrade-28apr-wiped').strip(' |')
            n += 1
    if n:
        tmp = path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(trades, f, indent=2)
        os.replace(tmp, path)
        print(f'  ✓ {n} pending_fill → cancelled')
    else:
        print('  Temizlenecek pending_fill yok')
except Exception as e:
    print(f'  HATA: {e}')
PYEOF

# ── 7. sell_pending emirleri yeniden ver (EGLC vs.) ───────────────────────
log ""
log "7. check-fills çalıştırılıyor — sell emirleri yenileniyor..."
cd "$BOT"
timeout 180 npx ts-node weather_no_bot.ts check-fills 2>&1 \
    | grep -v "^$" \
    | tail -40 \
    || log "   ⚠️  check-fills hata aldı — loglara bak"

# ── 8. Sonuç özeti ────────────────────────────────────────────────────────
log ""
log "======================================================================"
log "ÖZET:"
python3 << 'PYEOF'
import json
with open('/opt/polymarket/bot/data/weather_no_trades.json') as f:
    trades = json.load(f)
from collections import Counter
c = Counter(t.get('status') for t in trades)
print('  Trade durumları: ' + str(dict(c)))
sell_p = [t for t in trades if t.get('status') == 'sell_pending']
print(f'  sell_pending (aktif): {len(sell_p)}')
for t in sell_p:
    print(f'    - {(t.get("station") or "?").upper()} {t.get("bucket_title","?")} fill={t.get("fill_price")} sell={t.get("sell_price")}')
PYEOF
log ""

# Adresler bulunmadıysa uyarı
if python3 -c "import json; a=json.load(open('/tmp/new_addrs.json')); exit(0 if a else 1)" 2>/dev/null; then
    log "✓ Contract adresleri otomatik güncellendi"
else
    log "⚠️  YENİ CONTRACT ADRESLERİ BULUNAMADI — Manuel işlem gerekli:"
    log "   1. Polymarket Discord / dev guide'dan yeni CTF V2 ve pUSD adreslerini al"
    log "   2. /opt/polymarket/bot/auto_redeem.js → CTF, NR_ADAPTER, USDCE"
    log "   3. /opt/polymarket/bot/weather_no_bot.ts → CTF_ADDRESS"
fi
log ""
log "Log: $LOG"
log "======================================================================"

# ── 9. Cron'u sil (tek seferlik iş tamamlandı) ───────────────────────────
(crontab -l 2>/dev/null | grep -v "$CRON_TAG") | crontab -
log "Cron silindi. Script tamamlandı."
