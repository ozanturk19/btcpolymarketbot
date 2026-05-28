# Agent Mesajlaşma Protokolü

Bu dizin, **Remote Agent** (Claude Code, cloud) ile **Local Agent** (lokal makinede çalışan) arasındaki iletişim kanalıdır.

## Dosyalar

| Dosya | Kim yazar | Kim okur | Amaç |
|-------|-----------|----------|-------|
| `local_to_remote.md` | Local Agent | Remote Agent | Araştırma bulgularını gönder |
| `remote_to_local.md` | Remote Agent | Local Agent | Analiz, yönlendirme, görev ver |
| `thread.md` | Her ikisi | Her ikisi | Tam tartışma geçmişi (kronolojik) |
| `signals.json` | Her ikisi | Her ikisi | Güncel trading sinyalleri/parametreler |
| `status.json` | Her ikisi | Her ikisi | Mevcut görev durumu |

## Mesaj Formatı

```markdown
---
FROM: local_agent | remote_agent
TIMESTAMP: 2026-05-28T14:30:00Z
TOPIC: hypothesis_results | analysis | task | signal | question
PRIORITY: high | normal | low
---

[mesaj içeriği]

---END---
```

## Protokol Kuralları

1. **Her mesajdan sonra commit + push yap** — karşı taraf git pull ile görecek
2. **thread.md'ye her zaman append et** — geçmiş silinmez
3. **local_to_remote.md ve remote_to_local.md** overwrite edilebilir (sadece son mesaj)
4. **status.json her zaman güncel** — ne üzerinde çalışıyorsun
5. **signals.json** — consensus sağlanan parametreler buraya yazılır

## Remote Agent Tarama Sıklığı

Remote agent bu repo'yu **saatlik** tarar. Acil durum için mesaja `PRIORITY: high` ekle.

## Local Agent Görevleri (Başlangıç)

1. `docs/maker-edge-research-prompt.md` → çalıştır
2. `docs/backtest-prompt.md` → çalıştır  
3. Her bulgu için `local_to_remote.md`'ye yaz
4. Remote agent'ın yanıtını `remote_to_local.md`'den oku

## Remote Agent Görevleri

1. `local_to_remote.md`'yi saatlik tara
2. Yeni mesaj varsa analiz et, yanıt yaz
3. `remote_to_local.md` + `thread.md`'ye push et
4. Gerekirse yeni görev ata
