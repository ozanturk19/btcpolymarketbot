/**
 * approve_ctf.ts — ERC-1155 setApprovalForAll for CTF tokens
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Wallet, providers, Contract } = require('/opt/polymarket/bot/node_modules/ethers');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('/opt/polymarket/bot/node_modules/dotenv');
const path = require('path');

dotenv.config({ path: '/opt/polymarket/bot/.env' });

const CTF_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

const OPERATORS = [
  { name: 'CTF Exchange',     addr: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' },
  { name: 'Neg Risk Exchange', addr: '0xC5d563A36AE78145C45a50134d48A1215220f80a' },
  { name: 'Neg Risk Adapter',  addr: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296' },
];

const ERC1155_ABI = [
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
];

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY bulunamadı');

  const provider = new providers.JsonRpcProvider('https://rpc-mainnet.matic.quiknode.pro');
  const wallet   = new Wallet(pk, provider);
  const ctf      = new Contract(CTF_CONTRACT, ERC1155_ABI, wallet);

  console.log(`Cüzdan: ${wallet.address}`);

  for (const op of OPERATORS) {
    const already = await ctf.isApprovedForAll(wallet.address, op.addr);
    console.log(`\n${op.name}: ${already ? '✅ zaten onaylı' : '❌ onay yok'}`);
    if (already) continue;

    const tx = await ctf.setApprovalForAll(op.addr, true, {
      maxFeePerGas:         BigInt(200e9),
      maxPriorityFeePerGas: BigInt(30e9),
      gasLimit:             80000,
    });
    console.log(`  TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  ✅ Block: ${receipt.blockNumber}`);
  }

  console.log('\n✅ Tamamlandı');
}

main().catch(e => { console.error(e.message); process.exit(1); });
