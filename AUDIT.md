# Geon Audit — 2026-06-09

Project-quality audit by Claude (Fable 5), grounded in a read of the source plus
two exploration passes (GPU internals, UI/feature surface) and the project memory
files. Priority-ordered: strongest opinion first. Line numbers are as of commit
`e420983`.

## 1. The central claim is unenforced — no tests for a testable engine

Geon's identity is "the physics is real": exact four-momentum bookkeeping,
energy-normalized field deposits, quantized charge, careful sign conventions.
There are **zero tests**; every regression check is eyeballing the stats panel.
AGENTS.md carries the warnings tests exist to replace ("do not restore the old
model", "update CPU and GPU together"). ~15 mechanisms are dual-implemented
(CPU/GPU) with parity maintained by discipline alone.

The CPU physics is *almost* headless. Pure ES6, no DOM: `integrator.js`,
`forces.js`, `collisions.js`, `quadtree.js`, `topology.js`, `config.js`,
`relativity.js`, `vec2.js`. Blockers are leaked render concerns:

- `particle.js:4,95-96,113` — reads `window._PALETTE`, theme via
  `document.documentElement.dataset.theme`, and `window.sim` for color
- `scalar-field.js:60` — creates its overlay canvas in the constructor
- `higgs-field.js:11-13` / `axion-field.js:25-27` — bake palette colors at
  module level via `window._parseHex`

Extract those (color/canvas belong renderer-side) and the engine runs under Node.

**Proposed conservation suite:**
- Energy / momentum / angular-momentum drift < ε over N steps, per preset
- Exact charge conservation through merge → annihilation → emission → absorption
- Kepler two-body period and 1PN precession rate vs analytic values
- Field-deposit normalization: deposit E, field KE rises by exactly E

**Transpiler as parity oracle:** `shared-wgsl-transpile.js` is in the repo,
tested, and unwired. Its highest-value use may be compiling `pair-force.wgsl`,
`radiation.wgsl`, `field-evolve.wgsl` to JS under Node and diffing against the
CPU path on identical states. Caveat: the CAS tree build and barrier-in-control-
flow shaders are likely outside its current scope; pairwise kernels and field
evolution should be in. This converts hand-maintained GPU/CPU parity into a
checkable invariant and gives the transpiler a reason to exist.

**If only one item gets done, it's this one.**

## 2. Black hole fidelity — both halves already designed (April memory)

**Horizon is cosmetic** (render + collision only; stable orbits exist inside
r₊ because horizon ~M, body radius ~M^(1/3)):
- Add a Paczyński–Wiita pseudo-potential `Φ = -M/(r - r_s)` in BH mode. Set
  `r_s` from the existing `kerrNewmanRadius()` (config.js:158) so plunge depth
  responds to spin/charge for free. Phenomenological, in-register (the
  superradiance rate is already openly phenomenological α²).
- Pair with a "swallow when center crosses r₊" capture rule.
- Payoff: the effective-potential panel would live-render the vanishing
  centrifugal barrier — the classic GR V_eff/ISCO picture. The panel becomes
  the explainer.
- Cost surface: `pairForce` BH branch, `forces-tree.wgsl`, `pair-force.wgsl`,
  heatmap potential, `_peAccum` + `potential.js` fallback, GPU stats,
  `effective-potential.js`.

**Extremal censorship** — charge shedding via a fourth disintegration pathway
plus hard clamp backstop. Fully designed in
`memory/project_extremal_bh.md`; ready to implement (CPU
`integrator.js:checkDisintegration`, GPU `disintegration.wgsl`).

Do this before the parked ER=EPR thread: entanglement on a classically-leaky
BH risks being decorative; this deepens what exists (Hawking, superradiance,
Schwinger all gain coherence when the host object actually traps things).

## 3. You can't make a geon in geon — preset coverage gap

All ingredients for Wheeler's geon exist (boson-boson gravity, photon lensing,
kugelblitz collapse) but **no preset exercises any of it**. `bosonInter: false`
in all 15 presets. Zero preset coverage for: superradiance, Schwinger
discharge, kugelblitz, matter/antimatter annihilation, boson interaction,
disintegration/Roche, Klein/RP² topologies, external fields. The physics that
distinguishes geon from every other n-body toy is the physics a visitor never
finds.

**Flagship preset:** dense orbiting photon cloud that transiently self-binds
(a toy geon), then either disperses (geons are unstable — physically honest)
or crosses the hoop threshold and collapses kugelblitz-style into a BH. One
preset, narrative arc, three unexhibited mechanisms, earns the name.

Also: superradiant cloud (spinning BH + axion, watch spin-down via the indigo
torque arc), Schwinger sparks (charged BH discharging), e⁺e⁻ annihilation.

Doc drift: AGENTS.md says 19 presets; `presets.js` has 15.

