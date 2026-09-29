/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  eslint: { ignoreDuringBuilds: true },
  // The Sage Halpin interactive demo is a self-contained static page.
  async rewrites() {
    return [{ source: '/sage-halpin/demo', destination: '/sage-halpin/demo.html' }];
  },
};
export default nextConfig;
