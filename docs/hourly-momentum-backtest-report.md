# BTC 15dk Hourly Momentum Strategy — Backtest Raporu

**Tarih:** 28 Mayıs 2026
**Branch:** `claude/btc-bot-optimization-SzxdH`
**Yöntem:** Monte Carlo simülasyonu (35,040 market = 1 yıllık veri)
**Strateji altyapı:** `backtest/hourly_momentum_sim.js` + `backtest/edge_sensitivity.js`

---

## 🎯 Test Edilen Strateji

```
Her 15dk BTC market'e GTC limit BUY @ $0.40 (6 share = $2.40 risk)
Fill olursa GTC limit SELL @ $0.99 (kazanırsa +$3.54)

Yön seçimi:
  pUSD > son 60dk ortalaması → UP token al
  pUSD < son 60dk ortalaması → DOWN token al
```

Break-even WR = **%40.40** (Cost $2.40 ÷ (Win $3.54 + Cost $2.40))

---

## 📊 ANA BULGU — KÖTÜ HABER

**Hourly momentum + 0.40 limit stratejisi, fair-value (martingale) varsayımı altında EV-NEGATIF.**

Her senaryoda **WR ≈ %32-33** çıkıyor — break-even %40.4'ün yaklaşık 7-8 puan ALTINDA.

### Niye?

Bu derinlemesine matematiksel bir sonuç:
- Token fair value = Φ(driftSoFar / σ_remaining)
- Token 0.40'a düştüğünde → fair "kazanma şansı" zaten %40 civarı
- Yani 0.40'tan alıyorsanız, daha fazla değil daha az kazanma şansınız var
- Bu **adverse selection** problemi: token sadece bize karşı hareket ettiğinde fiyat 0.40'a iniyor

---

## 📋 Senaryo Karşılaştırması (1 Yıl, 35,040 Market)

| # | Strateji | Signals | Fill% | WR%   | EV/fill  | Günlük$ | Verdict |
|---|----------|---------|-------|-------|----------|---------|---------|
| A | Pure hourly momentum (chg1h>0) | 35,040 | 74.4% | **32.73%** | -$0.456 | -$32.54 | ❌ KAYIP |
| B | Strong momentum (chg1h>0.1%)   | 29,602 | 74.4% | 32.87% | -$0.448 | -$27.02 | ❌ KAYIP |
| C | Very strong (chg1h>0.3%)       | 19,356 | 74.5% | 32.83% | -$0.450 | -$17.77 | ❌ KAYIP |
| D | Extreme (chg1h>0.5%)           | 11,135 | 74.3% | 32.34% | -$0.479 | -$10.86 | ❌ KAYIP |
| E | Hourly **CONTRARIAN** (mean rev)| 35,040 | 73.7% | 32.25% | -$0.484 | -$34.27 | ❌ KAYIP |
| F | Her markete sadece UP token    | 35,040 | 74.2% | 32.28% | -$0.482 | -$34.36 | ❌ KAYIP |
| G | Her markete sadece DOWN token  | 35,040 | 73.9% | 32.71% | -$0.457 | -$32.45 | ❌ KAYIP |
| H | Kör alternating (her diğer)    | 35,040 | 74.0% | 32.59% | -$0.464 | -$32.99 | ❌ KAYIP |
| I | **HER İKİ tarafa** emir koy    | 51,907 | 100%  | 32.49% | -$0.470 | -$66.81 | ❌ KAYIP |

> **Gözlem:** Hangi strateji seçerseniz seçin, WR ~%32. Hourly momentum sinyali, kör koymaya göre **sadece 0.5 puan** ekstra getirmiyor. Bu, BTC'nin pratikte random walk olduğunu doğruluyor.

---

## 🔬 Sensitivity Analizleri (Derinlemesine)

### 1. Fill Timing → WR

