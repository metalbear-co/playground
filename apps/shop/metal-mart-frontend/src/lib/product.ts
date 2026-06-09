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

function normalizeImageUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  return trimmed ? trimmed : null;
}

function normalizeImageUrls(urls: string[] | null | undefined): string[] {
  return urls?.map(normalizeImageUrl).filter((url): url is string => url !== null) ?? [];
}

/** Primary image for thumbnails (first in array, or legacy image_url). */
export function getPrimaryImageUrl(product: Product): string | null {
  const urls = normalizeImageUrls(product.image_urls);
  if (urls.length > 0) return urls[0];
  return normalizeImageUrl(product.image_url);
}

/** All image URLs for product (front, back, etc.). */
export function getImageUrls(product: Product): string[] {
  const urls = normalizeImageUrls(product.image_urls);
  if (urls.length > 0) return urls;
  const single = normalizeImageUrl(product.image_url);
  return single ? [single] : [];
}
