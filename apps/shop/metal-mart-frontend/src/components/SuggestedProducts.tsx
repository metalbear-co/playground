"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NewBadge from "./NewBadge";
import ProductImage from "./ProductImage";
import { getPrimaryImageUrl, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Props = {
  currentProductId: number;
  limit?: number;
};

export default function SuggestedProducts({ currentProductId, limit = 4 }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${basePath}/api/products`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Product[]) => {
        const others = Array.isArray(data)
          ? data.filter((p) => p.id !== currentProductId)
          : [];
        for (let i = others.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [others[i], others[j]] = [others[j], others[i]];
        }
        setProducts(others.slice(0, limit));
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [currentProductId, limit]);

  if (loading || products.length === 0) return null;

  return (
    <section
      aria-labelledby="suggested-products-heading"
      className="mt-16 border-t border-slate-200 pt-10"
      data-testid="suggested-products"
    >
      <h2
        id="suggested-products-heading"
        className="text-2xl font-bold tracking-tight text-slate-900"
      >
        You might also like
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        Hand-picked picks based on this product
      </p>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => {
          const imageUrl = getPrimaryImageUrl(p);
          return (
            <Link
              key={p.id}
              href={`/products/${p.id}`}
              data-testid="suggested-product-card"
              className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-all hover:-translate-y-0.5 hover:border-[#6a4ff5]/40 hover:shadow-lg"
            >
              <div className="relative aspect-square overflow-hidden bg-slate-50">
                {p.is_new && <NewBadge size="sm" />}
                {imageUrl ? (
                  <ProductImage
                    src={imageUrl}
                    alt={p.name}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                    No image
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-3">
                <h3 className="text-sm font-semibold text-slate-900 line-clamp-2">
                  {p.name}
                </h3>
                <p className="mt-2 text-base font-bold text-[#6a4ff5]">
                  ${(p.price_cents / 100).toFixed(2)}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
