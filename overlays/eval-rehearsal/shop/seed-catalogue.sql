-- Metal Mart catalogue seed for the eval rehearsal cluster.
--
-- Captured from https://playground.metalbear.dev on 2026-08-23 via the public shop API.
-- Regenerate with scripts/capture-catalogue.sh.
--
-- The 8-product snapshot hardcoded in
-- .github/workflows/ci-demo-shop-mirrord-vs-baseline.yml (frozen 2026-03-16)
-- is a different thing: that one is the stale fixture the agent eval demo is
-- built around, and it is deliberately left as it is.

INSERT INTO products (id, name, description, price_cents, stock, image_urls, is_new) VALUES
  (1, 'Team Work Makes The Dream Work Sticker', 'MetalBear teamwork sticker', 499, 1159, '["team_work_makes_the_Dream_work_ljp4we"]'::jsonb, true),
  (2, 'Team Work Makes The Dream Work T-Shirt', 'MetalBear teamwork tee — front and back designs', 2499, 169, '["","Metal Mart/samples/mirrord-hoodie-front"]'::jsonb, true),
  (3, 'Mind The Gap Sticker', 'MetalBear Mind The Gap sticker', 499, 161, '["Mind_the_Gap_pkyuc6"]'::jsonb, false),
  (4, 'Mind The Gap T-Shirt', 'MetalBear Mind The Gap tee — front and back designs', 2499, 41, '["Mind_the_gap_-_Front_anazkh","Mind_the_gap_-_Back_oh9jyf"]'::jsonb, false),
  (5, 'Increase Velocity Sticker', 'MetalBear Increase Velocity sticker', 499, 189, '["Increase_velocity_mfsov2"]'::jsonb, false),
  (6, 'Increase Velocity T-Shirt', 'MetalBear Increase Velocity tee — front and back designs', 2499, 81, '["Increase_Velocity_-_Front_c2dgw6","Increase_Velocity_-_Back_ywhxi6"]'::jsonb, false),
  (7, 'Cloudboat Willie T-Shirt', 'MetalBear Cloudboat Willie tee — front and back designs', 2499, 44, '["Cloudboat_Willie_-_Front_wpgqi2","Cloudboat_Willie_-_Back_z05dna"]'::jsonb, false),
  (8, 'A mirrord Is Born T-Shirt', 'MetalBear A mirrord Is Born tee — front and back designs', 2499, 47, '["A_mirrord_is_born_-_Front_xy8l8p","A_mirrord_is_born_-_Back_bytwh2"]'::jsonb, false),
  (9, 'Debug Mode Hoodie', 'Cozy hoodie for late-night debugging sessions', 4999, 24, '["team_Work_makes_the_Dream_Work_-_front_w5qdnb"]'::jsonb, true),
  (10, 'Kubernetes Ninja Sticker', 'Stealthy pod scheduler sticker pack', 399, 237, '["Mind_the_Gap_pkyuc6"]'::jsonb, false),
  (11, 'Rust Crab Mug', 'Fearless-concurrency coffee mug for Rustaceans', 1899, 50, '["A_mirrord_is_born_-_Front_xy8l8p"]'::jsonb, true),
  (12, 'Latency Killer Cap', 'Ball cap for sub-millisecond engineers', 2199, 44, '["Cloudboat_Willie_-_Front_wpgqi2"]'::jsonb, false),
  (13, 'Production Bug Plush', 'Hug the bug — soft plush for incident response', 1499, 79, '["Increase_velocity_mfsov2"]'::jsonb, false),
  (14, 'Observability Notebook', 'Dot-grid notebook for runbooks and architecture doodles', 1299, 101, '["Mind_the_gap_-_Front_anazkh"]'::jsonb, false),
  (15, 'Container Whale Keychain', 'Ship it — tiny whale keychain for your laptop bag', 899, 145, '["Cloudboat_Willie_-_Back_z05dna"]'::jsonb, true),
  (16, 'Service Mesh Tote Bag', 'Carry your sidecars in style', 1699, 65, '["team_work_makes_the_dream_work_-_back_onanux"]'::jsonb, false)
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  stock       = EXCLUDED.stock,
  image_urls  = EXCLUDED.image_urls,
  is_new      = EXCLUDED.is_new;

SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT MAX(id) FROM products));
