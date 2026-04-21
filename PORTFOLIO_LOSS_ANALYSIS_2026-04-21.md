# Portföy Değer Kaybı Araştırması
**Tarih:** 21 Nisan 2026  
**Araştıran:** Claude (otomatik analiz)  
**Konu:** "DB PnL artıyor ama portföy değeri düşüyor — para buharlaşıyor mu?"

---

## 1. Özet Bulgu

| Metrik | Değer |
|--------|-------|
| DB brüt PnL (komisyon hariç) | **+$16.27** |
| Gerçek ödenen komisyon | **-$14.64** |
| **Net gerçek PnL (14 Nis'den beri)** | **+$1.63** |
| Tüm history net USDC çıkışı | **-$45.58** |
| Tahmini başlangıç sermayesi | **~$58–70** |
| Bot durdurulduğunda free USDC | **$7.13** |

**Sonuç:** DB PnL yanıltıcı çünkü komisyon dahil değil. 14 Nisan'dan beri +$1.63 net (neredeyse başa baş). Esas büyük kayıplar **14 Nisan öncesinde** (DB takibi yokken) oluştu.

---

## 2. DB PnL Neden Yanıltıcı?

### 2.1 PnL Formülleri (komisyon dahil değil)

Kodda 3 farklı çıkış noktasında PnL hesaplanıyor:

```typescript
// settlement (scalp_live.ts ~524. satır)
const pnl = (exitPrice - t.entry_price) * t.shares;

// GTC stop dolduğunda (~378. satır)
const pnl = filledPrice * sizeMatched - t.entry_price * t.shares;

// FOK cascade (~478. satır)
const pnl = filledPrice * stopSellSize - t.entry_price * t.shares;
```

**Hiçbiri komisyon düşmüyor.** Bu nedenle DB her zaman gerçek kazançtan daha iyimser görünür.

### 2.2 Gerçek Komisyon Oranı

CLOB activity API'den 474 trade analiz edildi:

| Yön | Ham değer | Gerçek ödenen | Komisyon | Oran |
|-----|-----------|---------------|----------|------|
| BUY (286 trade) | $1,380.76 | $1,388.60 | **+$7.85** | %0.568 |
| SELL (188 trade) | $989.00 | $982.21 | **+$6.79** | %0.687 |
| **Toplam** | | | **$14.64** | ~%0.62 avg |

> **Not:** Koddaki `FOK_FEE_BPS = 1000` (10%) endişe kaynağıydı ama gerçekte %0.62 uygulanıyor.  
> Bu parametre CLOB'a `fee_rate_bps` olarak iletiliyor, operator/protokol tanımı olarak kullanılıyor — taker fee ayrı.

---

## 3. Nakit Akışı Analizi (Tüm History)

```
Toplam USDC ödendi (BUY):     -$1,388.60
Toplam USDC alındı (SELL):    +$  982.21
Toplam USDC alındı (REDEEM):  +$  360.81
─────────────────────────────────────────
Net USDC akışı:               -$   45.58

Şu anki free USDC:             $    7.13
1 açık pozisyon (entry val):   $    5.58 (son trade, T10217 WIN kapandı)
─────────────────────────────────────────
Tahmini toplam şu an:          ~$  12.71
Tahmini başlangıç sermayesi:   ~$  58.29
Toplam zarar (tüm history):    ~$  45.58 (-78%)
```

### REDEEM Dağılımı

- **180 REDEEM eventi** tespit edildi
- **68 non-zero** (~$5.00–6.03 arası) → WIN settlement redemption
- **112 zero ($0)** → aynı timestamp (1776615662) → batch işlem, sıfır değerli token temizliği

---

## 4. DB İzleme Döneminin Analizi (14 Nisan – 21 Nisan)

### 4.1 Genel İstatistik

| Metrik | Değer |
|--------|-------|
| Toplam trade | 255 |
| İlk trade | 2026-04-14 20:02 UTC |
| Son trade | 2026-04-21 03:53 UTC |
| WIN | 179 trade, toplam +$72.57 |
| LOSS | 76 trade, toplam -$56.29 |
| **Brüt net PnL** | **+$16.27** |
| Komisyon (~%0.62) | -$14.64 |
| **Gerçek net PnL** | **+$1.63** |

### 4.2 Exit Reason Dökümü

| Exit Reason | Adet | Toplam PnL | Ortalama PnL | Not |
|-------------|------|------------|--------------|-----|
| settlement_win | 176 | +$71.47 | +$0.41 | Normal WIN |
| settlement_win_late_redeem | 3 | +$1.10 | +$0.37 | Geç settlement |
| stop_gtc_filled | 54 | -$18.12 | -$0.34 | Normal stop çalıştı |
| stop_attempt_2 | 9 | -$7.88 | -$0.88 | 2. stop denemesi |
| stop_fok_1 | 5 | -$10.65 | **-$2.13** | ⚠️ FOK cascade, büyük kayıp |
| stop_fok_2 | 1 | -$0.54 | -$0.54 | FOK cascade 2 |
| stop_fok_3 | 1 | -$1.77 | -$1.77 | FOK cascade 3 |
| stop_attempt_1 | 1 | -$0.88 | -$0.88 | |
| stop_attempt_3 | 2 | -$1.75 | -$0.88 | |
| **settlement_loss_stop_failed** | **2** | **-$9.20** | **-$4.60** | ❌ Stop dolmadı, settlement kaybı |
| **settlement_loss** | **1** | **-$5.52** | **-$5.52** | ❌ Tam kayıp (YES→$0) |

### 4.3 "Para Buharlaşması" Kategorisi

3 trade'de stop çalışmadı ve market sıfırlandı:

```
settlement_loss             : 1 trade,  -$ 5.52  (tam kayıp, YES direkt $0)
settlement_loss_stop_failed : 2 trade,  -$ 9.20  (kısmi — stop dolmadı)
TOPLAM                      :           -$14.72
```

**Senaryo:** BTC ani hareket → DOWN fiyatı 0.93'ten 0.075'e hızla düştü → 0.87'de alıcı bulunamadı → GTC stop dolmadı → market kapandı → DOWN=$0 → tam kayıp.

---

## 5. Süre Bazlı Performans (5dk vs 15dk)

| Süre | Outcome | Adet | Toplam PnL | Ort PnL | Ort Yatırım |
|------|---------|------|------------|---------|-------------|
| 5dk | WIN | 159 | +$63.93 | +$0.40 | $5.30 |
| 5dk | LOSS | 63 | -$51.79 | **-$0.82** | $5.36 |
| 15dk | WIN | 20 | +$8.64 | +$0.43 | $5.57 |
| 15dk | LOSS | 13 | -$4.50 | **-$0.35** | $5.54 |

**5dk net:** +$63.93 - $51.79 = **+$12.14**  
**15dk net:** +$8.64 - $4.50 = **+$4.14**

> **Dikkat:** 5dk LOSS ortalama (-$0.82), 15dk LOSS ortalamasından (-$0.35) çok daha kötü.  
> 5dk'da büyük kayıplar var (`stop_fok_1` gibi emergency exit'ler).

