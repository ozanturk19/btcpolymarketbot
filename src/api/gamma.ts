import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  resolutionSource: string;
  endDate: string;
  liquidity: number;
  startDate: string;
  image: string;
  icon: string;
  description: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: number;
  volume24hr: number;
  active: boolean;
  closed: boolean;
  archived: boolean;
  new: boolean;
  featured: boolean;
  restricted: boolean;
  groupItemTitle: string;
  groupItemThreshold: string;
  questionID: string;
  enableOrderBook: boolean;
  orderPriceMinTickSize: number;
  orderMinSize: number;
  volumeNum: number;
  liquidityNum: number;
  clobTokenIds: string[];
  umaBond: string;
  umaReward: string;
  volume24hrClob: number;
  volumeClob: number;
  liquidityClob: number;
  acceptingOrders: boolean;
  negRisk: boolean;
  negRiskMarketID: string;
  negRiskRequestID: string;
}

export interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  startDate: string;
  endDate: string;
  image: string;
  icon: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  new: boolean;
  featured: boolean;
  restricted: boolean;
  liquidity: number;
  volume: number;
  volume24hr: number;
  markets: GammaMarket[];
  tags: Array<{ id: string; label: string; slug: string }>;
  category: string;
}

export interface GammaMarketsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  new?: boolean;
  featured?: boolean;
  tag?: string;
  tag_slug?: string;
  category?: string;
  search?: string;
  order?: string;
  ascending?: boolean;
  end_date_min?: string;
  end_date_max?: string;
  liquidity_min?: number;
  volume_min?: number;
}

export class GammaClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.api.gamma,
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getMarkets(params: GammaMarketsParams = {}): Promise<GammaMarket[]> {
    const { data } = await this.http.get('/markets', { params });
    return Array.isArray(data) ? data : data.data ?? [];
  }

  async getMarket(id: string): Promise<GammaMarket> {
    const { data } = await this.http.get(`/markets/${id}`);
    return data;
  }

  async getEvents(params: {
    limit?: number;
    offset?: number;
    active?: boolean;
    closed?: boolean;
    tag?: string;
    tag_slug?: string;
    category?: string;
    featured?: boolean;
    order?: string;
    ascending?: boolean;
  } = {}): Promise<GammaEvent[]> {
    const { data } = await this.http.get('/events', { params });
    return Array.isArray(data) ? data : data.data ?? [];
  }

  async getEvent(id: string): Promise<GammaEvent> {
    const { data } = await this.http.get(`/events/${id}`);
    return data;
  }

  async getTags(): Promise<Array<{ id: string; label: string; slug: string }>> {
    const { data } = await this.http.get('/tags');
    return Array.isArray(data) ? data : data.data ?? [];
  }

  async searchMarkets(query: string, limit = 20): Promise<GammaMarket[]> {
    return this.getMarkets({ search: query, limit, active: true });
  }

  async getTrendingMarkets(period: '24h' | '7d' | '30d' = '24h', limit = 20): Promise<GammaMarket[]> {
    const orderMap = { '24h': 'volume24hr', '7d': 'volume', '30d': 'volume' } as const;
    return this.getMarkets({
      order: orderMap[period],
      ascending: false,
      active: true,
      limit,
    });
  }

  async getClosingSoonMarkets(hoursFromNow = 24, limit = 20): Promise<GammaMarket[]> {
    const now = new Date();
    const future = new Date(now.getTime() + hoursFromNow * 3_600_000);
    return this.getMarkets({
      end_date_min: now.toISOString(),
      end_date_max: future.toISOString(),
      active: true,
      order: 'end_date',
      ascending: true,
      limit,
    });
  }

  async getMarketsByCategory(category: string, limit = 20): Promise<GammaMarket[]> {
    return this.getMarkets({ tag_slug: category, active: true, limit });
  }

  async getFeaturedMarkets(limit = 20): Promise<GammaMarket[]> {
    return this.getMarkets({ featured: true, active: true, limit });
  }
}
