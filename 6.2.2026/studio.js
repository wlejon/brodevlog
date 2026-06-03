// Devlog studio: drive the natural-valley world through a sequence of "acts",
// each one a real engine capability, with a plain informative voiceover (no
// selling), word-synced captions, a continuous TTS + music bed (zero silence),
// captured via addViewportFrame and muxed to a vertical WebM.

(() => {   // isolate (world.js leaks some helper names globally)

const W = 1080, H = 1920, FPS = 30, SR = 24000;
const world = buildWorld();
const { scene, tick, groundY, HERO, setHeroGrowth, setGrovesVisible,
        showBoulders, stepBoulders } = world;
const cap = document.getElementById('cap');
const hy = groundY(HERO.x, HERO.z);

// Start state: hero is a seedling, the instanced groves are hidden, boulders
// wait in the air out of frame. Each act turns its capability on.
setHeroGrowth(0);
setGrovesVisible(false);

// ---- math helpers ----------------------------------------------------------
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };

// ---- camera ----------------------------------------------------------------
function setCam(c) {
  scene.setCamera({ fov: c.fov, aspect: W / H, near: 0.4, far: 900,
    position: c.pos, target: c.tgt, up: [0, 1, 0] });
}
function lerpCam(a, b, u, t) {
  const L = (p, q) => p + (q - p) * u;
  const pos = [L(a.pos[0], b.pos[0]), L(a.pos[1], b.pos[1]), L(a.pos[2], b.pos[2])];
  const tgt = [L(a.tgt[0], b.tgt[0]), L(a.tgt[1], b.tgt[1]), L(a.tgt[2], b.tgt[2])];
  pos[0] += Math.sin(t * 0.6) * 0.12;          // faint handheld drift
  pos[1] += Math.cos(t * 0.8) * 0.08;
  return { pos, tgt, fov: L(a.fov, b.fov) };
}

// ---- acts: one continuous camera move each, hard cut between -------------
// Coordinates are relative to the hero knoll (HERO, hy).
const HX = HERO.x, HZ = HERO.z;
const ACTS = {
  terrain: {
    from: { pos: [HX - 55, hy + 26, HZ + 50], tgt: [HX + 10, hy + 6, HZ + 4],  fov: 44 },
    to:   { pos: [HX - 24, hy + 16, HZ + 34], tgt: [HX + 30, hy + 8, HZ - 10], fov: 40 } },
  grow: {   // tight on the hero as it grows
    from: { pos: [HX - 10, hy + 2.4, HZ + 9.5], tgt: [HX, hy + 1.6, HZ], fov: 47 },
    to:   { pos: [HX - 9,  hy + 3.6, HZ + 8.5], tgt: [HX, hy + 3.6, HZ], fov: 43 } },
  groves: { // pull WAY back as thousands of trees appear across the hills
    from: { pos: [HX - 12, hy + 5, HZ + 13], tgt: [HX + 2, hy + 4, HZ - 4], fov: 44 },
    to:   { pos: [HX - 64, hy + 62, HZ - 150], tgt: [HX + 14, hy + 10, HZ], fov: 44 } },
  physics: { // elevated 3/4 to catch thousands of boulders raining across the land
    from: { pos: [HX + 44, hy + 28, HZ + 48], tgt: [HX, hy + 4, HZ], fov: 48 },
    to:   { pos: [HX + 28, hy + 17, HZ + 32], tgt: [HX - 4, hy + 2, HZ], fov: 46 } },
  light: {  // epic crane up + back over the vast forest, golden finale
    from: { pos: [HX - 18, hy + 7, HZ + 15], tgt: [HX, hy + 5, HZ], fov: 43 },
    to:   { pos: [HX - 56, hy + 82, HZ - 178], tgt: [HX + 16, hy + 12, HZ + 6], fov: 40 } },
};

// ---- narration: each line names exactly what's on screen at that beat -------
const beats = [
  { act: 'terrain', text: 'The ground is a heightfield, built from noise.' },
  { act: 'terrain', text: 'Coloured by slope and height, then lit.' },
  { act: 'grow',    text: "The trees aren't models." },
  { act: 'grow',    text: 'A simulation grows each one, branch by branch.' },
  { act: 'groves',  text: 'Baked to a mesh, then instanced across the hills.' },
  { act: 'physics', text: 'The boulders are real rigid bodies.' },
  { act: 'physics', text: 'Dropped with Jolt, colliding and settling.' },
  { act: 'light',   text: 'Lit with a low sun: shadows, bloom, depth.' },
  { act: 'light',   text: 'All of it rendering in real time.' },
  { act: 'light',   text: 'HTML, JavaScript, and a C++ engine.' },
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
const GAP = 0.06, LEAD = 0.15, TAIL = 0.5;
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
const chords = [[220, 261.63, 329.63], [196.0, 246.94, 293.66], [174.61, 220, 261.63], [146.83, 220, 293.66]];
const bar = 3.8, mixBuf = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const tt = i / SR;
  const ch = chords[Math.floor(tt / bar) % chords.length];
  let pad = 0; for (const f of ch) pad += Math.sin(2 * Math.PI * f * tt);
  pad /= ch.length;
  const bass = Math.sin(2 * Math.PI * (ch[0] / 2) * tt) * 0.5;
  const trem = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.2 * tt);
  let bed = (pad * 0.6 + bass) * (0.08 + 0.03 * trem);
  bed *= clamp01(tt / 0.6) * clamp01((totalSec - tt) / 0.7);
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
// Per act, a code card shows the actual code for what's on screen; it scrolls
// across the act. The terrain act also shows a live heightmap render.
const panel = document.getElementById('panel');
const codeEl = document.getElementById('code');
const barFile = document.getElementById('barfile');
const barBadge = document.getElementById('barbadge');
const viz = document.getElementById('viz');
const vizLabel = document.getElementById('vizlabel');

const PANELS = {
  terrain: { file: 'terrain.js', badge: '300 × 300 grid', viz: true, code:
`// terrain: a value-noise heightfield
function fbm(x, z) {              // 5 octaves
  let amp = 1, freq = 1, sum = 0, n = 0;
  for (let o = 0; o < 5; o++) {
    sum += amp * vnoise(x*freq, z*freq);
    n += amp; amp *= 0.5; freq *= 2;
  }
  return sum / n;
}

function height(x, z) {
  let h = 5 + fbm(x*0.011, z*0.011) * 30;
  h += ridge(x, z);              // backdrop hill
  h -= valley(x, z);            // foreground bowl
  return h;
}

// 300 x 300 vertex grid -> one mesh
for (let z = 0; z < 300; z++)
  for (let x = 0; x < 300; x++)
    positions.push(wx, height(wx, wz), wz);` },

  grow: { file: 'broflora.js', badge: '160 sim steps', code:
`// grow ONE tree with the broflora simulation
const w = bro.flora.createWorld({ rngSeed });

const proto = w.addPrototype(
  bro.flora.prototypes.whorl(5, 0.8));
w.addPlant({
  origin: [0, 0, 0],
  species,             // shade, tropism, apical
  prototypeIndex: proto,
});

for (let i = 0; i < 160; i++)
  w.step(0.1);         // grows, branch by branch

// freeze the grown plant into geometry
const branch = w.emitMesh(6);
const leaves = Mesh.scatterLeaves(
  w.emitSegments(),    // every branch segment
  leafCard,
  { perUnitLength: 280, densityWeight: light },
);` },

  groves: { file: 'instancing.js', badge: '2,600 trees · 1 mesh', code:
`// bake the tree ONCE, then stamp it everywhere
const tree = bakeTree(species, 150);   // 1 mesh

// 2,600 placements: pos + quat + scale
const xforms = new Float32Array(2600 * 9);
for (let i = 0; i < 2600; i++) {
  const [x, z] = scatterInGrove();
  pack(xforms, i, x, ground(x, z), z, yaw, s);
}

// one node -> the whole forest
scene.createInstancedMesh({
  mesh: tree.leaves,
  instancesFromTransforms: xforms,
  color: leafColor,
  twoSided: true,
  subsurface: 0.22,    // backlit-leaf glow
});
// 2,600 trees, a handful of draw calls` },

  physics: { file: 'physics.js', badge: '3,000 bodies', code:
`// 3,000 real rigid bodies in a Jolt world
const w = Physics.createWorldHandle({
  maxBodies: 3016,
  gravity: { x: 0, y: -9.81, z: 0 },
});

// static collider from the terrain mesh
w.createBody({ shape: 'mesh', static: true,
  positions, indices });

// rain down 3,000 boulders
for (let i = 0; i < 3000; i++)
  w.createBody({ shape: 'sphere', radius: rr,
    position: { x, y: dropY, z } });

// each frame: step, then sync -> instances
w.step(dt);
const all = w.getAllTransforms();
boulders.setInstancesFromTransforms(all);` },

  light: { file: 'lighting.js', badge: 'real-time', code:
`// PBR + post, all real-time
scene.setShadowQuality(4096, 3);   // 4 cascades

scene.createLight({
  type: 'directional',
  direction: [-0.5, -0.32, 0.55],  // low sun
  color: [1.0, 0.74, 0.44],        // golden
  intensity: 3.4,
});

scene.setBloom({
  threshold: 1.15, intensity: 0.45,
});
scene.setToneMap({ mode: 'aces', exposure: 1.1 });

// the scene, the captions, and THIS panel
// are all HTML / CSS / JS, composited live.` },
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
    h = h.replace(/\b(const|let|var|function|return|for|if|else|new|of|in|true|false|null)\b/g,
                  '<span class="kw">$1</span>');
    h = h.replace(/\b([A-Za-z_$][\w$]*)(\s*\()/g, '<span class="fn">$1</span>$2');
    if (comment) h += `<span class="cm">${esc(comment)}</span>`;
    return h;
  }).join('\n');
}

