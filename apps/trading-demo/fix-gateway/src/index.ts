import dgram from "node:dgram";
import net from "node:net";
import express from "express";

const fixPort = parseInt(process.env.FIX_PORT || "9876", 10);
const httpPort = parseInt(process.env.PORT || "8080", 10);
const stackId =
  process.env.POD_NAMESPACE || process.env.STACK_ID || "local";
const tradeFeedHost = process.env.TRADE_FEED_HOST || "localhost";
const tradeFeedPort = parseInt(process.env.TRADE_FEED_PORT || "9999", 10);
const orderServiceUrl = process.env.ORDER_SERVICE_URL?.trim() || "";

type FixFields = Record<string, string>;

function parseFixMessage(raw: string): FixFields {
  const fields: FixFields = {};
  for (const part of raw.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return fields;
}

function symbolToProductId(symbol: string): number {
  const match = symbol.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);
  return 1;
}

async function sendUdp(payload: Record<string, unknown>): Promise<void> {
  const message = Buffer.from(JSON.stringify(payload));
  await new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.bind(0, () => {
      socket.connect(tradeFeedPort, tradeFeedHost, () => {
        socket.send(message, (sendErr) => {
          socket.close();
          if (sendErr) reject(sendErr);
          else resolve();
        });
      });
    });
    socket.on("error", reject);
  });
}

async function maybeCreateShopOrder(fields: FixFields): Promise<number | null> {
  if (!orderServiceUrl) return null;
  const symbol = fields["55"] || "METAL-1";
  const qty = parseInt(fields["38"] || "1", 10);
  const productId = symbolToProductId(symbol);
  const res = await fetch(orderServiceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ productId, quantity: Number.isFinite(qty) ? qty : 1 }],
      total_cents: 1000,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`order-service ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { orderId: number };
  return data.orderId;
}

async function handleFixMessage(raw: string, peer: string): Promise<void> {
  const trimmed = raw.trim();
  if (!trimmed) return;
  const fields = parseFixMessage(trimmed);
  const clOrdId = fields["11"] || "unknown";
  const msgType = fields["35"] || "?";
  console.log(
    "[FixGateway ns=%s] FIX from %s type=%s clOrdId=%s symbol=%s raw=%s",
    stackId,
    peer,
    msgType,
    clOrdId,
    fields["55"] || "-",
    trimmed
  );

  let orderId: number | null = null;
  if (orderServiceUrl && msgType === "D") {
    try {
      orderId = await maybeCreateShopOrder(fields);
      console.log("[FixGateway] Created shop orderId=%s for clOrdId=%s", orderId, clOrdId);
    } catch (err) {
      console.error("[FixGateway] order-service error:", err);
    }
  }

  await sendUdp({
    clOrdId,
    msgType,
    symbol: fields["55"] || null,
    orderId,
    receivedAt: new Date().toISOString(),
  });
  console.log("[FixGateway] UDP sent to %s:%s", tradeFeedHost, tradeFeedPort);
}

function startFixServer(): void {
  const server = net.createServer((socket) => {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("|10=")) !== -1) {
        const end = buffer.indexOf("|", idx + 4);
        const frameEnd = end === -1 ? buffer.length : end + 1;
        const message = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd);
        void handleFixMessage(message, peer).catch((err) =>
          console.error("[FixGateway] handle error:", err)
        );
      }
    });
    socket.on("end", () => {
      if (buffer.trim()) {
        void handleFixMessage(buffer, peer).catch((err) =>
          console.error("[FixGateway] handle error:", err)
        );
        buffer = "";
      }
    });
  });
  server.listen(fixPort, "0.0.0.0", () => {
    console.log("[FixGateway ns=%s] FIX TCP listening on %s", stackId, fixPort);
  });
}

function startHttp(): void {
  const app = express();
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      namespace: stackId,
      fixPort,
      tradeFeed: `${tradeFeedHost}:${tradeFeedPort}`,
      orderServiceUrl: orderServiceUrl || null,
    });
  });
  app.listen(httpPort, "0.0.0.0", () => {
    console.log("[FixGateway] HTTP health on %s", httpPort);
  });
}

startFixServer();
startHttp();
