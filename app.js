/* Arabic with Asmae — ad-free ordered player + on-screen blocks + recall drills + spaced review
   Vanilla JS, no build. Data in data/*.json. Progress in localStorage. */
(() => {
'use strict';

// ---------- tiny DOM helper ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'hidden') { if (v) el.hidden = true; }
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    add(el, k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}
const $ = (s, r = document) => r.querySelector(s);
const add = (el, ...k) => Element.prototype.append.apply(el, k.flat().filter(x => x !== null && x !== undefined && x !== false));
const put = (el, ...k) => el.replaceChildren(...k.flat().filter(x => x !== null && x !== undefined && x !== false));
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._x); t._x = setTimeout(() => t.hidden = true, 2200); }
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- state ----------
const KEY = 'asmae.v1';
const S = Object.assign({
  view: 'lesson', lesson: 1, pos: {}, done: {}, cards: {}, log: [], intention: null,
  settings: { coach: true, tr: true, autonext: true, rate: 1 },
  stats: { days: {} }
}, JSON.parse(localStorage.getItem(KEY) || '{}'));
const save = () => localStorage.setItem(KEY, JSON.stringify(S));

// ---------- data ----------
let COURSE = null; const LESSONS = {}; // n -> lesson data (items)
async function loadData() {
  COURSE = await (await fetch('data/course.json')).json();
  await Promise.all(COURSE.lessons.map(async L => {
    try {
      const r = await fetch(`data/lesson${String(L.n).padStart(2, '0')}.json`);
      if (r.ok) { const d = await r.json(); d.items = (d.items || []).sort((a, b) => a.t - b.t); LESSONS[L.n] = d; }
    } catch (e) { /* no data for this lesson yet */ }
  }));
  // local media check (ad-free, offline)
  await Promise.all([...COURSE.lessons, ...COURSE.bonus].map(async L => {
    try { const r = await fetch(`media/${mediaName(L)}`, { method: 'HEAD' }); L.local = r.ok; } catch (e) { L.local = false; }
  }));
}
const mediaName = L => L.n < 100 ? `lesson${String(L.n).padStart(2, '0')}.mp4` : `${L.id}.mp4`;
const allLessons = () => [...COURSE.lessons, ...COURSE.bonus];
const lessonMeta = n => allLessons().find(L => L.n === n);
const lessonTitle = L => L.n < 100 ? (LESSONS[L.n]?.title ? `${L.n}. ${LESSONS[L.n].title}` : `Lesson ${L.n}`) : L.title;
const cardKey = (n, it) => it.ar; // one card per Arabic block, whichever lesson re-teaches it
const teachable = it => it.kind === 'word' || it.kind === 'phrase';
// words taught up to and including lesson n (for drills: only from taught material)
function taughtUpTo(n) {
  const out = [];
  for (const L of COURSE.lessons) if (L.n <= n && LESSONS[L.n]) for (const it of LESSONS[L.n].items) if (teachable(it)) out.push({ ...it, lesson: L.n });
  return out;
}

