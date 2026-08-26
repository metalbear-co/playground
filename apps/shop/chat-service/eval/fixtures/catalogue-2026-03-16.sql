-- The March catalogue, as a self-hosted environment would seed it.
--
-- Generated from eval/fixtures/catalogue-2026-03-16.json, which was itself
-- parsed out of the INSERT block committed in
-- .github/workflows/ci-demo-shop-mirrord-vs-baseline.yml on 2026-03-16.
--
-- This is the point of the middle column in the demo: an environment you stand
-- up yourself needs seed data, somebody hand-writes it, and it then stops
-- matching the cluster without anyone noticing.

INSERT INTO products (id, name, description, price_cents, stock, image_urls, is_new) VALUES
  (1, 'Team Work Makes The Dream Work Sticker', 'MetalBear teamwork sticker', 499, 72, '["team_work_makes_the_Dream_work_ljp4we"]'::jsonb, true),
  (2, 'Team Work Makes The Dream Work T-Shirt', 'MetalBear teamwork tee — front and back designs', 2499, 43, '["team_Work_makes_the_Dream_Work_-_front_w5qdnb","team_work_makes_the_dream_work_-_back_onanux"]'::jsonb, true),
  (3, 'Mind The Gap Sticker', 'MetalBear Mind The Gap sticker', 499, 198, '["Mind_the_Gap_pkyuc6"]'::jsonb, false),
  (4, 'Mind The Gap T-Shirt', 'MetalBear Mind The Gap tee — front and back designs', 2499, 50, '["Mind_the_gap_-_Front_anazkh","Mind_the_gap_-_Back_oh9jyf"]'::jsonb, false),
  (5, 'Increase Velocity Sticker', 'MetalBear Increase Velocity sticker', 499, 199, '["Increase_velocity_mfsov2"]'::jsonb, false),
  (6, 'Increase Velocity T-Shirt', 'MetalBear Increase Velocity tee — front and back designs', 2499, 41, '["Increase_Velocity_-_Front_c2dgw6","Increase_Velocity_-_Back_ywhxi6"]'::jsonb, false),
  (7, 'Cloudboat Willie T-Shirt', 'MetalBear Cloudboat Willie tee — front and back designs', 2499, 50, '["Cloudboat_Willie_-_Front_wpgqi2","Cloudboat_Willie_-_Back_z05dna"]'::jsonb, false),
  (8, 'A mirrord Is Born T-Shirt', 'MetalBear A mirrord Is Born tee — front and back designs', 2499, 50, '["A_mirrord_is_born_-_Front_xy8l8p","A_mirrord_is_born_-_Back_bytwh2"]'::jsonb, false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents, stock = EXCLUDED.stock,
  image_urls = EXCLUDED.image_urls, is_new = EXCLUDED.is_new;

SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT MAX(id) FROM products));
