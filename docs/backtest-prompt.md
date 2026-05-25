# BTC 15dk Streak Reversal — Gerçek Data Backtest Prompt

Bu prompt'u local ortamında çalıştıracak bir ajana ver.
Polymarket Gamma API'ya erişimin var; bu backtest gerçek tarihi market datası üzerinde çalışacak.

---

## GÖREV

Polymarket'in BTC 15 dakikalık Up/Down marketlerinde uygulanan bir "streak reversal" stratejisini **gerçek tarihi data** ile backtest et. Strateji şu:

> Son N market üst üste aynı yönde (örn. 5× UP) kapandığında, bir sonraki markette **ters token** için `0.40` fiyatlı **GTC limit BUY** emri açılır. Emir fill olunca `0.99` fiyatlı **GTC limit SELL** koyulur.

---

## ADIM 1 — VERİ TOPLAMA

### 1A. Tüm resolved 15dk BTC marketleri çek

Gamma API endpoint:
```
GET https://gamma-api.polymarket.com/markets
  ?tag=crypto
  &closed=true
  &limit=100
  &offset=0           ← paginate: 0, 100, 200, ...
  &order=end_date_iso
  &ascending=true
```

Her sayfada offset += 100 yaparak **tüm sayfaları çek** (boş sayfa gelene kadar).

Filtrele: sadece `question` içinde `"Bitcoin Up or Down"` geçenler.

Her market için şu alanları sakla:
```
id, question,
startDate (ISO string → unix ts),
endDate   (ISO string → unix ts),
outcomes       (JSON array: ["Up","Down"] veya ["Yes","No"]),
outcomePrices  (JSON array: ["0.52","0.48"] — kapanış fiyatları),
clobTokenIds   (JSON array: [upTokenId, downTokenId]),
winnerIndex    (int: 0=Up kazandı, 1=Down kazandı),
volume         (float, USD),
liquidity      (float, USD)
```

### 1B. Sadece 15 dakikalık marketleri tut

Süreyi hesapla: `(endDate - startDate) / 60` saniye → bu değer `900` (±30s tolerance) olanlar = 15dk.

Alternatif: `question` içinden regex ile zaman aralığını parse et:
```
"12:00PM - 12:15PM" → 15dk ✓
"12:00PM - 12:05PM" → 5dk  ✗ atla
"12:00PM - 1:00PM"  → 60dk ✗ atla
```

### 1C. Resolution belirle

Her market için UP mı DOWN mı kazandı:
```python
outcomes = json.loads(market["outcomes"])
prices   = [float(x) for x in json.loads(market["outcomePrices"])]
up_idx   = next(i for i,o in enumerate(outcomes) if "up" in o.lower() or o == "Yes")
dn_idx   = 1 - up_idx

up_final = prices[up_idx]
dn_final = prices[dn_idx]

if up_final > 0.9:
    outcome = "UP"
elif dn_final > 0.9:
    outcome = "DOWN"
elif market.get("winnerIndex") == up_idx:
    outcome = "UP"
elif market.get("winnerIndex") == dn_idx:
    outcome = "DOWN"
else:
    outcome = None   # çözümlenmemiş, atla
```

### 1D. Token sıralaması

```python
up_token   = clobTokenIds[up_idx]
down_token = clobTokenIds[dn_idx]
```

---

## ADIM 2 — CLOB ORDERBOOK GEÇMİŞİ (OPSİYONEL AMA ÖNEMLİ)

Her trade sinyali için "t=5 dakika" anındaki orderbook snapshot'ını çekmek ideal ama tarihi orderbook Gamma API'da yok. Bunun yerine:

**Yaklaşım A (basit):** `outcomePrices` içindeki kapanış fiyatını kullan — bu fiyat son 5 saniyenin ortalamasıdır. Bu backtest için yeterli.

**Yaklaşım B (gelişmiş):** CLOB API'nın `/prices-history` endpointinden token fiyat geçmişini çek:
```
GET https://clob.polymarket.com/prices-history
  ?market={token_id}
  &startTs={market_open_unix}
  &endTs={market_open_unix + 300}   ← sadece ilk 5 dakika
  &fidelity=1                        ← 1 dakikalık granülasyon
```

Bu endpoint herkese açık (auth gerektirmiyor). Cevap:
```json
{ "history": [{"t": 1714000000, "p": "0.52"}, ...] }
```

t=5 dakika anındaki fiyatı al: `history` içinde `startTs + 300`'e en yakın `p` değeri.

---

## ADIM 3 — BACKTEST MANTIĞI

### Veriyi hazırla
```python
markets = fetch_all_markets()           # Adım 1
markets.sort(key=lambda m: m["endDate"])  # zamana göre sırala
```

