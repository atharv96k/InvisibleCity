// Voice mode, built on the browser's own speech features.
// Reading aloud (speechSynthesis) normally runs on the device. Listening
// (SpeechRecognition) is done by the browser's speech service: in Chrome the audio is
// sent to Google. The app says so next to the microphone button.

const w = () => (typeof window === 'undefined' ? {} : window);

export const canSpeak = () => 'speechSynthesis' in w() && typeof w().SpeechSynthesisUtterance !== 'undefined';
export const canListen = () => Boolean(w().SpeechRecognition || w().webkitSpeechRecognition);

export function speak(text) {
  if (!canSpeak() || !text) return;
  const synth = w().speechSynthesis;
  synth.cancel();
  const u = new (w().SpeechSynthesisUtterance)(text);
  u.lang = navigator.language || 'en-US';
  u.rate = 0.95;
  synth.speak(u);
}

export function stopSpeaking() {
  if (canSpeak()) w().speechSynthesis.cancel();
}

const ERRORS = {
  'not-allowed': 'The microphone is blocked. Allow it in the browser, or type your note.',
  'service-not-allowed': 'The microphone is blocked. Allow it in the browser, or type your note.',
  'no-speech': 'I did not hear anything. Try again, or type your note.',
  'audio-capture': 'No microphone was found. Type your note instead.',
  network: 'The browser’s speech service could not be reached. Type your note instead.',
};
export const describeSpeechError = (code) => ERRORS[code] || `Voice input stopped (${code}). Type your note instead.`;

// Returns a stop() function. onText(text, isFinal) gets the transcript so far.
export function listen({ onText, onEnd, onError }) {
  const R = w().SpeechRecognition || w().webkitSpeechRecognition;
  if (!R) {
    onError?.('unsupported');
    return () => {};
  }
  const rec = new R();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    const text = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
    onText?.(text, e.results[e.results.length - 1].isFinal);
  };
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = () => onEnd?.();
  try {
    rec.start();
  } catch (e) {
    onError?.(String(e?.message || e));
  }
  return () => {
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  };
}
