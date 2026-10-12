// Invisible City, shared logic (runs in the browser and on the server).
// Everything here is plain and deterministic: distances, fallback wording used when
// the AI is unavailable, and the grounding check that every AI answer must pass.

export const SAFETY = [
  'Stay in public areas and on safe paths.',
  'Do not enter restricted property.',
  'Do not put yourself in danger to finish a mission.',
];

export const MAX_STOPS = 3;

const STOP = new Set(
  (
    'this that with from have were been they them then than there their about into over under would ' +
    'could should which while where when what your you the and for are was but not all any can had has ' +
    'its out our one two also very just more most some such only other these those saw see found'
  ).split(' ')
);

export function keywords(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]{4,}/g) || [];
  return [...new Set(words.filter((w) => !STOP.has(w)))];
}

export function overlap(a, b) {
  const set = new Set(keywords(b));
  return keywords(a).filter((w) => set.has(w));
}

export function years(text) {
  return (String(text || '').match(/\b(1[0-9]\d\d|20[0-2]\d)\b/g) || []).map(Number);
}

export function clip(text, n) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function firstSentence(text, n = 220) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return clip(m ? m[1] : t, n);
}

// ---------------------------------------------------------------- distance

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function fmtDistance(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// About 80 metres per minute on foot.
export function walkMinutes(m) {
  return Math.max(1, Math.round(m / 80));
}

// Directions to the exact place, never to the town around it.
export function mapsLink(place) {
  const base = 'https://www.google.com/maps/dir/?api=1&travelmode=walking';
  if (place.approx) return `${base}&destination=${encodeURIComponent(place.query || place.title)}`;
  if (place.placeId) {
    return `${base}&destination=${encodeURIComponent(place.title)}&destination_place_id=${encodeURIComponent(place.placeId)}`;
  }
  return `${base}&destination=${place.lat},${place.lon}`;
}

// --------------------------------------------------------------- grounding

// Every number in AI text must also appear in the Wikipedia summary, the place name,
// or something the walker wrote. Trailing punctuation is ignored ("1912." is 1912).
export function groundCheck(text, allowedText) {
  const nums = (String(text || '').match(/\b\d[\d,.]*\b/g) || []).map((n) => n.replace(/[.,]+$/, ''));
  const allowed = String(allowedText || '');
  const ungrounded = nums.filter((n) => n && !allowed.includes(n));
  return { ok: ungrounded.length === 0, ungrounded };
}

// ------------------------------------------------------ fallback wording

export function templateMission(place) {
  return {
    title: clip(`Look at ${place.title}`, 60),
    story: firstSentence(place.snippet),
    steps: [
      `Walk to ${place.title}.`,
      'Stop, put your phone away and look at it properly for a minute.',
      'Find one detail: a date, a name, a material, a sign or a shape.',
    ],
    look_for: 'One specific detail you can describe in your own words.',
  };
}

export function templateReply(place, note) {
  const lines = [];
  const shared = overlap(note, `${place.title} ${place.snippet}`);
  const noteYears = years(note);
  const sourceYears = years(place.snippet);
  if (noteYears.length && sourceYears.length) {
    const y = noteYears[0];
    const near = sourceYears.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
    lines.push(`The ${y} you saw can be compared with ${near} in the place details.`);
  } else if (noteYears.length) {
    lines.push(`The ${noteYears[0]} you saw is not in the place details, so it is new evidence.`);
  }
  if (shared.length) {
    lines.push(`Your note shares wording (${shared.slice(0, 3).join(', ')}) with the details of ${place.title}.`);
  }
  if (!lines.length) {
    lines.push('Nothing in the place details mentions what you described. That makes it your own evidence.');
  }
  return {
    interpretation: lines.slice(0, 3),
    still_unknown: 'The details do not say whether what you saw is connected to the history of this place.',
    look_closer: 'Look again at the same spot: which part looks oldest, and what makes you think so?',
  };
}

// ------------------------------------------------------------ the summary

export function summary(rounds, t = {}) {
  const outside = rounds.reduce((x, r) => x + (r.outsideSeconds || 0), 0);
  const total = Number.isFinite(t.startedAt) && Number.isFinite(t.finishedAt) ? Math.max(0, (t.finishedAt - t.startedAt) / 1000) : null;
  const onScreen = total == null ? null : Math.max(0, total - outside);
  return {
    stops: rounds.length,
    minutesAway: Math.round(outside / 60),
    minutesOnScreen: onScreen == null ? null : Math.round(onScreen / 60),
    outsidePct: total ? Math.round((100 * Math.min(outside, total)) / total) : null,
    verified: rounds.filter((r) => r.verified).length,
    lines: rounds.map((r) => ({ place: r.place.title, url: r.place.url, note: r.note, second: r.second?.note || null, verified: Boolean(r.verified) })),
  };
}

export function shareText(center, rounds, times) {
  const s = summary(rounds, times);
  const share = s.outsidePct == null ? '' : ` · ${s.outsidePct}% of the session outside`;
  return [
    'INVISIBLE CITY',
    `${s.stops} real place${s.stops === 1 ? '' : 's'} near ${center.label || 'me'} · ${s.minutesAway} min away from the screen${share}`,
    ...s.lines.map((l) => `• ${l.place}${l.verified ? ' (arrival confirmed)' : ''}: “${clip(l.note, 90)}”${l.second ? ` → “${clip(l.second, 90)}”` : ''}`),
  ].join('\n');
}

// ------------------------------------------------------------ voice text

export function missionSpeech(place, mission) {
  return [
    place.title + '.',
    mission.story,
    ...mission.steps.map((s, i) => `Step ${i + 1}. ${s}`),
    `Bring back: ${mission.look_for}`,
  ].join(' ');
}

export function replySpeech(round) {
  return [...round.reply.interpretation, `Still unknown: ${round.reply.still_unknown}`].join(' ');
}

// ------------------------------------------------- voice-guided walking

export const ARRIVE_M = 60;
export const FAR_M = 5000;
const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export function bearing(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export const compass = (deg) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// What to say as the walker moves. Speaks when first asked, then only when the
// distance has changed by 40 m or more, so it never chatters.
export function guide({ title, dist, deg, lastSpokenDist, arrived }) {
  if (dist > FAR_M) {
    return { state: 'far', arrived: false, speak: false, trend: null, text: `${title} is ${fmtDistance(dist)} from where you are. Walking guidance works when you are close.` };
  }
  if (dist <= ARRIVE_M) {
    return { state: 'arrived', arrived: true, speak: !arrived, trend: null, text: 'You are here. Put the phone away and look around.' };
  }
  const label = fmtDistance(dist);
  const dir = compass(deg);
  if (lastSpokenDist == null) {
    return { state: 'walking', arrived: false, speak: true, trend: null, text: `${title} is ${label} away, to the ${dir}.` };
  }
  const delta = lastSpokenDist - dist;
  if (delta >= 40) return { state: 'walking', arrived: false, speak: true, trend: 'warmer', text: `Warmer. ${label} to go, to the ${dir}.` };
  if (delta <= -40) return { state: 'walking', arrived: false, speak: true, trend: 'colder', text: `Colder. ${label} away. Turn around: it is to the ${dir}.` };
  return { state: 'walking', arrived: false, speak: false, trend: null, text: null };
}

// Beyond about 3 km this is a trip, not a walk.
export const WALKABLE_M = 4500;
