import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Next blocks dev-only assets (/_next/hmr) when the request Origin host
  // differs from the one the dev server started on. Opening the app via
  // http://127.0.0.1:3001 or the LAN URL instead of http://localhost:3001
  // otherwise breaks hot reload, so allow those dev origins too.
  // Update the LAN entry if this machine's IP changes.
  allowedDevOrigins: ["127.0.0.1", "10.0.5.78"],
  // Pin the workspace root to this repository. A pnpm-workspace.yaml exists at
  // E:\ (outside this repo), which Turbopack otherwise warns about on every
  // build and which can change file-tracing behaviour.
  turbopack: {
    root: import.meta.dirname
  }
};

export default nextConfig;
