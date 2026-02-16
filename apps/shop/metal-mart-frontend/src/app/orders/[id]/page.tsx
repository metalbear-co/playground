"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import LoadingSpinner from "@/components/LoadingSpinner";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type OrderItem = { productId: number; quantity: number };
type Order = {
  id: number;
  items: OrderItem[];
  total_cents: number;
  status: string;
  created_at: string;
};
type Product = { id: number; name: string; price_cents: number };

export default function OrderPage() {
  const params = useParams();
  const id = params?.id as string;
  const [order, setOrder] = useState<Order | null>(null);
  const [delivery, setDelivery] = useState<{ status: string } | null>(null);
  const [lineItems, setLineItems] = useState<{ product: Product; quantity: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setError(null);
      try {
        const [orderRes, deliveryRes] = await Promise.all([
          fetch(`${basePath}/api/orders/${id}`),
          fetch(`${basePath}/api/deliveries/order/${id}`),
        ]);
        const ord = orderRes.ok ? await orderRes.json() : null;
        const del = deliveryRes.ok ? await deliveryRes.json() : null;
        if (orderRes.ok) setOrder(ord);
        else {
          const body = await orderRes.json().catch(() => ({}));
          setError((body as { error?: string })?.error || `Order API returned ${orderRes.status}`);
        }
        if (deliveryRes.ok) setDelivery(del);
        if (ord?.items?.length) {
          const products = await Promise.all(
            ord.items.map(async (item: OrderItem) => {
              const r = await fetch(`${basePath}/api/products/${item.productId}`);
              const p = r.ok ? await r.json() : { id: item.productId, name: `Product ${item.productId}`, price_cents: 0 };
              return { product: p, quantity: item.quantity };
            })
          );
          setLineItems(products);
        }
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load order");
        setLoading(false);
      }
    };
    load();
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

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="mb-8 text-2xl font-bold tracking-tight text-slate-900">
            Order #{order?.id ?? id ?? "—"}
          </h1>
          {error && (
            <p
              className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-600"
              role="alert"
            >
              {error}
            </p>
          )}
          {order ? (
            <div className="space-y-8">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-2">
                <p>
                  Status: <span className="font-medium text-[#6a4ff5]">{order.status}</span>
                </p>
                <p className="text-slate-600">
                  Placed: {new Date(order.created_at).toLocaleString()}
                </p>
                {delivery && (
                  <p className="text-slate-600">Delivery: {delivery.status}</p>
                )}
              </div>
              {lineItems.length > 0 && (
                <div>
                  <h2 className="mb-3 text-lg font-semibold text-slate-900">Items</h2>
                  <ul className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-5">
                    {lineItems.map(({ product, quantity }) => (
                      <li
                        key={product.id}
                        className="flex justify-between text-slate-700"
                      >
                        <span>{product.name} × {quantity}</span>
                        <span className="font-semibold text-[#6a4ff5]">
                          ${((product.price_cents * quantity) / 100).toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-lg font-semibold text-slate-900">
                    Total: ${(order.total_cents / 100).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          ) : !error ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-8 py-16 text-center">
              <p className="text-slate-600">Order not found</p>
              <Link
                href="/products"
                className="mt-6 inline-block text-[#6a4ff5] hover:text-[#5a3fe5]"
              >
                ← Back to products
              </Link>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
