/** Fixed overlay when preview images set NEXT_PUBLIC_PREVIEW_ENV_BANNER=true */
export default function PreviewEnvBanner() {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex justify-center px-3 pt-2"
      aria-hidden
    >
      <div className="rounded-b-lg bg-[#6a4ff5]/95 px-4 py-1.5 text-sm font-semibold text-white shadow-lg ring-1 ring-white/20">
        Preview Env Test
      </div>
    </div>
  );
}
