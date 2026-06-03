// Galton board world (devlog): a Galton board — a peg lattice that turns a
// stream of marbles into a bell curve, run as a REAL rigid-body simulation by
// the engine's physics (Jolt) in a manually-stepped sandbox world. ONE focused
// thread shown end to end:
//
//   one     a single marble falls; at every peg it goes left or right
//   many    hundreds are released; each takes its own random path down
//   stacks  they pile into bins at the bottom — the pile IS the histogram
//   curve   the random walks settle into a Gaussian, fitted live on top
//
// Nothing here is scripted motion: pegs are static bodies, marbles are dynamic
// spheres locked to the board plane (2D DOF), and every bounce is a solved
// contact. buildBoard() returns the scene plus the hooks the studio drives.
// Marbles render as ONE hardware-instanced mesh whose buffer we rewrite each
// frame from the physics transforms; pegs and bin walls are instanced too.

globalThis.buildBoard = function buildBoard(tune) {
  tune = tune || {};
  const T = (k, d) => (tune[k] !== undefined ? tune[k] : d);
  const canvas = document.getElementById('stage');
  const W = canvas.width  = 1080;
  const H = canvas.height = 1920;
  const scene = canvas.getContext('scene');

  // ---- geometry -------------------------------------------------------------
  // A RECTANGULAR quincunx pegboard (like a real plinko/Galton machine), NOT a
  // triangle: every row spans the full width, offset by half a spacing each
  // row, bounded by vertical side walls. The walls REFLECT marbles that drift
  // outward back toward centre (a triangle's diagonal flanks instead funnel
  // them into the corners), and the board is wider than the natural spread —
  // so the pile lands as a clean centred bell, not edge spikes.
  const COLS = T('COLS', 15); // pegs across an even row (board width)
  const ROWS = T('ROWS', 14); // peg rows
  const SP   = T('SP', 1.15); // peg spacing (world units)
  const PR   = T('PR', 0.22); // peg radius
  const BR   = T('BR', 0.27); // marble radius
  const topY = 12.0;          // y of the top peg row
  const NBINS = COLS;         // one bin per even-row column
  const lastY = topY - (ROWS - 1) * SP;      // y of last peg row
  const binTopY = lastY - 0.7;               // bins start just below last pegs
  const floorY  = binTopY - 15.0;            // deep bins so tall stacks fit
  const halfW   = (COLS * 0.5) * SP;          // side walls just outside the grid

  // ---- sandbox world (we step it ourselves, for deterministic capture) ------
  const w = Physics.createWorldHandle({ maxBodies: 8192, gravity: { x: 0, y: T('grav', -12.0), z: 0 } });

  // pegs: static spheres in a rectangular quincunx (alternate rows offset SP/2)
  const pegs = [];
  for (let r = 0; r < ROWS; r++) {
    const y = topY - r * SP;
    const odd = r & 1;
    const n = odd ? COLS - 1 : COLS;          // offset rows have one fewer peg
    for (let c = 0; c < n; c++) {
      const x = (c - (n - 1) * 0.5) * SP;      // each row centred
      pegs.push({ x, y });
      w.createBody({ shape: 'sphere', radius: PR, static: true,
        position: { x, y, z: 0 }, restitution: T('pegRest', 0.35), friction: T('pegFric', 0.2) });
    }
  }

  // bins: one per even-row column; dividers sit between them.
  const binCenter = [];
  for (let k = 0; k < NBINS; k++) binCenter.push((k - (NBINS - 1) * 0.5) * SP);
  const dividerX = [];                                   // between bins
  for (let k = 0; k < NBINS - 1; k++) dividerX.push((k + 0.5 - (NBINS - 1) * 0.5) * SP);

  // bin dividers (thin tall static boxes) + a floor
  const binHalfH = (binTopY - floorY) * 0.5;
  const binMidY  = (binTopY + floorY) * 0.5;
  for (const dx of dividerX) {
    w.createBody({ shape: 'box', static: true, restitution: 0.05, friction: 0.5,
      halfExtents: { x: 0.05, y: binHalfH, z: 1.5 }, position: { x: dx, y: binMidY, z: 0 } });
  }
  // outer side walls (full height; REFLECT drifting marbles back toward centre)
  w.createBody({ shape: 'box', static: true, friction: 0.2, restitution: 0.3,
    halfExtents: { x: 0.3, y: 18, z: 1.5 }, position: { x: -halfW - 0.3, y: 0, z: 0 } });
  w.createBody({ shape: 'box', static: true, friction: 0.2, restitution: 0.3,
    halfExtents: { x: 0.3, y: 18, z: 1.5 }, position: { x: halfW + 0.3, y: 0, z: 0 } });
  w.createBody({ shape: 'box', static: true, friction: 0.6, restitution: 0.02,
    halfExtents: { x: halfW + 0.6, y: 0.3, z: 1.5 }, position: { x: 0, y: floorY - 0.3, z: 0 } });

  // ---- visuals: back board + lights + post ----------------------------------
  scene.setToneMap({ mode: 'aces', exposure: 1.06, gamma: 2.2 });
  scene.setAmbient([0.05, 0.045, 0.06]);
  scene.setFog({ start: 60, end: 140, color: [0.02, 0.02, 0.03] });

  // the board itself — a dark slab behind everything, catches shadows
  scene.createMesh({
    data: Mesh.box(halfW * 2 + 3, (topY - floorY) + 12, 1.2),
    x: 0, y: (topY + floorY) * 0.5, z: -1.4,
    color: [0.07, 0.065, 0.09], metallic: 0.15, roughness: 0.6,
    castsShadow: false, receivesShadow: true,
  });

  scene.setShadowQuality(2048, 2);
  const key = scene.createLight({ type: 'directional', direction: [-0.35, -0.55, -0.72],
    color: [1.0, 0.95, 0.86], intensity: 2.6, name: 'key' });
  key.castsShadow = true;
  scene.createLight({ type: 'directional', direction: [0.6, -0.2, -0.5],
    color: [0.7, 0.55, 0.85], intensity: 0.5, name: 'fill' });
  scene.setBloom({ enabled: true, threshold: 0.9, intensity: 0.95, strength: 2.7 });

  // ---- peg instanced mesh (static, brushed metal) ---------------------------
  const NP = pegs.length;
  const pegBuf = new Float32Array(NP * 16);
  pegs.forEach((p, i) => {
    const o = i * 16, s = PR * 2;
    pegBuf[o] = s; pegBuf[o + 5] = s; pegBuf[o + 10] = s;
    pegBuf[o + 3] = p.x; pegBuf[o + 7] = p.y; pegBuf[o + 11] = 0;
    pegBuf[o + 12] = 0.62; pegBuf[o + 13] = 0.66; pegBuf[o + 14] = 0.78; pegBuf[o + 15] = 1;
  });
  scene.createInstancedMesh({ mesh: Mesh.sphere(0.5, 18, 14), instances: pegBuf,
    color: [1, 1, 1], metallic: 0.35, roughness: 0.4, castsShadow: true, receivesShadow: true });

  // ---- divider posts (slim emissive rails, so the bins read) ----------------
  const dvBuf = new Float32Array(dividerX.length * 16);
  dividerX.forEach((dx, i) => {
    const o = i * 16;
    dvBuf[o] = 0.10; dvBuf[o + 5] = binHalfH * 2; dvBuf[o + 10] = 0.5;
    dvBuf[o + 3] = dx; dvBuf[o + 7] = binMidY; dvBuf[o + 11] = 0;
    dvBuf[o + 12] = 0.10; dvBuf[o + 13] = 0.11; dvBuf[o + 14] = 0.16; dvBuf[o + 15] = 1;
  });
  scene.createInstancedMesh({ mesh: Mesh.box(0.5, 0.5, 0.5), instances: dvBuf,
    color: [1, 1, 1], metallic: 0.0, roughness: 0.8, castsShadow: false, receivesShadow: true });

  // ---- marble pool (created lazily on release) ------------------------------
  const NB = T('NB', 200);         // total marbles available
  const live = [];                 // { tag, col } released marbles
  const ballBuf = new Float32Array(NB * 16);
  // warm arcade palette (HDR so it blooms): amber, magenta, coral, teal, gold
  const COLORS = [
    [3.4, 1.7, 0.5], [3.0, 0.7, 1.7], [3.3, 1.0, 0.7],
    [0.6, 2.4, 2.7], [3.4, 2.3, 0.6], [2.2, 0.7, 2.8],
  ];
  const ballNode = scene.createInstancedMesh({ mesh: Mesh.sphere(0.5, 16, 12), instances: ballBuf,
    color: [1, 1, 1], unlit: true });

  let seed = 0x51f3a2;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  function releaseBall() {
    if (live.length >= NB) return null;
    const i = live.length;
    const x = (rnd() - 0.5) * T('jitter', 0.28);   // tiny jitter at the mouth
    // Marbles are plane-locked (2D) but free to ROLL: a chaotic peg contact is
    // what makes each row a fair coin. The reflecting side walls keep drifters
    // from channelling, so the dense stream's ball-ball jostling resolves into
    // a centred binomial — a real bell curve, not scripted.
    const tag = w.createBody({ shape: 'sphere', radius: BR, dofs: T('dofs', '2d'),
      position: { x, y: topY + 3.0, z: 0 },
      restitution: T('ballRest', 0.3), friction: T('ballFric', 0.2), ccd: true,
      linearDamping: T('ballDamp', 0.02), angularDamping: T('angDamp', 0.5) });
    w.setLinearVelocity(tag, 0, T('entryV', -2.0), 0);
    live.push({ tag, col: COLORS[i % COLORS.length] });
    return tag;
  }

  // ---- per-frame: step + sync instance buffer from physics -------------------
  const SUB = 4, STEPDT = 1 / 60 / SUB;
  function step(dt) {
    const n = Math.max(1, Math.round(dt / STEPDT));
    for (let s = 0; s < n; s++) w.step(STEPDT);
  }

  function sync() {
    for (let i = 0; i < live.length; i++) {
      const t = w.getTransform(live[i].tag);
      const o = i * 16, s = BR * 2, c = live[i].col;
      ballBuf[o] = s; ballBuf[o + 5] = s; ballBuf[o + 10] = s;
      ballBuf[o + 3] = t.position.x; ballBuf[o + 7] = t.position.y; ballBuf[o + 11] = t.position.z;
      ballBuf[o + 12] = c[0]; ballBuf[o + 13] = c[1]; ballBuf[o + 14] = c[2]; ballBuf[o + 15] = 1;
    }
    // park the rest (scale 0)
    for (let i = live.length; i < NB; i++) {
      const o = i * 16;
      ballBuf[o] = 0; ballBuf[o + 5] = 0; ballBuf[o + 10] = 0;
    }
    ballNode.setInstances(ballBuf);
  }

  // marble 0 position (for the single-ball follow camera)
  function ballPos(i) {
    if (i >= live.length) return { x: 0, y: topY, z: 0 };
    return w.getTransform(live[i].tag).position;
  }

  // ---- histogram: count settled marbles per bin -----------------------------
  function binCounts() {
    const counts = new Int32Array(NBINS);
    for (let i = 0; i < live.length; i++) {
      const p = w.getTransform(live[i].tag).position;
      if (p.y > binTopY + 0.3) continue;            // still up in the pegs
      // nearest bin by x
      let best = 0, bd = Infinity;
      for (let k = 0; k < NBINS; k++) { const d = Math.abs(p.x - binCenter[k]); if (d < bd) { bd = d; best = k; } }
      counts[best]++;
    }
    return counts;
  }

  return {
    scene, W, H, step, sync, releaseBall, binCounts, ballPos,
    get released() { return live.length; },
    NB, NBINS, ROWS, SP, BR, binCenter, dividerX,
    topY, lastY, binTopY, floorY, halfW,
  };
};
