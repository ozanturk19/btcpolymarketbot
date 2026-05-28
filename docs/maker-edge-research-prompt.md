# Maker Order Edge Araştırması — Lokal Ajan Prompt'u

Bu prompt'u lokal ortamında çalıştıracak bir ajana ver.
Polymarket Gamma API, CLOB API ve Binance API'ya erişimin var.
Hedef: **"GTC limit BUY @ 0.40, SELL @ 0.99" stratejisinde pozitif EV anları bulmak.**

---

## BAĞLAM

BTC 15dk Polymarket marketlerinde maker limit stratejisi teorik olarak EV-negatif:
- Break-even WR = **%40.4** (COST=$2.40, WIN=$3.54)
- Simülasyonda elde edilen WR = **%32-33**
- Gap = **~8 puan** — bu gap'i kapatacak koşulları bul

Teori: Token 0.40'a düştüğünde fair value'nun da 0.40 civarı olması adverse selection'dan kaynaklanıyor.
Eğer token 0.40'a düştüğünde fair value **>0.45** ise → EV pozitif.

**Araştırmanın amacı:** Gerçek veride "fill anındaki fair value > 0.45" olan koşulları bulmak.

---

## ADIM 0 — VERİ TOPLAMA (Önceden bak: backtest-prompt.md ile aynı)

### 0A. Resolved 15dk BTC marketleri çek

```python
import requests, time, json
from datetime import datetime

def fetch_all_15m_btc_markets():
    """Tüm resolved 15dk BTC marketlerini çek."""
    markets = []
    offset = 0
    while True:
        r = requests.get(
            'https://gamma-api.polymarket.com/markets',
            params={
                'tag': 'crypto',
                'closed': 'true',
                'limit': 100,
                'offset': offset,
                'order': 'end_date_iso',
                'ascending': 'true'
            }
        )
        page = r.json()
        if not page:
            break

        for m in page:
            q = m.get('question', '')
            if 'Bitcoin Up or Down' not in q:
                continue
            # Duration filtresi
            start_ts = int(datetime.fromisoformat(m['startDate'].replace('Z','+00:00')).timestamp())
            end_ts   = int(datetime.fromisoformat(m['endDate'].replace('Z','+00:00')).timestamp())
            dur = end_ts - start_ts
            if abs(dur - 900) > 30:  # ±30s tolerance
                continue
            markets.append({
                'id':        m['id'],
                'question':  q,
                'startTs':   start_ts,
                'endTs':     end_ts,
                'outcomes':  json.loads(m['outcomes']),
                'prices':    [float(x) for x in json.loads(m['outcomePrices'])],
                'tokens':    json.loads(m.get('clobTokenIds', '[]')),
                'volume':    float(m.get('volume', 0) or 0),
                'liquidity': float(m.get('liquidity', 0) or 0),
            })

        offset += 100
        time.sleep(0.3)

    return markets

def resolve_outcome(m):
    """UP mu DOWN mu kazandı."""
    outcomes = m['outcomes']
    prices   = m['prices']
    up_idx   = next((i for i,o in enumerate(outcomes) if 'up' in o.lower() or o=='Yes'), None)
    if up_idx is None:
        return None, None, None
    dn_idx = 1 - up_idx
    up_final = prices[up_idx]
    dn_final = prices[dn_idx]
    if up_final > 0.9:
        outcome = 'UP'
    elif dn_final > 0.9:
        outcome = 'DOWN'
    else:
        outcome = None
    return outcome, m['tokens'][up_idx] if len(m['tokens']) > up_idx else None, \
                    m['tokens'][dn_idx] if len(m['tokens']) > dn_idx else None
```

### 0B. CLOB intramarket token fiyat serisi çek

```python
def fetch_token_price_history(token_id, start_ts, end_ts):
    """
    Token'ın market süresince 1dk granüllü fiyat serisini çek.
    Dönüş: list of (timestamp, price)
    """
    r = requests.get(
        'https://clob.polymarket.com/prices-history',
        params={
            'market':    token_id,
            'startTs':   start_ts,
            'endTs':     end_ts,
            'fidelity':  1          # 1 dakika
        }
    )
    data = r.json()
    history = data.get('history', [])
    return [(h['t'], float(h['p'])) for h in history]

# Kullanım:
# for market in markets:
#     outcome, up_tok, dn_tok = resolve_outcome(market)
#     if outcome is None: continue
#     up_history = fetch_token_price_history(up_tok, market['startTs'], market['endTs'])
#     dn_history = fetch_token_price_history(dn_tok, market['startTs'], market['endTs'])
#     time.sleep(0.15)  # rate limit
```

