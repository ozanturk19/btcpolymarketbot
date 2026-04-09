/**
 * discovery.ts — Polymarket'te yeni BTC Up/Down marketleri tarar
 * 5min, 15min, 1hour, daily hepsini otomatik tespit eder
 */

import axios from 'axios';
import type { Db } from './db/schema';

const GAMMA = 'https://gamma-api.polymarket.com';

export interface BtcMarket {
  id: string;
  question: string;
  durationMin: number;
  tokenUp: string | null;
  tokenDown: string | null;
  closeTime: number;       // unix timestamp
  openTime: number;        // tahmini açılış
  upPrice: number;
  downPrice: number;
  upBid: number | null;
  upAsk: number | null;
  downBid: number | null;
  downAsk: number | null;
  volume24h: number;
  liquidity: number;
  acceptingOrders: boolean;
}

/** Başlıktan süreyi dakika cinsinden çıkar */
function parseDuration(title: string): number {
  const m = title.match(/(\d+):(\d+)(AM|PM)\s*-\s*(\d+):(\d+)(AM|PM)/i);
  if (m) {
    let [, h1, m1, p1, h2, m2, p2] = m;
    let start = (parseInt(h1) % 12) + (p1.toUpperCase() === 'PM' ? 12 : 0);
    let end   = (parseInt(h2) % 12) + (p2.toUpperCase() === 'PM' ? 12 : 0);
    const diff = (end * 60 + parseInt(m2)) - (start * 60 + parseInt(m1));
    return diff > 0 ? diff : diff + 1440;
  }
  // "9AM ET" pattern → 1 saatlik
  if (/\d+(AM|PM)\s+ET/i.test(title) && !/-/.test(title.split('Down')[1] ?? '')) return 60;
  // "on April X" → günlük
  if (/on \w+ \d+\??$/.test(title)) return 1440;
  return 5; // default
}

/** Gamma API market objesini parse et */
function parseMarket(m: Record<string, unknown>): BtcMarket | null {
  const q = (m.question as string) ?? '';
  if (!q.includes('Bitcoin Up or Down')) return null;

  const tryArr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
    return [];
  };

  const outcomes = tryArr(m.outcomes);
  const prices   = tryArr(m.outcomePrices).map(Number);
  const tokens   = tryArr(m.clobTokenIds);

  // "Up" outcome'ını bul (index 0 genellikle Up)
  const upIdx   = outcomes.findIndex(o => o.toLowerCase().includes('up') || o === 'Yes');
  const downIdx = upIdx === 0 ? 1 : 0;

  const closeTime = m.endDate ? Math.floor(new Date(m.endDate as string).getTime() / 1000) : 0;
  const duration  = parseDuration(q);
  const openTime  = closeTime - duration * 60;

  return {
    id:             m.id as string,
    question:       q,
    durationMin:    duration,
    tokenUp:        tokens[upIdx] ?? tokens[0] ?? null,
    tokenDown:      tokens[downIdx] ?? tokens[1] ?? null,
    closeTime,
    openTime,
    upPrice:        prices[upIdx] ?? 0.5,
    downPrice:      prices[downIdx] ?? 0.5,
    upBid:          upIdx === 0 ? (m.bestBid as number ?? null) : null,
    upAsk:          upIdx === 0 ? (m.bestAsk as number ?? null) : null,
    downBid:        upIdx === 1 ? (m.bestBid as number ?? null) : null,
    downAsk:        upIdx === 1 ? (m.bestAsk as number ?? null) : null,
    volume24h:      Number(m.volume24hr ?? 0),
    liquidity:      Number(m.liquidity ?? 0),
    acceptingOrders: (m.acceptingOrders as boolean) ?? false,
  };
}

/** Şu an aktif BTC marketlerini çek */
export async function fetchActiveMarkets(durationFilter?: number[]): Promise<BtcMarket[]> {
  const now = Math.floor(Date.now() / 1000);

  const res = await axios.get(`${GAMMA}/events`, {
    params: { tag_slug: 'bitcoin', active: true, limit: 100, order: 'end_date', ascending: true },
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000,
  });

  const events: Record<string, unknown>[] = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
  const markets: BtcMarket[] = [];

  for (const event of events) {
    const title = (event.title as string) ?? '';
    if (!title.includes('Up or Down')) continue;

    const mArr = (event.markets as Record<string, unknown>[]) ?? [];
    for (const m of mArr) {
      if (m.closed || m.archived) continue;

      const parsed = parseMarket(m);
      if (!parsed) continue;
      if (parsed.closeTime < now) continue;   // zaten bitmiş
      if (durationFilter && !durationFilter.includes(parsed.durationMin)) continue;

      markets.push(parsed);
    }
  }

  return markets;
}

/** Yeni marketleri DB'ye kaydet, zaten varsa atla */
export function upsertMarkets(db: Db, markets: BtcMarket[]): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO markets
      (id, question, duration_min, token_up, token_down, open_time, close_time)
    VALUES
      (@id, @question, @durationMin, @tokenUp, @tokenDown, @openTime, @closeTime)
  `);

  let inserted = 0;
  const tx = db.transaction((list: BtcMarket[]) => {
    for (const m of list) {
      const r = stmt.run({
        id: m.id, question: m.question, durationMin: m.durationMin,
        tokenUp: m.tokenUp, tokenDown: m.tokenDown,
        openTime: m.openTime, closeTime: m.closeTime,
      });
      if (r.changes > 0) inserted++;
    }
  });
  tx(markets);
  return inserted;
}

/** Biten marketlerin outcome'ını güncelle */
export async function resolveMarkets(db: Db): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const pending = db.prepare(`
    SELECT id FROM markets
    WHERE outcome IS NULL AND close_time < ?
  `).all(now - 60) as { id: string }[];  // 60s grace period

  for (const { id } of pending) {
    try {
      const res = await axios.get(`${GAMMA}/markets/${id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000,
      });
      const m = res.data;
      const prices = (() => {
        const v = m.outcomePrices;
        if (Array.isArray(v)) return v.map(Number);
        try { return JSON.parse(v).map(Number); } catch { return []; }
      })();

      const outcomes = (() => {
        const v = m.outcomes;
        if (Array.isArray(v)) return v;
        try { return JSON.parse(v); } catch { return []; }
      })();

      const upIdx   = outcomes.findIndex((o: string) => o.toLowerCase().includes('up') || o === 'Yes');
      const downIdx = upIdx === 0 ? 1 : 0;
      const upFinal   = prices[upIdx] ?? 0;
      const downFinal = prices[downIdx] ?? 0;
      const outcome   = upFinal > 0.9 ? 'UP' : downFinal > 0.9 ? 'DOWN' : null;

      if (outcome) {
        db.prepare(`
          UPDATE markets SET outcome=?, up_price_final=?, down_price_final=? WHERE id=?
        `).run(outcome, upFinal, downFinal, id);
        console.log(`[resolve] ${id} → ${outcome} (up=${upFinal} down=${downFinal})`);
      }
    } catch (e) {
      // sessizce geç
    }
  }
}
