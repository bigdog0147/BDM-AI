import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pin the workspace root to this repository. A pnpm-workspace.yaml exists at
  // E:\ (outside this repo), which Turbopack otherwise warns about on every
  // build and which can change file-tracing behaviour.
  turbopack: {
    root: import.meta.dirname
  }
};

export default nextConfig;