### 0C. Binance BTC fiyat serisi çek (aynı zaman aralığı)

```python
def fetch_btc_klines(start_ts_ms, end_ts_ms, interval='1m'):
    """
    Binance BTC/USDT klines, 1dk granül, start-end arası.
    Dönüş: list of {open_time, open, high, low, close, volume}
    """
    r = requests.get(
        'https://api.binance.com/api/v3/klines',
        params={
            'symbol':    'BTCUSDT',
            'interval':  interval,
            'startTime': start_ts_ms,
            'endTime':   end_ts_ms,
            'limit':     20
        }
    )
    klines = r.json()
    return [{
        'open_time': k[0] // 1000,
        'open':  float(k[1]),
        'high':  float(k[2]),
        'low':   float(k[3]),
        'close': float(k[4]),
        'volume': float(k[5])
    } for k in klines]
```

### 0D. Her market için veri birleştir

```python
import math

BUY_PRICE  = 0.40
SELL_PRICE = 0.99
SHARES     = 6
WIN_PNL    = (SELL_PRICE - BUY_PRICE) * SHARES  # $3.54
LOSS_PNL   = -BUY_PRICE * SHARES                # -$2.40
BREAKEVEN_WR = BUY_PRICE / (WIN_PNL + BUY_PRICE * SHARES)  # 0.4040

def simulate_fill(price_history, entry_start_min=0, entry_end_min=15):
    """
    Token fiyat serisinde 0.40 limitin fill zamanını bul.
    price_history: [(timestamp, price), ...]
    Dönüş: {'filled': bool, 'fill_time_min': float|None, 'fill_price': float|None}
    """
    start_ts = price_history[0][0] if price_history else 0
    for ts, price in price_history:
        elapsed_min = (ts - start_ts) / 60.0
        if elapsed_min < entry_start_min:
            continue
        if elapsed_min > entry_end_min:
            break
        if price <= BUY_PRICE:
            return {'filled': True, 'fill_time_min': elapsed_min, 'fill_price': price}
    return {'filled': False, 'fill_time_min': None, 'fill_price': None}

def build_dataset(markets, sample_size=None):
    """
    Her market için tam veri setini oluştur.
    """
    dataset = []
    markets_sorted = sorted(markets, key=lambda m: m['startTs'])
    if sample_size:
        markets_sorted = markets_sorted[-sample_size:]  # en güncel N market

    for i, m in enumerate(markets_sorted):
        outcome, up_tok, dn_tok = resolve_outcome(m)
        if outcome is None or up_tok is None:
            continue

        # Token geçmişi çek
        up_hist = fetch_token_price_history(up_tok, m['startTs'], m['endTs'])
        dn_hist = fetch_token_price_history(dn_tok, m['startTs'], m['endTs'])
        time.sleep(0.15)

        # BTC geçmişi çek
        btc_klines = fetch_btc_klines(m['startTs'] * 1000, m['endTs'] * 1000)
        # 1 saat öncesi BTC verisi
        btc_1h = fetch_btc_klines((m['startTs'] - 3600) * 1000, m['startTs'] * 1000)
        time.sleep(0.15)

        # Saatlik BTC ortalaması
        hour_avg = sum(k['close'] for k in btc_1h) / len(btc_1h) if btc_1h else None
        btc_open = btc_klines[0]['open'] if btc_klines else None
        change1h = (btc_open - hour_avg) / hour_avg if (hour_avg and btc_open) else None

        # BTC volatilite (son 1 saat)
        if btc_1h:
            returns_1h = [abs((k['close']-k['open'])/k['open']) for k in btc_1h]
            btc_vol_1h = sum(returns_1h) / len(returns_1h)
        else:
            btc_vol_1h = None

        # BTC ilk 2dk hareketi (flash dip tespit için)
        btc_move_2m = None
        if btc_klines and len(btc_klines) >= 2:
            btc_move_2m = (btc_klines[1]['close'] - btc_klines[0]['open']) / btc_klines[0]['open']

        # UP ve DOWN için fill simülasyonu
        for side, token_hist, target_outcome in [('UP', up_hist, 'UP'), ('DOWN', dn_hist, 'DOWN')]:
            fill_info = simulate_fill(token_hist)
            won = (side == outcome) if fill_info['filled'] else None

            # Token fiyatı t=2 dk'da ne idi? (early price)
            t2_price = None
            for ts, price in token_hist:
                elapsed = (ts - m['startTs']) / 60.0
                if elapsed >= 2.0:
                    t2_price = price
                    break

            # Token minimum fiyatı (en derin dip)
            min_price = min((p for _,p in token_hist), default=None)

            dataset.append({
                'market_id':       m['id'],
                'startTs':         m['startTs'],
                'endTs':           m['endTs'],
                'hour_utc':        datetime.utcfromtimestamp(m['startTs']).hour,
                'day_of_week':     datetime.utcfromtimestamp(m['startTs']).weekday(),
                'volume':          m['volume'],
                'outcome':         outcome,
                'side':            side,
                'filled':          fill_info['filled'],
                'fill_time_min':   fill_info['fill_time_min'],
                'fill_price':      fill_info['fill_price'],
                'won':             won,
                'change1h':        change1h,
                'btc_vol_1h':      btc_vol_1h,
                'btc_move_2m':     btc_move_2m,
                't2_price':        t2_price,
                'token_min_price': min_price,
                'market_idx':      i,
            })

        if i % 50 == 0:
            print(f'  Progress: {i}/{len(markets_sorted)} markets processed')

    return dataset
```

