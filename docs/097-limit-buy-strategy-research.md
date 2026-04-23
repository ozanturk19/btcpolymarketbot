# 0.97 Limit Buy Settlement Stratejisi — Araştırma Raporu
**Tarih:** 23 Nisan 2026  
**Yöntem:** 500 kapalı market API analizi + 800 window BTC simülasyonu + CLOB order book verisi  
**Sonuç:** Matematiksel olarak olası ama dar marjlı — detaylar kritik

---

## Strateji Tanımı

UP token 0.97'ye ulaştığında GTC maker limit buy order ile giriş yap, settlement'a kadar bekle.

```
Entry:  0.97 (GTC maker limit — fee = $0)
Win:    UP settle = 1.00 → +$0.03/share
Loss:   DOWN settle = 1.00 → -$0.97/share
Fee:    SIFIR (maker order)
Break-even win rate: 97 / (97 + 3) = %97.0
```

---

## 1. Temel Matematik

| Entry | Break-even WR | Win | Kayıp | 1 Kayıp = kaç win |
|-------|-------------|-----|-------|-------------------|
| 0.90  | %90         | +$10| -$90  | 9 win             |
| 0.92  | %92         | +$8 | -$92  | 12 win            |
| 0.95  | %95         | +$5 | -$95  | 19 win            |
| **0.97** | **%97** | **+$3** | **-$97** | **33 win** |
| 0.99  | %99         | +$1 | -$99  | 99 win            |

---

## 2. Reversal İstatistikleri (Gerçek Veri)

### Genel Market Sonuçları (500 Kapalı Market)
- **5 dakika:** UP settle %50.2 / DOWN settle %49.8
- **15 dakika:** UP settle %49.8 / DOWN settle %50.2
- Genel bakışta 50/50 — hiçbir yön avantajı yok

### 0.97'ye Ulaşınca Reversal Oranları (800 Window Simülasyonu)

| Entry Eşiği | 0.97'ye Ulaşan | WIN (devam) | LOSS (reversal) |
|-------------|---------------|-------------|-----------------|
| 0.90        | %23.4         | %96.3       | **%3.7**        |
| 0.92        | %20.8         | %97.0       | **%3.0**        |
| 0.95        | %17.0         | %97.1       | **%2.9**        |
| **0.97**    | **%13.9**     | **%98.2**   | **%1.8**        |
| 0.99        | %10.5         | %98.8       | **%1.2**        |

**Gerçekçi reversal tahmini @0.97:** %2–3 (simülasyon %1.8, gerçek piyasa frictions dahil %2-3)

---

## 3. EV Analizi

| Reversal Oranı | Win Rate | 1000 Share Sonucu | Karar |
|---------------|----------|-------------------|-------|
| %1.5 | %98.5 | +$15.00 | POZİTİF |
| %2.0 | %98.0 | +$10.00 | POZİTİF |
| %2.5 | %97.5 | +$5.00  | POZİTİF |
| **%3.0** | **%97.0** | **$0.00** | **BAŞA BAŞ** |
| %4.0 | %96.0 | -$10.00 | NEGATİF |

**Tahmini gerçek win rate:** %97.5 → **EV ≈ +$0.005/share**

Bu marj son derece dar. Maker fee avantajı (taker ödemezsin) bu marjı +%7 artırıyor — yani maker olmak stratejinin hayatta kalması için **zorunlu**.

---

## 4. 5 Dakika vs 15 Dakika Karşılaştırması

