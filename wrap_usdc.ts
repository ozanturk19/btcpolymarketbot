/**
 * USDC.e → pUSD wrap via Polymarket CollateralOnramp
 * CollateralOnramp: 0x93070a847efEf7F70739046A929D47a521F5B8ee
 * wrap(_asset, _to, _amount)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/root/.polymarket_secrets' });
import { ethers } from 'ethers';

const RPC      = 'https://polygon-bor-rpc.publicnode.com';
const ONRAMP   = '0x93070a847efEf7F70739046A929D47a521F5B8ee';
const USDC_E   = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const PUSD     = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';

const provider = new ethers.providers.JsonRpcProvider(RPC);
const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];
const ONRAMP_ABI = [
  'function wrap(address _asset, address _to, uint256 _amount) external',
];

const GAS = {
  maxFeePerGas:         ethers.utils.parseUnits('200', 'gwei'),
  maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei'),
  gasLimit: 200000,
};

async function main() {
  const addr    = wallet.address;
  const usdce   = new ethers.Contract(USDC_E, ERC20_ABI, wallet);
  const pusd    = new ethers.Contract(PUSD, ERC20_ABI, provider);
  const onramp  = new ethers.Contract(ONRAMP, ONRAMP_ABI, wallet);

  const usdceBal = await usdce.balanceOf(addr);
  const pusdBal  = await pusd.balanceOf(addr);
  console.log();
  console.log();
  console.log();

  if (usdceBal.isZero()) {
    console.log('No USDC.e to wrap!');
    return;
  }

  const amount = usdceBal; // wrap all

  // Step 1: Approve
  const allowance = await usdce.allowance(addr, ONRAMP);
  if (allowance.lt(amount)) {
    console.log();
    const tx1 = await usdce.approve(ONRAMP, amount, GAS);
    await tx1.wait();
    console.log();
  } else {
    console.log();
  }

  // Step 2: Wrap
  console.log();
  const tx2 = await onramp.wrap(USDC_E, addr, amount, GAS);
  const receipt = await tx2.wait();
  console.log();

  // Check final balances
  const usdceAfter = await usdce.balanceOf(addr);
  const pusdAfter  = await pusd.balanceOf(addr);
  console.log();
  console.log();
  console.log();
}
main().catch(e => console.error('ERROR:', e.message));
