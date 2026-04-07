import { NextRequest, NextResponse } from 'next/server';

const GAMMA = 'https://gamma-api.polymarket.com';

function tryParse(v: unknown) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const res = await fetch(`${GAMMA}/markets/${encodeURIComponent(params.id)}`, {
      next: { revalidate: 15 },
    });
    if (!res.ok) return NextResponse.json({ error: `Gamma API error: ${res.status}` }, { status: res.status });
    const m = await res.json();
    return NextResponse.json({
      ...m,
      outcomes: tryParse(m.outcomes),
      outcomePrices: tryParse(m.outcomePrices),
      clobTokenIds: tryParse(m.clobTokenIds),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
