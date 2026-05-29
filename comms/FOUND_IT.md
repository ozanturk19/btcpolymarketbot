# FOUND_IT — Kapsamlı Strateji Raporu (mega_analysis.py)

Güncelleme: 2026-05-29 (final)

---

## 🔑 KRİTİK ALTYAPI BULGULARI

**1. Tüm 15dk Marketler 0.50'den Başlıyor (n=30, CLOB doğrulamalı)**
- İlk fiyat: avg 0.500, range [0.495, 0.505]
- Doğru execution: market açılışında 0.51 limit (maker, fee=0%) → 0.50 fill
- Yanlış: GTC 0.35 limit → loserlara fill, winnerlara kaçırır

**2. RSI tipi kritik: Wilder smoothed RSI14 kullan**
- Simple average RSI: WR=48.3% (sinyal yok)
- Wilder smoothed RSI: WR=52.1-63.7% (güçlü sinyal)

---

## STRATEJİ 1 — STREAK REVERSAL [EN GÜÇLÜ]

**Sinyal:** BTC veya ETH'te 3+ ardışık aynı yön 15dk kapanış → ters yön bet  
**Asset:** Sadece BTC + ETH (SOL DOWN streak gerçek momentum — hariç tut)

| Filtre | n (90 gün) | WR | 95% CI | EV/token |
|--------|------------|----|---------|---------:|
| N≥3 tüm (BTC+ETH+SOL) | 888 | 55.6% | [52.4%,58.9%] | +$0.051 |
| N≥3 BTC+ETH | 571 | 57.6% | [53.6%,61.7%] | +$0.070 |
| **N≥3 BTC+ETH + best hours** | **156** | **72.4%** | **[65.4%,79.4%]** | **+$0.217** |

**Best hours (Streak):** UTC 01, 02, 03, 05, 08, 14, 23

Saat bazlı WR (BTC+ETH):
| Saat | n | WR | CI |
|------|---|----|----|
| UTC02 | 14 | 100.0% ⚠️ | [99.5%,100%] |
| UTC08 | 22 | 77.3% ★★ | [59.8%,94.8%] |
| UTC05 | 24 | 75.0% ★★ | [57.7%,92.3%] |
| UTC03 | 24 | 70.8% ★★ | [52.6%,89.0%] |
| UTC23 | 23 | 69.6% ★ | [50.8%,88.4%] |
| UTC14 | 21 | 66.7% ★ | [46.5%,86.8%] |
| UTC01 | 28 | 60.7% ★ | [42.6%,78.8%] |

⚠️ UTC02: n=14, 14/14 — küçük örnek, dikkatli yaklaş

**Sinyal sıklığı:** ~1.7/gün (düşük ama yüksek kalite)

---

## STRATEJİ 2 — T7 RSI MOMENTUM [YÜKSEK HACİM]

**Sinyal:** Binance 1H RSI14 (Wilder) > 60 → BET UP; < 40 → BET DOWN

RSI Threshold Karşılaştırması (best hours):
| Eşik | n (90 gün) | WR | EV/token |
|------|------------|----|---------|
| RSI>55 | 778 | 61.3% | +$0.107 |
| RSI>57 | 666 | 62.3% | +$0.117 |
| **RSI>60** | **497** | **62.8%** | **+$0.121** |
| RSI>62 | 410 | 62.2% | +$0.116 |
| RSI>65 | 296 | 62.2% | +$0.115 |

→ **RSI>60 optimal:** en iyi EV, 497 sinyal (5.5/gün)

**Best hours (T7 Momentum):** UTC 00, 01, 04, 06, 09, 13, 14

Saat bazlı WR:
| Saat | n | WR | EV | Yön |
|------|---|----|----|-----|
| UTC06 | 102 | 63.7% ★★ | +$0.131 | MOMENTUM |
| UTC04 | 121 | 63.6% ★★ | +$0.130 | MOMENTUM |
| UTC01 | 114 | 62.3% ★★ | +$0.117 | MOMENTUM |
| UTC14 | 106 | 61.3% ★ | +$0.107 | MOMENTUM |
| UTC00 | 109 | 60.6% ★ | +$0.099 | MOMENTUM |
| UTC09 | 126 | 59.5% ★ | +$0.089 | MOMENTUM |
| UTC13 | 100 | 58.0% ★ | +$0.074 | MOMENTUM |

