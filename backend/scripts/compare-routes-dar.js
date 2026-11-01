#!/usr/bin/env node
/**
 * Compare Google Routes TRAFFIC_AWARE vs TRAFFIC_AWARE_OPTIMAL for ≥5 Dar OD pairs.
 *
 * Usage: node backend/scripts/compare-routes-dar.js
 * Requires GOOGLE_ROUTES_API_KEY or GOOGLE_SERVER_API_KEY (or EXPO_PUBLIC_GOOGLE_MAPS_API_KEY)
 * in backend/.env / root .env. Never prints the key.
 *
 * Maps UI distances are not scraped here. Per Google docs
 * (migrate-routes-why / config_trade_offs):
 *   TRAFFIC_AWARE_OPTIMAL ≡ maps.google.com / Google Maps mobile app.
 * This script reports OPTIMAL (Maps-equivalent) vs AWARE (legacy Haul HEAD) deltas
 * and polyline identity so operators can spot material road-path drift.
 */

const crypto = require('crypto');
const path = require('path');
const assert = require('assert/strict');

// Load env the same way as backend/config.js
require(path.join(__dirname, '..', 'config'));
const { computeRoute } = require(path.join(__dirname, '..', 'google-maps'));

const apiKey =
  process.env.GOOGLE_ROUTES_API_KEY ||
  process.env.GOOGLE_SERVER_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

if (!apiKey) {
  console.error('Missing Google Routes API key in env. Set GOOGLE_ROUTES_API_KEY or GOOGLE_SERVER_API_KEY.');
  process.exit(1);
}

/** Fixed Dar es Salaam lat/lng pairs (no Places autocomplete). */
const DAR_OD_PAIRS = [
  { name: 'Kivukoni→Mikocheni', origin: { latitude: -6.8161, longitude: 39.2894 }, destination: { latitude: -6.7650, longitude: 39.2530 } },
  { name: 'Posta→Ubungo', origin: { latitude: -6.8160, longitude: 39.2803 }, destination: { latitude: -6.7924, longitude: 39.2083 } },
  { name: 'Masaki→Sinza', origin: { latitude: -6.7465, longitude: 39.2795 }, destination: { latitude: -6.7810, longitude: 39.2225 } },
  { name: 'Airport→CityCentre', origin: { latitude: -6.8781, longitude: 39.2026 }, destination: { latitude: -6.8162, longitude: 39.2804 } },
  { name: 'Tegeta→Mwenge', origin: { latitude: -6.6505, longitude: 39.1860 }, destination: { latitude: -6.7705, longitude: 39.2295 } },
  { name: 'MbeziBeach→Oysterbay', origin: { latitude: -6.7000, longitude: 39.2200 }, destination: { latitude: -6.7580, longitude: 39.2750 } },
  { name: 'Kimara→Makumbusho', origin: { latitude: -6.7830, longitude: 39.1600 }, destination: { latitude: -6.7770, longitude: 39.2400 } },
  { name: 'Tabata→Kariakoo', origin: { latitude: -6.8350, longitude: 39.2200 }, destination: { latitude: -6.8235, longitude: 39.2730 } },
  { name: 'GongoLaMboto→Ilala', origin: { latitude: -6.8800, longitude: 39.1600 }, destination: { latitude: -6.8270, longitude: 39.2560 } },
  { name: 'Kawe→Msasani', origin: { latitude: -6.7350, longitude: 39.2300 }, destination: { latitude: -6.7600, longitude: 39.2650 } },
];

assert.ok(DAR_OD_PAIRS.length >= 5, 'need ≥5 Dar OD pairs');

function kmFromMeters(meters) {
  return Number((meters / 1000).toFixed(2));
}

function pctDelta(optimalMeters, awareMeters) {
  if (!(awareMeters > 0)) {
    return null;
  }
  return Number((((optimalMeters - awareMeters) / awareMeters) * 100).toFixed(2));
}

function polylineHash(encoded) {
  const text = typeof encoded === 'string' ? encoded : '';
  if (!text) {
    return { length: 0, sha1: '' };
  }
  return {
    length: text.length,
    sha1: crypto.createHash('sha1').update(text).digest('hex').slice(0, 12),
  };
}

