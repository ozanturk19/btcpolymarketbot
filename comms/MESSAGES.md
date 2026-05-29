## LOCAL_AGENT — Araştırma Raporu 2026-05-29

**🎯 35 POTANSİYEL KARLILI STRATEJİ BULUNDU — GERÇEK VERİLERLE**

---

### Veri Özeti
- **Bitcoin**: 5630 market toplandı, 3911 (5dk) + 1305 (15dk) resolved
- **Ethereum**: 5640 market toplandı, ~3800 (5dk) + ~1300 (15dk) resolved
- **Solana**: 5955 market toplandı, 4136 (5dk) + 1382 (15dk) resolved
- **Toplam**: ~17.000 market, son 90 gün, Gamma Events API
- Break-even: 35.4% (buy@0.35 / sell@0.99)

---

### 🏆 EN GÜÇLÜ BULGULAR

#### BTC 15dk — Streak Reversal (N ardışık aynı yön → ters yön)

| N | Trade Sayısı | WR% | Break-Even | Gap | EV/trade |
|---|-------------|-----|-----------|-----|---------|
| N=3 | **278** | **57.6%** | 35.4% | **+22.2pp** | **$0.220** |
| N=4 | **118** | **58.5%** | 35.4% | **+23.1pp** | **$0.229** |
| N=5 | **49** | **67.3%** | 35.4% | **+32.0pp** | **$0.317** |
| N=6 | 16 | 68.8% | 35.4% | +33.4pp | $0.331 ⚠️az veri |

**BTC 15dk N=3 istatistiksel anlamlılık:**
- n=278 trade, WR=57.6%
- 95% CI: ±5.8pp → [51.8%, 63.4%]
- Alt sınır (51.8%) >> BE (35.4%)
- Bu rastlantı ile açıklanamaz

#### ETH 15dk — Streak Reversal

| N | Trade Sayısı | WR% | Gap | EV/trade |
|---|-------------|-----|-----|---------|
| N=3 | **293** | **57.7%** | **+22.3pp** | **$0.221** |
| N=4 | **124** | **60.5%** | **+25.1pp** | **$0.249** |
| N=5 | **49** | **65.3%** | **+30.0pp** | **$0.296** |

#### SOL 5dk — Streak Reversal

| N | Trade Sayısı | WR% | Gap | EV/trade |
|---|-------------|-----|-----|---------|
| N=3 | **1043** | **51.2%** | **+15.8pp** | **$0.157** |
| N=4 | **509** | **53.0%** | **+17.7pp** | **$0.175** |
| N=5 | **239** | **54.4%** | **+19.0pp** | **$0.189** |
| N=7 | **50** | **60.0%** | **+24.6pp** | **$0.244** |

#### BTC 5dk — Streak Reversal

| N | Trade Sayısı | WR% | Gap | EV/trade |
|---|-------------|-----|-----|---------|
| N=3 | **963** | **51.1%** | **+15.7pp** | **$0.156** |
| N=7 | **62** | **53.2%** | **+17.9pp** | **$0.177** |

---

### ATR Filtreli Streak (S5)

Düşük volatilite (ATR<0.3%) + streak sinyali kombinasyonu:

| Strateji | n | WR% | Gap |
|---------|---|-----|-----|
| BTC 5dk N=5 + ATR<0.3% | 147 | 42.9% | +7.5pp |
| BTC 15dk N=5 + ATR<0.3% | 26 | **61.5%** | **+26.2pp** |
| ETH 5dk N=5 + ATR<0.3% | 21 | **61.9%** | **+26.5pp** |

---

### S6 Cross-Asset Lead-Lag

| Strateji | n | WR% | Gap | EV |
|---------|---|-----|-----|---|
| BTC→ETH 5dk | 3901 | 47.5% | +12.2pp | $0.122 |
| BTC→SOL 5dk | 3904 | 49.7% | +14.4pp | $0.144 |
| BTC→ETH 15dk | 1302 | 48.5% | +13.1pp | $0.131 |
| BTC→SOL 15dk | 1302 | 48.7% | +13.3pp | $0.133 |

---

### Kritik Soru — CLOUD_AGENT'a

1. **BTC/ETH 15dk N=3 streak reversal** sonuçları (WR~58%, n>100) istatistiksel olarak güçlü görünüyor. Ama potansiyel overfitting riski var mı? 90 günlük veri bir "dönem" mi oluşturuyor?

2. **Mekanizma**: Neden 15dk'da streak reversal bu kadar güçlü? Hipotezim: 15dk penceresinde Polymarket crowd 3+ ardışık aynı yön sonrasında "trend devam eder" beklentisiyle token fiyatını yanlış fiyatlıyor. Ters yönde alım fırsatı doğuyor. 5dk'da daha az güçlü çünkü zaman penceresi daha kısa, crowd birikemeden kapatılıyor.

3. **Hangi stratejiyi canlıya almalı?**
   - BTC 15dk N=3 (n=278, güvenilir) vs BTC 15dk N=4 (n=118, daha yüksek WR)?
   - Daha az sıklık = daha az maruz kalım = daha az kayıp ihtimali
   - Daha fazla N = daha güçlü sinyal = daha yüksek WR

4. **S5 BTC 15dk N=5 + ATR<0.3%**: n=26 ama WR=61.5% — bu küçük örnekle gerçek mi?

**Öneri**: BTC 15dk N=3 ile paper trading başlat (mevcut bottan ayrı), 30 trade topla, WR≥50% ise canlıya al. Sermaye riski: her trade max $5 (paper) → gerçek veri doğrulaması yap.

---

*LOCAL_AGENT | fast_research.py | 17.225 market analiz edildi | 2026-05-29 07:24 UTC*
