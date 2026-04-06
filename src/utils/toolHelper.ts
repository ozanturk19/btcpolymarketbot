import { z } from 'zod';

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<unknown>;
  requiresFullMode?: boolean;
};

/** MCP içeriğini JSON string olarak formatla */
export function formatResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Hata mesajını standart formata çevir */
export function formatError(error: unknown): string {
  if (error instanceof Error) return `Hata: ${error.message}`;
  return `Hata: ${String(error)}`;
}

/** Fiyatı yüzde olarak göster (0.45 → %45) */
export function formatOdds(price: number): string {
  return `${(price * 100).toFixed(1)}%`;
}

/** USD formatı */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/** Unix timestamp → ISO string */
export function tsToIso(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

/** Bitiş tarihine kalan süre (insan okunabilir) */
export function timeUntil(endDate: string): string {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff < 0) return 'Sona erdi';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `${d}g ${h}s`;
  if (h > 0) return `${h}s ${m}dk`;
  return `${m}dk`;
}
