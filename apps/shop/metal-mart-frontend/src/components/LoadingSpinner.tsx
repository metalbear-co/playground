export default function LoadingSpinner() {
  return (
    <div className="flex min-h-[200px] items-center justify-center" aria-label="Loading">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#3A342C]"
        role="status"
      />
    </div>
  );
}
