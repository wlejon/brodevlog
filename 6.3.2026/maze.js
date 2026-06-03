// Maze world (devlog): a maze that builds and solves itself, rendered by the
// engine's scene graph. ONE focused thread — procedural generation + graph
// search — shown end to end:
//
//   carve   a recursive-backtracker tunnels the grid; walls rise from the floor
//   flood   a breadth-first search floods the corridors (HDR per-instance tint)
//   solve   the shortest path entrance->exit ignites gold; an orb runs it
//   dive    (camera work lives in studio.js)
//
// buildMaze() returns the scene plus per-front hooks the studio drives. All
// geometry is deterministic (fixed RNG) so captures are stable. Every wall is
// one instance in a single hardware-instanced draw; so is every floor tile —
// and a floor tile's brightness is its per-instance RGB tint, pushed above 1.0
// so the flood wavefront blooms.

globalThis.buildMaze = function buildMaze() {
  const canvas = document.getElementById('stage');
  const W = canvas.width  = 1080;
  const H = canvas.height = 1920;
  const scene = canvas.getContext('scene');

  // ---- grid + world mapping -------------------------------------------------
  const CW = 16, CH = 16;                 // maze cells
  const GW = 2 * CW + 1, GH = 2 * CH + 1; // wall grid (odd = passage, even = wall)
  const CS = 1.7;                         // grid-cell size in world units
  const WH = 2.7;                         // wall height
  const HX = (GW - 1) / 2, HZ = (GH - 1) / 2;
  const wx = (gx) => (gx - HX) * CS;
  const wz = (gy) => (gy - HZ) * CS;
  const gi = (gx, gy) => gy * GW + gx;
  const span = GW * CS;                    // ~57 world units across

  // deterministic RNG
  let seed = 0x1a2b3c;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  // ---- recursive-backtracker carve -----------------------------------------
  const solid = new Uint8Array(GW * GH).fill(1);   // 1 = wall, 0 = open
  const visitOrder = new Int32Array(GW * GH).fill(-1);
  let order = 0;
  const open = (gx, gy) => { const k = gi(gx, gy); if (solid[k]) { solid[k] = 0; visitOrder[k] = order++; } };

  const cellSeen = new Uint8Array(CW * CH);
  const cursorWalk = [];                            // dense walk of the carve head
  const pushHead = (i, j) => cursorWalk.push({ x: wx(2 * i + 1), z: wz(2 * j + 1) });
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  cellSeen[0] = 1; open(1, 1);
  const st = [[0, 0]];
  while (st.length) {
    const [i, j] = st[st.length - 1];
    pushHead(i, j);
    const cands = [];
    for (const [di, dj] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (ni >= 0 && ni < CW && nj >= 0 && nj < CH && !cellSeen[nj * CW + ni]) cands.push([ni, nj, di, dj]);
    }
    if (!cands.length) { st.pop(); continue; }
    const [ni, nj, di, dj] = cands[(rnd() * cands.length) | 0];
    cellSeen[nj * CW + ni] = 1;
    open(2 * i + 1 + di, 2 * j + 1 + dj);   // knock the wall between
    open(2 * ni + 1, 2 * nj + 1);            // the new passage cell
    st.push([ni, nj]);
  }
  const maxOrder = Math.max(1, order - 1);
  // entrance + exit mouths through the outer wall
  open(1, 0); open(GW - 2, GH - 1);

  // ---- BFS distance field + shortest path ----------------------------------
  // start = top-left cell, exit = bottom-right cell. 4-neighbour over open cells.
  const sK = gi(1, 1), eK = gi(GW - 2, GH - 2);
  const dist = new Int32Array(GW * GH).fill(-1);
  const parent = new Int32Array(GW * GH).fill(-1);
  let q = [sK]; dist[sK] = 0;
  let maxDist = 0;
  while (q.length) {
    const next = [];
    for (const k of q) {
      const gx = k % GW, gy = (k / GW) | 0;
      if (dist[k] > maxDist) maxDist = dist[k];
      for (const [dx, dy] of DIRS) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
        const nk = gi(nx, ny);
        if (solid[nk] || dist[nk] >= 0) continue;
        dist[nk] = dist[k] + 1; parent[nk] = k; next.push(nk);
      }
    }
    q = next;
  }
  // backtrack the solution
  const pathK = [];
  for (let k = eK; k >= 0; k = parent[k]) { pathK.push(k); if (k === sK) break; }
  pathK.reverse();
  const onPath = new Uint8Array(GW * GH);
  const pathNorm = new Float32Array(GW * GH).fill(-1);
  pathK.forEach((k, idx) => { onPath[k] = 1; pathNorm[k] = idx / Math.max(1, pathK.length - 1); });
  const path = pathK.map((k) => ({ gx: k % GW, gy: (k / GW) | 0, x: wx(k % GW), z: wz((k / GW) | 0) }));

  // ---- wall rise schedule ---------------------------------------------------
  // each solid cell rises when the carve front reaches an adjacent open cell.
  const riseT = new Float32Array(GW * GH).fill(1);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const k = gi(gx, gy);
    if (!solid[k]) continue;
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
      const o = visitOrder[gi(nx, ny)];
      if (o >= 0 && o < best) best = o;
    }
    riseT[k] = (best === Infinity ? 0 : best / maxOrder);
  }

  // ---- ground ---------------------------------------------------------------
  scene.setToneMap({ mode: 'aces', exposure: 1.05, gamma: 2.2 });
  scene.setAmbient([0.05, 0.06, 0.09]);
  scene.setFog({ start: span * 0.9, end: span * 2.6, color: [0.02, 0.03, 0.06] });

  const ground = scene.createMesh({
    data: Mesh.box(span * 0.62, 0.5, span * 0.62),
    x: 0, y: -0.5, z: 0,
    color: [0.05, 0.06, 0.10], metallic: 0.0, roughness: 0.85,
    castsShadow: false, receivesShadow: true,
  });

  // ---- wall instances -------------------------------------------------------
  const wallCells = [];
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++)
    if (solid[gi(gx, gy)]) wallCells.push({ gx, gy, k: gi(gx, gy) });
  const NW = wallCells.length;
  const wallBuf = new Float32Array(NW * 16);
  const WALL_RGB = [0.13, 0.16, 0.24];
  function writeWall(slot, c, h) {
    const o = slot * 16, sxz = CS;
    const hh = Math.max(0.0001, h);
    // a low rim of warm light along the very top edge as it settles in
    wallBuf[o] = sxz; wallBuf[o + 1] = 0;  wallBuf[o + 2] = 0;   wallBuf[o + 3] = wx(c.gx);
    wallBuf[o + 4] = 0;  wallBuf[o + 5] = hh; wallBuf[o + 6] = 0; wallBuf[o + 7] = hh / 2;
    wallBuf[o + 8] = 0;  wallBuf[o + 9] = 0;  wallBuf[o + 10] = sxz; wallBuf[o + 11] = wz(c.gy);
    wallBuf[o + 12] = 1; wallBuf[o + 13] = 1; wallBuf[o + 14] = 1; wallBuf[o + 15] = 1;
  }
  wallCells.forEach((c, s) => writeWall(s, c, 0));
  const wallNode = scene.createInstancedMesh({
    mesh: Mesh.box(0.5, 0.5, 0.5), instances: wallBuf,
    color: WALL_RGB, metallic: 0.0, roughness: 0.7,
    castsShadow: true, receivesShadow: true,
  });

  // ---- floor-tile instances (one per open cell; per-instance HDR tint) ------
  const floorCells = [];
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const k = gi(gx, gy);
    if (solid[k]) continue;
    floorCells.push({
      gx, gy, k,
      revealN: visitOrder[k] >= 0 ? visitOrder[k] / maxOrder : 0,
      distN: dist[k] >= 0 ? dist[k] / Math.max(1, maxDist) : 0,
    });
  }
  const NF = floorCells.length;
  const floorBuf = new Float32Array(NF * 16);
  const TILE = CS * 0.94, FY = 0.09, FTHK = 0.18;   // low glowing curbs (read at any angle)
  const DIM = [0.05, 0.08, 0.16];   // unlit base before the flood
  function writeFloor(slot, c, rgb, shown) {
    const o = slot * 16, s = shown ? TILE : 0.0001;
    floorBuf[o] = s; floorBuf[o + 1] = 0; floorBuf[o + 2] = 0;     floorBuf[o + 3] = wx(c.gx);
    floorBuf[o + 4] = 0; floorBuf[o + 5] = FTHK; floorBuf[o + 6] = 0; floorBuf[o + 7] = FY;
    floorBuf[o + 8] = 0; floorBuf[o + 9] = 0; floorBuf[o + 10] = s;  floorBuf[o + 11] = wz(c.gy);
    floorBuf[o + 12] = rgb[0]; floorBuf[o + 13] = rgb[1]; floorBuf[o + 14] = rgb[2]; floorBuf[o + 15] = 1;
  }
  floorCells.forEach((c, s) => writeFloor(s, c, DIM, false));
  const floorNode = scene.createInstancedMesh({
    mesh: Mesh.box(0.5, 0.5, 0.5), instances: floorBuf,
    color: [1, 1, 1], unlit: true,
    castsShadow: false, receivesShadow: false,
  });

  // ---- cursor + orb (small emissive markers) --------------------------------
  const cursor = scene.createMesh({
    data: Mesh.sphere(0.45, 20, 14), x: 0, y: 0.7, z: 0,
    color: [0.2, 1.0, 1.2], emissive: 4.0, emissiveColor: [0.25, 1.6, 2.2], unlit: true,
  });
  cursor.visible = false;
  const orb = scene.createMesh({
    data: Mesh.sphere(0.5, 22, 16), x: 0, y: 0.7, z: 0,
    color: [1.0, 0.8, 0.3], emissive: 5.0, emissiveColor: [3.0, 2.0, 0.6], unlit: true,
  });
  orb.visible = false;

  // ---- lights ---------------------------------------------------------------
  scene.setShadowQuality(4096, 3);
  const key = scene.createLight({
    type: 'directional', direction: [-0.55, -0.62, 0.32],
    color: [0.78, 0.85, 1.02], intensity: 2.5, name: 'key',
  });
  key.castsShadow = true; key.cascadeCount = 4; key.cascadeSplitLambda = 0.85;
  scene.createLight({
    type: 'directional', direction: [0.5, -0.35, -0.45],
    color: [0.30, 0.40, 0.62], intensity: 0.45, name: 'fill',
  });

  // ---- post -----------------------------------------------------------------
  scene.setBloom({ enabled: true, threshold: 0.85, intensity: 0.95, strength: 2.9 });
  scene.setTiltShift({ enabled: false });

  // ---- colour ramps ---------------------------------------------------------
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
  // distance ramp (HDR): cyan near the source -> indigo -> magenta far away
  const FLOOD = [[0.26, 2.00, 2.90], [0.45, 0.70, 3.00], [1.50, 0.40, 2.55], [2.50, 0.50, 1.60]];
  function floodColor(d) {
    const s = clamp01(d) * (FLOOD.length - 1);
    const k = Math.min(FLOOD.length - 2, Math.floor(s));
    return mix3(FLOOD[k], FLOOD[k + 1], s - k);
  }
  const GOLD = [3.4, 2.30, 0.65];

  // ---- per-front hooks (driven by the studio) -------------------------------
  // Track current visual state so flood/solution can layer over the dim base.
  let floodP = 0, solP = 0;

  // ACT 1: carve. Walls rise + floor tiles appear, following the DFS order.
  const RISE = 0.10;   // a wall takes this fraction of the act to rise
  function setBuildFront(p) {
    for (let s = 0; s < NW; s++) {
      const c = wallCells[s];
      const lp = clamp01((p - riseT[c.k]) / RISE);
      writeWall(s, c, WH * (lp * lp * (3 - 2 * lp)));
    }
    wallNode.setInstances(wallBuf);
    for (let s = 0; s < NF; s++) {
      const c = floorCells[s];
      writeFloor(s, c, DIM, p >= c.revealN);
    }
    floorNode.setInstances(floorBuf);
  }

  // ACT 2: flood. Cells within the front light up; the leading edge is hottest.
  function paintFloor() {
    const floodDim = 1 - 0.55 * solP;   // flood recedes as the solution ignites
    for (let s = 0; s < NF; s++) {
      const c = floorCells[s];
      let rgb = DIM;
      if (floodP > 0 && c.distN <= floodP) {
        const edge = floodP - c.distN;                  // 0 at the wavefront
        const hot = (0.6 + 1.15 * Math.exp(-edge * 7)) * floodDim; // brighter at the edge
        const base = floodColor(c.distN);
        rgb = [base[0] * hot, base[1] * hot, base[2] * hot];
      }
      // the solution overrides flood colour with gold
      if (solP > 0 && onPath[c.k] && pathNorm[c.k] <= solP) {
        const lead = solP - pathNorm[c.k];
        const hot = 0.6 + 1.1 * Math.exp(-lead * 9);
        rgb = [GOLD[0] * hot, GOLD[1] * hot, GOLD[2] * hot];
      }
      writeFloor(s, c, rgb, true);
    }
    floorNode.setInstances(floorBuf);
  }
  function setFloodFront(p) { floodP = clamp01(p); paintFloor(); }
  function setSolutionFront(p) {
    solP = clamp01(p);
    paintFloor();
    const idx = Math.min(path.length - 1, Math.max(0, Math.round(solP * (path.length - 1))));
    return path[idx];
  }

  function setCursor(on, x, z) { cursor.visible = on; if (on) { cursor.x = x; cursor.z = z; } }
  function moveOrb(on, x, z, y) { orb.visible = on; if (on) { orb.x = x; orb.z = z; orb.y = y == null ? 0.7 : y; } }

  function cursorAt(p) {
    const f = clamp01(p) * (cursorWalk.length - 1);
    const k = Math.min(cursorWalk.length - 2, Math.floor(f)), t = f - k;
    const a = cursorWalk[k], b = cursorWalk[k + 1];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  // min-map grid (for the studio's Canvas-2D overlay): -1 wall, else dist 0..1
  const floodGrid = new Float32Array(GW * GH).fill(-1);
  for (let k = 0; k < GW * GH; k++) if (!solid[k] && dist[k] >= 0) floodGrid[k] = dist[k] / Math.max(1, maxDist);

  function tick() { /* deterministic — nothing to advance */ }

  return {
    scene, W, H, tick,
    CW, CH, GW, GH, CS, WH, span, wx, wz, gi, solid,
    startWorld: { x: wx(1), z: wz(1) }, exitWorld: { x: wx(GW - 2), z: wz(GH - 2) },
    path, floodGrid, onPath, pathNorm,
    setBuildFront, setFloodFront, setSolutionFront,
    setCursor, moveOrb, cursorAt,
  };
};
