/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" }
  },
  images: {
    remotePatterns: []
  },
  // Surface the deploy SHA to the client so the version-watcher hook can
  // detect new deploys without forcing a hard reload on users mid-round.
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.NEXT_PUBLIC_BUILD_ID ??
      "dev"
  }
};

module.exports = nextConfig;
