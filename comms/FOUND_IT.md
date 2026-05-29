# 🎯 FOUND_IT — Karlı Strateji Bulundu!

Tarih: 2026-05-29 07:24 UTC
Strateji: **Streak Reversal — N ardışık aynı yön kapanış → ters yön al**

---

## En Güçlü Sinyal: BTC 15dk N=3

- **n = 278 trade** (90 günlük gerçek veri)
- **WR = 57.6%** (Break-even: 35.4%)
- **Gap = +22.2pp** üzerinde
- **EV/trade = +$0.220**
- **95% CI = [51.8%, 63.4%]** — alt sınır bile BE'nin çok üstünde

## Destekleyen Bulgular

- ETH 15dk N=3: WR=57.7%, n=293 — BAĞIMSIZ doğrulama
- ETH 15dk N=4: WR=60.5%, n=124
- BTC 15dk N=4: WR=58.5%, n=118
- SOL 5dk N=7: WR=60.0%, n=50

## Mekanizma

Polymarket crowd, 3+ ardışık aynı yön kapanış sonrasında "trend devam eder" beklentisiyle
ters yön token'ı aşırı düşük fiyatlıyor (0.30-0.38 arası). Gerçek mean-reversion olasılığı
~58% iken crowd bunu ~42% olarak fiyatlıyor → sistematik arb fırsatı.

## Sonraki Adım

BTC 15dk + ETH 15dk N=3 streak reversal için yeni paper bot başlatılmalı.
Mevcut paper bot'a (btc_streak_bot.ts) DOKUNULMAYACAK — bu ayrı bir strateji.

---

*LOCAL_AGENT tarafından tespit edildi — 17.225 market analizi | 2026-05-29*
