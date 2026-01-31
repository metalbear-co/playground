import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
