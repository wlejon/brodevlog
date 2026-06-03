// Devlog studio: drive the Galton board through four acts — one, many, stacks,
// curve — each a real engine capability, with a plain informative voiceover (no
// selling), word-synced captions, a continuous TTS + music bed (zero silence),
// captured via addViewportFrame and muxed to a vertical WebM.
//
// Unlike the maze (deterministic reveal), this is a LIVE rigid-body sim: every
// frame we step the physics, release marbles on schedule, and resync one
// instanced mesh from the body transforms. The pile that forms is genuinely
// emergent — the bell curve is not drawn, it is stacked by the marbles.

(() => {

const W = 1080, H = 1920, FPS = 30, SR = 24000;
const board = buildBoard();
const { scene, step, sync, releaseBall, binCounts, ballPos, pollPegHits,
        NB, NBINS, binCenter, topY, lastY, binTopY, floorY, halfW } = board;
const cap = document.getElementById('cap');

// deterministic RNG for the per-click pitch / timing variation
let aseed = 0x9e3779b9;
const arnd = () => { aseed = (Math.imul(aseed, 1664525) + 1013904223) >>> 0; return aseed / 4294967296; };

// ---- math helpers ----------------------------------------------------------
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---- camera ----------------------------------------------------------------
function setCam(c) {
  scene.setCamera({ fov: c.fov, aspect: W / H, near: 0.3, far: 240,
    position: c.pos, target: c.tgt, up: [0, 1, 0] });
}
function lerpCam(a, b, u, t) {
  const L = (p, q) => p + (q - p) * u;
  const pos = [L(a.pos[0], b.pos[0]), L(a.pos[1], b.pos[1]), L(a.pos[2], b.pos[2])];
  const tgt = [L(a.tgt[0], b.tgt[0]), L(a.tgt[1], b.tgt[1]), L(a.tgt[2], b.tgt[2])];
  pos[0] += Math.sin(t * 0.45) * 0.18;          // faint handheld drift
  pos[1] += Math.cos(t * 0.6) * 0.13;
  return { pos, tgt, fov: L(a.fov, b.fov) };
}

const binsMidY = (binTopY + floorY) * 0.5;
const ACTS = {
  many: {  // full board, slow pull-back as it fills
    from: { pos: [0, -1.5, 39], tgt: [0, -2.5, 0], fov: 42 },
    to:   { pos: [0, -3.0, 43], tgt: [0, -4.0, 0], fov: 43 } },
  stacks: {  // tilt down into the bins, cropping the upper lattice
    from: { pos: [0, -4.0, 42], tgt: [0, -5.5, 0], fov: 42 },
    to:   { pos: [0, -11.5, 37], tgt: [0, -14.8, 0], fov: 40 } },
  curve: {  // hold on the bell, slow outward glide
    from: { pos: [0, -11.5, 37], tgt: [0, -15.0, 0], fov: 40 },
    to:   { pos: [0, -11.0, 40], tgt: [0, -15.5, 0], fov: 41 } },
};

// ---- narration: each line names exactly what's on screen at that beat -------
const beats = [
  { act: 'one',    text: 'Watch one marble fall.' },
  { act: 'one',    text: 'At every peg, it bounces — left, or right.' },
  { act: 'one',    text: 'Real rigid-body physics decides each one.' },
  { act: 'many',   text: 'Now drop two hundred.' },
  { act: 'many',   text: 'Every contact solved by the physics engine.' },
  { act: 'many',   text: 'Each finds its own path of lefts and rights.' },
  { act: 'stacks', text: 'At the bottom, they stack where they land.' },
  { act: 'stacks', text: 'Not one of them was aimed.' },
  { act: 'curve',  text: 'But look what they build together.' },
  { act: 'curve',  text: 'A bell curve. The normal distribution.' },
  { act: 'curve',  text: 'Order, from nothing but left and right.' },
];

// ---- TTS -------------------------------------------------------------------
bro.tts.setAssetRoot('../brosoundml');
const kokoro = bro.tts.loadKokoro('../brosoundml/weights/kokoro');
const voice = kokoro.loadVoice('../brosoundml/weights/kokoro/voices/af_heart.bin');
const SPACE = 16;

function synthBeat(text) {
  const ids = bro.tts.phonemize(text);
  const out = kokoro.synthesize(ids, voice, { speed: 1.0 });
  const durSum = out.durations.reduce((a, b) => a + b, 0);
  const spf = out.samples.length / durSum;
  const startFrame = []; let frame = out.durations[0];
  for (let i = 0; i < ids.length; i++) { startFrame.push(frame); frame += out.durations[i + 1] || 0; }
  const groupFrames = []; let expect = true;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === SPACE) { expect = true; continue; }
    if (expect) { groupFrames.push(startFrame[i]); expect = false; }
  }
  const words = text.split(/\s+/).filter(Boolean);
  let wordTimes = words.map((w, i) =>
    (groupFrames[i] != null ? groupFrames[i] : (i / words.length) * durSum) * spf / SR);
  const thr = 0.012, padF = 360, padB = 700;
  let s0 = 0, s1 = out.samples.length;
  while (s0 < s1 && Math.abs(out.samples[s0]) < thr) s0++;
  while (s1 > s0 && Math.abs(out.samples[s1 - 1]) < thr) s1--;
  s0 = Math.max(0, s0 - padF); s1 = Math.min(out.samples.length, s1 + padB);
  const trimmed = out.samples.subarray(s0, s1);
  const shift = s0 / SR;
  wordTimes = wordTimes.map((t) => Math.max(0, t - shift));
  return { samples: trimmed, seconds: trimmed.length / SR, words, wordTimes };
}

