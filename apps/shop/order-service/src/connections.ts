import { Kafka } from "kafkajs";
import { Pool } from "pg";

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
export const paymentUrl =
  process.env.PAYMENT_SERVICE_URL || "http://localhost:80";
