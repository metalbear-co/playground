import express from "express";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || "eu-north-1",
  useQueueUrlAsEndpoint: false,
});
const sqsQueueUrl = process.env.SQS_QUEUE_URL || "";
const receiptServiceUrl = process.env.RECEIPT_SERVICE_URL || "http://receipt-service";

app.use(express.json());

app.use((req, _res, next) => {
  if (req.path !== "/health" && !req.path.startsWith("/visualization-shop")) {
    console.log("[Payment] %s %s headers: %s", req.method, req.path, JSON.stringify(req.headers, null, 2));
  }
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

/** SQS consumer loop — long-polls for payment messages and processes them. */
async function consumeMessages(): Promise<void> {
  console.log("[Payment] Starting SQS consumer, queue:", sqsQueueUrl);
  while (true) {
    try {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: sqsQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          MessageAttributeNames: ["All"],
        })
      );

      if (!response.Messages || response.Messages.length === 0) continue;

      for (const message of response.Messages) {
        const tenant =
          message.MessageAttributes?.["x-pg-tenant"]?.StringValue ?? "unknown";
        const body = JSON.parse(message.Body || "{}");
        console.log("[Payment] Received SQS message:", JSON.stringify({
          tenant,
          orderId: body.orderId,
          amount: body.amount,
          customer_email: body.customer_email ?? null,
          items: body.items,
          messageId: message.MessageId,
        }, null, 2));
        console.log("[Payment] SQS message attributes:", JSON.stringify(message.MessageAttributes, null, 2));

        // Propagate OTel headers to receipt service
        const otelHeaders: Record<string, string> = {};
        const traceparent = message.MessageAttributes?.["traceparent"]?.StringValue;
        const tracestate = message.MessageAttributes?.["tracestate"]?.StringValue;
        if (traceparent) otelHeaders["traceparent"] = traceparent;
        if (tracestate) otelHeaders["tracestate"] = tracestate;

        const outgoingHeaders = { "Content-Type": "application/json", ...otelHeaders };
        console.log("[Payment] Outgoing headers to receipt-service:", JSON.stringify(outgoingHeaders, null, 2));

        try {
          const receiptRes = await fetch(`${receiptServiceUrl}/receipts`, {
            method: "POST",
            headers: outgoingHeaders,
            body: JSON.stringify({
              orderId: body.orderId,
              amount: body.amount,
              customer_email: body.customer_email ?? null,
              items: body.items,
            }),
          });
          const receipt = await receiptRes.json();
          console.log("[Payment] Receipt generated:", JSON.stringify(receipt, null, 2));
        } catch (receiptErr) {
          console.error("[Payment] Failed to generate receipt:", receiptErr);
        }

        await sqsClient.send(
          new DeleteMessageCommand({
            QueueUrl: sqsQueueUrl,
            ReceiptHandle: message.ReceiptHandle,
          })
        );
      }
    } catch (err) {
      console.error("[Payment] SQS consumer error:", err);
      // Brief pause before retrying on error
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Payment service listening on port ${port}`);
});

if (sqsQueueUrl) {
  consumeMessages().catch((err) => {
    console.error("[Payment] Fatal SQS consumer error:", err);
  });
} else {
  console.warn("[Payment] SQS_QUEUE_URL not set, SQS consumer disabled");
}
