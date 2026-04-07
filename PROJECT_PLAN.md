# Polymarket MCP Integration — Proje Planı

## Dizin Yapısı

```
/tmp/claude-poly/
├── src/                        # MCP Server (Node.js/TypeScript)
│   ├── index.ts                # MCP server entry point
│   ├── server.ts               # Server başlatma ve yapılandırma
│   ├── config.ts               # Ortam değişkenleri ve sabitler
│   ├── api/
│   │   ├── gamma.ts            # Gamma API (piyasa verileri, meta)
│   │   ├── clob.ts             # CLOB API (order book, trades)
│   │   └── data.ts             # Data API (geçmiş fiyatlar)
│   ├── tools/
│   │   ├── marketDiscovery.ts  # Piyasa keşfi araçları
│   │   ├── marketAnalysis.ts   # Teknik analiz araçları
│   │   ├── realTimeIntelligence.ts  # Gerçek zamanlı zeka
│   │   └── websocketTools.ts   # WebSocket araçları
│   ├── utils/
│   │   └── toolHelper.ts       # Yardımcı fonksiyonlar
│   └── websocket/
│       └── wsManager.ts        # WebSocket bağlantı yöneticisi
├── dashboard/                  # Next.js Dashboard (React/TypeScript)
│   ├── app/
│   │   ├── layout.tsx          # Ana layout (Navbar dahil)
│   │   ├── page.tsx            # Ana sayfa (trending piyasalar)
│   │   ├── search/page.tsx     # Piyasa arama
│   │   ├── compare/page.tsx    # Piyasa karşılaştırma
│   │   ├── closing/page.tsx    # Kapanacak piyasalar
│   │   └── market/[id]/page.tsx # Piyasa detay sayfası
│   ├── components/
│   │   ├── MarketCard.tsx      # Piyasa kartı bileşeni
│   │   ├── PriceChart.tsx      # Fiyat grafiği (Recharts)
│   │   ├── OrderbookVisual.tsx # Order book görselleştirme
│   │   ├── AnalysisBadge.tsx   # Analiz rozeti
│   │   └── Navbar.tsx          # Navigasyon çubuğu
│   ├── lib/
│   │   └── polymarket.ts       # API çağrı katmanı (client-side)
│   ├── ecosystem.config.js     # PM2 yapılandırması
│   ├── start.sh                # Başlatma scripti
│   └── stop.sh                 # Durdurma scripti
├── config/                     # Yapılandırma dosyaları
├── .env.example                # Örnek ortam değişkenleri
├── package.json                # MCP server bağımlılıkları
└── tsconfig.json               # TypeScript yapılandırması
```

## MCP Araçları (25+)

| Araç | Kategori | Açıklama |
|------|----------|----------|
| `search_markets` | Keşif | Anahtar kelimeyle piyasa ara |
| `get_trending_markets` | Keşif | Trending piyasaları getir |
| `get_markets_by_category` | Keşif | Kategoriye göre piyasaları filtrele |
| `get_closing_soon_markets` | Keşif | Yakında kapanacak piyasaları getir |
| `get_market_details` | Analiz | Detaylı piyasa bilgisi |
| `get_market_price_history` | Analiz | Geçmiş fiyat verisi |
| `get_market_orderbook` | Analiz | Order book snapshot |
| `analyze_market_momentum` | Analiz | Momentum analizi |
| `compare_markets` | Analiz | İki piyasayı karşılaştır |
| `get_top_movers` | Analiz | En çok hareket eden piyasalar |
| `get_market_liquidity` | Analiz | Likidite analizi |
| `calculate_expected_value` | Analiz | Beklenen değer hesaplama |
| `subscribe_market_updates` | WebSocket | Piyasa güncellemelerine abone ol |
| `get_real_time_price` | WebSocket | Anlık fiyat al |
| `monitor_price_alerts` | WebSocket | Fiyat alarmı izle |
| `get_live_orderbook` | WebSocket | Canlı order book |
| `unsubscribe_market` | WebSocket | Aboneliği iptal et |
| `get_active_subscriptions` | WebSocket | Aktif abonelikleri listele |
| `get_news_sentiment` | Zeka | Haber sentiment analizi |
| `get_market_correlations` | Zeka | Piyasa korelasyonları |
| `predict_market_movement` | Zeka | Hareket tahmini |
| `get_whale_activity` | Zeka | Büyük oyuncu aktivitesi |
| `get_volume_analysis` | Zeka | Hacim analizi |
| `get_category_trends` | Zeka | Kategori trend analizi |
| `get_arbitrage_opportunities` | Zeka | Arbitraj fırsatları |

