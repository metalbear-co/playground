import type { NextConfig } from "next";

const basePath = process.env.NEXT_BASE_PATH ?? "";
const defaultBackendUrl =
  process.env.NEXT_PUBLIC_VISUALIZATION_BACKEND_URL ??
  (basePath ? `${basePath}/api` : "http://localhost:8080");

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
  async rewrites() {
    if (!basePath) {
      return [];
    }
    return [
      { source: `${basePath}`, destination: `${basePath}/` },
      { source: `${basePath}/`, destination: `/` },
    ];
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_VISUALIZATION_BACKEND_URL: defaultBackendUrl,
  },
};

export default nextConfig;
