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
      { source: `${basePath}`, destination: `/` },
      { source: `${basePath}/`, destination: `/` },
    ];
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_VISUALIZATION_BACKEND_URL: defaultBackendUrl,
    NEXT_PUBLIC_QUEUE_SPLITTING_MOCK_DATA: process.env.QUEUE_SPLITTING_MOCK_DATA ?? "false",
    NEXT_PUBLIC_DB_BRANCH_MOCK_DATA: process.env.DB_BRANCH_MOCK_DATA ?? "false",
  },
};

export default nextConfig;
