import { NextRequest, NextResponse } from 'next/server';

const CLOB = 'https://clob.polymarket.com';

export async function GET(req: NextRequest) {
  const tokenId = req.nextUrl.searchParams.get('token_id');
  if (!tokenId) return NextResponse.json({ error: 'token_id required' }, { status: 400 });

  try {
    const res = await fetch(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`, {
      next: { revalidate: 5 },
    });
    if (!res.ok) return NextResponse.json({ error: `CLOB API error: ${res.status}` }, { status: res.status });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
