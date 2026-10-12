# Arabic with Asmae — handoff

Local web app that plays Asmae's "Learn Arabic from scratch" speaking course (11 lessons, in order, no ads) and adds a learning layer on top of her method.

## Run it
Double-click `start.command` (or `python3 serve.py 8765`), then open http://localhost:8765. Nothing is hosted; progress lives in the browser's localStorage under the key `asmae.v1`.

## What is in the folder
- `index.html`, `style.css`, `app.js` — the whole app, no build step, no dependencies.
- `serve.py` — static server with HTTP Range support so local MP4s can seek.
- `data/course.json` — ordered lesson list (lesson 10 is on her channel but missing from her playlist; we include it) plus bonus conversation videos.
- `data/lessonNN.json` — every block she teaches, with the second she says it: `word` / `phrase` / `rule` / `review`, Arabic, transliteration, English, syllables, sentence parts, her note, a keyword mnemonic, and a 3-5 line dialogue made only from taught words. Items with `"uncertain": true` were reconstructed from auto-captions and should be checked against the video.
- `media/lessonNN.mp4` — local copies (360p H.264 is the only format YouTube serves without a PO token). If a file is present the app plays it (guaranteed ad-free, offline); if not, it falls back to a YouTube embed with controls hidden.

## How the learning layer works (and where each idea was taken from)
- **Live block card** synced to the timeline: Arabic, transliteration, meaning, color-coded parts. (Language Reactor / subtitle-learning pattern.)
- **Coach pauses**: when she finishes introducing a block, the video pauses and asks you to say it before she repeats it. (Pimsleur anticipation gap; Michel Thomas build-up.)
- **Loop block**: A-B loop of the current block for shadowing.
- **After each lesson**: recall drill English→Arabic out loud with self-grade (Anki), sentence tiles (Duolingo), listening choice; only material taught so far (no surprise vocabulary).
- **Review**: spaced repetition on a 1/3/7/21-day ladder, SM-2-style ease, a miss resets to day 1 and comes back in 10 minutes. "Hear her say it" seeks the real clip.
- **Talk**: role-play B in the lesson dialogue; reveal line by line; whole-conversation playback via the Mac's Arabic voice.
- **Today**: due count, recall count, lessons done, streak with one forgiven miss, implementation intention (when/where), last-session-vs-today line. No points, badges or hearts (adult app rules).

## Known gaps / next
- Lessons 8-11 were extracted from the Arabic auto-translation track only (English captions were rate-limited); re-check their timestamps against the video.
- Arabic TTS depends on a system voice (Maged/Majed on macOS). The "Hear her" button is the better source.
- Video quality is 360p. If a PO token is set up for yt-dlp, redownload at 720p.
