import { Side, OrderType } from "@polymarket/clob-client";
import { getClobClient } from "./live/client";

const NO_TOKEN_ID = "113907990518330702006524848053624249887792069232686453042694767194145588854650";
const PRICE       = 0.94;
const SHARES      = 5;
const TICK_SIZE   = "0.01";
const FEE_BPS     = 1000;

async function main() {
  console.log("⏳ CLOB client başlatılıyor...");
  const client = await getClobClient();
  console.log("✅ Bağlandı");

  const book = await client.getOrderBook(NO_TOKEN_ID);
  const asks = (book as any)?.asks ?? [];
  const bids = (book as any)?.bids ?? [];
  console.log("📊 Best Ask:", asks[0] ?? "yok");
  console.log("📊 Best Bid:", bids[0] ?? "yok");

  console.log("\\n📝 Emir: BUY NO token @ " + PRICE + " x " + SHARES + " share (GTC maker)");
  console.log("   Maliyet: $" + (PRICE * SHARES).toFixed(2));
  console.log("   Kazanç (NO win): $" + ((1 - PRICE) * SHARES).toFixed(2));

  const order = await client.createOrder(
    { tokenID: NO_TOKEN_ID, price: PRICE, side: Side.BUY, size: SHARES, feeRateBps: FEE_BPS },
    { tickSize: TICK_SIZE, negRisk: true }
  );

  const result = await client.postOrder(order, OrderType.GTC);
  console.log("\\n✅ EMİR GÖNDERİLDİ:", JSON.stringify(result, null, 2));
}

main().catch(e => { console.error("❌ HATA:", e.message); process.exit(1); });

async function checkOrders() {
  const client = await getClobClient();
  const orders = await client.getOpenOrders({});
  console.log("\n📋 Açık emirler:", JSON.stringify(orders, null, 2));
}
checkOrders().catch(e => console.error("ERR:", e.message));
