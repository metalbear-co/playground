import express from "express";
import crypto from "crypto";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

app.use(express.json());

app.use((req, _res, next) => {
  if (req.path !== "/health") {
    console.log(`[Receipt] ${req.method} ${req.path} headers:`, JSON.stringify(req.headers, null, 2));
  }
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/receipts", (req, res) => {
  const { orderId, amount, customer_email, items } = req.body;

  // Propagate OTel trace context from incoming headers
  const traceparent = req.headers["traceparent"] as string | undefined;
  const tracestate = req.headers["tracestate"] as string | undefined;

  const receiptId = crypto.randomUUID();
  const receiptUrl = `https://receipts.metalbear.dev/${receiptId}.pdf`;

  console.log("[Receipt] Generated receipt:", JSON.stringify({
    receiptId,
    orderId,
    amount,
    customer_email: customer_email ?? null,
    items,
    traceparent: traceparent ?? null,
    tracestate: tracestate ?? null,
  }, null, 2));

  res.status(201).json({
    receiptId,
    receiptUrl,
    orderId,
    customer_email: customer_email ?? null,
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Receipt service listening on port ${port}`);
});
