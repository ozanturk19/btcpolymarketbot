/**
 * batch_redeem_v2.js
 * negRisk pozisyonları için DOĞRU redemption:
 * NegRiskAdapter.redeemPositions(condId, [yesAmt, noAmt])
 * wcol (WrappedUSDC) collateral → otomatik unwrap → USDC wallet'a gelir
 */
const { Wallet, providers, Contract, constants, BigNumber, utils } = require('./node_modules/ethers');
const https = require('https');
require('./node_modules/dotenv').config({ path: '/root/.polymarket_secrets' });

const NR_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CTF        = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

const NR_ABI = [
  'function redeemPositions(bytes32 conditionId, uint256[] calldata amounts) external',
  'function wcol() view returns (address)',
];
const CTF_ABI = [
  'function payoutDenominator(bytes32) view returns (uint256)',
  'function isApprovedForAll(address, address) view returns (bool)',
  'function setApprovalForAll(address, bool) external',
  'function getCollectionId(bytes32,bytes32,uint256) view returns (bytes32)',
  'function getPositionId(address,bytes32) view returns (uint256)',
  'function balanceOf(address, uint256) view returns (uint256)',
];

const RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.drpc.org',
  'https://rpc-mainnet.matic.quiknode.pro',
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers:{'User-Agent':'Mozilla/5.0'}}, (res) => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)} });
    }).on('error', reject);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r,ms)); }

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error('PRIVATE_KEY not set'); process.exit(1); }

  let provider, wallet, ctf, nr;
  for (const rpc of RPCS) {
    try {
      const p = new providers.StaticJsonRpcProvider(rpc);
      await Promise.race([p.getBlockNumber(), new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),8000))]);
      provider = p; wallet = new Wallet(pk, p);
      ctf = new Contract(CTF, CTF_ABI, wallet);
      nr  = new Contract(NR_ADAPTER, NR_ABI, wallet);
      console.log('RPC:', rpc);
      break;
    } catch(e) { console.warn('RPC fail:', rpc); }
  }

  const addr = wallet.address;
  const wcol = await nr.wcol();
  console.log('Wallet:', addr);
  console.log('wcol:', wcol);

  // setApprovalForAll — NegRiskAdapter için
  const approved = await ctf.isApprovedForAll(addr, NR_ADAPTER);
  if (!approved) {
    console.log('setApprovalForAll...');
    await (await ctf.setApprovalForAll(NR_ADAPTER, true, {gasLimit:100000})).wait();
    console.log('✅ Approval OK');
  } else {
    console.log('✅ Approval zaten var');
  }

  // API'dan redeemable pozisyonlar
  console.log('\n🔍 Pozisyonlar alınıyor...');
  const positions = await fetch('https://data-api.polymarket.com/positions?user=' + addr + '&sizeThreshold=0.001');
  const redeemable = positions.filter(p => p.redeemable === true && p.conditionId);
  console.log('API redeemable:', redeemable.length);

  // Tekil conditionId'leri grupla (YES ve NO aynı conditionId paylaşabilir)
  const byCondId = {};
  for (const pos of redeemable) {
    const c = pos.conditionId;
    if (!byCondId[c]) byCondId[c] = { yes: 0, no: 0, condId: c };
    if (pos.outcome === 'Yes') byCondId[c].yes = pos.size;
    else byCondId[c].no = pos.size;
  }

  const groups = Object.values(byCondId);
  console.log('Benzersiz condition:', groups.length);

  let success=0, skip=0, fail=0;
  let totalUsdc=0;

  for (let i=0; i<groups.length; i++) {
    const g = groups[i];
    const label = (i+1)+'/'+groups.length+' | YES:'+g.yes+' NO:'+g.no+' | cond:'+g.condId.slice(0,16)+'...';
    console.log('\n' + label);

    try {
      // payoutDenominator kontrolü
      const denom = await ctf.payoutDenominator(g.condId);
      if (denom.isZero()) {
        console.log('  ⏳ Henüz resolved değil');
        skip++; continue;
      }

      // On-chain gerçek bakiyeleri al (wcol-based positionIds)
      let yesAmt = BigNumber.from(0), noAmt = BigNumber.from(0);

      if (g.yes > 0) {
        const colId = await ctf.getCollectionId(constants.HashZero, g.condId, 1);
        const posId = await ctf.getPositionId(wcol, colId);
        yesAmt = await ctf.balanceOf(addr, posId);
        console.log('  YES on-chain:', (Number(yesAmt)/1e6).toFixed(4));
      }
      if (g.no > 0) {
        const colId = await ctf.getCollectionId(constants.HashZero, g.condId, 2);
        const posId = await ctf.getPositionId(wcol, colId);
        noAmt = await ctf.balanceOf(addr, posId);
        console.log('  NO  on-chain:', (Number(noAmt)/1e6).toFixed(4));
      }

      if (yesAmt.isZero() && noAmt.isZero()) {
        console.log('  ⚠️  On-chain bakiye 0, atlanıyor');
        skip++; continue;
      }

      // NegRiskAdapter.redeemPositions(condId, [yesAmt, noAmt])
      const tx = await nr.redeemPositions(
        g.condId,
        [yesAmt, noAmt],
        {
          maxFeePerGas:         BigNumber.from('200000000000'),
          maxPriorityFeePerGas: BigNumber.from('30000000000'),
          gasLimit: 300000,
        }
      );
      process.stdout.write('  TX: ' + tx.hash + '\n');
      const receipt = await tx.wait();
      console.log('  ✅ Block:', receipt.blockNumber);
      totalUsdc += (Number(yesAmt) + Number(noAmt)) / 1e6;
      success++;

    } catch(e) {
      console.log('  ❌ Hata:', e.message.slice(0,120));
      if (e.data) console.log('  data:', e.data);
      fail++;
    }

    await sleep(2000);
  }

  console.log('\n═══════════════════════════════════');
  console.log('✅ Başarılı:', success, '| ⏳ Atlandı:', skip, '| ❌ Hata:', fail);
  console.log('💰 Redeem edilen token:', totalUsdc.toFixed(4));
  console.log('═══════════════════════════════════');

  provider.removeAllListeners();
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