beats.forEach((b) => Object.assign(b, synthBeat(b.text)));

// ---- timeline: place beats back-to-back ------------------------------------
const GAP = 0.10, LEAD = 0.25, TAIL = 1.1;
const placed = []; let cursor = LEAD;
for (const b of beats) { placed.push({ b, start: cursor }); cursor += b.seconds + GAP; }
const totalSec = cursor + TAIL;
const N = Math.ceil(totalSec * SR);

const actSpan = {};
for (const p of placed) {
  const k = p.b.act, s = actSpan[k] || (actSpan[k] = { t0: Infinity, t1: -Infinity });
  s.t0 = Math.min(s.t0, p.start);
  s.t1 = Math.max(s.t1, p.start + p.b.seconds + GAP);
}

// ---- audio (VO + soft major-key bed, never silent) -------------------------
const voBuf = new Float32Array(N);
for (const p of placed) {
  const off = Math.floor(p.start * SR), s = p.b.samples;
  for (let i = 0; i < s.length && off + i < N; i++) voBuf[off + i] += s[i];
}
// a warm, bright bed (major) — a soft pluck arpeggio over a pad, to contrast
// the maze devlog's dark minor.  C  G/B  Am  F
const chords = [[261.63, 329.63, 392.00], [246.94, 293.66, 392.00],
                [220.00, 329.63, 440.00], [174.61, 261.63, 349.23]];
const bar = 4.0, mixBuf = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const tt = i / SR;
  const ch = chords[Math.floor(tt / bar) % chords.length];
  let pad = 0; for (const f of ch) pad += Math.sin(2 * Math.PI * f * tt);
  pad /= ch.length;
  // a gentle plucked arpeggio: one note per half-beat, short decay
  const beatT = 0.5, idx = Math.floor(tt / beatT);
  const note = ch[idx % ch.length] * 2;                     // up an octave
  const ph = (tt - idx * beatT) / beatT;                    // 0..1 within pluck
  const pluck = Math.sin(2 * Math.PI * note * tt) * Math.exp(-ph * 4.5) * 0.5;
  const bass = Math.sin(2 * Math.PI * (ch[0] / 2) * tt) * 0.5;
  let bed = (pad * 0.42 + bass * 0.8 + pluck) * 0.085;
  bed *= clamp01(tt / 0.8) * clamp01((totalSec - tt) / 1.0);
  let v = voBuf[i] * 0.95 + bed;
  mixBuf[i] = v > 1 ? 1 : v < -1 ? -1 : v;
}

// ---- captions --------------------------------------------------------------
function renderCaption(b, tIn) {
  let html = '';
  for (let i = 0; i < b.words.length; i++) {
    const ws = b.wordTimes[i];
    const we = b.wordTimes[i + 1] != null ? b.wordTimes[i + 1] : b.seconds + 0.4;
    let cls = 'w';
    if (tIn >= ws) cls = (tIn < we) ? 'w on hot' : 'w on';
    html += `<span class="${cls}">${b.words[i]}</span> `;
  }
  cap.innerHTML = html;
}

// ---- overlay: live histogram (the code card was removed — it buried the action)
const viz = document.getElementById('viz');
const vizLabel = document.getElementById('vizlabel');
const FADE = 0.4;
// which acts show the live histogram (the code card is gone — it buried the
// cascade; the histogram is the one overlay that earns its place).
const VIZ_ACTS = { one: false, many: true, stacks: true, curve: true };

