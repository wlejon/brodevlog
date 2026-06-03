# galton — bro engine devlog video (6.3.2026)

Source for a vertical devlog built around **physics**: a **Galton board** — a peg
lattice that turns a stream of marbles into a bell curve — run as a *real*
rigid-body simulation by the engine (Jolt), not a scripted animation.

A different thread from the maze devlog (which was procedural generation + graph
search): this one is one live physics simulation, end to end, and it runs warm
(amber/coral/teal glass) where the maze ran cool neon.

Renders a ~23 s 1080×1920 30 fps WebM in four acts, each a real engine
capability:

1. **One** — a single marble is dropped into the pegs and the camera follows it
   down. At every peg it bounces left or right; nothing scripts which way — it's
   a dynamic sphere, plane-locked (2D DOF), resolved by Jolt contacts.
2. **Many** — two hundred marbles pour through the same board as a glowing
   cascade. All of them are one hardware-instanced mesh, resynced each frame from
   the physics transforms; every collision is solved by the engine.
3. **Stacks** — at the bottom they pile into bins where they land. Nothing is
   drawn into the bins — the marbles themselves *are* the histogram, stacked by
   gravity into columns.
4. **Curve** — the pile is a bell. A Gaussian is fitted live to the bin counts
   and drawn over the running histogram: random walks always land here.

Over the top: a Kokoro TTS voiceover with word-synced captions, a continuous
(brighter, major-key) music bed, a live histogram overlay (the engine's own
HTML/CSS/Canvas, composited over the 3D scene), and a soft per-impact "tick"
synthesized for every marble↔peg contact — a few gentle plinks under the lone
marble, a downpour under the cascade.

The narration is a devlog, not an ad — every line names exactly what is on
screen at that moment.

## The physics (why a Galton board is finicky, and how this one works)

A faithful rigid-body Galton board does not just fall out of "spheres + pegs".
The tuning that makes the pile land as a clean centred bell:

- **Rectangular quincunx grid + reflecting side walls.** A triangular peg array
  funnels drifting marbles into its corners (the outer flanks are absorbing); a
  rectangular grid wider than the natural spread, with vertical walls that
  *reflect* drifters back toward centre, lets the pile settle as a bell.
- **Marbles roll, but the stream decorrelates them.** A lone marble is nearly
  deterministic; the fair per-row "coin flip" comes from ball-ball collisions in
  a dense stream. So the curve emerges from *many* marbles, not one.
- **Drain-safe feed.** The lattice only passes ~10 marbles / sim-second; pour
  faster and it clogs. The studio therefore runs the physics *faster than real
  time* during the cascade (an energetic pour) while feeding at the drain-safe
  rate, then eases toward slow motion for the bell-curve payoff.

Capture is deterministic: a manually-stepped `Physics.createWorldHandle` sandbox
world, fixed RNG, fixed substep — the same render every time.

## Files

| File         | Role |
|--------------|------|
| `bro.json`   | App manifest (1080×1920 portrait). |
| `index.html` | The DOM — `<canvas>` scene layer plus the caption and histogram overlays. Loads `board.js`. |
| `board.js`   | `buildBoard()` — the sandbox physics world (pegs, bins, reflecting walls), the instanced peg/divider/marble meshes, marble release + the per-frame transform→instance sync, the bin counter, and `pollPegHits()` (marble↔peg contacts, drained per substep, for the impact sounds). All physics tunables are overridable for calibration. |
| `studio.js`  | The director — the acts/beats, TTS + captions + music + synthesized peg-impact clicks, the four camera moves, the variable sim-speed + release schedule, the live histogram + fitted Gaussian, captured via `addViewportFrame`. |
| `probe.js`   | Fast no-TTS calibration: pours the board and shoots stills + prints the bin counts, to tune the look and confirm the bell before a full render. |

## Requirements

- A built **`bro-headless`** (GPU; CUDA is used for the Kokoro TTS).
- The **`brosoundml`** sibling repo with the Kokoro weights under
  `weights/kokoro/`. `studio.js` resolves them with
  `bro.tts.setAssetRoot('../brosoundml')`, so the render must run from the
  **`bro` repo root** with `brosoundml` as its sibling.

## Render

From the `bro` repo root, pass this folder as both the app dir and the script:

```bash
./build/Release/bro-headless.exe <this-folder> <this-folder>/studio.js
```

The output `galton.webm` is written to the current working directory.
