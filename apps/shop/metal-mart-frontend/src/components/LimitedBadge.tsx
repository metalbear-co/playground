/** Clear limited sticker for featured products. */
export default function LimitedBadge() {
  return (
    <span className="absolute top-3 left-3 z-10 inline-block -rotate-6 rounded-md border-2 border-white bg-amber-300 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-slate-950 shadow-md sm:text-sm">
      Limited
    </span>
  );
}
