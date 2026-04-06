import { z } from 'zod';
import { ClobClient } from '../api/clob';
import { GammaClient } from '../api/gamma';
import { registerTool } from '../server';
import { formatOdds, formatUsd, timeUntil } from '../utils/toolHelper';

const clob  = new ClobClient();
const gamma = new GammaClient();

// ─── analyze_market_opportunity ──────────────────────────────────────────────
registerTool({
  name: 'analyze_market_opportunity',
  description: 'Bir market için BUY/SELL/HOLD kararı ve güven skoru üret. Spread, likidite, volume ve fiyat geçmişini birleştirir.',
  inputSchema: z.object({
    token_id:      z.string().describe('CLOB token ID\'si'),
    condition_id:  z.string().describe('Market condition ID\'si'),
    market_id:     z.string().describe('Gamma market ID\'si'),
  }),
  async handler({ token_id, condition_id, market_id }: {
    token_id: string; condition_id: string; market_id: string;
  }) {
    // Paralel veri çekimi
    const [spread, liquidity, market, history] = await Promise.all([
      clob.getSpread(token_id),
      clob.getLiquidity(token_id),
      gamma.getMarket(market_id).catch(() => null),
      clob.getPriceHistory(token_id, Math.floor(Date.now() / 1000) - 7 * 86_400).catch(() => []),
    ]);

    // ── Skor Hesaplama (0-100) ──
    let score = 50;
    const signals: string[] = [];
    const warnings: string[] = [];

    // 1. Spread analizi (dar = iyi)
    if (spread.spreadPct < 0.02) {
      score += 15;
      signals.push('Dar spread: yüksek likidite kalitesi');
    } else if (spread.spreadPct > 0.08) {
      score -= 20;
      warnings.push(`Geniş spread (%${(spread.spreadPct * 100).toFixed(1)}): işlem maliyeti yüksek`);
    }

    // 2. Likidite kontrolü
    if (liquidity.total_liquidity > 50_000) {
      score += 10;
      signals.push(`Güçlü likidite: ${formatUsd(liquidity.total_liquidity)}`);
    } else if (liquidity.total_liquidity < 5_000) {
      score -= 15;
      warnings.push(`Düşük likidite: ${formatUsd(liquidity.total_liquidity)} - kayma riski`);
    }

    // 3. Volume analizi (24h)
    const vol24h = market?.volume24hr ?? 0;
    if (vol24h > 50_000) {
      score += 10;
      signals.push(`Yüksek 24s hacim: ${formatUsd(vol24h)}`);
    } else if (vol24h < 1_000) {
      score -= 10;
      warnings.push('Çok düşük 24s hacim: market inaktif olabilir');
    }

    // 4. Fiyat trendi (7 günlük)
    let trend = 'YATAY';
    let priceChange = 0;
    if (history.length > 1) {
      const first = Number(history[0].p);
      const last  = Number(history[history.length - 1].p);
      priceChange = last - first;
      if (priceChange > 0.05)       { score += 5; trend = 'YUKARI'; signals.push('7g yukarı trend'); }
      else if (priceChange < -0.05) { score -= 5; trend = 'AŞAĞI';  signals.push('7g aşağı trend'); }
    }

    // 5. Kapanış süresi
    const closingIn = market?.endDate ? timeUntil(market.endDate) : 'Bilinmiyor';
    if (market?.endDate) {
      const daysLeft = (new Date(market.endDate).getTime() - Date.now()) / 86_400_000;
      if (daysLeft < 1) { score -= 10; warnings.push('24s içinde kapanıyor: likidite azalabilir'); }
    }

    // ── Karar ──
    score = Math.max(0, Math.min(100, score));
    let decision: 'BUY' | 'SELL' | 'HOLD';
    if (score >= 65)      decision = 'BUY';
    else if (score <= 35) decision = 'SELL';
    else                  decision = 'HOLD';

    return {
      token_id,
      market:    market?.question ?? condition_id,
      decision,
      confidence:  score,
      confidenceLabel: score >= 70 ? 'Yüksek' : score >= 50 ? 'Orta' : 'Düşük',
      currentPrice: {
        bid:      formatOdds(spread.bid),
        ask:      formatOdds(spread.ask),
        midpoint: formatOdds(spread.midpoint),
      },
      metrics: {
        spread:       `${(spread.spreadPct * 100).toFixed(2)}%`,
        liquidity:    formatUsd(liquidity.total_liquidity),
        volume24h:    formatUsd(vol24h),
        trend7d:      trend,
        priceChange7d: `${(priceChange * 100).toFixed(1)}pp`,
        closingIn,
      },
      signals,
      warnings,
      summary: `${decision} kararı (güven: ${score}/100). ${signals.length} pozitif, ${warnings.length} negatif sinyal.`,
    };
  },
});

// ─── compare_markets ─────────────────────────────────────────────────────────
registerTool({
  name: 'compare_markets',
  description: 'Birden fazla marketi yan yana karşılaştır: spread, likidite, hacim, fiyat. Hangi market daha cazip?',
  inputSchema: z.object({
    markets: z.array(z.object({
      token_id:  z.string().describe('CLOB token ID\'si'),
      market_id: z.string().describe('Gamma market ID\'si'),
      label:     z.string().describe('İnsan okunabilir etiket (ör: "Trump kazanır")'),
    })).min(2).max(6).describe('Karşılaştırılacak marketler (2-6 arası)'),
  }),
  async handler({ markets }: { markets: Array<{ token_id: string; market_id: string; label: string }> }) {
    const results = await Promise.all(
      markets.map(async (m) => {
        const [spread, liquidity, marketData] = await Promise.all([
          clob.getSpread(m.token_id).catch(() => null),
          clob.getLiquidity(m.token_id).catch(() => null),
          gamma.getMarket(m.market_id).catch(() => null),
        ]);

        return {
          label:      m.label,
          token_id:   m.token_id,
          price:      spread ? formatOdds(spread.midpoint) : 'N/A',
          spread:     spread ? `${(spread.spreadPct * 100).toFixed(2)}%` : 'N/A',
          liquidity:  liquidity ? formatUsd(liquidity.total_liquidity) : 'N/A',
          volume24h:  marketData ? formatUsd(marketData.volume24hr ?? 0) : 'N/A',
          closingIn:  marketData?.endDate ? timeUntil(marketData.endDate) : 'N/A',
          raw: {
            spreadPct:        spread?.spreadPct ?? 99,
            totalLiquidity:   liquidity?.total_liquidity ?? 0,
            volume24h:        marketData?.volume24hr ?? 0,
            midpoint:         spread?.midpoint ?? 0,
          },
        };
      })
    );

    // En iyi likidite / en dar spread
    const bestLiquidity = results.reduce((best, r) => r.raw.totalLiquidity > best.raw.totalLiquidity ? r : best);
    const bestSpread    = results.reduce((best, r) => r.raw.spreadPct < best.raw.spreadPct ? r : best);
    const bestVolume    = results.reduce((best, r) => r.raw.volume24h > best.raw.volume24h ? r : best);

    return {
      comparison: results,
      insights: {
        bestLiquidity: `En yüksek likidite: "${bestLiquidity.label}" (${bestLiquidity.liquidity})`,
        tightestSpread: `En dar spread: "${bestSpread.label}" (${bestSpread.spread})`,
        highestVolume:  `En yüksek hacim: "${bestVolume.label}" (${bestVolume.volume24h})`,
      },
    };
  },
});
