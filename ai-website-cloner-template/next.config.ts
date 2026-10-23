import type { NextConfig } from "next";

const backend = (
  process.env.DUANJU_BACKEND_URL || "http://127.0.0.1:8765"
).replace(/\/$/, "");
const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/backend/:path*", destination: `${backend}/api/:path*` },
    ];
  },
};
export default nextConfig;
