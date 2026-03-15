import type { NextConfig } from "next";

const basePath = process.env.NEXT_BASE_PATH ?? "";
const backendUrl =
  process.env.VISUALIZATION_BACKEND_URL ?? "http://visualization-shop-backend";
const defaultBackendUrl =
  process.env.NEXT_PUBLIC_VISUALIZATION_BACKEND_URL ||
  (basePath ? `${basePath}/api` : "http://localhost:8080");

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
  async rewrites() {
    if (!basePath) {
      return [];
    }
    return [
      { source: `${basePath}`, destination: `/` },
      { source: `${basePath}/`, destination: `/` },
      { source: `${basePath}/api/:path*`, destination: `${backendUrl}/:path*` },
    ];
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_VISUALIZATION_BACKEND_URL: defaultBackendUrl,
  },
};

export default nextConfig;
