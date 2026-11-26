import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle (.next/standalone) so the Docker image needs no node_modules.
  output: "standalone",
  // Cache Components / partial prefetching are intentionally NOT enabled: every page here is a client component that
  // reads Firebase auth in the browser, so with them on, Next.js flags each route with "instant navigation" warnings.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