// ---------- speech (fallback when her clip is not at hand) ----------
let arVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  arVoice = vs.find(v => /^ar/i.test(v.lang) && /maged|majed|tarik|laila|hoda|zira|naayf/i.test(v.name)) || vs.find(v => /^ar/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(ar, rate = 0.85) {
  if (!('speechSynthesis' in window)) return toast('No speech voice on this browser');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(ar.replace(/[ً-ْ]/g, m => m)); // keep harakat, they help the voice
  u.lang = 'ar-SA'; if (arVoice) u.voice = arVoice; u.rate = rate; speechSynthesis.speak(u);
}

// ---------- SRS (SM-2 shape, 1/3/7/21 ladder, grace on misses) ----------
const LADDER = [1, 3, 7, 21];
function getCard(n, it) {
  const k = cardKey(n, it);
  return S.cards[k] || (S.cards[k] = { k, n, ar: it.ar, tr: it.tr, en: it.en, kind: it.kind, parts: it.parts || null, t: it.t, end: it.end, reps: 0, lapses: 0, ivl: 0, ease: 2.5, due: Date.now(), hist: [] });
}
function grade(card, g) { // 0 again 1 hard 2 good 3 easy
  const now = Date.now();
  if (g === 0) { card.reps = 0; card.lapses++; card.ease = Math.max(1.3, card.ease - 0.2); card.ivl = 0; card.due = now + 10 * 60000; }
  else {
    if (g === 1) { card.ivl = Math.max(1, Math.round(card.ivl * 1.2)) || 1; card.ease = Math.max(1.3, card.ease - 0.15); }
    else if (g === 2) { card.ivl = card.reps < LADDER.length ? LADDER[card.reps] : Math.round(card.ivl * card.ease); }
    else { card.ivl = card.reps + 1 < LADDER.length ? LADDER[card.reps + 1] : Math.round(card.ivl * card.ease * 1.3); card.ease += 0.15; }
    card.reps++; card.due = now + card.ivl * DAY;
  }
  card.hist.push([now, g]); if (card.hist.length > 50) card.hist.shift();
  const d = S.stats.days[today()] || (S.stats.days[today()] = { reviews: 0, ok: 0, lessons: 0 });
  d.reviews++; if (g >= 2) d.ok++;
  save(); updateDue();
}
const dueCards = () => Object.values(S.cards).filter(c => c.due <= Date.now()).sort((a, b) => a.due - b.due);
function updateDue() { const n = dueCards().length; const p = $('#dueCount'); p.textContent = n; p.classList.toggle('zero', n === 0); }

// ---------- player abstraction (local <video> or YouTube iframe) ----------
let P = null; // current player
function destroyPlayer() { if (P) { try { P.destroy(); } catch (e) { } P = null; } }
function makeLocalPlayer(box, L, onTime, onState) {
  const v = h('video', { src: `media/${mediaName(L)}`, playsinline: '', preload: 'metadata' });
  add(box, v);
  v.addEventListener('timeupdate', () => onTime(v.currentTime));
  v.addEventListener('play', () => onState('playing')); v.addEventListener('pause', () => onState('paused')); v.addEventListener('ended', () => onState('ended'));
  v.playbackRate = S.settings.rate; v.volume = S.settings.vol ?? 1;
  return { kind: 'local', play: () => v.play(), pause: () => v.pause(), seek: t => { v.currentTime = t; }, time: () => v.currentTime, dur: () => v.duration || L.duration || 0, rate: r => v.playbackRate = r, vol: x => { v.volume = x; }, playing: () => !v.paused, destroy: () => { v.pause(); v.remove(); } };
}
let ytReady = null;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise(res => {
    if (window.YT && YT.Player) return res();
    window.onYouTubeIframeAPIReady = () => res();
    add(document.head, h('script', { src: 'https://www.youtube.com/iframe_api' }));
  });
  return ytReady;
}
async function makeYTPlayer(box, L, onTime, onState) {
  await loadYT();
  const host = h('div'); add(box, host);
  let timer = null, yt = null, ready = false;
  yt = new YT.Player(host, {
    videoId: L.id, host: 'https://www.youtube-nocookie.com',
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, origin: location.origin },
    events: {
      onReady: () => { ready = true; yt.setPlaybackRate(S.settings.rate); yt.setVolume(Math.round((S.settings.vol ?? 1) * 100)); },
      onStateChange: e => {
        if (e.data === 1) { onState('playing'); clearInterval(timer); timer = setInterval(() => onTime(yt.getCurrentTime()), 250); }
        else if (e.data === 2) { onState('paused'); clearInterval(timer); }
        else if (e.data === 0) { onState('ended'); clearInterval(timer); }
      }
    }
  });
  return { kind: 'yt', play: () => ready && yt.playVideo(), pause: () => ready && yt.pauseVideo(), seek: t => ready && yt.seekTo(t, true), time: () => ready ? yt.getCurrentTime() : 0, dur: () => (ready && yt.getDuration()) || L.duration || 0, rate: r => ready && yt.setPlaybackRate(r), vol: x => ready && yt.setVolume(Math.round(x * 100)), playing: () => ready && yt.getPlayerState() === 1, destroy: () => { clearInterval(timer); try { yt.destroy(); } catch (e) { } } };
}

