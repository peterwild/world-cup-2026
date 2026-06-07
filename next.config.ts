import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin file tracing to this project so Next doesn't infer a stray workspace
  // root from a parent-directory lockfile and trace the whole home dir (the
  // 67GB OOM trap). See ~/Documents/ptw-consulting/CLAUDE.md memory.
  outputFileTracingRoot: path.join(__dirname),
  typescript: {
    // Skip typechecking on the prod build to keep the Lightsail box under its
    // RAM ceiling. Types are verified in dev locally.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
