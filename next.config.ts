import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@anthropic-ai/claude-code",
    "imapflow",
    "pg",
  ],
};

export default nextConfig;
