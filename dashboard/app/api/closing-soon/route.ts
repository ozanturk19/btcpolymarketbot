import { NextResponse } from 'next/server';
import { getClosingSoon } from '@/lib/polymarket';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hours = Number(searchParams.get('hours') ?? 24);
  const limit = Number(searchParams.get('limit') ?? 20);
  try {
    const markets = await getClosingSoon(hours, limit);
    return NextResponse.json(markets);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