// ---------- views ----------
const main = $('#main');
function setView(v) { S.view = v; save(); for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.view === v); render(); }
$('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) setView(b.dataset.view); });
function render() {
  destroyPlayer(); speechSynthesis && speechSynthesis.cancel();
  main.replaceChildren();
  updateDue();
  ({ today: viewToday, lesson: viewLesson, review: viewReview, talk: viewTalk })[S.view]();
}

// ===== TODAY =====
function viewToday() {
  const due = dueCards().length, cards = Object.values(S.cards);
  const known = cards.filter(c => c.reps >= 2).length;
  const doneN = Object.keys(S.done).filter(k => +k < 100).length;
  const next = COURSE.lessons.find(L => !S.done[L.n]) || COURSE.lessons[COURSE.lessons.length - 1];
  const days = Object.keys(S.stats.days).sort();
  const streak = computeStreak(days);
  const last = days.filter(d => d !== today()).slice(-1)[0];
  const lastStat = last ? S.stats.days[last] : null;
  const todayStat = S.stats.days[today()] || { reviews: 0, ok: 0, lessons: 0 };
  add(main, 
    h('h1', null, 'Today'),
    h('p', { class: 'muted' }, 'Review first, then one lesson. Say everything out loud.'),
    h('div', { class: 'stat' },
      h('div', { class: 'card' }, h('b', null, due), h('span', null, 'due now')),
      h('div', { class: 'card' }, h('b', null, known), h('span', null, 'words you can recall')),
      h('div', { class: 'card' }, h('b', null, `${doneN} / ${COURSE.lessons.length}`), h('span', null, 'lessons finished')),
      h('div', { class: 'card' }, h('b', null, streak), h('span', null, 'day streak (1 miss forgiven)'))
    ),
    h('h2', null, 'Do now'),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => setView('review'), disabled: due === 0 }, due ? `Review ${due} due` : 'Nothing due'),
      h('button', { class: 'primary', onclick: () => { S.lesson = next.n; save(); setView('lesson'); } }, `${S.done[next.n] ? 'Rewatch' : 'Start'} ${lessonTitle(next)}`)
    ),
    lastStat ? h('p', { class: 'small muted', style: 'margin-top:16px' }, `Last time ${lastStat.reviews ? Math.round(100 * lastStat.ok / lastStat.reviews) : 0}% recalled, today ${todayStat.reviews ? Math.round(100 * todayStat.ok / todayStat.reviews) : 0}%.`) : null,
    h('h2', null, 'When and where'),
    intentionBox()
  );
}
function computeStreak(days) {
  let n = 0, d = new Date(); let misses = 0;
  for (let i = 0; i < 400; i++) {
    const k = d.toISOString().slice(0, 10);
    if (days.includes(k)) n++; else if (i === 0) { /* today not yet */ } else if (misses++ >= 1) break;
    d = new Date(d - DAY);
  }
  return n;
}
function intentionBox() {
  const when = h('input', { placeholder: 'When? e.g. 8:30am with coffee', value: S.intention?.when || '' });
  const where = h('input', { placeholder: 'Where? e.g. kitchen table', value: S.intention?.where || '' });
  const box = h('div', { class: 'card stack' });
  const line = h('p', null);
  const show = () => { line.textContent = S.intention?.when ? `Your plan: ${S.intention.when}, ${S.intention.where}.` : ''; };
  show();
  add(box, h('div', { class: 'ii' }, when, where, h('button', { onclick: () => { S.intention = { when: when.value.trim(), where: where.value.trim() }; save(); show(); toast('Saved'); } }, 'Save')), line);
  return box;
}

