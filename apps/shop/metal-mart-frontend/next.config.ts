import type { NextConfig } from "next";

const basePath = process.env.NEXT_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  async rewrites() {
    return [
      // Internal cloud agents dashboard is a static file in public/; serve it
      // at an extension-less URL so it reads like the other shop routes.
      { source: "/cloud-agents", destination: "/cloud-agents.html" },
    ];
  },
};

export default nextConfig;
