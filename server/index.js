// Invisible City server: serves the built app and one small AI endpoint.
// The Groq key lives only here (in .env or the host's environment variables).

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, sanitizeContext } from './ai.js';
import { nearby, validCoords } from './wiki.js';
import { googleNearby } from './places.js';
import { geminiNearby } from './gemini.js';

// Always read the .env in the project root, no matter which folder the command is run from.
// A hosting dashboard sets real environment variables instead, so a missing file is fine.
try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch {
  /* no .env file */
}

const PORT = Number(process.env.PORT) || 8787;
// A placeholder like "your_key_here" copied from .env.example counts as no key.
const real = (v) => (v && !/^your_|_here$|_her$/i.test(v.trim()) ? v.trim() : '');
const KEY = real(process.env.GROQ_API_KEY);
const GOOGLE_KEY = real(process.env.GOOGLE_MAPS_API_KEY);
const GEMINI_KEY = real(process.env.GEMINI_API_KEY);
const GEMINI_MODELS = (process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.0-flash').split(',').map((m) => m.trim()).filter(Boolean);
const MODELS = (process.env.GROQ_MODELS || 'openai/gpt-oss-120b,openai/gpt-oss-20b')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const PER_MODEL_MS = Number(process.env.GROQ_TIMEOUT_MS) || 7000;
const LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 20;

async function callModel({ model, messages }) {
  const body = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 700,
    response_format: { type: 'json_object' },
  };
  if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
  const res = await fetch(`${process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PER_MODEL_MS),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 200);
    throw new Error(`Groq HTTP ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

export function makeApp({ call = callModel, models = MODELS, hasKey = Boolean(KEY), wikiFetch = fetch, googleKey = GOOGLE_KEY, googleFetch = fetch, geminiKey = GEMINI_KEY, geminiFetch = fetch, geminiModels = GEMINI_MODELS, osmDelay } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '24kb' }));

  const hits = new Map();
  function limited(ip) {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
    list.push(now);
    hits.set(ip, list);
    return list.length > LIMIT_PER_MIN;
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ai: hasKey, models: hasKey ? models : [], places: googleKey ? 'google' : geminiKey ? 'gemini' : 'wikipedia' });
  });

  app.post('/api/ai', async (req, res) => {
    if (!hasKey) return res.status(503).json({ ok: false, error: 'no_key' });
    if (limited(`ai:${req.ip}`)) return res.status(429).json({ ok: false, error: 'rate_limited' });
    const parsed = sanitizeContext(req.body);
    if (!parsed) return res.status(400).json({ ok: false, error: 'bad_request' });
    const out = await generate({ task: parsed.task, ctx: parsed.ctx, models, callModel: call });
    if (!out.ok) return res.status(502).json({ ok: false, error: 'ai_failed', errors: out.errors });
    res.json({ ok: true, model: out.model, ms: out.ms, value: out.value });
  });

  // Real places near a point (or near a typed area). Tries Google Maps, then Gemini checked
  // against OpenStreetMap, then Wikipedia, using whichever keys are configured.
  // Coordinates are not stored or logged.
  app.get('/api/nearby', async (req, res) => {
    if (limited(`geo:${req.ip}`)) return res.status(429).json({ ok: false, error: 'rate_limited' });
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!q && !validCoords(lat, lon)) return res.status(400).json({ ok: false, error: 'bad_request' });
    const input = q ? { q } : { lat, lon, label: 'your location' };
    const notes = [];
    const tries = [];
    if (googleKey) tries.push(['google', () => googleNearby(input, { key: googleKey, fetchImpl: googleFetch, wikiFetch })]);
    if (geminiKey) {
      tries.push(['gemini', () => geminiNearby(input, { key: geminiKey, models: geminiModels, fetchImpl: geminiFetch, wikiFetch, delay: osmDelay })]);
    }
    tries.push(['wikipedia', () => nearby(input, wikiFetch)]);
    for (const [name, run] of tries) {
      try {
        const out = await run();
        if (!out.center) {
          notes.push(`${name}: could not find that area`);
          continue;
        }
        if (!out.places.length) {
          notes.push(`${name}: no places found`);
          continue;
        }
        return res.json({ ok: true, provider: name, providerError: notes.join(' | '), ...out });
      } catch (e) {
        notes.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
      }
    }
    const notFound = notes.every((n) => /could not find that area/.test(n));
    res.status(notFound ? 404 : 502).json({ ok: false, error: notFound ? 'place_not_found' : 'places_failed', detail: notes.join(' | ').slice(0, 300) });
  });

  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  makeApp().listen(PORT, () => {
    console.log(`Invisible City on http://localhost:${PORT}  AI: ${KEY ? `on (${MODELS.join(', ')})` : 'OFF (no GROQ_API_KEY), templates only'}`);
  });
}