import test from 'node:test';
import assert from 'node:assert/strict';
import { googleNearby, resolveTyped, toPlaces, placeScore } from './places.js';
import { makeApp } from './index.js';
import { mapsLink } from '../src/lib/walk.js';

const g = (id, name, lat, lon, extra = {}) => ({ id, displayName: { text: name }, formattedAddress: `${name} Road, Tasgaon, Maharashtra`, location: { latitude: lat, longitude: lon }, ...extra });
const center = { lat: 17.0356, lon: 74.6019, label: 'Somwar Peth, Tasgaon' };

function fakeGoogle(handlers) {
  const calls = [];
  const f = async (url, opts) => {
    const path = url.split('/v1/')[1];
    const body = JSON.parse(opts.body);
    calls.push({ path, body, headers: opts.headers });
    const h = handlers[path];
    if (!h) throw new Error(`unexpected ${path}`);
    const out = h(body);
    return { ok: out.status ? out.status < 400 : true, status: out.status || 200, json: async () => out.json };
  };
  f.calls = calls;
  return f;
}

test('typed locality resolves to coordinates and a readable label', async () => {
  const f = fakeGoogle({ 'places:searchText': () => ({ json: { places: [{ displayName: { text: 'Somwar Peth' }, formattedAddress: 'Somwar Peth, Tasgaon, Maharashtra 416312, India', location: { latitude: 17.0356, longitude: 74.6019 } }] } }) });
  const hit = await resolveTyped('somwar peth tasgaon', { key: 'K', fetchImpl: f });
  assert.equal(hit.lat, 17.0356);
  assert.equal(hit.label, 'Somwar Peth, Tasgaon');
  assert.equal(f.calls[0].body.textQuery, 'somwar peth tasgaon');
  assert.equal(f.calls[0].headers['X-Goog-Api-Key'], 'K');
  assert.equal(await resolveTyped('zzzz', { key: 'K', fetchImpl: fakeGoogle({ 'places:searchText': () => ({ json: {} }) }) }), null);
});

test('nearby search is limited to 4 km and to historical/attraction types', async () => {
  const f = fakeGoogle({ 'places:searchNearby': () => ({ json: { places: [g('a', 'Ganpati Temple', 17.0360, 74.6020), g('b', 'Old Fort', 17.0400, 74.6100), g('c', 'Garden', 17.0390, 74.6050)] } }) });
  const out = await googleNearby({ lat: center.lat, lon: center.lon, label: center.label }, { key: 'K', fetchImpl: f, wikiFetch: async () => ({ ok: false, status: 500 }) });
  const body = f.calls[0].body;
  assert.equal(body.locationRestriction.circle.radius, 4000);
  assert.equal(body.rankPreference, 'POPULARITY');
  assert.ok(body.includedTypes.includes('historical_landmark') && body.includedTypes.includes('tourist_attraction'));
  assert.ok(!body.includedTypes.includes('restaurant'));
  assert.equal(out.places.length, 3);
});

test('famous, well-rated places rank first; closed, far and the area itself are dropped', () => {
  const raw = [
    g('quiet', 'Quiet Shrine', 17.0357, 74.6020, { userRatingCount: 8, rating: 4.9 }),
    g('famous', 'Siddheshwar Temple', 17.0420, 74.6080, { userRatingCount: 4200, rating: 4.7, primaryTypeDisplayName: { text: 'Hindu temple' }, editorialSummary: { text: 'A historic temple on the riverbank.' }, googleMapsUri: 'https://maps.google.com/?cid=1' }),
    g('closed', 'Closed Place', 17.0357, 74.6020, { businessStatus: 'CLOSED_PERMANENTLY', userRatingCount: 9000 }),
    g('far', 'Distant Fort', 17.20, 74.80, { userRatingCount: 90000 }),
    g('self', 'Somwar Peth', 17.0356, 74.6019, { userRatingCount: 500 }),
  ];
  const places = toPlaces(raw, center);
  assert.deepEqual(places.map((p) => p.title), ['Siddheshwar Temple', 'Quiet Shrine']);
  assert.match(places[0].snippet, /historic temple on the riverbank/);
  assert.match(places[0].snippet, /is a hindu temple at/);
  assert.equal(places[0].source, 'Google Maps');
  assert.ok(placeScore({ ratings: 4000, rating: 4.7, dist: 1000 }) > placeScore({ ratings: 5, rating: 5, dist: 100 }));
});

