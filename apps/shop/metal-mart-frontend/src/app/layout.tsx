import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import Footer from "@/components/Footer";
import MascotPositioned from "@/components/MascotPositioned";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "MetalMart | MetalBear Swag",
  description: "Official MetalBear merchandise",
};

// Applies the saved theme (or system preference) before paint to avoid a flash of the wrong theme.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("metal-mart-theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased font-sans">
        <div className="relative min-h-screen flex flex-col">
          <MascotPositioned />
          <div className="flex-1">{children}</div>
          <Footer />
        </div>
      </body>
    </html>
  );
}
