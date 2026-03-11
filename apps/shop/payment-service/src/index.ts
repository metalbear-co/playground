import express from "express";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/payments", (req: express.Request, res: express.Response) => {
  console.log("Request headers:", JSON.stringify(req.headers, null, 2));
  console.log("Request body:", JSON.stringify(req.body, null, 2));
  // Mock payment - always succeeds
  res.status(200).json({
    success: true,
    transactionId: `mock-${Date.now()}`,
    message: "Payment processed successfully (mock)",
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Payment service listening on port ${port}`);
});
