import { NextResponse } from 'next/server';
import { getOrderbook } from '@/lib/polymarket';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token_id = searchParams.get('token_id');
  if (!token_id) return NextResponse.json({ error: 'token_id gerekli' }, { status: 400 });
  try {
    const book = await getOrderbook(token_id);
    return NextResponse.json(book);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
