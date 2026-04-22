# Polymarket BTC Trading Strategy Research
**Tarih:** 22 Nisan 2026  
**Yazan:** Otomatik analiz — 116 trade sonrası strateji gözden geçirmesi

---

## 1. Mevcut Stratejinin Sonuçları (5 Dakikalık Scalp)

### Özet
- **Toplam trade:** 116
- **Net P&L:** −$15.21
- **Win rate:** %73.3 (gerekli break-even: %79.8)
- **Ortalama entry:** 0.91–0.92
- **Ortalama kazanç/trade:** +$0.10, kayıp/trade: −$0.38

### Temel Problem: Matematiksel Edge Yok
0.92'den UP token almak = piyasanın fair value'sunu ödemek = EV sıfır, ücretlerden önce negatif.

Break-even win rate formülü:
- Kazanç per share: 1.00 − 0.92 = 0.08
- Kayıp per share: 0.92 − 0.00 = 0.92 (settlement'ta)
- Ücretler: ~$0.02–0.04 per round trip
- Gerekli WR = 0.92 / (0.92 + 0.08) = %92 (settlement varsa)
- Stop ile (0.82 exit): WR gerekli = (0.92−0.82) / (0.92−0.82 + 0.08) = %55.6
- Fiili WR %73.3 → kar var gibi görünüyor ama whipsaw kayıpları fazla

### Whipsaw Sorunu
- Fiyat 0.92'ye ulaşır, stop 0.79–0.82'de tetiklenir
- Piyasa toparlar ve orijinal yönde devam eder
- Son 3 whipsaw: T10245, T10246, T10248 — hepsi kazanabilirdi

---

## 2. Saatlik Market Stratejisi Alternatifleri

### 2A. Binance 1-Saatlik Mum Stratejisi (Önerilen)
**Market:** Bitcoin Up or Down - 1 Hour (Binance BTC/USDT resolution)  
**Volume:** $250K+ per market  
**Spread:** 0.01–0.02

**Entry kriterleri:**
- Sadece 0.65+ veya 0.35− extreme fiyatlardan gir
- Sentiment + teknik analiz uyumu iste
- Min $50K hacim şartı

**Risk yönetimi:**
- Stop: %15 kayıp (10 sentten 8.5 sente düşünce)
- No FOK complexity — market daha yavaş hareket eder
- Settlement bekleme toleransı çok daha yüksek

**Beklenen sonuçlar:**
- WR: %55–60 (trend-following saatlik)
- Ücret düşük (maker=0, taker=0.072 × p × (1−p))
- 5dk markete kıyasla 12x daha az trade = 12x daha az ücret

### 2B. Trend Momentum Stratejisi
**Konsept:** İlk 5 dakikada yön belli olunca 55 dakika kala gir  
**Entry:** 0.65+ (trend yönünde)  
**Exit:** Settlement veya 0.55'e düşerse stop  
**Risk:** Büyük geri dönüşlerde kayıp (Flash crash gibi)

### 2C. Mean Reversion (Saatlik)
**Konsept:** Aşırı fiyattan karşı yöne gir  
**Entry:** 0.85+ → DOWN al, 0.15− → UP al  
**Exit:** 0.70'e döndüğünde satış (limit order)  
**Risk:** Momentum devam ederse stop

### 2D. Volüm Filtreli Momentum
**Konsept:** Hacim spike'ı + fiyat hareketi kombinasyonu  
**Entry:** Sadece $100K+ hacimli marketlerde  
**Avantaj:** Likidite garantili, spread düşük

---

## 3. Düşük Olasılık Token Scalping Stratejisi

### Konsept (Yeni — Araştırılıyor)
**Senaryo:** UP = 0.92, DOWN = 0.08  
**İşlem:** DOWN token al (0.08), 0.14'e GTC limit sell koy  
**Hedef:** UP'ın 0.92'den 0.85'e whipsaw'ında DOWN 0.15'e çıkar → satış dolar  
**Max kayıp:** 5 shares × $0.08 = $0.40  
**Max kazanç:** 5 shares × ($0.14 − $0.08) = $0.30

### Matematik
- Gerekli başarı oranı: $0.40 / ($0.40 + $0.30) = %57.1
- Maker fee = 0 (GTC post-only limit order)
- Taker fee (DOWN alırken): 0.072 × 0.08 × 0.92 = $0.0053 per share
- 5 shares alım ücreti: ~$0.027

### Order Book Gözlemi
DOWN token order book (8:40PM ET marketi örneği):
- 0.08'de 80 adet bid
- 0.10'da 6,210 adet bid (büyük likidite duvarı)
- 0.15'de 4,133 adet bid
- Bu bid'ler DOWN tokenin UP tarafında görünen ASK'lar ile simetrik

### Kritik Sorular
1. **Pullback frekansı:** UP 0.90+ olduğunda 5dk içinde ne sıklıkla 0.85'e geri döner? (Tarihsel veri gerekli)
2. **GTC order fill garantisi:** Limit order CLOB'da nasıl çalışır?
3. **Timing:** Hangi an DOWN almak optimal? (UP 0.92'ye ulaştığı an mı, yoksa düşmeye başladığında mı?)

### Avantajlar
- **Risk tanımlı:** Max $0.40 kayıp per trade
- **Maker ücreti yok:** GTC limit = maker order
- **Whipsaw'dan fayda:** Mevcut strateji bunu kaybediyordu, yeni strateji bunu kazanır
- **Settlement bekleme yok:** Limit dolduğunda çık

### Dezavantajlar  
- Küçük kazanç ($0.30 max per trade)
- Pullback olmayabilir (0.92 → 1.00 direkt)
- Scale etmek için çok sayıda eş zamanlı position gerekir
- Limit order cancel gerekebilir (settlement yaklaşınca)

---

## 4. Teknik Notlar

### Polymarket CLOB API
- **Order types:** MARKET, LIMIT
- **Time-in-force:** GTC, GTD, FOK, IOC/FAK
- **Post-only:** GTC ve GTD ile destekleniyor (maker = 0 ücret)
- **Tick size:** 0.01
- **Min size:** 5 shares

### Fee Formula
```
fee = C × feeRate × p × (1 − p)
```
- Crypto feeRate = 0.072
- p = 0.08 (DOWN fiyatı)
- fee per share = 0.072 × 0.08 × 0.92 = $0.0053
- **Maker (limit) = $0**

---

## 5. Öneri ve Sonraki Adımlar

### Kısa Vadeli (Hemen)
1. Bakiyeyi yenile ($4.83 → min $20)
2. Manuel olarak 5–10 low-prob DOWN trade'i test et (bot olmadan)
3. UP 0.91+ olduğunda DOWN al, 0.14 limit koy, takip et

### Orta Vadeli (1–2 Hafta)
1. Saatlik market botunu geliştir (5dk bot yerine)
2. 15dk veya 1H candle resolution marketleri hedefle
3. Whipsaw frekansını logla

### Uzun Vadeli
1. ML model: UP 0.90+ sonrası pullback olasılığını tahmin et
2. Multi-market: Aynı anda 5–10 market tara
3. Kelly Criterion ile pozisyon boyutunu optimize et

---

*Bu rapor 22 Nisan 2026 tarihinde 116 canlı trade sonrası yapılan analiz sonucunda hazırlanmıştır.*
