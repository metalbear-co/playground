# Playground Repo (MetalMart Shop)

## MetalMart Frontend Architecture

**Path:** `apps/shop/metal-mart-frontend/`
**Framework:** Next.js 16 (App Router) + React 19 + Tailwind CSS 4
**Font:** DM Sans (Google Fonts)
**Design system:** Purple (#6a4ff5) primary, orange (#f59e0b) accent. Custom `.btn-primary` and `.btn-secondary` classes in `globals.css`.

### Pages (all `"use client"`)

| Route | File | Description |
|---|---|---|
| `/` | `src/app/page.tsx` | Home page — bento grid of featured products using `ProductTile` component (featured/standard/wide variants). Products open in a `ProductDialog`. |
| `/products` | `src/app/products/page.tsx` | Product listing grid. |
| `/products/[id]` | `src/app/products/[id]/page.tsx` | Product detail page (image gallery with front/back toggle, add-to-cart). |
| `/cart` | `src/app/cart/page.tsx` | Cart page. Uses `localStorage` key `metal-mart-cart`. Supports `?add=<id>` query param to add items. |
| `/checkout` | `src/app/checkout/page.tsx` | Checkout with optional email, places order via `POST /api/orders`. |
| `/orders/[id]` | `src/app/orders/[id]/page.tsx` | Order tracking page. |

### Components (`src/components/`)

| Component | Purpose |
|---|---|
| `Header.tsx` | Sticky nav bar with MetalBear logo (Cloudinary), links to Products and Cart. Accepts `showSubtitle` prop. |
| `Footer.tsx` | Site footer with wave decoration. |
| `ProductDialog.tsx` | Modal overlay for viewing product details (image gallery, description, add-to-cart) without navigating away. |
| `ProductImage.tsx` | Image component (wraps Cloudinary or Next.js Image). |
| `NewBadge.tsx` | "NEW" badge overlay for products with `is_new: true`. |
| `LoadingSpinner.tsx` | Centered loading spinner. |
| `Mascot.tsx` / `MascotPositioned.tsx` | MetalBear mascot decoration. |
| `DecorativeIcons.tsx` | Decorative icons. |

### Data model (`src/lib/product.ts`)

```typescript
type Product = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;   // price in cents, display as (price_cents / 100).toFixed(2)
  stock: number;
  image_url?: string | null;      // legacy single image
  image_urls?: string[] | null;   // preferred: array of images (front, back, etc.)
  is_new?: boolean;               // shows "NEW" badge
};
```

Helper functions: `getPrimaryImageUrl(product)` returns first image, `getImageUrls(product)` returns all images.

### API Routes (proxy to backend services)

| Route | Backend env var | Proxies to |
|---|---|---|
| `GET /api/products` | `INVENTORY_SERVICE_URL` | `GET /products` |
| `GET /api/products/[id]` | `INVENTORY_SERVICE_URL` | `GET /products/:id` |
| `POST /api/orders` | `ORDER_SERVICE_URL` | `POST /orders` (forwards `baggage` header for mirrord) |
| `GET /api/orders/[id]` | `ORDER_SERVICE_URL` | `GET /orders/:id` |
| `GET /api/deliveries/order/[orderId]` | — | Delivery status |
| `GET /api/banner` | — | Banner data |

### Styling notes

- All animations defined in `src/app/globals.css`: `fadeInUp`, `cardReveal`, `fadeIn`, `slideUp`
- `.hand-drawn-underline` class for MetalBear-style orange underline on headings
- Base path support via `NEXT_BASE_PATH` env var and `NEXT_PUBLIC_BASE_PATH` for client-side fetches
- Cloudinary for product images via `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` env var

### Backend services

| Service | Path | Purpose |
|---|---|---|
| `inventory-service` | `apps/shop/inventory-service/` | Product catalog and stock management |
| `order-service` | `apps/shop/order-service/` | Order processing |
| `payment-service` | `apps/shop/payment-service/` | Payment processing |
| `delivery-service` | `apps/shop/delivery-service/` | Delivery management |
| `receipt-service` | `apps/shop/receipt-service/` | Receipt generation |
