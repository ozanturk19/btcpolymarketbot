import WebSocket from 'ws';
import { config } from '../config';

export type WsEventType = 'price_change' | 'book_update' | 'trade' | 'market_resolved';

export interface WsMessage {
  event_type: WsEventType;
  asset_id:   string;
  market:     string;
  data:       unknown;
  timestamp:  string;
}

export type AlertCallback = (msg: WsMessage) => void;

interface Subscription {
  id:       string;
  tokenIds: string[];
  type:     'market' | 'user';
  callback: AlertCallback;
}

export class WebSocketManager {
  private ws:          WebSocket | null     = null;
  private subs:        Map<string, Subscription> = new Map();
  private reconnects   = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isClosing    = false;

  /** Token ID listesi için subscribe */
  subscribe(id: string, tokenIds: string[], type: 'market' | 'user', callback: AlertCallback): void {
    this.subs.set(id, { id, tokenIds, type, callback });
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscription(tokenIds, type);
    }
  }

  unsubscribe(id: string): void {
    this.subs.delete(id);
    if (this.subs.size === 0) this.disconnect();
  }

  private connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;

    console.error(`[WS] Bağlanıyor: ${config.ws.url}`);
    this.ws = new WebSocket(config.ws.url);

    this.ws.on('open', () => {
      console.error('[WS] Bağlantı kuruldu');
      this.reconnects = 0;
      for (const sub of this.subs.values()) {
        this.sendSubscription(sub.tokenIds, sub.type);
      }
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const messages: unknown[] = JSON.parse(raw.toString());
        if (!Array.isArray(messages)) return;
        for (const msg of messages) this.handleMessage(msg);
      } catch { /* parse hataları yok say */ }
    });

    this.ws.on('error', (err) => {
      console.error('[WS] Hata:', err.message);
    });

    this.ws.on('close', () => {
      if (!this.isClosing && this.subs.size > 0) {
        this.scheduleReconnect();
      }
    });
  }

  private sendSubscription(tokenIds: string[], type: 'market' | 'user'): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = JSON.stringify({
      auth:      { apiKey: '' },
      type:      'subscribe',
      markets:   type === 'market' ? tokenIds : [],
      user:      type === 'user'   ? tokenIds : [],
    });
    this.ws.send(payload);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'object' || !raw) return;
    const msg = raw as Record<string, unknown>;

    let event: WsMessage | null = null;

    if (msg.event_type === 'price_change') {
      event = {
        event_type: 'price_change',
        asset_id:   String(msg.asset_id ?? ''),
        market:     String(msg.market   ?? ''),
        data:       { price: msg.price, side: msg.side },
        timestamp:  new Date().toISOString(),
      };
    } else if (msg.event_type === 'book') {
      event = {
        event_type: 'book_update',
        asset_id:   String(msg.asset_id ?? ''),
        market:     String(msg.market   ?? ''),
        data:       { bids: msg.bids, asks: msg.asks },
        timestamp:  new Date().toISOString(),
      };
    } else if (msg.event_type === 'trade') {
      event = {
        event_type: 'trade',
        asset_id:   String(msg.asset_id ?? ''),
        market:     String(msg.market   ?? ''),
        data:       { price: msg.price, size: msg.size, side: msg.side },
        timestamp:  new Date().toISOString(),
      };
    } else if (msg.event_type === 'market_resolved') {
      event = {
        event_type: 'market_resolved',
        asset_id:   String(msg.asset_id ?? ''),
        market:     String(msg.market   ?? ''),
        data:       { outcome: msg.outcome, resolution: msg.resolution },
        timestamp:  new Date().toISOString(),
      };
    }

    if (!event) return;

    for (const sub of this.subs.values()) {
      if (sub.tokenIds.includes(event.asset_id) || sub.tokenIds.length === 0) {
        sub.callback(event);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnects >= config.ws.maxReconnectAttempts) {
      console.error('[WS] Maksimum yeniden bağlantı denemesi aşıldı.');
      return;
    }
    const delay = config.ws.reconnectDelayMs * Math.pow(2, this.reconnects);
    this.reconnects++;
    console.error(`[WS] ${delay}ms sonra yeniden bağlanılıyor... (deneme: ${this.reconnects})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  disconnect(): void {
    this.isClosing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.isClosing = false;
  }

  getStatus(): { connected: boolean; subscriptions: number } {
    return {
      connected:     this.ws?.readyState === WebSocket.OPEN,
      subscriptions: this.subs.size,
    };
  }
}

// Singleton instance
export const wsManager = new WebSocketManager();
