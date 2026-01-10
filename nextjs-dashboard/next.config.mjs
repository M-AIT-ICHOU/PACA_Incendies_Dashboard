/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Replit runs the dev server behind a different origin than localhost.
    // This allows loading /_next/* assets from the Preview domain.
    allowedDevOrigins: [
      "http://localhost:5000",
      "http://127.0.0.1:5000",
      "http://0.0.0.0:5000",
      "https://*.replit.dev",
      "https://*.replit.app",
    ],
  },
};

export default nextConfig;
