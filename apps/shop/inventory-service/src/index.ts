import express from "express";
import { Pool } from "pg";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/inventory",
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price_cents INTEGER NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        image_url VARCHAR(512),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    try {
      await client.query("ALTER TABLE products ADD COLUMN image_url VARCHAR(512)");
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== "42701") throw err;
    }
    const { rows } = await client.query("SELECT COUNT(*) FROM products");
    if (parseInt(rows[0].count, 10) === 0) {
      await client.query(`
        INSERT INTO products (name, description, price_cents, stock, image_url) VALUES
        ('MetalBear T-Shirt', 'Official MetalBear bear logo tee', 2499, 50, 'https://placehold.co/400x400/1e293b/94a3b8?text=T-Shirt'),
        ('MetalBear Hoodie', 'Cozy MetalBear hoodie', 4999, 30, 'https://placehold.co/400x400/1e293b/94a3b8?text=Hoodie'),
        ('MetalBear Mug', 'Start your day with mirrord', 1299, 100, 'https://placehold.co/400x400/1e293b/94a3b8?text=Mug'),
        ('MetalBear Stickers', 'Pack of 5 awesome stickers', 499, 200, 'https://placehold.co/400x400/1e293b/94a3b8?text=Stickers')
      `);
    }
  } finally {
    client.release();
  }
}

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/products", async (_req, res) => {
  // Set a breakpoint here; trigger with: curl http://localhost:28080/products -H "X-PG-Tenant: dev" (while port-forward + mirrord are running)
  try {
    const { rows } = await pool.query("SELECT id, name, description, price_cents, stock, image_url FROM products ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/products/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT id, name, description, price_cents, stock, image_url FROM products WHERE id = $1",
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/products/:id/check-stock", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { quantity = 1 } = req.body;
  if (isNaN(id) || typeof quantity !== "number" || quantity < 1) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const { rows } = await pool.query("SELECT stock FROM products WHERE id = $1", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    const inStock = rows[0].stock >= quantity;
    res.json({ inStock, available: rows[0].stock });
  } catch (err) {
    console.error("Error checking stock:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function main() {
  await initDb();
  app.listen(port, "0.0.0.0", () => {
    console.log(`Inventory service listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
