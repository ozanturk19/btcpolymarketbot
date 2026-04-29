import { Side, OrderType } from "@polymarket/clob-client";
import { getClobClient } from "./live/client";

const TOKEN_NO = "25273124951754928579048897585521371413430028649866454218803396040000777893662";

async function main() {
  const client = await getClobClient();
  console.log("--- negRisk: false ---");
  const order = await client.createOrder(
    { tokenID: TOKEN_NO, price: 0.93, side: Side.BUY, size: 6, feeRateBps: 1000 },
    { tickSize: "0.01", negRisk: false }
  );
  const result = await client.postOrder(order, OrderType.GTC) as any;
  console.log("Result:", JSON.stringify(result));
}
main().catch(e => console.error("ERR:", e.message));
