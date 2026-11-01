import type { NextConfig } from "next";

const backend = (
  process.env.DUANJU_BACKEND_URL || "http://127.0.0.1:8765"
).replace(/\/$/, "");
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["geoip-country"],
  outputFileTracingIncludes: { "/*": ["./node_modules/geoip-country/data/**/*"] },
  async rewrites() {
    return [
      { source: "/api/backend/studio/:path*", destination: `${backend}/api/studio/:path*` },
    ];
  },
};
export default nextConfig;