---

## HİPOTEZ 1 — Brownian Bridge: Fill Zamanı < N dakika

**Teori:** Market başından itibaren geçen süre arttıkça token recover şansı azalır.
t=2dk'da 0.40 fill = hâlâ 13dk var = recovery mümkün.
t=13dk'da 0.40 fill = neredeyse kaybettik.

**Test:**

```python
def test_hypothesis_1(dataset):
    """Fill zamanı → WR ilişkisi"""
    print('\n=== HİPOTEZ 1: Fill Timing → Win Rate ===')
    print('Fill Time(dk) | n_fills | WR%   | EV/fill | Fark BE')
    print('--------------|---------|-------|---------|--------')

    # 1dk buckets: [0-1), [1-2), ..., [14-15]
    buckets = {}
    for row in dataset:
        if not row['filled'] or row['won'] is None:
            continue
        t = int(row['fill_time_min'])
        if t not in buckets:
            buckets[t] = {'fills': 0, 'wins': 0}
        buckets[t]['fills'] += 1
        if row['won']:
            buckets[t]['wins'] += 1

    best_cutoff = None
    best_ev = -999
    for t in sorted(buckets):
        b = buckets[t]
        wr = b['wins'] / b['fills'] if b['fills'] > 0 else 0
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        diff = wr - BREAKEVEN_WR
        sign = '✓' if ev > 0 else '✗'
        print(f't={t:02d}          | {b["fills"]:7d} | {wr*100:5.2f} | ${ev:7.4f} | {diff*100:+.2f}% {sign}')
        if ev > best_ev:
            best_ev = ev
            best_cutoff = t

    # Kümülatif: "sadece t<N fill kabul et"
    print('\nKümülatif (t<N olursa al):')
    print('Max fill (dk) | n_fills | WR%   | EV/fill | Daily proj (96/gün × fillrate)')
    for cutoff in [2, 3, 4, 5, 6, 8, 10, 15]:
        subset = [r for r in dataset if r['filled'] and r['won'] is not None
                  and r['fill_time_min'] is not None and r['fill_time_min'] < cutoff]
        if not subset:
            continue
        wins = sum(1 for r in subset if r['won'])
        wr = wins / len(subset)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL

        # Fill rate: bu cutoff ile kaç sinyal fill olur?
        total_signals = len([r for r in dataset if r['filled'] or not r['filled']])
        fill_rate = len(subset) / (total_signals / 2)  # /2 çünkü UP+DOWN ayrı
        daily_fills = 96 * fill_rate
        daily_pnl = daily_fills * ev

        sign = '✓ POSITIVE' if ev > 0 else '✗ negative'
        print(f't < {cutoff:2d}dk       | {len(subset):7d} | {wr*100:5.2f} | ${ev:7.4f} | ${daily_pnl:.2f}/gün  {sign}')
```

