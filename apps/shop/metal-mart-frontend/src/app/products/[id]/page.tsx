"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Product = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  image_url: string | null;
};

export default function ProductDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${basePath}/api/products/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Product not found");
        return r.json();
      })
      .then(setProduct)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (error || !product) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-slate-700 px-6 py-4">
          <Link href={`${basePath}/products`} className="text-xl font-bold text-amber-400">
            MetalMart
          </Link>
        </header>
        <main className="flex-1 p-8">
          <p className="text-red-400">{error || "Product not found"}</p>
          <Link href={`${basePath}/products`} className="mt-4 inline-block text-amber-400 hover:underline">
            ← Back to products
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-700 px-6 py-4">
        <Link href={`${basePath}`} className="text-xl font-bold text-amber-400">
          MetalMart
        </Link>
        <div className="mt-2 flex gap-4">
          <Link href={`${basePath}/products`} className="text-slate-300 hover:text-white">
            Products
          </Link>
          <Link href={`${basePath}/cart`} className="text-slate-300 hover:text-white">
            Cart
          </Link>
        </div>
      </header>
      <main className="flex-1 p-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-8 md:grid-cols-2">
            <div className="aspect-square overflow-hidden rounded-lg bg-slate-800">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-500">
                  No image
                </div>
              )}
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold text-slate-100">{product.name}</h1>
              <p className="mt-2 text-xl text-amber-400">${(product.price_cents / 100).toFixed(2)}</p>
              {product.description && (
                <p className="mt-4 text-slate-300 leading-relaxed">{product.description}</p>
              )}
              <p className="mt-2 text-sm text-slate-500">In stock: {product.stock}</p>
              <Link
                href={`${basePath}/cart?add=${product.id}`}
                className="mt-8 inline-block w-fit rounded-lg bg-amber-500 px-6 py-3 font-medium text-slate-900 hover:bg-amber-400"
              >
                Add to cart
              </Link>
              <Link
                href={`${basePath}/products`}
                className="mt-4 text-slate-400 hover:text-white"
              >
                ← Back to products
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
