# Polymarket 1 Saatlik BTC Marketlerde Strateji Analizi
**Tarih:** 24 Nisan 2026 | **Kaynak:** 200 saatlik Binance verisi + Polymarket API + karşılaştırmalı analiz  
**Sonuç:** 15dk marketten zayıf — belirli koşullarda kullanılabilir

---

## YÖNETİCİ ÖZETİ

- **BTC 1H mum:** Mean-reverting davranış gösteriyor (UP sonrası UP: sadece %46.4)
- **Yön tahmin avantajı yok** — momentum stratejileri negatif EV üretiyor
- **Tek pozitif EV:** Son 10 dakika entry (50. dakika, 0.78+) → +$0.020/share
- **15dk vs 1H:** 15dk market net olarak üstün (daha fazla fırsat, daha iyi edge, daha az mean-reversion)
- **$30 sermaye için:** 1H market şimdilik tavsiye edilmez, sermaye $200+ olunca değerlendir

---

## 1. 1 SAATLİK MARKET ÖZELLİKLERİ

### Aktif Market Yapısı (Nisan 2026)
| Metrik | Değer |
|--------|-------|
| Günlük pencere sayısı | 24/gün |
| Kaliteli fırsat/gün (0.78+) | 2–3 |
| Tipik hacim/market | $5K–$30K |
| Bid-ask spread | 2–5 cent (midmarket) |
| Fee yapısı | 15dk'ya benzer (crypto: 0.072 feeRate) |
| Maker rebate | Aktif (%20) |
| Settlement kaynağı | Binance 1H mum kapanışı |

**Güncel örnek fiyatlar (BTC 03:00 ET):**
- BTC: DOWN %66 favori (UP %34)
- ETH: UP %73 favori
- BNB: UP %96 (neredeyse kesin)
- SOL: %59/%41

---

## 2. BTC 1H İSTATİSTİKLERİ — 200 SAATLIK VERİ

### Genel Dağılım
| Metrik | Değer |
|--------|-------|
| UP mumlar | 97/200 = **%48.5** |
| DOWN mumlar | 103/200 = **%51.5** |
| Ort. mutlak değişim | **%0.293/saat** |
| >%0.5 hareket | 33/200 = **%16.5** |
| >%1.0 hareket | 3/200 = **%1.5** |

### ⚠️ KRİTİK BULGU: Mean-Reversion
```
UP sonrası bir sonraki saat UP: %46.4  (< %50!)
DOWN sonrası bir sonraki saat UP: %50.0

→ BTC 1H mumu MOMENTUM değil, hafif MEAN-REVERSION gösteriyor.
→ "Geçen saat UP, bu saat de UP" stratejisi istatistiksel olarak YANLIŞ.
```

### Saat Bazlı Analiz (UTC) — ⚠️ Küçük Örneklem (8–9 gözlem/saat)
| Saat UTC | UP% | Yorum |
|----------|-----|-------|
| 04:00–06:00 | ~%78 | Asya ortası — UP bias |
| 09:00 | %12.5 | Avrupa açılışı — DOWN güçlü |
| 11:00 | %75 | Avrupa ortası — UP |
| 14:00–15:00 | %75 | ABD açılışı — UP |
| 16:00 | %12.5 | ABD ortası — DOWN güçlü |

**Uyarı:** 8 günlük veri, her saatte 8–9 gözlem. İstatistiksel anlam için 200+ günlük veri gerekiyor. Hipotez olarak kullan, kesin kural olarak değil.

---

## 3. 1 SAATLİK MARKET İÇİN 4 STRATEJİ

### Strateji 1: Erken Giriş + Momentum (15. dakika, 0.60+)
```
Break-even WR: %60.0
Gerçek WR tahmini: %52–56 (mean-reversion etkisi)
EV = 0.54 × $0.40 – 0.46 × $0.60 = –$0.060/share ❌ NEGATİF
```
**Karar: ÇALIŞMIYOR.** BTC 1H mean-reverting, momentum devam etmiyor.

### Strateji 2: Son 10 Dakika Entry (50. dakika, 0.78+)
```
Break-even WR: %78.0
Gerçek WR tahmini: %79–81 (yön büyük ölçüde netleşti)
EV = 0.80 × $0.22 – 0.20 × $0.78 = +$0.020/share ✅ Marjinal pozitif
Günlük fırsat: 2–3 kez
```
**Karar: SINIRLI ÇALIŞIR.** Küçük pozitif EV var ama fill güçlüğü ve spread bunu eritebilir.