**Rapor edilmesi gereken:**
- Her fill zamanı (0-15dk) için WR ve EV
- "t < N" kümülatif filtresi en iyi N değeri
- Bu N değerinde günlük beklenen P&L
- WR > %40.4 olan herhangi bir zaman dilimi var mı?

---

## HİPOTEZ 2 — Flash Dip: BTC Küçük Hareket → Token Aşırı Tepki

**Teori:** Token 0.40'a düşse de BTC hareketi küçükse (<0.3%), dip "overreaction" — token toparlar.

**Test:**

```python
def test_hypothesis_2(dataset):
    """BTC_move_2m büyüklüğü → WR ilişkisi"""
    print('\n=== HİPOTEZ 2: BTC Hareketi Büyüklüğü → Fill Kalitesi ===')

    filled = [r for r in dataset if r['filled'] and r['won'] is not None
              and r['btc_move_2m'] is not None]

    # BTC hareketi abssolute değer buckets
    thresholds = [0.001, 0.002, 0.003, 0.005, 0.01]
    print('\nBTC ilk 2dk hareketi < X ise fill kabul et:')
    print('BTC move max | n_fills | WR%   | EV/fill | Karar')
    for thr in thresholds:
        subset = [r for r in filled if abs(r['btc_move_2m']) < thr]
        if len(subset) < 10:
            continue
        wins = sum(1 for r in subset if r['won'])
        wr = wins / len(subset)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        sign = '✓' if ev > 0 else '✗'
        print(f'< {thr*100:.2f}%       | {len(subset):7d} | {wr*100:5.2f} | ${ev:7.4f} | {sign}')

    # Momentum yönü ile token yönü uyumu: small BTC down + buy DOWN token
    print('\nKombinasyon: BTC hareketi < 0.2% VE yön uyumlu:')
    for thr in [0.001, 0.002, 0.003]:
        # Sadece yön uyumlu (BTC aşağı → DOWN token al)
        subset = [r for r in filled
                  if abs(r['btc_move_2m']) < thr
                  and ((r['btc_move_2m'] < 0 and r['side'] == 'DOWN')
                    or (r['btc_move_2m'] > 0 and r['side'] == 'UP'))]
        if len(subset) < 10:
            continue
        wins = sum(1 for r in subset if r['won'])
        wr = wins / len(subset)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        sign = '✓' if ev > 0 else '✗'
        print(f'BTC<{thr*100:.2f}%+dir | {len(subset):7d} | {wr*100:5.2f} | ${ev:7.4f} | {sign}')

    # BTC hareketi vs fill_time_min saçılım: hangi quadrant en iyi?
    print('\nQuadrant analizi (BTC hareketi x Fill Zamanı):')
    print('           | t<4dk  | t>=4dk')
    print('BTC<0.3%   |   ?    |   ?')
    print('BTC>=0.3%  |   ?    |   ?')
    quads = {(True, True): [], (True, False): [], (False, True): [], (False, False): []}
    for r in filled:
        if r['fill_time_min'] is None:
            continue
        small = abs(r['btc_move_2m']) < 0.003
        early = r['fill_time_min'] < 4
        quads[(small, early)].append(r)
    labels = {(True,True): 'SmallBTC+Early', (True,False): 'SmallBTC+Late',
              (False,True): 'BigBTC+Early',   (False,False): 'BigBTC+Late'}
    for key, subset in quads.items():
        if not subset:
            continue
        wins = sum(1 for r in subset if r['won'])
        wr = wins / len(subset)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        sign = '✓ EDGE' if ev > 0 else '✗ loss'
        print(f'{labels[key]:15s}: n={len(subset):5d} WR={wr*100:.2f}% EV=${ev:.4f} {sign}')
```

---

