// Devlog studio: drive the self-building maze through four acts — carve, flood,
// solve, dive — each a real engine capability, with a plain informative
// voiceover (no selling), word-synced captions, a continuous TTS + music bed
// (zero silence), captured via addViewportFrame and muxed to a vertical WebM.

(() => {   // isolate (maze.js leaks some helper names globally)

const W = 1080, H = 1920, FPS = 30, SR = 24000;
const maze = buildMaze();
const { scene, tick, path, floodGrid, onPath, pathNorm, solid, GW, GH,
        setBuildFront, setFloodFront, setSolutionFront,
        setCursor, moveOrb, cursorAt, span } = maze;
const cap = document.getElementById('cap');

// start state: nothing built
setBuildFront(0);

// ---- math helpers ----------------------------------------------------------
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

// ---- camera ----------------------------------------------------------------
function setCam(c) {
  scene.setCamera({ fov: c.fov, aspect: W / H, near: 0.3, far: 1200,
    position: c.pos, target: c.tgt, up: [0, 1, 0] });
}
function lerpCam(a, b, u, t) {
  const L = (p, q) => p + (q - p) * u;
  const pos = [L(a.pos[0], b.pos[0]), L(a.pos[1], b.pos[1]), L(a.pos[2], b.pos[2])];
  const tgt = [L(a.tgt[0], b.tgt[0]), L(a.tgt[1], b.tgt[1]), L(a.tgt[2], b.tgt[2])];
  pos[0] += Math.sin(t * 0.5) * 0.25;          // faint handheld drift
  pos[1] += Math.cos(t * 0.7) * 0.18;
  return { pos, tgt, fov: L(a.fov, b.fov) };
}

// top-down-ish moves for carve / flood / solve. Coords are world units; the
// maze is centred on the origin and spans ~`span` across.
const TOP = span * 1.18, HI = span * 1.46;
const ACTS = {
  build: {  // high, slow descent over the whole grid
    from: { pos: [-span * 0.10, HI, TOP * 0.96], tgt: [0, 1.5, 0], fov: 46 },
    to:   { pos: [ span * 0.06, HI * 0.93, TOP * 0.88], tgt: [0, 1.5, 0], fov: 46 } },
  flood: {  // slow lateral orbit as the colour sweeps
    from: { pos: [-span * 0.22, HI * 0.92, TOP * 0.86], tgt: [0, 1.0, 0], fov: 45 },
    to:   { pos: [ span * 0.22, HI * 0.92, TOP * 0.86], tgt: [0, 1.0, 0], fov: 45 } },
  solve: {  // ease in toward the start corner as the path ignites
    from: { pos: [ span * 0.20, HI * 0.90, TOP * 0.84], tgt: [0, 1.0, 0], fov: 44 },
    to:   { pos: [ maze.startWorld.x * 0.5, HI * 0.66, TOP * 0.60], tgt: [maze.startWorld.x * 0.3, 0.5, maze.startWorld.z * 0.3], fov: 42 } },
};

// ---- narration: each line names exactly what's on screen at that beat -------
const beats = [
  { act: 'build', text: 'This maze builds itself.' },
  { act: 'build', text: 'A single walker explores the grid, depth first.' },
  { act: 'build', text: 'Backtracking at every dead end, until no cell is left.' },
  { act: 'flood', text: 'Now, solve it.' },
  { act: 'flood', text: 'A wave spreads out from the entrance, one ring at a time.' },
  { act: 'flood', text: 'Each cell coloured by how far the wave has come.' },
  { act: 'solve', text: 'And every cell remembers where the wave came from.' },
  { act: 'solve', text: 'Trace that back from the exit, and the path lights up.' },
  { act: 'dive',  text: 'Between any two cells, there is exactly one route.' },
  { act: 'dive',  text: 'No loops, no shortcuts.' },
  { act: 'dive',  text: 'So just follow it out.' },
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
  // trim leading/trailing silence so clips butt up tight (no dead air)
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
const GAP = 0.07, LEAD = 0.2, TAIL = 0.7;
const placed = []; let cursor = LEAD;
for (const b of beats) { placed.push({ b, start: cursor }); cursor += b.seconds + GAP; }
const totalSec = cursor + TAIL;
const N = Math.ceil(totalSec * SR);

// per-act time spans (first beat start -> last beat end) drive the camera move
const actSpan = {};
for (const p of placed) {
  const k = p.b.act, s = actSpan[k] || (actSpan[k] = { t0: Infinity, t1: -Infinity });
  s.t0 = Math.min(s.t0, p.start);
  s.t1 = Math.max(s.t1, p.start + p.b.seconds + GAP);
}

// ---- audio (VO + soft music bed, never silent) -----------------------------
const voBuf = new Float32Array(N);
for (const p of placed) {
  const off = Math.floor(p.start * SR), s = p.b.samples;
  for (let i = 0; i < s.length && off + i < N; i++) voBuf[off + i] += s[i];
}
// a cool, minor pad bed — fits the dark/neon look
const chords = [[164.81, 196.0, 246.94], [146.83, 174.61, 220.0], [130.81, 164.81, 196.0], [123.47, 146.83, 185.0]];
const bar = 4.0, mixBuf = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const tt = i / SR;
  const ch = chords[Math.floor(tt / bar) % chords.length];
  let pad = 0; for (const f of ch) pad += Math.sin(2 * Math.PI * f * tt);
  pad /= ch.length;
  const bass = Math.sin(2 * Math.PI * (ch[0] / 2) * tt) * 0.5;
  const trem = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.18 * tt);
  let bed = (pad * 0.55 + bass) * (0.08 + 0.03 * trem);
  bed *= clamp01(tt / 0.7) * clamp01((totalSec - tt) / 0.8);
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

// ---- overlay panels: "show the thing you're saying" -----------------------
const panel = document.getElementById('panel');
const codeEl = document.getElementById('code');
const barFile = document.getElementById('barfile');
const barBadge = document.getElementById('barbadge');
const viz = document.getElementById('viz');
const vizLabel = document.getElementById('vizlabel');

const PANELS = {
  build: { file: 'carve.js', badge: 'recursive backtracker', code:
`// carve: a depth-first walk over the cell grid
const stack = [start];
while (stack.length) {
  const cell = stack[stack.length - 1];

  // unvisited neighbours, two cells away
  const next = neighbours(cell)
    .filter(n => !seen[n]);

  if (!next.length) { stack.pop(); continue; }

  const n = next[rand() * next.length | 0];
  seen[n] = true;
  openWall(cell, n);   // knock out the wall between
  stack.push(n);       // tunnel onward
}
// the order cells open drives the walls rising` },

  flood: { file: 'flood.js', badge: 'breadth-first search', viz: true, code:
`// flood: breadth-first search from the entrance
let frontier = [start];
dist[start] = 0;

while (frontier.length) {
  const next = [];
  for (const cell of frontier)
    for (const n of open(cell))   // walkable only
      if (dist[n] < 0) {
        dist[n] = dist[cell] + 1;
        parent[n] = cell;
        next.push(n);
      }
  frontier = next;                // one ring per step
}

// colour each tile by dist -> HDR tint > 1.0
tile.tint = floodRamp(dist[cell] / maxDist);` },

  solve: { file: 'solve.js', badge: 'shortest path', viz: true, code:
`// solve: the path is already in the BFS tree
// walk parent[] back from the exit
const path = [];
for (let c = exit; c !== -1; c = parent[c]) {
  path.push(c);
  if (c === start) break;
}
path.reverse();

// ignite it, entrance -> exit
path.forEach((cell, i) => {
  tile[cell].tint = GOLD;
  tile[cell].igniteAt = i / path.length;
});
// BFS gives the shortest path for free` },

  dive: { file: 'render.js', badge: 'two draws / frame', code:
`// the whole maze is two instanced meshes
scene.createInstancedMesh({
  mesh: Mesh.box(),       // the walls
  instances: walls,       // 16 floats each:
});                        // transform + RGBA tint

scene.createInstancedMesh({
  mesh: Mesh.box(),       // the floor tiles
  instances: tiles,       // tint > 1.0 -> it blooms
});

// re-colour a tile = rewrite its four tint floats
tile.tint = GOLD;
// thousands of cells, two draws a frame` },
};

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function highlight(src) {
  return src.split('\n').map((line) => {
    const ci = line.indexOf('//');
    let code = ci >= 0 ? line.slice(0, ci) : line;
    const comment = ci >= 0 ? line.slice(ci) : '';
    let h = esc(code);
    h = h.replace(/(['"`])(.*?)\1/g, (m) => `<span class="st">${m}</span>`);
    h = h.replace(/\b(\d+\.?\d*)\b/g, '<span class="nu">$1</span>');
    h = h.replace(/\b(const|let|var|function|return|for|if|else|new|of|in|true|false|null|while|break|continue)\b/g,
                  '<span class="kw">$1</span>');
    h = h.replace(/\b([A-Za-z_$][\w$]*)(\s*\()/g, '<span class="fn">$1</span>$2');
    if (comment) h += `<span class="cm">${esc(comment)}</span>`;
    return h;
  }).join('\n');
}

// ---- live min-map (Canvas 2D) — the algorithm's plan view ------------------
const mmap = document.getElementById('mmap');
const FLOODM = [[40, 150, 220], [70, 90, 230], [180, 70, 200], [235, 90, 150]];
function rampM(t) {
  const s = clamp01(t) * (FLOODM.length - 1), k = Math.min(FLOODM.length - 2, Math.floor(s)), fr = s - k;
  const a = FLOODM[k], b = FLOODM[k + 1];
  return [(a[0] + (b[0] - a[0]) * fr) | 0, (a[1] + (b[1] - a[1]) * fr) | 0, (a[2] + (b[2] - a[2]) * fr) | 0];
}
function drawMinimap(floodP, solP) {
  const ctx = mmap.getContext('2d');
  const SZ = 272, cw = SZ / GW, chh = SZ / GH;
  ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, SZ, SZ);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const k = gy * GW + gx;
    if (solid[k]) { ctx.fillStyle = '#0f1626'; ctx.fillRect(gx * cw, gy * chh, cw + 0.6, chh + 0.6); continue; }
    const d = floodGrid[k];
    let col = '#10182a';
    if (floodP > 0 && d >= 0 && d <= floodP) { const c = rampM(d); col = `rgb(${c[0]},${c[1]},${c[2]})`; }
    if (solP > 0 && onPath[k] && pathNorm[k] <= solP) col = '#ffd24a';
    ctx.fillStyle = col;
    ctx.fillRect(gx * cw, gy * chh, cw + 0.6, chh + 0.6);
  }
}

const LINEH = 36, CODEAREA = 648 - 56 - 36;
const FADE = 0.4;
const maxScrollFor = {};
for (const k in PANELS) maxScrollFor[k] = Math.max(0, PANELS[k].code.split('\n').length * LINEH + 18 - CODEAREA);
let panelAct = null;
function updatePanel(act, t, sp, floodP, solP) {
  if (act !== panelAct) {
    const p = PANELS[act];
    barFile.textContent = p.file;
    barBadge.textContent = p.badge;
    codeEl.innerHTML = highlight(p.code);
    viz.style.display = p.viz ? 'block' : 'none';
    if (p.viz) vizLabel.textContent = act === 'solve' ? 'parent[] backtrack' : 'dist[cell]';
    panelAct = act;
  }
  const dur = sp.t1 - sp.t0, tin = t - sp.t0;
  const u = clamp01(tin / Math.max(0.001, dur));
  codeEl.style.marginTop = `${-(maxScrollFor[act] * u).toFixed(1)}px`;
  const op = clamp01(Math.min(tin / FADE, (dur - tin) / FADE));
  panel.style.opacity = op.toFixed(3);
  if (PANELS[act].viz) { viz.style.opacity = op.toFixed(3); drawMinimap(floodP, solP); }
  else viz.style.opacity = '0';
}

// ---- dive: a steep isometric follow that tracks the orb running the route ---
// The camera holds a fixed offset above + to the side of the orb, so the maze
// stays laid out around it and every turn is legible. It settles in from a
// higher, wider view over the first moment of the act.
const pathAt = (fp) => {
  const n = path.length;
  const c = Math.max(0, Math.min(n - 1, fp));
  const i = Math.min(n - 2, Math.floor(c)), tt = c - i;
  return lerpPt(path[i], path[i + 1], tt);
};
function diveCam(u, t) {
  const o = pathAt(clamp01(u) * (path.length - 1));   // orb position
  const drop = smooth(Math.min(u / 0.18, 1));         // settle from wide to the follow
  const ox = 7.5 + (5.0 - 7.5) * drop;
  const hy = 22.0 + (15.0 - 22.0) * drop;
  const oz = 7.5 + (5.0 - 7.5) * drop;
  const bob = Math.sin(t * 2.2) * 0.05 * drop;
  return { pos: [o.x + ox, hy + bob, o.z + oz], tgt: [o.x, 0.4, o.z], fov: 50 };
}
function orbAhead(u) { return pathAt(clamp01(u) * (path.length - 1)); }

// ---- render loop -----------------------------------------------------------
const enc = new VideoEncoder({
  path: 'maze.webm', width: W, height: H, fps: FPS,
  quality: 'good', threads: 8, bitrateKbps: 9000,
  audioSampleRate: SR, audioChannels: 1, audioBitrateKbps: 112,
});

const totalFrames = Math.ceil(totalSec * FPS);
let lastT = 0, builtFull = false, floodDone = false;
for (let f = 0; f < totalFrames; f++) {
  const t = f / FPS, dt = t - lastT; lastT = t;
  tick(dt);

  // active beat (for captions)
  let active = placed[0];
  for (const p of placed) if (t >= p.start) active = p;
  renderCaption(active.b, t - active.start);

  const act = active.b.act, sp = actSpan[act];
  const u = (t - sp.t0) / Math.max(0.001, sp.t1 - sp.t0);
  const su = smooth(u);

  // current flood / solution fronts (for the minimap + reveal)
  let floodP = 0, solP = 0;

  if (act === 'build') {
    setBuildFront(su);
    const c = cursorAt(su);
    setCursor(true, c.x, c.z);
    setCam(lerpCam(ACTS.build.from, ACTS.build.to, su, t));
  } else if (act === 'flood') {
    if (!builtFull) { setBuildFront(1); setCursor(false, 0, 0); builtFull = true; }
    floodP = su;
    setFloodFront(floodP);
    setCam(lerpCam(ACTS.flood.from, ACTS.flood.to, su, t));
  } else if (act === 'solve') {
    if (!builtFull) { setBuildFront(1); setCursor(false, 0, 0); builtFull = true; }
    if (!floodDone) { setFloodFront(1); floodDone = true; }
    floodP = 1; solP = su;
    const o = setSolutionFront(solP);
    moveOrb(true, o.x, o.z, 0.7);
    setCam(lerpCam(ACTS.solve.from, ACTS.solve.to, su, t));
  } else { // dive
    if (!builtFull) { setBuildFront(1); builtFull = true; }
    setFloodFront(1); setSolutionFront(1);
    floodP = 1; solP = 1;
    const du = smooth(clamp01(u));        // ease the run in and out
    const o = orbAhead(du);
    moveOrb(true, o.x, o.z, 0.7);
    setCam(diveCam(du, t));
  }

  updatePanel(act, t, sp, floodP, solP);

  flush();
  enc.addViewportFrame();
  if (f % 60 === 0) console.log('frame ' + f + '/' + totalFrames + ' (' + t.toFixed(1) + 's)');
}
enc.addAudioFramesPCM(mixBuf);
enc.finish();
console.log('DONE frames=' + totalFrames + ' seconds=' + totalSec.toFixed(1) + ' file=maze.webm');

})();
