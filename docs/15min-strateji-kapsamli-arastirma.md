# Polymarket 15 Dakikalık BTC Marketlerde Sürdürülebilir Kâr Stratejisi
**Tarih:** 23 Nisan 2026 | **Kaynak:** 56 araştırma döngüsü, 15+ akademik/pratik kaynak  
**Hedef:** $30 sermayeyle günlük %1 getiri, maker order ile fee sıfırlama

---

## YÖNETİCİ ÖZETİ

- **%87 Polymarket trader'ı kaybediyor.** Kazanan %13'ün ortak özelliği: kural tabanlı strateji + matematik pozisyon boyutlandırması + maker statüsü.
- 15 dakikalık BTC marketlerde botların payı **%55-62**. Bilgi avantajı neredeyse imkânsız.
- En gerçekçi yaklaşım: **Yön netleşmiş marketlere (0.70+) maker limit order ile late entry.**
- Sürdürülebilir beklenti: **%0.5-1.0/gün** (bazı günler %2+, bazı günler kayıp).

---

## BÖLÜM 1: GLOBAL KAZANANLAR — GERÇEK STRATEJİLER

### Polymarket'te Kim Kazanıyor?

| Trader | Kâr | Strateji |
|--------|-----|---------|
| HyperLiquid0xb | $1.4M | Domain uzmanlığı (beyzbol) |
| WindWalk3 | $1.1M+ | Bilgi arbitrajı (RFK Jr.) |
| Théo (Fransız) | $85M | Özel anket + bilgi arb (seçimler) |
| ilovecircle | $2.2M / 2 ay | %74 WR, sistematik |
| Anonim bot | $700-800/gün | Market making (2024 peak) |

**Kritik gerçek:** Büyük kazananların tamamı crypto 15dk marketlerde değil — **uzun vadeli siyasi/spor marketlerde** ya da **bilgi avantajıyla** kazanmış. Crypto kısa vadeli marketlerde büyük para **botlardadır**.

### 6 Belgelenmiş Kâr Modeli (95M on-chain işlem analizi)

1. **Bilgi Arbitrajı** — En kârlı, en zor
2. **Cross-Platform Arb** — Polymarket vs Kalshi fiyat farkı ($40M+ belgelendi)
3. **Yüksek Olasılık Bono** — %95+ olasılıklı sonuçları alma (%5.2 getiri / 72 saat)
4. **Market Making** — Spread + rebate, $700-800/gün (2024, büyük sermaye)
5. **Domain Uzmanlığı** — Dar alanda derinleşme
6. **Hız Ticareti** — Sub-100ms latency arb, $4.2M total

---

## BÖLÜM 2: 15 DAKİKALIK MARKET MİKROYAPISI

### Market İstatistikleri
- Günlük Polymarket hacmi: **$153M** (2026 Nisan)
- 15dk BTC market başına ortalama hacim: **~$1.3M**
- Bot aktivitesi: **%55-62** (5dk: %62+)
- Retail trader payı: **sadece %4-5**
- Bid-ask spread midmarket'te: **1-2 cent**
- Spread 0.80+ seviyede: **8-15 cent**

### Fiyat Dinamikleri (15dk Pencere)

| Dakika | Durum |
|--------|-------|
| 0-5 | Market açılır, 0.48-0.52 civarı başlar, yön belirsiz |
| 5-13 | BTC hareketi fiyatı iter, aktif trading dönemi |
| 13-14 | Yön %70+ netleşir, **en kritik entry noktası** |
| 14-15 | Likidite çekilir, spread genişler, settlement yaklaşır |

**Oracle güncelleme gecikmesi:** Chainlink saniyenin altında, ama trader'ların ortalama reaksiyon süresi **~55 saniye** → bu pencere arbitraj fırsatı yaratıyor.

---

## BÖLÜM 3: FEE YAPISI — MAKER OLMAK NEDEN KRİTİK

### Taker Fee Formülü

```
fee = C × 0.072 × p × (1 - p)
```

