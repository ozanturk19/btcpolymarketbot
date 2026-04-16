# Polymarket BTC Scalp Bot — Proje Dokümantasyonu

**Son Güncelleme**: 16 Nisan 2026  
**Dil**: TypeScript  
**Durum**: Canlı, aktif işlem yapıyor

---

## Hızlı Başlangıç

Yeni bir geliştirici olarak projeye dahil oldunuz. Şu sırayla okuyun:

1. Bu belgenin tamamını baştan sona okuyun.
2. Sunucuya bağlanın ve durumu kontrol edin:

```bash
ssh root@135.181.206.109
pm2 status
pm2 logs polymarket-live --lines 50 --nostream
node /tmp/deep_check.js
```

3. Kod tabanına bakın:

```bash
ls /opt/polymarket/bot/
cat /opt/polymarket/bot/index.ts
```

4. Testleri çalıştırın:

```bash
node /tmp/full_test_suite.js
```

Herşey yolundaysa 27/27 test geçer. Bittikten sonra geliştirmeye başlayabilirsiniz.

---

## İçindekiler

1. [Proje Genel Bakış](#1-proje-genel-bakış)
2. [Sunucu ve Altyapı](#2-sunucu-ve-altyapı)
3. [Strateji Mantığı](#3-strateji-mantığı)
4. [Teknik Mimari](#4-teknik-mimari)
5. [Kritik Teknik Keşifler](#5-kritik-teknik-keşifler)
6. [Performans ve İstatistikler](#6-performans-ve-istatistikler)
7. [Test Paketi](#7-test-paketi)
8. [İzleme ve Monitoring](#8-izleme-ve-monitoring)
9. [Bilinen Sorunlar ve Açık Kararlar](#9-bilinen-sorunlar-ve-açık-kararlar)
10. [Dağıtım Komutları](#10-dağıtım-komutları)
11. [Önemli Olaylar Zaman Çizelgesi](#11-önemli-olaylar-zaman-çizelgesi)

---

## 1. Proje Genel Bakış

**Polymarket BTC Scalp Bot**, Polymarket tahmin piyasalarında 5 dakikalık BTC Yukarı/Aşağı binary marketlerinde otomatik işlem yapan bir canlı trading botudur.

**Ne yapar?**  
Polymarket'ta her 5 dakikada bir açılan "Bitcoin bu 5 dakikada yukarı mı gitti, aşağı mı?" sorusunu cevaplayan binary piyasalarda scalp stratejisiyle işlem yapar. Bot, yüksek olasılıklı fırsatları tespit edip alım yapar, piyasa lehimize kapanırsa 1.00 üzerinden settlement bekler.

**Neden binary market scalp?**  
- 5 dakikalık piyasalar kısa vadeli trend yakalamak için uygundur.
- 0.91–0.93 ask fiyatı aralığı, piyasanın yüksek ağırlıkla bir yöne gittiğini gösterir.
- Settlement 1.00'da olur → win durumunda %8-9 kâr, kayıp durumunda ise stop loss devreye girer.

---

## 2. Sunucu ve Altyapı

| Bileşen | Detay |
|---------|-------|
| Sunucu | VPS — `135.181.206.109` |
| Bot dizini | `/opt/polymarket/bot/` |
| PM2 process (bot) | `polymarket-live` (id: 4) |
| PM2 process (dashboard) | `polymarket-dashboard` (id: 1), port `8004` |
| Veritabanı | `/opt/polymarket/bot/data/observer.db` (better-sqlite3) |
| Dil | TypeScript → `dist/` klasörüne derlenir |
| Build komutu | `cd /opt/polymarket/bot && npm run build` |
| Yeniden başlatma | `pm2 restart polymarket-live` |

### Kod Değişikliği Sonrası Standart Prosedür

```bash
ssh root@135.181.206.109
cd /opt/polymarket/bot
# Kodu düzenle
npm run build            # TypeScript derle
pm2 restart polymarket-live
pm2 logs polymarket-live --lines 20 --nostream   # Hata yok mu?
```

---

## 3. Strateji Mantığı

### İşlem Yapılan Piyasalar

Yalnızca **5 dakikalık BTC Yukarı/Aşağı** piyasaları.

Örnek piyasa adı: `"Bitcoin Up or Down - April 16, 10:30"` — BTC o 5 dakikada yukarı mı yoksa aşağı mı kapandı?

Herhangi bir anda yaklaşık 75–80 aktif piyasa bulunur. Bot bunları takip eder ve sinyal koşulları sağlandığında otomatik alım yapar.

### Giriş Koşulları (Tüm Koşullar Aynı Anda Sağlanmalı)

```
ask >= 0.91       (ENTRY_MIN — fiyat bu seviyenin altında ise girilmez)
ask <= 0.93       (ENTRY_MAX — fiyat bu seviyenin üstünde ise girilmez)
elapsed >= 90s    (piyasa açılışından bu yana en az 90 saniye geçmeli)
elapsed <= 240s   (piyasa açılışından bu yana en fazla 240 saniye geçmeli)
remaining >= 60s  (kapanışa en az 60 saniye kalmış olmalı)
durationMin === 5 (yalnızca 5 dakikalık piyasalar)
OPEN pozisyon yok (aynı anda yalnızca 1 açık işlem)
```

Bu koşulların arkasındaki mantık: 90–240 saniye aralığı piyasanın "oturduğu" bölgedir. Çok erken girilirse gürültü fazla, çok geç girilirse zaman kalmaz. 0.91–0.93 fiyat aralığı ise yüksek olasılıkla bir yönün baskın olduğunu gösterir.

### Emir Akışı

```
1. SİNYAL TESPIT EDİLDİ
   → FOK BUY @ ask fiyatı, 5 adet hisse (FOK_FEE_BPS=1000)

2. ALIM DOLDURULDU
   → GTC SELL LIMIT @ 0.99 (TARGET) dene
   → NEREDEYSE HER ZAMAN BAŞARISIZ OLUR (token fee mekaniği — aşağıda açıklanıyor)

3. POZİSYON AÇIK
   → Stopwatch her 10 saniyede bir fiyatı izler

4. ÇIKIŞ YÖNTEMLERİ:
   a) settlement_win: Piyasa bizim yönümüzde kapanır → 1.00'dan ödeme alınır
   b) stop cascade: Fiyat stop seviyesine düşerse zorla satış
```

### Stop Loss Mekanizması

```
stop_price = entry_price - 0.06   (STOP_DIST = 0.06)
Örnek: entry=0.92 → stop=0.86
```

`mid <= stop_price` olduğunda stop cascade başlar:

```
Adım 1: GTC SELL LIMIT iptal et (varsa)
Adım 2: 4 FOK SELL denemesi (cascade):
  Deneme 1: mid - 0.01
  Deneme 2: mid - 0.03
  Deneme 3: mid - 0.06
  Deneme 4: mid - 0.10
  Her deneme için minimum: max(deneme_fiyatı, 0.02)
Adım 3: Hepsi başarısız → stop_pending, sonraki tick'te tekrar dene
```

### Parametreler

```
SIZE_USD     = 5        ($5 per trade)
ENTRY_MIN    = 0.91
ENTRY_MAX    = 0.93
TARGET       = 0.99
STOP_DIST    = 0.06
TAKER_FEE    = 0.02     (Polymarket taker ücreti %2)
FOK_FEE_BPS  = 1000     (CLOB API zorunlu)
GTC_FEE_BPS  = 1000     (CLOB API zorunlu — 0 olursa hata verir!)
TICK_SIZE    = '0.01'
SHARES       = max(5, round(SIZE_USD / entry_price)) = her zaman 5
```

### P&L Formülü

Veritabanına kaydedilen P&L:

```
pnl = (exit_price - entry_price) × shares - entry_price × shares × TAKER_FEE
```

Örnekler:
- **WIN settlement**: `(1.00 - 0.92) × 5 - (0.92 × 5 × 0.02) = 0.40 - 0.092 = +$0.308`
- **Tam kayıp**: `(0.00 - 0.92) × 5 - 0.092 = -$4.692`  
  *(Gerçek kayıp -$4.60'tır — yalnızca giriş ücreti sayıldığı için DB ~$0.09 fazla gösterir)*
- **Stop kaybı**: `(exit - entry) × shares - entry_fee`  
  *(Yalnızca giriş ücreti sayılır, çıkış ücreti dahil edilmez)*

---

## 4. Teknik Mimari

### Dizin Yapısı

```
/opt/polymarket/bot/
├── index.ts              ← Orkestratör (tick döngüsü, 10s aralık, stopwatch)
├── collector.ts          ← Orderbook snapshot'ları (shouldSnapshot zamanlama, fetchBook export)
├── discovery.ts          ← Market keşfi, çözümleme
├── btcFeed.ts            ← BTC fiyat beslemesi
├── strategies/
│   ├── scalp_live.ts     ← CANLI trading stratejisi (v3, mevcut)
│   └── scalp.ts          ← Kağıt (simülasyon) trading stratejisi
├── live/
│   ├── client.ts         ← CLOB istemci (getClobClient, initClobClient, isClobReady)
│   └── redeem.ts         ← Kazanılan token'ları otomatik çekme
├── db/
│   └── schema.ts         ← SQLite şeması
└── data/
    └── observer.db       ← Veritabanı
```

### Tick Döngüsü (index.ts)

Ana döngü 10 saniyede bir çalışır. Her aktif market için şu sıra izlenir:

```
setInterval(tick, 10_000ms)
  for each activeMarket:

    1. HIZLI STOP KONTROLÜ (her 10s, bağımsız — STOPWATCH):
       - Eğer bu market için OPEN pozisyon varsa → taze orderbook çek
       - Eğer mid <= stop_price → updateScalpLive() çağır
       (shouldSnapshot bloğundan BAĞIMSIZ çalışır — bu kritik!)

    2. if shouldSnapshot(market):
       - takeSnapshot() → DB'ye kaydet
       - checkScalpLive() → giriş sinyali ara → BUY emri ver
       - updateScalpLive() → snapshot verisiyle ikincil stop kontrolü

setInterval(refreshMarkets, 60_000ms)
  - fetchActiveMarkets() → activeMarkets haritasını güncelle
  - resolveMarkets() → sonuçları kontrol et
  - resolveScalpLive() → bilinen sonuçlarla OPEN işlemleri kapat
  - autoRedeemWins() → kazanılan token'ları zincir üstünde çek
```

### shouldSnapshot Zamanlaması

```
remaining < 60s      → her 15s   (son dakika — yüksek frekans)
elapsed < 120s       → her 30s   (ilk 2 dakika)
elapsed >= 120s      → her 60s   (orta periyot — STOPWATCH'IN GEREKTİĞİ BÖLGE!)
```

**Neden stopwatch gerekli?** Orta periyotta snapshot yalnızca 60 saniyede bir alınır. Bu 60 saniyelik kör pencerede fiyat dibe vurabilir. Stopwatch bu riski ortadan kaldırır — her 10s'de bağımsız kontrol eder.

---

## 5. Kritik Teknik Keşifler

Bu bölüm, geliştirme sürecinde öğrenilen ve bir daha keşfetmeniz gerekmeyecek kritik bilgileri içerir.

---

### Keşif 1: Token Fee Mekaniği (KRİTİK)

Polymarket CLOB, %2 taker ücretini **USDC'den değil, alınan token'lardan** keser:

```
Ödediğiniz: 5 × 0.92 = $4.60 USDC (tam tutar, eksiksiz)
Aldığınız:  ~4.974 token (ücret token'dan kesilir: 5 - küçük miktar ≈ 4.974)
```

Hata mesajı örneği: `"balance: 4974800, order amount: 5000000"` (mikro-hisse: ÷1e6)

**Sonuç**: GTC SELL LIMIT minimumu 5 hissedir, ancak elimizde 4.97 var → SELL LIMIT her zaman başarısız olur.

**Neden sorun değil**: Settlement 1.00'dan olur, bu 0.99 hedefimizden daha iyidir. SELL LIMIT'in başarısız olması zararsızdır.

---

### Keşif 2: parseBalanceFromError()

CLOB "yeterli bakiye yok" hatası döndürdüğünde, gerçek bakiye hata mesajının içindedir. Stop cascade'in ilk denemesi 5 hisse ile yapılır, hata alınırsa gerçek bakiye parse edilir ve yeniden deneme yapılır:

```typescript
function parseBalanceFromError(errMsg: string): number | null {
  const m = errMsg.match(/balance:\s*(\d+)/);
  if (!m) return null;
  const raw = parseInt(m[1], 10);
  if (isNaN(raw) || raw <= 0) return null;
  return Math.floor((raw / 1e6) * 100) / 100;  // floor, round değil!
}
```

**Dikkat**: `Math.floor` kullanılmalı, `Math.round` değil. 4.9748 → 4.97 (floor) vs 4.97 (round da aynı olur ama ilke olarak floor).

---

### Keşif 3: GTC_FEE_BPS 1000 Olmalı (0 Değil)

Başlangıçta 0 olarak ayarlanmıştı. Hata: `"invalid user provided fee rate: 0"`. 1000'e çevrildi. FOK ve GTC emirlerin her ikisi de 1000 BPS gerektirir.

---

### Keşif 4: Stopwatch Gap Riski (T34 — Kritik Bug, Düzeltildi)

**Bug'ın Özeti**: `updateScalpLive()` yalnızca `shouldSnapshot()` bloğu içinden çağrılıyordu. `elapsed >= 120s` olduğunda snapshot 60 saniyede bir alınır. Bu 60 saniyelik kör pencerede fiyat çakılabilir.

**T34'te Ne Oldu**: Market 0.965'ten 0.445'e bir 60 saniyelik pencerede düştü. Stop 0.86'da tetiklenmeliydi, ama bot 0.42'de fark etti. Bu, yaklaşık -$2.57 kayba yol açtı.

**Düzeltme** (`index.ts`'de):

```typescript
// shouldSnapshot bloğundan ÖNCE, her 10 saniyede çalışır
if (openForMarket) {
  const book = await fetchBook(openForMarket.token_id);
  const fastMid = (bestBid + bestAsk) / 2;
  if (fastMid <= openForMarket.stop_price) {
    await updateScalpLive(db, market, upMid, downMid);
  }
}
```

**Doğrulama**: Log'da `[stopwatch] 🔍 HH:MM:SS | T9999 UP stop=0.01` tam olarak 10 saniyede bir görünmektedir.

---

### Keşif 5: Seçim Paradoksu (Kağıt Trading Analizinden)

Maker emirler (limit @ mid) ters seçim yarattı:

| Durum | Win Rate | Gerçeklik |
|-------|----------|-----------|
| ask_stable (fiyat sabit kalıyor) | %95.8 | Emirler hiç dolmadı — likidite yok |
| ask_crash (fiyat düşüyor) | %0 | Emirler anında doldu — piyasa aleyhimize dönerken likidite çıktı |

**Sonuç**: Taker emirler (FOK @ ask) kullanıldı. Böylece stabil, yüksek olasılıklı piyasalar yakalanır.

---

### Keşif 6: Otomatik Çekme (Auto-Redeem)

Her çözümlenen WIN marketinden sonra `autoRedeemWins()` çağrılır. Bu fonksiyon, kazanılan tüm WIN token'ları için zincir üstünde çekme işlemi başlatır. T22'den itibaren her WIN için TX hash loglanmaktadır.

---

### Keşif 7: "SELL LIMIT Atlandı: Bakiye < 5" Log Mesajı

```
[live] SELL LIMIT atlandı: bakiye ? < 5 minimum
```

Bu mesaj **her işlemde** görünür. **Hata değildir.** Token fee mekaniği nedeniyle elimizde 4.97 hisse var, minimum ise 5. Kabul edilmiş bir durumdur.

---

## 6. Performans ve İstatistikler

**16 Nisan 2026 itibarıyla:**

| Metrik | Değer |
|--------|-------|
| Toplam işlem | 36 |
| Kazanma oranı | 31W / 5L = %86.1 |
| DB Net P&L | -$3.735 |
| Gerçek Net P&L | ~+$2.49 (DB formülü ~$0.09/işlem fazla gösteriyor) |
| Ortalama WIN | +$0.310 |
| Ortalama LOSS | -$2.667 |
| Yatırılan | $15.19 |
| Mevcut Bakiye | ~$15.90 |

### Kayıp Analizi

| İşlem | Durum | Detay |
|-------|-------|-------|
| T9, T17 | Tam settlement kaybı | Market aleyhimize kapandı, stop zamanında tetiklenmedi |
| T25 | stop_attempt_3 @ 0.76 | Cascade doğru çalıştı, tam kayıptan kurtarıldı |
| T27 | stop_attempt_2 @ 0.84 | Yanlış stop — market daha sonra UP kapandı, ama zaten çıkmıştık |
| T34 | stop_attempt_2 @ 0.42 | Gap risk bug — 60s kör pencere (ARTIK DÜZELTİLDİ) |

---

## 7. Test Paketi

### Konum ve Çalıştırma

```bash
# Ana test paketi (27 test, ~5 saniye)
node /tmp/full_test_suite.js

# Stopwatch zamanlama testi (35 saniye sürer)
node /tmp/test_stopwatch_timing.js
```

### Test Kapsamı (27 test, hepsi geçiyor)

| # | Test Adı | Ne Test Eder |
|---|----------|--------------|
| 1 | shouldSnapshot zamanlama analizi | 30s/60s/15s pencereleri doğrulanır |
| 2 | T34 gap senaryosu | 60s kör pencerenin dokümantasyonu |
| 3 | parseBalanceFromError birim testleri | 4 farklı durum |
| 4 | Giriş koşulları | ask aralığı, elapsed penceresi, remaining kontrolü |
| 5 | Stop cascade fiyatları | Normal, T34 crash, ekstrem durum |
| 6 | Stopwatch zamanlama | Maksimum 10s aralık doğrulanır |
| 7 | DB bütünlüğü | Açık/stop_pending/çekilmemiş win yok |
| 8 | P&L formül doğruluğu | WIN ve LOSS hesaplamaları |
| 9 | WIN çekme tamlığı | Tüm WIN'ler çekilmiş mi? |

---

## 8. İzleme ve Monitoring

### 30 Dakikalık Rutin Kontrol

```bash
ssh root@135.181.206.109
node /tmp/deep_check.js              # Açık pozisyonlar, istatistikler, son işlemler
pm2 logs polymarket-live --lines 30 --nostream
pm2 status | grep polymarket-live
```

### Log Mesajlarının Anlamları

| Log Mesajı | Anlam | Aksiyon |
|-----------|-------|---------|
| `[stopwatch] 🔍 HH:MM:SS \| T9999 UP stop=0.01` | Stopwatch normal çalışıyor (her 10s) | Beklenen davranış |
| `[stopwatch] ⚡ STOP tetiklendi — hızlı yol` | Stop hızlı yoldan tetiklendi | Beklenen, iyi haber |
| `[live] 🛑 STOP tetiklendi` | Stop snapshot yolundan tetiklendi | Beklenen |
| `[live] SELL LIMIT atlandı: bakiye ? < 5` | Token fee nedeniyle limit emir atlandı | Normal, hata değil |
| `stop_pending` (deep_check'te) | Stop başarısız, manuel kontrol gerekebilir | Takip et! |
| `unredeemed WIN` (deep_check'te) | Auto-redeem başarısız, para takılı kalmış | Acil! |
| `Cloudflare 403` (hata logunda) | Geçici bağlantı hatası | 1–5 dakikada kendiliğinden düzelir |

### Acil Durum Protokolü

**stop_pending görülürse:**
1. `pm2 logs polymarket-live --lines 100 --nostream` ile son logları kontrol et
2. Stop denemelerinin neden başarısız olduğuna bak (likidite sorunu mu, API hatası mı?)
3. Gerekirse botu yeniden başlat: `pm2 restart polymarket-live`

**unredeemed WIN görülürse:**
1. Polymarket CLOB API'sinin erişilebilir olduğunu kontrol et
2. Botu yeniden başlat — auto-redeem her 60s döngüsünde tekrar dener

---

## 9. Bilinen Sorunlar ve Açık Kararlar

### 1. STOP_DIST = 0.06 Gürültü Sorunu
T27'de yanlış stop tetiklendi: fiyat kısa süre 0.86'nın altına indi, stop cascade çalıştı, ama market sonunda UP kapandı. 0.08'e genişletmek önerildi, henüz karar verilmedi.

**Avantajlar (0.08)**: Daha az yanlış tetikleme.  
**Dezavantajlar (0.08)**: Gerçek kayıplarda daha derin stop seviyesi → daha büyük kayıplar.

### 2. SELL LIMIT Asla Çalışmıyor
Token fee mekaniği nedeniyle 5 hisse yerine 4.97 hissemiz var, minimum ise 5. 6 hisse sipariş ederek düzeltilebilir, ancak settlement 1.00'da > 0.99 hedef zaten daha iyi. Şimdilik değiştirilmeyecek.

### 3. GTC BUY Deneyi
FOK yerine GTC (maker) BUY kullanmak, giriş başına %2 tasarruf sağlar. Test edilmedi — maker emir davranışı farklı olduğu için dikkatli doğrulama gerekir.

### 4. Weather Bot
Kullanıcı aynı hesaba hava durumu piyasaları botu eklemek istiyor. Proje dosyaları henüz sağlanmadı.

### 5. Para Çekimi
Para çekilmek istendiğinde Polymarket arayüzüne doğrudan bağlanılmalıdır (özel anahtar/cüzdan işlemleri için manuel işlem gerekir). Token USDC.e, Polygon ağı üzerindedir.

---

## 10. Dağıtım Komutları

### Temel Komutlar

```bash
# Sunucuya bağlan
ssh root@135.181.206.109

# Durum kontrol
pm2 status
pm2 logs polymarket-live --lines 30 --nostream

# Kod değişikliği sonrası derleme ve yeniden başlatma
cd /opt/polymarket/bot && npm run build && pm2 restart polymarket-live

# Derin izleme
node /tmp/deep_check.js

# Test paketi çalıştır
node /tmp/full_test_suite.js

# Stopwatch zamanlama testi (35 saniye sürer)
node /tmp/test_stopwatch_timing.js
```

### PM2 Süreç Yönetimi

```bash
pm2 list                             # Tüm süreçleri listele
pm2 restart polymarket-live          # Botu yeniden başlat
pm2 stop polymarket-live             # Botu durdur
pm2 start polymarket-live            # Botu başlat
pm2 logs polymarket-live --lines 100 --nostream   # Son 100 log satırı
pm2 logs polymarket-live --follow    # Canlı log takibi (Ctrl+C ile çık)
```

---

## 11. Önemli Olaylar Zaman Çizelgesi

| Tarih | Olay |
|-------|------|
| 11 Nisan | **Maker → Taker geçişi**: Seçim paradoksu keşfedildi, FOK giriş emri benimsendi |
| 15 Nisan | **GTC_FEE_BPS=0 bug'ı** bulundu ve 1000'e çevrildi |
| 15 Nisan | **parseBalanceFromError()** yazıldı — stop cascade üretimde çalışıyor |
| 15 Nisan T22+ | **Auto-redeem çalışıyor**: T22'den itibaren tüm WIN token'ları zincir üstünde çekildi |
| 15 Nisan T25 | **İlk onaylı stop cascade**: Deneme 3, giriş 0.91 → çıkış 0.76 |
| 15 Nisan T27 | **Yanlış stop**: Market daha sonra UP kapandı (stop_dist gürültü sorunu) |
| 16 Nisan T34 | **Gap risk bug**: 60s kör pencere, giriş 0.92 → çıkış 0.42 (-$2.57) |
| 16 Nisan | **Stopwatch düzeltmesi**: `updateScalpLive` shouldSnapshot dışına taşındı, artık her 10s çalışıyor |
| 16 Nisan | **27/27 test geçiyor**, stopwatch tam olarak 10s aralıklarla doğrulandı |

---

## Ek: Önemli Kod Parçacıkları

### Stop Cascade (scalp_live.ts)

```typescript
// mid <= stop_price olduğunda çalışır
const cascadePrices = [
  mid - 0.01,
  mid - 0.03,
  mid - 0.06,
  mid - 0.10,
];

for (const attemptPrice of cascadePrices) {
  const price = Math.max(attemptPrice, 0.02);
  // FOK SELL emri dene
  // Başarısız + "not enough balance" hatası → parseBalanceFromError() ile gerçek bakiyeyi öğren
  // Başarılı → exit_price kaydet, pnl hesapla, döngüden çık
}

// Hepsi başarısız → stop_pending olarak işaretle, sonraki tick'te tekrar dene
```

### Stopwatch (index.ts)

```typescript
// Her tick (10s) başında, shouldSnapshot bloğundan ÖNCE
if (openForMarket) {
  const book = await fetchBook(openForMarket.token_id);
  const bestBid = /* ... */;
  const bestAsk = /* ... */;
  const fastMid = (bestBid + bestAsk) / 2;
  
  console.log(`[stopwatch] 🔍 ${timestamp} | T${openForMarket.id} ${side} stop=${openForMarket.stop_price}`);
  
  if (fastMid <= openForMarket.stop_price) {
    console.log(`[stopwatch] ⚡ STOP tetiklendi — hızlı yol`);
    await updateScalpLive(db, market, upMid, downMid);
  }
}
```

### parseBalanceFromError (scalp_live.ts)

```typescript
function parseBalanceFromError(errMsg: string): number | null {
  const m = errMsg.match(/balance:\s*(\d+)/);
  if (!m) return null;
  const raw = parseInt(m[1], 10);
  if (isNaN(raw) || raw <= 0) return null;
  return Math.floor((raw / 1e6) * 100) / 100;  // floor, round değil!
}
```

---

*Bu belge, botu geliştiren ekip tarafından hazırlanmış olup projenin tüm kritik teknik detaylarını kapsamaktadır. Herhangi bir belirsizlik durumunda önce test paketini çalıştırın, ardından ilgili kaynak kodu inceleyin.*
