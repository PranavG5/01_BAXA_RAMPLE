import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native binaries must stay external so Vercel ships them with the functions.
  serverExternalPackages: ["sharp", "ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
