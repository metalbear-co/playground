import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import ChatWidget from "@/components/chat/ChatWidget";
import Footer from "@/components/Footer";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Quince-esque MetalBear Playground",
  description: "High-quality basics, honestly priced",
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
          <div className="flex-1">{children}</div>
          <Footer />
          <ChatWidget />
        </div>
      </body>
    </html>
  );
}
