"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProductImage from "@/components/ProductImage";
import NewBadge from "@/components/NewBadge";
import { getImageUrls, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function ProductModal({
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
    setLoading(true);
    setError(null);
    setSelectedIndex(0);
    fetch(`${basePath}/api/products/${productId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Product not found");
        return r.json();
      })
      .then(setProduct)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const imageUrls = product ? getImageUrls(product) : [];
  const labels = imageUrls.length === 2 ? ["Front", "Back"] : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl animate-card-reveal">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow backdrop-blur transition-colors hover:bg-white hover:text-slate-900"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
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
          <div className="grid gap-0 sm:grid-cols-2">
            {/* Image section */}
            <div className="relative aspect-square overflow-hidden bg-slate-50 sm:rounded-l-2xl">
              {product.is_new && <NewBadge size="lg" />}
              {imageUrls.length > 0 ? (
                <ProductImage
                  src={imageUrls[selectedIndex]}
                  alt={labels ? `${product.name} — ${labels[selectedIndex]}` : product.name}
                  className="h-full w-full object-cover"
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-400">
                  No image
                </div>
              )}
              {imageUrls.length > 1 && (
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
                  {imageUrls.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedIndex(i)}
                      className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                        selectedIndex === i
                          ? "border-[#6a4ff5] ring-2 ring-[#6a4ff5]/30"
                          : "border-white/80 hover:border-white"
                      }`}
                      aria-label={labels ? labels[i] : `Image ${i + 1}`}
                    >
                      <ProductImage
                        src={url}
                        alt=""
                        width={48}
                        height={48}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details section */}
            <div className="flex flex-col p-6">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                {product.name}
              </h2>
              <p className="mt-2 text-xl font-semibold text-[#6a4ff5]">
                ${(product.price_cents / 100).toFixed(2)}
              </p>
              {product.description && (
                <p className="mt-4 text-sm leading-relaxed text-slate-600">
                  {product.description}
                </p>
              )}
              <p className="mt-3 text-sm text-slate-500">In stock: {product.stock}</p>
              <div className="mt-auto flex flex-col gap-3 pt-6">
                <Link
                  href={`/cart?add=${product.id}`}
                  className="btn-primary inline-flex items-center justify-center rounded-xl px-6 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
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
