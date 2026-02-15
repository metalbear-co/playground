"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";

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

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 p-8">
        <h1 className="mb-6 text-2xl font-bold">Order #{order?.id ?? id ?? "—"}</h1>
        {error && (
          <p className="mb-4 text-red-400" role="alert">
            {error}
          </p>
        )}
        {order ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <p>Status: <span className="text-amber-400">{order.status}</span></p>
              <p className="text-slate-400">Placed: {new Date(order.created_at).toLocaleString()}</p>
              {delivery && <p>Delivery: {delivery.status}</p>}
            </div>
            {lineItems.length > 0 && (
              <div>
                <h2 className="mb-3 text-lg font-semibold">Items</h2>
                <ul className="space-y-2 rounded-lg border border-slate-700 p-4">
                  {lineItems.map(({ product, quantity }) => (
                    <li key={product.id} className="flex justify-between text-slate-300">
                      <span>{product.name} × {quantity}</span>
                      <span className="text-amber-400">
                        ${((product.price_cents * quantity) / 100).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-lg font-semibold">Total: ${(order.total_cents / 100).toFixed(2)}</p>
              </div>
            )}
          </div>
        ) : !error ? (
          <p className="text-slate-400">Order not found</p>
        ) : null}
      </main>
    </div>
  );
}
