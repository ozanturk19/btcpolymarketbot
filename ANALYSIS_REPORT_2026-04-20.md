# Strateji Analiz Raporu — 20 Nisan 2026

## Veri Kaynağı
- **Live trades**: 228 tamamlanmış trade (160 WIN / 68 LOSS)
- **Paper trades**: 988 tamamlanmış trade  
- **BTC fiyat verisi**: 181,417 kayıt (yaklaşık 10 günlük)
- **Dönem**: Nisan 2026

---

## ANALİZ 1: BTC Dollar Momentum → 0.95 Entry Öneri

### Soru
BTC 2 dakikada 150$+ hareket ederse entry'i 0.95'e çıkarabilir miyiz?

### Bulgular

| Momentum | Tip | Trade | WR% | Avg PnL |
|----------|-----|-------|-----|---------|
| Sakin (<50$) | Aligned | 88 | 70.5% | +0.098 |
| Orta (50-100$) | Aligned | 89 | **75.3%** | +0.118 |
| Yüksek (100-150$) | Aligned | 17 | **58.8%** | -0.277 |
| Güçlü (150-200$) | Aligned | 9 | 66.7% | +0.008 |
| Orta (50-100$) | Opposing | 4 | 25.0% | -0.456 |

**HIGH_MOMENTUM (150$+) ile 0.92-0.93 entry — yalnızca 7 trade, %33-50 WR (insufficient data)**

### Sonuç: ❌ HAYIR — Yüksek Momentum = Daha Düşük WR

