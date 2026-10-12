// Finds real places near a point (or near a typed place name) using Google Maps
// Places API (New). The key stays on the server. Wikipedia is used only to add a
// short story to places it also knows about.

import { haversine, keywords } from '../src/lib/walk.js';
import { around as wikiAround } from './wiki.js';

const BASE = 'https://places.googleapis.com/v1';
export const RADIUS_M = 4000;

const FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.primaryTypeDisplayName',
  'places.rating',
  'places.userRatingCount',
  'places.editorialSummary',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

// Historical, cultural and "worth a visit" places only: no shops, restaurants or offices.
const TYPES = ['tourist_attraction', 'historical_landmark', 'monument', 'museum', 'hindu_temple', 'mosque', 'church', 'park'];
const SAFE_TYPES = ['tourist_attraction', 'museum', 'park', 'hindu_temple'];

async function call(path, body, { key, fetchImpl = fetch, fields = FIELDS }) {
  const res = await fetchImpl(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(9000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`Google Maps HTTP ${res.status}: ${String(data?.error?.message || '').slice(0, 160)}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// "somwar peth tasgaon" -> coordinates and a readable name.
export async function resolveTyped(q, ctx) {
  const data = await call('places:searchText', { textQuery: q, maxResultCount: 1, languageCode: 'en' }, {
    ...ctx,
    fields: 'places.displayName,places.formattedAddress,places.location',
  });
  const p = data.places?.[0];
  if (!p?.location) return null;
  const area = String(p.formattedAddress || '').split(',').slice(0, 2).join(',').trim();
  const name = p.displayName?.text || q;
  return { lat: p.location.latitude, lon: p.location.longitude, label: area && !area.startsWith(name) ? `${name}, ${area}` : area || name };
}

async function searchNearby(lat, lon, ctx) {
  const body = (types) => ({
    includedTypes: types,
    maxResultCount: 20,
    rankPreference: 'POPULARITY',
    languageCode: 'en',
    locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: RADIUS_M } },
  });
  try {
    return (await call('places:searchNearby', body(TYPES), ctx)).places || [];
  } catch (e) {
    if (e.status !== 400) throw e;
    return (await call('places:searchNearby', body(SAFE_TYPES), ctx)).places || [];
  }
}

async function searchText(lat, lon, ctx) {
  const data = await call(
    'places:searchText',
    {
      textQuery: 'historical places and tourist attractions',
      maxResultCount: 20,
      languageCode: 'en',
      locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: RADIUS_M } },
    },
    ctx
  );
  return data.places || [];
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const GENERIC = new Set(
  'temple church mosque shri shree sri museum fort palace garden gardens park lake mandir masjid hall road chowk peth bridge stadium maharaj district tourist point view'.split(' ')
);

// Popularity (number of ratings) and rating, minus a little for each kilometre.
export function placeScore({ ratings = 0, rating = 0, dist }) {
  let s = Math.log10(ratings + 10) + (rating ? (rating - 4) * 0.2 : 0) - dist / 3300;
  if (dist > 3500) s -= (dist - 3500) / 1000;
  return s;
}

export function wikiMatch(g, wikiPages) {
  const mine = keywords(g.title).filter((w) => !GENERIC.has(w));
  if (!mine.length) return null;
  return (
    wikiPages.find((w) => {
      const near = haversine(g.lat, g.lon, w.lat, w.lon) <= 600;
      const shared = keywords(w.title).filter((x) => !GENERIC.has(x) && mine.includes(x));
      return near && shared.length > 0;
    }) || null
  );
}

export function toPlaces(raw, center, wikiPages = []) {
  const seen = new Set();
  const out = [];
  const areaNames = String(center.label || '').split(',').map(norm).filter(Boolean);
  for (const g of raw) {
    const title = g.displayName?.text;
    if (!g.id || !title || !g.location || g.businessStatus === 'CLOSED_PERMANENTLY' || seen.has(g.id)) continue;
    seen.add(g.id);
    const dist = Math.round(haversine(center.lat, center.lon, g.location.latitude, g.location.longitude));
    if (dist > RADIUS_M + 500) continue;
    if (areaNames.includes(norm(title))) continue; // the area itself or its town, not a place in it
    const base = { title, lat: g.location.latitude, lon: g.location.longitude };
    const wiki = wikiMatch(base, wikiPages);
    const kind = g.primaryTypeDisplayName?.text || '';
    const facts = [
      wiki?.snippet,
      g.editorialSummary?.text,
      `${title}${kind ? ` is a ${kind.toLowerCase()}` : ''} at ${g.formattedAddress || 'this area'}.`,
      g.rating ? `Google Maps users rate it ${g.rating} out of 5.` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 600);
    out.push({
      id: g.id,
      placeId: g.id,
      title,
      snippet: facts,
      url: wiki?.url || g.googleMapsUri || '',
      source: wiki ? 'Google Maps and Wikipedia' : 'Google Maps',
      address: g.formattedAddress || '',
      lat: base.lat,
      lon: base.lon,
      dist,
      ratings: g.userRatingCount || 0,
      score: placeScore({ ratings: g.userRatingCount || 0, rating: g.rating || 0, dist }),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

// input: { lat, lon, label } or { q }. Returns { center, places }.
export async function googleNearby(input, { key, fetchImpl = fetch, wikiFetch = fetch }) {
  const ctx = { key, fetchImpl };
  let { lat, lon, label } = input;
  if (input.q) {
    const hit = await resolveTyped(input.q, ctx);
    if (!hit) return { center: null, places: [] };
    ({ lat, lon, label } = hit);
  }
  const center = { lat, lon, label: label || '' };
  let raw = await searchNearby(lat, lon, ctx);
  if (raw.length < 3) raw = [...raw, ...(await searchText(lat, lon, ctx))];
  let wikiPages = [];
  try {
    wikiPages = await wikiAround(lat, lon, RADIUS_M, wikiFetch);
  } catch {
    /* the story from Wikipedia is a bonus; Google's details are enough */
  }
  return { center, places: toPlaces(raw, center, wikiPages) };
}
