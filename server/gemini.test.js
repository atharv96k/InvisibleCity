import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiNearby, verifyPlace } from './gemini.js';
import { makeApp } from './index.js';
import { mapsLink } from '../src/lib/walk.js';

const noDelay = async () => {};
const center = { lat: 17.0356, lon: 74.6019 };

// A fake internet: Gemini, OpenStreetMap search/reverse, and (optionally) Wikipedia.
function fakeNet({ suggestions, osm = {}, geo = { lat: '17.0356', lon: '74.6019', display_name: 'Somwar Peth, Tasgaon, Sangli, Maharashtra, India' } }) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push(url);
    if (url.includes('generativelanguage.googleapis.com')) {
      assert.equal(opts.headers['x-goog-api-key'], 'GK');
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(suggestions) }] } }] }) };
    }
    const u = new URL(url);
    if (u.pathname === '/reverse') return { ok: true, json: async () => ({ address: { suburb: 'Somwar Peth', town: 'Tasgaon' } }) };
    const q = u.searchParams.get('q') || '';
    if (!q.includes(',')) return { ok: true, json: async () => (geo ? [geo] : []) }; // typed area
    const hit = Object.entries(osm).find(([name]) => q.startsWith(name));
    return { ok: true, json: async () => (hit ? [hit[1]] : []) };
  };
  f.calls = calls;
  return f;
}
const noWiki = async () => ({ ok: true, json: async () => ({ query: { pages: {} } }) });
const sug = (...places) => ({ center: { lat: 17.0356, lon: 74.6019 }, places });
const P = (name, lat, lon, kind = 'Temple', summary = `${name} is a well known local landmark.`) => ({ name, kind, summary, lat, lon });
const row = (name, lat, lon) => ({ name, display_name: `${name}, Tasgaon, Maharashtra`, lat: String(lat), lon: String(lon) });

test('typed area works: places are verified, and a made-up one is dropped', async () => {
  const net = fakeNet({
    suggestions: sug(P('Siddheshwar Temple', 17.04, 74.606), P('Ganpati Panchayatan Temple', 17.037, 74.603), P('Invented Fort of Nowhere', 17.036, 74.602), P('Old Town Hall', 17.038, 74.604), P('Bhairavnath Mandir', 17.039, 74.601)),
    osm: { 'Siddheshwar Temple': row('Siddheshwar Temple', 17.0412, 74.6071), 'Ganpati Panchayatan Temple': row('Ganpati Panchayatan Temple', 17.0371, 74.6032), 'Old Town Hall': row('Town Hall', 17.0382, 74.6043), 'Bhairavnath Mandir': row('Bhairavnath Mandir', 17.0391, 74.6012) },
  });
  const out = await geminiNearby({ q: 'somwar peth tasgaon' }, { key: 'GK', models: ['m'], fetchImpl: net, wikiFetch: noWiki, delay: noDelay });
  assert.equal(out.center.label, 'Somwar Peth, Tasgaon');
  assert.deepEqual(out.places.map((p) => p.title), ['Siddheshwar Temple', 'Ganpati Panchayatan Temple', 'Old Town Hall', 'Bhairavnath Mandir']);
  assert.ok(out.places.every((p) => !p.approx));
  assert.equal(out.places[0].lat, 17.0412, "uses OpenStreetMap's coordinates, not the model's");
  assert.match(out.places[0].source, /confirmed in OpenStreetMap/);
  assert.match(out.places[0].url, /openstreetmap\.org/);
});

test('a result that only shares the word "temple" is not accepted', async () => {
  const net = fakeNet({ suggestions: sug(P('Hanuman Temple', 17.037, 74.603)), osm: { 'Hanuman Temple': row('Ram Temple', 17.037, 74.603) } });
  const hit = await verifyPlace('Hanuman Temple', center, 'Tasgaon', { fetchImpl: net, delay: noDelay });
  assert.equal(hit, null);
  const ok = await verifyPlace('Ram Temple', center, 'Tasgaon', { fetchImpl: fakeNet({ suggestions: {}, osm: { 'Ram Temple': row('Ram Temple', 17.037, 74.603) } }), delay: noDelay });
  assert.equal(ok.lat, 17.037);
});

test('when OpenStreetMap confirms nothing, places are kept but marked approximate; far ones are dropped', async () => {
  const net = fakeNet({ suggestions: sug(P('Local Shrine', 17.037, 74.603), P('Distant Fort', 17.30, 74.90)) });
  const out = await geminiNearby({ q: 'Tasgaon' }, { key: 'GK', models: ['m'], fetchImpl: net, wikiFetch: noWiki, delay: noDelay });
  assert.equal(out.places.length, 1);
  assert.equal(out.places[0].approx, true);
  assert.match(out.places[0].source, /NOT be confirmed/);
  assert.equal(out.places[0].url, '');
});

