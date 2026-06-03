// Fast visual calibration (no TTS). Builds the maze, reveals it, and shoots a
// few stills at the act camera framings so we can tune look/framing quickly.
const W = 1080, H = 1920;
const maze = buildMaze();
const { scene, path, span } = maze;

function cam(c) {
  scene.setCamera({ fov: c.fov, aspect: W / H, near: 0.3, far: 1200,
    position: c.pos, target: c.tgt, up: [0, 1, 0] });
}
const lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

const TOP = span * 1.18, HI = span * 1.46;

// 0. mid-carve — confirm no flat overlapping shapes on the plane
maze.setBuildFront(0.4);
const cw = maze.cursorAt(0.4); maze.setCursor(true, cw.x, cw.z);
cam({ pos: [0, HI, TOP * 0.9], tgt: [0, 1.5, 0], fov: 46 });
flush(); screenshot('probe_0_carve.png');
maze.setCursor(false, 0, 0);

// 1. carve done, dim floor — framing + legibility
maze.setBuildFront(1);
cam({ pos: [0, HI, TOP * 0.9], tgt: [0, 1.5, 0], fov: 46 });
flush(); screenshot('probe_1_built.png');

// 2. flood mid-sweep — wavefront glow / bloom
maze.setFloodFront(0.6);
cam({ pos: [0, HI * 0.92, TOP * 0.86], tgt: [0, 1.0, 0], fov: 45 });
flush(); screenshot('probe_2_flood.png');

// 3. solution ignited
maze.setFloodFront(1);
const o = maze.setSolutionFront(1);
maze.moveOrb(true, o.x, o.z, 0.7);
cam({ pos: [maze.startWorld.x * 0.5, HI * 0.66, TOP * 0.6],
      tgt: [maze.startWorld.x * 0.3, 0.5, maze.startWorld.z * 0.3], fov: 42 });
flush(); screenshot('probe_3_solved.png');

// 4. dive — low chase a few cells behind the orb
const n = path.length, pathAt = (fp) => {
  const c = Math.max(0, Math.min(n - 1, fp)), i = Math.min(n - 2, Math.floor(c));
  return lerpPt(path[i], path[i + 1], c - i);
};
// 4. dive — pulled-out isometric follow: far enough that the orb's run reads as
// a subtle glide, not a fast scroll. Compare a few distances.
function isoShot(uf, ox, hy, oz, fov, name) {
  const o = pathAt(uf * (n - 1));
  maze.moveOrb(true, o.x, o.z, 0.7);
  cam({ pos: [o.x + ox, hy, o.z + oz], tgt: [o.x, 0.4, o.z], fov });
  flush(); screenshot(name);
}
// final framing (matches studio.js: offset 15->19 drifting out over the act)
isoShot(0.15, 15, 30, 15, 46, 'probe_4_dive.png');
isoShot(0.55, 17, 33.5, 17, 46, 'probe_5_dive.png');
isoShot(0.90, 19, 37, 19, 46, 'probe_6_dive.png');

console.log('probe done: span=' + span.toFixed(1) + ' pathLen=' + path.length);
