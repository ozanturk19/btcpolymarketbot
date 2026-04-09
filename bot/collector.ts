/**
 * collector.ts — Aktif marketler için CLOB orderbook snapshot'ı toplar
 * Her market için t=0,30,60,120,180,240,270 saniyede birer snapshot alır
 */

import axios from 'axios';
import type { Db } from './db/schema';
import type { BtcMarket } from './discovery';

const CLOB = 'https://clob.polymarket.com';

interface OrderLevel { price: string; size: string; }
interface OrderBook  { bids: OrderLevel[]; asks: OrderLevel[]; }

async function fetchBook(tokenId: string): Promise<OrderBook | null> {
  try {
    const res = await axios.get(`${CLOB}/book`, {
      params: { token_id: tokenId },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000,
    });
    return res.data;
  } catch {
    return null;
  }
}

function topDepth(levels: OrderLevel[], n = 5): number {
  return levels.slice(0, n).reduce((s, l) => s + Number(l.price) * Number(l.size), 0);
}

function midpoint(bids: OrderLevel[], asks: OrderLevel[]): number | null {
  if (!bids.length || !asks.length) return null;
  return (Number(bids[0].price) + Number(asks[0].price)) / 2;
}

/** Tek bir market için iki tarafın snapshot'ını kaydet */
export async function takeSnapshot(
  db: Db,
  market: BtcMarket,
  btcPrice: number | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - market.openTime;

  const [upBook, downBook] = await Promise.all([
    market.tokenUp   ? fetchBook(market.tokenUp)   : null,
    market.tokenDown ? fetchBook(market.tokenDown) : null,
  ]);

  const upBid  = upBook?.bids[0]   ? Number(upBook.bids[0].price)   : null;
  const upAsk  = upBook?.asks[0]   ? Number(upBook.asks[0].price)   : null;
  const dnBid  = downBook?.bids[0] ? Number(downBook.bids[0].price) : null;
  const dnAsk  = downBook?.asks[0] ? Number(downBook.asks[0].price) : null;

  db.prepare(`
    INSERT INTO snapshots
      (market_id, ts, elapsed_sec,
       up_bid, up_ask, up_best_price,
       down_bid, down_ask, down_best_price,
       up_bid_depth, up_ask_depth, down_bid_depth, down_ask_depth,
       btc_price, spread_up, spread_down)
    VALUES
      (?, ?, ?,
       ?, ?, ?,
       ?, ?, ?,
       ?, ?, ?, ?,
       ?, ?, ?)
  `).run(
    market.id, now, elapsed,
    upBid,  upAsk,  upBook  ? midpoint(upBook.bids,   upBook.asks)   : null,
    dnBid,  dnAsk,  downBook ? midpoint(downBook.bids, downBook.asks) : null,
    upBook   ? topDepth(upBook.bids)   : null,
    upBook   ? topDepth(upBook.asks)   : null,
    downBook ? topDepth(downBook.bids) : null,
    downBook ? topDepth(downBook.asks) : null,
    btcPrice,
    upBid  != null && upAsk  != null ? upAsk  - upBid  : null,
    dnBid  != null && dnAsk  != null ? dnAsk  - dnBid  : null,
  );
}

/** Biten marketlerde BTC açılış/kapanış fiyatını güncelle */
export function updateBtcPrices(db: Db, marketId: string, open: number | null, close: number | null): void {
  db.prepare(`UPDATE markets SET btc_open=?, btc_close=? WHERE id=?`).run(open, close, marketId);
}

/** Snapshot alma zamanlaması: 5-dk market için hangi saniyelerde ölç */
export function shouldSnapshot(market: BtcMarket, lastSnapshotElapsed: number | null): boolean {
  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - market.openTime;
  const remaining = market.closeTime - now;

  if (remaining < 0) return false;

  // İlk snapshot: market açılışından sonra (elapsed 0-15s)
  if (lastSnapshotElapsed === null && elapsed >= 0) return true;

  if (lastSnapshotElapsed === null) return false;

  const durationSec = market.durationMin * 60;

  // Snapshot noktaları: her dakikada 1, son 60s'de her 15s'de 1
  if (remaining < 60) {
    return elapsed - lastSnapshotElapsed >= 15;  // son 1 dakika: 15s'de bir
  }
  if (elapsed < 120) {
    return elapsed - lastSnapshotElapsed >= 30;  // ilk 2 dakika: 30s'de bir
  }
  return elapsed - lastSnapshotElapsed >= 60;    // orta: 60s'de bir
}
