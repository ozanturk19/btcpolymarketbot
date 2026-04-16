/**
 * btcFeed.ts — Binance WebSocket üzerinden anlık BTC/USDT fiyatı
 * Bağlantı koptuğunda otomatik yeniden bağlanır
 */

import WebSocket from 'ws';
import type { Db } from './db/schema';

export class BtcPriceFeed {
  private price: number | null = null;
  private ws: WebSocket | null = null;
  private db: Db;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSaveTs = 0;

  constructor(db: Db) {
    this.db = db;
  }

  get current(): number | null { return this.price; }

  start(): void {
    this.connect();
  }

  stop(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private connect(): void {
    const url = 'wss://stream.binance.com:9443/ws/btcusdt@trade';
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[btcFeed] Binance WebSocket bağlandı');
    });

    this.ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.price = parseFloat(msg.p);
        const now = Math.floor(Date.now() / 1000);

        // Her 5 saniyede bir DB'ye kaydet
        if (now - this.lastSaveTs >= 5) {
          this.db.prepare(`INSERT OR REPLACE INTO btc_prices (ts, price) VALUES (?, ?)`)
            .run(now, this.price);
          this.lastSaveTs = now;
        }
      } catch { /* parse hatası, geç */ }
    });

    this.ws.on('error', (err) => {
      console.error('[btcFeed] Hata:', err.message);
    });

    this.ws.on('close', () => {
      console.log('[btcFeed] Bağlantı koptu, 5s sonra yeniden bağlanıyor...');
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    });
  }

  /** Son N saniyenin realized volatilitesi (yüzde) */
  recentVolatility(seconds = 300): number | null {
    const now = Math.floor(Date.now() / 1000);
    const rows = this.db.prepare(`
      SELECT price FROM btc_prices
      WHERE ts >= ? ORDER BY ts ASC
    `).all(now - seconds) as { price: number }[];

    if (rows.length < 10) return null;

    const prices = rows.map(r => r.price);
    const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance) * 100;  // yüzde olarak
  }

  /** Piyasa düşük volatiliteli mi? (Strateji 2 için filtre) */
  isLowVolatility(threshold = 0.15): boolean {
    const vol = this.recentVolatility(300);
    if (vol === null) return false;
    return vol < threshold;
  }
}