test('the area itself is never offered as a place', async () => {
  const net = fakeNet({ suggestions: sug(P('Somwar Peth', 17.0356, 74.6019, 'Neighbourhood'), P('Tasgaon', 17.0356, 74.6019, 'Town'), P('Local Shrine', 17.037, 74.603)) });
  const out = await geminiNearby({ q: 'Somwar Peth, Tasgaon' }, { key: 'GK', models: ['m'], fetchImpl: net, wikiFetch: noWiki, delay: noDelay });
  assert.deepEqual(out.places.map((p) => p.title), ['Local Shrine']);
});

test('coordinates input: the area is named by reverse geocoding before asking Gemini', async () => {
  const net = fakeNet({ suggestions: sug(P('Local Shrine', 17.037, 74.603)), osm: { 'Local Shrine': row('Local Shrine', 17.0371, 74.6031) } });
  const out = await geminiNearby({ lat: 17.0356, lon: 74.6019, label: 'your location' }, { key: 'GK', models: ['m'], fetchImpl: net, wikiFetch: noWiki, delay: noDelay });
  assert.equal(out.center.label, 'your location');
  assert.equal(out.center.area, 'Somwar Peth, Tasgaon');
  assert.equal(out.places[0].approx, false);
});

test('Wikipedia text is used when its page matches a verified place', async () => {
  const net = fakeNet({ suggestions: sug(P('Siddheshwar Temple', 17.04, 74.606)), osm: { 'Siddheshwar Temple': row('Siddheshwar Temple', 17.0412, 74.6071) } });
  const pages = { 1: { pageid: 1, title: 'Siddheshwar Temple, Tasgaon', coordinates: [{ lat: 17.0413, lon: 74.6072 }], extract: 'A well preserved stone temple on the riverbank, built in the 18th century.' } };
  const out = await geminiNearby({ q: 'Tasgaon' }, { key: 'GK', models: ['m'], fetchImpl: net, wikiFetch: async () => ({ ok: true, json: async () => ({ query: { pages } }) }), delay: noDelay });
  assert.match(out.places[0].snippet, /stone temple on the riverbank/);
  assert.match(out.places[0].source, /^Wikipedia/);
});

test('Gemini failure is reported with the model name', async () => {
  const f = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota exceeded' } }) });
  await assert.rejects(() => geminiNearby({ q: 'Tasgaon' }, { key: 'GK', models: ['a', 'b'], fetchImpl: f, wikiFetch: noWiki, delay: noDelay }), /a: HTTP 429.*b: HTTP 429/);
});

test('directions: verified places use exact coordinates, approximate ones search by name and area', () => {
  assert.match(mapsLink({ title: 'X', lat: 17.04, lon: 74.6, approx: false }), /destination=17\.04,74\.6$/);
  const u = mapsLink({ title: 'Local Shrine', query: 'Local Shrine, Somwar Peth, Tasgaon', lat: 1, lon: 2, approx: true });
  assert.match(u, /destination=Local%20Shrine%2C%20Somwar%20Peth%2C%20Tasgaon/);
});

test('HTTP: Gemini is used when only a Gemini key is set; failures fall back to Wikipedia with the reason', async () => {
  const net = fakeNet({ suggestions: sug(P('Local Shrine', 17.037, 74.603), P('Old Fort', 17.038, 74.604), P('Town Hall', 17.039, 74.605)), osm: { 'Local Shrine': row('Local Shrine', 17.037, 74.603), 'Old Fort': row('Old Fort', 17.038, 74.604), 'Town Hall': row('Town Hall', 17.039, 74.605) } });
  let server = makeApp({ googleKey: '', geminiKey: 'GK', geminiFetch: net, geminiModels: ['m'], wikiFetch: noWiki, osmDelay: noDelay }).listen(0);
  let base = `http://127.0.0.1:${server.address().port}`;
  let j = await (await fetch(`${base}/api/nearby?q=${encodeURIComponent('somwar peth tasgaon')}`)).json();
  assert.equal(j.provider, 'gemini');
  assert.equal(j.places.length, 3);
  assert.equal((await (await fetch(`${base}/api/health`)).json()).places, 'gemini');
  server.close();

  const long = 'A long enough summary of a real place with some history in it.';
  const pages = { 1: { pageid: 1, title: 'A', coordinates: [{ lat: 17.036, lon: 74.602 }], extract: long } };
  const dead = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) });
  server = makeApp({ googleKey: '', geminiKey: 'GK', geminiFetch: dead, geminiModels: ['m'], osmDelay: noDelay, wikiFetch: async () => ({ ok: true, json: async () => ({ query: { pages } }) }) }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  j = await (await fetch(`${base}/api/nearby?lat=17.0356&lon=74.6019`)).json();
  assert.equal(j.provider, 'wikipedia');
  assert.match(j.providerError, /gemini: Gemini failed.*429/);
  server.close();
});
