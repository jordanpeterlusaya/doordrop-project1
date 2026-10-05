#!/usr/bin/env node
/**
 * Read-only LATRA PIS bus position (https://pis.latra.go.tz/).
 * Uses the same Basic auth headers shipped in the public PIS web bundle.
 *
 * Usage:
 *   LATRA_PIS_USER=... LATRA_PIS_PASS=... node latra-bus-track.js --from "Dar es Salaam" --to "Mwanza"
 *   LATRA_PIS_USER=... LATRA_PIS_PASS=... node latra-bus-track.js --vehicle T101DYM
 */

const PIS_BASE = 'https://pis.latra.go.tz';

function authHeaders() {
  const user = process.env.LATRA_PIS_USER;
  const pass = process.env.LATRA_PIS_PASS;
  if (!user || !pass) {
    console.error('Set LATRA_PIS_USER and LATRA_PIS_PASS (see pis.latra.go.tz public PIS frontend).');
    process.exit(1);
  }
  const token = Buffer.from(`${user}:${pass}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    'X-Requested-With': 'XMLHttpRequest',
  };
}

async function pisFetch(path) {
  const res = await fetch(`${PIS_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`LATRA PIS HTTP ${res.status} for ${path}`);
  }
  return res.json();
}

async function loadStops() {
  const json = await pisFetch('/vts/latra/api/stops?page_size=1000');
  return json.data || [];
}

function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchStop(stops, label) {
  const needle = norm(label);
  if (!needle) return null;
  const ranked = stops
    .map((stop) => {
      const name = norm(stop.stop_name);
      const hay = norm(`${stop.stop_name} ${stop.address}`);
      let score = 0;
      if (name === needle) score = 200;
      else if (name.includes(needle) || needle.includes(name)) score = 150;
      else if (hay === needle) score = 100;
      else if (hay.includes(needle)) score = 70;
      else if (needle.split(' ').every((part) => part.length > 2 && hay.includes(part))) score = 50;
      return { stop, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.stop || null;
}

function pickRouteVehicle(rows, originStop, destStop) {
  const destId = destStop?.id;
  const originName = norm(originStop?.stop_name);
  return (rows || []).find((row) => {
    const eta = row.eta || {};
    if (destId && Number(eta.destination_stop_id) === Number(destId)) return true;
    const dep = norm(eta.departure_stop_name);
    const dest = norm(eta.destination_stop_name);
    if (originName && dep.includes(originName) && destStop && dest.includes(norm(destStop.stop_name))) return true;
    return false;
  }) || (rows || []).find((row) => row.location_point_name && Number(row.latitude) && Number(row.longitude)) || null;
}

function progressLine(row, destStop) {
  const place = row.location_point_name || `${row.latitude}, ${row.longitude}`;
  const dest = destStop?.stop_name || row.eta?.destination_stop_name || '—';
  const etaMin = row.eta?.eta_to_destination;
  const etaPart = Number(etaMin) > 0 ? ` · takriban dakika ${etaMin} hadi ${dest}` : '';
  return `${place}${etaPart}`;
}

function parseArgs(argv) {
  const out = { from: '', to: '', vehicle: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--from' && val) out.from = val;
    if (key === '--to' && val) out.to = val;
    if (key === '--vehicle' && val) out.vehicle = val;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.vehicle) {
    const rows = await pisFetch(`/vts/latra/api/dtr_last_known?vehicle_reg_no=${encodeURIComponent(args.vehicle)}`);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.location_point_name && !(row?.latitude && row?.longitude)) {
      console.log(JSON.stringify({ ok: false, url: PIS_BASE, reason: 'No live GPS for that registration.' }));
      return;
    }
    console.log(JSON.stringify({
      ok: true,
      url: PIS_BASE,
      vehicle: row.vehicle_reg_no,
      summary: progressLine(row, null),
    }));
    return;
  }
  if (!args.from || !args.to) {
    console.error('Provide --from and --to city/terminal names, or --vehicle REG.');
    process.exit(1);
  }
  const stops = await loadStops();
  const originStop = matchStop(stops, args.from);
  const destStop = matchStop(stops, args.to);
  if (!destStop) {
    console.log(JSON.stringify({ ok: false, url: PIS_BASE, reason: `Could not match destination "${args.to}".` }));
    return;
  }
  const etaRows = await pisFetch(`/vts/latra/eta/stop?stop_id=${destStop.id}`);
  const row = pickRouteVehicle(etaRows, originStop, destStop);
  if (!row?.location_point_name) {
    console.log(JSON.stringify({
      ok: false,
      url: PIS_BASE,
      reason: `No live bus found for ${args.from} → ${args.to} at stop ${destStop.stop_name}.`,
    }));
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    url: PIS_BASE,
    route: `${args.from} → ${args.to}`,
    vehicle: row.vehicle_reg_no,
    summary: progressLine(row, destStop),
  }));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
