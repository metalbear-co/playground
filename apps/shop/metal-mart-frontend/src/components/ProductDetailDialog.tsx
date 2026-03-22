"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NewBadge from "@/components/NewBadge";
import ProductImage from "@/components/ProductImage";
import { getImageUrls, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function ProductDetailDialog({
  productId,
  onClose,
}: {
  productId: number;
  onClose: () => void;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
    setLoading(true);
    setError(null);
    fetch(`${basePath}/api/products/${productId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Product not found");
        return r.json();
      })
      .then(setProduct)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [productId]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Prevent body scroll while dialog is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const imageUrls = product ? getImageUrls(product) : [];
  const labels = imageUrls.length === 2 ? ["Front", "Back"] : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl animate-card-reveal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {loading && (
          <div className="flex items-center justify-center p-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#6a4ff5]" />
          </div>
        )}

        {error && (
          <div className="p-8">
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-600">
              {error}
            </p>
          </div>
        )}

        {product && !loading && (
          <div className="grid gap-6 p-6 md:grid-cols-2">
            {/* Image gallery */}
            <div className="space-y-3">
              <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {product.is_new && <NewBadge size="lg" />}
                {imageUrls.length > 0 ? (
                  <ProductImage
                    src={imageUrls[selectedIndex]}
                    alt={labels ? `${product.name} — ${labels[selectedIndex]}` : product.name}
                    className="h-full w-full object-cover"
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                    No image
                  </div>
                )}
              </div>
              {imageUrls.length > 1 && (
                <div className="flex gap-2">
                  {imageUrls.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedIndex(i)}
                      className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                        selectedIndex === i
                          ? "border-[#6a4ff5] ring-2 ring-[#6a4ff5]/30"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                      aria-label={labels ? labels[i] : `Image ${i + 1}`}
                    >
                      <ProductImage
                        src={url}
                        alt=""
                        width={64}
                        height={64}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product info */}
            <div className="flex flex-col">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">{product.name}</h2>
              <p className="mt-3 text-2xl font-semibold text-[#6a4ff5]">
                ${(product.price_cents / 100).toFixed(2)}
              </p>
              {product.description && (
                <p className="mt-4 text-slate-600 leading-relaxed">{product.description}</p>
              )}
              <p className="mt-3 text-sm text-slate-500">In stock: {product.stock}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={`/cart?add=${product.id}`}
                  className="btn-primary inline-flex w-fit items-center justify-center rounded-xl px-8 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
                >
                  Add to cart
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary inline-flex items-center justify-center rounded-xl px-6 py-3 font-medium focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:ring-offset-2"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
