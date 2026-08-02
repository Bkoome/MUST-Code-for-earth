module.exports = {
  // Emit a self-contained server bundle for the Docker image (see Dockerfile).
  output: 'standalone',
  // MapLibre and the d3 choropleth own their DOM; double-invoked effects in strict
  // mode re-create the map canvas on every mount.
  reactStrictMode: false,
};
