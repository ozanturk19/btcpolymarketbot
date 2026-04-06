'use client';

interface Level {
  price: string;
  size: string;
}

interface OrderbookVisualProps {
  bids: Level[];
  asks: Level[];
}

export default function OrderbookVisual({ bids, asks }: OrderbookVisualProps) {
  const maxSize = Math.max(
    ...bids.map(l => Number(l.size)),
    ...asks.map(l => Number(l.size)),
    1
  );

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Orderbook</h3>
      <div className="grid grid-cols-2 gap-4">
        {/* Bid tarafı */}
        <div>
          <div className="text-xs text-gray-500 flex justify-between mb-1">
            <span>Fiyat</span><span>Miktar</span>
          </div>
          {bids.slice(0, 8).map((l, i) => {
            const pct = (Number(l.size) / maxSize) * 100;
            return (
              <div key={i} className="relative flex justify-between text-xs py-0.5">
                <div className="absolute inset-0 bg-poly-green/10 rounded" style={{ width: `${pct}%` }} />
                <span className="relative text-poly-green">{(Number(l.price) * 100).toFixed(1)}¢</span>
                <span className="relative text-gray-400">{Number(l.size).toFixed(0)}</span>
              </div>
            );
          })}
        </div>
        {/* Ask tarafı */}
        <div>
          <div className="text-xs text-gray-500 flex justify-between mb-1">
            <span>Fiyat</span><span>Miktar</span>
          </div>
          {asks.slice(0, 8).map((l, i) => {
            const pct = (Number(l.size) / maxSize) * 100;
            return (
              <div key={i} className="relative flex justify-between text-xs py-0.5">
                <div className="absolute right-0 inset-y-0 bg-poly-red/10 rounded" style={{ width: `${pct}%` }} />
                <span className="relative text-poly-red">{(Number(l.price) * 100).toFixed(1)}¢</span>
                <span className="relative text-gray-400">{Number(l.size).toFixed(0)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
