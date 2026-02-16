"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import LoadingSpinner from "@/components/LoadingSpinner";
import NewBadge from "@/components/NewBadge";
import ProductImage from "@/components/ProductImage";
import { getPrimaryImageUrl, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${basePath}/api/products`)
      .then((r) => r.json())
      .then(setProducts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <Header />
        <main className="flex-1 p-8">
          <LoadingSpinner />
        </main>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <Header />
        <main className="flex-1 p-8">
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-600">
            Error: {error}
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-6xl">
          <h1 className="hand-drawn-underline mb-10 inline-block text-2xl font-bold tracking-tight text-slate-900">
            Products
          </h1>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((p, i) => (
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
                <div className="flex flex-1 flex-col p-5">
                  <h2 className="font-semibold text-slate-900 group-hover:text-[#6a4ff5] transition-colors">
                    {p.name}
                  </h2>
                  <p className="mt-2 text-lg font-semibold text-[#6a4ff5]">${(p.price_cents / 100).toFixed(2)}</p>
                  <p className="mt-auto pt-3 text-xs text-slate-500">In stock: {p.stock}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
