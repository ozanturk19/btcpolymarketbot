'use client';

import { useEffect, useState } from 'react';
import MarketCard from '@/components/MarketCard';
import { getClosingSoon } from '@/lib/polymarket';

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

export default function ClosingSoonPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [hours, setHours]     = useState(24);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getClosingSoon(hours, 20)
      .then(data => { setMarkets(data as Market[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, [hours]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-1">Yakında Kapanacaklar</h1>
      <p className="text-gray-500 text-sm mb-4">Son dakika odds hareketi genellikle edge barındırır.</p>

      <div className="flex gap-2 mb-6">
        {[6, 12, 24, 48, 72].map(h => (
          <button
            key={h}
            onClick={() => setHours(h)}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              hours === h ? 'bg-poly-blue text-white' : 'bg-poly-card border border-poly-border text-gray-400 hover:text-white'
            }`}
          >
            {h}s
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Yükleniyor...</div>
      ) : markets.length === 0 ? (
        <div className="text-center py-10 text-gray-500">{hours} saat içinde kapanacak market yok</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