// ===== LESSON (list + player + live card + blocks) =====
function viewLesson() {
  const L = lessonMeta(S.lesson) || COURSE.lessons[0];
  const wrap = h('div', { class: 'player-wrap' });
  const left = h('div'), right = h('div', { class: 'stack' });
  add(wrap, left, right);
  add(main, h('h1', null, lessonTitle(L)), wrap);
  buildPlayer(left, L);
  const lc = liveCard(L); lc.hidden = S.settings.captions === false;
  add(right, lc, blocksList(L));
  add(main, h('h2', null, 'Course, in order'), lessonList());
}
function lessonList() {
  const list = h('div', { class: 'lessons' });
  for (const L of allLessons()) {
    if (L.n === 101) add(list, h('h2', null, 'Bonus: conversation practice'));
    const pct = L.duration ? Math.min(100, Math.round(100 * (S.pos[L.n] || 0) / L.duration)) : 0;
    const d = LESSONS[L.n];
    add(list, h('div', { class: `lesson-row${S.done[L.n] ? ' done' : ''}${L.n === S.lesson ? ' current' : ''}`, onclick: () => { S.lesson = L.n; save(); render(); } },
      h('div', { class: 'num' }, L.n < 100 ? L.n : '+'),
      h('div', null, h('div', null, lessonTitle(L)), d ? h('div', { class: 'small muted' }, d.goal) : null, h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` }))),
      h('div', { class: 'small muted' }, L.duration ? fmt(L.duration) : '')
    ));
  }
  return list;
}

let live = { item: null, coachShownFor: null };
function buildPlayer(left, L) {
  const data = LESSONS[L.n]; const items = data ? data.items : [];
  const box = h('div', { class: 'video-box' });
  const poster = h('div', { class: 'poster', style: `background-image:url(https://i.ytimg.com/vi/${L.id}/hqdefault.jpg)` }, );
  const shield = h('div', { class: 'shield', onclick: () => toggle() });
  const coach = h('div', { class: 'coach', hidden: true });
  add(box, poster, shield, coach);
  const fill = h('div', { class: 'fill' }), marks = h('div', { class: 'marks' });
  const track = h('div', { class: 'track' }, fill, marks);
  const scrub = h('div', { class: 'scrub', onclick: e => { const r = track.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * P.dur()); } }, track);
  const time = h('div', { class: 'time' }, '0:00 / ' + fmt(L.duration));
  const playBtn = h('button', { class: 'ctl', onclick: () => toggle() }, 'Play');
  const loopBtn = h('button', { class: 'ctl', onclick: () => toggleLoop() }, 'Loop block');
  const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.settings.vol ?? 1, class: 'vol', title: 'Volume', oninput: e => { S.settings.vol = +e.target.value; save(); P && P.vol(S.settings.vol); } });
  const capBtn = h('button', { class: `ctl${S.settings.captions !== false ? ' on' : ''}`, onclick: () => { S.settings.captions = S.settings.captions === false; save(); capBtn.classList.toggle('on', S.settings.captions); const c = $('#live'); if (c) c.hidden = !S.settings.captions; } }, 'Captions');
  const coachBtn = h('button', { class: `ctl${S.settings.coach ? ' on' : ''}`, onclick: () => { S.settings.coach = !S.settings.coach; save(); coachBtn.classList.toggle('on', S.settings.coach); } }, 'Coach pauses');
  const rateBtn = h('button', { class: 'ctl', onclick: () => { S.settings.rate = S.settings.rate === 1 ? 0.75 : 1; save(); P && P.rate(S.settings.rate); rateBtn.textContent = S.settings.rate + '×'; } }, S.settings.rate + '×');
  const finishBtn = h('button', { class: 'ctl primary', onclick: () => finishLesson(L) }, items.length ? 'Finish, do the drills' : 'Mark finished');
  add(left, box, h('div', { class: 'controls' },
    playBtn, h('button', { class: 'ctl', onclick: () => seek(P.time() - 5) }, '−5 s'), h('button', { class: 'ctl', onclick: () => seek(P.time() + 5) }, '+5 s'),
    scrub, time, vol, capBtn, loopBtn, coachBtn, finishBtn));
  for (const it of items) if (L.duration) add(marks, h('div', { class: `mark ${it.kind}`, style: `left:${100 * it.t / L.duration}%`, title: it.en }));

  let loop = null; // {a,b}
  function toggleLoop() {
    if (loop) { loop = null; loopBtn.classList.remove('on'); return; }
    const it = live.item; if (!it) return toast('No block under the playhead');
    loop = { a: it.t, b: it.end || it.t + 8 }; loopBtn.classList.add('on'); seek(loop.a); P.play();
  }
  function seek(t) { if (!P) return; t = Math.max(0, Math.min(P.dur() || L.duration, t)); P.seek(t); onTime(t); }
  function toggle() { if (!P) return; coach.hidden = true; P.playing() ? P.pause() : P.play(); }
  function onState(s) { box.classList.toggle('playing', s === 'playing'); playBtn.textContent = s === 'playing' ? 'Pause' : 'Play'; if (s === 'ended') { if (items.length) finishLesson(L); else if (S.settings.autonext) nextLesson(L); } }
  function onTime(t) {
    if (!P) return; // a late timeupdate after the player was torn down
    const d = P.dur() || L.duration; fill.style.width = (100 * t / d) + '%'; time.textContent = `${fmt(t)} / ${fmt(d)}`;
    if (Math.floor(t) % 5 === 0) { S.pos[L.n] = Math.max(S.pos[L.n] || 0, t); save(); }
    if (loop && t >= loop.b) P.seek(loop.a);
    // current block = last item started
    let cur = null; for (const it of items) { if (it.t <= t) cur = it; else break; }
    if (cur !== live.item) { live.item = cur; renderLive(cur); highlightBlock(cur); }
    // coach: when a teachable block ends, pause and ask him to produce it before moving on
    if (S.settings.coach && P.playing() && cur && teachable(cur) && cur.end && t >= cur.end - 0.3 && live.coachShownFor !== cur && !loop) {
      live.coachShownFor = cur; P.pause(); showCoach(cur);
    }
  }
  function showCoach(it) {
    put(coach, 
      h('div', { class: 'ask' }, 'Say it out loud, then check'),
      h('div', { class: 'en' }, it.en),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'primary', onclick: () => { put(coach, h('div', { class: 'ask' }, 'Her words'), h('div', { class: 'big ar' }, it.ar), S.settings.tr ? h('div', { class: 'en' }, it.tr) : null, h('div', { class: 'row', style: 'justify-content:center' }, h('button', { onclick: () => { seek(it.t); coach.hidden = true; P.play(); } }, 'Hear her again'), h('button', { class: 'primary', onclick: () => { coach.hidden = true; P.play(); } }, 'Got it, continue'))); } }, 'Reveal'),
        h('button', { onclick: () => { seek(it.t); coach.hidden = true; P.play(); } }, 'Hear her again'),
        h('button', { class: 'ghost', onclick: () => { coach.hidden = true; P.play(); } }, 'Skip')
      ));
    coach.hidden = false;
  }
  function highlightBlock(it) { for (const b of document.querySelectorAll('.blk')) b.classList.toggle('now', it && b._item === it); }
  // keyboard
  document.onkeydown = e => {
    if (S.view !== 'lesson' || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft') seek(P.time() - 5); else if (e.key === 'ArrowRight') seek(P.time() + 5);
    else if (e.key.toLowerCase() === 'l') toggleLoop(); else if (e.key.toLowerCase() === 'r' && live.item) { seek(live.item.t); P.play(); }
  };
  live = { item: null, coachShownFor: null };
  (L.local ? Promise.resolve(makeLocalPlayer(box, L, onTime, onState)) : makeYTPlayer(box, L, onTime, onState)).then(p => {
    P = p; left._seek = seek;
    const resume = S.pos[L.n]; if (resume && resume > 10 && resume < (L.duration - 15)) { seek(resume); toast(`Resumed at ${fmt(resume)}`); }
  });
}
function liveCard(L) {
  const c = h('div', { class: 'card live', id: 'live' });
  renderLive(null, c, L); return c;
}
function renderLive(it, c = $('#live'), L = lessonMeta(S.lesson)) {
  if (!c) return;
  const data = LESSONS[L.n];
  if (!it) { put(c, h('div', { class: 'kind' }, data ? 'Lesson goal' : 'Bonus video'), h('div', { class: 'en' }, data ? data.goal : 'No block data for this one. Watch, repeat after her, use Loop on anything you want to shadow.')); return; }
  const partsRow = it.parts ? h('div', { class: 'chips rtl' }, it.parts.map((p, i) => h('span', { class: `chip ar c${i % 8}` }, p))) : null;
  const syll = it.syll ? h('div', { class: 'chips' }, it.syll.map((s, i) => h('span', { class: `chip c${i % 8}` }, s))) : null;
  put(c, 
    h('div', { class: 'kind' }, { word: 'New word', phrase: 'Build the sentence', rule: 'Rule', review: 'She asks you: say it' }[it.kind] || it.kind),
    h('div', { class: 'big ar' }, it.ar),
    S.settings.tr ? h('div', { class: 'tr' }, it.tr) : null,
    h('div', { class: 'en' }, it.en),
    partsRow, syll,
    it.note ? h('div', { class: 'note' }, it.note) : null,
    it.mnemonic ? h('div', { class: 'mn' }, 'Hook: ' + it.mnemonic) : null,
    h('div', { class: 'row' }, h('button', { class: 'ctl', onclick: () => { P && (P.seek(it.t), P.play()); } }, 'Hear her'), h('button', { class: 'ctl', onclick: () => say(it.ar) }, 'Robot voice'), h('button', { class: `ctl${S.settings.tr ? ' on' : ''}`, onclick: () => { S.settings.tr = !S.settings.tr; save(); renderLive(it); } }, 'Transliteration'))
  );
}
function blocksList(L) {
  const data = LESSONS[L.n]; if (!data) return h('div');
  const list = h('div', { class: 'blocks' });
  for (const it of data.items) {
    const b = h('div', { class: `blk ${it.kind}`, onclick: () => { P && (P.seek(it.t), P.play()); } }, h('div', { class: 't' }, fmt(it.t)), h('div', null, h('div', { class: 'a ar' }, it.ar), h('div', { class: 'e' }, it.en)));
    b._item = it; add(list, b);
  }
  return h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, `${data.items.filter(i => i.kind === 'word').length} new words, ${data.items.filter(i => i.kind === 'phrase').length} sentences`), list);
}
function nextLesson(L) {
  const all = allLessons(); const i = all.findIndex(x => x.n === L.n);
  if (i >= 0 && i < all.length - 1) { S.lesson = all[i + 1].n; save(); render(); toast('Next: ' + lessonTitle(all[i + 1])); }
}

