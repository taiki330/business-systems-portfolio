import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 身分証の画像（8MBまで）と写真を Server Action で受け取るため、既定の1MBから広げる。
    serverActions: { bodySizeLimit: "9mb" },
  },
};

export default nextConfig;
