"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Product = {
  id: number;
  name: string;
  price_cents: number;
  image_url: string | null;
};

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

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 p-8">
        <h1 className="mb-6 text-2xl font-bold">Cart</h1>
        {cart.length === 0 ? (
          <p className="text-slate-400">Your cart is empty.</p>
        ) : (
          <>
            <ul className="space-y-4">
              {cart.map((i) => (
                <li key={i.productId} className="flex items-center gap-4 rounded-lg border border-slate-700 p-4">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-slate-700">
                    {i.product?.image_url ? (
                      <img
                        src={i.product.image_url}
                        alt={i.product.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-500 text-xs">
                        —
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{i.product?.name ?? `Product ${i.productId}`}</span>
                  </div>
                  <span className="text-amber-400 shrink-0">${(((i.product?.price_cents ?? 0) * i.quantity) / 100).toFixed(2)}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => updateQty(i.productId, -1)}
                      className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
                    >
                      -
                    </button>
                    <span>{i.quantity}</span>
                    <button
                      onClick={() => updateQty(i.productId, 1)}
                      className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xl font-semibold">Total: ${(totalCents / 100).toFixed(2)}</p>
            <Link
              href={`${basePath}/checkout`}
              className="mt-4 inline-block rounded-lg bg-amber-500 px-6 py-2 font-medium text-slate-900 hover:bg-amber-400"
            >
              Checkout
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
