"use client";

import Link from "next/link";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type HeaderProps = {
  /** Show "Official MetalBear Swag" subtitle (home page only) */
  showSubtitle?: boolean;
};

export default function Header({ showSubtitle = false }: HeaderProps) {
  return (
    <header className="border-b border-slate-700 px-6 py-4">
      <Link href={basePath || "/"} className="text-xl font-bold text-amber-400">
        MetalMart
      </Link>
      {showSubtitle && <p className="text-sm text-slate-400">Official MetalBear Swag</p>}
      <div className="mt-2 flex gap-4">
        <Link href={`${basePath}/products`} className="text-slate-300 hover:text-white">
          Products
        </Link>
        <Link href={`${basePath}/cart`} className="text-slate-300 hover:text-white">
          Cart
        </Link>
      </div>
    </header>
  );
}
