import express from "express";
import rateLimit from "express-rate-limit";
import { Pool } from "pg";

const app = express();
const port = parseInt(process.env.PORT || "80", 10);

let dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/inventory";
// mirrord branch DB URLs may omit the database name — ensure we connect to "inventory"
if (dbUrl && !/:\d+\/.+$/.test(dbUrl)) {
  dbUrl += "/inventory";
}

const pool = new Pool({ connectionString: dbUrl });

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
        image_urls JSONB DEFAULT '[]'::jsonb,
        is_new BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    try {
      await client.query("ALTER TABLE products ADD COLUMN image_url VARCHAR(512)");
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== "42701") throw err;
    }
    try {
      await client.query("ALTER TABLE products ADD COLUMN image_urls JSONB DEFAULT '[]'::jsonb");
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== "42701") throw err;
    }
    try {
      await client.query("ALTER TABLE products ADD COLUMN is_new BOOLEAN DEFAULT false");
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== "42701") throw err;
    }
    // Mark first two products as "new" for existing DBs
    await client.query("UPDATE products SET is_new = true WHERE id IN (1, 2)");
    // Migrate image_url to image_urls for existing rows
    await client.query(`
      UPDATE products SET image_urls = jsonb_build_array(image_url)
      WHERE (image_urls IS NULL OR image_urls = '[]'::jsonb) AND image_url IS NOT NULL
    `);
  } finally {
    client.release();
  }
}

app.use(express.json());

app.use((req, _res, next) => {
  if (req.path !== "/health") {
    console.log("[Inventory] %s %s headers: %s", req.method, req.path, JSON.stringify(req.headers, null, 2));
  }
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/products", async (_req, res) => {
  // Set a breakpoint here; trigger with: curl http://localhost:28080/products -H "X-PG-Tenant: dev" (while port-forward + mirrord are running)
  try {
    const { rows } = await pool.query("SELECT id, name, description, price_cents, stock, image_url, image_urls, is_new FROM products ORDER BY id");
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
      "SELECT id, name, description, price_cents, stock, image_url, image_urls, is_new FROM products WHERE id = $1",
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

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

app.patch("/products/:id/stock", writeLimiter, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  const { stock } = req.body;
  if (isNaN(id) || typeof stock !== "number" || stock < 0) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const { rows } = await pool.query(
      "UPDATE products SET stock = $1 WHERE id = $2 RETURNING stock",
      [stock, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json({ stock: rows[0].stock });
  } catch (err) {
    console.error("Error updating stock:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/products/:id/reserve", writeLimiter, async (req, res) => {
  console.log("Reserve request headers:", JSON.stringify(req.headers, null, 2));
  console.log("Reserve request body:", JSON.stringify(req.body, null, 2));
  const id = parseInt(req.params.id as string, 10);
  const { quantity = 1 } = req.body;
  if (isNaN(id) || typeof quantity !== "number" || quantity < 1) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const before = await pool.query("SELECT stock FROM products WHERE id = $1", [id]);
    const stockBefore = before.rows.length > 0 ? before.rows[0].stock : "N/A";
    console.log(`[Inventory] Product ${id} stock BEFORE reserve: ${stockBefore}`);

    const { rows } = await pool.query(
      "UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING stock",
      [quantity, id]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: "Insufficient stock or product not found" });
    }
    console.log(`[Inventory] Product ${id} stock AFTER reserve: ${rows[0].stock} (reserved ${quantity})`);
    res.json({ reserved: true, remaining: rows[0].stock });
  } catch (err) {
    console.error("Error reserving stock:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/products/:id/check-stock", async (req, res) => {
  console.log("Check-stock request headers:", JSON.stringify(req.headers, null, 2));
  console.log("Check-stock request body:", JSON.stringify(req.body, null, 2));
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
  console.log(`[Inventory] DATABASE_URL: ${process.env.DATABASE_URL || "not set (using default)"}`);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Inventory service listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
