module.exports = {
  async rewrites() {
    return [{ source: '/public/:path*', destination: '/:path*' }];
  },
  reactStrictMode: false,
};
