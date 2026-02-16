"use client";

import ProductImage from "@/components/ProductImage";

export default function Footer() {
  return (
    <footer className="bg-[#6a4ff5] px-6 py-8">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4">
        <p className="text-center text-sm font-medium text-white/90">
          Official MetalBear swag — gear up for faster development
        </p>
        <a
          href="https://metalbear.co"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 text-white/95 hover:text-white transition-colors"
        >
          <ProductImage
            src="mirrord_logo_srsyxc"
            alt="mirrord"
            width={120}
            height={120}
            className="shrink-0 opacity-95"
          />
          <span className="text-lg font-semibold">Powered by mirrord</span>
        </a>
      </div>
    </footer>
  );
}
