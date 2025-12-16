import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["firebase-admin"],
  // Security: Limit RSC payload size to prevent DoS attacks (CVE-2025-55184)
  experimental: {
    serverActions: {
      bodySizeLimit: '1mb', // Limit Server Action payload size
    },
  },
  // Security: Add headers to prevent source code exposure
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
