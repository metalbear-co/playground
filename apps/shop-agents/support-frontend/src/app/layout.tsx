import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MetalBear · Support",
  description: "MetalMart support workspace powered by mirrord-ready agents",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
