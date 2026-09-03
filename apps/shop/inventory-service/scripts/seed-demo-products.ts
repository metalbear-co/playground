/**
 * Loads a demo product catalog into whatever database DATABASE_URL points at.
 *
 * Run this wrapped in a mirrord DB-branch session so it writes to an
 * ephemeral branch instead of the shared staging database:
 *
 *   mirrord exec --config-file ../mirrord-db-preview.json -- npx tsx scripts/seed-demo-products.ts
 */
import { Pool } from "pg";

let dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/inventory";
if (dbUrl && !/:\d+\/.+$/.test(dbUrl)) {
  dbUrl += "/inventory";
}

const products = [
  {
    name: "Sage Green Ribbed Wool Cardigan",
    description: "A relaxed ribbed cardigan in responsibly sourced wool, cut for everyday layering.",
    price_cents: 8990,
    stock: 42,
    image_url: "https://picsum.photos/seed/larkwell-cardigan/900/1200",
    is_new: true,
  },
  {
    name: "Toasted Almond Cashmere Crew Cardigan",
    description: "Grade-A cashmere in a classic crew neck, soft enough for daily wear.",
    price_cents: 15000,
    stock: 18,
    image_url: "https://picsum.photos/seed/larkwell-cashmere/900/1200",
    is_new: false,
  },
  {
    name: "Charcoal Grey Brushed Cotton Henley",
    description: "Brushed cotton henley with a substantial hand-feel, garment-washed for softness.",
    price_cents: 4990,
    stock: 65,
    image_url: "https://picsum.photos/seed/larkwell-henley/900/1200",
    is_new: true,
  },
  {
    name: "Walnut Brown Faux Shearling Jacket",
    description: "Faux shearling jacket with a full button placket, built for cold mornings.",
    price_cents: 16800,
    stock: 12,
    image_url: "https://picsum.photos/seed/larkwell-shearling/900/1200",
    is_new: false,
  },
  {
    name: "Oat Beige Waffle Knit Throw",
    description: "A waffle-knit throw in a warm oat beige, woven from combed cotton.",
    price_cents: 9400,
    stock: 30,
    image_url: "https://picsum.photos/seed/larkwell-throw/900/1200",
    is_new: false,
  },
  {
    name: "Ivory Bamboo Sheet Set",
    description: "Bamboo-derived sheet set, breathable and cooling. Available Twin through California King, starting at $100.00.",
    price_cents: 10000,
    stock: 24,
    image_url: "https://picsum.photos/seed/larkwell-sheets/900/1200",
    is_new: false,
  },
];

async function main() {
  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();
  try {
    // ponytail: demo branch DB only — wipe and replace rather than merge
    await client.query("DELETE FROM products");
    for (const p of products) {
      await client.query(
        `INSERT INTO products (name, description, price_cents, stock, image_url, image_urls, is_new)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.name, p.description, p.price_cents, p.stock, p.image_url, JSON.stringify([p.image_url]), p.is_new]
      );
    }
    console.log(`Seeded ${products.length} demo products into ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
