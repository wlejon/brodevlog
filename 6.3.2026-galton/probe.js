// Fast calibration (no TTS): a DENSE pour. Marbles fall as a curtain from a
// small centre hopper, jostling each other through the lattice into a clean
// physical bell. Shoots stills at cascade / mid / settled and reports settle%
// + the final shape, so we can lock the pour before the full TTS render.
const HOP = 0.4;                       // narrow hopper -> cleaner peak
const board = buildBoard({ jitter: HOP });
const { scene, W, H, step, sync, releaseBall, binCounts } = board;

function cam(c) {
  scene.setCamera({ fov: c.fov, aspect: W / H, near: 0.3, far: 200,
    position: c.pos, target: c.tgt, up: [0, 1, 0] });
}
const midY = (board.topY + 3 + board.floorY) * 0.5;
const FULL = { pos: [0, midY, 44], tgt: [0, midY, 0], fov: 42 };
const BINS = { pos: [0, (board.binTopY + board.floorY) * 0.5 + 2, 38],
               tgt: [0, (board.binTopY + board.floorY) * 0.5 + 2, 0], fov: 41 };

const NB = board.NB;
const FPS = 60, DT = 1 / FPS;
let frame = 0, relAccum = 0;
const RATE = 9;                        // marbles per sim-second (drain-safe)
function run(frames, releasing) {
  for (let f = 0; f < frames; f++) {
    if (releasing) { relAccum += DT * RATE; while (relAccum >= 1 && board.released < NB) { releaseBall(); relAccum -= 1; } }
    step(DT); frame++;
  }
}

cam(FULL);
run(120, true); sync(); flush(); screenshot('probe_a_cascade1.png');
run(240, true); sync(); flush(); screenshot('probe_b_cascade2.png');
while (board.released < NB) run(6, true);
console.log('released=' + board.released + ' at frame ' + frame);
run(180, false); sync(); flush(); screenshot('probe_c_mid.png');
run(360, false); sync(); flush(); screenshot('probe_d_settle.png');
cam(BINS);   sync(); flush(); screenshot('probe_e_bins.png');

const counts = binCounts();
let line = '', total = 0, peak = 0;
for (let k = 0; k < counts.length; k++) { line += counts[k] + ' '; total += counts[k]; peak = Math.max(peak, counts[k]); }
console.log('BIN COUNTS: ' + line);
console.log('settled=' + total + '/' + NB + ' (' + (total / NB * 100 | 0) + '%)  peak=' + peak);
for (let row = peak; row > 0; row -= Math.max(1, Math.ceil(peak / 14))) {
  let s = ''; for (let k = 0; k < counts.length; k++) s += counts[k] >= row ? '#' : ' ';
  console.log('|' + s + '|');
}
console.log('PROBE DONE');
