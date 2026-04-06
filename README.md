# Polymarket MCP Server

Claude için Polymarket entegrasyonu. 3 API katmanı (Gamma, CLOB, Data), 25 araç, gerçek zamanlı WebSocket akışı.

## Araçlar (25 toplam)

### Faz 1 & 2: Market Discovery (8) + Real-Time Intelligence (10)
| Araç | Açıklama |
|------|----------|
| `search_markets` | Anahtar kelimeyle market ara |
| `get_trending_markets` | 24h/7d/30d hacme göre trendler |
| `filter_markets_by_category` | Kategoriye göre filtrele (politics, sports, crypto) |
| `get_closing_soon_markets` | N saat içinde kapanacak marketler |
| `get_event_markets` | Bir event altındaki tüm marketler |
| `get_featured_markets` | Öne çıkan marketler |
| `get_sports_markets` | Spor marketleri |
| `get_crypto_markets` | Kripto marketleri |
| `get_orderbook` | Tam orderbook derinliği |
| `get_spread` | Bid-ask spread analizi |
| `get_current_price` | Anlık bid/ask/midpoint |
| `get_price_history` | OHLC geçmiş veri |
| `get_market_volume` | Hacim istatistikleri |
| `get_liquidity` | USD likidite analizi |
| `get_market_holders` | En büyük pozisyon sahipleri |
| `get_market_details` | CLOB market detayları |
| `analyze_market_opportunity` | **BUY/SELL/HOLD kararı + güven skoru** |
| `compare_markets` | Çapraz market karşılaştırma |

### Faz 3: WebSocket & Monitoring (7)
| Araç | Açıklama |
|------|----------|
| `subscribe_market_prices` | Canlı fiyat akışı |
| `subscribe_orderbook_updates` | Orderbook değişimleri |
| `subscribe_user_trades` | Emir doldurma bildirimleri (Full Mode) |
| `subscribe_market_resolution` | Market kapanış bildirimleri |
| `get_alerts` | Biriken alertleri listele |
| `unsubscribe` | Aboneliği iptal et |
| `ws_status` | WebSocket bağlantı durumu |

## Kurulum

```bash
git clone <repo>
cd polymarket-mcp-server
npm install
npm run build
```

## Yapılandırma

1. `.env.example` → `.env` kopyala
2. `POLYMARKET_MODE=demo` ile başla (wallet gerekmez)
3. `config/claude_desktop_config.json` içindeki path'i güncelle
4. Claude Desktop config'ine ekle

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux:** `~/.config/Claude/claude_desktop_config.json`

5. Claude Desktop'ı yeniden başlat

## Test

Claude'da dene:
- `"Fed faiz kararı marketlerini bul"` → `search_markets`
- `"Şu an en trend 10 marketi göster"` → `get_trending_markets`
- `"Bu market için BUY mi SELL mi?"` → `analyze_market_opportunity`
- `"Bitcoin ve Ethereum marketlerini karşılaştır"` → `compare_markets`

## Mimari

```
Claude Desktop
      ↕ MCP Protocol (stdio)
polymarket-mcp-server (Node.js)
      ↕ HTTPS            ↕ WebSocket
Gamma API  CLOB API  Data API  WS Feed
```

## Uyarı

Bu araç eğitim ve araştırma amaçlıdır. Polymarket kullanıcılarının %92.4'ü para kaybeder.
Demo Mode ile başlayın. Gerçek para kullanmadan önce riskleri anlayın.
