"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import NewBadge from "@/components/NewBadge";
import ProductImage from "@/components/ProductImage";
import { getImageUrls, type Product } from "@/lib/product";

type ProductDialogProps = {
  product: Product;
  onClose: () => void;
};

export default function ProductDialog({ product, onClose }: ProductDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset image index when product changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [product.id]);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const imageUrls = getImageUrls(product);
  const labels = imageUrls.length === 2 ? ["Front", "Back"] : undefined;
  const price = `$${(product.price_cents / 100).toFixed(2)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Dialog content */}
      <div className="relative z-10 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl animate-dialog-in">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-md transition-colors hover:bg-slate-100 hover:text-slate-800"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="grid gap-6 p-6 md:grid-cols-2 md:gap-8 md:p-8">
          {/* Image gallery */}
          <div className="space-y-3">
            <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
              {product.is_new && <NewBadge size="lg" />}
              {imageUrls.length > 0 ? (
                <ProductImage
                  src={imageUrls[selectedIndex]}
                  alt={labels ? `${product.name} — ${labels[selectedIndex]}` : product.name}
                  className="h-full w-full object-cover"
                  fill
                  sizes="(max-width: 768px) 80vw, 40vw"
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
                    className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                      selectedIndex === i
                        ? "border-[#6a4ff5] ring-2 ring-[#6a4ff5]/30"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                    aria-label={labels ? labels[i] : `Image ${i + 1}`}
                  >
                    <ProductImage
                      src={url}
                      alt=""
                      width={56}
                      height={56}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product details */}
          <div className="flex flex-col">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
              {product.name}
            </h2>
            <p className="mt-2 text-2xl font-semibold text-[#6a4ff5]">{price}</p>
            {product.description && (
              <p className="mt-4 text-slate-600 leading-relaxed">{product.description}</p>
            )}
            <p className="mt-3 text-sm text-slate-500">In stock: {product.stock}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/cart?add=${product.id}`}
                className="btn-primary inline-flex items-center justify-center rounded-xl px-8 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
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
      </div>
    </div>
  );
}
