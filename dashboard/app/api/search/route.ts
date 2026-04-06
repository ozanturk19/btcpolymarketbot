import { NextResponse } from 'next/server';
import { searchMarkets } from '@/lib/polymarket';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q     = searchParams.get('q') ?? '';
  const limit = Number(searchParams.get('limit') ?? 20);
  if (!q) return NextResponse.json({ error: 'q parametresi gerekli' }, { status: 400 });
  try {
    const markets = await searchMarkets(q, limit);
    return NextResponse.json(markets);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
