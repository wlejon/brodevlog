# maze — bro engine devlog video (6.3.2026)

Source for the second vertical devlog. One focused thread instead of a montage:
a **maze that builds and solves itself**, rendered in real time by the engine's
scene graph.

Renders a ~28 s 1080×1920 30 fps WebM in four acts, each a real engine
capability:

1. **Carve** — a recursive-backtracker walks a grid; the maze's walls rise out
   of the floor as the algorithm tunnels, a bright cursor leading the front.
   Every wall is one instance in a single hardware-instanced draw.
2. **Flood** — a breadth-first search floods the corridors from the entrance;
   each floor cell lights with an HDR colour ramped by its distance, so a glowing
   wavefront sweeps the whole maze. The brightness is a *per-instance* tint, so
   the wavefront blooms.
3. **Solve** — the shortest path from entrance to exit ignites gold, cell by
   cell, and a glowing orb runs it.
4. **Dive** — the camera drops to the floor and flies first-person down the lit
   solution, walls towering, to the exit.

Over the top: a Kokoro TTS voiceover with word-synced captions, a continuous
music bed, and live code/min-map overlays (themselves the engine's own
HTML/CSS/JS, composited over the 3D scene).

The narration is a devlog, not an ad — every line names exactly what is on
screen at that moment.

## Files

| File         | Role |
|--------------|------|
| `bro.json`   | App manifest (1080×1920 portrait). |
| `index.html` | The DOM — `<canvas>` scene layer plus the caption, code-card, and min-map overlays. Loads `maze.js`. |
| `maze.js`    | `buildMaze()` — recursive-backtracker generation, the instanced wall + floor-tile nodes, the BFS distance field + shortest path, lights and post. Deterministic. |
| `studio.js`  | The director — the acts/beats, TTS + captions + music, the four camera moves, and the per-frame reveal of walls / flood / solution, captured via `addViewportFrame`. |

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

The output `maze.webm` is written to the current working directory.
