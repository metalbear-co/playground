# Shop experience – end state and schema

**Goal:** Minimal schema, minimal UI, slick UX. Inspired by Nike SNKRS (clean, product-focused) with a simple side-by-side layout like nopcommerce (image left, details right).

---

## Target UX

1. **Product list (catalogue)**  
   Card per product: **image**, name, price. Click → product detail. Minimal clutter.

2. **Product detail**  
   Single page per product, side-by-side:
   - **Left:** One main product photo (large). Optional: small thumbnails or arrows to swap image later; v1 = single photo only.
   - **Right:** Product name (optionally two lines: model + variant), price, description. Add to cart.

3. **Rest of flow**  
   Cart → Checkout → Order confirmation (existing flow; no schema change for this doc).

---

## What we’re incorporating (from Nike-style + simple side-by-side)

| Element        | Source idea        | Implementation                    |
|----------------|--------------------|-----------------------------------|
| Product name   | Nike (model + name)| One `name`; optional `subtitle`  |
| Price          | Both               | Keep `price_cents`                |
| Description    | Nike (long copy)   | Keep `description` (TEXT)          |
| Single photo   | Nike + nopcommerce | Add `image_url` (one per product)  |

**Simplistic schema:** one table, one image URL per product. No categories, SKUs, or multi-image gallery in v1.

---

## Schema impact: `products` table

**Current:**

```text
id, name, description, price_cents, stock, created_at
```

**Target (minimal):**

| Column        | Type         | Notes                                      |
|---------------|--------------|--------------------------------------------|
| id            | SERIAL PK    | Unchanged                                  |
| name          | VARCHAR(255) | Unchanged; main title                      |
| subtitle      | VARCHAR(255) | Optional; e.g. "Persian Violet and Glacier Blue" for two-line Nike-style title. Nullable. |
| description   | TEXT         | Unchanged; long copy                       |
| price_cents   | INTEGER      | Unchanged                                  |
| stock         | INTEGER      | Unchanged                                  |
| image_url     | VARCHAR(512) | **New.** Single product image URL. Nullable for backfill. |
| created_at    | TIMESTAMPTZ  | Unchanged                                  |

**Why one `image_url`:** Keeps schema and UI simple. Frontend shows one main image; we can add a gallery (e.g. `image_urls TEXT[]` or a separate table) later if needed.

**Why optional `subtitle`:** Supports the Nike-style “G.T. Cut 4 / Persian Violet and Glacier Blue” two-line treatment without forcing every product to have two fields. If null, UI shows only `name`.

---

## Implementation checklist (high level)

1. **Schema**
   - In `inventory-service`: add `image_url` (and optionally `subtitle`) to `CREATE TABLE` and seed data.
   - Migration: `ALTER TABLE` for existing DBs, or rely on `CREATE TABLE IF NOT EXISTS` + new columns only for fresh deploys (if acceptable).

2. **Inventory API**
   - Include `image_url` (and `subtitle` if added) in `GET /products` and `GET /products/:id`.

3. **Frontend**
   - **Product list:** Show product image (from `image_url`), name, price; link to `/products/[id]`.
   - **Product detail:** New page `/products/[id]` – side-by-side: image left, name (and subtitle if present), price, description, add to cart. Minimal, clean layout.

4. **Assets**
   - Seed products need `image_url` values (hosted image URLs or paths under `/public` and referenced as absolute paths).

---

## Out of scope for v1 (keep it minimal)

- Multiple images per product (gallery).
- Categories, tags, or filters.
- SKU in DB (can add later if needed).
- Variants (e.g. size/color) – single product per row only.

---

## Summary

- **Schema:** Add `image_url`; optionally add `subtitle`. Everything else stays as-is.
- **UX:** List with image + name + price → detail with single photo left, details right, minimal and slick.
- **Flow:** List → Detail → Cart → Checkout (unchanged); only product data and product UI change.
