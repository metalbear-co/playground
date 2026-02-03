"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Product = {
  id: number;
  name: string;
  price_cents: number;
};

export default function CheckoutPage() {
  const [cart, setCart] = useState<{ productId: number; quantity: number; product?: Product }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("metal-mart-cart");
    const items: { productId: number; quantity: number }[] = raw ? JSON.parse(raw) : [];
    Promise.all(
      items.map(async (i) => {
        const r = await fetch(`${basePath}/api/products/${i.productId}`);
        const p = await r.json();
        return { ...i, product: p };
      })
    ).then(setCart).finally(() => setLoading(false));
  }, []);

  const totalCents = cart.reduce((s, i) => s + (i.product?.price_cents ?? 0) * i.quantity, 0);
  const orderItems = cart.map(({ productId, quantity }) => ({ productId, quantity }));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`${basePath}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: orderItems, total_cents: totalCents }),
      });
      const data = await r.json();
      if (r.ok) {
        setOrderId(data.orderId);
        localStorage.removeItem("metal-mart-cart");
      } else {
        alert(data.error || "Checkout failed");
      }
    } catch (e) {
      alert("Checkout failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

  if (orderId) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-slate-700 px-6 py-4">
          <Link href="/" className="text-xl font-bold text-amber-400">
            MetalMart
          </Link>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <h1 className="text-2xl font-bold text-green-400">Order placed!</h1>
          <p className="text-slate-400">Order ID: {orderId}</p>
          <Link
            href={`/orders/${orderId}`}
            className="rounded-lg bg-amber-500 px-6 py-2 font-medium text-slate-900 hover:bg-amber-400"
          >
            Track order
          </Link>
        </main>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-slate-700 px-6 py-4">
          <Link href="/" className="text-xl font-bold text-amber-400">
            MetalMart
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center p-8">
          <p className="text-slate-400">Cart is empty. Add items first.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-700 px-6 py-4">
        <Link href="/" className="text-xl font-bold text-amber-400">
          MetalMart
        </Link>
      </header>
      <main className="flex-1 p-8">
        <h1 className="mb-6 text-2xl font-bold">Checkout</h1>
        <p className="mb-4 text-slate-400">Total: ${(totalCents / 100).toFixed(2)}</p>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-lg bg-amber-500 px-6 py-2 font-medium text-slate-900 hover:bg-amber-400 disabled:opacity-50"
        >
          {submitting ? "Placing order..." : "Place order"}
        </button>
      </main>
    </div>
  );
}
