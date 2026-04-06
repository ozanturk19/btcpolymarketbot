'use client';

interface AnalysisBadgeProps {
  decision: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  signals: string[];
  warnings: string[];
}

export default function AnalysisBadge({ decision, score, signals, warnings }: AnalysisBadgeProps) {
  const colors = {
    BUY:  { bg: 'bg-poly-green/20', text: 'text-poly-green', border: 'border-poly-green/30' },
    SELL: { bg: 'bg-poly-red/20',   text: 'text-poly-red',   border: 'border-poly-red/30' },
    HOLD: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  };
  const c = colors[decision];

  return (
    <div className={`card border ${c.border}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`${c.bg} ${c.text} text-lg font-bold px-4 py-1.5 rounded-lg`}>
          {decision}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white">{score}</div>
          <div className="text-xs text-gray-500">/ 100 güven</div>
        </div>
      </div>

      {signals.length > 0 && (
        <div className="mb-2">
          {signals.map(s => (
            <div key={s} className="text-xs text-poly-green flex items-center gap-1.5 py-0.5">
              <span>+</span>{s}
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div>
          {warnings.map(w => (
            <div key={w} className="text-xs text-poly-red flex items-center gap-1.5 py-0.5">
              <span>!</span>{w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
