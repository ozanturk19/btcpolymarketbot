import { NextResponse } from 'next/server';
import { getTrendingMarkets } from '@/lib/polymarket';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get('limit') ?? 20);
  try {
    const markets = await getTrendingMarkets(limit);
    return NextResponse.json(markets);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
