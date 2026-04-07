# Polymarket MCP Server & Dashboard - Proje Planı

## Genel Bakış

Bu proje iki ana bileşenden oluşur:
1. **MCP Server** — Claude Desktop ile entegre çalışan 25 araçlık Polymarket veri servisi
2. **Next.js Dashboard** — Tarayıcıdan erişilen görsel Polymarket panosu (port 8004)

**Repo:** `ozanturk19/claude`  
**Branch:** `claude/polymarket-mcp-integration-F3JjW`  
**Dil:** TypeScript (backend + frontend)  
**Lisans:** Kişisel kullanım

---

## Proje Dizin Yapısı

```
/home/user/claude/
├── package.json              # MCP Server bağımlılıkları
├── tsconfig.json             # TypeScript ayarları (ES2020, strict)
├── .env.example              # Ortam değişkenleri şablonu
├── .gitignore                # node_modules, dist, .next, .env
├── README.md                 # Türkçe proje dokümantasyonu
├── config/
│   └── claude_desktop_config.json  # Claude Desktop MCP kayıt dosyası
│
├── src/                      # === MCP SERVER ===
│   ├── index.ts              # Giriş noktası — tool modüllerini yükler, server başlatır
│   ├── server.ts             # MCP server, tool registry, Zod→JSON Schema dönüştürücü
│   ├── config.ts             # Ortam değişkenleri, NaN-safe envNum(), mod kontrolü
│   ├── api/
│   │   ├── gamma.ts          # GammaClient — pazar keşif API (markets, events, trending)
│   │   ├── clob.ts           # ClobClient — orderbook, spread, fiyat, likidite, tarihçe
│   │   └── data.ts           # DataClient — pozisyonlar, aktivite, portföy (full mode)
│   ├── tools/
│   │   ├── marketDiscovery.ts      # 8 araç: search, trending, category, closing_soon, event, featured, sports, crypto
│   │   ├── realTimeIntelligence.ts # 10 araç: orderbook, spread, price, history, volume, liquidity, holders, details, compare, composition
│   │   ├── marketAnalysis.ts       # 1 araç: analyze_market_opportunity (BUY/SELL/HOLD + skor)
│   │   └── websocketTools.ts       # 7 araç: subscribe prices/orderbook/trades/resolution, alerts, unsubscribe, ws_status
│   ├── websocket/
│   │   └── wsManager.ts      # WebSocket singleton — reconnect, cleanup, subscription yönetimi
│   └── utils/
│       └── toolHelper.ts     # ToolDefinition tipi, formatResult, formatError, formatOdds, formatUsd, timeUntil
│
├── dashboard/                # === NEXT.JS DASHBOARD ===
│   ├── package.json          # Next.js 14, React 18, Recharts, Tailwind CSS
│   ├── next.config.js        # Next.js yapılandırması (varsayılan)
│   ├── tsconfig.json         # TypeScript (Next.js preset, strict)
│   ├── tailwind.config.js    # Özel renkler: poly-green, poly-red, poly-blue, poly-dark, poly-card, poly-border
│   ├── postcss.config.js     # Tailwind + autoprefixer
│   ├── ecosystem.config.js   # PM2 yapılandırması (port 8004, /opt/polymarket/dashboard)
│   ├── start.sh              # Üretim başlatma scripti (nohup + PID kayıt)
│   ├── stop.sh               # Durdurma scripti
│   │
│   ├── app/
│   │   ├── globals.css       # Global stiller: dark tema, .card, .badge-*, .btn-primary
│   │   ├── layout.tsx        # Root layout: metadata, Navbar, ana içerik slotu
│   │   ├── page.tsx          # Ana sayfa: trending pazarlar + kategori filtresi (politics/sports/crypto)
│   │   ├── search/
│   │   │   └── page.tsx      # Arama sayfası: keyword ile pazar ara
│   │   ├── closing/
│   │   │   └── page.tsx      # Kapanacaklar: N saat içinde kapanan pazarlar
│   │   ├── compare/
│   │   │   └── page.tsx      # Karşılaştırma: birden fazla pazarı yan yana analiz
│   │   └── market/
│   │       └── [id]/
│   │           └── page.tsx  # Pazar detay: grafik, orderbook, spread, analiz badge
│   │
│   ├── components/
│   │   ├── Navbar.tsx        # Navigasyon: Dashboard, Ara, Kapanacaklar, Karşılaştır
│   │   ├── MarketCard.tsx    # Pazar kartı: soru, fiyat, hacim, likidite, süre
│   │   ├── PriceChart.tsx    # Fiyat grafiği: 7 gün OHLC (Recharts LineChart)
│   │   ├── OrderbookVisual.tsx # Orderbook: bid/ask derinlik çubukları (8 seviye)
│   │   └── AnalysisBadge.tsx # Analiz rozeti: BUY/SELL/HOLD + güven skoru + sinyaller
│   │
│   └── lib/
│       └── polymarket.ts     # Client-side API: searchMarkets, getTrending, getClosingSoon, getOrderbook, getSpread, getPriceHistory + yardımcı fonksiyonlar
```

