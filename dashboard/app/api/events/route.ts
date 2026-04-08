import { NextRequest, NextResponse } from 'next/server';

const GAMMA = 'https://gamma-api.polymarket.com';

// Event içindeki market verilerini normalize et
function parseMarket(m: Record<string, unknown>, eventImage?: string) {
  const tryParse = (v: unknown) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
    return v;
  };
  return {
    ...m,
    outcomes: tryParse(m.outcomes),
    outcomePrices: tryParse(m.outcomePrices),
    clobTokenIds: tryParse(m.clobTokenIds),
    // Event'ten image al (market'in kendi image'ı yoksa)
    image: m.image || eventImage,
  };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams.toString();
  const url = `${GAMMA}/events${params ? `?${params}` : ''}`;

  try {
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (!res.ok) return NextResponse.json({ error: `Gamma API error: ${res.status}` }, { status: res.status });
    const events = await res.json();
    const list = Array.isArray(events) ? events : events?.data ?? [];

    // Her event'ten marketleri düzleştir, event meta verisini market'e aktar
    const markets = list.flatMap((event: Record<string, unknown>) => {
      const eventMarkets = (event.markets as Record<string, unknown>[]) ?? [];
      return eventMarkets.map(m => parseMarket({
        ...m,
        // Event-level alanları eksik olanlara aktar
        liquidityNum: m.liquidityNum ?? event.liquidityClob ?? event.liquidity,
        volume24hr: m.volume24hr ?? event.volume24hr,
        eventTitle: event.title,
        eventSlug: event.slug,
      }, event.image as string || event.icon as string));
    });

    // Volume'a göre sırala
    markets.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      (Number(b.volume24hr) || 0) - (Number(a.volume24hr) || 0)
    );

    return NextResponse.json(markets);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