// Render the actual terrain heights into the heightmap canvas (terrain colour ramp).
function drawHeightmap() {
  const ctx = document.getElementById('hmap').getContext('2d');
  const SZ = 272, G = 90, cs = SZ / G, HS = world.S;
  const vals = new Float32Array(G * G); let mn = 1e9, mx = -1e9;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = -HS + (i / (G - 1)) * 2 * HS, z = -HS + (j / (G - 1)) * 2 * HS;
    const v = groundY(x, z); vals[j * G + i] = v;
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  const stops = [[46, 72, 82], [52, 107, 46], [140, 132, 71], [235, 237, 242]];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const t = clamp01((vals[j * G + i] - mn) / (mx - mn + 1e-6));   // Float32 store can dip below mn
    const s = t * (stops.length - 1), k = Math.max(0, Math.min(stops.length - 2, Math.floor(s))), fr = s - k;
    const a = stops[k], b = stops[k + 1];
    const r = (a[0] + (b[0] - a[0]) * fr) | 0, g = (a[1] + (b[1] - a[1]) * fr) | 0, bl = (a[2] + (b[2] - a[2]) * fr) | 0;
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.fillRect(i * cs, j * cs, cs + 1, cs + 1);
  }
}
drawHeightmap();

const LINEH = 36, CODEAREA = 660 - 56 - 36;   // panel - bar - padding
const FADE = 0.4;
const maxScrollFor = {};
for (const k in PANELS) maxScrollFor[k] = Math.max(0, PANELS[k].code.split('\n').length * LINEH + 18 - CODEAREA);
let panelAct = null;
function updatePanel(act, t, sp) {
  if (act !== panelAct) {
    const p = PANELS[act];
    barFile.textContent = p.file;
    barBadge.textContent = p.badge;
    codeEl.innerHTML = highlight(p.code);
    viz.style.display = p.viz ? 'block' : 'none';
    if (p.viz) vizLabel.textContent = 'groundY(x, z)';
    panelAct = act;
  }
  const dur = sp.t1 - sp.t0, tin = t - sp.t0;
  const u = clamp01(tin / Math.max(0.001, dur));
  codeEl.style.marginTop = `${-(maxScrollFor[act] * u).toFixed(1)}px`;   // scroll (robust vs transform)
  const op = clamp01(Math.min(tin / FADE, (dur - tin) / FADE));
  panel.style.opacity = op.toFixed(3);
  viz.style.opacity = (PANELS[act].viz ? op : 0).toFixed(3);
}