### Strateji 3: Momentum Surfing (İlk 15dk %0.5+ hareket)
```
Frekans: %16.5 (günde ~4 saat)
Giriş: ~0.62–0.65
Gerçek WR tahmini: %55–58
EV = 0.57 × $0.37 – 0.43 × $0.63 = –$0.060/share ❌ NEGATİF
```
**Karar: ÇALIŞMIYOR.** Yeterince güçlü bir BTC hareketi bile devam etmiyor.

### Strateji 4: Market Making (0.48 BID / 0.52 ASK)
```
Spread yakalama: $0.04 per round-trip
Maker rebate: ek %20 üstü
Günlük hacim/market: $5K–$30K → her market'te $20–100 kazanç potansiyeli
```
**Karar: SERMAYE GEREKTİRİR.** $500+ sermayede mantıklı. $30'la çalışmaz.

---

## 4. SAAT BAZLI ENTRY STRATEJİSİ (HİPOTEZ)

Sınırlı veriye göre en güçlü yönsel saatler:
```
Kaçınılacak saatler (DOWN baskılı, kararsız):
  09:00 UTC (Avrupa açılışı volatile)
  16:00 UTC (ABD ortası volatil)

Potansiyel UP saatleri (hipotez):
  04:00–06:00 UTC (Asya ortası, düşük volatilite, hafif UP)
  11:00–12:00 UTC (Avrupa ortası stabilleşme)
  14:00–15:00 UTC (ABD açılışı öncesi momentum)
```

**Not:** Bu saatlerde 0.78+ fiyat oluşursa son 10 dakika entry yapılabilir.

---

## 5. 1H vs 15dk KARŞILAŞTIRMA

| Parametre | 15dk Market | 1H Market | Kazanan |
|-----------|-------------|-----------|---------|
| Günlük fırsat (0.78+) | 8–12 | 2–3 | **15dk** |
| BTC yön güvenilirliği | Zayıf | Daha zayıf (mean-rev) | **15dk** |
| Flash reversal riski | Düşük (2dk kaldı) | Orta (10–50dk kaldı) | **15dk** |
| Market making potansiyeli | Düşük ($10K hacim) | Orta ($30K hacim) | 1H |
| Maker rebate aktifliği | **Yüksek** | Orta | **15dk** |
| Fill kolaylığı | Zor | Orta | 1H |
| Günlük işlem sayısı | 4–8 | 2–3 | **15dk** |

**Karar: 15 dakikalık market net olarak daha iyi.**

---

## 6. 1H MARKET'İN ANLAM KAZANDIĞI DURUM

1H market şu koşullarda değerlendirilmeli:
1. Sermaye $200+ olduğunda (market making mümkün)
2. 15dk stratejisi kanıtlanmış ve sermaye büyüdükten sonra diversifikasyon
3. Güçlü BTC makro trendi varken (günlük 1H mumların %70+ aynı yönde kapandığı dönemler)
4. Saat bazlı analiz için daha fazla veri toplanınca (200+ günlük)

---

## 7. $30 SERMAYE ÖNERİSİ

```
ŞİMDİLİK:  Sadece 15dk market, son 2dk stratejisi
KOŞUL:     Fiyat ≥ 0.80, 11–13. dakika, GTD maker order
BOYUT:     Quarter Kelly (~$2.50/trade, 3 hisse)

1H MARKET:  Şimdilik bekle
KOŞUL:     Sermaye $200+ olunca, son 10 dakika stratejisi
BOYUT:     Quarter Kelly (~$10/trade, 12 hisse @ 0.80)
```

---

## 8. GELECEKTEKİ ARAŞTIRMA HEDEFLERİ

- [ ] Saat bazlı analiz için 60+ günlük BTC 1H verisi topla
- [ ] 1H market settlement sonuçlarını Polymarket API'den çek, 0.78+ girişlerin WR'ini hesapla
- [ ] Hangi UTC saatlerinde BTC 1H trendliliği daha yüksek → istatistiksel test
- [ ] $200 sermayede 1H market making backtest

---

*Rapor: 24 Nisan 2026 | docs/1saatlik-market-stratejisi.md*
