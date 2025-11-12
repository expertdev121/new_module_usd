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
      // Public access for PDF receipts
      {
        source: '/receipts/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Content-Type',
            value: 'application/pdf',
          },
        ],
      },
    ];
  },
};

export default nextConfig;