/**
 * live/client.ts — Polymarket CLOB client singleton
 */
import { ClobClient, AssetType } from '@polymarket/clob-client';
import { Wallet }                from '@ethersproject/wallet';
import * as dotenv               from 'dotenv';
import * as path                 from 'path';

dotenv.config({ path: '/root/.polymarket_secrets' });

const HOST     = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

let _client: ClobClient | null = null;
let _initError: string | null  = null;
let _initialized               = false;

export async function initClobClient(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  try {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) throw new Error('PRIVATE_KEY .env dosyasında bulunamadı');

    const wallet = new Wallet(pk);
    console.log(`[live/client] Cüzdan: ${wallet.address}`);

    // API key türet — off-chain EIP-712, GAS YOK
    const tmp   = new ClobClient(HOST, CHAIN_ID, wallet);
    const creds = await tmp.createOrDeriveApiKey();
    console.log(`[live/client] ✅ API key: ${creds.key.slice(0, 8)}...`);

    // Tam client: signatureType=0 (EOA), funder=kendi adresimiz
    _client = new ClobClient(HOST, CHAIN_ID, wallet, creds, 0, wallet.address);

    // Bağlantı testi
    const bal = await _client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const _rawBal = parseFloat((bal as any).balance ?? '0'); console.log(`[live/client] ✅ CLOB bağlantısı OK | balance=${(_rawBal/1e6).toFixed(4)} USDC.e`);

  } catch (e: any) {
    _initError = e.message;
    console.error(`[live/client] ❌ INIT HATASI: ${e.message}`);
    console.error(`[live/client] ⚠️  Live trading devre dışı`);
  }
}

export async function getClobClient(): Promise<ClobClient> {
  if (_initError) throw new Error(`CLOB init başarısız: ${_initError}`);
  if (!_client) {
    await initClobClient();
    if (!_client) throw new Error('CLOB client başlatılamadı');
  }
  return _client;
}

export function isClobReady(): boolean {
  return _client !== null && _initError === null;
}
