"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import LoadingSpinner from "@/components/LoadingSpinner";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Product = {
  id: number;
  name: string;
  price_cents: number;
  image_url?: string | null;
  image_urls?: string[] | null;
};

export default function CheckoutPage() {
  const [cart, setCart] = useState<{ productId: number; quantity: number; product?: Product }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [giftWrap, setGiftWrap] = useState(false);

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
  const giftWrapFeeCents = giftWrap ? 499 : 0;
  const checkoutTotalCents = totalCents + giftWrapFeeCents;
  const orderItems = cart.map(({ productId, quantity }) => ({ productId, quantity }));

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch(`${basePath}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: orderItems,
          total_cents: totalCents,
          gift_wrap: giftWrap,
          ...(email ? { customer_email: email } : {}),
        }),
      });
      const data = await r.json();
      if (r.ok) {
        setOrderId(data.orderId);
        localStorage.removeItem("metal-mart-cart");
      } else {
        setError(data.error || "Checkout failed");
      }
    } catch (e) {
      setError("Checkout failed");
    } finally {
      setSubmitting(false);
    }
  };

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

  if (orderId) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <Header />
        <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
          <div className="rounded-full bg-green-100 p-4">
            <svg
              className="h-12 w-12 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-green-600">Order placed!</h1>
          <p className="text-slate-600">Order ID: {orderId}</p>
          <Link
            href={`/orders/${orderId}`}
            className="btn-primary rounded-xl px-8 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
          >
            Track order
          </Link>
        </main>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <Header />
        <main className="flex flex-1 items-center justify-center px-6 py-16">
          <div className="rounded-xl border border-slate-300 bg-slate-50 px-8 py-16 text-center">
            <p className="text-lg text-slate-600">Cart is empty. Add items first.</p>
            <Link
              href="/products"
              className="btn-primary mt-6 inline-block rounded-xl px-6 py-2.5 font-medium focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
            >
              Browse products
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="hand-drawn-underline mb-8 inline-block text-2xl font-bold tracking-tight text-slate-900">
            Checkout
          </h1>
          <ul className="mb-6 space-y-3 rounded-xl border border-slate-300 bg-slate-50 p-5">
            {cart.map((i) => (
              <li key={i.productId} className="flex items-center justify-between">
                <span className="text-slate-700">
                  {i.product?.name ?? `Product ${i.productId}`} × {i.quantity}
                </span>
                <span className="font-semibold text-[#6a4ff5]">
                  ${(((i.product?.price_cents ?? 0) * i.quantity) / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mb-6 space-y-4 rounded-xl border border-slate-300 bg-white p-5">
            <label
              htmlFor="gift-wrap"
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <input
                id="gift-wrap"
                type="checkbox"
                checked={giftWrap}
                onChange={(e) => setGiftWrap(e.target.checked)}
                data-testid="gift-wrap-checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-[#6a4ff5] focus:ring-[#6a4ff5]"
              />
              <div>
                <p className="font-medium text-slate-900">🎁 Gift wrap this order (+$4.99)</p>
                <p className="text-sm text-slate-500">A demo-only wrap option added at checkout.</p>
              </div>
            </label>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span>${(totalCents / 100).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between" data-testid="gift-wrap-fee">
                <span>Gift wrap</span>
                <span>{giftWrap ? "$4.99" : "$0.00"}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xl font-semibold text-slate-900">
                <span>Total</span>
                <span data-testid="checkout-total">${(checkoutTotalCents / 100).toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="mb-6">
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
              Email <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:border-[#6a4ff5] focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/20"
            />
          </div>
          {error && (
            <p
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-600"
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="place-order-button"
            className="btn-primary w-full rounded-xl px-8 py-3.5 font-semibold disabled:opacity-50 disabled:transform-none disabled:shadow-none sm:w-fit focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
          >
            {submitting ? "Placing order..." : "Place order"}
          </button>
        </div>
      </main>
    </div>
  );
}