// ===== DRILLS after a lesson (only taught material) =====
function finishLesson(L) {
  destroyPlayer();
  const data = LESSONS[L.n];
  if (!data) { S.done[L.n] = today(); save(); toast('Finished'); return S.settings.autonext ? nextLesson(L) : render(); }
  const mine = data.items.filter(teachable);
  // dedupe by ar, prefer first
  const seen = new Set(); const targets = mine.filter(it => !seen.has(it.ar) && seen.add(it.ar));
  for (const it of targets) getCard(L.n, it);
  const pool = taughtUpTo(L.n);
  const steps = [];
  for (const it of shuffle(targets)) steps.push({ type: 'recall', it });
  for (const it of shuffle(targets.filter(it => it.parts && it.parts.length >= 3)).slice(0, 5)) steps.push({ type: 'build', it });
  for (const it of shuffle(targets).slice(0, 5)) steps.push({ type: 'listen', it });
  runDrills(L, steps, pool, () => {
    S.done[L.n] = today(); const d = S.stats.days[today()] || (S.stats.days[today()] = { reviews: 0, ok: 0, lessons: 0 }); d.lessons++; save();
    put(main, h('div', { class: 'drill card stack' },
      h('div', { class: 'prompt' }, 'Lesson finished'),
      h('div', { class: 'q' }, `${targets.length} blocks from this lesson are now in your review deck.`),
      h('p', { class: 'muted' }, 'They come back tomorrow, then in 3, 7 and 21 days.'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => nextLesson(L) }, 'Next lesson'), h('button', { onclick: () => setView('talk') }, 'Practice the conversation'), h('button', { onclick: () => render() }, 'Back'))
    ));
  });
}
function runDrills(L, steps, pool, onDone) {
  let i = 0; const total = steps.length; let okCount = 0;
  const box = h('div', { class: 'drill' }); put(main, box);
  function next() {
    if (i >= total) return onDone(okCount, total);
    const st = steps[i]; box.replaceChildren();
    add(box, h('div', { class: 'progress-line' }, `${i + 1} / ${total}`));
    ({ recall: drillRecall, build: drillBuild, listen: drillListen })[st.type](box, L, st.it, pool, ok => { if (ok) okCount++; i++; next(); });
  }
  next();
}
function clipPlayer(L, it) { // hidden mini player to hear her say this exact block
  const box = h('div', { class: 'video-box', style: 'width:220px;aspect-ratio:16/9;margin-top:8px' });
  let p = null;
  const btn = h('button', { onclick: async () => {
    if (!p) { box.hidden = false; p = await (L.local ? makeLocalPlayer(box, L, t => { if (t >= (it.end || it.t + 6)) p.pause(); }, () => { }) : makeYTPlayer(box, L, t => { if (t >= (it.end || it.t + 6)) p.pause(); }, () => { })); setTimeout(() => { p.seek(it.t); p.play(); }, L.local ? 50 : 1200); }
    else { p.seek(it.t); p.play(); }
  } }, 'Hear her say it');
  box.hidden = true;
  return { btn, box, stop: () => p && p.destroy() };
}
function drillRecall(box, L, it, pool, done) {
  const cp = clipPlayer(lessonMeta(it.lesson || L.n), it);
  const ans = h('div', { class: 'answer', hidden: true },
    h('div', { class: 'big ar' }, it.ar), h('div', { class: 'tr' }, it.tr),
    it.parts ? h('div', { class: 'chips rtl', style: 'margin-top:8px' }, it.parts.map((p, k) => h('span', { class: `chip ar c${k % 8}` }, p))) : null,
    h('div', { class: 'row', style: 'margin-top:8px' }, cp.btn, h('button', { onclick: () => say(it.ar) }, 'Robot voice')), cp.box,
    h('div', { class: 'grade' },
      h('button', { class: 'again', onclick: () => g(0) }, 'Again', h('small', null, 'blank')),
      h('button', { class: 'hard', onclick: () => g(1) }, 'Hard', h('small', null, 'got there slowly')),
      h('button', { class: 'good', onclick: () => g(2) }, 'Good', h('small', null, 'said it')),
      h('button', { class: 'easy', onclick: () => g(3) }, 'Easy', h('small', null, 'instant'))));
  const reveal = h('button', { class: 'primary', onclick: () => { reveal.hidden = true; ans.hidden = false; } }, 'Reveal');
  add(box, h('div', { class: 'prompt' }, it.kind === 'word' ? 'Say the word in Arabic' : 'Say it in Arabic, out loud'), h('div', { class: 'q' }, it.en), reveal, ans);
  function g(v) { if (!it._practice) grade(getCard(it.lesson || L.n, it), v); cp.stop(); done(v >= 2); }
}
function drillBuild(box, L, it, pool, done) {
  const target = it.parts.slice(); const placed = [];
  const answer = h('div', { class: 'tiles' }); const bank = h('div', { class: 'tiles', style: 'border-style:solid' });
  const check = h('button', { class: 'primary', disabled: true }, 'Check');
  const after = h('div', { hidden: true });
  function renderTiles() {
    put(answer, ...placed.map((w, k) => h('span', { class: 'tile', onclick: () => { placed.splice(k, 1); renderTiles(); } }, w)));
    const left = target.slice(); for (const w of placed) { const k = left.indexOf(w); if (k >= 0) left.splice(k, 1); }
    put(bank, ...shuffleStable(left).map(w => h('span', { class: 'tile', onclick: () => { placed.push(w); renderTiles(); } }, w)));
    check.disabled = placed.length !== target.length;
  }
  let order = null; function shuffleStable(a) { if (!order) order = shuffle(target); return order.filter(w => { const k = a.indexOf(w); if (k >= 0) { a.splice(k, 1); return true; } return false; }); }
  check.onclick = () => {
    const ok = placed.join(' ') === target.join(' ');
    for (const [k, t] of [...answer.children].entries()) t.classList.add(placed[k] === target[k] ? 'ok' : 'bad');
    after.hidden = false; put(after, h('div', { class: 'answer', style: 'margin-top:12px' }, h('div', { class: 'big ar' }, it.ar), h('div', { class: 'tr' }, it.tr), h('p', { class: 'muted small' }, ok ? 'Correct order.' : 'Wrong order. Say the correct sentence out loud twice, then continue.'), h('button', { class: 'primary', onclick: () => done(ok) }, 'Continue')));
    check.disabled = true;
  };
  renderTiles();
  add(box, h('div', { class: 'prompt' }, 'Build the sentence (tap the blocks in order)'), h('div', { class: 'q' }, it.en), answer, bank, h('div', { class: 'row', style: 'margin-top:8px' }, check, h('button', { onclick: () => say(it.ar) }, 'Hear it')), after);
}
function drillListen(box, L, it, pool, done) {
  const distractors = shuffle(pool.filter(p => p.ar !== it.ar && p.kind === it.kind)).slice(0, 3);
  const opts = shuffle([it, ...distractors]);
  const cp = clipPlayer(lessonMeta(it.lesson || L.n), it);
  const grid = h('div', { class: 'opts' });
  for (const o of opts) {
    const b = h('button', { onclick: e => {
      const ok = o.ar === it.ar; e.currentTarget.classList.add(ok ? 'ok' : 'bad');
      for (const x of grid.children) { x.disabled = true; if (x._o.ar === it.ar) x.classList.add('ok'); }
      add(box, h('div', { class: 'answer', style: 'margin-top:12px' }, h('div', { class: 'big ar' }, it.ar), h('div', { class: 'tr' }, it.tr), h('button', { class: 'primary', onclick: () => { cp.stop(); done(ok); } }, 'Continue')));
    } }, o.en);
    b._o = o; add(grid, b);
  }
  add(box, h('div', { class: 'prompt' }, 'Listen, then pick the meaning'), h('div', { class: 'row' }, cp.btn, h('button', { onclick: () => say(it.ar) }, 'Robot voice')), cp.box, h('div', { style: 'height:12px' }), grid);
  setTimeout(() => say(it.ar), 300);
}