## HİPOTEZ 3 — Token t=2dk Fiyatı: "Dip Derinliği" Filtresi

**Teori:** Market başında (t=2dk) token 0.45-0.55 arasındayken birden 0.40'a düşmesi overreaction.
Baştan 0.40'ın altındaysa "zaten kötü market" → atla.

```python
def test_hypothesis_3(dataset):
    """t=2dk token fiyatı filtresi"""
    print('\n=== HİPOTEZ 3: t=2dk Token Fiyatı → Kalite Filtresi ===')

    filled = [r for r in dataset if r['filled'] and r['won'] is not None
              and r['t2_price'] is not None]

    print('t=2dk fiyat  | n_fills | WR%   | EV/fill | Karar')
    # t=2 anında token fiyatı > X ise (yani sonradan düştü = overreaction)
    for min_t2 in [0.42, 0.44, 0.46, 0.48, 0.50, 0.52, 0.55]:
        subset = [r for r in filled if r['t2_price'] >= min_t2]
        if len(subset) < 10:
            continue
        wins = sum(1 for r in subset if r['won'])
        wr = wins / len(subset)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        sign = '✓' if ev > 0 else '✗'
        print(f'>= {min_t2:.2f}       | {len(subset):7d} | {wr*100:5.2f} | ${ev:7.4f} | {sign}')

    # t=2dk fiyat > 0.46 VE fill < 4dk = düştü ama kısa sürede
    print('\nKombine: t2>0.46 VE fill_time<4dk:')
    subset = [r for r in filled
              if r['t2_price'] >= 0.46 and r['fill_time_min'] < 4]
    if subset:
        wins = sum(1 for r in subset if r['won'])
        wr = wins / len(subset)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        print(f'n={len(subset)} WR={wr*100:.2f}% EV=${ev:.4f} {"✓ EDGE" if ev > 0 else "✗ loss"}')
```

---

## HİPOTEZ 4 — Streak Reversal Kalitesi (Mevcut Strateji)

**Teori:** N streak sonrası token zaten düşük fiyatlı → adverse selection daha az zarar veriyor.

```python
def test_hypothesis_4(dataset, markets_sorted):
    """Streak reversal: N değeri vs WR"""
    print('\n=== HİPOTEZ 4: Streak N Değeri → WR ===')

    # Market streak'lerini hesapla
    streak_dir, streak_count = None, 0
    market_streaks = {}  # startTs → (streak_dir, streak_count)

    for m in markets_sorted:
        outcome, _, _ = resolve_outcome(m)
        if outcome is None:
            continue
        market_streaks[m['startTs']] = (streak_dir, streak_count)
        if outcome == streak_dir:
            streak_count += 1
        else:
            streak_dir   = outcome
            streak_count = 1

    # Streak durumunu dataset'e ekle
    for row in dataset:
        sc = market_streaks.get(row['startTs'])
        row['streak_count'] = sc[1] if sc else 0
        row['streak_dir']   = sc[0] if sc else None
        # reversal side: streak ile ters
        if row['streak_dir'] is not None:
            row['is_reversal'] = (row['side'] != row['streak_dir'])
        else:
            row['is_reversal'] = False

    print('N streak | signals | fills | WR%   | EV/fill | Karar')
    for n in [3, 4, 5, 6, 7, 8]:
        subset = [r for r in dataset
                  if r['streak_count'] >= n and r['is_reversal']
                  and r['filled'] and r['won'] is not None]
        if len(subset) < 5:
            continue
        wins = sum(1 for r in subset if r['won'])
        wr = wins / len(subset)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        sign = '✓' if ev > 0 else '✗'
        print(f'N>={n}      | {len(subset):7d} | {len(subset):5d} | {wr*100:5.2f} | ${ev:7.4f} | {sign}')

    # Streak reversal + fill time filtresi
    print('\nStreak N>=5 + fill time filtresi:')
    for cutoff in [3, 5, 8, 15]:
        subset = [r for r in dataset
                  if r['streak_count'] >= 5 and r['is_reversal']
                  and r['filled'] and r['won'] is not None
                  and r['fill_time_min'] is not None and r['fill_time_min'] < cutoff]
        if len(subset) < 5:
            continue
        wins = sum(1 for r in subset if r['won'])
        wr = wins / len(subset)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        print(f't<{cutoff:2d}dk: n={len(subset):4d} WR={wr*100:.2f}% EV=${ev:.4f} {"✓" if ev>0 else "✗"}')
```

