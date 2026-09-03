"use client";

import Link from "next/link";

type HeaderProps = {
  /** Show tagline subtitle (home page only) */
  showSubtitle?: boolean;
};

const CATEGORY_NAV = [
  "Women",
  "Men",
  "Home",
  "Baby & Kids",
  "Travel",
  "Bags & Accessories",
  "Jewelry",
  "Beauty & Wellness",
];

export default function Header({ showSubtitle = false }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3A342C]/40 focus:ring-offset-2 rounded"
        >
          Larkwell
        </Link>
        <div className="flex items-center gap-8">
          {showSubtitle && (
            <p className="hidden text-sm text-slate-600 sm:block">High-quality basics, honestly priced</p>
          )}
          <nav className="flex gap-6" aria-label="Main navigation">
            <Link
              href="/cart"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Cart
            </Link>
          </nav>
        </div>
      </div>
      <nav
        className="scrollbar-none flex gap-6 overflow-x-auto border-t border-slate-100 px-6 py-2.5 text-sm"
        aria-label="Category navigation"
      >
        <Link href="/products" className="shrink-0 font-semibold text-[#2F4A3C] hover:underline">
          Cashmere
        </Link>
        <Link href="/products" className="shrink-0 font-semibold text-[#2F4A3C] hover:underline">
          Linen
        </Link>
        {CATEGORY_NAV.map((c) => (
          <Link
            key={c}
            href="/products"
            className="shrink-0 whitespace-nowrap text-slate-600 hover:text-slate-900"
          >
            {c}
          </Link>
        ))}
      </nav>
    </header>
  );
}