// ---- render loop -----------------------------------------------------------
const enc = new VideoEncoder({
  path: 'hero.webm', width: W, height: H, fps: FPS,    // lands in the cwd — see README
  quality: 'good', threads: 8, bitrateKbps: 9000,
  audioSampleRate: SR, audioChannels: 1, audioBitrateKbps: 112,
});

const totalFrames = Math.ceil(totalSec * FPS);
let lastT = 0, grovesOn = false, bouldersOn = false;
for (let f = 0; f < totalFrames; f++) {
  const t = f / FPS, dt = t - lastT; lastT = t;
  tick(dt);

  // active beat (for captions)
  let active = placed[0];
  for (const p of placed) if (t >= p.start) active = p;
  renderCaption(active.b, t - active.start);

  // camera follows the active beat's act
  const act = active.b.act, sp = actSpan[act];
  const u = smooth((t - sp.t0) / Math.max(0.001, sp.t1 - sp.t0));
  setCam(lerpCam(ACTS[act].from, ACTS[act].to, u, t));

  // illustrative code/heightmap overlay for this act
  updatePanel(act, t, sp);

  // grow the hero across the 'grow' act; full tree from 'groves' onward
  if (act === 'grow') {
    const g = actSpan.grow;
    setHeroGrowth((t - g.t0) / Math.max(0.001, g.t1 - g.t0));
  } else if (t >= actSpan.grow.t1) {
    setHeroGrowth(1);
  }
  // reveal the instanced groves when that act begins
  if (!grovesOn && t >= actSpan.groves.t0) { setGrovesVisible(true); grovesOn = true; }
  // drop + simulate boulders from the physics act onward
  if (!bouldersOn && t >= actSpan.physics.t0) { showBoulders(); bouldersOn = true; }
  if (bouldersOn) stepBoulders(dt);

  flush();
  enc.addViewportFrame();
  if (f % 60 === 0) console.log('frame ' + f + '/' + totalFrames + ' (' + t.toFixed(1) + 's)');
}
enc.addAudioFramesPCM(mixBuf);
enc.finish();
console.log('DONE frames=' + totalFrames + ' seconds=' + totalSec.toFixed(1) +
            ' file=hero.webm');

})();
