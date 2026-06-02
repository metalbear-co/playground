/** Canonical Cloudinary public IDs for catalogue rows that may be corrupted in shared DBs. */
const CATALOG_IMAGE_DEFAULTS: Record<number, string[]> = {
  2: [
    "team_Work_makes_the_Dream_Work_-_front_w5qdnb",
    "team_work_makes_the_dream_work_-_back_onanux",
  ],
};

function parseImageUrlsField(image_urls: unknown): string[] {
  if (Array.isArray(image_urls)) {
    return image_urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
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

/** Normalize image_urls from Postgres / legacy image_url for API responses. */
export function normalizeImageUrls(
  image_urls: unknown,
  image_url: unknown,
  productId?: number
): string[] {
  let urls = parseImageUrlsField(image_urls);

  if (urls.length === 0 && typeof image_url === "string" && image_url.trim()) {
    urls = [image_url.trim()];
  }

  if (urls.length === 0 && productId != null && CATALOG_IMAGE_DEFAULTS[productId]) {
    return [...CATALOG_IMAGE_DEFAULTS[productId]];
  }

  return urls;
}

export function mapProductRow<T extends { id: number; image_url?: unknown; image_urls?: unknown }>(
  row: T
): T & { image_urls: string[]; image_url: string | null } {
  const image_urls = normalizeImageUrls(row.image_urls, row.image_url, row.id);
  const image_url = image_urls[0] ?? null;
  return { ...row, image_urls, image_url };
}
