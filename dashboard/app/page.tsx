'use client';

import { useEffect, useState } from 'react';
import MarketCard from '@/components/MarketCard';
import { getTrendingMarkets, getMarketsByCategory } from '@/lib/polymarket';

type Market = {
  id: string;
  question: string;
  outcomes?: string[];
  outcomePrices?: string[];
  volume24hr?: number;
  liquidityNum?: number;
  liquidity?: number;
  endDate?: string;
  image?: string;
};

export default function Home() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const fetchData = category === 'all'
      ? getTrendingMarkets(12)
      : getMarketsByCategory(category, 12);

    fetchData
      .then(data => { setMarkets(data as Market[]); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [category]);

  const categories = [
    { slug: 'all', label: 'Tümü' },
    { slug: 'politics', label: 'Politika' },
    { slug: 'sports', label: 'Spor' },
    { slug: 'crypto', label: 'Kripto' },
    { slug: 'culture', label: 'Kültür' },
    { slug: 'economics', label: 'Ekonomi' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Polymarket Dashboard</h1>
        <p className="text-gray-500 text-sm">Canlı market verileri &middot; Trend analizi &middot; MCP + Görsel</p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {categories.map(c => (
          <button
            key={c.slug}
            onClick={() => setCategory(c.slug)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              category === c.slug
                ? 'bg-poly-blue text-white'
                : 'bg-poly-card border border-poly-border text-gray-400 hover:text-white'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500">Yükleniyor...</div>
      ) : error ? (
        <div className="text-center py-20 text-poly-red">{error}</div>
      ) : markets.length === 0 ? (
        <div className="text-center py-20 text-gray-500">Market bulunamadı</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.map(m => (
            <MarketCard
              key={m.id}
              id={m.id}
              question={m.question}
              outcomes={m.outcomes}
              outcomePrices={m.outcomePrices}
              volume24hr={m.volume24hr}
              liquidity={m.liquidityNum ?? m.liquidity}
              endDate={m.endDate}
              image={m.image}
            />
          ))}
        </div>
      )}
    </div>
  );
}
