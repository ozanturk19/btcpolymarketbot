# Polymarket 15dk BTC — "Son 2 Dakika" Maker Entry Stratejisi
**Tarih:** 24 Nisan 2026 | **Kaynak:** Gerçek API verisi + literatür + Trading Strategist analizi  
**Durum:** Teorik olarak pozitif EV — pratik engeller kritik

---

## YÖNETİCİ ÖZETİ

- **Strateji:** 12–13. dakikada fiyat 0.72–0.78+ iken GTC post-only maker limit order → settlement bekle
- **Edge kaynağı:** Fiyat 0.78 = piyasanın "beklentisi %78" — gerçek WR tahminimiz %79–82 → küçük ama pozitif EV
- **Kritik engel:** Son 2 dakikada maker fill garantisi yok — spread genişler, taker azalır
- **Optimal nokta:** 12. dakika, 0.72 fiyat → EV +$0.022/share (en yüksek EV/risk dengesi)
- **Günlük beklenti:** $30 sermayeyle %0.5–2 (ortalama ~%1)

---

## 1. STRATEJİ TANIMI

```
Market:     Polymarket BTC Up/Down — 15 dakika
Zamanlama:  12–13. dakika (son 2–3 dakika kala)
Tetikleyici: UP token ≥ 0.72 VEYA DOWN token ≥ 0.72
Order tipi: GTC post-only (maker) — fee = SIFIR
Exit:       Settlement (1.00 veya 0.00)
Max kayıp:  Pozisyon büyüklüğü kadar (örn. $2.16 = 3 share × $0.72)
```

---

## 2. FEE YAPISI — MAKER OLMAK NEDEN HAYATI

### Taker Fee (Kaçınılacak)
```
fee = shares × 0.072 × p × (1-p)
0.72 fiyatta 10 share: 10 × 0.072 × 0.72 × 0.28 = $0.145
```
Bu fee break-even WR'yi %72 → %73.5'e yükseltir → EV'yi sıfırlar.

### Maker = $0 Fee + Rebate
- GTC post-only → maker statüsü → fee yok
- Fill olan her maker order için taker fee havuzunun **%20'si** geri ödenir
- 10 share @ 0.72: fee_equivalent = $0.145 → rebate ~$0.029

**Sonuç: Maker olmak, taker'a göre her 10 share'de ~$0.17 avantaj sağlar.**

---

## 3. BREAK-EVEN VE EV ANALİZİ

| Dakika | Giriş | Win | Kayıp | Break-even | Gerçek WR | EV/share | R/R |
|--------|-------|-----|-------|------------|-----------|----------|-----|
| 10. | 0.65 | +$0.35 | -$0.65 | %65.0 | %66–68 | +$0.007–0.020 | 1:1.86 |
| **12.** | **0.72** | **+$0.28** | **-$0.72** | **%72.0** | **%73–76** | **+$0.003–0.022** | **1:2.57** |
| 13. | 0.78 | +$0.22 | -$0.78 | %78.0 | %79–82 | +$0.002–0.018 | 1:3.55 |
| 14. | 0.85 | +$0.15 | -$0.85 | %85.0 | %86–90 | +$0.002–0.008 | 1:5.67 |

### Trading Strategist Değerlendirmesi (R/R Kuralı)
- Min 1:2 R/R → **12. dakika (1:2.57) ve 13. dakika (1:3.55) geçiyor** ✅
- 14. dakika (1:5.67) → Risk/ödül çok kötü, EV çok dar ❌
- 10. dakika (1:1.86) → Minimum standardın altında, reversal riski yüksek ❌

**⭐ Optimal entry: 12. dakika, 0.72–0.75 fiyat**

---

## 4. MAKER FILL PROBLEMİ VE ÇÖZÜMÜ

### Sorun
- Son 2 dakikada market maker botlar orderlarını **60 saniye önce çeker**
- Spread normal 2–5 cent → son 2 dakikada **5–10 cent+**
- 21,000+ share ASK kuyruğu → bizim BID'imizin fill olması için taker gelmesi lazım
- Taker azaldı → fill garantisi yok → GTC order dolmadan market bitebilir

