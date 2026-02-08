import type { Pool } from "pg";

export function createDeliveryActivities(pool: Pool) {
  return {
    async createDelivery(orderId: number): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query(
          "INSERT INTO deliveries (order_id, status) VALUES ($1, 'processing')",
          [orderId]
        );
      } finally {
        client.release();
      }
    },
  };
}
