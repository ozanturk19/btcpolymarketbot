'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import PriceChart from '@/components/PriceChart';
import OrderbookVisual from '@/components/OrderbookVisual';
import AnalysisBadge from '@/components/AnalysisBadge';
import {
  getMarket, getOrderbook, getSpread, getLiquidity, getPriceHistory,
  formatUsdShort, timeUntil,
} from '@/lib/polymarket';

interface MarketData {
  id: string;
  question: string;
  outcomes?: string[];
  outcomePrices?: string[];
  volumeNum?: number;
  volume?: number;
  volume24hr?: number;
  liquidityNum?: number;
  liquidity?: number;
  endDate?: string;
  image?: string;
  clobTokenIds?: string[];
}

export default function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const [market, setMarket]     = useState<MarketData | null>(null);
  const [orderbook, setBook]    = useState<{ bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }> } | null>(null);
  const [spreadData, setSpread] = useState<{ bid: number; ask: number; midpoint: number; spreadPct: number } | null>(null);
  const [history, setHistory]   = useState<Array<{ t: number; p: string }>>([]);
  const [analysis, setAnalysis] = useState<{ decision: 'BUY' | 'SELL' | 'HOLD'; score: number; signals: string[]; warnings: string[] } | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);

    getMarket(id)
      .then(async (m: MarketData) => {
        setMarket(m);
        setLoading(false);

        let tokenIds = m.clobTokenIds ?? [];
        if (typeof tokenIds === 'string') {
          try { tokenIds = JSON.parse(tokenIds); } catch { tokenIds = []; }
        }
        const tokenId = tokenIds[0];
        if (!tokenId) return;

        // Paralel CLOB verisi çekimi (tarayıcıdan doğrudan)
        const [book, spr, liq, hist] = await Promise.all([
          getOrderbook(tokenId).catch(() => null),
          getSpread(tokenId).catch(() => null),
          getLiquidity(tokenId).catch(() => null),
          getPriceHistory(tokenId, 7).catch(() => []),
        ]);

        if (book) setBook(book);
        if (spr)  setSpread(spr);
        setHistory(hist);

        // Client-side analiz hesapla
        if (spr && liq) {
          let score = 50;
          const signals: string[] = [];
          const warnings: string[] = [];

          if (spr.spreadPct < 0.02)       { score += 15; signals.push('Dar spread'); }
          else if (spr.spreadPct > 0.08)  { score -= 20; warnings.push('Geniş spread'); }
          if (liq.total > 50_000)         { score += 10; signals.push(`Güçlü likidite: ${formatUsdShort(liq.total)}`); }
          else if (liq.total < 5_000)     { score -= 15; warnings.push('Düşük likidite'); }
          const vol24h = (m.volume24hr ?? 0) as number;
          if (vol24h > 50_000)            { score += 10; signals.push(`Yüksek hacim: ${formatUsdShort(vol24h)}`); }
          else if (vol24h < 1_000)        { score -= 10; warnings.push('Düşük hacim'); }

          score = Math.max(0, Math.min(100, score));
          const decision = score >= 65 ? 'BUY' as const : score <= 35 ? 'SELL' as const : 'HOLD' as const;
          setAnalysis({ decision, score, signals, warnings });
        }
      })
      .catch(() => {
        setError('Market verisi yüklenemedi');
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div className="max-w-5xl mx-auto px-4 py-20 text-center text-gray-500">Yükleniyor...</div>;
  if (error)   return <div className="max-w-5xl mx-auto px-4 py-20 text-center text-poly-red">{error}</div>;
  if (!market) return <div className="max-w-5xl mx-auto px-4 py-20 text-center text-gray-500">Market bulunamadı</div>;

  function parseJsonField(val: unknown): string[] {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
    }
    return [];
  }
  const prices   = parseJsonField(market.outcomePrices).map(Number);
  const outcomes = parseJsonField(market.outcomes);
  const volume   = Number(market.volumeNum ?? market.volume ?? 0) || 0;
  const liq      = Number(market.liquidityNum ?? market.liquidity ?? 0) || 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex gap-4 items-start mb-6">
        {market.image && <img src={market.image} alt={market.question} className="w-14 h-14 rounded-xl object-cover" />}
        <div>
          <h1 className="text-xl font-bold text-white mb-1">{market.question}</h1>
          <div className="flex gap-3 text-xs text-gray-500">
            <span>Hacim: {formatUsdShort(volume)}</span>
            <span>Likidite: {formatUsdShort(liq)}</span>
            {market.endDate && <span>Kapanış: {timeUntil(market.endDate)}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {outcomes.slice(0, 2).map((o, i) => (
          <div key={o} className={`card text-center ${i === 0 ? 'border-poly-green/30' : 'border-poly-red/30'}`}>
            <div className="text-xs text-gray-500 mb-1">{o}</div>
            <div className={`text-3xl font-bold ${i === 0 ? 'text-poly-green' : 'text-poly-red'}`}>
              {prices[i] !== undefined ? `${(prices[i] * 100).toFixed(1)}¢` : '-'}
            </div>
          </div>
        ))}
      </div>

      {spreadData && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Bid', val: spreadData.bid, cls: 'text-poly-green' },
            { label: 'Ask', val: spreadData.ask, cls: 'text-poly-red' },
            { label: 'Midpoint', val: spreadData.midpoint, cls: 'text-white' },
          ].map(s => (
            <div key={s.label} className="card text-center">
              <div className="text-xs text-gray-500">{s.label}</div>
              <div className={`text-lg font-bold ${s.cls}`}>{(s.val * 100).toFixed(1)}¢</div>
            </div>
          ))}
          <div className="card text-center">
            <div className="text-xs text-gray-500">Spread</div>
            <div className={`text-lg font-bold ${spreadData.spreadPct < 0.03 ? 'text-poly-green' : spreadData.spreadPct < 0.08 ? 'text-yellow-400' : 'text-poly-red'}`}>
              {(spreadData.spreadPct * 100).toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <PriceChart data={history} />
        {orderbook && <OrderbookVisual bids={orderbook.bids ?? []} asks={orderbook.asks ?? []} />}
      </div>

      {analysis && <AnalysisBadge {...analysis} />}
    </div>
  );
}
