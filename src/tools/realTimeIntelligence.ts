import { z } from 'zod';
import { ClobClient } from '../api/clob';
import { GammaClient } from '../api/gamma';
import { DataClient } from '../api/data';
import { registerTool } from '../server';
import { formatOdds, formatUsd, tsToIso } from '../utils/toolHelper';

const clob  = new ClobClient();
const gamma = new GammaClient();
const data  = new DataClient();

/** NaN-safe sayı dönüşümü */
function safeNum(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

// ─── 1. get_orderbook ────────────────────────────────────────────────────────
registerTool({
  name: 'get_orderbook',
  description: 'Bir token için tam orderbook derinliğini getir. Bid/ask duvarlarını görmek için kullan.',
  inputSchema: z.object({
    token_id: z.string().describe('CLOB token ID\'si (clobTokenIds içinden)'),
    depth:    z.number().optional().default(10).describe('Her taraftan kaç seviye gösterilsin'),
  }),
  async handler({ token_id, depth }: { token_id: string; depth: number }) {
    const book = await clob.getOrderbook(token_id);
    return {
      asset_id:  book.asset_id,
      timestamp: new Date(book.timestamp).toISOString(),
      bids:      book.bids.slice(0, depth).map(l => ({ price: formatOdds(safeNum(l.price)), size: safeNum(l.size).toFixed(2), raw_price: safeNum(l.price) })),
      asks:      book.asks.slice(0, depth).map(l => ({ price: formatOdds(safeNum(l.price)), size: safeNum(l.size).toFixed(2), raw_price: safeNum(l.price) })),
      summary: {
        bestBid: book.bids[0] ? formatOdds(Number(book.bids[0].price)) : 'N/A',
        bestAsk: book.asks[0] ? formatOdds(Number(book.asks[0].price)) : 'N/A',
        bidLevels: book.bids.length,
        askLevels: book.asks.length,
      },
    };
  },
});

// ─── 2. get_spread ───────────────────────────────────────────────────────────
registerTool({
  name: 'get_spread',
  description: 'Bir token\'ın bid-ask spread\'ini USD ve yüzde olarak getir. Likidite kalitesini ölçmek için kullan.',
  inputSchema: z.object({
    token_id: z.string().describe('CLOB token ID\'si'),
  }),
  async handler({ token_id }: { token_id: string }) {
    const s = await clob.getSpread(token_id);
    return {
      asset_id:    token_id,
      bid:         formatOdds(s.bid),
      ask:         formatOdds(s.ask),
      midpoint:    formatOdds(s.midpoint),
      spread:      s.spread.toFixed(4),
      spreadPct:   `${(s.spreadPct * 100).toFixed(2)}%`,
      assessment:  s.spreadPct < 0.02 ? 'Dar spread (iyi likidite)'
                 : s.spreadPct < 0.05 ? 'Orta spread'
                 : 'Geniş spread (düşük likidite)',
    };
  },
});

// ─── 3. get_current_price ────────────────────────────────────────────────────
registerTool({
  name: 'get_current_price',
  description: 'Token için anlık bid, ask ve midpoint fiyatını getir.',
  inputSchema: z.object({
    token_id: z.string().describe('CLOB token ID\'si'),
  }),
  async handler({ token_id }: { token_id: string }) {
    const [buyPrice, sellPrice] = await Promise.all([
      clob.getPrice(token_id, 'BUY'),
      clob.getPrice(token_id, 'SELL'),
    ]);
    const ask = Number(buyPrice.price);
    const bid = Number(sellPrice.price);
    const mid = (bid + ask) / 2;
    return {
      asset_id:  token_id,
      bid:       formatOdds(bid),
      ask:       formatOdds(ask),
      midpoint:  formatOdds(mid),
      bid_raw:   bid,
      ask_raw:   ask,
      mid_raw:   mid,
      timestamp: new Date().toISOString(),
    };
  },
});

// ─── 4. get_price_history ────────────────────────────────────────────────────
registerTool({
  name: 'get_price_history',
  description: 'Token için OHLC fiyat geçmişini getir. Trend analizi için kullan.',
  inputSchema: z.object({
    token_id:  z.string().describe('CLOB token ID\'si'),
    days:      z.number().optional().default(7).describe('Kaç günlük veri (1, 7, 30)'),
    fidelity:  z.number().optional().default(60).describe('Veri çözünürlüğü dakika (60, 1440)'),
  }),
  async handler({ token_id, days, fidelity }: { token_id: string; days: number; fidelity: number }) {
    const endTs   = Math.floor(Date.now() / 1000);
    const startTs = endTs - days * 86_400;
    const history = await clob.getPriceHistory(token_id, startTs, endTs, fidelity);

    if (history.length === 0) return { token_id, message: 'Geçmiş veri bulunamadı.' };

    const prices = history.map(p => Number(p.p));
    const first  = prices[0];
    const last   = prices[prices.length - 1];
    const high   = Math.max(...prices);
    const low    = Math.min(...prices);

    return {
      token_id,
      period:    `${days} gün`,
      dataPoints: history.length,
      current:   formatOdds(last),
      open:      formatOdds(first),
      high:      formatOdds(high),
      low:       formatOdds(low),
      change:    `${((last - first) * 100).toFixed(1)}pp`,
      trend:     last > first ? 'YUKARI' : last < first ? 'AŞAĞI' : 'YATAY',
      history:   history.map(p => ({ time: tsToIso(p.t), price: formatOdds(Number(p.p)), raw: Number(p.p) })),
    };
  },
});

// ─── 5. get_market_volume ────────────────────────────────────────────────────
registerTool({
  name: 'get_market_volume',
  description: 'Market\'in 24s, 7g, 30g hacim istatistiklerini getir. Ani artışlar bilgi kaçağı işareti olabilir.',
  inputSchema: z.object({
    market_id: z.string().describe('Gamma market ID\'si'),
  }),
  async handler({ market_id }: { market_id: string }) {
    const market = await gamma.getMarket(market_id);
    return {
      market_id,
      question:    market.question,
      volume24h:   formatUsd(market.volume24hr ?? 0),
      volumeTotal: formatUsd(market.volumeNum  ?? market.volume ?? 0),
      volumeClob:  formatUsd(market.volumeClob ?? 0),
      volume24hClob: formatUsd(market.volume24hrClob ?? 0),
      liquidity:   formatUsd(market.liquidityNum ?? market.liquidity ?? 0),
      assessment:  (market.volume24hr ?? 0) > 100_000 ? 'Yüksek hacim'
                 : (market.volume24hr ?? 0) > 10_000  ? 'Orta hacim'
                 : 'Düşük hacim',
    };
  },
});

// ─── 6. get_liquidity ────────────────────────────────────────────────────────
registerTool({
  name: 'get_liquidity',
  description: 'Bir token\'ın orderbook\'taki toplam USD likiditesini hesapla.',
  inputSchema: z.object({
    token_id: z.string().describe('CLOB token ID\'si'),
  }),
  async handler({ token_id }: { token_id: string }) {
    const liq = await clob.getLiquidity(token_id);
    return {
      asset_id:       token_id,
      bid_liquidity:  formatUsd(liq.bid_liquidity),
      ask_liquidity:  formatUsd(liq.ask_liquidity),
      total_liquidity: formatUsd(liq.total_liquidity),
      assessment:     liq.total_liquidity > 50_000  ? 'Yüksek likidite (güvenli işlem)'
                    : liq.total_liquidity > 10_000  ? 'Orta likidite'
                    : 'Düşük likidite (kayma riski)',
    };
  },
});

// ─── 7. get_market_holders ───────────────────────────────────────────────────
registerTool({
  name: 'get_market_holders',
  description: 'Bir market\'teki en büyük pozisyon sahiplerini (whales) getir.',
  inputSchema: z.object({
    condition_id: z.string().describe('Market condition ID\'si'),
    limit:        z.number().optional().default(10),
  }),
  async handler({ condition_id, limit }: { condition_id: string; limit: number }) {
    const holders = await data.getMarketHolders(condition_id, limit);
    return {
      condition_id,
      count: holders.length,
      holders: holders.map((h, i) => ({
        rank:         i + 1,
        wallet:       h.proxyWallet,
        size:         h.size.toFixed(2),
        avgPrice:     formatOdds(h.avgPrice),
        currentValue: formatUsd(h.currentValue),
        pnl:          formatUsd(h.cashPnl),
        pnlPct:       `${h.percentPnl?.toFixed(1) ?? '0'}%`,
      })),
    };
  },
});

// ─── 8. get_market_details ───────────────────────────────────────────────────
registerTool({
  name: 'get_market_details',
  description: 'Bir market hakkında CLOB\'dan tam detay getir: token IDler, ödüller, minimum emir büyüklüğü.',
  inputSchema: z.object({
    condition_id: z.string().describe('Market condition ID\'si'),
  }),
  async handler({ condition_id }: { condition_id: string }) {
    const market = await clob.getMarket(condition_id);
    return {
      condition_id:   market.condition_id,
      question:       market.question,
      category:       market.category,
      endDate:        market.end_date_iso,
      active:         market.active,
      closed:         market.closed,
      acceptingOrders: market.accepting_orders,
      minimumOrderSize: market.minimum_order_size,
      minimumTickSize:  market.minimum_tick_size,
      negRisk:         market.neg_risk,
      tokens:          market.tokens.map(t => ({
        token_id: t.token_id,
        outcome:  t.outcome,
        price:    formatOdds(t.price),
        raw:      t.price,
        winner:   t.winner,
      })),
    };
  },
});