test('Wikipedia adds a story when its page matches by name and position', () => {
  const raw = [g('s', 'Shri Siddheshwar Temple', 17.0420, 74.6080), g('t', 'Hanuman Temple', 17.0430, 74.6090)];
  const wiki = [{ title: 'Siddheshwar Temple, Tasgaon', snippet: 'A 12th century Shiva temple built by the Chalukyas.', url: 'https://en.wikipedia.org/?curid=5', lat: 17.0421, lon: 74.6081 }];
  const [a, b] = toPlaces(raw, center, wiki).sort((x) => (x.title.includes('Siddheshwar') ? -1 : 1));
  assert.match(a.snippet, /Chalukyas/);
  assert.equal(a.source, 'Google Maps and Wikipedia');
  assert.equal(a.url, 'https://en.wikipedia.org/?curid=5');
  assert.doesNotMatch(b.snippet, /Chalukyas/, 'sharing only the word "temple" is not a match');
});

test('falls back to a text search when few places come back, and retries with safe types on a 400', async () => {
  let n = 0;
  const f = fakeGoogle({
    'places:searchNearby': () => (n++ === 0 ? { status: 400, json: { error: { message: 'Unsupported types' } } } : { json: { places: [g('a', 'One', 17.036, 74.602)] } }),
    'places:searchText': () => ({ json: { places: [g('b', 'Two', 17.037, 74.603), g('c', 'Three', 17.038, 74.604)] } }),
  });
  const out = await googleNearby({ lat: center.lat, lon: center.lon, label: center.label }, { key: 'K', fetchImpl: f, wikiFetch: async () => ({ ok: false, status: 500 }) });
  assert.equal(out.places.length, 3);
  assert.deepEqual(f.calls.filter((c) => c.path === 'places:searchNearby').map((c) => c.body.includedTypes.length > 4), [true, false]);
});

test('directions go to the exact place id, not the town', () => {
  const url = mapsLink({ title: 'Siddheshwar Temple', placeId: 'ChIJabc', lat: 1, lon: 2 });
  assert.match(url, /destination=Siddheshwar%20Temple/);
  assert.match(url, /destination_place_id=ChIJabc/);
  assert.match(mapsLink({ title: 'X', lat: 1.5, lon: 2.5 }), /destination=1\.5,2\.5/);
});

test('HTTP: uses Google when keyed, falls back to Wikipedia with the reason when Google fails', async () => {
  const good = fakeGoogle({
    'places:searchText': (b) => (b.maxResultCount === 1 ? { json: { places: [{ displayName: { text: 'Somwar Peth' }, formattedAddress: 'Somwar Peth, Tasgaon', location: { latitude: 17.0356, longitude: 74.6019 } }] } } : { json: { places: [] } }),
    'places:searchNearby': () => ({ json: { places: [g('a', 'Ganpati Temple', 17.036, 74.602), g('b', 'Old Fort', 17.04, 74.61), g('c', 'Garden', 17.039, 74.605)] } }),
  });
  const wiki = async () => ({ ok: true, json: async () => ({ query: { pages: {} } }) });
  let server = makeApp({ googleKey: 'K', googleFetch: good, wikiFetch: wiki }).listen(0);
  let base = `http://127.0.0.1:${server.address().port}`;
  let j = await (await fetch(`${base}/api/nearby?q=${encodeURIComponent('somwar peth tasgaon')}`)).json();
  assert.equal(j.provider, 'google');
  assert.equal(j.center.label, 'Somwar Peth, Tasgaon');
  assert.equal(j.places.length, 3);
  assert.equal((await (await fetch(`${base}/api/health`)).json()).places, 'google');
  server.close();

  const bad = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Places API (New) has not been used in project' } }) });
  const long = 'A long enough summary of a real place with some history in it.';
  const pages = { 1: { pageid: 1, title: 'A', coordinates: [{ lat: 17.036, lon: 74.602 }], extract: long } };
  server = makeApp({ googleKey: 'K', googleFetch: bad, wikiFetch: async () => ({ ok: true, json: async () => ({ query: { pages } }) }) }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  j = await (await fetch(`${base}/api/nearby?lat=17.0356&lon=74.6019`)).json();
  assert.equal(j.provider, 'wikipedia');
  assert.match(j.providerError, /403/);
  server.close();
});
