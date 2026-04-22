# Low-Probability Token Scalping Stratejisi — Araştırma Raporu
**Tarih:** 22 Nisan 2026  
**Yöntem:** Canlı order book analizi + CLOB API araştırması  
**Referans:** 116 trade'lik 5dk scalp botunun whipsaw problemi üzerine geliştirildi

---

## Strateji Özeti

**Fikir:** UP token 0.91–0.92'e ulaştığında (yani DOWN sadece 0.08–0.09) DOWN token al, 0.14'de GTC limit sell koy. Market geri çekilirse (whipsaw) limit dolar ve kazanırsın. Geri çekilmezse max $0.40 kaybedersin.

```
UP = 0.92 → DOWN = 0.08
BUY  5 shares DOWN @ 0.08  →  $0.40 maliyet
SELL 5 shares DOWN @ 0.14  →  $0.70 gelir (GTC Limit, maker)
Net kâr: +$0.30
Max kayıp: -$0.40 (settlement olursa)
```

---

## 1. Teknik Altyapı — Doğrulandı

### Order Tipleri (Polymarket CLOB)
| Tip | Açıklama | Bu Strateji |
|-----|----------|-------------|
| **GTC** | Good Till Cancel, maker | ✅ Entry + Exit için |
| **GTD** | Good Till Date | ✅ Settlement anına kadar |
| **FOK** | Fill or Kill | ✅ Emergency exit |
| **FAK/IOC** | Kısmı doldur, kalanı iptal | ✅ Partial exit |

**Post-only (maker):** GTC ve GTD ile destekleniyor → sıfır fee garantisi.

### Tick Size ve Minimum Order
- Tick size: **0.01** (0.08, 0.09, 0.10… geçerli)
- Minimum order: **5 shares**
- 5 shares × $0.08 = **$0.40** minimum entry

---

## 2. Fee Yapısı — Kritik Avantaj

### Maker = Sıfır Ücret + Rebate
- GTC post-only order koyduğunda: **fee = $0**
- Limit order dolduğunda maker rebate: taker fee'nin **%20'si** geri ödenir
- Yani 0.14'de limit sell dolarsa fee yok, üstüne para alırsın

### Taker Fee (Piyasadan Alım)
```
fee = C × 0.072 × p × (1−p)
```
- 5 share DOWN @ 0.08 (taker): `5 × 0.072 × 0.08 × 0.92 = $0.027`
- 5 share DOWN @ 0.14 (taker): `5 × 0.072 × 0.14 × 0.86 = $0.043`

**Optimizasyon:** Her iki tarafta da maker ol → toplam fee ≈ $0
- Entry: GTC limit @ 0.08 (post-only) → bekle dolsun
- Exit: GTC limit @ 0.14 (post-only) → bekle dolsun

