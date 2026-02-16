"use client";

import Link from "next/link";
import { CldImage } from "next-cloudinary";
import { resolveCloudinaryId } from "@/lib/cloudinary";

const METALBEAR_LOGO_ID = "MetalBear_logo_c2doft";

type HeaderProps = {
  /** Show "Official MetalBear Swag" subtitle (home page only) */
  showSubtitle?: boolean;
};

export default function Header({ showSubtitle = false }: HeaderProps) {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold tracking-tight text-[#6a4ff5] hover:text-[#5a3fe5] focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2 rounded"
        >
          {cloudName && (
            <CldImage
              src={resolveCloudinaryId(METALBEAR_LOGO_ID)}
              alt="MetalBear"
              width={36}
              height={36}
              className="shrink-0"
            />
          )}
          MetalMart
        </Link>
        <div className="flex items-center gap-8">
          {showSubtitle && (
            <p className="hidden text-sm text-slate-600 sm:block">Official MetalBear Swag</p>
          )}
          <nav className="flex gap-6" aria-label="Main navigation">
            <Link
              href="/products"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Products
            </Link>
            <Link
              href="/cart"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Cart
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
