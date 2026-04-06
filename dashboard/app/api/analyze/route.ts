import { NextResponse } from 'next/server';
import { getSpread, getLiquidity, getMarket, getPriceHistory, formatOdds, formatUsd, timeUntil } from '@/lib/polymarket';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token_id  = searchParams.get('token_id');
  const market_id = searchParams.get('market_id');
  if (!token_id || !market_id) {
    return NextResponse.json({ error: 'token_id ve market_id gerekli' }, { status: 400 });
  }

  try {
    const [spread, liquidity, market, history] = await Promise.all([
      getSpread(token_id),
      getLiquidity(token_id),
      getMarket(market_id).catch(() => null),
      getPriceHistory(token_id, 7).catch(() => []),
    ]);

    let score = 50;
    const signals: string[] = [];
    const warnings: string[] = [];

    if (spread.spreadPct < 0.02)       { score += 15; signals.push('Dar spread'); }
    else if (spread.spreadPct > 0.08)  { score -= 20; warnings.push('Geniş spread'); }

    if (liquidity.total > 50_000)      { score += 10; signals.push(`Güçlü likidite: ${formatUsd(liquidity.total)}`); }
    else if (liquidity.total < 5_000)  { score -= 15; warnings.push('Düşük likidite'); }

    const vol24h = market?.volume24hr ?? 0;
    if (vol24h > 50_000)               { score += 10; signals.push(`Yüksek hacim: ${formatUsd(vol24h)}`); }
    else if (vol24h < 1_000)           { score -= 10; warnings.push('Düşük hacim'); }

    let trend = 'YATAY';
    if (history.length > 1) {
      const first = Number(history[0].p);
      const last  = Number(history[history.length - 1].p);
      const diff  = last - first;
      if (diff > 0.05)      { score += 5; trend = 'YUKARI'; }
      else if (diff < -0.05){ score -= 5; trend = 'AŞAĞI'; }
    }

    score = Math.max(0, Math.min(100, score));
    const decision = score >= 65 ? 'BUY' : score <= 35 ? 'SELL' : 'HOLD';

    return NextResponse.json({
      decision, score, trend, signals, warnings,
      spread: { bid: spread.bid, ask: spread.ask, midpoint: spread.midpoint, spreadPct: spread.spreadPct },
      liquidity: liquidity.total,
      volume24h: vol24h,
      closingIn: market?.endDate ? timeUntil(market.endDate) : null,
      question: market?.question ?? '',
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
