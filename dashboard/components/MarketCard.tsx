'use client';

import Link from 'next/link';
import { formatUsdShort, timeUntil } from '@/lib/polymarket';

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

export default function MarketCard({ id, question, outcomes, outcomePrices, volume24hr, liquidity, endDate, image }: MarketCardProps) {
  // Gamma API returns outcomes and outcomePrices as JSON strings: "[\"Yes\",\"No\"]"
  function parseJsonField(val: unknown): string[] {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
    }
    return [];
  }
  const parsedOutcomes = parseJsonField(outcomes);
  const prices = parseJsonField(outcomePrices).map(Number);

  return (
    <Link href={`/market/${id}`} className="card hover:border-poly-blue/50 transition-colors block">
      <div className="flex gap-3">
        {image && (
          <img src={image} alt={question} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-white text-sm leading-snug line-clamp-2 mb-3">{question}</h3>

          {parsedOutcomes.length > 0 && (
            <div className="flex gap-2 mb-3">
              {parsedOutcomes.slice(0, 2).map((o, i) => (
                <div key={o} className={`flex-1 text-center py-1.5 rounded-lg text-xs font-semibold ${
                  i === 0 ? 'bg-poly-green/15 text-poly-green' : 'bg-poly-red/15 text-poly-red'
                }`}>
                  {o} <span className="ml-1">{prices[i] !== undefined ? `${(prices[i] * 100).toFixed(0)}¢` : ''}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-gray-500">
            {volume24hr !== undefined && <span>Vol: {formatUsdShort(volume24hr)}</span>}
            {liquidity !== undefined && <span>Liq: {formatUsdShort(liquidity)}</span>}
            {endDate && <span className="ml-auto">{timeUntil(endDate)}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
