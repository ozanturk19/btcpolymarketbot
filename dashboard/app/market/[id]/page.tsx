'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import PriceChart from '@/components/PriceChart';
import OrderbookVisual from '@/components/OrderbookVisual';
import AnalysisBadge from '@/components/AnalysisBadge';

function formatUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function timeUntil(endDate: string) {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff < 0) return 'Sona erdi';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}g ${h}s`;
  return `${h}s`;
}

export default function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const [market, setMarket]     = useState<Record<string, unknown> | null>(null);
  const [orderbook, setBook]    = useState<{ bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }> } | null>(null);
  const [spread, setSpread]     = useState<{ bid: number; ask: number; midpoint: number; spreadPct: number } | null>(null);
  const [history, setHistory]   = useState<Array<{ t: number; p: string }>>([]);
  const [analysis, setAnalysis] = useState<{ decision: 'BUY' | 'SELL' | 'HOLD'; score: number; signals: string[]; warnings: string[] } | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/market?id=${id}`)
      .then(r => r.json())
      .then(m => {
        setMarket(m);
        setLoading(false);

        const tokenId = (m.clobTokenIds as string[])?.[0];
        if (!tokenId) return;

        // Paralel veri çekimi
        Promise.all([
          fetch(`/api/orderbook?token_id=${tokenId}`).then(r => r.json()).catch(() => null),
          fetch(`/api/spread?token_id=${tokenId}`).then(r => r.json()).catch(() => null),
          fetch(`/api/analyze?token_id=${tokenId}&market_id=${id}`).then(r => r.json()).catch(() => null),
          fetch(`https://clob.polymarket.com/prices-history?market=${tokenId}&fidelity=60&startTs=${Math.floor(Date.now() / 1000) - 7 * 86400}`)
            .then(r => r.json()).then(d => d?.history ?? []).catch(() => []),
        ]).then(([book, spr, anal, hist]) => {
          if (book) setBook(book);
          if (spr)  setSpread(spr);
          if (anal && !anal.error) setAnalysis(anal);
          setHistory(hist);
        });
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="max-w-5xl mx-auto px-4 py-20 text-center text-gray-500">Yükleniyor...</div>;
  if (!market) return <div className="max-w-5xl mx-auto px-4 py-20 text-center text-gray-500">Market bulunamadı</div>;

  const m = market as Record<string, unknown>;
  const prices = ((m.outcomePrices as string[]) ?? []).map(Number);
  const outcomes = (m.outcomes as string[]) ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Başlık */}
      <div className="flex gap-4 items-start mb-6">
        {m.image && <img src={m.image as string} alt="" className="w-14 h-14 rounded-xl object-cover" />}
        <div>
          <h1 className="text-xl font-bold text-white mb-1">{m.question as string}</h1>
          <div className="flex gap-3 text-xs text-gray-500">
            <span>Hacim: {formatUsd((m.volumeNum ?? m.volume ?? 0) as number)}</span>
            <span>Likidite: {formatUsd((m.liquidityNum ?? m.liquidity ?? 0) as number)}</span>
            {m.endDate && <span>Kapanış: {timeUntil(m.endDate as string)}</span>}
          </div>
        </div>
      </div>

      {/* Outcome fiyatları */}
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

      {/* Spread bilgisi */}
      {spread && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="card text-center">
            <div className="text-xs text-gray-500">Bid</div>
            <div className="text-lg font-bold text-poly-green">{(spread.bid * 100).toFixed(1)}¢</div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Ask</div>
            <div className="text-lg font-bold text-poly-red">{(spread.ask * 100).toFixed(1)}¢</div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Midpoint</div>
            <div className="text-lg font-bold text-white">{(spread.midpoint * 100).toFixed(1)}¢</div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Spread</div>
            <div className={`text-lg font-bold ${spread.spreadPct < 0.03 ? 'text-poly-green' : spread.spreadPct < 0.08 ? 'text-yellow-400' : 'text-poly-red'}`}>
              {(spread.spreadPct * 100).toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {/* Grafik + Orderbook + Analiz */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <PriceChart data={history} />
        {orderbook && <OrderbookVisual bids={orderbook.bids ?? []} asks={orderbook.asks ?? []} />}
      </div>

      {analysis && <AnalysisBadge {...analysis} />}
    </div>
  );
}
