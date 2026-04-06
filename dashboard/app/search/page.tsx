'use client';

import { useState } from 'react';
import MarketCard from '@/components/MarketCard';
import { searchMarkets } from '@/lib/polymarket';

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

export default function SearchPage() {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<Market[]>([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      const data = await searchMarkets(query, 20);
      setResults(data as Market[]);
    } catch (e) {
      setError((e as Error).message);
      setResults([]);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-4">Market Ara</h1>

      <div className="flex gap-2 mb-6">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder='Örn: "Bitcoin ETF", "Fed faiz", "Dünya Kupası"'
          className="flex-1 bg-poly-card border border-poly-border rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:border-poly-blue focus:outline-none"
        />
        <button onClick={handleSearch} className="btn-primary" disabled={loading}>
          {loading ? '...' : 'Ara'}
        </button>
      </div>

      {error && <div className="text-center py-6 text-poly-red text-sm">{error}</div>}
      {loading && <div className="text-center py-10 text-gray-500">Aranıyor...</div>}
      {!loading && !error && searched && results.length === 0 && (
        <div className="text-center py-10 text-gray-500">Sonuç bulunamadı</div>
      )}
      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {results.map(m => (
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
