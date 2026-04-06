import { NextResponse } from 'next/server';
import { getMarket } from '@/lib/polymarket';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id parametresi gerekli' }, { status: 400 });
  try {
    const market = await getMarket(id);
    return NextResponse.json(market);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
