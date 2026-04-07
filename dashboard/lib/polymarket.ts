// Tüm istekler Next.js API proxy üzerinden geçer (CORS fix + JSON parse)
const API = '/api';

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Markets ───────────────────────────────────────────────────────────────────

const ACTIVE_FILTER = 'active=true&closed=false&archived=false';

export async function searchMarkets(query: string, limit = 20) {
  const data = await fetchJson(
    `${API}/markets?search=${encodeURIComponent(query)}&limit=${limit}&${ACTIVE_FILTER}`
  );
  return normalize(data);
}

export async function getTrendingMarkets(limit = 20) {
  const data = await fetchJson(
    `${API}/markets?order=volume24hr&ascending=false&${ACTIVE_FILTER}&limit=${limit}`
  );
  return normalize(data);
}

export async function getClosingSoon(hours = 24, limit = 20) {
  const now = new Date();
  const future = new Date(now.getTime() + hours * 3_600_000);
  const data = await fetchJson(
    `${API}/markets?end_date_min=${now.toISOString()}&end_date_max=${future.toISOString()}&${ACTIVE_FILTER}&order=end_date&ascending=true&limit=${limit}`
  );
  return normalize(data);
}

export async function getMarketsByCategory(category: string, limit = 20) {
  const data = await fetchJson(
    `${API}/markets?tag_slug=${encodeURIComponent(category)}&${ACTIVE_FILTER}&order=volume24hr&ascending=false&limit=${limit}`
  );
  return normalize(data);
}

export async function getMarket(id: string) {
  return fetchJson(`${API}/markets/${encodeURIComponent(id)}`);
}

// ── Orderbook / CLOB ─────────────────────────────────────────────────────────

export async function getOrderbook(tokenId: string) {
  return fetchJson(`${API}/orderbook?token_id=${encodeURIComponent(tokenId)}`);
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
  const bidLiq = (book.bids ?? []).reduce(
    (s: number, l: { price: string; size: string }) => s + Number(l.price) * Number(l.size), 0
  );
  const askLiq = (book.asks ?? []).reduce(
    (s: number, l: { price: string; size: string }) => s + Number(l.price) * Number(l.size), 0
  );
  return { bid_liquidity: bidLiq, ask_liquidity: askLiq, total: bidLiq + askLiq };
}

export async function getPriceHistory(tokenId: string, days = 7, fidelity = 60) {
  const endTs   = Math.floor(Date.now() / 1000);
  const startTs = endTs - days * 86_400;
  const data = await fetchJson(
    `${API}/prices-history?market=${encodeURIComponent(tokenId)}&startTs=${startTs}&endTs=${endTs}&fidelity=${fidelity}`
  );
  return data?.history ?? [];
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

export function formatUsdShort(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function timeUntil(endDate: string) {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff < 0) return 'Sona erdi';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}g ${h}s`;
  return `${h}s ${Math.floor((diff % 3_600_000) / 60_000)}dk`;
}
