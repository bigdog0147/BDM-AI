import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  allowedDevOrigins: ["10.0.179.193", "localhost"],
  outputFileTracingRoot: path.resolve(process.cwd(), ".."),
};

export default nextConfig;