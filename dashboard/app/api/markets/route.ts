import { NextRequest, NextResponse } from 'next/server';

const GAMMA = 'https://gamma-api.polymarket.com';

// Gamma API outcomes/outcomePrices/clobTokenIds alanlarını JSON string döndürüyor, parse et
function parseMarket(m: Record<string, unknown>) {
  const tryParse = (v: unknown) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
    return v;
  };
  return { ...m, outcomes: tryParse(m.outcomes), outcomePrices: tryParse(m.outcomePrices), clobTokenIds: tryParse(m.clobTokenIds) };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams.toString();
  const url = `${GAMMA}/markets${params ? `?${params}` : ''}`;

  try {
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (!res.ok) return NextResponse.json({ error: `Gamma API error: ${res.status}` }, { status: res.status });
    const data = await res.json();
    const parsed = Array.isArray(data)
      ? data.filter(m => m.closed !== true && m.archived !== true).map(parseMarket)
      : data;
    return NextResponse.json(parsed);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
