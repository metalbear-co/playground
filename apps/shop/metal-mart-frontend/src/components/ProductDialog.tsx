"use client";

import { useEffect, useState, useCallback } from "react";
import NewBadge from "@/components/NewBadge";
import ProductImage from "@/components/ProductImage";
import { getImageUrls, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function addToCart(productId: number) {
  const raw = localStorage.getItem("metal-mart-cart");
  const items: { productId: number; quantity: number }[] = raw
    ? JSON.parse(raw)
    : [];
  const existing = items.find((i) => i.productId === productId);
  if (existing) existing.quantity++;
  else items.push({ productId: productId, quantity: 1 });
  localStorage.setItem("metal-mart-cart", JSON.stringify(items));
}

export default function ProductDialog({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [added, setAdded] = useState(false);

  // Reset image index when product changes
  useEffect(() => {
    setSelectedIndex(0);
    setAdded(false);
  }, [product.id]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while dialog is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleAddToCart = useCallback(() => {
    addToCart(product.id);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }, [product.id]);

  const imageUrls = getImageUrls(product);
  const labels = imageUrls.length === 2 ? ["Front", "Back"] : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-dialog-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog panel */}
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl animate-dialog-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-slate-900"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
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

        <div className="grid gap-6 p-6 md:grid-cols-2 md:gap-8 md:p-8">
          {/* Image section */}
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
                  sizes="(max-width: 768px) 90vw, 40vw"
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

          {/* Details section */}
          <div className="flex flex-col">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
              {product.name}
            </h2>
            <p className="mt-2 text-2xl font-semibold text-[#6a4ff5]">
              ${(product.price_cents / 100).toFixed(2)}
            </p>
            {product.description && (
              <p className="mt-4 leading-relaxed text-slate-600">
                {product.description}
              </p>
            )}
            <p className="mt-3 text-sm text-slate-500">
              In stock: {product.stock}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleAddToCart}
                className="btn-primary inline-flex w-fit items-center justify-center rounded-xl px-8 py-3.5 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
              >
                {added ? "Added!" : "Add to cart"}
              </button>
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
