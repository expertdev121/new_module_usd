/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizeCss: false, 
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors *;", 
          },
        ],
      },
    ];
  },
};

export default nextConfig;