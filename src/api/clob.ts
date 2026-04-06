import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export interface OrderbookLevel {
  price: string;
  size: string;
}

export interface Orderbook {
  market: string;
  asset_id: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  hash: string;
  timestamp: number;
}

export interface MarketPrice {
  market: string;
  asset_id: string;
  price: string;
  side: 'BUY' | 'SELL';
}

export interface PriceHistoryPoint {
  t: number; // unix timestamp
  p: string; // price
}

export interface ClobMarket {
  condition_id: string;
  question_id: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
    winner: boolean;
  }>;
  rewards: {
    rates: Array<{ asset_id: string; rewards_daily_rate: number }>;
    min_size: number;
    max_spread: number;
  };
  minimum_order_size: number;
  minimum_tick_size: number;
  description: string;
  category: string;
  end_date_iso: string;
  game_start_time: string | null;
  question: string;
  market_slug: string;
  min_incentive_size: number;
  max_incentive_spread: number;
  active: boolean;
  closed: boolean;
  seconds_delay: number;
  icon: string;
  fpmm: string;
  accepting_orders: boolean;
  neg_risk: boolean;
  neg_risk_market_id: string;
  neg_risk_request_id: string;
}

export interface SpreadInfo {
  asset_id: string;
  bid:    number;
  ask:    number;
  spread: number;
  spreadPct: number;
  midpoint: number;
}

export interface TradeInfo {
  id: string;
  taker_order_id: string;
  market: string;
  asset_id: string;
  side: 'BUY' | 'SELL';
  size: string;
  fee_rate_bps: string;
  price: string;
  status: string;
  match_time: string;
  last_update: string;
  outcome: string;
  bucket_index: number;
  owner: string;
  maker_address: string;
  transaction_hash: string;
  trader_side: 'TAKER' | 'MAKER';
}

export class ClobClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.api.clob,
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getOrderbook(tokenId: string): Promise<Orderbook> {
    const { data } = await this.http.get('/book', {
      params: { token_id: tokenId },
    });
    return data;
  }

  async getMarket(conditionId: string): Promise<ClobMarket> {
    const { data } = await this.http.get(`/markets/${conditionId}`);
    return data;
  }

  async getMarkets(nextCursor?: string): Promise<{ data: ClobMarket[]; next_cursor: string }> {
    const { data } = await this.http.get('/markets', {
      params: nextCursor ? { next_cursor: nextCursor } : {},
    });
    return data;
  }

  async getPrice(tokenId: string, side: 'BUY' | 'SELL'): Promise<MarketPrice> {
    const { data } = await this.http.get('/price', {
      params: { token_id: tokenId, side },
    });
    return data;
  }

  async getPrices(tokenIds: string[]): Promise<MarketPrice[]> {
    const { data } = await this.http.get('/prices', {
      params: { token_ids: tokenIds.join(',') },
    });
    return Array.isArray(data) ? data : Object.values(data);
  }

  async getPriceHistory(
    tokenId: string,
    startTs?: number,
    endTs?: number,
    fidelity = 60
  ): Promise<PriceHistoryPoint[]> {
    const params: Record<string, string | number> = { market: tokenId, fidelity };
    if (startTs) params.startTs = startTs;
    if (endTs)   params.endTs   = endTs;
    const { data } = await this.http.get('/prices-history', { params });
    return data?.history ?? [];
  }

  /** Bid, ask ve spread hesapla */
  async getSpread(tokenId: string): Promise<SpreadInfo> {
    const book = await this.getOrderbook(tokenId);
    const topBid = book.bids[0] ? Number(book.bids[0].price) : 0;
    const topAsk = book.asks[0] ? Number(book.asks[0].price) : 1;
    const spread    = topAsk - topBid;
    const midpoint  = (topBid + topAsk) / 2;
    const spreadPct = midpoint > 0 ? spread / midpoint : 0;
    return { asset_id: tokenId, bid: topBid, ask: topAsk, spread, spreadPct, midpoint };
  }

  /** Orderbook üzerinden toplam likidityi USD olarak hesapla */
  async getLiquidity(tokenId: string): Promise<{ bid_liquidity: number; ask_liquidity: number; total_liquidity: number }> {
    const book = await this.getOrderbook(tokenId);
    const bidLiq = book.bids.reduce((s, l) => s + Number(l.price) * Number(l.size), 0);
    const askLiq = book.asks.reduce((s, l) => s + Number(l.price) * Number(l.size), 0);
    return { bid_liquidity: bidLiq, ask_liquidity: askLiq, total_liquidity: bidLiq + askLiq };
  }

  async getTrades(params: {
    market?: string;
    maker_address?: string;
    limit?: number;
    before?: string;
    after?: string;
  } = {}): Promise<TradeInfo[]> {
    const { data } = await this.http.get('/trades', { params });
    return Array.isArray(data) ? data : data.data ?? [];
  }
}
