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
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(basePath ? `${basePath}/api/products` : "/api/products")
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
        <Link href={basePath || "/"} className="text-xl font-bold text-amber-400">
          MetalMart
        </Link>
        <div className="mt-2 flex gap-4">
          <Link href={basePath ? `${basePath}/products` : "/products"} className="text-slate-300 hover:text-white">
            Products
          </Link>
          <Link href={basePath ? `${basePath}/cart` : "/cart"} className="text-slate-300 hover:text-white">
            Cart
          </Link>
        </div>
      </header>
      <main className="flex-1 p-8">
        <h1 className="mb-6 text-2xl font-bold">Products</h1>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((p) => (
            <div
              key={p.id}
              className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 transition hover:border-amber-500/50"
            >
              <h2 className="font-semibold text-slate-100">{p.name}</h2>
              <p className="mt-1 text-sm text-slate-400">{p.description}</p>
              <p className="mt-2 text-amber-400">${(p.price_cents / 100).toFixed(2)}</p>
              <p className="text-xs text-slate-500">In stock: {p.stock}</p>
              <Link
                href={basePath ? `${basePath}/cart?add=${p.id}` : `/cart?add=${p.id}`}
                className="mt-3 inline-block rounded bg-amber-500 px-3 py-1 text-sm font-medium text-slate-900 hover:bg-amber-400"
              >
                Add to cart
              </Link>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
