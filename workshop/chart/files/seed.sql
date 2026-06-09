-- MetalMart product seed for the mirrord workshop (mirrors the real playground shop catalog).
-- Idempotent: explicit ids + ON CONFLICT DO NOTHING. Runs against the `inventory` database.

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

INSERT INTO products (id, name, description, price_cents, stock, image_url, image_urls, is_new) VALUES
  (1, 'Team Work Makes The Dream Work Sticker', 'MetalBear teamwork sticker', 499, 1811, NULL, '["team_work_makes_the_Dream_work_ljp4we"]'::jsonb, true),
  (2, 'Team Work Makes The Dream Work T-Shirt', 'MetalBear teamwork tee — front and back designs', 2499, 175, 'Metal Mart/samples/mirrord-hoodie-front', '["", "Metal Mart/samples/mirrord-hoodie-front"]'::jsonb, true),
  (3, 'Mind The Gap Sticker', 'MetalBear Mind The Gap sticker', 499, 168, NULL, '["Mind_the_Gap_pkyuc6"]'::jsonb, false),
  (4, 'Mind The Gap T-Shirt', 'MetalBear Mind The Gap tee — front and back designs', 2499, 45, NULL, '["Mind_the_gap_-_Front_anazkh", "Mind_the_gap_-_Back_oh9jyf"]'::jsonb, false),
  (5, 'Increase Velocity Sticker', 'MetalBear Increase Velocity sticker', 499, 190, NULL, '["Increase_velocity_mfsov2"]'::jsonb, false),
  (6, 'Increase Velocity T-Shirt', 'MetalBear Increase Velocity tee — front and back designs', 2499, 13, NULL, '["Increase_Velocity_-_Front_c2dgw6", "Increase_Velocity_-_Back_ywhxi6"]'::jsonb, false),
  (7, 'Cloudboat Willie T-Shirt', 'MetalBear Cloudboat Willie tee — front and back designs', 2499, 46, NULL, '["Cloudboat_Willie_-_Front_wpgqi2", "Cloudboat_Willie_-_Back_z05dna"]'::jsonb, false),
  (8, 'A mirrord Is Born T-Shirt', 'MetalBear A mirrord Is Born tee — front and back designs', 2499, 48, NULL, '["A_mirrord_is_born_-_Front_xy8l8p", "A_mirrord_is_born_-_Back_bytwh2"]'::jsonb, false),
  (9, 'Debug Mode Hoodie', 'Cozy hoodie for late-night debugging sessions', 4999, 31, NULL, '["team_Work_makes_the_Dream_Work_-_front_w5qdnb"]'::jsonb, true),
  (10, 'Kubernetes Ninja Sticker', 'Stealthy pod scheduler sticker pack', 399, 240, NULL, '["Mind_the_Gap_pkyuc6"]'::jsonb, false),
  (11, 'Rust Crab Mug', 'Fearless-concurrency coffee mug for Rustaceans', 1899, 53, NULL, '["A_mirrord_is_born_-_Front_xy8l8p"]'::jsonb, true),
  (12, 'Latency Killer Cap', 'Ball cap for sub-millisecond engineers', 2199, 45, NULL, '["Cloudboat_Willie_-_Front_wpgqi2"]'::jsonb, false),
  (13, 'Production Bug Plush', 'Hug the bug — soft plush for incident response', 1499, 80, NULL, '["Increase_velocity_mfsov2"]'::jsonb, false),
  (14, 'Observability Notebook', 'Dot-grid notebook for runbooks and architecture doodles', 1299, 107, NULL, '["Mind_the_gap_-_Front_anazkh"]'::jsonb, false),
  (15, 'Container Whale Keychain', 'Ship it — tiny whale keychain for your laptop bag', 899, 147, NULL, '["Cloudboat_Willie_-_Back_z05dna"]'::jsonb, true),
  (16, 'Service Mesh Tote Bag', 'Carry your sidecars in style', 1699, 65, NULL, '["team_work_makes_the_dream_work_-_back_onanux"]'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('products','id'), (SELECT MAX(id) FROM products));
