import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native SQLite driver must not be bundled by webpack/turbopack
  serverExternalPackages: ["better-sqlite3"],
  eslint: {
    // Lint runs as a separate, explicit step (`npm run lint`)
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type-check runs as a separate, explicit step (`npm run typecheck`)
    ignoreBuildErrors: false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
