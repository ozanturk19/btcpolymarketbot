import { NextResponse } from 'next/server';
import { getSpread, getLiquidity, getMarket, formatUsd } from '@/lib/polymarket';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items: Array<{ token_id: string; market_id: string; label: string }> = body.markets ?? [];
    if (items.length < 2) return NextResponse.json({ error: 'En az 2 market gerekli' }, { status: 400 });

    const results = await Promise.all(items.map(async (m) => {
      const [spread, liq, mkt] = await Promise.all([
        getSpread(m.token_id).catch(() => null),
        getLiquidity(m.token_id).catch(() => null),
        getMarket(m.market_id).catch(() => null),
      ]);
      return {
        label: m.label,
        token_id: m.token_id,
        midpoint: spread?.midpoint ?? 0,
        spreadPct: spread?.spreadPct ?? 0,
        liquidity: liq?.total ?? 0,
        volume24h: mkt?.volume24hr ?? 0,
      };
    }));

    return NextResponse.json({ comparison: results });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