---

## HİPOTEZ 5 — Düşük Volatilite Penceresi

```python
def test_hypothesis_5(dataset):
    """Düşük vol filtresi → WR"""
    print('\n=== HİPOTEZ 5: BTC Vol Filtresi ===')

    filled = [r for r in dataset if r['filled'] and r['won'] is not None
              and r['btc_vol_1h'] is not None]

    print('Max 1h vol | n_fills | WR%   | EV/fill')
    for max_vol in [0.001, 0.0015, 0.002, 0.003, 0.005, 999]:
        label = f'< {max_vol*100:.2f}%' if max_vol < 999 else 'Tümü'
        subset = [r for r in filled if r['btc_vol_1h'] < max_vol]
        if len(subset) < 10:
            continue
        wins = sum(1 for r in subset if r['won'])
        wr = wins / len(subset)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        sign = '✓' if ev > 0 else '✗'
        print(f'{label:10s} | {len(subset):7d} | {wr*100:5.2f} | ${ev:.4f} {sign}')
```

---

## ADIM FINAL — KOMBİNE TEST

Tüm analizlerden çıkan "promising" filtreleri birleştir:

```python
def test_combined(dataset):
    """En iyi filtrelerin kombinasyonu"""
    print('\n=== KOMBİNE FİLTRE TESTİ ===')

    # Önce en iyi tek filtreleri bul (yukarıdaki analizlerden),
    # sonra aşağıya ekle:
    filters = {
        'Tümü':              lambda r: True,
        't<4dk':             lambda r: r['fill_time_min'] is not None and r['fill_time_min'] < 4,
        't2>0.46':           lambda r: r['t2_price'] is not None and r['t2_price'] > 0.46,
        'BTC<0.3%':          lambda r: r['btc_move_2m'] is not None and abs(r['btc_move_2m']) < 0.003,
        'Streak>=5':         lambda r: r.get('is_reversal', False) and r.get('streak_count', 0) >= 5,
        't<4 + t2>0.46':     lambda r: (r['fill_time_min'] is not None and r['fill_time_min'] < 4
                                        and r['t2_price'] is not None and r['t2_price'] > 0.46),
        't<4 + BTC<0.3%':    lambda r: (r['fill_time_min'] is not None and r['fill_time_min'] < 4
                                        and r['btc_move_2m'] is not None and abs(r['btc_move_2m']) < 0.003),
        'Tüm filtreler':     lambda r: (r['fill_time_min'] is not None and r['fill_time_min'] < 4
                                        and r['t2_price'] is not None and r['t2_price'] > 0.46
                                        and r['btc_move_2m'] is not None and abs(r['btc_move_2m']) < 0.003),
    }

    print('Filtre                | n_fills | WR%   | EV/fill | Daily$ (proj) | Karar')
    print('----------------------|---------|-------|---------|---------------|------')
    total_markets = len(set(r['startTs'] for r in dataset)) * 2  # UP+DOWN
    for name, fn in filters.items():
        filled = [r for r in dataset if r['filled'] and r['won'] is not None and fn(r)]
        if len(filled) < 5:
            print(f'{name:22s}| {"az veri":>7} | - | - | - | -')
            continue
        wins = sum(1 for r in filled if r['won'])
        wr = wins / len(filled)
        ev = wr * WIN_PNL + (1-wr) * LOSS_PNL
        # Günlük projeksiyon: (toplam fill / toplam gün) × EV
        n_days = (max(r['startTs'] for r in dataset) - min(r['startTs'] for r in dataset)) / 86400
        n_days = max(n_days, 1)
        daily = (len(filled) / n_days) * ev
        sign = '✓ EDGE' if ev > 0 else '✗ loss'
        print(f'{name:22s}| {len(filled):7d} | {wr*100:5.2f} | ${ev:7.4f} | ${daily:9.2f}   | {sign}')

    # İstatistiksel anlamlılık (t-test)
    from scipy import stats as scipy_stats
    print('\nİstatistiksel anlamlılık (tek örneklem t-test, H0: WR=40.4%):')
    print('Filtre                | n  | WR%   | p-value | Anlamlı?')
    for name, fn in filters.items():
        filled = [r for r in dataset if r['filled'] and r['won'] is not None and fn(r)]
        if len(filled) < 20:
            continue
        outcomes = [1 if r['won'] else 0 for r in filled]
        t_stat, p_val = scipy_stats.ttest_1samp(outcomes, BREAKEVEN_WR)
        wr = sum(outcomes) / len(outcomes)
        sig = '✓ p<0.05' if p_val < 0.05 and wr > BREAKEVEN_WR else '✗ no'
        print(f'{name:22s}| {len(filled):4d} | {wr*100:5.2f} | {p_val:.4f}  | {sig}')
```

