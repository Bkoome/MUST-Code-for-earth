module.exports = {
  async headers() {
    // Mock tiles are immutable historical data — cache them hard. Live TiTiler/TiPg
    // responses should carry the same immutable headers.
    return [
      {
        source: '/mock-tiles/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
  async rewrites() {
    return [
      { source: '/public/:path*', destination: '/:path*' },
      // Local-dev fallback: proxy unhandled /api/* to the FastAPI mock when no API
      // base URL is set. Does not override the file-based API routes.
      ...(process.env.NEXT_PUBLIC_API_BASE_URL
        ? []
        : [{ source: '/api/:path*', destination: 'http://localhost:8000/api/:path*' }]),
    ];
  },
  reactStrictMode: false,
};