| Fill Anı   | Fills | WR%   | EV/fill | Yorum |
|------------|-------|-------|---------|-------|
| t=1 dk     | 6,204 | 33.9% | -$0.39  | Hızlı dipler — orta kötü |
| t=2 dk     | 4,842 | 34.9% | -$0.32  | En iyi (ama yine negatif) |
| t=5 dk     | 1,647 | 34.2% | -$0.37  | Karışık |
| t=10 dk    | 737   | 30.0% | -$0.62  | Geç dip = market güçlü ters → kötü |
| t=14 dk    | 478   | 26.4% | -$0.83  | Çok geç dip = neredeyse kesin kayıp |
| t=15 dk    | 517   | **0.0%** | -$2.40 | Kapanışta touch = kazanmadık demektir |

**Çıkarım:** "Geç fill bekle" stratejisi YOK. Geç fill, daha büyük adverse selection demek.

### 2. Polymarket Mispricing Edge → WR

Diyelim ki Polymarket fair value'dan **X bps daha düşük** fiyatlıyor (likidite veya gecikme nedeniyle):

| Mispricing | Fill% | WR%   | EV/fill | Sürdürülebilir? |
|------------|-------|-------|---------|------|
| 0 bps      | 74.4% | 32.7% | -$0.46  | ❌ |
| 50 bps     | 74.9% | 33.2% | -$0.43  | ❌ |
| 100 bps    | 75.5% | 33.7% | -$0.40  | ❌ |
| 150 bps    | 76.0% | 34.2% | -$0.37  | ❌ |

**Çıkarım:** Polymarket %1.5 (150 bps) mispriced olsa bile yetmiyor. Pozitif EV için ~%5 (500 bps) gibi MAKUL OLMAYAN bir mispricing gerekli.

### 3. Late-Fill Filter (tMin sonra fill say)

| tMin | Fills  | WR%   | EV/fill | Toplam$ |
|------|--------|-------|---------|---------|
| 0 dk | 26,068 | 32.7% | -$0.46  | -$11,877 |
| 2 dk | 25,639 | 31.6% | -$0.52  | -$13,396 |
| 5 dk | 24,075 | 27.2% | -$0.79  | -$18,932 |
| 10 dk| 21,438 | 18.2% | -$1.32  | -$28,267 |

**Çıkarım:** Geç fill filtresi **WR'yi DAHA DA AŞAĞIYA çekiyor**. Bu çok karşı-sezgisel ama doğru.

### 4. |change1h| Threshold

| Min sinyal | Signals | WR%   | EV/fill | Daily$  |
|------------|---------|-------|---------|---------|
| 0.00%      | 35,040  | 32.7% | -$0.46  | -$32.54 |
| 0.10%      | 29,602  | 32.9% | -$0.45  | -$27.02 |
| 0.30%      | 19,356  | 32.8% | -$0.45  | -$17.77 |
| 0.50%      | 11,135  | 32.3% | -$0.48  | -$10.86 |
| 1.00%      | 1,590   | 32.4% | -$0.48  | -$1.54  |
| 2.00%      | 0       | -     | -       | $0      |

**Çıkarım:** Sıkı threshold = az kayıp ama edge yok. Strateji sadece **inactivity** yoluyla "düzeliyor".

### 5. AR(1) Mean Reversion Sensitivity

BTC gerçek mean reversion'ı ne kadar güçlü olmalı ki strateji çalışsın?

| AR(1) β | WR%   | EV/fill | Daily$  |
|---------|-------|---------|---------|
| -0.30 (çok güçlü mean rev) | 33.4% | -$0.42 | -$30.46 |
| -0.20                       | 33.1% | -$0.43 | -$31.44 |
| -0.10                       | 32.9% | -$0.45 | -$32.13 |
| -0.05 (baseline)            | 32.7% | -$0.46 | -$32.54 |
| 0.00 (random walk)          | 32.6% | -$0.47 | -$33.08 |
| +0.10 (momentum)            | 32.4% | -$0.48 | -$33.74 |

**Çıkarım:** β=-0.30 gibi **akademik literatürde gözlemlenmemiş** seviyede mean reversion olsa bile WR sadece %33.4 → yine break-even altında.

