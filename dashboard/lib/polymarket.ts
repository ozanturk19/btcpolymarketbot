import axios from 'axios';

const GAMMA  = 'https://gamma-api.polymarket.com';
const CLOB   = 'https://clob.polymarket.com';

const gamma = axios.create({ baseURL: GAMMA, timeout: 10_000 });
const clob  = axios.create({ baseURL: CLOB,  timeout: 10_000 });

// ── Gamma API ────────────────────────────────────────────────────────────────

export async function searchMarkets(query: string, limit = 20) {
  const { data } = await gamma.get('/markets', {
    params: { search: query, limit, active: true },
  });
  return normalize(data);
}

export async function getTrendingMarkets(limit = 20) {
  const { data } = await gamma.get('/markets', {
    params: { order: 'volume24hr', ascending: false, active: true, limit },
  });
  return normalize(data);
}

export async function getClosingSoon(hours = 24, limit = 20) {
  const now = new Date();
  const future = new Date(now.getTime() + hours * 3_600_000);
  const { data } = await gamma.get('/markets', {
    params: {
      end_date_min: now.toISOString(),
      end_date_max: future.toISOString(),
      active: true, order: 'end_date', ascending: true, limit,
    },
  });
  return normalize(data);
}

export async function getMarketsByCategory(category: string, limit = 20) {
  const { data } = await gamma.get('/markets', {
    params: { tag_slug: category, active: true, limit },
  });
  return normalize(data);
}

export async function getMarket(id: string) {
  const { data } = await gamma.get(`/markets/${id}`);
  return data;
}

export async function getEvent(id: string) {
  const { data } = await gamma.get(`/events/${id}`);
  return data;
}

// ── CLOB API ─────────────────────────────────────────────────────────────────

export async function getOrderbook(tokenId: string) {
  const { data } = await clob.get('/book', { params: { token_id: tokenId } });
  return data;
}

export async function getSpread(tokenId: string) {
  const book = await getOrderbook(tokenId);
  const topBid = book.bids?.[0] ? Number(book.bids[0].price) : 0;
  const topAsk = book.asks?.[0] ? Number(book.asks[0].price) : 1;
  const spread = topAsk - topBid;
  const mid    = (topBid + topAsk) / 2;
  return {
    bid: topBid, ask: topAsk, spread, midpoint: mid,
    spreadPct: mid > 0 ? spread / mid : 0,
  };
}

export async function getLiquidity(tokenId: string) {
  const book = await getOrderbook(tokenId);
  const bidLiq = (book.bids ?? []).reduce((s: number, l: { price: string; size: string }) => s + Number(l.price) * Number(l.size), 0);
  const askLiq = (book.asks ?? []).reduce((s: number, l: { price: string; size: string }) => s + Number(l.price) * Number(l.size), 0);
  return { bid_liquidity: bidLiq, ask_liquidity: askLiq, total: bidLiq + askLiq };
}

export async function getPriceHistory(tokenId: string, days = 7, fidelity = 60) {
  const endTs   = Math.floor(Date.now() / 1000);
  const startTs = endTs - days * 86_400;
  const { data } = await clob.get('/prices-history', {
    params: { market: tokenId, startTs, endTs, fidelity },
  });
  return data?.history ?? [];
}

export async function getPrice(tokenId: string) {
  const [buy, sell] = await Promise.all([
    clob.get('/price', { params: { token_id: tokenId, side: 'BUY' } }),
    clob.get('/price', { params: { token_id: tokenId, side: 'SELL' } }),
  ]);
  const ask = Number(buy.data.price);
  const bid = Number(sell.data.price);
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalize(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'data' in data) return (data as { data: unknown[] }).data ?? [];
  return [];
}

export function formatOdds(price: number) {
  return `${(price * 100).toFixed(1)}%`;
}

export function formatUsd(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

export function timeUntil(endDate: string) {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff < 0) return 'Sona erdi';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}g ${h}s`;
  return `${h}s ${Math.floor((diff % 3_600_000) / 60_000)}dk`;
}
