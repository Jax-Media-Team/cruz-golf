/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" }
  },
  images: {
    remotePatterns: []
  }
};

module.exports = nextConfig;
