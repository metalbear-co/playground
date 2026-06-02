/** Product from inventory API. image_urls preferred; image_url for legacy. */
export type Product = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  image_url?: string | null;
  image_urls?: string[] | string | null;
  is_new?: boolean;
};

const CATALOG_IMAGE_DEFAULTS: Record<number, string[]> = {
  2: [
    "team_Work_makes_the_Dream_Work_-_front_w5qdnb",
    "team_work_makes_the_dream_work_-_back_onanux",
  ],
};

function parseImageUrlsField(image_urls: Product["image_urls"]): string[] {
  if (Array.isArray(image_urls)) {
    return image_urls.filter((u) => typeof u === "string" && u.trim().length > 0);
  }
  if (typeof image_urls !== "string" || !image_urls.trim()) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(image_urls);
    if (Array.isArray(parsed)) {
      return parsed.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
    }
    if (typeof parsed === "string" && parsed.trim()) {
      return [parsed.trim()];
    }
  } catch {
    return [image_urls.trim()];
  }
  return [];
}

/** All image URLs for product (front, back, etc.). */
export function getImageUrls(product: Product): string[] {
  let urls = parseImageUrlsField(product.image_urls);
  if (urls.length === 0) {
    const single = product.image_url?.trim();
    if (single) urls = [single];
  }
  if (urls.length === 0 && CATALOG_IMAGE_DEFAULTS[product.id]) {
    return [...CATALOG_IMAGE_DEFAULTS[product.id]];
  }
  return urls;
}

/** Primary image for thumbnails (first in array, or legacy image_url). */
export function getPrimaryImageUrl(product: Product): string | null {
  const urls = getImageUrls(product);
  return urls[0] ?? null;
}