---

## Bileşen Detayları

### MCP Server (src/)

| Dosya | İşlev | Araç Sayısı |
|-------|--------|-------------|
| `server.ts` | Tool registry, Zod→JSON Schema, MCP bağlantısı | - |
| `config.ts` | Ortam değişkenleri, güvenlik limitleri | - |
| `api/gamma.ts` | Pazar metadata API | - |
| `api/clob.ts` | Orderbook, fiyat, tarihçe API | - |
| `api/data.ts` | Pozisyon, aktivite API (full mode) | - |
| `tools/marketDiscovery.ts` | Pazar keşif araçları | 8 |
| `tools/realTimeIntelligence.ts` | Gerçek zamanlı veri araçları | 10 |
| `tools/marketAnalysis.ts` | Fırsat analizi (BUY/SELL/HOLD) | 1 |
| `tools/websocketTools.ts` | WebSocket abonelik araçları | 7 |
| `websocket/wsManager.ts` | WS bağlantı yöneticisi (reconnect, cleanup) | - |
| `utils/toolHelper.ts` | Ortak tipler ve format fonksiyonları | - |

**Toplam: 26 araç** (demo modda 25, full modda 26)

### Dashboard (dashboard/)

| Sayfa | URL | İşlev |
|-------|-----|--------|
| Ana Sayfa | `/` | Trending pazarlar + kategori filtresi |
| Arama | `/search` | Keyword ile pazar arama |
| Kapanacaklar | `/closing` | N saat içinde kapanan pazarlar |
| Karşılaştırma | `/compare` | Birden fazla pazarı yan yana analiz |
| Pazar Detay | `/market/[id]` | Grafik, orderbook, spread, analiz badge |

**Teknoloji:** Next.js 14, React 18, Tailwind CSS (dark tema), Recharts  
**API:** Client-side fetch — doğrudan Polymarket API'lerine (proxy gerekmez)  
**Port:** 8004 (0.0.0.0 binding)

---

## API Katmanları

| API | Base URL | Kullanım |
|-----|----------|----------|
| Gamma | `https://gamma-api.polymarket.com` | Pazar listeleme, arama, filtreleme, metadata |
| CLOB | `https://clob.polymarket.com` | Orderbook, spread, fiyat, tarihçe, likidite |
| Data | `https://data-api.polymarket.com` | Pozisyonlar, aktivite, portföy (full mode) |

---

## Yapılan İşler (Özet)

### Faz 1-2-3: MCP Server
- [x] 3 API client (Gamma, CLOB, Data)
- [x] 25+ araç tanımı ve handler'ları
- [x] WebSocket manager (reconnect, cleanup, per-subscriber error handling)
- [x] Zod schema → JSON Schema dönüştürücü
- [x] Demo/Full mod desteği
- [x] Güvenlik limitleri (max trade, spread tolerance, confirmation threshold)