---

## ÇALIŞTIRMA SIRASI

```python
# main.py
import json

print('1. Market verisi çekiliyor...')
markets = fetch_all_15m_btc_markets()
print(f'   {len(markets)} adet 15dk BTC market bulundu')

print('2. Dataset oluşturuluyor (CLOB + Binance)...')
# Son 200 market ile başla (test için), tüm veri için sample_size=None
dataset = build_dataset(markets, sample_size=200)

print('3. Dataset kaydediliyor...')
with open('maker_edge_dataset.json', 'w') as f:
    json.dump(dataset, f, indent=2)

print('4. Hipotez testleri çalıştırılıyor...')
markets_sorted = sorted(markets, key=lambda m: m['startTs'])

test_hypothesis_1(dataset)
test_hypothesis_2(dataset)
test_hypothesis_3(dataset)
test_hypothesis_4(dataset, markets_sorted)
test_hypothesis_5(dataset)
test_combined(dataset)

print('\nARAŞTIRMA TAMAMLANDI')
print('maker_edge_dataset.json dosyasını incele.')
```

---

## BEKLENEN ÇIKTI FORMATI

```
=== MAKER EDGE ARAŞTIRMASI RAPORU ===
Veri: [tarih aralığı]
Market sayısı: X
Fill sayısı: Y
Fill rate: Z%

--- HİPOTEZ 1: Fill Timing ---
t<2dk:  n=? WR=?%  EV=$?  [✓/✗]
t<4dk:  n=? WR=?%  EV=$?  [✓/✗]
...
SONUÇ: [En iyi cutoff: t<X dk]

--- HİPOTEZ 2: Flash Dip ---
BTC<0.1%: n=? WR=?% EV=$? [✓/✗]
BTC<0.3%: n=? WR=?% EV=$? [✓/✗]
...
SONUÇ: [BTC < X% filtresi ile EV=?]

--- HİPOTEZ 3: t=2dk Token Fiyatı ---
t2>0.46: n=? WR=?% EV=$? [✓/✗]
...

--- HİPOTEZ 4: Streak Reversal ---
N>=5: n=? WR=?% EV=$? [✓/✗]
N>=5 + t<4dk: n=? WR=?% EV=$? [✓/✗]

--- KOMBİNE FİLTRE ---
En iyi kombinasyon: [filtreler]
WR: ?%  EV/fill: $?  Daily: $?

--- ÖNERİLEN BOT PARAMETRELERİ ---
FILL_DEADLINE_MIN = X
MIN_T2_PRICE      = X
MAX_BTC_MOVE_BPS  = X
MIN_STREAK_N      = X (eğer streak stratejisi ise)
```

---

## NOTLAR

- Rate limit: Gamma 10 req/s (300ms delay), CLOB 5 req/s (200ms delay), Binance 1200 req/dk
- `maker_edge_dataset.json` büyük olacak: 200 market × 2 side = 400 satır
- Tüm tarihi market için: ~3000+ market, çekmesi 30+ dakika sürebilir
- `sample_size=200` ile başla, hipotezler tutarlıysa tüm veri ile tekrar çalıştır
- Scipy gerekli: `pip install scipy`
- `fill_time_min is None` kontrollerini atlamayın — bazı marketlerde CLOB history boş gelebilir

---

*Hazırlayan: claude/btc-bot-optimization-SzxdH — 28 Mayıs 2026*
