'use client';

import Link from 'next/link';

interface MarketCardProps {
  id: string;
  question: string;
  outcomes?: string[];
  outcomePrices?: string[];
  volume24hr?: number;
  liquidity?: number;
  endDate?: string;
  image?: string;
}

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

export default function MarketCard({ id, question, outcomes, outcomePrices, volume24hr, liquidity, endDate, image }: MarketCardProps) {
  const prices = (outcomePrices ?? []).map(Number);

  return (
    <Link href={`/market/${id}`} className="card hover:border-poly-blue/50 transition-colors block">
      <div className="flex gap-3">
        {image && (
          <img src={image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-white text-sm leading-snug line-clamp-2 mb-3">{question}</h3>

          {outcomes && outcomes.length > 0 && (
            <div className="flex gap-2 mb-3">
              {outcomes.slice(0, 2).map((o, i) => (
                <div key={o} className={`flex-1 text-center py-1.5 rounded-lg text-xs font-semibold ${
                  i === 0 ? 'bg-poly-green/15 text-poly-green' : 'bg-poly-red/15 text-poly-red'
                }`}>
                  {o} <span className="ml-1">{prices[i] !== undefined ? `${(prices[i] * 100).toFixed(0)}¢` : ''}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-gray-500">
            {volume24hr !== undefined && <span>Vol: {formatUsd(volume24hr)}</span>}
            {liquidity !== undefined && <span>Liq: {formatUsd(liquidity)}</span>}
            {endDate && <span className="ml-auto">{timeUntil(endDate)}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
