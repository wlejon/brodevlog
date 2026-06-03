# hero — bro engine devlog video

Source for the vertical devlog promo of the **bro** runtime. Renders a ~24 s
1080×1920 30 fps WebM: a golden-hour valley that shows off real engine features
in sequence — a noise heightfield, broflora trees grown by simulation then baked
and instanced across the hills, thousands of Jolt rigid-body boulders, and PBR
lighting with shadows + bloom. Over the top: a Kokoro TTS voiceover with
word-synced captions, a continuous music bed, and live code/heightmap overlays
(themselves the engine's own HTML/CSS/JS, composited over the 3D scene).

The narration is a devlog, not an ad — every line names exactly what is on
screen at that moment.

## Files

| File         | Role |
|--------------|------|
| `bro.json`   | App manifest (1080×1920 portrait). |
| `index.html` | The DOM — `<canvas>` scene layer plus the caption, code-card, and heightmap overlays. Loads `world.js`. |
| `world.js`   | `buildWorld()` — the scene: terrain mesh, broflora trees (hero growth stages + instanced groves), groundcover, boulders, lights, post. Deterministic geometry. |
| `studio.js`  | The director — runs as the headless script. Defines the acts/beats, synthesizes the TTS + captions + music, drives one camera move per act, and captures each frame via `VideoEncoder.addViewportFrame`. |

## Requirements

- A built **`bro-headless`** (GPU; CUDA is used for the Kokoro TTS). Built from
  the `bro` repo.
- The **`brosoundml`** sibling repo with the Kokoro weights under
  `weights/kokoro/`. `studio.js` resolves them with
  `bro.tts.setAssetRoot('../brosoundml')`, so the render must run from the
  **`bro` repo root** with `brosoundml` as its sibling.
  - Spoken compound words like "heightfield" rely on brosoundml's compound-split
    g2p fallback (commit `9484b63`); without it the TTS spells them out.

## Render

From the `bro` repo root, pass this folder as both the app dir and the script:

```bash
./build/Release/bro-headless.exe <this-folder> <this-folder>/studio.js
```

The output `hero.webm` is written to the current working directory.
