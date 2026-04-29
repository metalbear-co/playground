import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import Footer from "@/components/Footer";
import MascotPositioned from "@/components/MascotPositioned";
import PreviewEnvBanner from "@/components/PreviewEnvBanner";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "MetalMart | MetalBear Swag",
  description: "Official MetalBear merchandise",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="min-h-screen antialiased font-sans">
        <div className="relative min-h-screen flex flex-col">
          {["1", "true"].includes(
            String(process.env.NEXT_PUBLIC_PREVIEW_ENV_BANNER ?? "").toLowerCase()
          ) ? (
            <PreviewEnvBanner />
          ) : null}
          <MascotPositioned />
          <div className="flex-1">{children}</div>
          <Footer />
        </div>
      </body>
    </html>
  );
}
