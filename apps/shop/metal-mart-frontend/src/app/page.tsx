"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import LoadingSpinner from "@/components/LoadingSpinner";
import NewBadge from "@/components/NewBadge";
import ProductImage from "@/components/ProductImage";
import ProductDialog from "@/components/ProductDialog";
import { getPrimaryImageUrl, type Product } from "@/lib/product";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function ProductTile({
  product,
  variant,
  delay = 0,
  elevated = false,
  onClick,
}: {
  product: Product;
  variant: "featured" | "standard" | "wide";
  delay?: number;
  /** Above mascot on home page so card stays opaque */
  elevated?: boolean;
  onClick: (product: Product) => void;
}) {
  const price = `$${(product.price_cents / 100).toFixed(2)}`;

  const elevatedClass = elevated ? "relative z-30" : "";

  if (variant === "featured") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick(product)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(product); } }}
        className={`group relative flex h-full min-h-[280px] cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-300 bg-slate-100 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-[#6a4ff5]/15 hover:border-[#6a4ff5]/30 animate-card-reveal ${elevatedClass}`}
        style={{ animationDelay: `${delay}s` }}
      >
        {product.is_new && <NewBadge size="default" />}
        <div className="absolute inset-0">
          {getPrimaryImageUrl(product) ? (
            <ProductImage
              src={getPrimaryImageUrl(product)!}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-200 text-slate-400">
              No image
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        </div>
        <div className="relative mt-auto p-6">
          <h2 className="text-2xl font-bold text-white drop-shadow-sm md:text-3xl">
            {product.name}
          </h2>
          <p className="mt-1 text-lg font-semibold text-white/90">{price}</p>
          <span className="mt-3 inline-block text-sm font-medium text-white/90 underline-offset-2 group-hover:underline">
            Shop now →
          </span>
        </div>
      </div>
    );
  }

  if (variant === "wide") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick(product)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(product); } }}
        className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#6a4ff5]/30 hover:shadow-xl hover:shadow-[#6a4ff5]/10 animate-card-reveal sm:flex-row ${elevatedClass}`}
        style={{ animationDelay: `${delay}s` }}
      >
        {product.is_new && <NewBadge size="default" />}
        <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-slate-100 sm:aspect-[4/3] sm:w-64">
          {getPrimaryImageUrl(product) ? (
            <ProductImage
              src={getPrimaryImageUrl(product)!}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              fill
              sizes="(max-width: 640px) 100vw, 256px"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-400">
              No image
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col justify-center p-6">
          <h2 className="text-xl font-bold text-slate-900 group-hover:text-[#6a4ff5] transition-colors">
            {product.name}
          </h2>
          <p className="mt-1 text-lg font-semibold text-[#6a4ff5]">{price}</p>
          {product.description && (
            <p className="mt-2 line-clamp-2 text-sm text-slate-600">
              {product.description}
            </p>
          )}
        </div>
      </div>
    );
  }

  // standard
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(product)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(product); } }}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#6a4ff5]/30 hover:shadow-xl hover:shadow-[#6a4ff5]/10 animate-card-reveal ${elevatedClass}`}
      style={{ animationDelay: `${delay}s` }}
    >
      {product.is_new && <NewBadge size="default" />}
      <div className="relative aspect-square overflow-hidden bg-slate-100">
        {getPrimaryImageUrl(product) ? (
          <ProductImage
            src={getPrimaryImageUrl(product)!}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            fill
            sizes="(max-width: 640px) 50vw, 25vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-400">
            No image
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="font-semibold text-slate-900 group-hover:text-[#6a4ff5] transition-colors">
          {product.name}
        </h2>
        <p className="mt-1 font-semibold text-[#6a4ff5]">{price}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  useEffect(() => {
    fetch(`${basePath}/api/products`)
      .then((r) => r.json())
      .then(setProducts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <Header showSubtitle />
        <main className="flex flex-1 items-center justify-center p-8">
          <LoadingSpinner />
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <Header showSubtitle />
        <main className="flex flex-1 items-center justify-center p-8">
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-600">
            Error: {error}
          </p>
        </main>
      </div>
    );
  }

  const [featured, ...rest] = products;
  const hasProducts = products.length > 0;
  const hasMultipleProducts = products.length > 1;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header showSubtitle />
      <main className="flex flex-1 flex-col">
        {/* Bento product grid */}
        <section className="flex-1 px-6 py-12">
          <div className="mx-auto max-w-6xl">
            {hasProducts && (
              <h1 className="hand-drawn-underline mb-10 inline-block text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
                Featured Swag
              </h1>
            )}
            {hasProducts ? (
              <>
                {/* Bento grid: featured large (2x2), 2 stacked side tiles, wide bottom row */}
                <div
                  className={`grid grid-cols-1 gap-4 sm:gap-6 ${
                    hasMultipleProducts
                      ? "md:grid-cols-4 md:grid-rows-[1fr_1fr_auto]"
                      : "md:grid-cols-1"
                  }`}
                >
                  {/* Featured product - spans 2 cols, 2 rows when multiple; full width when solo */}
                  {featured && (
                    <div
                      className={
                        hasMultipleProducts
                          ? "md:col-span-2 md:row-span-2 md:min-h-[360px]"
                          : ""
                      }
                    >
                      <ProductTile product={featured} variant="featured" delay={0} elevated onClick={setSelectedProduct} />
                    </div>
                  )}
                  {/* Side tiles - products 2 and 3 stacked on the right (or single tile spans 2 rows) */}
                  {rest[0] && (
                    <div
                      className={`md:col-span-2 ${rest[1] ? "md:row-span-1" : "md:row-span-2"}`}
                    >
                      <ProductTile product={rest[0]} variant="standard" delay={0.06} elevated onClick={setSelectedProduct} />
                    </div>
                  )}
                  {rest[1] && (
                    <div className="md:col-span-2 md:row-span-1">
                      <ProductTile product={rest[1]} variant="standard" delay={0.12} elevated onClick={setSelectedProduct} />
                    </div>
                  )}
                  {/* Bottom row - product 4 as wide horizontal tile */}
                  {rest[2] && (
                    <div className="md:col-span-4">
                      <ProductTile product={rest[2]} variant="wide" delay={0.18} elevated onClick={setSelectedProduct} />
                    </div>
                  )}
                  {/* Products 5+ in a grid */}
                  {rest.length > 3 && (
                    <div className="md:col-span-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {rest.slice(3).map((p, i) => (
                        <ProductTile
                          key={p.id}
                          product={p}
                          variant="standard"
                          delay={0.24 + i * 0.06}
                          elevated
                          onClick={setSelectedProduct}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-10 flex justify-center">
                  <Link
                    href="/products"
                    className="text-sm font-medium text-[#6a4ff5] hover:text-[#5a3fe5] hover:underline"
                  >
                    View all products →
                  </Link>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-300 bg-slate-50 px-8 py-16 text-center">
                <p className="text-slate-600">No products yet.</p>
                <Link
                  href="/products"
                  className="btn-primary mt-4 inline-block rounded-xl px-6 py-2.5 text-sm font-medium"
                >
                  Browse products
                </Link>
              </div>
            )}
          </div>
        </section>
      </main>
      <ProductDialog product={selectedProduct} onClose={() => setSelectedProduct(null)} />
    </div>
  );
}
