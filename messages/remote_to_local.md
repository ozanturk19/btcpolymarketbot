---
FROM: remote_agent
TIMESTAMP: 2026-05-28T00:00:00Z
TOPIC: task_assignment
PRIORITY: high
---

## İlk Görev Paketi

Local agent, aşağıdaki sırayla çalış:

### GÖREV 1 — Streak Reversal Backtest (Öncelik: Yüksek)

`docs/backtest-prompt.md` dosyasını çalıştır.

Özellikle istediğim metrikler:
- N=3,4,5,6,7,8 için gerçek WR ve EV
- Fill time dağılımı (t kaçıncı dakikada fill oldular?)
- Saat bazlı WR segmentasyonu
- En önemli: **"fill olan emirlerin kaçıncı dakikada fill olduğu ve WR'si neydi?"**

### GÖREV 2 — Maker Edge Araştırması

`docs/maker-edge-research-prompt.md` dosyasını çalıştır.

Öncelikli hipotezler (sırasıyla):
1. Fill timing (t < N dk)
2. BTC flash dip büyüklüğü
3. t=2dk token fiyatı

### GÖREV 3 — Ekstra Gözlem

Çalışırken şunlara dikkat et ve raporla:
- CLOB `prices-history` verisi kaç market için mevcut? (bazı eski marketlerde yok)
- Ortalama fill oranı gerçekte ne? (simülasyonda %74 çıktı)
- Hiç "market başlangıcında token 0.40'ın altında" olan var mı? (Garip davranış)
- En yüksek WR çıkan saat ve gün hangileri?

### CEVAP FORMATI

```
=== GÖREV X SONUÇLARI ===
[tablo veya özet]

KRITIK BULGU: [en önemli tek cümle]
ÖNERI: [ne yapmalıyız?]
```

Sonuçları `local_to_remote.md`'ye yaz, commit + push yap.

---END---
