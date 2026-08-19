/**
 * "% OFF" sticker badge for discounted product cards.
 * Tilted, hand-drawn style, sits top-left so it doesn't collide with NewBadge.
 */
export default function DiscountBadge({
  percent,
  size = "default",
}: {
  percent: number;
  size?: "default" | "lg";
}) {
  const sizeClass = size === "lg" ? "px-4 py-1.5 text-base" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={`absolute top-3 left-3 z-10 inline-block font-black uppercase tracking-wider
        rounded-md border-2 border-rose-400 bg-gradient-to-br from-rose-500 via-red-500 to-rose-600
        text-white shadow-md
        transform rotate-12
        ${sizeClass}`}
      style={{
        boxShadow: "2px 2px 0 rgba(0,0,0,0.15), -1px -1px 0 rgba(255,255,255,0.2)",
      }}
    >
      -{percent}%
    </span>
  );
}
