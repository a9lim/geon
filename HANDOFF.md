# Handoff: Worldline 2.0, the second visual pass (in progress)

Written 2026-10-24 before a context compaction. Delete this file when the pass is done
(the stager never deploys a project's root HANDOFF.md).

## What this is

a9 asked for an ambitious second visual redesign pass over Worldline. I played all 24
presets, wrote a proposal with live Today/Proposed sketches, and a9 approved it:

- Proposal page (private artifact): https://claude.ai/artifact/43XdzCubub2ZEGjhvf4Csb
  ("Worldline Second Pass"). Its sources are in `docs/second-pass/sketches/`
  (`python3 build.py OUT.html` rebuilds it; the screenshot thumbs weren't kept, so
  build.py needs a `thumbs/` dir of JPEGs or the `{{THUMB:…}}` lines removed). The
  sketches are canvas toy models; `kit.js` has the reference drawing code (glyphs,
  contours, labels, the cartouche key, the scale bar).

## a9's decisions (2026-10-24)

- Trails become world lines seen from above; retire the trail pass. **Done.**
- Field lines replace the line-integral comb. **Done.**
- No labels on the canvas (body names, event names): defer to a later pass. I said I'd
  keep the plate furniture (the key, the scale bar, the "Fig. 1" caption with live
  values, event circles); a9 didn't object.
- Cut to six curated presets: cyclotron drift (opening), twin paradox, relativistic
  wheel, bremsstrahlung, Kibble–Zurek walls, microlensing. **Done.**
- This pass counts as Worldline 2.0: record it in `docs/ROADMAP.md` §6 (one grammar for
  entities, hairline rendering, fields as first-class, presets that explain themselves),
  with labels and the remaining §6 pillars listed as later.
- Commit and push the worldline submodule; stage only its pointer in the parent; do NOT
  deploy (a9 may have other agents working on the other sims in the same parent tree).

## Done (commits on worldline `main`, not pushed)

1. `75f0c4d` Keep six curated presets (presets.js, index.html options and meta, i18n en/ja,
   about.md presets prose, a `shortcut.group.presets` string).
2. `bb38fa2` Body glyphs (`particle.wgsl`): full charge ink by sign (`update-colors.wgsl`),
   +/− mark, rim tick where charged (full spoke when neutral), hollow antimatter, AA edge,
   1.25 px outline, black hole as a void (`COLOR_VOID_DARK`, faint edge in dark), spawn
   writes the true ink and horizon even paused. `ring-render.wgsl`: ergosphere fixed to
   M + √(M² − Q²) (was the uncharged horizon formula), px hairlines, selection ring
   (ringType 1, `opts.selected`); the antimatter dashed ring is gone.
3. `fa53094` Trails = world lines in the plane view: `vs_line` draws when
   `params.trails` (SpacetimeParams[26]); the flat camera sets f[10] = 0 so h doesn't
   clip. trails.wgsl, trail-render.wgsl, the trail buffers and the expansion's trail
   pass are deleted (expansion.wgsl bindings renumbered 4–6).
4. `5e0718f` Spacetime plate: cone reaches 0.3·depth, two generators from the projection's
   null direction (`towardCamera()`), back arcs dashed (`fs_cone`); `vs_event`/`fs_event`
   open circles for births during the run, deaths, merges and kicks (|Δw| > 0.15 between
   samples, local max); lines and light under the sheet of the present drawn at 0.45
   (`underSheet`, lab coordinates only); observer-coordinates refit (`spacetime.js`
   frame(): lean = tanh ψ·D·tilt, centre shifted n·lean/2, width fit); on a torus the box
   and the grid's tilted sheet are the domain's translate around the observer
   (`renderOpts.boxOrigin`, GridParams boxX/boxY, overlay `box.x0/y0`).
5. `70dacef` Photons as wave packets (`boson-render.wgsl` `fragmentPhoton`): constant
   22 px span, λ = clamp(6·√(0.05/E′), 3.5, 12) px, ochre, Doppler inks in frames.
6. `0c7803c` + `0f58c73` Fields atlas: `heatmap.wgsl` stores E (`elecField`, vec2,
   group 1 binding 5: the stage now uses exactly 10 storage buffers); a readback
   (`GPUPhysics._heatmapStaging`, `heatmapReadback`, mapped in `_mapHeatmapReadback()`
   after the frame's submit) feeds `src/field-atlas.js`, drawn on the overlay canvas:
   umber gravity contours (nice levels 1/1.5/2/3/5/7·10^k, index 1s and 3s heavier and
   labelled, downhill ticks), prussian field lines from the charges' own field (external
   E excluded: SOFTENING makes charges' fields ~0.002 vs the cyclotron's E_ext 0.12),
   lines end on meeting another (separation grid), index-level equipotentials (+ solid
   sienna, − dashed prussian), dotted viridian Yukawa. `heatmap-render.wgsl` is now ⊙⊗
   only: octave lattice, B0 = 0.1 (levels ×10), ~64 px coarse, domain only.
   `field-render.wgsl`: no wash; each side of zero hatched its own way (+ sap '/', − violet
   '\' for the Higgs; axion ochre/indigo), depth = smoothstep(0.01, 0.06, |φ|), wall at
   φ = 0, Higgs contours every v/4; axion sign from a smoothed sample (ends the maze).

SHADER_VERSION is 147.

7. `3f12cd1` Groundwork for step 8: `GPUBackend._readScene()` every 400 ms reads
   particleState + clocks into `sim.scene = { bodies: [{ alive, anti, x, y, wx, wy, m, q,
   tau }], version }` (FLAG_ALIVE = 1, FLAG_ANTIMATTER = 4); `sim.stats.radiated`. Nothing
   reads them yet.
8. `87b5d70` This file and `docs/second-pass/` (sketches, tools).

The working tree was clean at the handoff.

9. `60ff23e` Physics fixes: bounce wall (centre may cross by r, elastic beyond; the twin
   returns at 0.80c), `PHOTON_QUANTUM` 0.02 for Larmor/quadrupole photons, Higgs wall and
   v/4 contours gated on the field 2 cells away (no noise maze). SHADER_VERSION 151.
10. `0dcd516` Bremsstrahlung beam: preset `tick(sim)` hook (`sim.presetTick`, cleared by
    `reset()`), electrons m 0.3 q −1 at 0.95c every 24 from alternate sides at a q 6 m 60
    nucleus.
11. `0fee1c2` Step 8 done: `src/scene-key.js` (bottom right; G = "Rulers and key"), overlay
    scale bar (bottom left) and tilted dimension line, captions "Fig. 1." + live preset text
    (en, ja). Equipotentials one a decade and only in the Electric view.

## Remaining, in order

**8. (done) Key, scale bar, live captions.**
- Key: an HTML element `#scene-key` in `.stage` (bottom-left, above the figure bar; hide
  under ~700 px and with the grid toggle G; hairline border, `--bg-canvas` ground, no
  radius). New `src/scene-key.js` with an en/ja table like `caption.js`; rebuild the DOM
  only when the row signature changes. Rows only for what's present (kinds from
  `sim.scene`): positive / negative / neutral / antimatter (hollow) / horizon with dashed
  ergosphere (BH mode) / "a bead every N of its own time" (trails or tilted; N =
  2^round(log2(depth/14))) / light as wave packets (radiation on) / the red body's past
  light cone and an event circle (tilted) / Fields layers when on (gravity contours ticked
  downhill, field lines, ± equipotentials, ⊙⊗, Yukawa) / Higgs +v and −v hatched with the
  wall / uniform external B or E with value and direction / the selected body. Swatches as
  inline SVG using `var(--ink-*)`, `var(--text-muted)`, `var(--accent)`.
- Scale bar: overlay canvas, plane view, bottom-right of the stage, 1-2-5 snap, label
  "length, c = 1" (see `scaleBar` in `docs/second-pass/sketches/kit.js`). Tilted: a
  dimension line along the box's front edge in `Overlay._drawBox` (the edge away from
  the time axis's corner; ticks every step, labels 0, mid, end).
- Captions (`src/caption.js`): title "Fig. 1. {preset}." (ja "図1 {preset}。"); plane-view
  text per preset with live values instead of the static desc:
  cyclotron (drift E×B/B² from `gp._extElectric/_extBz`), twin (traveller's and home's τ
  from `sim.scene` slots 1 and 0, the traveller's speed and γ), wheel (moving wheel's
  speed and γ, both clocks' τ), bremsstrahlung (`sim.stats.radiated`), Kibble–Zurek
  (`gp._higgsQuench` {tau, t0}, `gp.simTime`: before vs after the transition at τ_Q),
  microlensing (θ_E = √(4MD), μ from `gp.lensHits.magnification`, the star's offset in
  θ_E from `sim.lens.star` and the lens body). Keep the selected-body suffix. en + ja.
- Preset tuning to check while here: bremsstrahlung shows the nucleus only after a few
  seconds and emits ~4 photons (E ≈ 0.05); consider Fields on (field lines show the kink),
  a slower or repeated pass. Cyclotron emits no photons. Twin paradox: the traveller
  comes back at 0.70c (the Hertz wall loses energy on its first contact substep,
  dtSafe from the previous frame's maxAccel); its desc says 0.8c both ways: fix or note.

**9. Chrome.**
- One red: total-force arrows and total torque use the accent (`gpu-renderer.js` Pass 4
  `accentColor`, Pass 5); move them to the text ink, hairline. Clock arcs
  (`clock-render.wgsl`) are accent: move to the body's ink. Velocity arrows: text ink,
  thinner (`arrow-render.wgsl`).
- One ink per force, margin = scene: gravity umber (atlas already umber; force arrows
  umber); Relativity's switch to graphite (it's a mode, not a force); 1PN to madder (with
  gravitomagnetism) in `styles.css` `.tog-onepn` and `GPURenderer._buildForceColors`.
- The Forces section as a legend: each row an ink + pattern swatch beside the switch
  (mock in the proposal page, `#chrome`), like Lumen's Lines list. Lighter switches: a
  hairline outline with an ink fill when on (now a thick black outline).
- Phone (≤ 600 px): the scene tools (Antimatter, 1×, 日本語, Controls) wrap to a second row
  over the canvas; fold speed and language into the margin sheet's foot.

**10. Docs.** `AGENTS.md` (layout: field-atlas.js, scene-key.js, deleted trail files;
"How it works": bodies, trails as world lines, the spacetime plate (cone, events, sheet,
refit, torus box), photons, the Fields overlay rewrite, scalar hatching; Chrome; open
work: twin wall, and drop entries for cut presets but keep their physics notes reworded),
`docs/ROADMAP.md` §6 as 2.0 (done vs later), `about.md` (`updated`, the rendering prose:
trails, fields), `i18n` about/edu text if it mentions trails or the comb.

**11. Verify, commit, push.** All six presets × plane/spacetime × light/dark, phone 390,
Fields on in each, a boost to Observer, BH mode and antimatter spawned by hand; console
clean; `tests/physics-validation.html` `runAll()` (rendering-only changes, should pass);
fps on cyclotron. Then push worldline `main` and stage only `projects/worldline` in the
parent (`git add projects/worldline`), commit the pointer, no deploy.

## How to test (headless; the app's browser pane is usually hidden)

- Server: `preview_start` name `sims` (`.claude/launch.json`, port 8791, serves the
  working tree; `docs/sim-overhaul/serve.mjs`).
- `node docs/second-pass/tools/tour.mjs OUTDIR scenarios.json [w] [h] [dpr]` (Playwright
  from ~/Work/Exploratory, WebGPU on). Scenario: `{ name, preset, scheme, margin, steps:
  [{ js, wait }], ev }`; helpers `__t.preset/tog/click/slider/margin/touch`. It dispatches
  a `wheel` event first so the opening tilt doesn't fire. Fast-forward inside a step:
  `for (let i = 0; i < N; i++) { sim.accumulator += sim.speedScale / 60; sim.gpu.step(sim); }`.
  `sheet.py OUT cols cellw imgs…` tiles screenshots.
- Gotchas: bump SHADER_VERSION after WGSL edits; avoid WGSL reserved words (`from`);
  the heatmap only updates while stepping; `clearBtn` doesn't reset the external field
  sliders; a body spawned and immediately paused used to show stale ink and radius.
