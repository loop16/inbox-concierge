import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@anthropic-ai/claude-code",
    "imapflow",
    "ws",
  ],
};

export default nextConfig;
