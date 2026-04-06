import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export interface Position {
  id: string;
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  outcome: string;
  endDate: string;
  icon: string;
  eventSlug: string;
  oppositeOutcome: string;
  oppositeAsset: string;
}

export interface Activity {
  id: string;
  type: 'TRADE' | 'REDEEM' | 'SPLIT' | 'MERGE';
  proxyWallet: string;
  conditionId: string;
  asset: string;
  side: 'BUY' | 'SELL';
  size: number;
  usdcSize: number;
  price: number;
  timestamp: string;
  title: string;
  outcome: string;
  icon: string;
  eventSlug: string;
  orderType: 'LIMIT' | 'MARKET' | 'FOK';
  transactionHash: string;
}

export interface PortfolioValue {
  totalValue: number;
  openPositionsValue: number;
  cashAvailable: number;
  totalPnl: number;
  totalPnlPct: number;
  positionsCount: number;
}

export interface MarketHolder {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
}

export class DataClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.api.data,
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getPositions(walletAddress: string, params: {
    sizeThreshold?: number;
    limit?: number;
    offset?: number;
    conditionIds?: string[];
  } = {}): Promise<Position[]> {
    const { data } = await this.http.get('/positions', {
      params: {
        user: walletAddress,
        size_threshold: params.sizeThreshold ?? 0,
        limit:  params.limit  ?? 100,
        offset: params.offset ?? 0,
        ...(params.conditionIds ? { condition_ids: params.conditionIds.join(',') } : {}),
      },
    });
    return Array.isArray(data) ? data : data.data ?? [];
  }

  async getActivity(walletAddress: string, params: {
    limit?: number;
    offset?: number;
    conditionId?: string;
    before?: string;
    after?: string;
  } = {}): Promise<Activity[]> {
    const { data } = await this.http.get('/activity', {
      params: {
        user:   walletAddress,
        limit:  params.limit  ?? 50,
        offset: params.offset ?? 0,
        ...(params.conditionId ? { condition_id: params.conditionId } : {}),
        ...(params.before      ? { before: params.before }            : {}),
        ...(params.after       ? { after:  params.after }             : {}),
      },
    });
    return Array.isArray(data) ? data : data.data ?? [];
  }

  async getMarketHolders(conditionId: string, limit = 20): Promise<MarketHolder[]> {
    const { data } = await this.http.get('/positions', {
      params: { condition_id: conditionId, limit, size_threshold: 0 },
    });
    const raw: MarketHolder[] = Array.isArray(data) ? data : data.data ?? [];
    return raw.sort((a, b) => b.currentValue - a.currentValue).slice(0, limit);
  }

  /** Tüm pozisyonlardan portföy özeti hesapla */
  async getPortfolioValue(walletAddress: string): Promise<PortfolioValue> {
    const positions = await this.getPositions(walletAddress);
    const openPositions = positions.filter(p => p.size > 0 && !p.redeemable);

    const totalPnl = positions.reduce((s, p) => s + p.cashPnl, 0);
    const openPositionsValue = openPositions.reduce((s, p) => s + p.currentValue, 0);
    const initialValue = positions.reduce((s, p) => s + p.initialValue, 0);

    return {
      totalValue:          openPositionsValue,
      openPositionsValue,
      cashAvailable:       0, // on-chain; gerçek değer cüzdan sorgusu gerektirir
      totalPnl,
      totalPnlPct:         initialValue > 0 ? (totalPnl / initialValue) * 100 : 0,
      positionsCount:      openPositions.length,
    };
  }
}
