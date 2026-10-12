import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, fmtDistance, walkMinutes, groundCheck, templateMission, templateReply, firstSentence, summary, shareText } from './walk.js';
import { mergeMission, mergeReply } from './aiShape.js';

const place = {
  id: 'p1',
  title: 'Rankala Lake',
  snippet: 'Rankala Lake is an artificial lake built in 1883. It is a popular public gathering place.',
  url: 'https://en.wikipedia.org/?curid=1',
  lat: 16.7,
  lon: 74.2,
  dist: 420,
};

test('haversine: one degree of latitude is about 111 km', () => {
  const d = haversine(16, 74, 17, 74);
  assert.ok(d > 110000 && d < 112500);
});
test('fmtDistance and walkMinutes', () => {
  assert.equal(fmtDistance(423), '420 m');
  assert.equal(fmtDistance(1530), '1.5 km');
  assert.equal(walkMinutes(400), 5);
  assert.equal(walkMinutes(10), 1);
});
test('groundCheck ignores trailing punctuation and flags invented numbers', () => {
  assert.equal(groundCheck('Built in 1883.', place.snippet).ok, true);
  const bad = groundCheck('Built in 1750 and rebuilt in 1883.', place.snippet);
  assert.deepEqual(bad.ungrounded, ['1750']);
});
test('templates are valid and grounded', () => {
  const m = templateMission(place);
  assert.equal(m.steps.length, 3);
  assert.equal(firstSentence(place.snippet), 'Rankala Lake is an artificial lake built in 1883.');
  const r = templateReply(place, 'A stone plaque dated 1890 near the lake edge');
  assert.match(r.interpretation[0], /1890/);
  assert.match(r.interpretation[0], /1883/);
  const none = templateReply(place, 'bicycle parked');
  assert.match(none.interpretation[0], /your own evidence/);
});
test('mergeMission accepts a good mission, rejects invented years and unsafe steps', () => {
  const good = { title: 'Look at the lake edge', story: 'It is an artificial lake.', steps: ['Walk to the edge.', 'Look at the stonework.', 'Note one detail.'], look_for: 'A sign or date.' };
  assert.equal(mergeMission(good, place).ok, true);
  assert.equal(mergeMission({ ...good, story: 'Built in 1750.' }, place).ok, false);
  assert.equal(mergeMission({ ...good, steps: ['Climb the fence.', 'Look.'] }, place).ok, false);
  assert.equal(mergeMission({ ...good, steps: ['Only one.'] }, place).ok, false);
});
test('mergeReply grounds numbers in the note or summary', () => {
  const ok = mergeReply({ interpretation: ['Your 1890 date is later than the 1883 construction.'] }, place, ['plaque dated 1890']);
  assert.equal(ok.ok, true);
  assert.ok(ok.value.still_unknown.length > 0);
  assert.equal(mergeReply({ interpretation: ['It dates from 1650.'] }, place, ['plaque']).ok, false);
});
test('summary and share text', () => {
  const rounds = [{ place, note: 'a plaque', outsideSeconds: 600 }, { place: { ...place, id: 'p2', title: 'Old Gate' }, note: 'iron rings', outsideSeconds: 300 }];
  const s = summary(rounds);
  assert.equal(s.stops, 2);
  assert.equal(s.minutesAway, 15);
  assert.match(shareText({ label: 'Kolhapur' }, rounds), /2 real places near Kolhapur · 15 min/);
});

import { missionSpeech, replySpeech } from './walk.js';
test('voice text reads the place, steps and bring-back line', () => {
  const m = { story: 'A lake.', steps: ['Walk.', 'Look.'], look_for: 'A sign.' };
  assert.equal(missionSpeech({ title: 'Rankala Lake' }, m), 'Rankala Lake. A lake. Step 1. Walk. Step 2. Look. Bring back: A sign.');
  assert.match(replySpeech({ reply: { interpretation: ['One.', 'Two.'], still_unknown: 'Unknown thing.' } }), /One\. Two\. Still unknown: Unknown thing\./);
});

import { bearing, compass, guide, ARRIVE_M } from './walk.js';
test('bearing and compass point the right way', () => {
  assert.equal(compass(bearing(16.7, 74.2, 16.8, 74.2)), 'north');
  assert.equal(compass(bearing(16.7, 74.2, 16.7, 74.3)), 'east');
  assert.equal(compass(bearing(16.7, 74.2, 16.6, 74.2)), 'south');
  assert.equal(compass(bearing(16.7, 74.2, 16.6, 74.1)), 'south-west');
});
test('guide: first message, warmer, colder, quiet, arrived, far', () => {
  const base = { title: 'Rankala Lake', deg: 45, arrived: false };
  assert.match(guide({ ...base, dist: 400, lastSpokenDist: null }).text, /400 m away, to the north-east/);
  const w = guide({ ...base, dist: 300, lastSpokenDist: 400 });
  assert.equal(w.trend, 'warmer');
  assert.equal(guide({ ...base, dist: 500, lastSpokenDist: 400 }).trend, 'colder');
  assert.equal(guide({ ...base, dist: 380, lastSpokenDist: 400 }).speak, false, 'small moves stay quiet');
  const here = guide({ ...base, dist: ARRIVE_M - 1, lastSpokenDist: 100 });
  assert.equal(here.arrived, true);
  assert.equal(here.speak, true);
  assert.equal(guide({ ...base, dist: 10, lastSpokenDist: 20, arrived: true }).speak, false, 'arrival is announced once');
  assert.equal(guide({ ...base, dist: 20000, lastSpokenDist: null }).state, 'far');
});
test('summary reports outside share and arrivals', () => {
  const r = [{ place: { title: 'A', url: 'u' }, note: 'n', outsideSeconds: 600, verified: true, second: { note: 'closer' } }];
  const s = summary(r, { startedAt: 0, finishedAt: 1200000 });
  assert.equal(s.outsidePct, 50);
  assert.equal(s.minutesOnScreen, 10);
  assert.equal(s.verified, 1);
  assert.match(shareText({ label: 'X' }, r, { startedAt: 0, finishedAt: 1200000 }), /50% of the session outside[\s\S]*arrival confirmed[\s\S]*closer/);
});
