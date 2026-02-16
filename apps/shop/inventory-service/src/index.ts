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
    const { rows } = await client.query("SELECT COUNT(*) FROM products");
    if (parseInt(rows[0].count, 10) === 0) {
      // image_urls: Cloudinary public IDs. T-shirts have [front, back]; stickers have [single].
      await client.query(`
        INSERT INTO products (name, description, price_cents, stock, image_urls, is_new) VALUES
        ('Team Work Makes The Dream Work Sticker', 'MetalBear teamwork sticker', 499, 200, '["team_work_makes_the_Dream_work_ljp4we"]', true),
        ('Team Work Makes The Dream Work T-Shirt', 'MetalBear teamwork tee — front and back designs', 2499, 50, '["team_Work_makes_the_Dream_Work_-_front_w5qdnb", "team_work_makes_the_dream_work_-_back_onanux"]', true),
        ('Mind The Gap Sticker', 'MetalBear Mind The Gap sticker', 499, 200, '["Mind_the_Gap_pkyuc6"]', false),
        ('Mind The Gap T-Shirt', 'MetalBear Mind The Gap tee — front and back designs', 2499, 50, '["Mind_the_gap_-_Front_anazkh", "Mind_the_gap_-_Back_oh9jyf"]', false),
        ('Increase Velocity Sticker', 'MetalBear Increase Velocity sticker', 499, 200, '["Increase_velocity_mfsov2"]', false),
        ('Increase Velocity T-Shirt', 'MetalBear Increase Velocity tee — front and back designs', 2499, 50, '["Increase_Velocity_-_Front_c2dgw6", "Increase_Velocity_-_Back_ywhxi6"]', false),
        ('Cloudboat Willie T-Shirt', 'MetalBear Cloudboat Willie tee — front and back designs', 2499, 50, '["Cloudboat_Willie_-_Front_wpgqi2", "Cloudboat_Willie_-_Back_z05dna"]', false),
        ('A mirrord Is Born T-Shirt', 'MetalBear A mirrord Is Born tee — front and back designs', 2499, 50, '["A_mirrord_is_born_-_Front_xy8l8p", "A_mirrord_is_born_-_Back_bytwh2"]', false)
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
