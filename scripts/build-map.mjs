// Build compact Zambia province/district SVG map data from geoBoundaries gbOpen GeoJSON.
// Usage: node scripts/build-map.mjs <adm1.geojson> <adm2.geojson> <out.json>
// Zero dependencies. Projection: x=(lon-lonMin)*kx*scale, y=(latMax-lat)*scale.
import { readFileSync, writeFileSync } from 'node:fs';

const TOL = 0.6; // Douglas-Peucker tolerance, px
const [, , adm1Path, adm2Path, outPath] = process.argv;
if (!adm1Path || !adm2Path || !outPath) {
  console.error('Usage: node scripts/build-map.mjs <adm1.geojson> <adm2.geojson> <out.json>');
  process.exit(1);
}
const adm1 = JSON.parse(readFileSync(adm1Path, 'utf8'));
const adm2 = JSON.parse(readFileSync(adm2Path, 'utf8'));

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

// Bounding box over everything (provinces + districts).
let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
for (const f of [...adm1.features, ...adm2.features])
  for (const poly of polysOf(f.geometry)) for (const ring of poly) for (const [lo, la] of ring) {
    if (lo < lonMin) lonMin = lo; if (lo > lonMax) lonMax = lo;
    if (la < latMin) latMin = la; if (la > latMax) latMax = la;
  }
const kx = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180);
const scale = 1000 / ((lonMax - lonMin) * kx);
const H = Math.ceil((latMax - latMin) * scale);
const proj = ([lo, la]) => [(lo - lonMin) * kx * scale, (latMax - la) * scale];
const unproj = ([x, y]) => [x / (kx * scale) + lonMin, latMax - y / scale];

function dp(pts, tol) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * (px - ax) - dx * (py - ay)) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r1 = (v) => Math.round(v * 10) / 10;
const area = (ring) => { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return s / 2; };

// Returns { d, outer: simplified projected outer rings, largest }
function build(feature) {
  const rings = []; // {pts, outer}
  for (const poly of polysOf(feature.geometry))
    poly.forEach((ring, k) => {
      let pts = ring.map(proj);
      const f = pts[0], l = pts[pts.length - 1];
      if (f[0] === l[0] && f[1] === l[1]) pts = pts.slice(0, -1);
      // simplify closed ring: split at two far-apart anchors
      let i0 = 0, i1 = 0, md = -1;
      for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > md) { md = d; i1 = i; } }
      const A = dp(pts.slice(i0, i1 + 1), TOL);
      const B = dp([...pts.slice(i1), pts[0]], TOL);
      const s = [...A, ...B.slice(1, -1)];
      rings.push({ pts: s, outer: k === 0, a: Math.abs(area(pts)) });
    });
  let largest = null;
  for (const r of rings) if (r.outer && (!largest || r.a > largest.a)) largest = r;
  const kept = rings.filter((r) => r.pts.length >= 4 || r === largest);
  const d = kept.map((r) => 'M' + r.pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' L') + ' Z').join(' ');
  return { d, outer: kept.filter((r) => r.outer).map((r) => r.pts), largest: largest.pts, kept };
}

function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const c = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += c; cx += (ring[j][0] + ring[i][0]) * c; cy += (ring[j][1] + ring[i][1]) * c;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (6 * a), cy / (6 * a)];
}
function pip(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inAny = (p, rings) => rings.some((r) => pip(p, r));

const clean = (s) => s.replace(/\s+(District|Province)$/i, '').trim();
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function uniq(list) {
  const seen = new Map();
  for (const o of list) { const n = (seen.get(o.id) || 0) + 1; seen.set(o.id, n); if (n > 1) o.id += '-' + n; }
}

const provinces = adm1.features.map((f) => {
  const name = clean(f.properties.shapeName);
  const b = build(f);
  return { id: slug(name), name, d: b.d, _outer: b.outer, _c: centroid(b.largest) };
});
uniq(provinces);

const districts = adm2.features.map((f) => {
  const name = clean(f.properties.shapeName);
  const b = build(f);
  let c = centroid(b.largest);
  if (!pip(c, b.largest)) {
    let best = Infinity, bp = c;
    for (const v of b.largest) { const dd = (v[0] - c[0]) ** 2 + (v[1] - c[1]) ** 2; if (dd < best) { best = dd; bp = v; } }
    c = bp;
  }
  let prov = provinces.find((p) => inAny(c, p._outer));
  if (!prov) {
    let best = Infinity;
    for (const p of provinces) { const dd = (p._c[0] - c[0]) ** 2 + (p._c[1] - c[1]) ** 2; if (dd < best) { best = dd; prov = p; } }
  }
  const [lng, lat] = unproj(c);
  return { id: slug(name), name, province: prov.id, d: b.d, cx: r1(c[0]), cy: r1(c[1]), lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4 };
});
uniq(districts);

const out = {
  viewBox: `0 0 1000 ${H}`,
  width: 1000,
  height: H,
  projection: { type: 'equirectangular', lonMin, latMax, kx, scale },
  provinces: provinces.map(({ id, name, d }) => ({ id, name, d })),
  districts,
  source: {
    name: 'geoBoundaries',
    url: 'https://www.geoboundaries.org/api/current/gbOpen/ZMB/ADM2/',
    license: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    attribution: 'geoBoundaries gbOpen ZMB (boundaryYearRepresented 2020). Provinces: Zambia Data Hub; districts: GRID3, Office of the Surveyor General.',
    retrieved: '2026-11-25',
  },
};
writeFileSync(outPath, JSON.stringify(out));
console.log(`provinces=${out.provinces.length} districts=${districts.length} viewBox=${out.viewBox}`);
