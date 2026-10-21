const WINDOW_MS = 60 * 1000;

const ROUTE_LIMITS = [
  { pattern: /^\/places\//, maxRequests: 90 },
  { pattern: /^\/routes\/estimate$/, maxRequests: 45 },
  { pattern: /^\/pricing\/estimate$/, maxRequests: 90 },
  { pattern: /^\/driver-payments\//, maxRequests: 40 },
  { pattern: /^\/carrier\/commission\//, maxRequests: 12 },
  { pattern: /^\/nearby-customers$/, maxRequests: 60 },
];

const buckets = new Map();
const DEFAULT_MAX_REQUESTS = 120;

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    ?.trim();
  if (forwarded) {
    return forwarded;
  }

  return req.socket?.remoteAddress || 'unknown';
}

function getRouteLimit(pathname) {
  const match = ROUTE_LIMITS.find((item) => item.pattern.test(pathname));
  return match?.maxRequests || DEFAULT_MAX_REQUESTS;
}

function enforceRateLimit(req, pathname) {
  if (process.env.DOORDROP_DISABLE_RATE_LIMIT === '1') {
    return;
  }

  if (pathname === '/health' || pathname === '/metrics') {
    return;
  }

  const ip = getClientIp(req);
  const maxRequests = getRouteLimit(pathname);
  const bucketKey = `${ip}:${pathname.split('/').slice(0, 2).join('/') || '/'}`;
  const now = Date.now();
  const current = buckets.get(bucketKey);

  if (!current || now - current.windowStart >= WINDOW_MS) {
    buckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }

  current.count += 1;
  if (current.count > maxRequests) {
    const error = new Error('Too many requests. Please wait a moment and try again.');
    error.statusCode = 429;
    throw error;
  }
}

module.exports = {
  enforceRateLimit,
  getClientIp,
};
