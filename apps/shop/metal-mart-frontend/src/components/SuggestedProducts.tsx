"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProductImage from "@/components/ProductImage";
import { getPrimaryImageUrl, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type SuggestedProductsProps = {
  currentProductId: number;
};

export default function SuggestedProducts({ currentProductId }: SuggestedProductsProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${basePath}/api/products`)
      .then((r) => r.json())
      .then((all: Product[]) => {
        const others = all.filter((p) => p.id !== currentProductId);
        // Shuffle and pick up to 6 suggestions
        const shuffled = others.sort(() => Math.random() - 0.5);
        setProducts(shuffled.slice(0, 6));
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [currentProductId]);

  if (loading || products.length === 0) return null;

  return (
    <section className="mt-16">
      <h2 className="hand-drawn-underline mb-6 inline-block text-xl font-bold tracking-tight text-slate-900">
        You might also like
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
        {products.map((p) => (
          <Link
            key={p.id}
            href={`/products/${p.id}`}
            className="group flex w-44 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#6a4ff5]/30 hover:shadow-lg hover:shadow-[#6a4ff5]/10"
          >
            <div className="relative aspect-square overflow-hidden bg-slate-100">
              {getPrimaryImageUrl(p) ? (
                <ProductImage
                  src={getPrimaryImageUrl(p)!}
                  alt={p.name}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  fill
                  sizes="176px"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                  No image
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col p-3">
              <h3 className="text-sm font-semibold text-slate-900 leading-snug group-hover:text-[#6a4ff5] transition-colors line-clamp-2">
                {p.name}
              </h3>
              <p className="mt-1.5 text-sm font-semibold text-[#6a4ff5]">
                ${(p.price_cents / 100).toFixed(2)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
