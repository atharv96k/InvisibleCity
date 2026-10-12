// Client side of the AI layer. The screens only call these functions.
// If anything goes wrong with the AI (no key, offline, slow, invalid or ungrounded
// answer) the built-in wording is used instead, and the result says so.

import { templateMission, templateReply } from './walk.js';
import { checkMission, checkReply } from './aiShape.js';

const TIMEOUT_MS = 22000;
const calls = [];
export const callLog = () => calls.slice();

function record(entry) {
  calls.push({ at: Date.now(), ...entry });
  if (calls.length > 40) calls.shift();
  return entry;
}

async function request(url, options, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const why = data.error || `HTTP ${res.status}`;
      throw new Error(data.errors ? `${why}: ${data.errors.join(' | ')}` : data.detail ? `${why}: ${data.detail}` : why);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const reasonOf = (e) => (e?.name === 'AbortError' ? 'timeout' : e?.message || String(e));

// Real places near coordinates ({lat, lon}) or near a typed name ({q}).
export async function getNearby(input) {
  const qs = input.q
    ? new URLSearchParams({ q: input.q })
    : new URLSearchParams({ lat: String(input.lat), lon: String(input.lon) });
  const t0 = performance.now();
  const data = await request(`/api/nearby?${qs}`, {}, 15000);
  record({ task: 'nearby', source: 'wikipedia', ms: Math.round(performance.now() - t0), count: data.places.length });
  return data;
}

export async function getMission(place, earlier = []) {
  const t0 = performance.now();
  try {
    const data = await request(
      '/api/ai',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'mission', ctx: { place: { title: place.title, snippet: place.snippet }, earlier } }),
      },
      TIMEOUT_MS
    );
    const check = checkMission(data.value, place, earlier);
    if (!check.ok) throw new Error(`client check failed: ${check.errors.join('; ')}`);
    return record({ task: 'mission', source: 'ai', model: data.model, ms: Math.round(performance.now() - t0), value: data.value });
  } catch (e) {
    return record({ task: 'mission', source: 'template', reason: reasonOf(e), ms: Math.round(performance.now() - t0), value: templateMission(place) });
  }
}

export async function getReply(place, note, earlier = []) {
  const t0 = performance.now();
  try {
    const data = await request(
      '/api/ai',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'reply', ctx: { place: { title: place.title, snippet: place.snippet }, earlier, note } }),
      },
      TIMEOUT_MS
    );
    const check = checkReply(data.value, place, [...earlier, note]);
    if (!check.ok) throw new Error(`client check failed: ${check.errors.join('; ')}`);
    return record({ task: 'reply', source: 'ai', model: data.model, ms: Math.round(performance.now() - t0), value: data.value });
  } catch (e) {
    return record({ task: 'reply', source: 'template', reason: reasonOf(e), ms: Math.round(performance.now() - t0), value: templateReply(place, note) });
  }
}

export async function getHealth() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { reachable: true, ...(await res.json()) };
  } catch (e) {
    return { reachable: false, ai: false, models: [], error: e?.message || String(e) };
  }
}