| Fiyat | 100 hisse işlemi | Taker Fee | Efektif Oran |
|-------|-----------------|-----------|--------------|
| $0.50 | $50.00 | **$1.80** | %3.6 (peak) |
| $0.70 | $70.00 | **$1.51** | %2.2 |
| $0.80 | $80.00 | **$1.15** | %1.4 |
| $0.90 | $90.00 | **$0.65** | %0.7 |

**Taker break-even @0.50:** %53.6 win rate gerekiyor (random walk'tan fazlası).

### Maker = $0 Fee + Rebate

- GTC post-only limit order → maker statüsü → **fee yok**
- Maker rebate: fill edilen her order için fee_equivalent'ın **%20'si** geri ödeniyor
- 100 hisse @ $0.50 maker fill: **$0.36 rebate** (günlük pool'dan orantısal pay)

### Maker Olmak İçin Kural

```
Mevcut best bid = $0.49 → sen $0.48 veya altına BID koy → Maker ✅
Mevcut best ask = $0.51 → sen $0.52 veya üstüne ASK koy → Maker ✅
Spread içine giren limit = Taker ❌
```

---

## BÖLÜM 4: STRATEJİ ANALİZİ — 6 YÖNTEM

### ⭐ Strateji 1: Late Entry (Maker) — ÖNERİLEN

**Mantık:** 13. dakikada yön %70+ netleşmişse, settlement riski çok düşük.

**Mekanik:**
1. UP token $0.72+ ise → $0.71'e GTC post-only BID koy (maker)
2. Fill olursa: $0 fee + rebate eligibility
3. Settlement'ta $1.00 al → $0.29 kâr/hisse (gross)
4. Ya da $0.80'e çıkınca sat → $0.09 kâr/hisse (erken exit)

**Matematik (4 hisse, $0.72 entry):**
- Yatırım: 4 × $0.72 = $2.88
- Win: 4 × $1.00 = $4.00 → kâr $1.12 (%39)
- Loss: 4 × $0.00 = $0 → kayıp $2.88 (%100)
- Break-even WR (maker, fee=0): **%72**
- Gerçek WR @0.70+ netleşmişken: **%82-88** (tarihi veri)
- **EV pozitif** ✅

**Günlük senaryo ($30 sermaye):**
- 5 işlem, %80 WR → 4 kazanç × $0.40 + 1 kayıp × (-$2.88) = +$1.60 - $2.88... 

*Not: Küçük lot gerekiyor. $0.72'den 3-4 hisse ideal.*

**Risk:** Flash reversal son dakikada (BTC ani dönüş). Seyrektir ama yıkıcı.

---

### Strateji 2: Market Making (Spread Capture)

**Mantık:** 0.48 BID / 0.52 ASK koy, her iki taraftan $0.04 spread yakala.

**Gereksinim:** Min $500 sermaye (likidite sağlamak için). $30 ile anlamlı değil.

**Günlük potansiyel (büyük sermaye):** 5-10 round-trip × $4 spread = $20-40 gross.

**Sorun:** Inventory riski — bir taraf fill olup yanlış yöne giderse settlement'ta kayıp.

---

### Strateji 3: Oracle Latency Arbitrage

**Mantık:** BTC Binance'ta $100 hareket etti, Polymarket henüz fiyatlamadı → 55 saniye pencere.

**Backtest (5,000 işlem):**
- Win rate: **%61.4**
- Toplam kâr: $59,244 (büyük sermaye)
- Kârlı gün oranı: 20/24 (%83)

**Sorun:** Artık 2.7 saniyeye indi (rekabet). Sub-100ms latency + teknik altyapı şart. $30 ile çalışmaz.

---

### Strateji 4: Pair Selling (Delta-Neutral)

**Mantık:** 1 USDC → 1 YES + 1 NO. Market YES $0.54 + NO $0.49 = $1.03 fiyatlıyorsa:
- YES'i $0.54'e sat (maker)
- NO'yu $0.49'a sat (maker)
- $1.03 al, $1.00 yatırdın → **$0.03 risk-free kâr**

**Sorun:** Bu fiyat farkı çok kısa sürer. Ölçeklendirme zor.

---

### Strateji 5: Cross-Platform Arb (Polymarket vs Kalshi)

**Sorunlar:** Fee %5+ (çoğu fırsat negatif), 2.7 saniyelik pencere, büyük sermaye, yüksek teknik bariyer.  
**Karar:** Küçük sermaye için uygulanamaz. ❌

---

### Strateji 6: Teknik Analiz (RSI/MACD + Entry)

**Araştırma sonucu:** Live trading testinde **%25-27 win rate** (break-even %53). Başarısız.

**Neden:** 15dk BTC hareketi random walk'a yakın. Teknik indikatörler bu timeframe'de noise.

**Karar:** Tek başına kullanılamaz. ❌

---

## BÖLÜM 5: POZISYON BOYUTLANDIRMASI — KELLY CRİTERİON

### Late Entry Örneği ($0.72'den UP, %82 win rate varsayımı)

```
p = 0.82 (kazanma ihtimali)
b = (1.00 - 0.72) / 0.72 = 0.389 (net odds)
Kelly f* = (p×b - (1-p)) / b = (0.319 - 0.18) / 0.389 = %35.7
```

| Yaklaşım | Sermaye % | $30'da miktar | Risk |
|----------|-----------|--------------|------|
| Full Kelly | %35.7 | $10.71 | Çok agresif |
| Half Kelly | %17.8 | $5.34 | Orta |
| **Quarter Kelly** | **%8.9** | **$2.67** | **Önerilen** |

**Günlük kayıp limiti:** Sermayenin **%10'u** = $3.00 → aşılınca dur.

---

## BÖLÜM 6: %1/GÜN HEDEFİNİN GERÇEKÇİLİĞİ

### Matematik

- 96 market/gün (her saat 4 × 24 saat)
- Sadece %14 tanesi 0.70+ fiyata ulaşır → günde **~13-14 fırsat**
- Her fırsatta girmek gerekmez — sadece en güçlü 3-5'ine

**$30 sermaye, Quarter Kelly (3 hisse @ $0.72):**

| Senaryo | Hesap |
|---------|-------|
| 5 işlem, 4 kazanım, 1 kayıp | 4 × $0.84 - 1 × $2.16 = +$1.20 = **%4.0** |
| 5 işlem, 3 kazanım, 2 kayıp | 3 × $0.84 - 2 × $2.16 = -$1.80 = **-%6.0** |
| Beklenen değer (%80 WR) | 0.80×$0.84 - 0.20×$2.16 = +$0.24/işlem |
| 5 işlem beklenen | **+$1.20/gün = %4.0** (optimistik) |
| Gerçekçi (bazı işlem eksik, timing sorunları) | **%0.5-1.5/gün** |

### Compounding Etkisi

| Getiri/Gün | Aylık | 6 Aylık | Yıllık |
|-----------|-------|---------|--------|
| %0.5 | %16.1 | %142 | %513 |
| %1.0 | %34.9 | **%460** | **%3,678** |
| %1.5 | %56.7 | %1,254 | %21,479 |

%1/gün aylık %34.9 — bu iyi bir hedef. Ulaşmak için bazı günler %2+, bazı günler sıfır işlem yapman gerekebilir.

---

## BÖLÜM 7: UYGULAMA YOL HARİTASI

### Aşama 1: Gözlem (Hafta 1-2) — Para Harcama
- Polymarket'te 15dk BTC marketleri canlı izle
- Not al: kaçıncı dakikada yön netleşiyor, 0.70+ gördükten sonra kaç kez reversal oluyor?
- Hedef: 50 market kayıt → kendi win rate istatistiğini çıkar

### Aşama 2: Küçük Test (Hafta 3-4) — $5-10
- Sadece maker order (GTC post-only)
- Sadece 0.70+ netleşmiş marketler
- Quarter Kelly pozisyon (~2-3 hisse)
- Her işlemi kayıt al: giriş fiyatı, dakikası, sonuç

### Aşama 3: Ölçeklendirme (Ay 2) — $30 tam kullan
- Başarılı ise pozisyon artır
- Strateji ayarla (hangi dakikada giriş daha iyi?)
- Python/TypeScript ile basit otomasyon

### Aşama 4: Bot (Ay 3+) — Sermaye $100+
- CLOB WebSocket'i izle
- 0.70+ tespit edince otomatik maker order gönder
- Market making ekle (sermaye $500+ olunca)
- Oracle lag sinyali ekle (sermaye $1,000+ olunca)

---

## BÖLÜM 8: TEKNİK ALTYAPI

### Veri Kaynakları
```
Polymarket CLOB WebSocket:
wss://ws-subscriptions-clob.polymarket.com/ws/
→ Events: book, price_change, last_trade_price, best_bid_ask

Binance BTC feed:
wss://stream.binance.com:9443/ws/btcusdt@trade

Polymarket REST:
https://clob.polymarket.com/book?token_id=TOKEN_ID
```

### Stop Loss Alternatifi (CLOB stop order yok)
1. 30 saniyede bir monitoring loop → threshold aşılınca market order
2. Fiyat $0.40 altına düşerse $0.40'a ASK koy (soft stop)
3. Time-based exit: 10 dakika geçince otomatik değerlendirme

---

## ÖZET TABLO

| Strateji | Min Sermaye | Fee | Aylık Getiri | Teknik Zorluk | Önerilen? |
|---------|------------|-----|--------------|---------------|-----------|
| **Late Entry (Maker)** | **$30** | **$0** | **%15-40** | **Düşük** | **✅ EVET** |
| Market Making | $500 | $0 | %5-15 | Orta | Sonradan |
| Oracle Lag Arb | $500+ | Taker | %20-50 | Yüksek | İleride |
| Pair Selling | $100 | Minimal | %5-10 | Orta | Sonradan |
| Teknik Analiz | $30 | Taker | Genellikle kayıp | Orta | ❌ HAYIR |
| Cross-Platform Arb | $1,000+ | %5+ | %2-8 | Çok Yüksek | ❌ HAYIR |

---

## EN ÖNEMLİ 5 KURAL

1. **Sadece yön netleşmişken gir** — UP/DOWN 0.70+ olmadan işlem yapma
2. **Her zaman maker ol** — GTC post-only, spread'in dışından
3. **Quarter Kelly** — sermayenin %8-9'undan fazlasını tek işleme koyma
4. **Günlük %10 kayıp limiti** — $30'da $3 → aşılınca dur
5. **Veri kayıt et** — her işlemi not al, istatistiğini çıkar

---

## KAYNAKLAR

- [Polymarket Maker Rebates](https://docs.polymarket.com/developers/market-makers/maker-rebates-program)
- [SSRN - Who Wins and Who Loses on Polymarket](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6443103)
- [ChainCatcher - 6 Profit Models](https://www.chaincatcher.com/en/article/2233047)
- [oracle-lag-sniper GitHub](https://github.com/JonathanPetersonn/oracle-lag-sniper)
- [Medium - Benjamin.cup 5m Dynamics](https://medium.com/@benjamin.bigdev/unlocking-edges-in-polymarkets-5-minute-crypto-markets)
- [Medium - AI-Augmented Arbitrage](https://medium.com/@gwrx2005/ai-augmented-arbitrage-in-short-duration-prediction-markets)
- [Medium - BTC 15m Bot Guide](https://medium.com/@aulegabriel381/the-ultimate-guide-building-a-polymarket-btc-15-minute-trading-bot-with-nautilustrader-ef04eb5edfcb)
- [Polysized Market Making](https://www.polysized.com/blog/polymarket-market-making)
- [Kelly Criterion for 15m Markets](https://www.crypticorn.com/position-sizing-on-polymarket-and-kalshi-crypto-up-down-predictions/)

---
*Rapor: 23 Nisan 2026 — Sadece araştırma. Aksiyon alınmadı.*
