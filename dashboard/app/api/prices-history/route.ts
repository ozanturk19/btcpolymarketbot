import { NextRequest, NextResponse } from 'next/server';

const CLOB = 'https://clob.polymarket.com';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams.toString();
  if (!req.nextUrl.searchParams.get('market')) {
    return NextResponse.json({ error: 'market param required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${CLOB}/prices-history?${params}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return NextResponse.json({ error: `CLOB API error: ${res.status}` }, { status: res.status });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