function frontendLabel(meters) {
  if (!(meters > 0)) return '—';
  if (meters < 1000) return `${Math.max(1, Math.round(meters))} m`;
  const km = meters / 1000;
  if (km >= 100) return `${Math.round(km)} km`;
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} km`;
}

async function runPair(pair) {
  const optimal = await computeRoute({
    apiKey,
    origin: pair.origin,
    destination: pair.destination,
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
  });
  const aware = await computeRoute({
    apiKey,
    origin: pair.origin,
    destination: pair.destination,
    routingPreference: 'TRAFFIC_AWARE',
  });

  assert.ok(Number.isFinite(optimal.distanceMeters) && optimal.distanceMeters > 0, `${pair.name} OPTIMAL meters`);
  assert.ok(Number.isFinite(optimal.durationSeconds) && optimal.durationSeconds > 0, `${pair.name} OPTIMAL duration`);
  assert.ok(Number.isFinite(aware.distanceMeters) && aware.distanceMeters > 0, `${pair.name} AWARE meters`);
  assert.ok(Number.isFinite(aware.durationSeconds) && aware.durationSeconds > 0, `${pair.name} AWARE duration`);

  const optPoly = polylineHash(optimal.polyline);
  const awrPoly = polylineHash(aware.polyline);

  return {
    name: pair.name,
    origin: `${pair.origin.latitude},${pair.origin.longitude}`,
    destination: `${pair.destination.latitude},${pair.destination.longitude}`,
    optimalMeters: optimal.distanceMeters,
    optimalKm: kmFromMeters(optimal.distanceMeters),
    optimalDurationSec: optimal.durationSeconds,
    optimalLabel: frontendLabel(optimal.distanceMeters),
    optimalPolyLen: optPoly.length,
    optimalPolySha: optPoly.sha1,
    awareMeters: aware.distanceMeters,
    awareKm: kmFromMeters(aware.distanceMeters),
    awareDurationSec: aware.durationSeconds,
    awarePolyLen: awrPoly.length,
    awarePolySha: awrPoly.sha1,
    deltaMeters: optimal.distanceMeters - aware.distanceMeters,
    deltaPct: pctDelta(optimal.distanceMeters, aware.distanceMeters),
    sameRoad: optPoly.sha1 === awrPoly.sha1 && optPoly.sha1 !== '',
  };
}

async function main() {
  console.log('Haul Routes compare — Dar es Salaam fixed OD pairs');
  console.log('Maps comparison method: TRAFFIC_AWARE_OPTIMAL (Google docs ≡ Maps app).');
  console.log('Maps UI not scraped. Legacy Haul HEAD used TRAFFIC_AWARE (not Maps-equivalent).');
  console.log(`Pairs: ${DAR_OD_PAIRS.length}`);
  console.log(`API key present: true (len=${apiKey.length}, value redacted)`);
  console.log('');

  const rows = [];
  for (const pair of DAR_OD_PAIRS) {
    process.stdout.write(`… ${pair.name}\r`);
    // Gentle pacing to avoid Routes QPS spikes
    // eslint-disable-next-line no-await-in-loop
    const row = await runPair(pair);
    rows.push(row);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  console.log(
    [
      'name'.padEnd(26),
      'OPT_m'.padStart(7),
      'AWR_m'.padStart(7),
      'Δm'.padStart(7),
      'Δ%'.padStart(7),
      'sameRoad'.padStart(8),
      'OPT_label'.padStart(10),
      'polySha'.padStart(14),
    ].join(' ')
  );
  console.log('-'.repeat(100));

  for (const row of rows) {
    console.log(
      [
        row.name.slice(0, 26).padEnd(26),
        String(row.optimalMeters).padStart(7),
        String(row.awareMeters).padStart(7),
        String(row.deltaMeters).padStart(7),
        `${row.deltaPct}%`.padStart(7),
        String(row.sameRoad).padStart(8),
        row.optimalLabel.padStart(10),
        row.optimalPolySha.padStart(14),
      ].join(' ')
    );
  }

  const absPcts = rows.map((r) => Math.abs(r.deltaPct ?? 0));
  const maxAbsPct = Math.max(...absPcts);
  const avgAbsPct = absPcts.reduce((a, b) => a + b, 0) / absPcts.length;
  const identical = rows.filter((r) => r.deltaMeters === 0).length;
  const sameRoad = rows.filter((r) => r.sameRoad).length;
  const material = rows.filter((r) => Math.abs(r.deltaPct ?? 0) >= 2);

  console.log('');
  console.log(`Identical distance (OPT==AWR): ${identical}/${rows.length}`);
  console.log(`Same polyline hash: ${sameRoad}/${rows.length}`);
  console.log(`Avg |Δ%|: ${avgAbsPct.toFixed(2)}%`);
  console.log(`Max |Δ%|: ${maxAbsPct.toFixed(2)}%`);
  if (material.length) {
    console.log(`Material |Δ%|≥2%: ${material.map((r) => `${r.name}(${r.deltaPct}%)`).join(', ')}`);
  } else {
    console.log('Material |Δ%|≥2%: none on this run');
  }
  console.log('');
  console.log('Note: Without live Maps UI scrape, OPTIMAL is the Maps-equivalent target.');
  console.log('Haul working tree default is TRAFFIC_AWARE_OPTIMAL; committed HEAD was TRAFFIC_AWARE.');
  console.log('compare-routes-dar: all pairs returned finite OPTIMAL + AWARE distances.');
}

main().catch((error) => {
  console.error('compare-routes-dar failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
