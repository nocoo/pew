import type { NextConfig } from "next";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const rootPkg = require("../../package.json") as { version: string };

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["pew.dev.hexly.ai"],
  images: {
    imageSizes: [16, 32, 48, 64, 80, 96, 128, 160, 256, 384],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "s.zhe.to",
        pathname: "/apps/pew/**",
      },
    ],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPkg.version,
  },
};

export default nextConfig;
