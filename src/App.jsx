import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MAX_STOPS,
  SAFETY,
  fmtDistance,
  walkMinutes,
  mapsLink,
  summary,
  shareText,
  missionSpeech,
  replySpeech,
  haversine,
  bearing,
  compass,
  guide,
  ARRIVE_M,
  WALKABLE_M,
} from './lib/walk.js';
import { canSpeak, canListen, speak, stopSpeaking, listen, describeSpeechError } from './lib/voice.js';
import { getNearby, getMission, getReply, getHealth, callLog } from './lib/ai.js';

const KEY = 'invisible-city.v2';
const RESUMABLE = ['story', 'active', 'observe', 'observe2', 'reply', 'done'];

function loadSaved() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function persist(value) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage can be blocked; the app still works without it */
  }
}

const THINK_STAGES = [
  'Reading what you found…',
  'Comparing it with what is known…',
  'Looking for what is still unknown…',
];

const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const shortModel = (id) => String(id || '').split('/').pop();

const VOICE_KEY = 'invisible-city.voice';
function loadVoice() {
  try {
    return localStorage.getItem(VOICE_KEY) === '1';
  } catch {
    return false;
  }
}
function saveVoice(on) {
  try {
    localStorage.setItem(VOICE_KEY, on ? '1' : '0');
  } catch {
    /* fine */
  }
}

// ------------------------------------------------------------------ pieces

function Tag({ kind, children }) {
  return <span className={`tag tag-${kind}`}>{children}</span>;
}

function Header({ onHome, ai }) {
  let text = 'AI: checking…';
  let title = 'Checking whether the AI service is reachable.';
  if (ai.mode === 'ai') {
    text = `AI: ${shortModel(ai.model) || 'open-weight model'}`;
    title = `Words are written by an open-weight model (${ai.model || 'via Groq'}) and checked before you see them.`;
  } else if (ai.mode === 'template') {
    text = 'AI: built-in wording';
    title = 'The AI service was unavailable, so built-in wording was used.';
  }
  return (
    <header className="top">
      <button className="wordmark" onClick={onHome} aria-label="Invisible City, back to start">
        INVISIBLE CITY
      </button>
      <span className="chip" title={title}>{text}</span>
    </header>
  );
}

