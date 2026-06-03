// Hero world (devlog): a golden-hour natural valley — rolling hills, a lake
// catching the low sun, clustered groves of real broflora trees, a hero tree in
// the foreground, and a few boulders. No city: the old box-city read as
// rectangles + blown-out bloom. This scene leans on what the engine actually
// renders well — procedural terrain, grown plants, PBR + image-based lighting.
//
// buildWorld() returns { scene, tick, ... }. Geometry is deterministic (fixed
// hash noise) so captures are stable. The studio drives the camera; tick(dt)
// only advances in-world motion (sun drift, wind clock).

// ---- deterministic value-noise FBM ----------------------------------------
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sstep = (t) => t * t * (3 - 2 * t);
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz),     b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  const u = sstep(fx), v = sstep(fz);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, z) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < 5; o++) { sum += amp * vnoise(x * freq, z * freq); norm += amp; amp *= 0.5; freq *= 2.0; }
  return sum / norm;
}

const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
const smoothstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ---- world parameters ------------------------------------------------------
const S = 220;              // terrain half-extent (vast)
const HERO = { x: -8, z: -30 };         // hero tree knoll (in front of camera)
const RIDGE = { x: 60, z: 70 };         // a hill that gives the valley a backdrop

// Rolling land: broad hills + a backdrop ridge + a gentle knoll under the hero
// tree so it reads against the sky. Distance fog hides the rim so it doesn't
// look like a tabletop slab. No lake — flat water read as dead gray space.
function rawHeight(x, z) {
  const n  = fbm(x * 0.011 + 11.2, z * 0.011 + 4.1);    // broad hills 0..1
  const n2 = fbm(x * 0.045 + 7.0,  z * 0.045 + 2.0);    // mid detail
  const n3 = fbm(x * 0.13  + 1.0,  z * 0.13  + 9.0);    // fine roughness
  let h = 5.0 + n * 30 + (n2 - 0.5) * 8 + (n3 - 0.5) * 1.8;
  // a soft valley bowl through the middle so there's a clear foreground stage
  const dv = Math.hypot(x * 0.8, z + 6);
  h -= 9 * smoothstep(60, 8, dv);
  // backdrop ridge
  h += 16 * smoothstep(46, 14, Math.hypot(x - RIDGE.x, z - RIDGE.z));
  // raise a soft knoll under the hero tree
  h += 5.0 * smoothstep(22, 3, Math.hypot(x - HERO.x, z - HERO.z));
  return h;
}
function terrainHeight(x, z) { return rawHeight(x, z); }

function terrainColor(h, slope, n) {
  const grass = [0.24, 0.38, 0.13];
  const grass2= [0.17, 0.30, 0.10];
  const dry   = [0.46, 0.44, 0.22];
  const rock  = [0.40, 0.36, 0.31];
  let base = mixc(grass, grass2, n);                 // mottled grass
  base = mixc(base, dry, smoothstep(22, 38, h));     // drier uplands
  base = mixc(base, rock, smoothstep(0.42, 0.72, slope)); // rock on steeps
  return base;
}

