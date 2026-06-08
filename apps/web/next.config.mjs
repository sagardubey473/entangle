/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source; let Next transpile them.
  transpilePackages: ["@entangle/shared", "@entangle/db"],
  webpack: (config) => {
    // The workspace packages use ESM-style ".js" import specifiers that actually
    // point to ".ts" files (resolved by tsc/tsx). Teach webpack the same mapping.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
