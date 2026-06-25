"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NewBadge from "@/components/NewBadge";
import ProductImage from "@/components/ProductImage";
import { getPrimaryImageUrl, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * "You might also like" suggestions shown beneath a product.
 * Fetches the catalog, excludes the current product, and surfaces a handful
 * of other items, preferring those closest in price (a lightweight stand-in
 * for "similar" without a recommendation backend).
 */
export default function SuggestedProducts({
  product,
  limit = 4,
}: {
  product: Product;
  limit?: number;
}) {
  const [suggestions, setSuggestions] = useState<Product[]>([]);

  useEffect(() => {
    let active = true;
    fetch(`${basePath}/api/products`)
      .then((r) => r.json())
      .then((all: Product[]) => {
        if (!active || !Array.isArray(all)) return;
        const others = all
          .filter((p) => p.id !== product.id)
          .sort(
            (a, b) =>
              Math.abs(a.price_cents - product.price_cents) -
              Math.abs(b.price_cents - product.price_cents),
          )
          .slice(0, limit);
        setSuggestions(others);
      })
      .catch(() => {
        if (active) setSuggestions([]);
      });
    return () => {
      active = false;
    };
  }, [product.id, product.price_cents, limit]);

  if (suggestions.length === 0) return null;

  return (
    <section className="mt-16 border-t border-slate-200 pt-10">
      <h2 className="hand-drawn-underline mb-8 inline-block text-2xl font-bold tracking-tight text-slate-900">
        You might also like
      </h2>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
        {suggestions.map((p, i) => (
          <Link
            key={p.id}
            href={`/products/${p.id}`}
            className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#6a4ff5]/30 hover:shadow-xl hover:shadow-[#6a4ff5]/10 animate-card-reveal"
            style={{ animationDelay: `${i * 0.06}s` }}
          >
            {p.is_new && <NewBadge size="default" />}
            <div className="relative aspect-square overflow-hidden bg-slate-100">
              {getPrimaryImageUrl(p) ? (
                <ProductImage
                  src={getPrimaryImageUrl(p)!}
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
        ))}
      </div>
    </section>
  );
}
