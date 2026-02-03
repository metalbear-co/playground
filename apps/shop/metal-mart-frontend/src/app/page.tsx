import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-700 px-6 py-4">
        <Link href="/products" className="text-xl font-bold text-amber-400">
          MetalMart
        </Link>
        <p className="text-sm text-slate-400">Official MetalBear Swag</p>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-3xl font-bold text-slate-100">Welcome to MetalMart</h1>
        <p className="text-slate-400">Gear up with official MetalBear merchandise</p>
        <Link
          href="/products"
          className="rounded-lg bg-amber-500 px-6 py-3 font-medium text-slate-900 hover:bg-amber-400"
        >
          Browse Catalogue
        </Link>
      </main>
    </div>
  );
}
