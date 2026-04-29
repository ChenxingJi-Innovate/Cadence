/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // sql.js ships node-style module shape; stub out node-only built-ins for the browser bundle.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false }
    return config
  },
}
export default nextConfig