### Streak tracker
```python
streak_dir   = None
streak_count = 0
results      = []

for i, market in enumerate(markets):
    if market["outcome"] is None:
        continue

    # Bu market sinyali tetikliyor mu?
    if streak_count >= STREAK_N and streak_dir is not None:
        signal = True
        reversal_dir = "DOWN" if streak_dir == "UP" else "UP"
    else:
        signal = False
        reversal_dir = None

    results.append({
        "market_idx":    i,
        "market_id":     market["id"],
        "endDate":       market["endDate"],
        "outcome":       market["outcome"],
        "streak_dir":    streak_dir,
        "streak_count":  streak_count,
        "signal":        signal,
        "reversal_dir":  reversal_dir,
        "volume":        market["volume"],
        "close_hour_utc": datetime.utcfromtimestamp(market["endDate"]).hour,
        # t=5 fiyatı (ADIM 2'den veya kapanış fiyatından tahmin)
        "price_at_t5_up":   market.get("t5_up_price",   market["up_final"]),
        "price_at_t5_down": market.get("t5_down_price", market["dn_final"]),
    })

    # Streak güncelle
    if market["outcome"] == streak_dir:
        streak_count += 1
    else:
        streak_dir   = market["outcome"]
        streak_count = 1
```

### Trade simülasyonu

Her sinyal için (`signal == True`):

```python
entry_price  = 0.40    # limit BUY fiyatı
sell_price   = 0.99    # limit SELL fiyatı
shares       = 6
cost         = entry_price * shares   # $2.40
win_pnl      = (sell_price - entry_price) * shares  # $3.54
loss_pnl     = -cost                                  # -$2.40

# Fill varsayımı:
#   Eğer t=5 anındaki token fiyatı fill_price <= entry_price ise:
#     → immediate fill (taker), kabul et
#   Eğer t=5 anındaki token fiyatı > entry_price ise:
#     → maker order koyuldu, fill olacak mı?
#
# Backtest için en muhafazakar yaklaşım:
#   fill = True  eğer outcomePrices'da DOWN fiyatı HIÇBIR ZAMAN 0.40'ın üstüne çıkmadıysa
#              (yani market DOWN kazandıysa DOWN zaten 0.40 civarını geçip 1.0'a gitti = fill)
#              (yani market UP kazandıysa DOWN 0.40'ın altında kalmış olabilir = fill olmayabilir)
#
# Pratik kural:
#   if reversal_dir == outcome:   # reversal yönümüz kazandı
#     assumed_fill = True         # token 0.40'tan yukarı çıktı, fill oldu
#     result = WIN (+$3.54)
#   else:                         # reversal yönümüz kaybetti
#     # Token asla 0.40'a gelmemiş olabilir (UP güçlü devam etti)
#     # Muhafazakar: %60'ı fill kabul et (intramarket vol. bazlı tahmin)
#     assumed_fill = random() < 0.60
#     result = LOSS (-$2.40) if assumed_fill else NO_FILL ($0)

fill_assumed  = (reversal_dir == outcome) or (random() < 0.60)
won           = reversal_dir == outcome
pnl           = win_pnl if won else (loss_pnl if fill_assumed else 0)
```

**NOT:** Eğer CLOB history'den t=5 anındaki gerçek fiyatı çekebildiysen fill varsayımını şöyle yap:
```python
t5_price = get_t5_price(token_id, market_open)
fill_assumed = t5_price <= entry_price or (reversal_dir == outcome)
```
Bu çok daha doğru olur.

---

## ADIM 4 — ANALİZ EDİLECEK SENARYOLAR

Şu konfigürasyonları **her birini bağımsız** test et:

### A. Streak uzunluğu (STREAK_N)
- N = 3, 4, 5, 6, 7, 8
- Diğer filtreler: YOK
- Çıktı: sinyal sayısı, fill sayısı, WR, EV/trade, toplam P&L

### B. Streak üst sınırı (STREAK_MAX)
- N=5, MAX=99 (sınırsız) vs N=5, MAX=7 vs N=5, MAX=8
- Mantık: streaks > MAX trending market = ters bahis tehlikeli

### C. Giriş anındaki fiyat bandı
- Filtre: reversal token'ın t=5 fiyatı belirtilen bantta mı?
- Test: [0.25-0.60], [0.30-0.55], [0.35-0.50], [0.40-0.65], filtre YOK
- Beklenti: bant dışı marketlerde fill olasılığı düşük

### D. Saat filtresi (UTC)
- Sadece 08:00-22:00 UTC (Avrupa + ABD seansı)
- Sadece 12:00-20:00 UTC (pik likidite)
- Filtre YOK (24 saat)
- Beklenti: gece saatleri daha ince market

### E. Volume filtresi
- > $200, > $500, > $1000 hacimli marketler
- Filtre YOK
- Beklenti: ince marketlerde daha geniş spread

