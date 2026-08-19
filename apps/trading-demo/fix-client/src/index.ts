import net from "node:net";

const host = process.env.FIX_GATEWAY_HOST || "localhost";
const port = parseInt(process.env.FIX_GATEWAY_PORT || "9876", 10);
const clOrdId = process.env.CL_ORD_ID || `demo-${Date.now()}`;

const fixMessage =
  process.env.FIX_MESSAGE ||
  `8=FIX.4.2|9=100|35=D|11=${clOrdId}|55=METAL-1|38=1|40=2|10=000|`;

console.log("[FixClient] Connecting to %s:%s", host, port);
console.log("[FixClient] Sending: %s", fixMessage);

const client = net.createConnection({ host, port }, () => {
  client.write(fixMessage);
  client.end();
});

client.on("error", (err) => {
  console.error("[FixClient] error:", err.message);
  process.exit(1);
});

client.on("close", () => {
  console.log("[FixClient] Done");
});
