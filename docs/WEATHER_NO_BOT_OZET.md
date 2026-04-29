> **ESKİ DOSYA** — Güncel bilgi için: `/opt/polymarket/bot/CLAUDE.md`

> ⚠️ **ESKİ DOSYA** — Güncel bilgi için: 

# Weather NO Bot — Durum Özeti
*Güncelleme: 24 Nisan 2026*

---

## 🎯 Strateji Özeti

**"Fade the Impossible"** — Hava durumu tahmin modelimiz kesin olmayacak dediği bucket'larda piyasanın abartılı fiyatladığı YES'e karşı NO alınır.

```
Model: Ankara yarın 16.3°C olacak
Piyasa: 19°C bucket'ı %7.5 olasılık fiyatlıyor
Gerçek şans: <%2 (4.7°C uzakta)
→ NO'yu 0.92'den al, 0.99'da sat → EV ~%7
```

---

## 🤖 Bot Dosyaları

| Dosya | Açıklama |
|-------|---------|
| `/opt/polymarket/bot/weather_no_bot.ts` | Ana bot (TS) |
| `/opt/polymarket/bot/data/weather_no_trades.json` | Trade geçmişi |
| `/opt/polymarket/bot/logs/weather_no_scan.log` | Scan logları |
| `/opt/polymarket/bot/logs/weather_no_fills.log` | Fill logları |
| `/root/weather/` | Python weather modeli — **DOKUNMA** |

---

## ⚙️ Bot Parametreleri

| Parametre | Değer | Açıklama |
|-----------|-------|---------|
| `SHARES` | 6 | Her pozisyon kaç share |
| `YES_PRICE_MIN` | 0.04 (4%) | Minimum YES fiyatı filtresi |
| `YES_PRICE_MAX` | 0.15 (15%) | Maximum YES fiyatı filtresi |
| `DIST_MIN_C` | 2.0°C | Blend-bucket minimum mesafe |
| `AUTO_SELL_PRICE` | 0.997 | Hedef satış fiyatı |
| `AUTO_SELL_FALLBACK` | 0.99 | tick=0.01 ise fallback (snap) |
| `MIN_USDC_RESERVE` | $5 | Bu altında emir açılmaz |
| `MAX_OPEN` | 20 | Max eş zamanlı pozisyon |

---

## ⏰ Cron Zamanlaması

| Zaman (UTC) | Komut | Görev |
|-------------|-------|-------|
| 05:05, 11:05, 17:05, 23:05 | `scan` | Fırsat tara, BUY NO aç |
| Her 15 dakika | `check-fills` | Fill kontrolü + auto-sell |
| 05:30, 11:30 | `cancel-stale` | 4+ saatlik boş emirleri iptal |

---

## 📊 Aktif Pozisyonlar (24 Nisan 2026 itibarıyla)

| Şehir | Bucket | Blend | Dist | Buy | Settlement |
|-------|--------|-------|------|-----|-----------|
| Ankara | 19°C NO | 16.3°C | 2.7°C | 0.92 | 25 Nisan |
| Paris | 24°C NO | 21.5°C | 2.5°C | 0.93 | 25 Nisan |
| Helsinki | 5°C NO | 7.1°C | 2.1°C | 0.94 | 25 Nisan |
| Tokyo | 20°C NO | 17.5°C | 2.5°C | 0.93 | 25 Nisan |

**Toplam risk:** ~$22.32 | **Status:** LIVE (fill bekliyor)

---

## ❓ Sık Sorulan Sorular

### "Polymarket Activity'de göremiyorum"
**Normal.** LIVE emir = açık limit order, henüz fill olmadı.
- Polymarket **Activity** = tamamlanan işlemler (fill olmuş)
- Polymarket **Open Orders** = bekleyen emirler ← **buraya bak**
- Balance hâlâ $20.22 çünkü maker GTC emirlerde USDC fill anında kilitlenir

### "Bugünkü (24 Nisan) marketler neden taranmıyor?"
24 Nisan marketleri **settlement yakın** — likidite sıfıra yakın, fiyatlar zaten resolve olmuş durumda. Bot doğru davranıp geçiyor.

### "London 16°C gibi düşük YES bucket'lar neden yakalanmıyor?"
YES=0.4% olan bucket'ta NO almak mantıklı değil:
- Max kazanç: 6 share × 0.004 = **$0.024** (2 kuruş)
- Filtre `YES_PRICE_MIN=0.04` bunu doğru geçirmiyor

---

## 🔧 Kritik Teknik Bilgi

### Token ID Yapısı (Çözülmüş Sorun)
```
Weather API condition_id  = YES token ID (decimal string)
gamma events API arşivinden: clobTokenIds[0] = YES, clobTokenIds[1] = NO
Doğru lookup: events?slug={slug} → YES token ile eşleştir → NO token al
```
Önceki hata: hex dönüşümü yapılıyordu, eşleşme olmuyordu → "Fallback" devreye giriyordu → "invalid signature".

### negRisk Nedir?
Weather marketleri negRisk formatındadır. 11 bucket birbirine bağlıdır, sadece biri YES olabilir. negRisk markette NO token imzalamak için özel sözleşme (negRiskAdapter) kullanılır. CLOB client'a `negRisk: true` verilmesi şart.

---

## 💰 Geçmiş İşlemler

| Tarih | İşlem | Sonuç |
|-------|-------|-------|
| 24 Nisan | Ankara 12°C NO @ 0.94 (5 share, manuel) | MATCHED → sold @ 0.99 → **+$0.48 (+5.1%)** |
| 24 Nisan | Ankara 12°C NO @ 0.94 (duplicate, 5 share) | MATCHED → 1 share @ 0.97 kaldı (settlement bekle) |

---

## 📋 Bot Komutları

```bash
cd /opt/polymarket/bot

# Fırsat tara + emir aç
npx ts-node weather_no_bot.ts scan

# Fill kontrolü + auto-sell
npx ts-node weather_no_bot.ts check-fills

# Açık pozisyon durumu
npx ts-node weather_no_bot.ts status

# Stale emirleri iptal et
npx ts-node weather_no_bot.ts cancel-stale
```

---

## ⚠️ Dikkat

- `/root/weather/` klasörüne **kesinlikle dokunma** — Python weather bot ayrı çalışıyor
- Python weather bot YES alır, bu bot NO alır — çakışma yok
- Bakiye $5 altına düşerse bot otomatik durur
