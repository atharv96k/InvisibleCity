// Checks and shapes AI output. Used by the server before it answers and by the
// browser again before anything is shown. The model writes words; this file decides
// whether those words are allowed through.

import { groundCheck, templateReply } from './walk.js';

const UNSAFE =
  /\b(climb|trespass|break in|break into|jump over|sneak|squeeze through|after dark|at night|scale the)\b/i;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Text the AI is allowed to draw numbers from.
export function allowedText(place, notes = []) {
  return [place.title, place.snippet, ...notes].join(' ');
}

export function missionText(m) {
  return [m.title, m.story, ...(m.steps || []), m.look_for].join(' ');
}

export function checkMission(m, place, notes) {
  const errors = [];
  if (!m?.title) errors.push('missing title');
  if (!m?.story) errors.push('missing story');
  if (!Array.isArray(m?.steps) || m.steps.length < 2) errors.push('fewer than 2 steps');
  if (!m?.look_for) errors.push('missing look_for');
  const text = missionText(m || { steps: [] });
  if (UNSAFE.test(text)) errors.push('unsafe wording');
  const g = groundCheck(text, allowedText(place, notes));
  if (!g.ok) errors.push(`ungrounded numbers: ${g.ungrounded.join(', ')}`);
  return { ok: errors.length === 0, errors };
}

export function mergeMission(raw, place, notes = []) {
  const value = {
    title: str(raw?.title, 60),
    story: str(raw?.story, 320),
    steps: Array.isArray(raw?.steps) ? raw.steps.map((s) => str(s, 180)).filter(Boolean).slice(0, 4) : [],
    look_for: str(raw?.look_for, 200),
  };
  const c = checkMission(value, place, notes);
  return { ok: c.ok, errors: c.errors, value: c.ok ? value : null };
}

export function checkReply(r, place, notes) {
  const errors = [];
  if (!Array.isArray(r?.interpretation) || r.interpretation.length === 0) errors.push('missing interpretation');
  if (!r?.still_unknown) errors.push('missing still_unknown');
  if (!r?.look_closer) errors.push('missing look_closer');
  const text = [...(r?.interpretation || []), r?.still_unknown || '', r?.look_closer || ''].join(' ');
  const g = groundCheck(text, allowedText(place, notes));
  if (!g.ok) errors.push(`ungrounded numbers: ${g.ungrounded.join(', ')}`);
  return { ok: errors.length === 0, errors };
}

export function mergeReply(raw, place, notes = []) {
  const fallback = templateReply(place, '');
  const value = {
    interpretation: Array.isArray(raw?.interpretation)
      ? raw.interpretation.map((s) => str(s, 300)).filter(Boolean).slice(0, 3)
      : [],
    still_unknown: str(raw?.still_unknown, 220) || fallback.still_unknown,
    look_closer: str(raw?.look_closer, 180) || fallback.look_closer,
  };
  const c = checkReply(value, place, notes);
  return { ok: c.ok, errors: c.errors, value: c.ok ? value : null };
}
