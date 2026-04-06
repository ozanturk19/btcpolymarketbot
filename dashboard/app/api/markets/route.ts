import { NextResponse } from 'next/server';
import { getMarketsByCategory } from '@/lib/polymarket';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') ?? 'all';
  const limit    = Number(searchParams.get('limit') ?? 20);
  try {
    const markets = await getMarketsByCategory(category, limit);
    return NextResponse.json(markets);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
