"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function OrderPage() {
  const params = useParams();
  const id = params?.id as string;
  const [order, setOrder] = useState<{ id: number; status: string; created_at: string } | null>(null);
  const [delivery, setDelivery] = useState<{ status: string } | null>(null);
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
      <header className="border-b border-slate-700 px-6 py-4">
        <Link href={basePath || "/"} className="text-xl font-bold text-amber-400">
          MetalMart
        </Link>
      </header>
      <main className="flex-1 p-8">
        <h1 className="mb-6 text-2xl font-bold">Order #{order?.id ?? id ?? "—"}</h1>
        {error && (
          <p className="mb-4 text-red-400" role="alert">
            {error}
          </p>
        )}
        {order ? (
          <div className="space-y-2">
            <p>Status: <span className="text-amber-400">{order.status}</span></p>
            <p className="text-slate-400">Placed: {new Date(order.created_at).toLocaleString()}</p>
            {delivery && <p>Delivery: {delivery.status}</p>}
          </div>
        ) : !error ? (
          <p className="text-slate-400">Order not found</p>
        ) : null}
      </main>
    </div>
  );
}
