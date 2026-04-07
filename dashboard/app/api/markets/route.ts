import { NextRequest, NextResponse } from 'next/server';

const GAMMA = 'https://gamma-api.polymarket.com';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams.toString();
  const url = `${GAMMA}/markets${params ? `?${params}` : ''}`;

  try {
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (!res.ok) return NextResponse.json({ error: `Gamma API error: ${res.status}` }, { status: res.status });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
