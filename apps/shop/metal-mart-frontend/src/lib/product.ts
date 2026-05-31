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

function nonEmptyImageUrls(urls: (string | null | undefined)[] | null | undefined): string[] {
  if (!urls?.length) return [];
  return urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
}

/** Primary image for thumbnails (first in array, or legacy image_url). */
export function getPrimaryImageUrl(product: Product): string | null {
  const urls = nonEmptyImageUrls(product.image_urls);
  if (urls.length > 0) return urls[0];
  const legacy = product.image_url?.trim();
  return legacy || null;
}

/** All image URLs for product (front, back, etc.). */
export function getImageUrls(product: Product): string[] {
  const urls = nonEmptyImageUrls(product.image_urls);
  if (urls.length > 0) return urls;
  const single = product.image_url?.trim();
  return single ? [single] : [];
}
