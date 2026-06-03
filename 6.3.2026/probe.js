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
function diveShot(uf, name) {
  const fp = uf * (n - 1);
  const lead = pathAt(fp), back = pathAt(fp - 2.6);
  maze.moveOrb(true, lead.x, lead.z, 0.7);
  cam({ pos: [back.x, 5.5, back.z], tgt: [lead.x, 0.5, lead.z], fov: 62 });
  flush(); screenshot(name);
}
diveShot(0.32, 'probe_4_dive.png');
diveShot(0.72, 'probe_5_dive.png');

console.log('probe done: span=' + span.toFixed(1) + ' pathLen=' + path.length);
