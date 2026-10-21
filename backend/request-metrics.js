const metrics = {
  startedAt: Date.now(),
  totalRequests: 0,
  totalErrors: 0,
  routeCounts: {},
  routeDurationsMs: {},
  slowRequests: [],
};

const SLOW_REQUEST_MS = 2500;
const MAX_SLOW_SAMPLES = 25;

function recordRequest(pathname, durationMs, statusCode) {
  metrics.totalRequests += 1;
  if (statusCode >= 400) {
    metrics.totalErrors += 1;
  }

  metrics.routeCounts[pathname] = (metrics.routeCounts[pathname] || 0) + 1;

  const bucket = metrics.routeDurationsMs[pathname] || { total: 0, count: 0, max: 0 };
  bucket.total += durationMs;
  bucket.count += 1;
  bucket.max = Math.max(bucket.max, durationMs);
  metrics.routeDurationsMs[pathname] = bucket;

  if (durationMs >= SLOW_REQUEST_MS) {
    metrics.slowRequests.unshift({
      pathname,
      durationMs: Math.round(durationMs),
      statusCode,
      at: new Date().toISOString(),
    });
    metrics.slowRequests = metrics.slowRequests.slice(0, MAX_SLOW_SAMPLES);
  }
}

function getMetricsSnapshot() {
  const routes = Object.entries(metrics.routeDurationsMs).map(([pathname, bucket]) => ({
    pathname,
    count: bucket.count,
    avgMs: bucket.count ? Math.round(bucket.total / bucket.count) : 0,
    maxMs: Math.round(bucket.max),
  }));

  routes.sort((left, right) => right.count - left.count);

  return {
    uptimeSeconds: Math.round((Date.now() - metrics.startedAt) / 1000),
    totalRequests: metrics.totalRequests,
    totalErrors: metrics.totalErrors,
    routes,
    slowRequests: metrics.slowRequests,
  };
}

module.exports = {
  getMetricsSnapshot,
  recordRequest,
};
