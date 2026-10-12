import test from 'node:test';
import assert from 'node:assert/strict';
import { nearby, validCoords, resolveName, rankScore } from './wiki.js';

const page = (id, title, lat, lon, extract) => ({ pageid: id, title, coordinates: [{ lat, lon }], extract });
const reply = (pages) => ({ ok: true, json: async () => ({ query: { pages: Object.fromEntries(pages.map((p) => [p.pageid, p])) } }) });
const long = 'This is a long enough summary of a real place with some history in it.';

test('validCoords', () => {
  assert.equal(validCoords(16.7, 74.2), true);
  assert.equal(validCoords(100, 0), false);
  assert.equal(validCoords(NaN, 0), false);
});

test('nearby sorts by distance and drops weak pages', async () => {
  const f = async () =>
    reply([
      page(1, 'Far Place', 16.72, 74.25, long),
      page(2, 'Near Place', 16.7005, 74.2433, long),
      page(3, 'List of things', 16.701, 74.2433, long),
      page(4, 'Stub', 16.7002, 74.2433, 'short'),
      page(5, 'Third', 16.71, 74.25, long),
    ]);
  const out = await nearby({ lat: 16.7, lon: 74.2433, label: 'here' }, f);
  assert.deepEqual(out.places.map((p) => p.title), ['Near Place', 'Third', 'Far Place'], 'with no popularity data, nearer ranks first');
  assert.ok(out.places[0].dist < 100);
  assert.match(out.places[0].url, /curid=2/);
});

test('widens the radius when few places are found', async () => {
  const radii = [];
  const f = async (url) => {
    radii.push(new URL(url).searchParams.get('ggsradius'));
    return reply([page(1, 'Only One', 16.7, 74.2433, long)]);
  };
  const out = await nearby({ lat: 16.7, lon: 74.2433 }, f);
  assert.deepEqual(radii, ['2000', '5000', '10000']);
  assert.equal(out.places.length, 1);
});

test('typed place name is resolved first, unknown name returns no center', async () => {
  const f = async (url) => {
    const u = new URL(url);
    if (u.searchParams.get('generator') === 'search') {
      return reply(u.searchParams.get('gsrsearch') === 'Nowhere' ? [] : [{ ...page(9, 'Kolhapur', 16.705, 74.2433), index: 1 }]);
    }
    return reply([page(1, 'Place', 16.706, 74.2433, long), page(2, 'Two', 16.707, 74.2433, long), page(3, 'Three', 16.708, 74.2433, long)]);
  };
  const out = await nearby({ q: 'Kolhapur' }, f);
  assert.equal(out.center.label, 'Kolhapur');
  assert.equal(out.places.length, 3);
  assert.equal((await nearby({ q: 'Nowhere' }, f)).center, null);
  assert.equal(await resolveName('Nowhere', f), null);
});

test('HTTP errors surface as errors', async () => {
  await assert.rejects(() => nearby({ lat: 1, lon: 1 }, async () => ({ ok: false, status: 503 })), /Wikipedia HTTP 503/);
  await assert.rejects(() => nearby({ lat: 999, lon: 1 }, async () => reply([])), /bad coordinates/);
});

test('famous places beat obscure villages that are slightly closer', async () => {
  const f = async () =>
    reply([
      { ...page(1, 'Tiny Village', 16.7003, 74.2433, 'Tiny Village is a village in the district, with a small population of farmers.'), pageviews: { d1: 4, d2: 6 } },
      { ...page(2, 'Famous Palace', 16.7300, 74.2433, long), pageviews: { d1: 900, d2: 1100, d3: 800 } },
      { ...page(3, 'Quiet Lane', 16.7010, 74.2433, long), pageviews: { d1: 30 } },
    ]);
  const out = await nearby({ lat: 16.7, lon: 74.2433 }, f);
  assert.equal(out.places[0].title, 'Famous Palace');
  assert.equal(out.places.at(-1).title, 'Tiny Village');
  assert.equal(out.places[0].views, 2800);
});

test('rankScore: walkable fame wins, far fame loses, stubs are pushed down', () => {
  const famousNear = rankScore({ views: 30000, dist: 2500 });
  const obscureNearest = rankScore({ views: 100, dist: 150 });
  const famousFar = rankScore({ views: 30000, dist: 9500 });
  assert.ok(famousNear > obscureNearest);
  assert.ok(obscureNearest > famousFar);
  assert.ok(rankScore({ views: 500, dist: 500, snippet: 'X is a village in Y.' }) < rankScore({ views: 500, dist: 500 }));
});
