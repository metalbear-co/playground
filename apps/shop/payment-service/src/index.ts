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

app.use(express.json());

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
