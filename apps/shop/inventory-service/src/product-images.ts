type ProductRow = {
  id: number;
  image_url: string | null;
  image_urls: unknown;
};

/** Canonical Cloudinary public IDs for catalogue rows with known stale/corrupt DB data. */
const CANONICAL_IMAGE_URLS: Readonly<Record<number, readonly string[]>> = {
  2: [
    "team_Work_makes_the_Dream_Work_-_front_w5qdnb",
    "team_work_makes_the_dream_work_-_back_onanux",
  ],
};

const BROKEN_IMAGE_MARKERS = ["mirrord-hoodie", "samples/mirrord-hoodie"];

function isNonEmptyImageRef(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasBrokenImageRefs(urls: string[]): boolean {
  return urls.length === 0 || urls.some((url) => BROKEN_IMAGE_MARKERS.some((marker) => url.includes(marker)));
}

function parseImageUrls(image_urls: unknown, image_url: string | null): string[] {
  const fromArray = Array.isArray(image_urls)
    ? image_urls.filter(isNonEmptyImageRef)
    : [];
  if (fromArray.length > 0) return fromArray;
  return isNonEmptyImageRef(image_url) ? [image_url] : [];
}

export function normalizeProductImages<T extends ProductRow>(row: T): T {
  let urls = parseImageUrls(row.image_urls, row.image_url);
  const canonical = CANONICAL_IMAGE_URLS[row.id];
  if (canonical && hasBrokenImageRefs(urls)) {
    urls = [...canonical];
  }
  return {
    ...row,
    image_url: urls[0] ?? null,
    image_urls: urls,
  };
}
