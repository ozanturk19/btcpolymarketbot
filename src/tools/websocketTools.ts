import { z } from 'zod';
import { wsManager, type WsMessage } from '../websocket/wsManager';
import { registerTool } from '../server';
import { formatOdds } from '../utils/toolHelper';

// Alert geçmişi (memory-only, session bazlı)
const alertLog: Array<{ ts: string; event: string; details: string }> = [];
const MAX_ALERTS = 200;

function logAlert(event: string, details: string) {
  alertLog.unshift({ ts: new Date().toISOString(), event, details });
  if (alertLog.length > MAX_ALERTS) alertLog.pop();
  console.error(`[ALERT] ${event}: ${details}`);
}

// ─── 1. subscribe_market_prices ──────────────────────────────────────────────
registerTool({
  name: 'subscribe_market_prices',
  description: 'Bir veya daha fazla token için canlı fiyat akışını başlat. Fiyat değişimlerini arka planda izler.',
  inputSchema: z.object({
    token_ids:     z.array(z.string()).describe('İzlenecek CLOB token ID listesi'),
    min_change_pct: z.number().optional().default(1).describe('Alert için minimum fiyat değişimi (%), varsayılan: 1'),
    label:          z.string().optional().default('price-monitor').describe('Abonelik etiketi'),
  }),
  async handler({ token_ids, min_change_pct, label }: {
    token_ids: string[]; min_change_pct: number; label: string;
  }) {
    const subId  = `prices-${label}-${Date.now()}`;
    const prices: Record<string, number> = {};

    wsManager.subscribe(subId, token_ids, 'market', (msg: WsMessage) => {
      if (msg.event_type !== 'price_change') return;
      const d = msg.data as { price?: string; side?: string };
      const newPrice = Number(d.price ?? 0);
      const prev     = prices[msg.asset_id];

      if (prev !== undefined) {
        const changePct = Math.abs((newPrice - prev) / prev) * 100;
        if (changePct >= min_change_pct) {
          logAlert('PRICE_CHANGE', `${msg.asset_id}: ${formatOdds(prev)} → ${formatOdds(newPrice)} (${changePct.toFixed(1)}%)`);
        }
      }
      prices[msg.asset_id] = newPrice;
    });

    return {
      subscriptionId: subId,
      status:         'Aktif',
      monitoredTokens: token_ids.length,
      minChangePct:   min_change_pct,
      message: `${token_ids.length} token izleniyor. Alertleri görmek için get_alerts kullanın.`,
    };
  },
});

// ─── 2. subscribe_orderbook_updates ─────────────────────────────────────────
registerTool({
  name: 'subscribe_orderbook_updates',
  description: 'Orderbook derinlik değişimlerini canlı izle. Büyük duvar eklendiğinde/kaldırıldığında alert üretir.',
  inputSchema: z.object({
    token_ids:      z.array(z.string()),
    min_size_usd:   z.number().optional().default(1000).describe('Alert için minimum emir büyüklüğü (USD)'),
    label:          z.string().optional().default('book-monitor'),
  }),
  async handler({ token_ids, min_size_usd, label }: {
    token_ids: string[]; min_size_usd: number; label: string;
  }) {
    const subId = `book-${label}-${Date.now()}`;

    wsManager.subscribe(subId, token_ids, 'market', (msg: WsMessage) => {
      if (msg.event_type !== 'book_update') return;
      const d = msg.data as { bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }> };

      const checkLevels = (levels: typeof d.bids, side: 'BID' | 'ASK') => {
        if (!levels) return;
        for (const l of levels) {
          const usd = Number(l.price) * Number(l.size);
          if (usd >= min_size_usd) {
            logAlert('LARGE_ORDER', `${side} duvarı: ${formatOdds(Number(l.price))} × ${Number(l.size).toFixed(0)} = $${usd.toFixed(0)}`);
          }
        }
      };

      checkLevels(d.bids, 'BID');
      checkLevels(d.asks, 'ASK');
    });

    return {
      subscriptionId: subId,
      status:         'Aktif',
      monitoredTokens: token_ids.length,
      minSizeUsd:     min_size_usd,
      message: `Orderbook izleniyor. $${min_size_usd}+ emirler alert üretecek.`,
    };
  },
});

