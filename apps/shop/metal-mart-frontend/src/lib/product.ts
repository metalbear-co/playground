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

function nonEmptyImageRefs(urls: (string | null | undefined)[] | null | undefined): string[] {
  if (!urls) return [];
  return urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

/** Primary image for thumbnails (first in array, or legacy image_url). */
export function getPrimaryImageUrl(product: Product): string | null {
  const urls = nonEmptyImageRefs(product.image_urls);
  if (urls.length > 0) return urls[0];
  const legacy = product.image_url;
  return legacy && legacy.trim().length > 0 ? legacy : null;
}

/** All image URLs for product (front, back, etc.). */
export function getImageUrls(product: Product): string[] {
  const urls = nonEmptyImageRefs(product.image_urls);
  if (urls.length > 0) return urls;
  const single = product.image_url;
  return single && single.trim().length > 0 ? [single] : [];
}
