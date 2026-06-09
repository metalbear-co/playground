-- MetalMart product seed for the mirrord workshop.
-- The playground repo ships NO product seed (inventory-service only CREATE TABLEs),
-- so the workshop deploys its own Postgres seeded with this file.
--
-- Runs against the `inventory` database (set POSTGRES_DB=inventory, or \c inventory).
-- Idempotent: explicit ids + ON CONFLICT DO NOTHING, safe to re-run.
--
-- Schema mirrors apps/shop/inventory-service initDb() so the published image is happy:
-- its initDb does CREATE TABLE IF NOT EXISTS + ALTER ... ADD COLUMN (already-exists is ignored).

CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  price_cents  INTEGER NOT NULL,
  stock        INTEGER NOT NULL DEFAULT 0,
  image_url    VARCHAR(512),
  image_urls   JSONB DEFAULT '[]'::jsonb,
  is_new       BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO products (id, name, description, price_cents, stock, image_urls, is_new) VALUES
  (1, 'MetalBear Hoodie',        'Cozy heavyweight hoodie with the MetalBear mascot. Steal traffic in style.', 5900, 42, '[]'::jsonb, true),
  (2, 'Steal the Show Tee',      'Soft cotton tee. Run your laptop as if it were a pod.',                       2900, 80, '[]'::jsonb, true),
  (3, 'mirrord Mug',             'Ceramic mug for your morning cluster session. 11oz.',                         1500, 120, '[]'::jsonb, false),
  (4, 'Cluster Cap',             'Embroidered cap. Outgoing traffic, incoming compliments.',                    2400, 65, '[]'::jsonb, false),
  (5, 'Bear Claw Sticker Pack',  'Six die-cut vinyl stickers. Laptop lid not included.',                         800, 300, '[]'::jsonb, false),
  (6, 'Plush mirrord Bear',      'Huggable plush. Mirrors your affection bidirectionally.',                      3200, 33, '[]'::jsonb, false),
  (7, 'Enamel Pin Set',          'Three hard-enamel pins: bear, cluster, and the steal icon.',                  1800, 90, '[]'::jsonb, false),
  (8, 'DevOps Beanie',           'Keep your head warm while the operator does the heavy lifting.',              2200, 54, '[]'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

-- Keep the SERIAL sequence ahead of the explicit ids we inserted.
SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT MAX(id) FROM products));