// ===== REVIEW (spaced) =====
function viewReview() {
  const due = dueCards();
  if (!due.length) {
    const all = Object.values(S.cards); const nextDue = all.length ? Math.min(...all.map(c => c.due)) : null;
    return add(main, h('h1', null, 'Review'), h('p', { class: 'muted' }, all.length ? `Nothing due. Next card comes back ${new Date(nextDue).toLocaleString()}.` : 'Finish a lesson and its blocks land here.'),
      all.length ? h('button', { onclick: () => startReview(shuffle(all).slice(0, 15), true) }, 'Extra practice (15 random, does not change the schedule)') : null);
  }
  add(main, h('h1', null, `Review, ${due.length} due`), h('p', { class: 'muted' }, 'Say the Arabic out loud, then reveal and grade.'),
    h('button', { class: 'primary', onclick: () => startReview(due, false) }, 'Start'));
}
function startReview(cards, practice) {
  const pool = taughtUpTo(99);
  const steps = cards.map(c => ({ type: 'recall', it: { ...c, lesson: c.n } }));
  const before = cards.filter(c => c.reps >= 2).length;
  runDrills(lessonMeta(cards[0].n), steps.map(s => { if (practice) s.it = { ...s.it, _practice: true }; return s; }), pool, (ok, total) => {
    const after = cards.filter(c => c.reps >= 2).length;
    put(main, h('div', { class: 'drill card stack' }, h('div', { class: 'prompt' }, 'Session done'), h('div', { class: 'q' }, `${ok} of ${total} recalled.`), h('p', { class: 'muted' }, `Blocks you can recall from memory: ${after} (was ${before} before this session). The misses come back in 10 minutes; the rest moved up the ladder.`), h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => setView('today') }, 'Today'), h('button', { onclick: () => setView('lesson') }, 'Lesson'))));
  });
}