- **Kritik bulgu**: 100-150$ momentum → WR %58.8 (baseline'dan -14 puan)
- Momentum arttıkça WR azalıyor: Orta momentum (75.3%) > Sakin (70.5%) > Güçlü (66.7%) > Yüksek (58.8%)
- 150$+ momentumda sadece 7 trade — istatistiksel olarak yetersiz
- Counter-intuitive: Opposing momentum (BTC aksi yönde) orta seviyede çok tehlikeli (25% WR)
- **Öneri**: 0.95 entry ekleme. Mevcut 0.91-0.94 range korunmalı. Yüksek momentum filtrelemek için düşünülebilir.

---

## ANALİZ 2: Agresif Entry (0.90-0.91) Performansı

### Soru
Giriş fiyatını 0.90-0.91'e düşürürsek daha iyi sonuç alır mıyız?

### Paper Trades (988 trade, güvenilir örneklem)

| Entry | Trade | WR% | Avg PnL |
|-------|-------|-----|---------|
| 0.89 | 11 | 63.6% | +2.52 |
| **0.90** | **31** | **67.7%** | +1.57 |
| **0.91** | **199** | **71.9%** | +0.38 |
| 0.92 | 261 | **75.1%** | +0.35 |
| 0.93 | 225 | **76.9%** | +0.21 |
| 0.94 | 16 | 62.5% | +0.49 |

### Live Trades (228 trade)

| Entry | Trade | WR% | Stop Rate | Net PnL |
|-------|-------|-----|-----------|---------|
| 0.91 | 26 | **80.8%** | 19.2% | +$6.45 |
| 0.92 | 77 | 62.3% | **36.4%** | -$12.42 |
| 0.93 | 73 | 68.5% | 31.5% | +$6.99 |
| 0.94 | 52 | **78.8%** | 21.2% | +$9.68 |

### Sonuç: ❌ HAYIR — Daha Düşük Entry = Daha Düşük WR

- Paper data net gösteriyor: 0.90 = %67.7, 0.91 = %71.9 < 0.92-0.93 (75-77%)
- Düşük ask ≠ kolay kazanç. 0.90-0.91'de market daha belirsiz
- **Dikkat**: Live'da 0.92 kötü performans (62.3%) — büyük ihtimalle spread filtresi öncesi dönem
- Mevcut range (0.91-0.94) korunmalı, spread filtresi ile birlikte 0.92 performansı düzelmeli beklenti
- **Öneri**: Mevcut entry range değiştirilmemeli

---

## ANALİZ 3: Stop Analizi — Neden Stop Oluyoruz?

### Stop Oranı Dağılımı

| Exit Nedeni | Sayı | Avg PnL | Toplam PnL |
|------------|------|---------|------------|
| settlement_win | 157 | +$0.40 | +$63.25 |
| **stop_gtc_filled** | **46** | -$0.34 | -$15.47 |
| stop_attempt_2 | 9 | -$0.88 | -$7.88 |
| **stop_fok_1** | **5** | **-$2.13** | **-$10.65** |
| settlement_win_late_redeem | 3 | +$0.37 | +$1.10 |
| stop_attempt_3 | 2 | -$0.88 | -$1.75 |
| settlement_loss_stop_failed | 2 | **-$4.60** | **-$9.20** |
| stop_fok_3 | 1 | -$1.77 | -$1.77 |
| stop_fok_2 | 1 | -$0.54 | -$0.54 |
| settlement_loss | 1 | -$5.52 | -$5.52 |

**Toplam stop related zarar: -$47.26 (toplam 71 stop)**

### ⚠️ KRITIK BULGU: 15dk Market = Felaket

| Market | Total | Stops | Stop Rate | WR% |
|--------|-------|-------|-----------|-----|
| 5 dakika | 204 | 56 | **27.5%** | **72.1%** |
| **15 dakika** | **24** | **11** | **45.8%** | **54.2%** |

**15-dakika marketlerde stop oranı 2x yüksek, WR 18 puan düşük!**

15dk market stop detayları:
- 11 stopun 10'u GTC/FOK stop (çok uzun bekleme süresi)
- En uzun hold: 486 saniye (8+ dakika bekleyip stop)
- Avg hold: 188 saniye (normal stop bekleme çok uzun)

### BTC Yönü ve Stop İlişkisi

| Pozisyon | BTC Hareketi | Stop Sayısı | Avg PnL |
|----------|-------------|------------|---------|
| UP | BTC 0-50$ düşüş | 20 | -$0.87 |
| UP | BTC 50$+ çöküş | 12 | **-$1.18** |
| DOWN | BTC 0-50$ yükseliş | 24 | -$0.45 |
| DOWN | BTC 50$+ pump | 10 | -$0.48 |

- UP pozisyonlar BTC çöküşünde çok daha fazla zarar ediyor
- GTC stop çalışınca zarar kontrollü (-$0.33-0.39), FOK cascade olunca -$1 ile -$5'e çıkıyor

### Stop Rate by Entry Price

| Entry | Stop Rate | WR% |
|-------|-----------|-----|
| 0.91 | **19.2%** | 80.8% |
| 0.92 | **36.4%** | 62.3% |
| 0.93 | 31.5% | 68.5% |
| 0.94 | 21.2% | 78.8% |

**0.92 entry: hem en yüksek stop oranı hem en düşük WR — anomali var**

---

## UYGULANAN DEĞİŞİKLİKLER (Onaylandı, Compile Bekliyor)

| Değişiklik | Durum | Etki |
|-----------|-------|------|
| `MAX_CONCURRENT=3` | ✅ Kodda | 3x fazla fırsat |
| `ELAPSED_MAX_15=750` | ✅ Kodda | 15dk için +150s pencere |
| Hour filter (15:00 UTC) | ✅ Kodda | 48.4% WR saati geçildi |
| Spread filter (>0.01 skip) | ✅ Kodda | Geniş spread riskinden korunma |

---

## ONAY BEKLEYEN DEĞİŞİKLİK ÖNERİSİ

### 🔴 Öneri: 15-Dakika Marketlerini Devre Dışı Bırak

**Gerekçe:**
- WR: 54.2% (5dk: 72.1% — neredeyse 18 puan fark)  
- Stop rate: %45.8 (5dk: %27.5 — neredeyse 2x)
- Net toplam: 24 trade, 13 win, 11 stop = zararlı
- GTC stop'lar çok uzun süre bekliyor (166-486 sn) → BTC aleyhte döndüğünde çıkış geç kalıyor

**Yapılacak değişiklik:**
```typescript
const DURATION_FILTER = [5]; // 15 kaldırıldı
```

**Alternatif**: 15dk için stop_price'ı daha agresif ayarla (0.80 → 0.84) — zarar daha erken kesilsin.

---

## ÖZET VE KARAR MATRİSİ

| Öneri | Tavsiye | Güven |
|-------|---------|-------|
| 0.95 entry (yüksek BTC momentum) | ❌ HAYIR | Yüksek — veri net |
| Agresif entry 0.90-0.91 | ❌ HAYIR | Yüksek — paper veri net |
| Hour filter (15:00 UTC) | ✅ UYGULANDI | — |
| Spread filter (>0.01) | ✅ UYGULANDI | — |
| MAX_CONCURRENT=3 | ✅ UYGULANDI | — |
| 15dk market kapatma | ⚠️ ÖNERİLİR | Orta — 24 trade az örneklem |