// ─── 3. subscribe_user_trades ────────────────────────────────────────────────
registerTool({
  name: 'subscribe_user_trades',
  description: 'Kullanıcı emirlerinin dolduğunu anlık izle. Full Mode gerektirir.',
  inputSchema: z.object({
    wallet_address: z.string().describe('İzlenecek cüzdan adresi'),
    label:          z.string().optional().default('trade-monitor'),
  }),
  requiresFullMode: true,
  async handler({ wallet_address, label }: { wallet_address: string; label: string }) {
    const subId = `trades-${label}-${Date.now()}`;

    wsManager.subscribe(subId, [wallet_address], 'user', (msg: WsMessage) => {
      if (msg.event_type !== 'trade') return;
      const d = msg.data as { price?: string; size?: string; side?: string };
      logAlert('TRADE_FILLED', `${d.side} ${d.size} @ ${formatOdds(Number(d.price))}`);
    });

    return {
      subscriptionId: subId,
      status:         'Aktif',
      wallet:         wallet_address,
      message:        'Emirleriniz dolduğunda bildirim alacaksınız.',
    };
  },
});

// ─── 4. subscribe_market_resolution ─────────────────────────────────────────
registerTool({
  name: 'subscribe_market_resolution',
  description: 'Market çözümlendiğinde (kazanan açıklandığında) anlık bildirim al.',
  inputSchema: z.object({
    token_ids: z.array(z.string()).describe('İzlenecek token ID listesi'),
    label:     z.string().optional().default('resolution-monitor'),
  }),
  async handler({ token_ids, label }: { token_ids: string[]; label: string }) {
    const subId = `resolve-${label}-${Date.now()}`;

    wsManager.subscribe(subId, token_ids, 'market', (msg: WsMessage) => {
      if (msg.event_type !== 'market_resolved') return;
      const d = msg.data as { outcome?: string; resolution?: string };
      logAlert('MARKET_RESOLVED', `Kazanan: ${d.outcome ?? d.resolution}. Token: ${msg.asset_id}`);
    });

    return {
      subscriptionId: subId,
      status:         'Aktif',
      monitoredTokens: token_ids.length,
      message:        'Market çözümlendiğinde bildirim alacaksınız.',
    };
  },
});

// ─── 5. get_alerts ───────────────────────────────────────────────────────────
registerTool({
  name: 'get_alerts',
  description: 'WebSocket izleme sisteminden biriken alertleri getir.',
  inputSchema: z.object({
    limit: z.number().optional().default(20),
    type:  z.string().optional().describe('PRICE_CHANGE | LARGE_ORDER | TRADE_FILLED | MARKET_RESOLVED'),
  }),
  async handler({ limit, type }: { limit: number; type?: string }) {
    const filtered = type
      ? alertLog.filter(a => a.event === type)
      : alertLog;

    return {
      total:        alertLog.length,
      showing:      Math.min(limit, filtered.length),
      wsStatus:     wsManager.getStatus(),
      alerts:       filtered.slice(0, limit),
    };
  },
});

// ─── 6. unsubscribe ──────────────────────────────────────────────────────────
registerTool({
  name: 'unsubscribe',
  description: 'Aktif bir WebSocket aboneliğini iptal et.',
  inputSchema: z.object({
    subscription_id: z.string().describe('subscribe araçlarından dönen subscriptionId'),
  }),
  async handler({ subscription_id }: { subscription_id: string }) {
    wsManager.unsubscribe(subscription_id);
    return { status: 'İptal edildi', subscription_id, wsStatus: wsManager.getStatus() };
  },
});

// ─── 7. ws_status ────────────────────────────────────────────────────────────
registerTool({
  name: 'ws_status',
  description: 'WebSocket bağlantı durumunu ve aktif abonelik sayısını kontrol et.',
  inputSchema: z.object({}),
  async handler() {
    return wsManager.getStatus();
  },
});
