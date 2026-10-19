/** Clear limited-edition label for a featured product card. */
export default function LimitedBadge() {
  return (
    <span className="absolute top-3 left-3 z-10 inline-block rounded-md border-2 border-white bg-slate-950 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white shadow-md sm:text-sm">
      LIMITED
    </span>
  );
}