globalThis.buildWorld = function buildWorld() {
  const canvas = document.getElementById('stage');
  const W = canvas.width  = 1080;
  const H = canvas.height = 1920;
  const scene = canvas.getContext('scene');

  scene.setToneMap({ mode: 'aces', exposure: 1.1, gamma: 2.2 });
  // No HDRI skybox: both bundled HDRs are hazy/overcast and wash the scene out.
  // Instead the scene clears transparent and composites over the golden-hour
  // gradient in index.html's <body>. Sky light is approximated by a soft warm
  // ambient + a cool sky-fill directional; the warm sun carries the mood.
  scene.setAmbient([0.17, 0.18, 0.22]);
  scene.setFog({ start: 240, end: 760, color: [0.85, 0.68, 0.50] });   // warm horizon haze

  // ---- terrain heightfield mesh -------------------------------------------
  const N = 300;
  const positions = [], normals = [], colors = [], indices = [];
  const step = (2 * S) / (N - 1);
  const hAt = (gx, gz) => terrainHeight(-S + gx * step, -S + gz * step);
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const x = -S + gx * step, z = -S + gz * step;
      const y = terrainHeight(x, z);
      positions.push(x, y, z);
      const hl = hAt(Math.max(gx - 1, 0), gz), hr = hAt(Math.min(gx + 1, N - 1), gz);
      const hd = hAt(gx, Math.max(gz - 1, 0)), hu = hAt(gx, Math.min(gz + 1, N - 1));
      let nx = (hl - hr), ny = 2 * step, nz = (hd - hu);
      const inv = 1 / Math.hypot(nx, ny, nz); nx *= inv; ny *= inv; nz *= inv;
      normals.push(nx, ny, nz);
      const slope = 1 - ny;
      const nn = fbm(x * 0.2 + 30, z * 0.2 + 12);
      const c = terrainColor(y, slope, nn);
      colors.push(c[0], c[1], c[2], 1);
    }
  }
  for (let gz = 0; gz < N - 1; gz++) {
    for (let gx = 0; gx < N - 1; gx++) {
      const i = gz * N + gx;
      indices.push(i, i + N, i + 1,  i + 1, i + N, i + N + 1);
    }
  }
  scene.createMesh({
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    colors:    new Float32Array(colors),
    indices:   new Uint32Array(indices),
    metallic: 0.0, roughness: 0.95,
  });

  // bilinear sample of the rendered mesh surface (trees/rocks sit on the grid,
  // not the smooth function, so they don't hover on convex ridges).
  function groundY(x, z) {
    const gx = (x + S) / step, gz = (z + S) / step;
    const x0 = Math.max(0, Math.min(N - 1, Math.floor(gx))), x1 = Math.min(N - 1, x0 + 1);
    const z0 = Math.max(0, Math.min(N - 1, Math.floor(gz))), z1 = Math.min(N - 1, z0 + 1);
    const fx = gx - x0, fz = gz - z0;
    const h0 = hAt(x0, z0) * (1 - fx) + hAt(x1, z0) * fx;
    const h1 = hAt(x0, z1) * (1 - fx) + hAt(x1, z1) * fx;
    return h0 * (1 - fz) + h1 * fz;
  }

  // deterministic RNG for scatter
  let seed = 1337;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const grnd = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;  // approx gaussian [-1..1]

  // ---- broflora trees ------------------------------------------------------
  function stripColors(m) { try { m.colors = new Float32Array(0); } catch (e) {} return m; }

  function bakeTree(spec, steps, targetH, lo, norm) {
    lo = lo || {};
    if (norm === undefined) norm = true;
    const w = bro.flora.createWorld({
      rngSeed: spec.seed,
      climate: { annualTempBase: 15, annualPrecip: 1000 },
      shadow: { origin: [-8, 0, -8], cellSize: 1, width: 16, height: 16, depth: 16, fill: 1.0 },
    });
    const proto = w.addPrototype(bro.flora.prototypes.whorl(5, 0.8));
    const tuft  = w.addPrototype(bro.flora.prototypes.whorl(3, 0.55));
    w.addVoronoiSite(proto, 0.5, 0.3);
    w.addVoronoiSite(tuft, 0.12, 0.3);
    w.addPlant({ origin: [0, 0, 0], species: spec.species, prototypeIndex: proto });
    for (let i = 0; i < steps; i++) w.step(0.1);

    const branch = stripColors(w.emitMesh(6));
    const leaf = Mesh.leafCard('oval', {
      width: lo.lw || 0.14, length: lo.ll || 0.24, bend: 0.5, fullUV: true,
      shapedSilhouette: true, cup: 0.35, widthSegments: 2, lengthSegments: 3,
    });
    stripColors(leaf);
    const segs = w.emitSegments();
    const fol  = w.emitFoliage();
    const dw = [];
    for (let i = 0; i < segs.length; i++) {
      const f = fol && fol[i];
      const raw = f && f.lightExposure01 !== undefined ? f.lightExposure01 : 1.0;
      dw.push((0.1 + 0.9 * raw) * (f ? Math.min(1, f.age01) : 1));
    }
    const leaves = stripColors(Mesh.scatterLeaves(segs, leaf, {
      maxRadius: lo.mr || 0.18, minDepth: 1, perUnitLength: lo.pul || 95, densityWeight: dw,
      upBias: 0.45, tiltJitter: 0.65, rollJitter: 0.95,
      baseScale: lo.bs || 1.8, scaleJitter: 0.35, scaleByRadius: 0.2, seed: spec.seed ^ 0x1eaf,
    }));

    if (norm) {
      const bb = branch.computeBBox();
      const h = Math.max(0.001, bb.max[1] - bb.min[1]);
      const k = targetH / h;
      for (const m of [branch, leaves]) { m.scale(k, k, k); m.translate(0, -bb.min[1] * k, 0); }
    }
    return { branch, leaves };
  }

  const SPECIES = [
    { seed: 0xC0FFEE, species: { shadeTolerance: 0.35, moduleMatureAge: 0.6, tropismG2: 0.12,
      growthScale: 1.0, orthotropy: 0.42, rootVigorMax: 3.0, apicalControl: 0.35,
      apicalControlMature: 0.3, maxAge: 60 } },
    { seed: 0x5EED, species: { shadeTolerance: 0.8, moduleMatureAge: 0.7, tropismG2: 0.12,
      growthScale: 0.85, orthotropy: 0.5, rootVigorMax: 2.5, apicalControl: 0.30,
      apicalControlMature: 0.3, maxAge: 70 } },
  ];
  const TREES = [ bakeTree(SPECIES[0], 150, 4.0), bakeTree(SPECIES[1], 130, 3.2) ];
  const leafColors  = [[0.20, 0.40, 0.10], [0.16, 0.33, 0.12]];
  const branchColor = [0.26, 0.19, 0.12];

  const slopeAt = (x, z) => {
    const e = 1.2;
    return Math.abs(terrainHeight(x + e, z) - terrainHeight(x - e, z)) +
           Math.abs(terrainHeight(x, z + e) - terrainHeight(x, z - e));
  };

  // clustered groves: pick centers (biased to ring the foreground stage so the
  // hero tree reads against forest, with clearings between), scatter trees with
  // gaussian falloff so the forest reads as groves, not uniform noise.
  const groves = [];
  for (let i = 0; i < 38; i++) {
    const a = rnd() * Math.PI * 2, r = 22 + rnd() * 185;
    groves.push({ x: HERO.x + Math.cos(a) * r, z: HERO.z + Math.sin(a) * r, r: 10 + rnd() * 24 });
  }
  const inst = [[], []];
  let placed = 0, tries = 0;
  while (placed < 2600 && tries < 120000) {
    tries++;
    const g = groves[(rnd() * groves.length) | 0];
    const x = g.x + grnd() * g.r;
    const z = g.z + grnd() * g.r;
    if (Math.abs(x) > S - 8 || Math.abs(z) > S - 8) continue;
    if (Math.hypot(x - HERO.x, z - HERO.z) < 11) continue;             // clearing around hero
    if (slopeAt(x, z) > 7) continue;
    const v = rnd() < 0.55 ? 0 : 1;
    const a = rnd() * Math.PI * 2, qy = Math.sin(a / 2), qw = Math.cos(a / 2);
    const s = 0.75 + rnd() * 0.7;
    inst[v].push(x, groundY(x, z) - 0.15, z, 0, qy, 0, qw, s, 0);
    placed++;
  }

  const groveNodes = [];
  for (let v = 0; v < TREES.length; v++) {
    if (!inst[v].length) continue;
    const buf = new Float32Array(inst[v]);
    groveNodes.push(scene.createInstancedMesh({
      mesh: TREES[v].branch, instancesFromTransforms: buf,
      color: branchColor, metallic: 0, roughness: 0.9,
      castsShadow: true, receivesShadow: true,
    }));
    groveNodes.push(scene.createInstancedMesh({
      mesh: TREES[v].leaves, instancesFromTransforms: buf,
      color: leafColors[v], metallic: 0, roughness: 0.85,
      twoSided: true, subsurface: 0.22,            // subtle golden-hour backlit glow
      castsShadow: true, receivesShadow: true,
    }));
  }
  function setGrovesVisible(v) { for (const n of groveNodes) n.visible = v; }

  // ---- hero tree as growth stages (for the "grown by simulation" beat) -----
  // Bake the same proven plant at increasing step counts, each scaled by ONE
  // constant factor (from the final stage) so later stages are genuinely taller
  // — a real time-lapse of the simulation, not a uniform-height swap. The crown
  // grows wide/flat, so pull it in horizontally to a fuller, rounder crown.
  const HSPEC = { seed: 0xC0FFEE, species: SPECIES[0].species };
  const HLO = { lw: 0.12, ll: 0.19, bs: 1.3, pul: 280, mr: 0.16 };
  const heroY = groundY(HERO.x, HERO.z) - 0.2;
  const finalRaw = bakeTree(HSPEC, 160, 0, HLO, false);
  const fbb = finalRaw.branch.computeBBox();
  const HK = 5.6 / Math.max(0.001, fbb.max[1] - fbb.min[1]);
  function placeStage(raw) {
    const minY = raw.branch.computeBBox().min[1];
    for (const m of [raw.branch, raw.leaves]) {
      m.scale(HK, HK, HK); m.translate(0, -minY * HK, 0); m.scale(0.6, 1.0, 0.6);
    }
    const bn = scene.createMesh({ data: raw.branch, x: HERO.x, y: heroY, z: HERO.z,
      color: branchColor, metallic: 0, roughness: 0.9, castsShadow: true, receivesShadow: true });
    const ln = scene.createMesh({ data: raw.leaves, x: HERO.x, y: heroY, z: HERO.z,
      color: [0.22, 0.42, 0.11], metallic: 0, roughness: 0.85,
      twoSided: true, subsurface: 0.25, castsShadow: true, receivesShadow: true });
    bn.visible = false; ln.visible = false;
    return { branch: bn, leaves: ln };
  }
  const HERO_STEPS = [12, 26, 44, 66, 95, 130, 160];
  const heroStages = HERO_STEPS.map((st) =>
    placeStage(st === 160 ? finalRaw : bakeTree(HSPEC, st, 0, HLO, false)));
  let heroShown = heroStages.length - 1;
  heroStages[heroShown].branch.visible = true;
  heroStages[heroShown].leaves.visible = true;
  // p in [0,1] -> which growth stage is visible. p>=1 shows the full tree.
  function setHeroGrowth(p) {
    let idx = Math.floor(p * heroStages.length);
    if (idx < 0) idx = 0; else if (idx > heroStages.length - 1) idx = heroStages.length - 1;
    if (idx === heroShown) return;
    heroStages[heroShown].branch.visible = false; heroStages[heroShown].leaves.visible = false;
    heroStages[idx].branch.visible = true; heroStages[idx].leaves.visible = true;
    heroShown = idx;
  }

  // ---- boulders: THOUSANDS of real Jolt rigid bodies -----------------------
  // A deterministic sandbox world: static mesh collider for the terrain + a few
  // thousand rock bodies that rain down across the hillside (staggered heights
  // so it's a sustained cascade) and tumble/pile. All rendered through ONE
  // InstancedMeshNode whose per-instance transforms are rewritten every frame
  // from the world's bulk getAllTransforms() — one draw call for the lot.
  const NB = 3000;
  const phys = Physics.createWorldHandle({ maxBodies: NB + 16, gravity: { x: 0, y: -9.81, z: 0 } });
  phys.createBody({ shape: 'mesh', static: true,
    positions: new Float32Array(positions), indices: new Uint32Array(indices) });

  const rockMesh = Mesh.rock(1.0, 4242, 2);          // unit rock; per-instance scale sizes it
  const bScale = new Float32Array(NB);
  const bInit  = new Float32Array(NB * 9);
  const tagToIdx = {};
  for (let i = 0; i < NB; i++) {
    const ang = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.5) * 70;   // wide swath
    const x = HERO.x + Math.cos(ang) * r, z = HERO.z + Math.sin(ang) * r;
    const rr = 0.32 + rnd() * 0.8;
    const dropY = groundY(x, z) + 9 + rnd() * 48;     // staggered -> rains over time
    bScale[i] = rr;
    const o = i * 9;
    bInit[o] = x; bInit[o + 1] = dropY; bInit[o + 2] = z;
    bInit[o + 3] = 0; bInit[o + 4] = 0; bInit[o + 5] = 0; bInit[o + 6] = 1;
    bInit[o + 7] = rr; bInit[o + 8] = 0;
    const tag = phys.createBody({ shape: 'sphere', radius: rr, layer: 'moving',
      position: { x, y: dropY, z }, friction: 0.7, restitution: 0.18 });
    phys.setAngularVelocity(tag, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6);
    tagToIdx[tag] = i;
  }
  const boulderNode = scene.createInstancedMesh({
    mesh: rockMesh, instancesFromTransforms: bInit,
    color: [0.46, 0.42, 0.36], metallic: 0, roughness: 0.95,
    castsShadow: true, receivesShadow: true,
  });
  boulderNode.visible = false;
  const bBuf = new Float32Array(NB * 9);
  function showBoulders() { boulderNode.visible = true; }
  function stepBoulders(dt) {
    phys.step(dt * 0.5); phys.step(dt * 0.5);          // 2 substeps for stability
    const all = phys.getAllTransforms();               // [tag,px,py,pz,qx,qy,qz,qw]*
    for (let k = 0; k < all.length; k += 8) {
      const idx = tagToIdx[all[k] | 0];
      if (idx === undefined) continue;                 // skip the static terrain body
      const o = idx * 9;
      bBuf[o] = all[k + 1]; bBuf[o + 1] = all[k + 2]; bBuf[o + 2] = all[k + 3];
      bBuf[o + 3] = all[k + 4]; bBuf[o + 4] = all[k + 5]; bBuf[o + 5] = all[k + 6]; bBuf[o + 6] = all[k + 7];
      bBuf[o + 7] = bScale[idx]; bBuf[o + 8] = 0;
    }
    boulderNode.setInstancesFromTransforms(bBuf);
  }

  // ---- groundcover: instanced grass tufts + wildflowers --------------------
  // Keeps the ground from ever reading as an empty gradient. A grass "tuft" is
  // 3 crossed tapered blades; a flower is a tiny crossed billboard of colour.
  // Both are hardware-instanced (a handful of draw calls for thousands).
  function makeGrassTuft() {
    const pos = [], nrm = [], idx = []; let base = 0;
    const blades = 5, h = 0.26, w = 0.16;
    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * Math.PI + 0.3 * b;
      const px = -Math.sin(a), pz = Math.cos(a);   // width axis
      const dx = Math.cos(a),  dz = Math.sin(a);   // lean direction
      const hw = w * 0.5, tw = w * 0.12, lean = h * 0.2;
      pos.push(-px * hw, 0, -pz * hw,   px * hw, 0, pz * hw,
               -px * tw + dx * lean, h, -pz * tw + dz * lean,
                px * tw + dx * lean, h,  pz * tw + dz * lean);
      for (let k = 0; k < 4; k++) nrm.push(px * 0.2, 0.96, pz * 0.2);
      idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
      base += 4;
    }
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm),
                      indices: new Uint32Array(idx) });
  }
  function makeFlower(h, w) {
    const pos = [], nrm = [], idx = []; let base = 0;
    for (let q = 0; q < 2; q++) {
      const a = q * Math.PI / 2, px = Math.cos(a), pz = Math.sin(a), hw = w * 0.5;
      pos.push(-px * hw, h * 0.55, -pz * hw,  px * hw, h * 0.55, pz * hw,
               -px * hw, h,        -pz * hw,  px * hw, h,        pz * hw);
      for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
      idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
      base += 4;
    }
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm),
                      indices: new Uint32Array(idx) });
  }

  const grassInst = [], flowerInst = [[], [], []];
  const FC = [[0.95, 0.92, 0.82], [0.95, 0.80, 0.28], [0.82, 0.46, 0.58]]; // white, gold, pink
  let gc = 0, gt = 0;
  while (gc < 60000 && gt < 800000) {
    gt++;
    const a = rnd() * Math.PI * 2, rr = Math.pow(rnd(), 0.6) * 150;   // denser near the stage
    const x = HERO.x + Math.cos(a) * rr, z = HERO.z + Math.sin(a) * rr;
    if (Math.abs(x) > S - 6 || Math.abs(z) > S - 6) continue;
    if (slopeAt(x, z) > 9) continue;
    const y = groundY(x, z);
    const ya = rnd() * Math.PI * 2, qy = Math.sin(ya / 2), qw = Math.cos(ya / 2);
    grassInst.push(x, y - 0.02, z, 0, qy, 0, qw, 0.75 + rnd() * 0.9, 0);
    // flowers in loose patches (noise-gated) so they cluster, not pepper evenly
    if (fbm(x * 0.12 + 50, z * 0.12 + 20) > 0.62 && rnd() < 0.4) {
      const c = (rnd() * 3) | 0;
      flowerInst[c].push(x, y, z, 0, qy, 0, qw, 0.7 + rnd() * 0.5, 0);
    }
    gc++;
  }
  scene.createInstancedMesh({
    mesh: makeGrassTuft(), instancesFromTransforms: new Float32Array(grassInst),
    color: [0.24, 0.35, 0.13], metallic: 0, roughness: 0.9,    // matches terrain grass
    twoSided: true, subsurface: 0.15, castsShadow: false, receivesShadow: true,
  });
  for (let c = 0; c < 3; c++) {
    if (!flowerInst[c].length) continue;
    scene.createInstancedMesh({
      mesh: makeFlower(0.22, 0.13), instancesFromTransforms: new Float32Array(flowerInst[c]),
      color: FC[c], metallic: 0, roughness: 0.7,
      twoSided: true, castsShadow: false, receivesShadow: false,
    });
  }

  // ---- lights --------------------------------------------------------------
  scene.setShadowQuality(4096, 3);
  const sun = scene.createLight({
    type: 'directional',
    direction: [-0.5, -0.32, 0.55],     // low, golden-hour rake (long shadows)
    color: [1.0, 0.74, 0.44], intensity: 3.4, name: 'sun',
  });
  sun.castsShadow = true;
  sun.cascadeCount = 4;
  sun.cascadeSplitLambda = 0.88;
  scene.createLight({
    type: 'directional',
    direction: [0.45, -0.3, -0.4],
    color: [0.40, 0.52, 0.78], intensity: 0.5, name: 'skyfill',
  });

  // ---- post ----------------------------------------------------------------
  // Restrained bloom — only the sun glint on water + rim-lit leaves should
  // bloom, never a wall of blobs. No tilt-shift (that's the toy-diorama look we
  // dropped); a mild DoF is added per-beat by the studio if wanted.
  scene.setBloom({ enabled: true, threshold: 1.15, intensity: 0.45, strength: 2.2 });
  scene.setTiltShift({ enabled: false });
  scene.setWind({ direction: [0.7, 0, 0.3], strength: 0.06, frequency: 1.1 });

  // ---- motion --------------------------------------------------------------
  let clock = 0;
  function tick(dt) {
    clock += dt;
    sun.direction = [-0.5, -0.32 + Math.sin(clock * 0.04) * 0.025, 0.55];
  }

  return { scene, W, H, tick, sun, groundY, HERO, S,
           setHeroGrowth, heroStages, setGrovesVisible,
           showBoulders, stepBoulders, phys };
};