⚠️ **Not:** py-clob-client'ta fee hesaplama bug'ı var (GitHub issue #247). Fee'yi kütüphane yerine manuel hesapla.

---

## 3. Order Book Analizi — Canlı Veriler

### 5 Dakikalık Market DOWN Token
| Fiyat | Bid (Alım) | Not |
|-------|-----------|-----|
| 0.08 | 80 share | İnce — dikkatli ol |
| 0.10 | **6,210 share** | Büyük likidite duvarı |
| 0.11 | 10 share | — |
| 0.15 | **4,133 share** | Hedef seviye yakın |
| 0.16 | 250 share | — |
| 0.20 | 100 share | — |

### 15 Dakikalık Market DOWN Token (Daha Derin)
| Fiyat | Bid (Alım) |
|-------|-----------|
| 0.10 | **6,103 share** |
| 0.15 | **4,070 share** |
| 0.20 | 3,059 share |
| 0.25 | 2,473 share |

**Gözlem:** Order book simetrik yapıda (market maker mirror). 0.14'de limit sell koyunca gerçek alıcı var.

---

## 4. Break-Even Analizi

### Senaryo A: Buy 0.08 → Sell 0.14
```
Kâr (başarılı):  5 × ($0.14 − $0.08) = +$0.30
Kayıp (settlement): 5 × $0.08 = −$0.40

Break-even pullback oranı: 0.40 / (0.40 + 0.30) = %57.1
```
→ Her 10 trade'de en az 6'sında pullback gerekir.

### Senaryo B: Buy 0.08 → Sell 0.16 (Daha Agresif)
```
Kâr: 5 × $0.08 = +$0.40
Kayıp: 5 × $0.08 = −$0.40

Break-even: %50 (coin flip!)
```
→ BTC 5dk/15dk random walk sayılırsa teorik olarak kârlı.

### Senaryo C: Buy 0.08 → Sell 0.12 (Muhafazakar)
```
Kâr: 5 × $0.04 = +$0.20
Kayıp: 5 × $0.08 = −$0.40

Break-even: %66.7 (daha zor ama hızlı dolar)
```

**Öneri:** Senaryo A (0.14 exit) ile başla — orta yol.

---

## 5. Market Seçimi: 5dk vs 15dk

| Kriter | 5 Dakika | 15 Dakika |
|--------|----------|-----------|
| Likidite | ~$10K | ~$23K |
| Whipsaw penceresi | 5dk (dar) | 15dk (geniş) |
| Fırsat sıklığı | Her 5dk | Her 15dk |
| Limit dolma şansı | Düşük (az zaman) | Daha yüksek |
| **Tavsiye** | ❌ | ✅ **Tercih et** |

**15dk daha iyi neden:** 0.92'ye 3. dakikada ulaşılsa bile geriye 12 dakika var. BTC'nin normal hareketi bu sürede whipsaw için yeterli. 5dk markette ise 4. dakikada 0.92 görülürse sadece 60 saniye kalır.

---

## 6. Risk Senaryoları ve Kurallar

### Senaryo 1: Normal Whipsaw ✅
UP 0.92 → BTC geri çekilir → DOWN 0.14'e çıkar → GTC limit dolar  
**Net: +$0.30**

### Senaryo 2: UP 0.96+'ya Giderse ⚠️
DOWN = 0.04'e düşer, limit dolmaz  
**Kural:** UP 0.95+ görürsen FOK ile 0.04-0.05'den çık → kayıp $0.25 (tam $0.40 yerine)

### Senaryo 3: Settlement'a 60s Kala Limit Dolmadı 🚨
```
Emergency FOK exit @ best-bid (ne varsa)
```
- DOWN hala 0.08'de: break-even
- DOWN 0.05'e düşmüşse: $0.15 kayıp (tam $0.40 yerine daha az)

### Senaryo 4: Direkt Settlement (Kural İhlali Yok)
DOWN = $0 → Max kayıp: **$0.40**

---

## 7. Kod Şablonu (Yeni Bot İçin)

### Entry Mantığı
```typescript
// Trigger: UP token mid >= 0.90
if (upMid >= 0.90) {
  // GTC post-only limit buy @ 0.08
  await placeLimitOrder({
    token_id: DOWN_TOKEN_ID,
    price: 0.08,
    size: 5,
    side: 'BUY',
    type: 'GTC',
    post_only: true
  });
}
```

### Exit Mantığı
```typescript
// Entry dolunca anında limit sell koy
onFill(buyOrder, async () => {
  await placeLimitOrder({
    token_id: DOWN_TOKEN_ID,
    price: 0.14,  // veya 0.16 seçime göre
    size: 5,
    side: 'SELL',
    type: 'GTC',
    post_only: true
  });
});

// 60s kuralı
if (remaining <= 60 && sellOrderOpen) {
  await cancelOrder(sellOrder.id);
  await placeOrder({ type: 'FOK', price: bestBid, size: 5, side: 'SELL' });
}
```

---

## 8. Sonuç ve Öneri

### ✅ Strateji Uygulanabilir
- CLOB teknik altyapısı tam destekliyor
- Maker order = sıfır fee → maliyet avantajı
- Order book'ta 0.14–0.16 seviyesinde gerçek likidite var
- Max kayıp per trade: $0.40 → risk kontrol altında

### 🎯 Test Planı (Önce Manuel)
1. Bakiyeyi yenile ($20+)
2. İlk 10 trade: 15dk marketlerde, UP 0.90+ görünce, 5 share DOWN @ 0.08, limit 0.14
3. Pullback oranını kaydet (kaç tanesi doldu?)
4. Oran %57+ ise botu yaz

### 📊 Ölçek Hesabı (Karlı Durumda)
```
10 shares (min 2 lot): $0.80 maliyet, $0.60 kâr per kazanan
20 shares: $1.60 maliyet, $1.20 kâr per kazanan
50 shares (eğer 0.08'de likidite varsa): $4.00 maliyet, $3.00 kâr
```
⚠️ 0.08 seviyesinde genellikle 80–100 share var. 20+ almak için 0.09-0.10'a da girmek gerekebilir.

---

## Kaynaklar
- [Polymarket CLOB Methods L2](https://docs.polymarket.com/developers/CLOB/clients/methods-l2)
- [Maker Rebates Program](https://docs.polymarket.com/developers/market-makers/maker-rebates-program)
- [py-clob-client Issue #247 (fee bug)](https://github.com/Polymarket/py-clob-client/issues/247)
- [Polymarket 5M Bot Guide](https://gist.github.com/Archetapp/7680adabc48f812a561ca79d73cbac69)
- [5-Minute Crypto Markets Edge Analysis](https://medium.com/@benjamin.bigdev/unlocking-edges-in-polymarkets-5-minute-crypto-markets-last-second-dynamics-bot-strategies-and-db8efcb5c196)

---
*Araştırma tamamlanma tarihi: 22 Nisan 2026 — Canlı CLOB API verileri kullanılmıştır.*