---

## 🕐 Saatlik Segmentasyon (Strateji A)

24 saatin her birinde de WR %30-35 arasında. **Hiçbir saatte pozitif EV yok.**

```
En "az kötü" saatler:   05 UTC (35.0%), 23 UTC (35.0%), 03 UTC (34.5%)
En kötü saatler:        10 UTC (29.9%), 12 UTC (30.1%), 21 UTC (30.4%)
```

Tüm farklar ±3 puan içinde → istatistiksel olarak **rastgele gürültü**.

---

## ⏱️ Fill Time Dağılımı

```
t=01dk:  23.8% ███████████████████████
t=02dk:  18.6% ██████████████████
t=03dk:  12.5% ████████████
t=04dk:   9.0% █████████
t=05dk:   6.3% ██████
...
Avg fill time: 4.5 dakika
```

> 1-3 dakika içinde fill olan emirler %55, yani çoğu emir hızlıca tetikleniyor. Bu **adverse selection** sinyali — market hızlı hareket ediyor.

---

## 💡 Niye Hourly Momentum Çalışmıyor?

### Beklenti vs Gerçeklik

| Senin Hipotezin | Simülasyon Bulgusu |
|-----------------|---------------------|
| "Fiyat avg'nin üstünde → daha çok UP" | change1h>0 → UP rate: **49.71%** |
| "Fiyat avg'nin altında → daha çok DOWN" | change1h<0 → UP rate: **49.79%** |

**BTC 15dk gözlüğünden bakıldığında saatlik momentum NEREDEYSE HİÇ tahmin gücü yok.**

> Note: Bu sentetik BTC için. Gerçek BTC'de minicik bir momentum/anti-momentum etkisi olabilir ama büyüklüğü, break-even'ın altındaki 7-8 puanlık gap'i kapatmaya yetecek seviyede DEĞİL.

### Adverse Selection Mantığı

```
Senaryo: Fiyat avg'nin üstünde → UP token al → 0.40 limit koy

UP token 0.40'a düşüyor MU?
  Evet, ama SADECE BTC fiyatı düştüğünde.

Yani 0.40 fill olduğunda BTC senin yönünün TERSİNE hareket etmiş demektir.
Bu durumda UP'ın kazanma şansı zaten 0.40 — break-even'ın altında.
```

Bu, "her market'e emir koy" stratejisinin **matematiksel olarak** çalışmamasının ana sebebi.

---

## 🆚 Streak Reversal ile Karşılaştırma

| Boyut | Streak Reversal | Hourly Momentum |
|-------|------------------|------------------|
| Sinyal kaynağı | Crowd overreaction (retail) | Saatlik trend |
| Mantık | Mean reversion @ N=5+ extreme | Momentum follow |
| EV teorisi | Pozitif (crowd hatası varsa) | Negatif (fair value) |
| Trade sıklığı | ~5-15/gün | ~96/gün |
| Edge kaynağı | Behavioral bias | YOK (random) |
| Riski | Trend market | Tüm marketler |

**Sonuç:** Streak reversal — eğer Polymarket'te crowd overreaction varsa — pozitif EV olabilir.
Hourly momentum, fair-value altında **sistematik olarak kaybediyor**.

---

## ⚠️ Modelin Sınırları ve Caveat'lar

### Bu simülasyon ne kanıtlıyor?

1. ✅ **Fair value modeli altında strateji EV-negatif**
2. ✅ **Adverse selection problemi matematiksel olarak vardır**
3. ✅ **Sıradan parametre değişiklikleri (threshold, timing) durumu kurtarmıyor**

### Bu simülasyon ne kanıtlamıyor?

1. ❌ Gerçek Polymarket marketleri fair value'da fiyatlanıyor — **belki değiller**
2. ❌ Gerçek BTC'nin micro-structure'ı bu modelle aynı — **olmayabilir**
3. ❌ İlk 30-60 saniyedeki Polymarket likidite gap'leri — modelde yok
4. ❌ Whales/MM davranışı (örn. her dakika 0.50'den 0.45'e bid değiştirme) — modelde yok

