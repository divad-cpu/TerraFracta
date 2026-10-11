import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Opt in to Next's traced local output; keep normal development/start unchanged.
  ...(process.env.TERRAFRACTA_LOCAL_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // A private artifact audit may emit source maps; ordinary builds keep them off.
  ...(process.env.TERRAFRACTA_LOCAL_STANDALONE === "1"
    && process.env.TERRAFRACTA_LOCAL_ARTIFACT_MAPS === "1"
    ? { productionBrowserSourceMaps: true } : {}),
  // These append-only development stores must never become deployment assets.
  outputFileTracingExcludes: {
    "/*": ["./.local-connected-reader/**/*", "./.local-fictional-runs/**/*", "./.local-connected-trial/**/*"],
  },
};

export default nextConfig;
