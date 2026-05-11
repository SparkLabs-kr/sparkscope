/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000', 'sparkscope.vercel.app'] },
  },
};
export default nextConfig;
