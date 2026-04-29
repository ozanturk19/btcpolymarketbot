#!/usr/bin/env node
/**
 * auto_redeem.js — Tam otomatik wallet temizliği
 *
 * Her çalışmada:
 *  1. Polymarket API'dan on-chain bakiyesi > 0 olan tüm pozisyonları tarar
 *  2. resolved (payoutDenominator > 0) olanları NegRiskAdapter veya CTF+wcol ile redeem eder
 *  3. weather_no_trades.json'daki settled_pending'leri günceller
 *  4. Özet log basar
 *
 * Cron: 20 11 * * *  (günlük 11:20 UTC)
 *       20 23 * * *  (günlük 23:20 UTC — gece yarısı kapanacak pazarlar için)
 */

const path = require('path');
const fs   = require('fs');
const e    = require(path.join(__dirname, 'node_modules/ethers'));
const https = require('https');
require(path.join(__dirname, 'node_modules/dotenv')).config({ path: '/root/.polymarket_secrets' });

const NR_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CTF        = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDCE      = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
const WCOL       = '0x3A3BD7bb9528E159577F7C2e685CC81A765002E2';
const TRADES_PATH = path.join(__dirname, 'data/weather_no_trades.json');

const CTF_ABI = [
  'function redeemPositions(address,bytes32,bytes32,uint256[]) external',
  'function payoutDenominator(bytes32) view returns (uint256)',
  'function payoutNumerators(bytes32,uint256) view returns (uint256)',
  'function isApprovedForAll(address,address) view returns (bool)',
  'function setApprovalForAll(address,bool) external',
  'function getCollectionId(bytes32,bytes32,uint256) view returns (bytes32)',
  'function getPositionId(address,bytes32) view returns (uint256)',
  'function balanceOf(address,uint256) view returns (uint256)',
];
const NR_ABI   = ['function redeemPositions(bytes32,uint256[]) external'];
const WCOL_ABI = ['function balanceOf(address) view returns (uint256)', 'function unwrap(address,uint256) external'];
const ERC20    = ['function balanceOf(address) view returns (uint256)'];

const RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.drpc.org',
  'https://rpc-mainnet.matic.quiknode.pro',
];

