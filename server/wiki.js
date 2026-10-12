// Finds real places near a point using Wikipedia's open location search.
// No API key. Coordinates are used for this one request and never stored or logged.

import { haversine } from '../src/lib/walk.js';

const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'InvisibleCity/0.1 (open-source Hacktoberfest project; https://github.com/atharv96k)';
const RADII = [2000, 5000, 10000]; // Wikipedia's location search allows at most 10 km

export function validCoords(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

async function getJson(params, fetchImpl) {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, 'Api-User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  return res.json();
}

const pagesOf = (data) => Object.values(data?.query?.pages || {});
const firstCoord = (p) => (Array.isArray(p.coordinates) ? p.coordinates[0] : null);

// Turns a typed place name into coordinates using Wikipedia's search.
export async function resolveName(q, fetchImpl = fetch) {
  const data = await getJson(
    {
      action: 'query',
      generator: 'search',
      gsrsearch: q,
      gsrlimit: '5',
      prop: 'coordinates',
      colimit: '5',
    },
    fetchImpl
  );
  const hit = pagesOf(data)
    .filter((p) => firstCoord(p))
    .sort((a, b) => (a.index || 0) - (b.index || 0))[0];
  if (!hit) return null;
  const c = firstCoord(hit);
  return { lat: c.lat, lon: c.lon, label: hit.title };
}

// Famous and near beats obscure and nearest. Page views over 60 days stand in for fame.
// Each kilometre costs a little; beyond a walkable 3 km it costs more; stub villages are
// pushed down because they are rarely worth a trip.
export function rankScore({ views = 0, dist, snippet = '' }) {
  let s = Math.log10(views + 10) - dist / 3300;
  if (dist > 3000) s -= ((dist - 3000) / 1000) * 0.5;
  if (/\b(is|was) an? (small )?(village|hamlet|census town)\b/i.test(snippet)) s -= 1;
  return s;
}

const viewsOf = (p) => Object.values(p.pageviews || {}).reduce((a, n) => a + (Number(n) || 0), 0);

function usable(p) {
  const t = p.title || '';
  const x = (p.extract || '').trim();
  return x.length >= 40 && !/^(List|Lists|Index) of /i.test(t) && !/may (also )?refer to/i.test(x);
}

export async function around(lat, lon, radius, fetchImpl) {
  const data = await getJson(
    {
      action: 'query',
      generator: 'geosearch',
      ggscoord: `${lat}|${lon}`,
      ggsradius: String(radius),
      ggslimit: '20',
      prop: 'extracts|coordinates|pageviews',
      pvipdays: '60',
      exintro: '1',
      explaintext: '1',
      exchars: '420',
      exlimit: 'max',
      colimit: 'max',
    },
    fetchImpl
  );
  return pagesOf(data)
    .filter((p) => firstCoord(p) && usable(p))
    .map((p) => {
      const c = firstCoord(p);
      return {
        id: `p${p.pageid}`,
        title: p.title,
        snippet: p.extract.replace(/\s+/g, ' ').trim(),
        url: `https://en.wikipedia.org/?curid=${p.pageid}`,
        lat: c.lat,
        lon: c.lon,
        dist: Math.round(haversine(lat, lon, c.lat, c.lon)),
        views: viewsOf(p),
      };
    })
    .map((x) => ({ ...x, score: rankScore(x) }))
    .sort((a, b) => b.score - a.score);
}

// input: { lat, lon } or { q }. Returns { center, places } (places may be empty).
export async function nearby(input, fetchImpl = fetch) {
  let { lat, lon } = input;
  let label = input.label || '';
  if (input.q) {
    const hit = await resolveName(input.q, fetchImpl);
    if (!hit) return { center: null, places: [] };
    ({ lat, lon, label } = hit);
  }
  if (!validCoords(lat, lon)) throw new Error('bad coordinates');
  let places = [];
  for (const r of RADII) {
    places = await around(lat, lon, r, fetchImpl);
    if (places.length >= 8) break;
  }
  return { center: { lat, lon, label }, places: places.slice(0, 8) };
}