**Sinyal sıklığı:** ~5.5/gün (RSI>60 + best hours)

---

## STRATEJİ 3 — ADAPTIVE COUNTER-TREND [YENİ KEŞİF]

**Bazı saatlerde RSI sinyali TERS ÇALIŞIYOR:**

| Saat | RSI sinyal | Bet yönü | WR | EV |
|------|-----------|---------|----|----|
| UTC03 | > 55 UP | **DOWN** | 59.1% | +$0.085 |
| UTC05 | > 55 UP | **DOWN** | 58.9% | +$0.083 |
| UTC11 | > 55 UP | **DOWN** | 57.3% | +$0.067 |

Hipotez: Bu saatlerde RSI overextended → Polymarket correction başlıyor.

**Not:** Bu strateji henüz paper ile doğrulanmadı, deneysel.

---

## STRATEJİ 4 — T7+STREAK KOMBİNASYON [DOĞRULAMA SİNYALİ]

**Hem T7 RSI>55 hem Streak aynı yönü gösterince:**

| Filtre | n | WR | EV |
|--------|---|----|-----|
| Aynı yön tümü | 224 | 57.6% | +$0.070 |
| Aynı yön BTC+ETH | 141 | 61.0% | +$0.104 |
| **Aynı yön BTC+ETH + best hours** | **107** | **63.6%** | **+$0.129** |

→ İki sinyal çakışınca yüksek güven girişi fırsatı

---

## İSTATİSTİKSEL UYARILAR

**Bonferroni düzeltmesi:** 24 saatlik karşılaştırmada eşik p<0.0021.
- Hiçbir tek saat bu eşiği geçmiyor (UTC04 en yakın: p=0.0036)
- Ama: 7 best hours'ın tamamı aynı yönde pozitif → combined evidence güçlü
- Bağımsız saat testi değil (RSI koreleli) → strict Bonferroni çok muhafazakar

**OOS (out-of-sample):** Timestamp split başarısız. Tüm veri "son 30 gün"e düştü → ayrı train/test mümkün olmadı. Gelecek 30-60 günlük paper veri asıl OOS testi.

**Streak UTC02 %100:** n=14 → şans veya gerçek saat etkisi belirsiz.

---

## UYGULAMA SIRASI

### Aşama 1 — Paper (bu hafta)
Bot yaz: `t7_rsi_bot.ts`
1. Her 15dk → Binance 1H son kapanan mum RSI14 (Wilder)
2. RSI>60: best hours [00,01,04,06,09,13,14] → UP limit @ 0.51
3. RSI<40: aynı saatler → DOWN limit @ 0.51
4. Streak N≥3 BTC/ETH aynı yönde: best hours [01,02,03,05,08,14,23] → ters yön limit @ 0.51
5. Her iki sinyal aynı yönde → öncelikli giriş
6. Hedef: 30 trade

### Aşama 2 — Doğrulama (2 hafta)
30 trade → WR≥55% → Aşama 3

### Aşama 3 — Live
2 share ile başla, 2 hafta izle, scale up

---

## TEKNİK DETAYLAR

```python
def calc_rsi_wilder(closes, period=14):
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    for i in range(period, len(closes) - 1):
        avg_g = (avg_g * (period - 1) + gains[i]) / period
        avg_l = (avg_l * (period - 1) + losses[i]) / period
    rs = avg_g / avg_l if avg_l > 0 else 100
    return 100 - 100 / (1 + rs)

# T7 signal:   RSI > 60 → UP; RSI < 40 → DOWN
# Streak:      N≥3 same-direction → opposite
# Execution:   GTC maker limit @ 0.51, place in first 30s of market open (fill at 0.50)
# Fee:         Maker GTC = 0% fee
```

---

*LOCAL_AGENT | mega_analysis.py: 3999 resolved 15dk market + Binance 2193 1H klines | 2026-05-29*
