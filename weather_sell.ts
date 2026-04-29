import { Side, OrderType } from "@polymarket/clob-client";
import { getClobClient } from "./live/client";

const NO_TOKEN_ID = "113907990518330702006524848053624249887792069232686453042694767194145588854650";
const PRICE       = 0.99;
const SHARES      = 9;
const TICK_SIZE   = "0.01";
const FEE_BPS     = 1000;

async function main() {
  const client = await getClobClient();

  const order = await client.createOrder(
    { tokenID: NO_TOKEN_ID, price: PRICE, side: Side.SELL, size: SHARES, feeRateBps: FEE_BPS },
    { tickSize: TICK_SIZE, negRisk: true }
  );

  const result = await client.postOrder(order, OrderType.GTC);
  console.log("SELL EMİR:", JSON.stringify(result, null, 2));
}
main().catch(e => { console.error("HATA:", e.message); process.exit(1); });
