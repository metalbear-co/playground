"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import LoadingSpinner from "@/components/LoadingSpinner";
import ProductImage from "@/components/ProductImage";
import { getPrimaryImageUrl, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function CartPage() {
  const [cart, setCart] = useState<{ productId: number; quantity: number; product?: Product }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem("metal-mart-cart");
    const items: { productId: number; quantity: number }[] = raw ? JSON.parse(raw) : [];
    const addId = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("add");
    if (addId) {
      const id = parseInt(addId, 10);
      const existing = items.find((i) => i.productId === id);
      if (existing) existing.quantity++;
      else items.push({ productId: id, quantity: 1 });
      localStorage.setItem("metal-mart-cart", JSON.stringify(items));
      window.history.replaceState({}, "", `${basePath}/cart`);
    }
    Promise.all(
      items.map(async (i) => {
        const r = await fetch(`${basePath}/api/products/${i.productId}`);
        const p = await r.json();
        return { ...i, product: p };
      })
    ).then((enriched) => {
      setCart(enriched);
      setLoading(false);
    });
  }, []);

  const updateQty = (productId: number, delta: number) => {
    const next = cart
      .map((i) => (i.productId === productId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i))
      .filter((i) => i.quantity > 0);
    setCart(next);
    localStorage.setItem(
      "metal-mart-cart",
      JSON.stringify(next.map(({ productId, quantity }) => ({ productId, quantity })))
    );
  };

  const totalCents = cart.reduce((s, i) => s + (i.product?.price_cents ?? 0) * i.quantity, 0);

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

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-8 text-2xl font-bold tracking-tight text-slate-900">Cart</h1>
          {cart.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-8 py-16 text-center">
              <p className="text-lg text-slate-600">Your cart is empty.</p>
              <Link
                href="/products"
                className="btn-primary mt-6 inline-block rounded-xl px-6 py-2.5 font-medium focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
              >
                Browse products
              </Link>
            </div>
          ) : (
            <>
              <ul className="space-y-4">
                {cart.map((i) => (
                  <li
                    key={i.productId}
                    className="flex items-center gap-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:border-[#6a4ff5]/20"
                  >
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {i.product && getPrimaryImageUrl(i.product) ? (
                        <ProductImage
                          src={getPrimaryImageUrl(i.product)!}
                          alt={i.product.name}
                          className="h-full w-full object-cover"
                          width={80}
                          height={80}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                          —
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-slate-900">
                        {i.product?.name ?? `Product ${i.productId}`}
                      </span>
                    </div>
                    <span className="shrink-0 font-semibold text-[#6a4ff5]">
                      ${(((i.product?.price_cents ?? 0) * i.quantity) / 100).toFixed(2)}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => updateQty(i.productId, -1)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 hover:border-[#6a4ff5]/30 focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40"
                      >
                        −
                      </button>
                      <span className="min-w-[1.5rem] text-center font-medium text-slate-900">{i.quantity}</span>
                      <button
                        onClick={() => updateQty(i.productId, 1)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 hover:border-[#6a4ff5]/30 focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40"
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xl font-semibold text-slate-900">
                  Total: ${(totalCents / 100).toFixed(2)}
                </p>
                <Link
                  href="/checkout"
                  className="btn-primary inline-flex w-fit items-center justify-center rounded-xl px-8 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
                >
                  Checkout
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