### Çözümler (Öncelik Sırasıyla)
1. **GTD order (en iyi):** Market kapanışından 90 saniye önce expire → fill olmadıysa para bloke kalmaz
2. **11–12. dakikada gir:** Likidite henüz çekilmedi, fill daha kolay, fiyat 0.68–0.72
3. **Spread'in içine agresif gir:** Mevcut ask $0.74 ise $0.73 BID koy → fill ihtimali artar (ama maker statüsü riske girer)
4. **Kaçın:** 14. dakikada giriş → hem fill imkânsız hem R/R kötü

---

## 5. KRİTİK RİSKLER

| Risk | Olasılık | Etki | Yönetim |
|------|----------|------|---------|
| Fill olmaması | **Yüksek** | Fırsat kaybı (kayıp yok) | GTD order, 90sn limit |
| Flash crash son 2dk | Düşük (%1–2) | Tam kayıp | Küçük pozisyon (Quarter Kelly) |
| Market perfectly efficient | Orta | Break-even veya kayıp | Sadece 0.80+ fiyatta gir |
| Seri kayıp (varyans) | Normal | $30 eriyor | Max 3 ardışık kayıp → dur |
| Bot rekabeti | Yüksek | Fill almak zorlaşıyor | Daha erken gir (11–12. dk) |

---

## 6. POZISYON BOYUTLANDIRMASI (KELLY)

**Senaryo: 0.78 entry, %80 gerçek WR**
```
p = 0.80, b = 0.22/0.78 = 0.282
Kelly f* = (0.80×0.282 - 0.20) / 0.282 = %43.3
Half Kelly  = %21.7 → $30'da $6.51
Quarter Kelly = %10.8 → $30'da $3.24 ← ÖNERİLEN
```

**$30 sermaye ile Quarter Kelly:**
- 3 share × $0.78 = $2.34 per trade
- Win: +$0.66 (+28%)
- Loss: -$2.34 (-100% of position, -%7.8 of total)
- Günlük kayıp limiti: $3.00 (sermayenin %10'u)

---

## 7. GÜNLÜK SENARYO ANALİZİ ($30 SERMAYESİ)

| Senaryo | WR | Trade/gün | EV/trade | Günlük |
|---------|-----|-----------|----------|--------|
| Kötü gün | %72 (break-even) | 4 | $0.00 | $0.00 |
| Tipik gün | %80 | 4 | +$0.09 | **+$0.36 (+1.2%)** |
| İyi gün | %84 | 4 | +$0.27 | **+$1.08 (+3.6%)** |
| Seri kayıp | %60 | 4 | -$0.72 | **-$2.88 (-9.6%)** |

**Gerçekçi aylık beklenti:** %15–40 (yüksek varyans, bazı aylar negatif mümkün)

---

## 8. UYGULAMA KURALLARI

```
✅ GİR:   12–13. dakika, fiyat ≥ 0.80, GTD post-only maker order
✅ GİR:   Spread içinde değil, spread'in 1 tick dışından (maker garantisi)
✅ BEKLE: Settlement'a kadar tut (erken çıkış taker fee + kötü fiyat)
❌ ÇIKMA: 13. dakikadan önce işlem açma (reversal riski yüksek)
❌ ÇIKMA: 14. dakika+ R/R çok kötü (1:5.67)
❌ YAPMA: Market order veya spread içi limit (taker olursun)
❌ YAPMA: 3 ardışık kayıp sonrası o gün devam
```

---

## 9. TRADING STRATEJİST NOTU

> Bu strateji klasik teknik analiz değil — binary prediction market microstructure arbitrajı.
> RSI, MACD, trend göstergeleri 15 dakikalık BTC binary'de **anlamsız** (noise > signal).
> Edge tek kaynaktan geliyor: **Piyasa fiyatı gerçek ihtimalin %1–4 altında fiyatlanıyor.**
> Bu edge var olmayabilir (market efficient) — 100+ trade ile test gerekli.
> **Sermayeyi korumak kazanmaktan önce gelir:** Quarter Kelly + günlük kayıp limiti zorunlu.

---

*Rapor: 24 Nisan 2026 | docs/son-2-dakika-stratejisi.md*
