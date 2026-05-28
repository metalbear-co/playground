export type ProductRow = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  image_url?: string | null;
  image_urls?: unknown;
  is_new?: boolean;
};

/** API representation: stored name unchanged; response uses lowercase. */
export function toProductRepresentation(row: ProductRow) {
  return {
    ...row,
    name: row.name.toLowerCase(),
  };
}
