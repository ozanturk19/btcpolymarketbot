/**
 * batch_redeem.js - Tüm redeemable pozisyonları toplu redeem eder
 * Polymarket positions API → payoutDenominator check → CTF.redeemPositions
 */
const { Wallet, providers, Contract, constants, BigNumber } = require('./node_modules/ethers');
const https = require('https');
require('./node_modules/dotenv').config({ path: '/root/.polymarket_secrets' });

const USDCE = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CTF   = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

const CTF_ABI = [
  'function redeemPositions(address, bytes32, bytes32, uint256[])',
  'function payoutDenominator(bytes32) view returns (uint256)',
  'function balanceOf(address, uint256) view returns (uint256)',
];

const RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.drpc.org',
  'https://rpc-mainnet.matic.quiknode.pro',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers:{'User-Agent':'Mozilla/5.0'}}, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error('PRIVATE_KEY not set'); process.exit(1); }

  // RPC bağlantısı
  let provider, wallet, ctf;
  for (const rpc of RPCS) {
    try {
      const p = new providers.StaticJsonRpcProvider(rpc);
      await Promise.race([p.getBlockNumber(), new Promise((_,r) => setTimeout(() => r(new Error('timeout')), 8000))]);
      provider = p; wallet = new Wallet(pk, p); ctf = new Contract(CTF, CTF_ABI, wallet);
      console.log('RPC:', rpc);
      break;
    } catch(e) { console.warn('RPC fail:', rpc); }
  }
  if (!provider) { console.error('Tüm RPC\'ler başarısız'); process.exit(1); }

  const addr = wallet.address;
  console.log('Wallet:', addr);

  // Pozisyonları API'dan al
  console.log('\n🔍 Redeemable pozisyonlar alınıyor...');
  const positions = await fetch('https://data-api.polymarket.com/positions?user=' + addr + '&sizeThreshold=0.01');
  const redeemable = positions.filter(p => p.redeemable === true && p.conditionId);

  console.log('Redeemable:', redeemable.length, 'pozisyon\n');

  let success = 0, skip = 0, fail = 0;
  let totalUsdc = 0;

  for (let i = 0; i < redeemable.length; i++) {
    const pos = redeemable[i];
    const condId = pos.conditionId;
    const outcome = pos.outcome; // "Yes" or "No"
    const indexSet = outcome === 'Yes' ? 1 : 2;
    const label = (i+1) + '/' + redeemable.length + ' | ' + outcome + ' | size:' + pos.size + ' | cond:' + condId.slice(0,14) + '...';

    process.stdout.write(label + '\n');

    try {
      // payoutDenominator kontrolü
      const denom = await ctf.payoutDenominator(condId);
      if (denom.eq(0)) {
        console.log('  ⏳ Henüz resolved değil, atlanıyor\n');
        skip++;
        continue;
      }

      // Redeem
      const tx = await ctf.redeemPositions(
        USDCE, constants.HashZero, condId, [indexSet],
        {
          maxFeePerGas:         BigNumber.from('200000000000'),
          maxPriorityFeePerGas: BigNumber.from('30000000000'),
          gasLimit:             250000,
        }
      );
      process.stdout.write('  TX: ' + tx.hash + '\n');
      const receipt = await tx.wait();
      console.log('  ✅ Block:', receipt.blockNumber, '| Gas:', receipt.gasUsed.toString());
      totalUsdc += pos.size;
      success++;
    } catch(e) {
      console.log('  ❌ Hata:', e.message.slice(0, 100));
      fail++;
    }

    await sleep(1500); // Rate limit
    console.log();
  }

  console.log('═══════════════════════════════════');
  console.log('✅ Başarılı:', success, '| ⏳ Atlandı:', skip, '| ❌ Hata:', fail);
  console.log('💰 Tahmini USDC:', totalUsdc.toFixed(3));
  console.log('═══════════════════════════════════');

  provider.removeAllListeners();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
