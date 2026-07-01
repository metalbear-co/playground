"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NewBadge from "@/components/NewBadge";
import ProductImage from "@/components/ProductImage";
import { getPrimaryImageUrl, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * "You might also like" — fetches the catalog and suggests other products
 * to buy alongside the one currently being viewed. Prioritizes new arrivals
 * and in-stock items, excludes the current product, and caps the list.
 */
export default function ProductSuggestions({
  currentProductId,
  max = 4,
}: {
  currentProductId: number;
  max?: number;
}) {
  const [suggestions, setSuggestions] = useState<Product[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${basePath}/api/products`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load"))))
      .then((products: Product[]) => {
        if (cancelled) return;
        const picks = products
          .filter((p) => p.id !== currentProductId)
          .sort((a, b) => {
            // Surface fresh, purchasable items first.
            const score = (p: Product) =>
              (p.is_new ? 2 : 0) + (p.stock > 0 ? 1 : 0);
            return score(b) - score(a);
          })
          .slice(0, max);
        setSuggestions(picks);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProductId, max]);

  if (suggestions.length === 0) return null;

  return (
    <section className="mt-16 border-t border-slate-200 pt-10">
      <h2 className="hand-drawn-underline mb-8 inline-block text-2xl font-bold tracking-tight text-slate-900">
        You might also like
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
        {suggestions.map((p, i) => {
          const image = getPrimaryImageUrl(p);
          return (
            <Link
              key={p.id}
              href={`/products/${p.id}`}
              className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#6a4ff5]/30 hover:shadow-xl hover:shadow-[#6a4ff5]/10 animate-card-reveal"
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              {p.is_new && <NewBadge size="default" />}
              <div className="relative aspect-square overflow-hidden bg-slate-100">
                {image ? (
                  <ProductImage
                    src={image}
                    alt={p.name}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
                    No image
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-semibold text-slate-900 group-hover:text-[#6a4ff5] transition-colors">
                  {p.name}
                </h3>
                <p className="mt-1 font-semibold text-[#6a4ff5]">
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
