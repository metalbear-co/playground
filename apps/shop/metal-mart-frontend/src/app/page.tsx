import Link from "next/link";
import Header from "@/components/Header";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header showSubtitle />
      <main className="flex flex-1 flex-col">
        <section className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-20">
          <div className="text-center">
            <h1 className="animate-fade-in-up text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Welcome to MetalMart
            </h1>
            <p className="animate-fade-in-up animate-fade-in-up-delay-1 mt-3 text-lg text-slate-600">
              Gear up with official MetalBear merchandise
            </p>
          </div>
          <Link
            href={`${basePath}/products`}
            className="btn-primary animate-fade-in-up animate-fade-in-up-delay-2 rounded-xl px-10 py-4 font-semibold focus:outline-none focus:ring-2 focus:ring-[#6a4ff5]/40 focus:ring-offset-2"
          >
            Browse Catalogue
          </Link>
        </section>
        {/* MetalBear-style purple banner */}
        <section className="bg-[#6a4ff5] px-6 py-8">
          <p className="text-center text-sm font-medium text-white/90">
            Official MetalBear swag — gear up for faster development
          </p>
        </section>
      </main>
    </div>
  );
}