| Kriter | 5 Dakika | 15 Dakika |
|--------|----------|-----------|
| BTC'nin 0.97'ye taşıması için gereken hareket (4. dakikada) | +%0.10 (~$95) | +%0.18 (~$171) |
| 0.97'ye ulaşma frekansı | **%13.9** | %10.5 |
| Reversal riski | Biraz daha yüksek | **Biraz daha düşük** |
| Kalan süre (0.97'ye ulaşma anında) | ~30–60 saniye | ~5–8 dakika |
| Maker fill şansı | Düşük (az zaman) | Daha yüksek |
| **Genel uygunluk** | ❌ Zor | ✅ Daha iyi |

**Neden 15 dakika daha iyi:**
- 0.97'ye ulaşmak için daha büyük BTC hareketi gerekiyor → daha güçlü sinyal
- Fill olduktan sonra daha fazla zaman var
- Maker order fill için kuyrukta bekleme süresi var

---

## 5. Order Book Gerçeği

0.97'de kalıcı olarak **~21,179 share ASK** var ($20.5K değerinde).

Bu piyasa yapıcı botların standart simetrik emirleri. Maker olarak alış yapmak için bu kuyruğu geride bırakmak gerekiyor:

**Maker fill için gerçek yol:**
1. UP fiyatı 0.95–0.96'dayken 0.97'ye BID koy
2. BTC devam edip 0.97 ASK'ı tüketince senin BID'in dolar
3. Bu durumda maker statüsü korunur — fee = $0

**Sorun:** 0.97 ASK'ta 21,179 share var. Bunlar tükenmeden BID'in dolmaz. Dolmadan market biterse = sıfır işlem.

---

## 6. Timing Analizi

0.97'ye ortalama erişim: **4.6. dakika** (5 dakikalık marketlerde)

- 5. dakikada fill olan order'da settlement'a sadece 20–30 saniye kalıyor
- Bu sürede reversal ihtimali zaten çok düşük → strateji kendi kendini "doğruluyor" ama kâr da minimuma iniyor
- En güvenli senaryo: 1–2. dakikada 0.97'ye ulaşılması → daha fazla risk (daha fazla süre var) ama daha büyük kâr zaman ufku

---

## 7. Fat Tail Riski

**En büyük tehlike:** 1 kayıp = 32 kazancı silgiyor.

Fat tail senaryoları:
- BTC'de ani flash crash (son 30 saniyede %0.5+ düşüş)
- Chainlink oracle gecikmesi / manipülasyon
- Polymarket teknik sorun (settlement manual override)
- Büyük news eventi (Fed açıklaması, ETF rejection)

Bu olaylar nadir (%2–5 yılda birkaç kez) ama olduğunda tüm kâr birikimini sifırlar.

---

## 8. Entry Seviyesi Önerisi

### Psikolojik Sınır vs EV Optimizasyonu

| Öncelik | Önerilen Entry | Neden |
|---------|---------------|-------|
| EV maksimizasyonu | **0.90–0.92** | +$0.035–0.063/share EV, daha sık fırsat |
| Psikolojik denge | **0.95** | +$0.010/share, 1 kayıp = 19 win → tolere edilebilir |
| Güvenlik önceliği | **0.97** | +$0.005/share, %1.8 reversal ama çok dar marj |
| Teorik mükemmel | **0.99** | %1.2 reversal ama 99 win = 1 kayıp, pratik değil |

**Tavsiye:**
- 0.97 matematiksel olarak çalışıyor ama EV o kadar dar ki küçük sapmalar negatife çevirir
- 0.92–0.95 arası: daha iyi EV/risk dengesi
- Her durumda maker order zorunlu — taker olursan EV tamamen negatife döner

---

## 9. Özet Değerlendirme

| Konu | Sonuç |
|------|-------|
| 0.97 reversal oranı (sim) | %1.8 |
| Gerçekçi reversal tahmini | %2–3 |
| Break-even WR | %97.0 |
| Tahmini gerçek WR | %97.5 |
| Teorik EV/share | **+$0.005** (çok dar!) |
| Maker fee avantajı | Zorunlu (+%7) |
| 5m vs 15m | 15m daha uygun |
| En yüksek EV entry | 0.90 (+$0.035/share) |
| Fill garantisi | Yok (kuyruğa bağlı) |
| Fat tail riski | Yüksek (1 kayıp = 32 win) |
| **Genel değerlendirme** | **Mümkün ama dar marjlı — 0.90–0.95 daha iyi EV** |

---

## 10. Kaynaklar

- Polymarket Gamma API: 500 kapalı 5m + 500 kapalı 15m market
- Polymarket CLOB API: Aktif order book analizi
- Binance API: 4000 adet BTC/USDT 1m mum (son 3 gün simülasyon)
- [QuantPedia - Polymarket Mean Reversion](https://quantpedia.com/exploiting-mean-reversion-in-decentralized-prediction-markets/)
- [Finance Magnates - Dynamic Fees](https://www.financemagnates.com/cryptocurrency/polymarket-introduces-dynamic-fees)
- [Medium - 5m Market Strategies](https://medium.com/@benjamin.bigdev/unlocking-edges-in-polymarkets-5-minute-crypto-markets)

---
*Rapor tarihi: 23 Nisan 2026 — Sadece araştırma, aksiyon alınmadı.*
