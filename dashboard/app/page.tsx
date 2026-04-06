'use client';

import { useEffect, useState } from 'react';
import MarketCard from '@/components/MarketCard';

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
  const [trending, setTrending] = useState<Market[]>([]);
  const [category, setCategory] = useState('all');
  const [categoryMarkets, setCategoryMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/trending?limit=12')
      .then(r => r.json())
      .then(d => { setTrending(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (category === 'all') { setCategoryMarkets([]); return; }
    fetch(`/api/markets?category=${category}&limit=12`)
      .then(r => r.json())
      .then(d => setCategoryMarkets(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [category]);

  const categories = [
    { slug: 'all', label: 'Tümü' },
    { slug: 'politics', label: 'Politika' },
    { slug: 'sports', label: 'Spor' },
    { slug: 'crypto', label: 'Kripto' },
    { slug: 'culture', label: 'Kültür' },
    { slug: 'economics', label: 'Ekonomi' },
  ];

  const displayMarkets = category === 'all' ? trending : categoryMarkets;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Polymarket Dashboard</h1>
        <p className="text-gray-500 text-sm">Canlı market verileri &middot; Trend analizi &middot; MCP + Görsel</p>
      </div>

      {/* Kategori filtreleri */}
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

      {/* Market kartları */}
      {loading ? (
        <div className="text-center py-20 text-gray-500">Yükleniyor...</div>
      ) : displayMarkets.length === 0 ? (
        <div className="text-center py-20 text-gray-500">Market bulunamadı</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayMarkets.map(m => (
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
