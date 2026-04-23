"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import NewBadge from "./NewBadge";
import ProductImage from "./ProductImage";
import { getPrimaryImageUrl, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Props = {
  currentProductId: number;
  limit?: number;
};

const VISIBLE_COUNT = 4;

export default function SuggestedProducts({ currentProductId, limit = 12 }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    fetch(`${basePath}/api/products`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Product[]) => {
        const others = Array.isArray(data)
          ? data.filter((p) => p.id !== currentProductId)
          : [];
        for (let i = others.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [others[i], others[j]] = [others[j], others[i]];
        }
        setProducts(others.slice(0, limit));
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [currentProductId, limit]);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows, products.length]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const firstCard = el.querySelector<HTMLElement>('[data-testid="suggested-product-card"]');
    const cardWidth = firstCard?.offsetWidth ?? el.clientWidth / VISIBLE_COUNT;
    const gap = 16;
    el.scrollBy({ left: direction * (cardWidth + gap) * VISIBLE_COUNT, behavior: "smooth" });
  };

  if (loading || products.length === 0) return null;

  const showControls = products.length > VISIBLE_COUNT;

  return (
    <section
      aria-labelledby="suggested-products-heading"
      className="mt-16 border-t border-slate-200 pt-10"
      data-testid="suggested-products"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2
            id="suggested-products-heading"
            className="text-2xl font-bold tracking-tight text-slate-900"
          >
            You might also like
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Hand-picked picks based on this product
          </p>
        </div>
        {showControls && (
          <div className="hidden gap-2 sm:flex">
            <button
              type="button"
              aria-label="Scroll suggestions left"
              data-testid="suggested-prev"
              onClick={() => scrollByPage(-1)}
              disabled={!canScrollLeft}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition-all hover:border-[#6a4ff5] hover:text-[#6a4ff5] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-700"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Scroll suggestions right"
              data-testid="suggested-next"
              onClick={() => scrollByPage(1)}
              disabled={!canScrollRight}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition-all hover:border-[#6a4ff5] hover:text-[#6a4ff5] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-700"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div className="relative mt-6">
        <div
          ref={scrollerRef}
          data-testid="suggested-scroller"
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2"
          style={{ scrollbarWidth: "thin" }}
        >
          {products.map((p) => {
            const imageUrl = getPrimaryImageUrl(p);
            return (
              <Link
                key={p.id}
                href={`/products/${p.id}`}
                data-testid="suggested-product-card"
                className="group relative flex shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-all hover:-translate-y-0.5 hover:border-[#6a4ff5]/40 hover:shadow-lg"
                style={{ width: "calc((100% - 48px) / 4)", minWidth: "180px" }}
              >
                <div className="relative aspect-square overflow-hidden bg-slate-50">
                  {p.is_new && <NewBadge />}
                  {imageUrl ? (
                    <ProductImage
                      src={imageUrl}
                      alt={p.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                      No image
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h3 className="text-sm font-semibold text-slate-900 line-clamp-2">
                    {p.name}
                  </h3>
                  <p className="mt-2 text-base font-bold text-[#6a4ff5]">
                    ${(p.price_cents / 100).toFixed(2)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