// ===== TALK (dialogues from taught material) =====
function viewTalk() {
  const done = COURSE.lessons.filter(L => S.done[L.n] && LESSONS[L.n]?.dialogue);
  const list = done.length ? done : COURSE.lessons.filter(L => LESSONS[L.n]?.dialogue).slice(0, 1);
  add(main, h('h1', null, 'Talk'), h('p', { class: 'muted' }, 'You are B. Answer out loud, then tap to reveal.'));
  if (!done.length) add(main, null);
  for (const L of list) {
    const d = LESSONS[L.n];
    const lines = h('div', { class: 'lines' });
    d.dialogue.forEach((ln, k) => {
      const me = ln.who === 'B';
      const arEl = h('div', { class: `ar${me ? ' hid' : ''}`, onclick: e => e.currentTarget.classList.remove('hid') }, ln.ar);
      add(lines, h('div', { class: `line${me ? ' me' : ''}` }, h('div', { class: 'who' }, ln.who), h('div', null, arEl, h('div', { class: 'en' }, (me ? 'You say: ' : '') + ln.en + (S.settings.tr ? `  ·  ${ln.tr}` : '')), h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'ctl', onclick: () => say(ln.ar) }, 'Hear'), me ? h('button', { class: 'ctl', onclick: () => arEl.classList.remove('hid') }, 'Reveal') : null))));
    });
    add(main, h('div', { class: 'card', style: 'margin-bottom:16px' }, h('h2', { style: 'margin-top:0' }, lessonTitle(L)), lines,
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { onclick: () => playDialogue(d.dialogue) }, 'Play whole conversation'), h('button', { onclick: () => { for (const e of lines.querySelectorAll('.hid')) e.classList.remove('hid'); } }, 'Reveal all'))));
  }
}
function playDialogue(lines) {
  speechSynthesis.cancel(); let k = 0;
  const step = () => { if (k >= lines.length) return; const u = new SpeechSynthesisUtterance(lines[k].ar); u.lang = 'ar-SA'; if (arVoice) u.voice = arVoice; u.rate = 0.85; u.onend = () => { k++; setTimeout(step, 700); }; speechSynthesis.speak(u); };
  step();
}

// ---------- boot ----------
loadData().then(() => { setView(S.view || 'lesson'); }).catch(e => { add(main, h('p', null, 'Could not load data/course.json. Open this app through the local server (double-click start.command).')); console.error(e); });
})();