## Dashboard Sayfaları

### 1. Ana Sayfa (`/`)
- Trending piyasalar grid görünümü
- Kategori filtresi
- Hacim ve likidite sıralama
- Gerçek zamanlı fiyat güncellemeleri

### 2. Arama (`/search`)
- Full-text piyasa arama
- Kategori, durum, hacim filtreleri
- Sonuç sayfalama

### 3. Karşılaştırma (`/compare`)
- İki piyasayı yan yana karşılaştır
- Fiyat, hacim, likidite metrikleri
- Korelasyon analizi

### 4. Kapanıyor (`/closing`)
- 24/48/72 saat içinde kapanacak piyasalar
- Son fiyat hareketleri
- İşlem hacmi analizi

### 5. Piyasa Detayı (`/market/[id]`)
- Detaylı fiyat grafiği (1H/6H/1D/7D)
- Order book visualizasyonu
- İşlem geçmişi
- Analiz rozetleri

## Dashboard Bileşenleri

### MarketCard
- Piyasa başlığı, kategori rozeti
- Güncel fiyat ve 24s değişim
- Hacim ve likidite göstergesi
- Hover efektli detay linki

### PriceChart
- Recharts tabanlı alan grafiği
- Zaman dilimi seçici (1H/6H/1D/7D)
- Fiyat tooltip'i
- Responsive tasarım

### OrderbookVisual
- Bid/ask bar chart
- Spread göstergesi
- Derinlik görselleştirmesi

### AnalysisBadge
- Momentum rozeti (Yükseliş/Düşüş/Nötr)
- Likidite skoru
- Risk göstergesi

### Navbar
- Logo ve ana navigasyon
- Sayfa aktif durumu
- Mobil uyumlu hamburger menü

## API Katmanları

### Gamma API (`src/api/gamma.ts`)
- Base: `https://gamma-api.polymarket.com`
- Endpoint'ler: `/markets`, `/events`, `/categories`
- Rate limit: 100 req/min

### CLOB API (`src/api/clob.ts`)
- Base: `https://clob.polymarket.com`
- Endpoint'ler: `/order-book`, `/trades`, `/midpoints`
- WebSocket: `wss://ws-subscriptions-clob.polymarket.com`

### Data API (`src/api/data.ts`)
- Base: `https://data-api.polymarket.com`
- Endpoint'ler: `/resolution`, `/prices-history`

## Yapılan 38 Düzeltme Özeti

### API & Veri Katmanı (12 düzeltme)
1. CLOB API endpoint yolları düzeltildi
2. Gamma API response tip dönüşümleri eklendi
3. Rate limiting middleware eklendi
4. Error boundary ile graceful degradation
5. TypeScript strict mode uyumsuzlukları giderildi
6. API timeout handling eklendi
7. Response caching (5 dakika TTL)
8. Null safety kontrolleri eklendi
9. BigInt serializasyon hatası düzeltildi
10. CORS header yapılandırması düzeltildi
11. WebSocket reconnect logic eklendi
12. Price history zaman damgası normalizasyonu

