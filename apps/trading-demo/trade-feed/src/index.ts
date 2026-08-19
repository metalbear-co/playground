import dgram from "node:dgram";

const port = parseInt(process.env.UDP_PORT || "9999", 10);
const stackId =
  process.env.POD_NAMESPACE || process.env.STACK_ID || "local";

const server = dgram.createSocket("udp4");

server.on("message", (msg, rinfo) => {
  const text = msg.toString("utf8");
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  console.log(
    "[TradeFeed ns=%s] UDP from %s:%s payload=%s",
    stackId,
    rinfo.address,
    rinfo.port,
    JSON.stringify(parsed)
  );
});

server.on("error", (err) => {
  console.error("[TradeFeed] error:", err);
  process.exit(1);
});

server.bind(port, "0.0.0.0", () => {
  console.log("[TradeFeed ns=%s] UDP listening on %s", stackId, port);
});
