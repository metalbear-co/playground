import { Kafka } from "kafkajs";
import { Pool } from "pg";
import { SQSClient } from "@aws-sdk/client-sqs";

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/orders",
});

const kafka = new Kafka({
  clientId: "order-service",
  brokers: (process.env.KAFKA_ADDRESS || "localhost:9092").split(","),
});

export const producer = kafka.producer();

export const inventoryUrl =
  process.env.INVENTORY_SERVICE_URL || "http://localhost:80";

export const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || "eu-north-1",
});
export const sqsQueueUrl = process.env.SQS_QUEUE_URL || "";
