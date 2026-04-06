'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface PriceChartProps {
  data: Array<{ t: number; p: string }>;
}

export default function PriceChart({ data }: PriceChartProps) {
  if (!data || data.length === 0) {
    return <div className="card text-gray-500 text-sm text-center py-8">Fiyat geçmişi bulunamadı</div>;
  }

  const chartData = data.map(d => ({
    time: new Date(d.t * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }),
    price: Number(d.p) * 100,
    raw: Number(d.p),
  }));

  const prices = chartData.map(d => d.price);
  const min = Math.floor(Math.min(...prices) - 2);
  const max = Math.ceil(Math.max(...prices) + 2);
  const isUp = chartData[chartData.length - 1].price >= chartData[0].price;

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Fiyat Geçmişi</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
          <YAxis domain={[min, max]} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} tickFormatter={v => `${v}¢`} />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: number) => [`${v.toFixed(1)}¢`, 'Fiyat']}
          />
          <Line type="monotone" dataKey="price" stroke={isUp ? '#00C853' : '#FF1744'} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