---

## 6. Kümülatif PnL Zaman Serisi (Saatlik)

```
14 Nis 20:00  +0.99  ████
14 Nis 23:00  +1.73  ████████
15 Nis 03:00  -1.40  ██  ← İlk büyük düşüş (-4.18)
15 Nis 08:00  -3.85  █   ← settlement_loss_stop_failed (-4.6)
16 Nis 17:00  -1.82  ██  ← Kötü seri
17 Nis 09:00  -6.18  ▌   ← En derin drawdown (-5.73 tek saat!)
─────────────────────────────────────────────────────
18 Nis 09:00  -0.28  ██  ← Toparlanma başladı
19 Nis 08:00  +3.37  ████████████
19 Nis 20:00  +6.54  ██████████████████
20 Nis 05:00  +10.23 ████████████████████████████████
20 Nis 08:00  +11.94 ████████████████████████████████████
21 Nis 03:00  +16.27 ████████████████████████████████████████████████ (DB brüt)
```

**Max Drawdown:** ~-6.18 (17 Nisan 09:00 UTC'de)  
**Peak:** +16.27 (21 Nisan 03:00)

---

## 7. Kritik Bug'lar Tespit Edildi

### 7.1 Circuit Breaker — Mid=undefined Bypass ❌ → ✅ DÜZELTİLDİ

**Sorun:**
```typescript
// ESKİ (hatali)
} else if (remaining > 0 && remaining <= cbRemaining && mid < CIRCUIT_BREAKER_THRESHOLD) {
// mid=undefined ise: undefined < 0.96 = false → CB TETIKLENMIYOR
```

**Durum:** T10217 trade'inde yaşandı. Kapanışa 32 saniye kala 15dk market fiyatı `undefined` oldu. CB tetiklenmedi. (Market neyse ki WIN kapandı ama potansiyel settlement_loss senaryosuydu.)

**Düzeltme:** (commit `78e1d17`, branch `claude/analyze-trading-bot-evOpZ`)
```typescript
// YENİ (null-safe)
} else if (remaining > 0 && remaining <= cbRemaining && (mid == null || mid < CIRCUIT_BREAKER_THRESHOLD)) {
// mid=undefined/null ise CB tetiklenir → emergency exit denenir
```

### 7.2 GTC_FEE_BPS = 1000 — Potansiyel Bug ⚠️

```typescript
const GTC_FEE_BPS = 1000;  // Yorum: "GTC maker fee = 0 olmalı"
```

GTC (maker) emirlerde komisyon 0 olması gerekiyor. Ancak `fee_rate_bps=1000` CLOB'a iletiliyor. Gerçek SELL-side ücret %0.69 görünüyor — bunun operator fee mi yoksa bu parametreden mi kaynaklandığı netleştirilmeli.

### 7.3 CLOB Yetim Emirler ❌ → ✅ TEMİZLENDİ

5 adet GTC BUY emri (`0x11-0x30` arası fiyatlar) expired marketlerde askıda kalmıştı:

| Emir | Side | Fiyat | Boyut | Maliyet |
|------|------|-------|-------|---------|
| 0xb2936e... | BUY YES | 0.30 | 5 | $1.50 |
| 0x3b8337... | BUY YES | 0.11 | 5 | $0.55 |
| 0xa0880b... | BUY YES | 0.17 | 5 | $0.85 |
| 0xcf5ce3... | BUY YES | 0.28 | 5 | $1.40 |
| 0xf94720... | BUY YES | 0.27 | 5 | $1.35 |
| **TOPLAM** | | | | **$5.65** |

Tüm emirler iptal edildi. `$5.65` serbest bırakıldı.

---

## 8. Açıklanamayan $46 Fark — Pre-DB Kayıpları

| | Değer |
|---|---|
| DB net PnL (14 Nis'den beri) | +$16.27 |
| Komisyon | -$14.64 |
| Gerçek tracking PnL | **+$1.63** |
| Gerçek CLOB net çıkış (tüm history) | **-$45.58** |
| Fark | **-$47.21** |

Bu ~$47 fark büyük ihtimalle:

1. **Pre-DB dönem kayıpları** (14 Nisan öncesi — gözlemci DB henüz yoktu, bot işlem yapıyordu)
2. **CLOB trade sayısı fazlalığı**: CLOB'da 286 BUY var, DB'de 255 → 31 ekstra BUY trade DB'de yok
3. Ekstra BUY'lar net -$47 zararla kapanmış olmalı (eski strateji/parametreler)

**Doğrulama:** Polymarket activity API → 474 trade, 180 REDEEM. DB → 255 trade. Fark = 219 event, tümü pre-DB veya farklı strateji.

---

## 9. Orphan GTC Order Kökeni

5 yetim BUY emrinin oluşma nedeni tam netleşmedi. Olasılıklar:

- **Eski bot versiyonları:** Farklı parametre setiyle çalışan eski scalp stratejisi bıraktı
- **Re-entry mekanizması:** Bazı versiyonlarda stop sonrası düşük fiyattan yeniden alım deneniyordu
- **Expired market leak:** Market kapandıktan sonra iptal edilmemiş emirler birikti

Öneri: Bot koduna market kapanışında tüm açık emirleri iptal eden cleanup fonksiyonu eklenmeli.

---

## 10. Öneriler

### Acil
- [ ] `GTC_FEE_BPS` = 0 yap (maker fee gerçekten 0 ise; CLOB davranışını doğrula)
- [ ] Bot kapanışında / market settlement sonrası orphan emir cleanup ekle
- [ ] DB'ye `fee_paid` kolonu ekle — gerçek komisyon kayıt altına alınsın

### Strateji
- [ ] 5dk stop_fok_1 kategorisi incelenmeli (avg -$2.13 loss, normal stop avg -$0.34'ün 6 katı)
- [ ] `ENTRY_MIN_5 = 0.91` — bu seviyede fiyat sıfıra gidebilir mi? Min entry fiyat 0.85+ yapılabilir
- [ ] Bakiye $10'ın altına düştüğünde bot otomatik durmalı
- [ ] Pre-trade remaining kontrolü: eğer `dn/up = undefined` ise entry atlanmalı

### İzleme
- [ ] Gerçek komisyon dashboard'a eklenmeli (şu an görünmüyor)
- [ ] Kümülatif PnL grafiği — DB PnL değil, gerçek USDC bakiye değişimi
- [ ] `settlement_loss` alerting — oluştuğunda anında bildirim

---

## 11. Bot Durdurma Kararı

**21 Nisan 2026, ~04:48 UTC itibariyle polymarket-live durduruldu.**

Neden:
- Free USDC $7.13 → tek pozisyon kapasitesi kalmış
- Her stop_fok zararı bakiyeyi ciddi etkiliyor  
- Strateji optimizasyonu (özellikle 5dk büyük kayıp sorunu) gerekiyor
- Settlement_loss koruması yetersiz

Yeniden başlatmak için: `pm2 start polymarket-live`

---

*Rapor otomatik oluşturuldu — 21 Nisan 2026 04:50 UTC*  
*Branch: claude/analyze-trading-bot-evOpZ*  
*Commits: 78e1d17 (CB fix), b2f8692 (GTC balance fix), önceki değişiklikler*
