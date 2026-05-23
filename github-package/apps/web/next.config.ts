import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "43.153.88.103",
    "154.37.220.248",
    "apishare.l-kx.cn",
    "gateway.l-kx.cn",
  ],
};

export default nextConfig;
