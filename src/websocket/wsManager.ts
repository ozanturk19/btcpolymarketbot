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
    // Son abonelik çıkınca bağlantıyı hemen kesme - reconnect race condition önlenir
    if (this.subs.size === 0) {
      // Kısa gecikme: hemen yeni subscribe gelirse gereksiz disconnect/connect döngüsü olmaz
      setTimeout(() => {
        if (this.subs.size === 0) this.disconnect();
      }, 2000);
    }
  }

  private cleanupWs(): void {
    if (!this.ws) return;
    this.ws.removeAllListeners();
    this.ws = null;
  }

  private connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;

    // Eski bağlantının listener'larını temizle (memory leak önlenir)
    this.cleanupWs();

    console.error(`[WS] Bağlanıyor: ${config.ws.url}`);
    const ws = new WebSocket(config.ws.url);
    this.ws = ws;

    ws.on('open', () => {
      console.error('[WS] Bağlantı kuruldu');
      this.reconnects = 0;
      this.reconnectTimer = null;
      for (const sub of this.subs.values()) {
        this.sendSubscription(sub.tokenIds, sub.type);
      }
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        // API bazen tek obje, bazen dizi döndürür
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        for (const msg of messages) this.handleMessage(msg);
      } catch {
        // Geçersiz JSON - yoksay
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Hata:', err.message);
    });

    ws.on('close', () => {
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

    const eventType = String(msg.event_type ?? '');
    const assetId   = String(msg.asset_id ?? '');
    const market    = String(msg.market ?? '');

    if (!assetId) return;

    let wsEventType: WsEventType;
    let data: unknown;

    switch (eventType) {
      case 'price_change':
        wsEventType = 'price_change';
        data = { price: String(msg.price ?? '0'), side: String(msg.side ?? '') };
        break;
      case 'book':
        wsEventType = 'book_update';
        data = { bids: Array.isArray(msg.bids) ? msg.bids : [], asks: Array.isArray(msg.asks) ? msg.asks : [] };
        break;
      case 'trade':
        wsEventType = 'trade';
        data = { price: String(msg.price ?? '0'), size: String(msg.size ?? '0'), side: String(msg.side ?? '') };
        break;
      case 'market_resolved':
        wsEventType = 'market_resolved';
        data = { outcome: String(msg.outcome ?? ''), resolution: String(msg.resolution ?? '') };
        break;
      default:
        return; // Bilinmeyen event tipi
    }

    const event: WsMessage = {
      event_type: wsEventType,
      asset_id:   assetId,
      market,
      data,
      timestamp:  new Date().toISOString(),
    };

    for (const sub of this.subs.values()) {
      if (sub.tokenIds.includes(event.asset_id) || sub.tokenIds.length === 0) {
        try {
          sub.callback(event);
        } catch (err) {
          console.error(`[WS] Callback hatası (${sub.id}):`, err);
        }
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupWs();
    this.isClosing = false;
  }

  getStatus(): { connected: boolean; subscriptions: number; subscriberIds: string[] } {
    return {
      connected:     this.ws?.readyState === WebSocket.OPEN,
      subscriptions: this.subs.size,
      subscriberIds: Array.from(this.subs.keys()),
    };
  }
}

export const wsManager = new WebSocketManager();