### F. Kombine test
- En iyi N + en iyi saat + en iyi streak cap
- Toplam P&L, Sharpe oranı, max drawdown

---

## ADIM 5 — RAPOR EDİLECEK METRIKLER

Her senaryo için şunları hesapla ve raporla:

```
Temel istatistikler:
  - Toplam sinyal sayısı
  - Toplam fill sayısı (ve fill rate %)
  - Win sayısı, loss sayısı
  - Win rate (%)
  - Break-even WR (= cost / (win_pnl + cost) = 40.4% — sabittir)

P&L metrikleri:
  - Toplam P&L ($)
  - EV per fill ($)
  - EV per signal (fill rate dahil) ($)
  - Günlük ortalama P&L ($)
  - Aylık projeksiyon ($)

Risk metrikleri:
  - Max consecutive losses (art arda maksimum kayıp)
  - Max drawdown ($)
  - Sharpe oranı (EV / std(per-trade PnL))

Segmentasyon (STREAK_N=5 için):
  - WR ve P&L: saat bazlı (0-23 UTC, her saat için)
  - WR ve P&L: volume tierleri ($0-300, $300-1000, $1000+)
  - WR ve P&L: streak uzunluğuna göre (5, 6, 7, 8+)
  - WR ve P&L: gün bazlı (Pazartesi-Pazar)
```

---

## ADIM 6 — EK ANALİZ (VARSA)

Eğer CLOB history'den t=5 fiyatlarını çekebildiysen:

1. **Fill rate gerçeği**: Limit 0.40 emirlerin kaçı gerçekten fill olurdu?
2. **Ortalama fill fiyatı**: 0.40'a tam mı geldi, daha ucuza mı fill oldu?
3. **Entry timing**: t=5 yerine t=3 veya t=8'de girmek daha iyi mi?

---

## BEKLENEN ÇIKTI FORMATI

```
=== BTC 15dk Streak Reversal Backtest ===
Veri aralığı: [ilk market tarihi] - [son market tarihi]
Toplam 15dk BTC market: X
Toplam resolved: Y

--- STREAK UZUNLUĞU ANALİZİ ---
N | Sinyal | Fill% | WR%  | EV/fill | EV/signal | Aylık proj
3 | ...
4 | ...
5 | ...
6 | ...
7 | ...
8 | ...

--- STREAK CAP ANALİZİ (N=5) ---
MAX=∞  | ...
MAX=8  | ...
MAX=7  | ...
MAX=6  | ...

--- FİYAT BANDI ANALİZİ (N=5) ---
Bant       | Sinyal | Fill% | WR%  | EV/fill
YOK        | ...
0.25-0.60  | ...
0.30-0.55  | ...
0.35-0.50  | ...

--- SAAT FİLTRESİ (N=5) ---
24 saat    | ...
08-22 UTC  | ...
12-20 UTC  | ...

--- VOLUMEFİLTRESİ (N=5) ---
YOK        | ...
>$200      | ...
>$500      | ...
>$1000     | ...

--- SAAT BAZLI SEGMENTASYON (N=5, filtre yok) ---
Saat UTC | Sinyal | WR% | EV/fill
00       | ...
01       | ...
...
23       | ...

--- GÜNLÜK SEGMENTASYON (N=5) ---
Pzt | Sal | ... | Paz

--- MAX DRAWDOWN & RISK ---
...

--- ÖNERİLEN KONFİGÜRASYON ---
[backteste dayalı en iyi parametre seti]
```

---

## STRATEJİNİN TEKNİK PARAMETRELERİ (referans)

```
BUY_PRICE  = 0.40    # GTC limit BUY fiyatı
SELL_PRICE = 0.99    # Fill sonrası GTC limit SELL
BUY_SHARES = 6       # Her seferde 6 share
COST       = 2.40    # $2.40 max risk per trade
WIN_PNL    = 3.54    # $3.54 hedef kâr per win (6sh × $0.59)
BREAK_EVEN = 40.4%   # Minimum gerekli WR (2.40 / (3.54 + 2.40))

# Oracle: Polymarket BTC 15dk = Binance BTC/USDT
# UP kazanır: close_price > open_price (15dk penceresi)
# DOWN kazanır: close_price <= open_price
```

---

## NOTLAR

- Gamma API rate limit: 10 req/s, paginate'te 300ms delay koy
- `outcomePrices` bazen JSON string olarak geliyor, parse et
- `winnerIndex` bazı eski marketlerde null → `outcomePrices`'dan al
- 5dk ve 15dk marketler için `question` formatları farklı olabilir, duration hesabını doğrula
- Backtest sonuçlarını JSON ve Markdown tablo olarak kaydet

---

*Hazırlayan: claude/btc-bot-optimization-SzxdH branch — 25 Mayıs 2026*
