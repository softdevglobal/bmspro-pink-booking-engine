import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverComponentsExternalPackages: ["firebase-admin"],
};

export default nextConfig;
