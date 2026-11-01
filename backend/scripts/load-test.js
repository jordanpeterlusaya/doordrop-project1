#!/usr/bin/env node

const BASE_URL = String(process.env.DOORDROP_LOAD_TEST_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const CONCURRENCY = Number(process.env.DOORDROP_LOAD_CONCURRENCY || 25);
const ROUNDS = Number(process.env.DOORDROP_LOAD_ROUNDS || 4);

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function timedRequest(pathname, init = {}) {
  const startedAt = Date.now();
  const response = await fetch(`${BASE_URL}${pathname}`, init);
  const durationMs = Date.now() - startedAt;
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    durationMs,
    bytes: body.length,
  };
}

async function runBatch(label, tasks) {
  const results = await Promise.all(tasks.map((task) => task()));
  const durations = results.map((item) => item.durationMs);
  const failures = results.filter((item) => !item.ok).length;

  return {
    label,
    count: results.length,
    failures,
    avgMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: Math.max(...durations),
  };
}

async function main() {
  console.log(`DoorDrop load test -> ${BASE_URL}`);
  console.log(`Concurrency=${CONCURRENCY}, rounds=${ROUNDS}`);

  const health = await timedRequest('/health');
  if (!health.ok) {
    throw new Error(`Health check failed with status ${health.status}`);
  }

  const summaries = [];

  for (let round = 1; round <= ROUNDS; round += 1) {
    summaries.push(
      await runBatch(`round-${round}-health`, Array.from({ length: CONCURRENCY }, () => () => timedRequest('/health')))
    );
    summaries.push(
      await runBatch(
        `round-${round}-pricing`,
        Array.from({ length: CONCURRENCY }, () => () =>
          timedRequest('/pricing/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vehicleType: 'bodaboda',
              distanceMeters: 5200,
              pricingScope: 'parcel',
            }),
          })
        )
      )
    );
    summaries.push(
      await runBatch(
        `round-${round}-routes`,
        Array.from({ length: Math.max(8, Math.floor(CONCURRENCY / 2)) }, () => () =>
          timedRequest('/routes/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              origin: { latitude: -6.7924, longitude: 39.2083 },
              destination: { latitude: -6.816, longitude: 39.2803 },
              vehicleType: 'toyo',
              pricingScope: 'city',
            }),
          })
        )
      )
    );
  }

  const metrics = await timedRequest('/metrics');
  console.log('\nBatch summary:');
  for (const summary of summaries) {
    console.log(
      `${summary.label}: count=${summary.count} failures=${summary.failures} avg=${summary.avgMs}ms p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms max=${summary.maxMs}ms`
    );
  }

  if (metrics.ok) {
    console.log('\nServer metrics snapshot:');
    console.log(metrics.body || '');
  }

  const failed = summaries.some((summary) => summary.failures > 0);
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
