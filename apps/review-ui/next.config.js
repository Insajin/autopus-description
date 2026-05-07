/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
  },
  // Sibling workspace package imported as raw TS via tsconfig paths.
  transpilePackages: ["@autopus/write-router"],
  // Source uses NodeNext `.js` import suffix that actually points to `.ts`.
  // webpack supports this via `extensionAlias`. Turbopack (Next 16 default)
  // does not yet have an equivalent — that is why dev/build scripts pass
  // `--webpack`. Revisit when Turbopack ships extensionAlias support.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
