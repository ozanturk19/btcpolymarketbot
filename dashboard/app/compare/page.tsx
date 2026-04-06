'use client';

import { useState } from 'react';
import { searchMarkets, getSpread, getLiquidity, getMarket, formatUsdShort } from '@/lib/polymarket';

type Market = {
  id: string;
  question: string;
  clobTokenIds?: string[];
  volume24hr?: number;
};

type CompareResult = {
  label: string;
  token_id: string;
  midpoint: number;
  spreadPct: number;
  liquidity: number;
  volume24h: number;
};

export default function ComparePage() {
  const [search, setSearch]       = useState('');
  const [available, setAvailable] = useState<Market[]>([]);
  const [selected, setSelected]   = useState<Array<{ token_id: string; market_id: string; label: string }>>([]);
  const [results, setResults]     = useState<CompareResult[]>([]);
  const [loading, setLoading]     = useState(false);

  const doSearch = async () => {
    if (!search.trim()) return;
    try {
      const data = await searchMarkets(search, 10);
      setAvailable(data as Market[]);
    } catch { setAvailable([]); }
  };

  const addMarket = (m: Market) => {
    if (selected.length >= 6) return;
    const tokenId = m.clobTokenIds?.[0];
    if (!tokenId) return;
    if (selected.some(s => s.market_id === m.id)) return;
    setSelected(prev => [...prev, { token_id: tokenId, market_id: m.id, label: m.question.slice(0, 60) }]);
  };

  const removeMarket = (idx: number) => {
    setSelected(prev => prev.filter((_, i) => i !== idx));
  };

  const compare = async () => {
    if (selected.length < 2) return;
    setLoading(true);
    try {
      const res = await Promise.all(selected.map(async (s) => {
        const [spr, liq, mkt] = await Promise.all([
          getSpread(s.token_id).catch(() => null),
          getLiquidity(s.token_id).catch(() => null),
          getMarket(s.market_id).catch(() => null),
        ]);
        return {
          label: s.label,
          token_id: s.token_id,
          midpoint: spr?.midpoint ?? 0,
          spreadPct: spr?.spreadPct ?? 0,
          liquidity: liq?.total ?? 0,
          volume24h: mkt?.volume24hr ?? 0,
        };
      }));
      setResults(res);
    } catch { setResults([]); }
    setLoading(false);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-1">Market Karşılaştırma</h1>
      <p className="text-gray-500 text-sm mb-4">2-6 market seç, spread/likidite/hacim karşılaştır.</p>

      <div className="flex gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Market ara ve ekle..."
          className="flex-1 bg-poly-card border border-poly-border rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:border-poly-blue focus:outline-none text-sm"
        />
        <button onClick={doSearch} className="btn-primary text-sm">Ara</button>
      </div>

      {available.length > 0 && (
        <div className="card mb-4 max-h-48 overflow-y-auto">
          {available.map(m => (
            <button
              key={m.id}
              onClick={() => addMarket(m)}
              className="w-full text-left text-sm text-gray-300 hover:text-white hover:bg-white/5 px-3 py-1.5 rounded transition-colors"
            >
              {m.question}
            </button>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {selected.map((s, i) => (
            <span key={s.token_id} className="badge-blue flex items-center gap-1.5 px-3 py-1">
              {s.label.slice(0, 40)}{s.label.length > 40 ? '...' : ''}
              <button onClick={() => removeMarket(i)} className="text-blue-300 hover:text-white ml-1">&times;</button>
            </span>
          ))}
        </div>
      )}

      <button onClick={compare} disabled={selected.length < 2 || loading} className="btn-primary mb-6">
        {loading ? 'Karşılaştırılıyor...' : `Karşılaştır (${selected.length}/6)`}
      </button>

      {results.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-left border-b border-poly-border">
                <th className="pb-2">Market</th>
                <th className="pb-2 text-right">Fiyat</th>
                <th className="pb-2 text-right">Spread</th>
                <th className="pb-2 text-right">Likidite</th>
                <th className="pb-2 text-right">24s Hacim</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const bestSpread = Math.min(...results.map(x => x.spreadPct));
                const bestLiq    = Math.max(...results.map(x => x.liquidity));
                return results.map(r => (
                  <tr key={r.token_id} className="border-b border-poly-border/50">
                    <td className="py-2 text-white max-w-[200px] truncate">{r.label}</td>
                    <td className="py-2 text-right font-mono">{(r.midpoint * 100).toFixed(1)}¢</td>
                    <td className={`py-2 text-right font-mono ${r.spreadPct === bestSpread ? 'text-poly-green' : ''}`}>
                      {(r.spreadPct * 100).toFixed(2)}%
                    </td>
                    <td className={`py-2 text-right ${r.liquidity === bestLiq ? 'text-poly-green' : ''}`}>
                      {formatUsdShort(r.liquidity)}
                    </td>
                    <td className="py-2 text-right">{formatUsdShort(r.volume24h)}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