// ---- live histogram (Canvas 2D) — fills with the pile, fits a Gaussian -----
const hist = document.getElementById('hist');
function drawHist(counts, gaussianMix) {
  const ctx = hist.getContext('2d');
  const ww = 292, hh = 210, pad = 8;
  ctx.clearRect(0, 0, ww, hh);
  ctx.fillStyle = '#0c0710'; ctx.fillRect(0, 0, ww, hh);
  let peak = 1, total = 0, mean = 0;
  for (let k = 0; k < NBINS; k++) { peak = Math.max(peak, counts[k]); total += counts[k]; mean += k * counts[k]; }
  const bw = (ww - pad * 2) / NBINS;
  const top = pad, bot = hh - pad - 14;
  // bars
  for (let k = 0; k < NBINS; k++) {
    const h = (counts[k] / peak) * (bot - top);
    const x = pad + k * bw, y = bot - h;
    const t = NBINS > 1 ? k / (NBINS - 1) : 0.5;
    const r = 255, g = (130 + 90 * (1 - Math.abs(t - 0.5) * 2)) | 0, b = (70 + 60 * (1 - t)) | 0;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x + 1.5, y, bw - 3, h);
  }
  ctx.fillStyle = '#3a2c38'; ctx.fillRect(pad, bot, ww - pad * 2, 1.5);
  // fitted Gaussian overlay
  if (gaussianMix > 0 && total > 4) {
    mean /= total;
    let varr = 0; for (let k = 0; k < NBINS; k++) varr += counts[k] * (k - mean) * (k - mean);
    varr = Math.max(0.4, varr / total);
    ctx.globalAlpha = clamp01(gaussianMix);
    ctx.strokeStyle = '#ffe2a6'; ctx.lineWidth = 3; ctx.beginPath();
    for (let px = 0; px <= ww - pad * 2; px += 3) {
      const k = (px / bw) - 0.5 + 0;
      const kk = px / (ww - pad * 2) * (NBINS - 1);
      const g = Math.exp(-(kk - mean) * (kk - mean) / (2 * varr));
      const x = pad + px, y = bot - g * (peak / peak) * (bot - top);
      if (px === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

let vizAct = null;
function updateViz(act, t, sp, counts, gaussianMix) {
  const show = VIZ_ACTS[act];
  if (act !== vizAct) {
    viz.style.display = show ? 'block' : 'none';
    if (show) vizLabel.textContent = act === 'curve' ? 'fit: μ, σ²' : 'count[bin]';
    vizAct = act;
  }
  if (!show) { viz.style.opacity = '0'; return; }
  const dur = sp.t1 - sp.t0, tin = t - sp.t0;
  const op = clamp01(Math.min(tin / FADE, (dur - tin) / FADE));
  viz.style.opacity = op.toFixed(3);
  drawHist(counts, gaussianMix);
}

// ---- single-ball follow camera (act 'one') ---------------------------------
// Track the lone marble down the board, tight at first so it reads as ONE
// marble, widening toward the full-board framing so the cut into 'many' is
// seamless.
function oneCam(u) {
  const p = ballPos(0);                       // the single marble
  const k = smooth(clamp01((u - 0.55) / 0.45)); // hold tight, widen only late
  const fy = clamp(p.y, binsMidY + 2, topY + 1.5);
  const ty = lerp(fy, -3.0, k);               // ease target toward board centre
  const tx = lerp(p.x * 0.6, 0, k);
  const dist = lerp(15, 40, k);               // pull back near the end of the act
  const fov = lerp(30, 42, k);
  return { pos: [tx * 0.5, ty + 0.6, dist], tgt: [tx, ty, 0], fov };
}

// ---- sim speed + release schedule ------------------------------------------
// The lattice only drains ~10 marbles / sim-second, so 200 marbles need ~20
// sim-seconds to pour + settle — more than the pour's screen time. We run the
// physics FASTER than real time during the pour (an energetic cascade), feed at
// the drain-safe rate, then ease into slow-motion for the bell-curve payoff.
const POUR_RATE = 10;                          // marbles / sim-second
const pourEnd = actSpan.stacks.t1 - 0.5;       // finish pouring before 'curve'
let released1 = false, relAccum = 0;

function simSpeed(act, u) {
  if (act === 'one') return 1.0;               // real time — follow one marble
  // many + stacks: a fast cascade so all 200 are out by the end of 'stacks';
  // curve: stay brisk enough that the stragglers settle into a clean bell
  // before easing toward slow-mo for the final hold.
  if (act === 'curve') return lerp(1.6, 0.7, smooth(clamp01((u - 0.45) / 0.55)));
  return 2.6;
}

// ---- render loop -----------------------------------------------------------
const enc = new VideoEncoder({
  path: 'galton.webm', width: W, height: H, fps: FPS,
  quality: 'good', threads: 8, bitrateKbps: 9000,
  audioSampleRate: SR, audioChannels: 1, audioBitrateKbps: 112,
});

const totalFrames = Math.ceil(totalSec * FPS);
const DT = 1 / FPS;
const clicks = [];                 // { time, speed } — one per marble↔peg touch
const CLICKS_PER_FRAME_CAP = 6;    // keep dense cascade frames from turning to mush
for (let f = 0; f < totalFrames; f++) {
  const t = f / FPS;

  // active beat (for captions)
  let active = placed[0];
  for (const p of placed) if (t >= p.start) active = p;
  renderCaption(active.b, t - active.start);
  const act = active.b.act, sp = actSpan[act];
  const u = (t - sp.t0) / Math.max(0.001, sp.t1 - sp.t0);

  // ---- drive the simulation (variable speed) ----
  const simDt = DT * simSpeed(act, u);
  if (act === 'one' && !released1) { releaseBall(); released1 = true; }
  if (t >= actSpan.many.t0 && t < pourEnd && board.released < NB) {
    relAccum += simDt * POUR_RATE;
    while (relAccum >= 1 && board.released < NB) { releaseBall(); relAccum -= 1; }
  }
  step(simDt);
  sync();

  // ---- peg-impact sounds: one soft click per new marble↔peg touch this frame --
  const hits = pollPegHits();
  const nh = Math.min(hits.length, CLICKS_PER_FRAME_CAP);
  for (let h = 0; h < nh; h++) {
    clicks.push({ time: t + arnd() * DT, speed: hits[h] });   // jitter within the frame
  }

  // ---- camera ----
  if (act === 'one') {
    setCam(oneCam(u));
  } else {
    setCam(lerpCam(ACTS[act].from, ACTS[act].to, smooth(u), t));
  }

  // ---- overlays ----
  const counts = binCounts();
  const gaussianMix = act === 'curve' ? smooth(clamp01((u - 0.25) / 0.5)) : 0;
  updateViz(act, t, sp, counts, gaussianMix);

  flush();
  enc.addViewportFrame();
  if (f % 30 === 0) { let st = 0; const cc = counts; for (let k = 0; k < NBINS; k++) st += cc[k];
    console.log('frame ' + f + '/' + totalFrames + ' (' + t.toFixed(1) +
    's) act=' + act + ' released=' + board.released + ' settled=' + st); }
}
// ---- synthesize the peg-click track and mix it in --------------------------
// Each marble↔peg touch becomes a short, glassy, fast-decaying "tick" — pitch
// and decay varied a touch per click (marbles aren't identical), level scaled
// by impact speed. The patter tracks the action: a few gentle plinks under the
// lone marble, a downpour under the cascade.
const TWO_PI = Math.PI * 2;
const clickBuf = new Float32Array(N);
for (const c of clicks) {
  const s0 = Math.floor(c.time * SR);
  if (s0 < 0 || s0 >= N) continue;
  const f = 980 + arnd() * 760;                       // ~980–1740 Hz
  const tau = 0.013 + arnd() * 0.007;                 // 13–20 ms decay
  const amp = 0.12 * (0.4 + 0.6 * clamp01(c.speed / 9));
  const len = Math.min(N - s0, Math.floor(0.06 * SR));
  for (let i = 0; i < len; i++) {
    const tt = i / SR, env = Math.exp(-tt / tau);
    clickBuf[s0 + i] += (Math.sin(TWO_PI * f * tt) + 0.5 * Math.sin(TWO_PI * 2.01 * f * tt)) * env * amp;
  }
}
let cpk = 0;
for (let i = 0; i < N; i++) {
  let v = mixBuf[i] + clickBuf[i];
  v = v > 1 ? 1 : v < -1 ? -1 : v;
  mixBuf[i] = v;
  const a = clickBuf[i] < 0 ? -clickBuf[i] : clickBuf[i]; if (a > cpk) cpk = a;
}
console.log('clicks=' + clicks.length + ' clickPeak=' + cpk.toFixed(2));

enc.addAudioFramesPCM(mixBuf);
enc.finish();
const fc = binCounts(); let cl = '', tot = 0; for (let k = 0; k < NBINS; k++) { cl += fc[k] + ' '; tot += fc[k]; }
console.log('FINAL BINS: ' + cl + ' settled=' + tot + '/' + NB);
console.log('DONE frames=' + totalFrames + ' seconds=' + totalSec.toFixed(1) + ' file=galton.webm');

})();
