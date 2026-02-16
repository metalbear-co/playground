/**
 * Zany "NEW" sticker badge for product cards.
 * Tilted, hand-drawn style, orange/yellow MetalBear accent.
 */
export default function NewBadge({ size = "default" }: { size?: "default" | "lg" }) {
  const sizeClass = size === "lg" ? "px-4 py-1.5 text-base" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={`absolute top-3 right-3 z-10 inline-block font-black uppercase tracking-wider
        rounded-md border-2 border-amber-400 bg-gradient-to-br from-amber-300 via-orange-400 to-amber-500
        text-slate-900 shadow-md
        transform -rotate-12
        ${sizeClass}`}
      style={{
        boxShadow: "2px 2px 0 rgba(0,0,0,0.15), -1px -1px 0 rgba(255,255,255,0.3)",
      }}
    >
      ✨ NEW ✨
    </span>
  );
}