const log = (...args) => console.log(new Date().toISOString().slice(0,19).replace('T',' '), '|', ...args);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers:{'User-Agent':'Mozilla/5.0'}}, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(err){reject(err)}});
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  log('=== AUTO REDEEM başlıyor ===');

  // RPC bağlantısı
  let provider, wallet, ctf, nr, wcolC, usdcC;
  for (const rpc of RPCS) {
    try {
      const p = new e.providers.StaticJsonRpcProvider(rpc);
      await Promise.race([p.getBlockNumber(), new Promise((_,r)=>setTimeout(()=>r(new Error('to')),8000))]);
      provider = p;
      wallet   = new e.Wallet(process.env.PRIVATE_KEY, p);
      ctf      = new e.Contract(CTF,  CTF_ABI,  wallet);
      nr       = new e.Contract(NR_ADAPTER, NR_ABI, wallet);
      wcolC    = new e.Contract(WCOL, WCOL_ABI, wallet);
      usdcC    = new e.Contract(USDCE, ERC20,   provider);
      log('RPC:', rpc);
      break;
    } catch(err) { log('RPC fail:', rpc); }
  }
  if (!provider) { log('❌ Tüm RPC\'ler başarısız'); process.exit(1); }

  const addr = wallet.address;
  const usdcBefore = await usdcC.balanceOf(addr);
  log('Wallet:', addr, '| USDC başlangıç:', (Number(usdcBefore)/1e6).toFixed(4));

  // setApprovalForAll kontrolü
  if (!(await ctf.isApprovedForAll(addr, NR_ADAPTER))) {
    log('setApprovalForAll...');
    await (await ctf.setApprovalForAll(NR_ADAPTER, true, {gasLimit:100000})).wait();
  }

  // Tüm pozisyonları API'dan al
  log('Pozisyonlar sorgulanıyor...');
  const positions = await fetchJson('https://data-api.polymarket.com/positions?user=' + addr + '&sizeThreshold=0.001');

  // conditionId bazında grupla (YES ve NO aynı conditionId'yi paylaşır)
  const byCondId = {};
  for (const pos of positions) {
    if (!pos.conditionId) continue;
    const c = pos.conditionId;
    if (!byCondId[c]) byCondId[c] = { condId: c, yes: 0, no: 0 };
    if (pos.outcome === 'Yes') byCondId[c].yes = pos.size;
    else                       byCondId[c].no  = pos.size;
  }
  const groups = Object.values(byCondId);
  log('Toplam kondisyon:', groups.length);

  let redeemCount = 0, skipCount = 0, totalTokens = 0;

  for (const g of groups) {
    // payoutDenominator kontrolü
    const denom = await ctf.payoutDenominator(g.condId);
    if (denom.isZero()) { skipCount++; continue; }

    // On-chain wcol-based bakiyeleri al
    let yesAmt = e.BigNumber.from(0), noAmt = e.BigNumber.from(0);
    if (g.yes > 0) {
      const colId = await ctf.getCollectionId(e.constants.HashZero, g.condId, 1);
      const posId = await ctf.getPositionId(WCOL, colId);
      yesAmt = await ctf.balanceOf(addr, posId);
    }
    if (g.no > 0) {
      const colId = await ctf.getCollectionId(e.constants.HashZero, g.condId, 2);
      const posId = await ctf.getPositionId(WCOL, colId);
      noAmt = await ctf.balanceOf(addr, posId);
    }

    if (yesAmt.isZero() && noAmt.isZero()) continue; // Zaten redeem edilmiş

    const totalAmt = (Number(yesAmt) + Number(noAmt)) / 1e6;
    log('Redeem:', g.condId.slice(0,16)+'... | YES:' + (Number(yesAmt)/1e6).toFixed(3) + ' NO:' + (Number(noAmt)/1e6).toFixed(3));

    let ok = false;

    // 1. NegRiskAdapter.redeemPositions dene
    try {
      const tx = await nr.redeemPositions(g.condId, [yesAmt, noAmt], {
        maxFeePerGas:         e.BigNumber.from('200000000000'),
        maxPriorityFeePerGas: e.BigNumber.from('30000000000'),
        gasLimit: 300000,
      });
      await tx.wait();
      log('  ✅ NegRiskAdapter OK | tx:', tx.hash.slice(0,16)+'...');
      ok = true;
    } catch(err1) {
      // 2. Fallback: CTF direkt (indexSet 1 veya 2) + wcol unwrap
      const indexSet = yesAmt.gt(0) ? 1 : 2;
      const tokenAmt = yesAmt.gt(0) ? yesAmt : noAmt;
      try {
        const tx2 = await ctf.redeemPositions(WCOL, e.constants.HashZero, g.condId, [indexSet], {
          maxFeePerGas:         e.BigNumber.from('200000000000'),
          maxPriorityFeePerGas: e.BigNumber.from('30000000000'),
          gasLimit: 250000,
        });
        await tx2.wait();
        // wcol unwrap
        const wBal = await wcolC.balanceOf(addr);
        if (wBal.gt(0)) {
          const tx3 = await wcolC.unwrap(addr, wBal, {gasLimit:100000, maxFeePerGas: e.BigNumber.from('200000000000'), maxPriorityFeePerGas: e.BigNumber.from('30000000000')});
          await tx3.wait();
        }
        log('  ✅ CTF+wcol fallback OK | tx:', tx2.hash.slice(0,16)+'...');
        ok = true;
      } catch(err2) {
        log('  ❌ Hata:', err2.message.slice(0,80));
      }
    }

    if (ok) {
      redeemCount++;
      totalTokens += totalAmt;

      // weather_no_trades.json güncelle
      if (fs.existsSync(TRADES_PATH)) {
        const trades = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf8'));
        let updated = false;
        for (const t of trades) {
          if ((t.status === 'settled_pending' || (t.status === 'filled' && (t.notes ?? '').includes('min_size_stuck'))) && t.condition_id) {
            const tCondHex = e.utils.hexZeroPad(e.BigNumber.from(t.condition_id).toHexString(), 32);
            if (tCondHex.toLowerCase() === g.condId.toLowerCase()) {
              t.status = 'settled';
              updated = true;
              log('  trades.json güncellendi:', t.station, t.bucket, t.date);
            }
          }
        }
        if (updated) fs.writeFileSync(TRADES_PATH, JSON.stringify(trades, null, 2));
      }
    }

    await sleep(2000);
  }

  // wcol artık varsa unwrap et
  const wcolFinal = await wcolC.balanceOf(addr);
  if (wcolFinal.gt(0)) {
    log('Kalan wcol unwrap:', (Number(wcolFinal)/1e6).toFixed(4));
    await (await wcolC.unwrap(addr, wcolFinal, {gasLimit:100000, maxFeePerGas: e.BigNumber.from('200000000000'), maxPriorityFeePerGas: e.BigNumber.from('30000000000')})).wait();
  }

  const usdcAfter  = await usdcC.balanceOf(addr);
  const usdcGained = (Number(usdcAfter) - Number(usdcBefore)) / 1e6;

  log('=== TAMAMLANDI ===');
  log('Redeem:', redeemCount, '| Atlandı (henüz settle olmadı):', skipCount);
  log('Toplam token redeem:', totalTokens.toFixed(4));
  log('USDC kazanıldı: +$' + usdcGained.toFixed(4));
  log('Güncel USDC:', (Number(usdcAfter)/1e6).toFixed(4));

  provider.removeAllListeners();
}

main().catch(err => { log('FATAL:', err.message); process.exit(1); });
