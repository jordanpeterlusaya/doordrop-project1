const dns = require('dns');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 12_000;
/** Longer OD Routes computeRoute can need ~30s (cold start + traffic). */
const ROUTES_TIMEOUT_MS = 30_000;

/**
 * Force IPv4 for outbound Google API calls.
 * On this host IPv6 to routes.googleapis.com is ENETUNREACH; Node/undici
 * Happy Eyeballs intermittently ETIMEDOUT instead of falling back (curl -4 works).
 */
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Older Node — ignore.
}

function normalizeHeaders(initHeaders) {
  const headers = {};
  if (!initHeaders) {
    return headers;
  }
  if (typeof initHeaders.forEach === 'function') {
    initHeaders.forEach((value, key) => {
      headers[String(key)] = String(value);
    });
    return headers;
  }
  for (const [key, value] of Object.entries(initHeaders)) {
    if (value === undefined || value === null) {
      continue;
    }
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return headers;
}

/**
 * HTTPS/HTTP request forced to IPv4 — same shape as prior undici fetchJson.
 * @returns {Promise<{ response: { ok: boolean, status: number }, payload: object, rawBody: string }>}
 */
async function fetchJson(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const target = new URL(url);
  const lib = target.protocol === 'http:' ? http : https;
  const method = String(init.method || 'GET').toUpperCase();
  const body =
    init.body === undefined || init.body === null
      ? null
      : Buffer.isBuffer(init.body)
        ? init.body
        : Buffer.from(String(init.body), 'utf8');
  const headers = normalizeHeaders(init.headers);
  if (body && !headers['Content-Length'] && !headers['content-length']) {
    headers['Content-Length'] = String(body.length);
  }

  const externalSignal = init.signal;
  if (externalSignal?.aborted) {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      if (externalSignal && onAbort) {
        externalSignal.removeEventListener('abort', onAbort);
      }
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    };

    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        family: 4,
        // Avoid Happy Eyeballs racing a blackholed AAAA.
        autoSelectFamily: false,
        lookup(hostname, options, callback) {
          dns.lookup(hostname, { ...options, family: 4, all: false }, callback);
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let payload = {};
          if (rawBody) {
            try {
              payload = JSON.parse(rawBody);
            } catch {
              payload = { message: rawBody };
            }
          }
          const status = res.statusCode || 0;
          finish(null, {
            response: { ok: status >= 200 && status < 300, status },
            payload,
            rawBody,
          });
        });
        res.on('error', (error) => finish(error));
      }
    );

    const onAbort = () => {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      req.destroy(abortError);
      finish(abortError);
    };

    if (externalSignal) {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const timeoutId = setTimeout(() => {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      timeoutError.code = 'ETIMEDOUT';
      req.destroy(timeoutError);
      finish(timeoutError);
    }, timeoutMs);

    req.on('error', (error) => finish(error));
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  ROUTES_TIMEOUT_MS,
  fetchJson,
};
