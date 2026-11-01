#!/usr/bin/env node

const BASE_URL = String(
  process.env.DOORDROP_LOAD_TEST_URL ||
    'https://us-central1-efootball-app-9d175.cloudfunctions.net/api'
).replace(/\/+$/, '');

const TIERS = (process.env.DOORDROP_LOAD_TIERS || '10,25,50,100')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

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
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(35_000),
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      bytes: body.length,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarize(label, results) {
  const durations = results.map((item) => item.durationMs);
  const failures = results.filter((item) => !item.ok).length;
  const rateLimited = results.filter((item) => item.status === 429).length;
  const serverErrors = results.filter((item) => item.status >= 500).length;

  return {
    label,
    count: results.length,
    failures,
    rateLimited,
    serverErrors,
    successRate: Number((((results.length - failures) / results.length) * 100).toFixed(1)),
    avgMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: Math.max(...durations),
  };
}

async function runScenario(name, concurrency, taskFactory) {
  const tasks = Array.from({ length: concurrency }, () => taskFactory);
  const results = await Promise.all(tasks.map((task) => task()));
  return summarize(`${name}@${concurrency}`, results);
}

async function warmUp() {
  await timedRequest('/health');
  await timedRequest('/health');
}

async function main() {
  console.log(`DoorDrop production capacity test`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Tiers: ${TIERS.join(', ')} concurrent requests\n`);

  const healthProbe = await timedRequest('/health');
  if (!healthProbe.ok) {
    throw new Error(`Production health failed: status ${healthProbe.status}`);
  }

  const metricsProbe = await timedRequest('/metrics');
  const optimizedBackend = metricsProbe.ok;
  console.log(`Backend profile: ${optimizedBackend ? 'optimized (metrics live)' : 'legacy (no /metrics yet)'}`);
  console.log(`Cold/warm health sample: ${healthProbe.durationMs}ms\n`);

  await warmUp();

  const allSummaries = [];

  for (const tier of TIERS) {
    allSummaries.push(
      await runScenario('health', tier, () => timedRequest('/health'))
    );
    allSummaries.push(
      await runScenario('pricing', tier, () =>
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
    );
    allSummaries.push(
      await runScenario('places', tier, () =>
        timedRequest(
          '/places/autocomplete?input=Mikocheni&limit=6&latitude=-6.7654&longitude=39.2502&sessionToken=load-test'
        )
      )
    );
    allSummaries.push(
      await runScenario(
        'routes',
        Math.max(5, Math.floor(tier / 2)),
        () =>
          timedRequest('/routes/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              origin: { latitude: -6.7924, longitude: 39.2083 },
              destination: { latitude: -6.816, longitude: 39.2803 },
              vehicleType: 'bodaboda',
              pricingScope: 'parcel',
            }),
          })
      )
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log('Results');
  console.log('-------');
  for (const summary of allSummaries) {
    console.log(
      `${summary.label} | success=${summary.successRate}% fail=${summary.failures} (429=${summary.rateLimited}, 5xx=${summary.serverErrors}) | avg=${summary.avgMs}ms p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms max=${summary.maxMs}ms`
    );
  }

  const stableTiers = TIERS.filter((tier) => {
    const health = allSummaries.find((item) => item.label === `health@${tier}`);
    const pricing = allSummaries.find((item) => item.label === `pricing@${tier}`);
    const places = allSummaries.find((item) => item.label === `places@${tier}`);
    return [health, pricing, places].every((item) => item && item.successRate >= 95 && item.p95Ms <= 8000);
  });

  const maxStable = stableTiers.length ? Math.max(...stableTiers) : TIERS[0];
  const conservativeActiveUsers = Math.max(10, Math.floor(maxStable * 0.6));
  const conservativePassiveUsers = Math.max(50, Math.floor(maxStable * 4));

  console.log('\nEstimated capacity (production, current deploy)');
  console.log('------------------------------------------------');
  console.log(`Stable concurrent API requests (>=95% success, p95 < 8s): ~${maxStable}`);
  console.log(`Estimated active booking users at once (search + fare): ~${conservativeActiveUsers}`);
  console.log(`Estimated passive users at once (track/home mostly): ~${conservativePassiveUsers}`);
  console.log(
    optimizedBackend
      ? 'Note: optimized backend is live; numbers include cache/rate-limit behavior.'
      : 'Note: latest backend optimizations are NOT deployed yet (/metrics missing). Deploy functions to improve these numbers.'
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
