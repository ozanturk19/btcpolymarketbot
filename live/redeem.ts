/**
 * live/redeem.ts — Otomatik WIN token redemption
 *
 * resolveScalpLive() WIN kaydettikten hemen sonra çağrılır.
 * DB'de outcome='WIN' ve redeemed=0 olan tüm tradeleri bulur,
 * Polymarket positions API'den conditionId alır, on-chain redeem eder.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Wallet, providers, Contract, constants, BigNumber } =
  require('/opt/polymarket/bot/node_modules/ethers');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('/opt/polymarket/bot/node_modules/dotenv');
dotenv.config({ path: '/root/.polymarket_secrets' });

import type { Db } from '../db/schema';

const USDCE  = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CTF    = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const WALLET = '0x3dab2643f5A1587bBf8EFcD66E0477F4B78E43bF';

const CTF_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
];

const RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.drpc.org',
  'https://rpc-mainnet.matic.quiknode.pro',
];

const RPC_TIMEOUT_MS = 15_000;  // her RPC call için 15s timeout

/** Positions API'den tokenId → conditionId haritası */
async function fetchConditionMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/positions?user=${WALLET}&sizeThreshold=0.001`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return map;
    const list = await res.json() as any[];
    for (const p of list) {
      if (p.asset && p.conditionId) map.set(String(p.asset), String(p.conditionId));
    }
  } catch { /* API ulaşılamazsa boş döner */ }
  return map;
}

/** Promise'i timeout ile wrap et */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * DB'deki redemsiz WIN tokenları Polygon üzerinde redeem eder.
 * Her redeem sonrası DB'de redeemed=1 günceller.
 *
 * KRİTİK: StaticJsonRpcProvider kullan (polling yok → memory leak yok).
 * JsonRpcProvider her instance'ta 4s polling timer başlatır ve GC edilmez.
 */
export async function autoRedeemWins(db: Db): Promise<void> {
  let pending: { id: number; side: string; token_id: string }[];
  try {
    pending = db.prepare(`
      SELECT id, side, token_id
      FROM live_trades
      WHERE outcome='WIN' AND exit_reason LIKE 'settlement%' AND redeemed=0
    `).all() as { id: number; side: string; token_id: string }[];
  } catch { return; }

  if (!pending.length) return;

  console.log(`[redeem] ${pending.length} redemsiz WIN token bulundu`);

  const condMap = await fetchConditionMap();

  for (const t of pending) {
    const conditionId = condMap.get(t.token_id);
    if (!conditionId) {
      console.log(`[redeem] T${t.id} positions API'de yok → redeemed=1 (zaten işlendi)`);
      db.prepare(`UPDATE live_trades SET redeemed=1 WHERE id=?`).run(t.id);
      continue;
    }

    const indexSet = t.side === 'UP' ? 1 : 2;
    let redeemed   = false;

    for (const rpc of RPCS) {
      // StaticJsonRpcProvider: polling timer BAŞLATMAZ → memory leak yok
      const provider = new providers.StaticJsonRpcProvider(rpc);
      try {
        const denom = await withTimeout(
          ctf_call(provider, conditionId),
          RPC_TIMEOUT_MS,
          `payoutDenominator ${rpc}`
        );
        if (denom === 0) {
          console.log(`[redeem] T${t.id} market henüz çözülmedi, atlanıyor`);
          provider.removeAllListeners();
          break;
        }

        const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
        const ctf    = new Contract(CTF, CTF_ABI, wallet);

        const tx: any = await withTimeout(
          ctf.redeemPositions(
            USDCE,
            constants.HashZero,
            conditionId,
            [indexSet],
            {
              maxFeePerGas:         BigNumber.from('200000000000'),
              maxPriorityFeePerGas: BigNumber.from('30000000000'),
              gasLimit:             150000,
            },
          ),
          RPC_TIMEOUT_MS,
          `redeemPositions ${rpc}`
        );
        console.log(`[redeem] T${t.id} TX: ${tx.hash}`);

        await withTimeout(tx.wait(), 60_000, `tx.wait ${tx.hash.slice(0,10)}`);
        db.prepare(`UPDATE live_trades SET redeemed=1 WHERE id=?`).run(t.id);
        console.log(`[redeem] ✅ T${t.id} ${t.side} redeem tamamlandı`);
        redeemed = true;
        provider.removeAllListeners();
        break;

      } catch (err: any) {
        console.warn(`[redeem] T${t.id} RPC ${rpc} hatası: ${err.message}`);
        provider.removeAllListeners();
      }
    }

    if (!redeemed) {
      console.error(`[redeem] ❌ T${t.id} TÜM RPC'LER BAŞARISIZ — sonraki döngüde tekrar denenecek`);
    }
  }
}

/** payoutDenominator one-shot çağrısı (wallet gerekmez) */
async function ctf_call(provider: any, conditionId: string): Promise<number> {
  const ctf = new Contract(CTF, CTF_ABI, provider);
  const denom = await ctf.payoutDenominator(conditionId);
  return denom.toNumber();
}
