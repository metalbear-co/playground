"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import NewBadge from "@/components/NewBadge";
import ProductImage from "@/components/ProductImage";
import { getImageUrls, type Product } from "@/lib/product";

export default function ProductDialog({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selected image when product changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [product.id]);

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const imageUrls = getImageUrls(product);
  const labels = imageUrls.length === 2 ? ["Front", "Back"] : undefined;
  const price = `$${(product.price_cents / 100).toFixed(2)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-dialog-backdrop"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Dialog panel */}
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl animate-dialog-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-slate-500 backdrop-blur-sm transition-colors hover:bg-slate-100 hover:text-slate-900"
          aria-label="Close dialog"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="grid gap-6 p-6 sm:grid-cols-2 sm:gap-8 sm:p-8">
          {/* Image gallery */}
          <div className="space-y-3">
            <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {product.is_new && <NewBadge size="lg" />}
              {imageUrls.length > 0 ? (
                <ProductImage
                  src={imageUrls[selectedIndex]}
                  alt={
                    labels
                      ? `${product.name} — ${labels[selectedIndex]}`
                      : product.name
                  }
                  className="h-full w-full object-cover"
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
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
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {product.name}
            </h2>
            <p className="mt-2 text-xl font-semibold text-[#6a4ff5]">{price}</p>
            {product.description && (
              <p className="mt-4 text-slate-600 leading-relaxed">
                {product.description}
              </p>
            )}
            <p className="mt-3 text-sm text-slate-500">
              In stock: {product.stock}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/cart?add=${product.id}`}
                className="btn-primary inline-flex items-center justify-center rounded-xl px-6 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
              >
                Add to cart
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary inline-flex items-center justify-center rounded-xl px-5 py-3 font-medium focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:ring-offset-2"
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
