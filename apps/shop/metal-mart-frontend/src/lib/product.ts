/** Product from inventory API. image_urls preferred; image_url for legacy. */
export type Product = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  image_url?: string | null;
  image_urls?: string[] | null;
  is_new?: boolean;
  discount_percent?: number | null;
};

/** Primary image for thumbnails (first in array, or legacy image_url). */
export function getPrimaryImageUrl(product: Product): string | null {
  const urls = product.image_urls;
  if (urls && urls.length > 0) return urls[0];
  return product.image_url ?? null;
}

/** All image URLs for product (front, back, etc.). */
export function getImageUrls(product: Product): string[] {
  const urls = product.image_urls;
  if (urls && urls.length > 0) return urls;
  const single = product.image_url;
  return single ? [single] : [];
}

/** True if product has an active discount. */
export function hasDiscount(product: Product): boolean {
  return !!product.discount_percent && product.discount_percent > 0;
}

/** Price in cents after discount is applied (rounded). */
export function getDiscountedPriceCents(product: Product): number {
  if (!hasDiscount(product)) return product.price_cents;
  return Math.round(product.price_cents * (1 - product.discount_percent! / 100));
}