function VoiceToggle({ on, onChange }) {
  if (!canSpeak() && !canListen()) return null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`choice voice ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    >
      VOICE MODE: {on ? 'ON' : 'OFF'}
    </button>
  );
}

function ListenButton({ text }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => stopSpeaking(), []);
  if (!canSpeak()) return null;
  return (
    <button
      className="btn"
      onClick={() => {
        if (playing) {
          stopSpeaking();
          setPlaying(false);
        } else {
          speak(text);
          setPlaying(true);
        }
      }}
    >
      {playing ? 'STOP READING' : 'READ IT TO ME'}
    </button>
  );
}

function MapView({ center, place }) {
  const ref = useRef(null);
  const hasYou = center?.label === 'your location';
  useEffect(() => {
    if (!ref.current) return undefined;
    const map = L.map(ref.current, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const pts = [[place.lat, place.lon]];
    L.circleMarker([place.lat, place.lon], { radius: 9, color: '#a63d2a', fillColor: '#a63d2a', fillOpacity: 0.9 })
      .addTo(map)
      .bindTooltip(place.title, { permanent: true, direction: 'top' });
    if (hasYou) {
      pts.push([center.lat, center.lon]);
      L.circleMarker([center.lat, center.lon], { radius: 8, color: '#2b4a5c', fillColor: '#2b4a5c', fillOpacity: 0.9 })
        .addTo(map)
        .bindTooltip('You', { permanent: true, direction: 'top' });
      L.polyline([[center.lat, center.lon], [place.lat, place.lon]], { color: '#2b4a5c', weight: 3, dashArray: '6 8' }).addTo(map);
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
    return () => map.remove();
  }, [center, place, hasYou]);
  return (
    <div
      className="map"
      ref={ref}
      role="img"
      aria-label={hasYou ? `Map showing you and ${place.title}` : `Map showing ${place.title}`}
    />
  );
}

// ------------------------------------------------------------------ screens

function Landing({ onLocate, onSearch, canResume, onResume, onCheck, notice, voice, onVoice }) {
  const [q, setQ] = useState('');
  return (
    <section className="screen hero">
      <p className="eyebrow">A walking game</p>
      <h1 id="title">
        THERE IS A <em>STORY</em> NEAR YOU.
      </h1>
      <p className="lede">You can’t see it from your phone.</p>
      <p className="sub">
        Tap once. We find a real place close to where you are, with a story behind it. You go and
        look at it. Then you tell us what you found.
      </p>
      <div className="actions">
        <button className="btn primary" onClick={onLocate}>
          FIND A STORY NEAR ME
        </button>
        {canResume && (
          <button className="btn" onClick={onResume}>
            RESUME YOUR WALK
          </button>
        )}
      </div>
      {notice && <p className="note" role="status">{notice}</p>}
      <div className="actions">
        <VoiceToggle on={voice} onChange={onVoice} />
      </div>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onSearch(q.trim());
        }}
      >
        <label htmlFor="place">Or type your area, street or landmark</label>
        <input id="place" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Somwar Peth, Tasgaon" autoComplete="off" />
        <div className="actions">
          <button className="btn" type="submit" disabled={!q.trim()}>
            SEARCH THERE
          </button>
        </div>
      </form>
      <ol className="how">
        <li><b>01</b><span>We find a real place near you</span></li>
        <li><b>02</b><span>You walk there, phone away</span></li>
        <li><b>03</b><span>You tell us what you saw</span></li>
      </ol>
      <p className="fine">
        Your location, or the area you type, goes to this app’s server once. The server asks Gemini for historical
        places and attractions within 4 km, and checks each one against OpenStreetMap (or uses Google Maps or
        Wikipedia if those are set up). The mission AI, an open-weight model hosted on Groq, only sees a place
        name, its details and your notes. Never your location.
        The map is loaded from OpenStreetMap. Voice mode reads aloud on your device; speaking your note
        uses your browser’s speech service (in Chrome, Google’s).
      </p>
      <p className="fine">
        <button className="linklike" onClick={onCheck}>AI check</button>
      </p>
    </section>
  );
}

function Finding({ message }) {
  return (
    <section className="screen center">
      <p className="eyebrow">One moment</p>
      <h1 id="title" className="small">{message}</h1>
    </section>
  );
}

function Story({ exp, onGo, onAnother, hasAnother, voice, onFixLocation }) {
  const { place, mission, source, model } = exp.current;
  const spoken = missionSpeech(place, mission);
  useEffect(() => {
    if (voice) speak(spoken);
    return () => stopSpeaking();
  }, [voice, spoken]);
  return (
    <section className="screen">
      <p className="eyebrow">Stop {exp.rounds.length + 1} of up to {MAX_STOPS}</p>
      <h1 id="title">{place.title.toUpperCase()}</h1>
      <p className="meta">
        {place.dist > WALKABLE_M
          ? `${fmtDistance(place.dist)} AWAY · TOO FAR TO WALK, TAKE A RIDE THEN WALK THE LAST BIT`
          : `${fmtDistance(place.dist)} AWAY · ABOUT ${walkMinutes(place.dist)} MIN ON FOOT`}
      </p>
      {exp.center?.label && exp.center.label !== 'your location' && (
        <p className="fine">Places within 4 km of {exp.center.label}.</p>
      )}
      {exp.center?.accuracy > 1500 && (
        <div className="card unknown" role="alert">
          <Tag kind="unknown">LOCATION IS ROUGH</Tag>
          <p>
            Your device only located you to within about {Math.round(exp.center.accuracy / 1000)} km. Laptops often do this.
            If these places look too far away, go back and type your neighborhood, or open this on your phone.
          </p>
          <div className="actions">
            <button className="btn" onClick={onFixLocation}>
              TYPE WHERE I AM
            </button>
          </div>
        </div>
      )}
      <p className="lede">{mission.story}</p>
      <ol className="steps">
        {mission.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="card hyp">
        <Tag kind="hyp">BRING BACK</Tag>
        <p>{mission.look_for}</p>
      </div>
      <MapView center={exp.center} place={place} />
      <div className="actions">
        <ListenButton text={spoken} />
      </div>
      <div className="card evidence">
        <Tag kind="evidence">ABOUT THIS PLACE</Tag>
        <p>
          {place.snippet}{' '}
          {place.url && (
            <a className="src" href={place.url} target="_blank" rel="noreferrer">
              {place.linkLabel || (place.url.includes('wikipedia') ? 'Read the Wikipedia article' : 'Open in Google Maps')}
            </a>
          )}
        </p>
        <p className="fine">Source: {place.source || 'Wikipedia'}</p>
      </div>
      {place.approx && (
        <div className="card unknown" role="alert">
          <Tag kind="unknown">LOCATION IS APPROXIMATE</Tag>
          <p>An AI suggested this place and its position could not be confirmed on the map. Check the directions before you walk, and skip it if it looks wrong.</p>
        </div>
      )}
      {exp.providerError && <p className="note">Other sources were not used: {exp.providerError}</p>}
      <p className="note">
        {source === 'ai' ? `Mission written by ${shortModel(model)}, checked against the summary.` : 'Mission written by built-in wording because the AI was unavailable.'}
      </p>
      <p className="safety">{SAFETY.join(' ')}</p>
      <div className="actions">
        <a className="btn" href={mapsLink(place)} target="_blank" rel="noreferrer">
          OPEN WALKING DIRECTIONS
        </a>
      </div>
      <div className="phonedown">
        <h2>YOU HAVE ENOUGH INFORMATION.</h2>
        <p>Now put the phone away and go look. We’ll be here when you return.</p>
        <button className="btn primary" onClick={onGo}>
          I’M GOING
        </button>
      </div>
      {hasAnother && (
        <div className="actions">
          <button className="btn ghost" onClick={onAnother}>
            SHOW ME ANOTHER PLACE
          </button>
        </div>
      )}
    </section>
  );
}

function Active({ exp, voice, onFound }) {
  const [, tick] = useState(0);
  const [geo, setGeo] = useState({ status: 'waiting', text: '' });
  const lastSpoken = useRef(null);
  const arrived = useRef(false);
  const place = exp.current.place;
  const spoken = missionSpeech(place, exp.current.mission);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Live guidance from the device's own position. Nothing here leaves the phone.
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeo({ status: 'error', text: 'Location is not available, so arrival cannot be checked.' });
      return undefined;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const dist = haversine(latitude, longitude, place.lat, place.lon);
        const deg = bearing(latitude, longitude, place.lat, place.lon);
        const g = guide({ title: place.title, dist, deg, lastSpokenDist: lastSpoken.current, arrived: arrived.current });
        if (g.arrived) arrived.current = true;
        if (g.speak) {
          lastSpoken.current = dist;
          if (voice) speak(g.text);
          if (g.arrived) navigator.vibrate?.(200);
        }
        setGeo((prev) => ({ status: 'ok', dist, dir: compass(deg), trend: g.trend ?? prev.trend, arrived: arrived.current, text: g.text ?? prev.text }));
      },
      () => setGeo({ status: 'error', text: 'Location is unavailable, so arrival cannot be checked. You can still look around.' }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [place, voice]);

  useEffect(() => () => stopSpeaking(), []);

  const seconds = Math.max(0, Math.round((Date.now() - exp.leftAt) / 1000));
  return (
    <section className="screen dark center">
      <p className="eyebrow">Walk in progress</p>
      <h1 id="title" className="small">{geo.arrived ? 'You are here.' : 'Eyes up. Walk.'}</h1>
      {geo.status === 'ok' && (
        <p className="meta" aria-live="polite">
          {geo.arrived ? 'ARRIVED' : `${fmtDistance(geo.dist)} · ${geo.dir.toUpperCase()}${geo.trend ? ` · ${geo.trend.toUpperCase()}` : ''}`}
        </p>
      )}
      <p className="lede" aria-live="polite">
        {geo.text || 'Finding your position…'}
      </p>
      {!voice && canSpeak() && <p className="note">Turn on Voice mode on the home page and I’ll guide you by voice, so the phone can stay in your pocket.</p>}
      <p className="clock" aria-label="Time away from the screen">{fmtClock(seconds)}</p>
      <div className="actions">
        <ListenButton text={spoken} />
        <button className="btn primary" onClick={() => onFound({ verified: arrived.current, dist: geo.dist ?? null })}>
          I FOUND SOMETHING
        </button>
      </div>
    </section>
  );
}

function Observe({ exp, onSubmit, voice, question }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState('');
  const stopRef = useRef(null);
  useEffect(() => () => stopRef.current?.(), []);

  function toggleMic() {
    if (listening) {
      stopRef.current?.();
      return;
    }
    const base = text.trim();
    setMicNote('');
    setListening(true);
    stopRef.current = listen({
      onText: (t) => setText(base ? `${base} ${t}` : t),
      onEnd: () => setListening(false),
      onError: (code) => {
        setMicNote(describeSpeechError(code));
        setListening(false);
      },
    });
  }
  return (
    <section className="screen">
      <h1 id="title">{question ? 'LOOK CLOSER.' : 'WHAT DID YOU SEE?'}</h1>
      <p className="lede">
        {question || `Write what you actually saw at ${exp.current.place.title}. Exact words and numbers help most.`}
      </p>
      {!question && (
        <ul className="prompts">
          <li>What did you notice?</li>
          <li>What looked old, odd or out of place?</li>
          <li>A date, name, sign, material or shape?</li>
        </ul>
      )}
      <label className="field">
        <span>{question ? 'What you see now' : 'Your field note'}</span>
        <textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. A stone plaque by the gate. The carved date looks like 1912."
        />
      </label>
      {canListen() && (
        <>
          <div className="actions">
            <button className={`btn ${voice ? 'primary' : ''}`} onClick={toggleMic} aria-pressed={listening}>
              {listening ? 'LISTENING… TAP TO STOP' : 'SPEAK YOUR NOTE'}
            </button>
          </div>
          <p className="fine">Your browser’s speech service turns your voice into text (in Chrome, that is Google). You can edit the text before sending.</p>
          {micNote && <p className="note" role="status">{micNote}</p>}
        </>
      )}
      <div className="actions">
        <button className={`btn ${voice && canListen() ? '' : 'primary'}`} disabled={text.trim().length < 3} onClick={() => onSubmit(text.trim())}>
          SUBMIT FIELD NOTE
        </button>
      </div>
    </section>
  );
}

function Thinking({ ready, onDone }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= THINK_STAGES.length) {
      if (ready) onDone();
      return undefined;
    }
    const t = setTimeout(() => setI((n) => n + 1), 500);
    return () => clearTimeout(t);
  }, [i, ready, onDone]);
  return (
    <section className="screen center">
      <p className="eyebrow">Reading your field note</p>
      <ul className="stages" aria-live="polite">
        {THINK_STAGES.map((s, n) => (
          <li key={s} className={n < i ? 'done' : n === i ? 'now' : ''}>
            {s}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Reply({ exp, onNext, onFinish, onLookCloser, hasNext, voice }) {
  const r = exp.rounds[exp.rounds.length - 1];
  const spoken = replySpeech(r.second ? { reply: r.second.reply } : r);
  useEffect(() => {
    if (voice) speak(spoken);
    return () => stopSpeaking();
  }, [voice, spoken]);
  return (
    <section className="screen">
      <p className="eyebrow">{r.place.title}</p>
      <h1 id="title" className="small">Here is what that tells us.</h1>
      <div className="card obs">
        <Tag kind="obs">YOU SAW</Tag>
        <p>“{r.note}”</p>
      </div>
      <div className="card hyp">
        <Tag kind="hyp">INTERPRETATION</Tag>
        {r.reply.interpretation.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </div>
      <div className="card unknown">
        <Tag kind="unknown">STILL UNKNOWN</Tag>
        <p>{r.reply.still_unknown}</p>
      </div>
      {r.second && (
        <>
          <div className="card obs">
            <Tag kind="obs">YOU LOOKED CLOSER</Tag>
            <p>“{r.second.note}”</p>
          </div>
          <div className="card hyp">
            <Tag kind="hyp">INTERPRETATION</Tag>
            {r.second.reply.interpretation.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
        </>
      )}
      {!r.second && (
        <div className="card hyp">
          <Tag kind="hyp">ONE MORE LOOK</Tag>
          <p>{r.reply.look_closer}</p>
          <div className="actions">
            <button className="btn primary" onClick={onLookCloser}>
              GO BACK AND LOOK
            </button>
          </div>
        </div>
      )}
      <p className="note">
        {r.replySource === 'ai' ? 'Written by the AI, checked against the summary and your note.' : 'Built-in wording was used because the AI was unavailable.'}
      </p>
      <div className="actions">
        <ListenButton text={spoken} />
        {hasNext && (
          <button className={r.second ? 'btn primary' : 'btn'} onClick={onNext}>
            NEXT PLACE
          </button>
        )}
        <button className={hasNext ? 'btn' : r.second ? 'btn primary' : 'btn'} onClick={onFinish}>
          {hasNext ? 'FINISH FOR NOW' : 'SEE YOUR WALK'}
        </button>
      </div>
    </section>
  );
}

function Done({ exp, onReset }) {
  const s = useMemo(() => summary(exp.rounds, { startedAt: exp.startedAt, finishedAt: exp.finishedAt }), [exp.rounds, exp.startedAt, exp.finishedAt]);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(shareText(exp.center, exp.rounds, { startedAt: exp.startedAt, finishedAt: exp.finishedAt }));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section className="screen">
      <p className="eyebrow">Walk complete</p>
      <h1 id="title">YOU WENT AND LOOKED.</h1>
      <dl className="stats">
        <div><dt>Places visited</dt><dd>{s.stops}</dd></div>
        <div><dt>Minutes outside</dt><dd>{s.minutesAway}</dd></div>
        {s.minutesOnScreen != null && <div><dt>Minutes with the app open</dt><dd>{s.minutesOnScreen}</dd></div>}
        {s.outsidePct != null && <div><dt>Outside share</dt><dd>{s.outsidePct}%</dd></div>}
      </dl>
      <p className="note">
        Outside share is the time on the walking screen divided by the whole session. Arrival is confirmed when your
        phone’s position was within {ARRIVE_M} m of the place: {s.verified} of {s.stops}.
      </p>
      {exp.rounds.map((r) => (
        <div className="card obs" key={r.place.id}>
          <Tag kind="obs">{r.place.title.toUpperCase()}</Tag>
          <p>“{r.note}”</p>
          {r.second && <p>Looking closer: “{r.second.note}”</p>}
          <p>
            {r.verified ? 'Arrival confirmed. ' : 'Arrival not confirmed. '}
            {r.place.url && <a className="src" href={r.place.url} target="_blank" rel="noreferrer">Open place</a>}
          </p>
        </div>
      ))}
      <p className="note">These notes are your own observations. They are not confirmed historical facts.</p>
      <div className="actions">
        <button className="btn primary" onClick={copy}>
          {copied ? 'COPIED' : 'COPY RESULT'}
        </button>
        <button className="btn" onClick={onReset}>
          START ANOTHER WALK
        </button>
      </div>
    </section>
  );
}

function AiCheck({ onBack }) {
  const [log, setLog] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run() {
    setRunning(true);
    setDone(false);
    setCopied(false);
    const lines = ['INVISIBLE CITY CHECK', `time: ${new Date().toISOString()}`, `browser: ${navigator.userAgent}`, ''];
    const out = () => setLog(lines.join('\n'));
    out();
    let wiki = false;
    let place = null;
    const h = await getHealth();
    lines.push('[1] Server', `reachable: ${h.reachable}${h.error ? ` (${h.error})` : ''}`, `API key configured: ${h.ai}`, `models: ${h.models?.join(', ') || 'none'}`);
    out();
    if (h.reachable) {
      lines.push('', '[2] Nearby places (typed area: Somwar Peth Tasgaon)');
      out();
      try {
        const t0 = performance.now();
        const n = await getNearby({ q: 'Somwar Peth Tasgaon' });
        wiki = n.places.length > 0;
        place = n.places[0] || null;
        lines.push(`provider: ${n.provider}${n.providerError ? ` (Google not used: ${n.providerError})` : ''}`, `centre: ${n.center.label}`, `found ${n.places.length} places in ${Math.round(performance.now() - t0)} ms`);
        n.places.slice(0, 4).forEach((x) => lines.push(`  - ${x.title} (${fmtDistance(x.dist)}) [${x.source || 'Wikipedia'}]`));
        if (place) lines.push(`first: ${place.title} (${fmtDistance(place.dist)})`);
      } catch (e) {
        lines.push(`FAILED: ${e?.message || e}`);
      }
      out();
      if (place) {
        lines.push('', '[3] Test mission');
        out();
        const r = await getMission(place, []);
        lines.push(`source: ${r.source}${r.model ? ` (${r.model})` : ''}`, `time: ${r.ms} ms`);
        if (r.reason) lines.push(`fell back because: ${r.reason}`);
        lines.push(`title: ${r.value.title}`, `story: ${r.value.story}`);
        out();
      }
    }
    const lastMission = callLog().filter((c) => c.task === 'mission').at(-1);
    const verdict = h.reachable && h.ai && wiki && lastMission?.source === 'ai' ? 'PASS' : 'FAIL';
    lines.push('', `RESULT: ${verdict}`);
    out();
    setRunning(false);
    setDone(true);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="screen">
      <p className="eyebrow">Diagnostics</p>
      <h1 id="title" className="small">AI check</h1>
      <p className="lede">Tests the server, the AI key, the places search and one real mission. If something fails, copy the report.</p>
      <div className="actions">
        <button className="btn primary" onClick={run} disabled={running}>
          {running ? 'RUNNING…' : 'RUN CHECK'}
        </button>
        {done && (
          <button className="btn" onClick={copy}>
            {copied ? 'COPIED' : 'COPY REPORT'}
          </button>
        )}
        <button className="btn ghost" onClick={onBack}>
          BACK
        </button>
      </div>
      <pre className="report" aria-live="polite">{log || 'Nothing yet. Press RUN CHECK.'}</pre>
    </section>
  );
}

// ---------------------------------------------------------------------- app

export default function App() {
  const saved = useMemo(loadSaved, []);
  const [stage, setStage] = useState('landing');
  const [exp, setExp] = useState(null);
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState('Finding where you are…');
  const [ai, setAi] = useState({ mode: 'unknown', model: null });
  const [ready, setReady] = useState(false);
  const [voice, setVoiceState] = useState(loadVoice);
  const setVoice = (on) => {
    setVoiceState(on);
    saveVoice(on);
    if (!on) stopSpeaking();
  };
  const pending = useRef({ key: null, promise: null });

  const canResume = Boolean(saved?.exp && RESUMABLE.includes(saved.stage));

  useEffect(() => {
    getHealth().then((h) => setAi({ mode: h.ai ? 'ai' : 'template', model: h.models?.[0] || null }));
  }, []);
  useEffect(() => {
    if (exp && RESUMABLE.includes(stage)) persist({ stage, exp });
  }, [stage, exp]);
  useEffect(() => {
    document.getElementById('main')?.focus();
    window.scrollTo(0, 0);
  }, [stage]);

  const noteSource = (r) =>
    setAi((cur) => (r.source === 'ai' ? { mode: 'ai', model: r.model } : { mode: 'template', model: cur.model }));

  function wantMission(place, earlier) {
    const key = `${place.id}:${earlier.length}`;
    if (pending.current.key !== key) {
      pending.current = { key, promise: getMission(place, earlier).then((r) => { noteSource(r); return r; }) };
    }
    return pending.current.promise;
  }

  function resume() {
    setExp(saved.exp);
    setStage(saved.stage);
  }
  function reset() {
    persist(null);
    setExp(null);
    setStage('landing');
  }
  function home() {
    if (stage === 'active') return; // never pull someone out of a walk by accident
    setStage('landing');
  }

  async function begin(input, label, accuracy = null) {
    setNotice('');
    setMessage(label);
    setStage('finding');
    try {
      const data = await getNearby(input);
      if (!data.places.length) {
        setNotice('No historical places or attractions found within 4 km of there. Try a nearby landmark or a bigger area.');
        setStage('landing');
        return;
      }
      setMessage('Writing your first mission…');
      const place = data.places[0];
      const r = await wantMission(place, []);
      setExp({
        center: { ...data.center, accuracy },
        provider: data.provider,
        providerError: data.providerError || '',
        places: data.places,
        cursor: 0,
        current: { place, mission: r.value, source: r.source, model: r.model },
        rounds: [],
        leftAt: null,
        arrival: null,
        startedAt: Date.now(),
        finishedAt: null,
      });
      setStage('story');
    } catch (e) {
      const msg = String(e?.message || e);
      setNotice(
        msg.includes('place_not_found')
          ? 'Could not find that place. Try adding the town, for example “Somwar Peth, Tasgaon”.'
          : `Could not look up places nearby (${msg}). Check the connection and try again.`
      );
      setStage('landing');
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      setNotice('Location is not available in this browser. Type a place instead.');
      return;
    }
    setNotice('');
    setMessage('Asking your device where you are…');
    setStage('finding');
    navigator.geolocation.getCurrentPosition(
      (pos) => begin({ lat: pos.coords.latitude, lon: pos.coords.longitude }, 'Looking for famous places near you…', pos.coords.accuracy),
      () => {
        setNotice('No location permission. That is fine: type a town or neighborhood below.');
        setStage('landing');
      },
      { timeout: 12000, maximumAge: 60000 }
    );
  }

  async function switchTo(index) {
    const place = exp.places[index];
    setStage('drafting');
    const earlier = exp.rounds.map((r) => r.note);
    const r = await wantMission(place, earlier);
    setExp((e) => ({ ...e, cursor: index, leftAt: null, current: { place, mission: r.value, source: r.source, model: r.model } }));
    setStage('story');
  }
  const hasAnother = exp ? exp.cursor + 1 < exp.places.length : false;
  const hasNext = exp ? exp.rounds.length < MAX_STOPS && hasAnother : false;

  function go() {
    setExp({ ...exp, leftAt: Date.now(), arrival: null });
    setStage('active');
  }
  function submit(note) {
    const outsideSeconds = exp.leftAt ? Math.round((Date.now() - exp.leftAt) / 1000) : 0;
    const earlier = exp.rounds.map((r) => r.note);
    const snapshot = exp;
    setReady(false);
    setStage('thinking');
    getReply(snapshot.current.place, note, earlier).then((r) => {
      noteSource(r);
      const round = {
        place: snapshot.current.place,
        mission: snapshot.current.mission,
        note,
        reply: r.value,
        replySource: r.source,
        outsideSeconds,
        verified: Boolean(snapshot.arrival?.verified),
        arrivalDist: snapshot.arrival?.dist ?? null,
      };
      setExp({ ...snapshot, leftAt: null, rounds: [...snapshot.rounds, round] });
      setReady(true);
      // Write the next mission while the walker reads this reply.
      const nextIndex = snapshot.cursor + 1;
      if (snapshot.rounds.length + 1 < MAX_STOPS && nextIndex < snapshot.places.length) {
        wantMission(snapshot.places[nextIndex], [...earlier, note]);
      }
    });
  }

  function finish() {
    setExp((e) => ({ ...e, finishedAt: Date.now() }));
    setStage('done');
  }
  function lookCloser() {
    setStage('observe2');
  }
  function submitSecond(note2) {
    const snapshot = exp;
    const last = snapshot.rounds[snapshot.rounds.length - 1];
    const earlier = snapshot.rounds.map((r) => r.note);
    setReady(false);
    setStage('thinking');
    getReply(last.place, note2, earlier).then((r) => {
      noteSource(r);
      const rounds = snapshot.rounds.map((x, i) =>
        i === snapshot.rounds.length - 1 ? { ...x, second: { question: x.reply.look_closer, note: note2, reply: r.value } } : x
      );
      setExp({ ...snapshot, rounds });
      setReady(true);
    });
  }

  return (
    <div className={`app ${stage === 'active' ? 'is-dark' : ''}`}>
      <Header onHome={home} ai={ai} />
      <main id="main" tabIndex={-1}>
        {stage === 'landing' && (
          <Landing
            onLocate={locate}
            onSearch={(q) => begin({ q }, `Looking for stories near ${q}…`)}
            canResume={canResume}
            onResume={resume}
            onCheck={() => setStage('check')}
            notice={notice}
            voice={voice}
            onVoice={setVoice}
          />
        )}
        {(stage === 'finding' || stage === 'drafting') && (
          <Finding message={stage === 'drafting' ? 'Writing your mission…' : message} />
        )}
        {stage === 'story' && <Story exp={exp} voice={voice} onFixLocation={() => { setNotice('Type your neighborhood or town below. A name gives a better result than a rough location.'); setStage('landing'); }} onGo={go} onAnother={() => switchTo(exp.cursor + 1)} hasAnother={hasAnother} />}
        {stage === 'active' && <Active exp={exp} voice={voice} onFound={(arrival) => { setExp({ ...exp, arrival }); setStage('observe'); }} />}
        {stage === 'observe' && <Observe exp={exp} voice={voice} onSubmit={submit} />}
        {stage === 'observe2' && (
          <Observe exp={exp} voice={voice} question={exp.rounds[exp.rounds.length - 1].reply.look_closer} onSubmit={submitSecond} />
        )}
        {stage === 'thinking' && <Thinking ready={ready} onDone={() => setStage('reply')} />}
        {stage === 'reply' && (
          <Reply exp={exp} voice={voice} hasNext={hasNext} onNext={() => switchTo(exp.cursor + 1)} onFinish={finish} onLookCloser={lookCloser} />
        )}
        {stage === 'done' && <Done exp={exp} onReset={reset} />}
        {stage === 'check' && <AiCheck onBack={() => setStage('landing')} />}
      </main>
    </div>
  );
}
