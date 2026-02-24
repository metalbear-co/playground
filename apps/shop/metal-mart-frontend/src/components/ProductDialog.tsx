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
  product: Product | null;
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset image index when product changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [product?.id]);

  // Lock body scroll when open
  useEffect(() => {
    if (product) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [product]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (product) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [product, handleKeyDown]);

  if (!product) return null;

  const imageUrls = getImageUrls(product);
  const labels = imageUrls.length === 2 ? ["Front", "Back"] : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in-backdrop"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl animate-dialog-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm backdrop-blur-sm transition-colors hover:bg-white hover:text-slate-900"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="grid gap-6 p-6 md:grid-cols-2 md:gap-8 md:p-8">
          {/* Image gallery */}
          <div className="space-y-3">
            <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-lg">
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

          {/* Product details */}
          <div className="flex flex-col">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {product.name}
            </h2>
            <p className="mt-3 text-2xl font-semibold text-[#6a4ff5]">
              ${(product.price_cents / 100).toFixed(2)}
            </p>
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
                className="btn-primary inline-flex w-fit items-center justify-center rounded-xl px-8 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
              >
                Add to cart
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
