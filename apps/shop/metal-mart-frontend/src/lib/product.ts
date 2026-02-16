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