### Dashboard UI (15 düzeltme)
13. Hydration hatası (client/server mismatch) giderildi
14. `use client` direktifleri eksik sayfalara eklendi
15. Recharts SSR uyumsuzluğu giderildi
16. Tailwind dark mode sınıfları düzeltildi
17. MarketCard hover state z-index sorunu
18. Navbar aktif link tespiti düzeltildi
19. PriceChart responsive breakpoint'ler
20. OrderbookVisual NaN değer koruması
21. Loading skeleton placeholder'ları eklendi
22. Error state UI bileşenleri eklendi
23. Search debounce (300ms) eklendi
24. Infinite scroll pagination hatası
25. Market detail 404 fallback sayfası
26. Compare sayfası URL param senkronizasyonu
27. Mobile viewport meta tag eksikliği

### MCP Server (11 düzeltme)
28. Tool input validation şemaları eklendi
29. `calculate_expected_value` formül hatası düzeltildi
30. WebSocket araçları timeout handling
31. `compare_markets` asimetrik veri sorunu
32. Sentiment analizi NLP hata yönetimi
33. Arbitraj hesaplaması precision hatası
34. Tool error mesajları standartlaştırıldı
35. Server startup race condition giderildi
36. MCP protocol version uyumsuzluğu
37. Tool description açıklamaları güncellendi
38. Memory leak WebSocket listener cleanup

## Geliştirilmesi Gerekenler (Öncelik Sırasıyla)

1. **[ P0 ] Gerçek WebSocket entegrasyonu** — Şu an mock data, CLOB WS'e bağlanmalı
2. **[ P0 ] Authentication** — API key yönetimi ve güvenli storage
3. **[ P1 ] Portfolio takibi** — Kullanıcı pozisyonları ve P&L hesabı
4. **[ P1 ] Alert sistemi** — Fiyat alarmı bildirimleri (push/email)
5. **[ P1 ] Favoriler** — localStorage tabanlı favori piyasalar
6. **[ P2 ] Advanced charts** — TradingView entegrasyonu
7. **[ P2 ] Order execution** — CLOB üzerinden alım/satım
8. **[ P2 ] Multi-outcome markets** — Çok seçenekli piyasa desteği
9. **[ P2 ] Export** — CSV/JSON veri dışa aktarımı
10. **[ P3 ] Dark/light tema toggle**
11. **[ P3 ] i18n** — Çok dil desteği (TR/EN)
12. **[ P3 ] PWA** — Offline erişim ve push notifikasyon
13. **[ P3 ] AI commentary** — Claude ile piyasa yorumu
14. **[ P3 ] Social features** — Paylaşım ve embed kodu

## Bağımlılıklar

### MCP Server
```json
{
  "@modelcontextprotocol/sdk": "^1.x",
  "axios": "^1.x",
  "ws": "^8.x",
  "typescript": "^5.x"
}
```

### Dashboard
```json
{
  "next": "14.x",
  "react": "^18.x",
  "tailwindcss": "^3.x",
  "recharts": "^2.x",
  "axios": "^1.x"
}
```

## Ortam Değişkenleri

```env
# MCP Server
PORT=3001
NODE_ENV=production

# Dashboard
NEXT_PUBLIC_MCP_SERVER_URL=http://localhost:3001
NEXT_PUBLIC_GAMMA_API=https://gamma-api.polymarket.com
NEXT_PUBLIC_CLOB_API=https://clob.polymarket.com

# Opsiyonel
POLYMARKET_API_KEY=
CLOB_API_KEY=
```

## Git Commit Geçmişi

| Hash | Mesaj |
|------|-------|
| `a986824` | chore: .next build artifacts'ı gitignore'a ekle |
| `8930c8d` | refactor: Client-side API migrasyonu + VPS deployment (port 8004) |
| `cba9f83` | fix: Kapsamlı kod review - 38 sorun düzeltildi |
| `611da6f` | feat: Next.js dashboard - Polymarket görsel arayüz (hibrit mod) |
| `cb0d4b6` | feat: Polymarket MCP Server - Faz 1-2-3 implementasyonu |
| `102668d` | Initial commit |
