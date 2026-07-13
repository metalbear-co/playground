import type { NextConfig } from "next";

const basePath = process.env.NEXT_BASE_PATH ?? "";
const routerUrl =
  process.env.ROUTER_AGENT_URL ?? "http://router-agent.shop-agents.svc.cluster.local";

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
  async rewrites() {
    if (!basePath) return [];
    return [
      { source: `${basePath}`, destination: `/` },
      { source: `${basePath}/`, destination: `/` },
      { source: `${basePath}/support`, destination: `/support` },
    ];
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    ROUTER_AGENT_URL: routerUrl,
  },
};

export default nextConfig;