## 4. Share-by-URL

`physics-contract.js` + `save-load.js` already do full state serialization,
but sharing means sending a JSON file. Add:
- `#state=` fragment: serialize → gzip (`CompressionStream`) → base64url
- `?preset=` param

Connects to the portfolio: the blog's iframe directive could embed specific
live geon states in posts. Only current URL param is `?cpu=1` (main.js:31).

## 5. Structure — same disease, both backends

- **`integrator.js update()` is ~1100 lines** (782–1886). AGENTS.md documents
  the substep sequence as a named pipeline; the code should look like that
  list. Extract per-stage methods. Mechanical, prerequisite-adjacent to
  testing.
- **`gpu-physics.js` (4427 lines) is cleaner than its size** — only the
  constructor exceeds 200 lines, and it's pure declarations. Don't shatter it
  wholesale. Two extractions pay:
  - Phase-5 field subsystem (~lines 2123–3132, nearly self-contained) —
    restores symmetry with the CPU side's field-class split.
  - Readback-channel helper — the staging-copy/pending-flag/device-loss
    try-catch pattern is hand-copied six times (lines 1603–1805, 3709–3781).
- **Heatmap viewport math duplicated**: `gpu-physics.js dispatchHeatmap`
  (~3170) computes camera/viewport bounds; `gpu-backend.js:210-217` computes
  the same thing with slightly different formulas. Camera math living in the
  physics class — move renderer-side or pass precomputed viewport.
- **`pass-graph.js` is half-applied.** Covers radiation/boson/spin-torque
  passes cleanly, but 1PN (`_dispatch1PNVV`), Barnes-Hut tree selection,
  field-gravity branches (`_dispatchFieldEvolve`, `_dispatchFieldParticleGrav`),
  pion decay, and heatmap channels still check toggles inline. Finish it: add
  `useBHTree`, `onePN`, `fieldGravity`, `dispatchPionDecay`, heatmap channel
  flags. A half-applied abstraction is worse than none.
- **Latent hazard**: the `FRAGILE` write at gpu-physics.js:~3458 pokes `dt` at
  byte offset 0, assuming dt is the first `SimUniforms` field. Named offset
  constant; five-minute fix; removes a struct-reorder landmine.
- **Dead code**: `_submitArrowDraw` in gpu-renderer.js:~992 has no callers;
  `_arrowUniformBuffer`/`_arrowBindGroup` exist only to support it.
- **Startup**: renderer init awaits five independent shader-fetch chains
  serially (gpu-pipelines.js ~254–266) — `Promise.all` them. `gpu-physics.js
  init()` (401–407) manually re-fetches shared WGSL already covered by
  `_ensureSharedCache()` — move the boundary pipeline into gpu-pipelines.js
  and use `getSharedPrefix()`.
- **Stale memory correction**: per-substep *submit* overhead is already solved
  — substep command buffers batch into one `queue.submit` per frame (plus one
  post-substep submit). `memory/gpu_known_issues.md` overstates this.
- Known-and-accepted: collision resolution race in `resolveCollisions`
  (two threads merging pairs sharing a particle) — acceptable at 512
  particles, but an atomic claim buffer is the fix if it ever bites.

## 6. Default backend hides a third of the diagnostics

Phase plot and effective potential are **silently hidden in GPU mode**
(`stats-display.js:151-153`) — and GPU is the default backend. Most visitors
never see them. Eff-pot computes from toggles + selected-particle params,
which the hit-test readback already supplies, so a GPU port looks feasible.
Minimum honest fix: a "CPU mode only" label instead of silent absence.
Matters more once §2 lands and eff-pot becomes the ISCO showpiece.

## 7. Quantum thread — the cheap honest slice

Park the full ER=EPR design until BH mode is credible (§2). But annihilation
photon pairs already have genuinely correlated momenta and an `emitterId`:
tagging pairs and rendering the correlation (faint line, paired phase,
decohere on absorption) visualizes structure that already exists rather than
inventing physics. Fold into the annihilation preset (§3).

Possible extra visual in the same spirit: a GW strain-ripple overlay driven by
the existing quadrupole bookkeeping (no GW visual exists in either renderer) —
decorative-but-honest, would make Binary Inspiral stunning.

## Overall read

The physics depth is genuinely excellent and the docs are some of the best on
any solo project — but the project has matured past what discipline-without-
tests and presets-without-showcases can carry. The next quality tier isn't
more physics; it's making the existing physics **verifiable** (§1),
**reachable** (§3, §4), and **honest at the marquee feature** (§2).

Suggested opening move: the testability extraction (§1) — pull render concerns
out of `particle.js`/`scalar-field.js`, stand up the first conservation suite.
It de-risks everything else. The P-W force shape (§2) and URL encoding (§4)
are good Codex spar targets before committing.