### Hibrit Dashboard
- [x] Next.js 14 + Tailwind dark tema
- [x] 5 sayfa (ana, arama, kapanacaklar, karşılaştırma, detay)
- [x] 5 bileşen (Navbar, MarketCard, PriceChart, OrderbookVisual, AnalysisBadge)
- [x] Client-side API (proxy bypass — doğrudan Polymarket'e fetch)
- [x] Recharts ile fiyat grafiği
- [x] Orderbook derinlik görselleştirme

### Kod Review & Düzeltmeler (38 sorun)
- [x] WebSocket memory leak — reconnect'te listener temizleme
- [x] Division by zero — safeNum() helper
- [x] ZodDefault crash — typeof kontrol
- [x] Silent error swallowing — warning flag'leri
- [x] Config NaN — envNum() ile validasyon
- [x] Zod schema eksikleri — ZodArray items, ZodDefault required fix
- [x] Trend scoring — absolute → percentage-based
- [x] Dashboard duplicate fonksiyonlar — lib'e konsolide
- [x] Build type error — eksik interface field
- [x] Dynamic import → static import

### Deploy Hazırlığı
- [x] ecosystem.config.js (PM2, port 8004)
- [x] start.sh / stop.sh scriptleri
- [x] Path'ler VPS dizinine güncellendi (/opt/polymarket/dashboard)
- [x] Git push (branch: claude/polymarket-mcp-integration-F3JjW)

---

## Geliştirilmesi Gerekenler

### Yüksek Öncelik
1. **VPS Deploy** — Dashboard henüz VPS'te çalışmıyor, deploy edilmeli
2. **Favoriler/Watchlist** — Kullanıcının takip ettiği pazarları kaydetme (localStorage)
3. **Otomatik Yenileme** — Sayfalarda auto-refresh (30s interval)
4. **Hata Sayfaları** — 404 ve genel hata sayfaları eksik

### Orta Öncelik
5. **Mobil Responsive** — Tailwind breakpoint'leri eklenmeli (sm/md/lg)
6. **Loading Skeleton** — Veri yüklenirken iskelet animasyon
7. **Pazar Sıralaması** — Hacim, likidite, spread'e göre sıralama seçenekleri
8. **Bildirimler** — WebSocket ile fiyat değişim bildirimleri (toast)
9. **Türkçe/İngilizce** — Dil desteği (i18n)

### Düşük Öncelik
10. **Tema Değiştirme** — Light/dark mod toggle
11. **PWA Desteği** — Mobilde uygulama gibi çalışma
12. **Export** — Pazar verilerini CSV/JSON olarak indirme
13. **MCP Server VPS Deploy** — Claude Desktop yerine VPS üzerinde MCP
14. **WebSocket Dashboard** — Canlı fiyat akışı dashboard'da gösterme

---

## Ortam Değişkenleri

```env
# .env dosyası (opsiyonel — varsayılanlar mevcut)
POLYMARKET_MODE=demo              # demo | full
GAMMA_API_URL=https://gamma-api.polymarket.com
CLOB_API_URL=https://clob.polymarket.com
DATA_API_URL=https://data-api.polymarket.com

# Full mode için (opsiyonel)
POLYMARKET_API_KEY=
POLYMARKET_SECRET=
WALLET_ADDRESS=

# Güvenlik limitleri
CONFIRMATION_ABOVE_USD=100
MAX_SPREAD_TOLERANCE=0.05
MAX_SINGLE_TRADE_USD=500

# WebSocket
WS_RECONNECT_DELAY_MS=3000
WS_MAX_RECONNECT_ATTEMPTS=5
```

---

## Bağımlılıklar

### MCP Server (root package.json)
- `@modelcontextprotocol/sdk` ^1.0.0
- `axios` ^1.6.0
- `ws` ^8.16.0
- `dotenv` ^16.4.0
- `zod` ^3.22.0
- `typescript` ^5.3.0 (dev)

### Dashboard (dashboard/package.json)
- `next` ^14.2.0
- `react` ^18.3.0
- `react-dom` ^18.3.0
- `recharts` ^2.12.0
- `tailwindcss` ^3.4.0 (dev)
- `typescript` (dev)

**Node.js:** >= 18.0.0

---

## Git Geçmişi

```
31d3540 chore: VPS deploy path'lerini güncelle (/opt/polymarket/dashboard)
a986824 chore: .next build artifacts'ı gitignore'a ekle
8930c8d refactor: Client-side API migrasyonu + VPS deployment (port 8004)
cba9f83 fix: Kapsamlı kod review - 38 sorun düzeltildi
611da6f feat: Next.js dashboard - Polymarket görsel arayüz (hibrit mod)
cb0d4b6 feat: Polymarket MCP Server - Faz 1-2-3 implementasyonu
```
