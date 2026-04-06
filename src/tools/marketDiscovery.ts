import { z } from 'zod';
import { GammaClient } from '../api/gamma';
import { registerTool } from '../server';
import { formatOdds, formatUsd, timeUntil } from '../utils/toolHelper';

const gamma = new GammaClient();

/** Market sonucunu okunabilir özet objesi */
function summarizeMarket(m: Awaited<ReturnType<GammaClient['getMarkets']>>[0]) {
  const prices = m.outcomePrices?.map(Number) ?? [];
  const outcomes = m.outcomes ?? [];
  return {
    id:             m.id,
    question:       m.question,
    endDate:        m.endDate,
    closingIn:      timeUntil(m.endDate),
    volume24h:      formatUsd(m.volume24hr ?? 0),
    volumeTotal:    formatUsd(m.volumeNum  ?? m.volume ?? 0),
    liquidity:      formatUsd(m.liquidityNum ?? m.liquidity ?? 0),
    outcomes:       outcomes.map((o, i) => ({
      outcome: o,
      price:   formatOdds(prices[i] ?? 0),
      raw:     prices[i] ?? 0,
    })),
    tokenIds:       m.clobTokenIds ?? [],
    conditionId:    m.conditionId,
    active:         m.active,
    featured:       m.featured,
  };
}

// ─── 1. search_markets ───────────────────────────────────────────────────────
registerTool({
  name: 'search_markets',
  description: 'Polymarket\'te anahtar kelimeyle market ara. Örnek: "Fed faiz kararı", "Bitcoin ETF"',
  inputSchema: z.object({
    query: z.string().describe('Arama terimi'),
    limit: z.number().optional().default(10).describe('Sonuç sayısı (maks 50)'),
  }),
  async handler({ query, limit }: { query: string; limit: number }) {
    const markets = await gamma.searchMarkets(query, limit);
    return {
      query,
      count: markets.length,
      markets: markets.map(summarizeMarket),
    };
  },
});

// ─── 2. get_trending_markets ─────────────────────────────────────────────────
registerTool({
  name: 'get_trending_markets',
  description: 'Hacme göre trend marketleri getir. Dönem: 24h, 7d veya 30d.',
  inputSchema: z.object({
    period: z.enum(['24h', '7d', '30d']).optional().default('24h'),
    limit:  z.number().optional().default(10),
  }),
  async handler({ period, limit }: { period: '24h' | '7d' | '30d'; limit: number }) {
    const markets = await gamma.getTrendingMarkets(period, limit);
    return {
      period,
      count: markets.length,
      markets: markets.map(summarizeMarket),
    };
  },
});

// ─── 3. filter_markets_by_category ──────────────────────────────────────────
registerTool({
  name: 'filter_markets_by_category',
  description: 'Kategoriye göre market filtrele. Örnek kategori slug\'ları: politics, sports, crypto, culture, economics',
  inputSchema: z.object({
    category: z.string().describe('Kategori slug\'ı (ör: politics, sports, crypto)'),
    limit:    z.number().optional().default(10),
  }),
  async handler({ category, limit }: { category: string; limit: number }) {
    const markets = await gamma.getMarketsByCategory(category, limit);
    return {
      category,
      count: markets.length,
      markets: markets.map(summarizeMarket),
    };
  },
});

// ─── 4. get_closing_soon_markets ─────────────────────────────────────────────
registerTool({
  name: 'get_closing_soon_markets',
  description: 'Belirtilen saat içinde kapanacak marketleri getir. Son dakika odds hareketlerini yakalamak için kullan.',
  inputSchema: z.object({
    hours: z.number().optional().default(24).describe('Kaç saat içinde kapanacak (varsayılan: 24)'),
    limit: z.number().optional().default(10),
  }),
  async handler({ hours, limit }: { hours: number; limit: number }) {
    const markets = await gamma.getClosingSoonMarkets(hours, limit);
    return {
      closingWithinHours: hours,
      count: markets.length,
      markets: markets.map(summarizeMarket),
    };
  },
});

// ─── 5. get_event_markets ────────────────────────────────────────────────────
registerTool({
  name: 'get_event_markets',
  description: 'Bir event ID\'ye bağlı tüm sub-marketleri getir. Örn: FIFA Dünya Kupası altındaki tüm ülke marketleri.',
  inputSchema: z.object({
    event_id: z.string().describe('Polymarket event ID\'si'),
  }),
  async handler({ event_id }: { event_id: string }) {
    const event = await gamma.getEvent(event_id);
    return {
      event: {
        id:       event.id,
        title:    event.title,
        category: event.category,
        endDate:  event.endDate,
        volume:   formatUsd(event.volume ?? 0),
        liquidity: formatUsd(event.liquidity ?? 0),
      },
      marketCount: event.markets?.length ?? 0,
      markets:     (event.markets ?? []).map(summarizeMarket),
    };
  },
});

// ─── 6. get_featured_markets ─────────────────────────────────────────────────
registerTool({
  name: 'get_featured_markets',
  description: 'Polymarket\'in öne çıkardığı featured marketleri getir.',
  inputSchema: z.object({
    limit: z.number().optional().default(10),
  }),
  async handler({ limit }: { limit: number }) {
    const markets = await gamma.getFeaturedMarkets(limit);
    return { count: markets.length, markets: markets.map(summarizeMarket) };
  },
});

// ─── 7. get_sports_markets ───────────────────────────────────────────────────
registerTool({
  name: 'get_sports_markets',
  description: 'Spor kategorisindeki aktif marketleri getir.',
  inputSchema: z.object({
    limit: z.number().optional().default(10),
  }),
  async handler({ limit }: { limit: number }) {
    const markets = await gamma.getMarketsByCategory('sports', limit);
    return { count: markets.length, markets: markets.map(summarizeMarket) };
  },
});

// ─── 8. get_crypto_markets ───────────────────────────────────────────────────
registerTool({
  name: 'get_crypto_markets',
  description: 'Kripto kategorisindeki aktif marketleri getir (BTC fiyat, ETH, altcoin vb).',
  inputSchema: z.object({
    limit: z.number().optional().default(10),
  }),
  async handler({ limit }: { limit: number }) {
    const markets = await gamma.getMarketsByCategory('crypto', limit);
    return { count: markets.length, markets: markets.map(summarizeMarket) };
  },
});
