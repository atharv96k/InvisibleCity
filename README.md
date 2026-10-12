# Invisible City

Tap once. The app finds a real place with a story near where you stand. You walk there with your phone away, then tell the AI what you saw.

- **Open AI:** an open-weight model (default `openai/gpt-oss-120b`) hosted on Groq writes each mission and reads each field note. Every answer is checked against the Wikipedia summary and your note (no invented numbers, no unsafe wording). If the AI is unavailable, built-in wording is used and the screen says so.
- **Places without a Maps key:** set `GEMINI_API_KEY` (free from aistudio.google.com/apikey). Gemini suggests historical places and attractions within 4 km of the area you type or your location. Each suggestion is checked against OpenStreetMap, which supplies the real coordinates. Anything that cannot be confirmed is kept only as a last resort and is labelled approximate. Provider order: Google Maps (if keyed), then Gemini plus OpenStreetMap, then Wikipedia.
- **Places (Google Maps):** Google Maps Places API (New) finds historical places and attractions within 4 km of your location or of the area you type (for example "Somwar Peth, Tasgaon"). Directions open the exact place in Google Maps, never the town. Wikipedia adds a short story where it has a matching page, and is the backup if no Google key is set. The map is OpenStreetMap.
- **Open data (old note):** Wikipedia's location search Places are ranked by how well known they are (Wikipedia page views) and how near they are, so a famous landmark a few km away beats an obscure village next door. Searches reach at most 10 km, which is Wikipedia's limit.
- **Voice-guided walk:** with Voice mode on, the phone can stay in your pocket. It speaks the distance and direction as you walk ("Warmer. 220 m to go, to the north-east") and confirms when you arrive within 60 m. Position tracking stays on the device.
- **Look closer:** after your note, the AI asks one question you can only answer by looking at the place again.
- **Outside share:** a measured number: time on the walking screen divided by the whole session.
- **Voice mode:** missions and replies can be read aloud; field notes can be spoken (browser speech service).
- **Privacy:** your coordinates go to this app's server once to ask Wikipedia what is nearby; they are not stored or logged. The AI only sees a place name, its Wikipedia summary and your notes.

## Run it

```
npm install
copy .env.example .env      (then put GROQ_API_KEY and GOOGLE_MAPS_API_KEY in .env)
npm run build
npm start                   (http://localhost:8787)
```

For development run `npm start` in one terminal and `npm run dev` in another (http://localhost:5173).

`npm test` runs the unit tests. The "AI check" link on the home page tests the server, key, Wikipedia and one real mission.

## Deploy (Render)

Build command `npm install && npm run build`, start command `npm start`, environment variable `GROQ_API_KEY`. Health check path: `/api/health`.

Location needs HTTPS on a phone, which Render provides.
