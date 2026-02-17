"use client";

import { useEffect, useState } from "react";
import ProductImage from "@/components/ProductImage";
import DecorativeIcons from "@/components/DecorativeIcons";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function Footer() {
  const [bannerText, setBannerText] = useState(
    "Official MetalBear swag — gear up for faster development"
  );

  useEffect(() => {
    fetch(`${basePath}/api/banner`)
      .then((r) => r.json())
      .then((data) => {
        if (data.text) setBannerText(data.text);
      })
      .catch(() => {});
  }, []);

  return (
    <footer className="bg-[#6a4ff5] px-6 py-8">
      {/* Decorative wave divider - soft transition into footer */}
      <svg className="footer-wave" viewBox="0 0 1200 32" preserveAspectRatio="none" aria-hidden>
        <path d="M0 32 L0 12 Q150 0 300 12 T600 12 T900 12 T1200 12 L1200 32 Z" fill="white" fillOpacity="0.08" />
      </svg>
      <DecorativeIcons variant="footer" />
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4">
        <p className="text-center text-sm font-medium text-white/90">
          {bannerText}
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
