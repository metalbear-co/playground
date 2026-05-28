/** Product row fields used when normalizing catalogue images for API responses. */
export type ProductImageFields = {
  image_url?: string | null;
  image_urls?: unknown;
};

function trimUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Coerce DB JSONB / legacy values into a list of non-empty image URL strings. */
export function parseImageUrls(raw: unknown): string[] {
  if (raw == null) return [];

  let value: unknown = raw;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      const single = trimUrl(trimmed);
      return single ? [single] : [];
    }
  }

  if (Array.isArray(value)) {
    const urls: string[] = [];
    for (const item of value) {
      const url = trimUrl(item);
      if (url) urls.push(url);
    }
    return urls;
  }

  if (typeof value === "object") {
    const urls: string[] = [];
    for (const item of Object.values(value as Record<string, unknown>)) {
      const url = trimUrl(item);
      if (url) urls.push(url);
    }
    return urls;
  }

  return [];
}

/** Ensure clients always receive a clean image_urls array (and legacy image_url when useful). */
export function normalizeProductImages<T extends ProductImageFields>(product: T): T & { image_urls: string[] } {
  const image_url = trimUrl(product.image_url);
  let image_urls = parseImageUrls(product.image_urls);

  if (image_urls.length === 0 && image_url) {
    image_urls = [image_url];
  }

  return {
    ...product,
    image_url: image_url ?? product.image_url ?? null,
    image_urls,
  };
}
