"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import LoadingSpinner from "@/components/LoadingSpinner";

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
  if (error || !product) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <Header />
        <main className="flex-1 p-8">
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-600">
            {error || "Product not found"}
          </p>
          <Link
            href="/products"
            className="mt-4 inline-block text-[#6a4ff5] hover:text-[#5a3fe5]"
          >
            ← Back to products
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-10 md:grid-cols-2">
            <div className="aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-lg">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-400">
                  No image
                </div>
              )}
            </div>
            <div className="flex flex-col">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">{product.name}</h1>
              <p className="mt-3 text-2xl font-semibold text-[#6a4ff5]">
                ${(product.price_cents / 100).toFixed(2)}
              </p>
              {product.description && (
                <p className="mt-6 text-slate-600 leading-relaxed">{product.description}</p>
              )}
              <p className="mt-4 text-sm text-slate-500">In stock: {product.stock}</p>
              <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                <Link
                  href={`/cart?add=${product.id}`}
                  className="btn-primary inline-flex w-fit items-center justify-center rounded-xl px-8 py-3.5 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
                >
                  Add to cart
                </Link>
                <Link
                  href="/products"
                  className="btn-secondary inline-flex items-center justify-center rounded-xl px-6 py-3 font-medium focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:ring-offset-2"
                >
                  ← Back to products
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
