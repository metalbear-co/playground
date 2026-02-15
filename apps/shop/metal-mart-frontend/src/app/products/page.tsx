"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Product = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  image_url: string | null;
};

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

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-700 px-6 py-4">
        <Link href="/" className="text-xl font-bold text-amber-400">
          MetalMart
        </Link>
        <div className="mt-2 flex gap-4">
          <Link href="/products" className="text-slate-300 hover:text-white">
            Products
          </Link>
          <Link href="/cart" className="text-slate-300 hover:text-white">
            Cart
          </Link>
        </div>
      </header>
      <main className="flex-1 p-8">
        <h1 className="mb-6 text-2xl font-bold">Products</h1>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((p) => (
            <Link
              key={p.id}
              href={`${basePath}/products/${p.id}`}
              className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden transition hover:border-amber-500/50 flex flex-col"
            >
              <div className="aspect-square bg-slate-700 relative">
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                    No image
                  </div>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <h2 className="font-semibold text-slate-100">{p.name}</h2>
                <p className="mt-2 text-amber-400 font-medium">${(p.price_cents / 100).toFixed(2)}</p>
                <p className="mt-auto pt-2 text-xs text-slate-500">In stock: {p.stock}</p>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
