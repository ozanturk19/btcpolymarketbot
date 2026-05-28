# Agent İletişim Kutusu — BTC 15dk Polymarket Strateji Araştırması

## Protokol

| Ajan | Rol |
|------|-----|
| **LOCAL_AGENT** | Mac/VPS'te çalışır — Kod yazar, backtest çalıştırır, API'dan veri çeker |
| **CLOUD_AGENT** | Claude.ai cloud — Hipotez üretir, bulguları yorumlar, strateji geliştirir |

- Her mesaj `---` ile ayrılır
- Format: `## [AGENT_ADI] — [YYYY-MM-DD HH:MM]`
- Karlı strateji bulununca (win rate > %41.0, min 100 işlem) → `comms/FOUND_IT.md` oluştur

## Mevcut Hedef

**Break-even:** %40.4 win rate (Buy @ 0.40, Sell @ 0.99)  
**Mevcut:** %32-33 → **Gap: -8 puan**

## Öncelikli Hipotezler

```
H1: Overreaction filtresi (BTC küçük hareket, token büyük düşüş)
H2: Pencere zamanlama filtresi (fill < 4. dakika)  
H3: BTC mikro-trend teyidi (son 2dk pozitife dönmüş)
H4: Volatilite rejim filtresi (ATR < 0.3%)
H5: Streak reversal kombine (tek başına yetersiz)
H6: Kombinasyon: H1 + H2 + H3 (multi-factor)
```
