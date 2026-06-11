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

/** Primary image for thumbnails (first in array, or legacy image_url). */
export function getPrimaryImageUrl(product: Product): string | null {
  return getImageUrls(product)[0] ?? null;
}

/** All image URLs for product (front, back, etc.). */
export function getImageUrls(product: Product): string[] {
  const urls = product.image_urls
    ?.map((url) => normalizeImageUrl(url))
    .filter((url): url is string => url !== null);
  if (urls && urls.length > 0) return urls;

  const single = normalizeImageUrl(product.image_url);
  return single ? [single] : [];
}
