import ProductImage from "@/components/ProductImage";

const MASCOT_PUBLIC_ID = "new-hero-image_ahu9xb";

type MascotPosition = "hero" | "corner";

/**
 * MetalBear mascot illustration. Decorative only (pointer-events-none).
 * - hero: above-the-fold background, top-right (home page)
 * - corner: bottom-right (other pages)
 */
export default function Mascot({ position = "corner" }: { position?: MascotPosition }) {
  const isHero = position === "hero";

  return (
    <div
      className={`pointer-events-none absolute z-20 hidden opacity-60 md:block ${
        isHero
          ? "top-20 right-0 w-[min(360px,40vw)]"
          : "bottom-56 right-0 w-[min(280px,30vw)]"
      }`}
      aria-hidden
    >
      <ProductImage
        src={MASCOT_PUBLIC_ID}
        alt=""
        className={`h-auto w-full object-contain ${
          isHero ? "object-top-right" : "object-bottom-right"
        }`}
        width={isHero ? 360 : 280}
        height={isHero ? 360 : 280}
      />
    </div>
  );
}
