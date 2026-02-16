"use client";

import { usePathname } from "next/navigation";
import Mascot from "@/components/Mascot";

/**
 * Renders Mascot with position based on current route:
 * - Home (/): hero (top-right, above the fold)
 * - Other pages: corner (bottom-right)
 */
export default function MascotPositioned() {
  const pathname = usePathname();
  const isHome = pathname === "/" || pathname === "";

  return <Mascot position={isHome ? "hero" : "corner"} />;
}