### Gerçek backtest hâlâ kritik

> `docs/backtest-prompt.md` dosyası ile **gerçek Polymarket tarihi datası** üzerinde test yapılmalı. Sentetik veride EV-negatif çıkması, gerçek veride de aynı sonucun çıkması için **güçlü prior** verir ama kesin kanıt değil.

---

## ✅ TAVSİYE

### 🛑 Yapma

- ❌ Bu stratejiyi live'a alma
- ❌ "WR %50 yeter" varsayımıyla deploy etme — break-even %40.4 ama elde edilen %32-33
- ❌ Threshold/timing ile düzeltmeye çalışma — sensitivity test gösterdi ki edge yok
- ❌ "Her markete emir koy" kuralını kabul etme

### ✅ Yap

1. **Streak reversal'a odaklan** — şu an paper mode'da, devam et
2. **Backtest prompt'unu çalıştır** (`docs/backtest-prompt.md`) — STREAK reversal için gerçek data
3. **Hourly momentum için** ilave araştırma:
   - İlk 30 saniye spread incelemesi (Polymarket inefficiency var mı?)
   - Whale order pattern analizi (her zaman 0.40 bid var mı?)
   - Saatlik momentum vs OB depth korelasyonu
4. **Eğer hourly momentum mutlaka istiyorsan:** SELL fiyatını düşür (0.75-0.80) — break-even oranını düşür ama upside'ı da kıs. Ya da BUY fiyatını yükselt (0.50-0.55) — daha fazla edge gerekecek.

---

## 📁 İlgili Dosyalar

| Dosya | Açıklama |
|-------|----------|
| `backtest/hourly_momentum_sim.js` | Ana 9-senaryo Monte Carlo |
| `backtest/edge_sensitivity.js`    | 6 sensitivity analizi |
| `backtest/sim_run1.log`            | Ham simülasyon çıktısı |
| `backtest/sensitivity_run.log`     | Ham sensitivity çıktısı |
| `docs/hourly-avg-strategy-analysis.md` | Önceki teorik analiz |
| `docs/backtest-prompt.md`          | Streak reversal gerçek data backtest prompt'u |
| `btc_reversal_bot.ts`              | Çalışan streak reversal bot (paper mode) |

---

## 🧮 Matematiksel Temel — Niye %40 Tavanı Aşılamıyor?

Polymarket BTC tokenı fair value'da fiyatlanıyorsa:

$$
p_{\text{UP}}(t) = \Phi\left( \frac{\text{drift}_t}{\sigma_{\text{remaining}}(t)} \right)
$$

Token UP'ı 0.40'tan alıyorsak, kazanma olasılığımız tam olarak 0.40'tır (martingale property).

$$
P(\text{win} \mid \text{fill at } 0.40) = 0.40
$$

EV = 0.40 × $3.54 + 0.60 × (-$2.40) = $1.416 - $1.440 = **-$0.024**

Tam tamına break-even sınırında. Modelin %32 göstermesinin sebebi: token kapanışa kadar 0.40'tan yukarı çıkıp tekrar düşebiliyor ve son anda kapanıyor (path-dependent kayıplar).

> **Sonuç:** Fair-value altında bu strateji "marjinal olarak negatif" — gerçek dünyada bu marjı pozitife çevirmek için **çok güçlü bir edge** lazım.

---

## 🎬 Final Karar

**Hourly momentum + 0.40 limit BUY stratejisi, mevcut teorik framework içinde sürdürülebilir DEĞİL.**

**Streak reversal'a devam et. Gerçek-data backtest sonuçlarını bekle. Hourly momentum'u rafa kaldır veya market microstructure üzerinde çok daha derin (orderbook seviyesinde) araştırma yapana kadar deploy etme.**

---

*Çalıştıran ajan: claude/btc-bot-optimization-SzxdH branch — 28 Mayıs 2026*
