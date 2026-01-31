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

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const [orderRes, deliveryRes] = await Promise.all([
        fetch(basePath ? `${basePath}/api/orders/${id}` : `/api/orders/${id}`),
        fetch(basePath ? `${basePath}/api/deliveries/order/${id}` : `/api/deliveries/order/${id}`),
      ]);
      const ord = await orderRes.json();
      const del = await deliveryRes.json();
      if (orderRes.ok) setOrder(ord);
      if (deliveryRes.ok) setDelivery(del);
      setLoading(false);
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
        <h1 className="mb-6 text-2xl font-bold">Order #{order?.id ?? "—"}</h1>
        {order ? (
          <div className="space-y-2">
            <p>Status: <span className="text-amber-400">{order.status}</span></p>
            <p className="text-slate-400">Placed: {new Date(order.created_at).toLocaleString()}</p>
            {delivery && <p>Delivery: {delivery.status}</p>}
          </div>
        ) : (
          <p className="text-slate-400">Order not found</p>
        )}
      </main>
    </div>
  );
}
