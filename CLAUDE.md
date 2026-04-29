# Weather NO Bot — CLAUDE.md (Tek Kaynak)
*Son Güncelleme: 29 Nisan 2026*

> Bu dosya Weather NO Bot'un canonical dokümantasyonudur.  
> Her session başında okunmalı, önemli değişiklikte güncellenmelidir.

---

## 🗺️ Proje Haritası

```
/opt/polymarket/bot/
├── weather_no_bot.ts          ← Ana bot (TypeScript)
├── auto_redeem.js             ← Günlük settlement redeem
├── data/weather_no_trades.json ← Trade geçmişi (JSON)
├── logs/
│   ├── weather_no_scan.log    ← Scan & cancel-stale logları
│   ├── weather_no_fills.log   ← Fill check logları
│   └── auto_redeem.log        ← Redeem logları
├── live/client.ts             ← CLOB client wrapper
└── CLAUDE.md                  ← Bu dosya

/root/weather/                 ← Python weather modeli (DOKUNMA)
/opt/polymarket/dashboard/     ← Next.js dashboard (port 8004)
```

---

## ⚙️ Bot Parametreleri (Güncel)

| Parametre | Değer | Not |
|-----------|-------|-----|
| `BUY_SHARES` | 6 | Geçici (7'ye dön bakiye>$15 olunca) |
| `MIN_USDC_RESERVE` | $5.0 | Geçici (8'e dön bakiye>$15 olunca) |
| `AUTO_SELL_PRICE` | 0.99 | Hedef çıkış |
| `AUTO_SELL_MIN_EDGE` | 0.005 | Fill'dan en az 0.5¢ kar |
| `MAX_OPEN` | 20 | Maks eş zamanlı pozisyon |
| `MIN_LIQUIDITY` | $300 | Minimum likidite |
| `TREND_THRESHOLD` | 0.3°C | mean-mode farkı için NOTR eşiği |
| `MIN_MODE_DIST` | 2°C | Tier2 için mode'a min mesafe |
| `FEE_BPS` | 1000 | CLOB fee bps (maker rebate alır) |

---

## ⏰ Cron Zamanlaması (Güncel — 29 Nis 2026'dan itibaren)

```cron
# Scan: her saat başı
0 * * * *     npx ts-node weather_no_bot.ts scan

# Cancel-stale: her saat :45'te (scan'dan 15 dk önce)
45 * * * *    npx ts-node weather_no_bot.ts cancel-stale

# Fill check: 15 dakikada bir
7,22,37,52 * * * *  npx ts-node weather_no_bot.ts check-fills

# Auto-redeem: 11:20 ve 23:20 UTC
20 11,23 * * *  node auto_redeem.js
```

---

## 🧠 Strateji Mantığı

**"Fade the Impossible"** — Model kesin olmayacak dediği bucket'larda
piyasanın abartılı fiyatladığı YES'e karşı NO al.

```
Model: Paris yarın 22°C
Piyasa: 25°C bucket'ı %3 fiyatlıyor
Gerçek şans: <%1 (3°C uzakta)
→ NO'yu 0.97'den al, 0.99'da sat → EV ~%2
```

### İki Katmanlı Filtre Sistemi

**TIER 1 — CAPPED (ENS cap=%3, 0 ensemble üyesi):**
- PM YES fiyatı: %1.5 – %20 aralığında
- Trend filtresi YOK — pure distance play
- Mantık: model hiç üye koymuyor → settlement ihtimali ≈ sıfır

**TIER 2 — NEAR-MISS (ENS=%3–7%, 1-3 üye):**
- PM YES fiyatı: ≥%5
- Edge (PM – ENS): ≥%4
- Trend filtresi ZORUNLU (ısınma/soğuma yönü)

### Koruma Filtreleri
- **Recent Settlement Guard**: Son 3 gerçek temp ±1°C içindeyse → skip
- **Cold Streak Guard**: Model 2+ gün aynı yönde yanılıyorsa üst bucket'ları bloke et

---

## 🔑 Kritik Teknik Bilgiler

### Token & Adresler
| Token | Adres |
|-------|-------|
| pUSD (V2 collateral) | `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` |
| CTF | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| NegRiskAdapter | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` |
| CollateralOnramp | `0x93070a847efEf7F70739046A929D47a521F5B8ee` |
| WCOL | `0x3A3BD7bb9528E159577F7C2e685CC81A765002E2` |

### Çalışan Polygon RPC'ler (Nisan 2026)
- `https://polygon.gateway.tenderly.co` ✅
- `https://polygon.drpc.org` ✅
- ❌ polygon-bor-rpc.publicnode.com (403 Forbidden)
- ❌ rpc.ankr.com/polygon (auth gerekiyor)

### live-balance API (port 8001)
- Endpoint: `GET http://localhost:8001/api/live-balance`
- Okur: pUSD on-chain balance (trader.py via Tenderly RPC)
- Hata ayıklama: `USDC_E` değişkeni pUSD adresi olmalı (USDC.e değil)

### CLOB Bakiye Notu
- `getBalanceAllowance(COLLATERAL)` → on-chain pUSD bakiyesini döner (/ 1e6)
- Dashboard `weather-no/route.ts` midpoint API: `d.mid` STRING döner → `parseFloat(d.mid)` kullan

### negRisk Mikro-Kayıp
- 6 share order → 5.994 token gelir (0.001/share fee)
- `MIN_SELL_SHARES = 5` ile güvenli; 6 yerine 5 satılır

---

## 📊 Performans (29 Nisan 2026)

| Metrik | Değer |
|--------|-------|
| Toplam Trade | 77 |
| Satılan | 26 |
| Win / Loss | 23W / 3L |
| **Win Rate** | **%88.5** |
| Gerçekleşen P&L | +$7.36 |
| Bekleyen P&L | +$1.82 |
| **Toplam P&L** | **+$9.18** |
| Bakiye | $31.37 pUSD |
| Aktif Pozisyon | 7 |

### 3 Kaybın Analizi
Üçü de **0.90+ fiyattan alınan** yüksek maliyetli pozisyonlar:
- LTAC 19°C: buy@0.92 sell@0.87 → -$0.30
- LFPG 24°C: buy@0.93 sell@0.91 → -$0.12
- EFHK 5°C:  buy@0.94 sell@0.94 → $0.00

**Sonuç:** 0.90+ alımlarda yeterli edge olmaması. Tier1 filtresi %1.5 min PM gerektiriyor — yeterli mi tartışmalı.

---

## 🐛 Bilinen Sorunlar

| Sorun | Durum |
|-------|-------|
| `clob-null-cancel`: bot order null gelince local cancel eder, CLOB'da emir hâlâ açık kalabilir | Monitör et |
| settled_pending x3 (EGLC Apr25, LTAC/LEMD Apr26) oracle çözülmedi | Her 11:20 UTC auto_redeem dener |
| RJTT/RKSI soğuma bias −3°C: model sistematik alttan vuruyor | Cold streak guard aktif |

---

## 🚀 Hızlı Komutlar

```bash
# Durum
cd /opt/polymarket/bot && npx ts-node weather_no_bot.ts status

# Manuel scan
cd /opt/polymarket/bot && npx ts-node weather_no_bot.ts scan

# Fill kontrol
cd /opt/polymarket/bot && npx ts-node weather_no_bot.ts check-fills

# Bakiye
curl -s http://localhost:8001/api/live-balance

# PM2
pm2 ls
pm2 logs polymarket-bot --lines 30 --nostream

# Dashboard
open http://localhost:8004/weather-bot   # (VPS üzerinde 8004)
```

---

## 📁 İlgili Diğer Dokümanlar

| Dosya | Kapsam |
|-------|--------|
| `/root/weather/CLAUDE.md` | Python YES bot — ayrı sistem |
| `/root/weather/BOT.md` | Weather model mimarisi |
| `/opt/polymarket/bot/docs/WEATHER_NO_BOT_OZET.md` | **ESKİ** — bu dosya yerine bu CLAUDE.md kullan |
| `~/.claude/projects/.../memory/project_weather_bot_state.md` | Claude memory — bu dosyayla senkron tut |
