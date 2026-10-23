# Geon

Geon is a relativistic many-body sandbox at a9l.im/geon: charged, spinning particles
under gravity, electromagnetism, gravitomagnetism, Yukawa and scalar fields, with black
holes, radiation, and photon/pion/lepton pools. Vanilla ES modules; the physics runs as
WebGPU compute shaders and draws with WebGPU instanced rendering, with no CPU fallback.
KaTeX from jsDelivr renders the reference overlay.
It is a submodule of the a9l.im repository (`a9lim.github.io`, at `projects/geon`); the
root `AGENTS.md` covers the shared layer, design system, build, and deployment.

`docs/ROADMAP.md` is the plan of record: versions 1.5–3.0, open decisions, and known
physics bugs. This file describes the code as it is.

## Running and checking

- Preview from the parent build at `http://localhost:8000/geon/`; `?lang=ja` gives
  Japanese, and `window.sim` is the live `Simulation`.
- Syntax: `for f in main.js colors.js src/*.js src/gpu/*.js i18n/*.js; do node --check "$f"; done`
- WGSL compiles only in the browser, so check the console after shader edits.
  Pipelines are created synchronously, so a compile error shows up as a WebGPU
  validation error rather than a throw; a missing shader file does throw, and the page
  then logs `[geon] GPU init failed` and shows the WebGPU popup.
- `tests/physics-validation.html` runs analytic oracles against a headless `GPUPhysics`
  (open `http://localhost:8000/geon/tests/physics-validation.html`, press Run; `runAll()`
  from the console). Every new feature adds its oracle there (`docs/ROADMAP.md` §1.1).
  The stager skips `tests/`, so it never deploys.

## Layout

```
index.html               page shell, sidebar (Settings / Stats / Particle), JSON-LD
main.js                  Simulation: state, device lifecycle, fixed-timestep loop
colors.js                charge and spin hues added to the shared palette
i18n/strings.js          UI strings (en, ja); merges strings-reference.js (reference overlay)
src/config.js            constants, mode enums, Kerr–Newman and Paczyński–Wiita helpers
src/physics-settings.js  the toggle and parameter store (sim.settings)
src/physics-contract.js  toggle/parameter keys shared by save/load and the GPU slot map
src/ui.js                controls, toggle dependencies, settings dropdown, shortcuts, about
src/input.js             spawn, select, delete through GPU hit tests
src/overlay.js           the 2D canvas above the GPU canvas: the spawn-drag line
src/presets.js           15 presets (PRESET_ORDER)
src/save-load.js         quick save (localStorage), JSON download/upload
src/stats-display.js     conservation readouts, selected-particle panel
src/phase-plot.js, effective-potential.js, plot-labels.js   Particle-tab plots
src/i18n.js, reference.js, topology.js (minImage), fft.js (Green's function), vec2.js
src/gpu/gpu-backend.js   GPU runtime: step, events, render, stats, auto-save
src/gpu/gpu-physics.js   GPUPhysics: buffers, dispatch, readbacks, serialize
src/gpu/gpu-pipelines.js pipelines, fetchShader, SHADER_VERSION
src/gpu/gpu-buffers.js   allocation and packed struct sizes
src/gpu/gpu-constants.js generated WGSL constants and toggle bits
src/gpu/gpu-renderer.js  instanced rendering, light/dark pipeline pairs
src/gpu/pass-graph.js    per-frame dispatch plan
src/gpu/shaders/         55 WGSL files; shared-*.wgsl are prepended includes
tests/physics-validation.html   analytic oracles against a headless GPUPhysics
```

## How it works

### State and the frame loop

`Simulation` (`main.js`) owns the camera, modes, selection, and the settings store
`sim.settings` (`physics-settings.js`), which `ui.js` writes and
`GPUBackend.applySettings()` copies into `GPUPhysics.setToggles()`. View flags (trails,
vectors) live in `sim.view`, the potential heatmap's state in `sim.heatmap`.

`startGPU()` requests the device; without one the page shows the "Geon needs WebGPU"
popup and stays empty. `_attachDevice()` builds the `GPUBackend` and registers the
device-loss handler, which recreates the device and restores the backend's auto-save
(every 300 stepped frames; fields and bosons are not saved). `_loopBody` adds the capped
frame time × `speedScale` to `sim.accumulator`, then calls `gpu.step()`, polls the hit
test, and renders when `_dirty`; the loop stops while the tab is hidden.

The GPU buffers are the only particle state. `sim.addParticle()` converts a spawn
velocity to proper velocity and writes a slot; selection is a slot index
(`sim.select(idx)`), and the sidebar reads the selected body, and the heaviest other
body as the plots' reference, from the stats readback. A selection whose particle dies
clears itself.

### Units and particle state

- c = G = ħ = 1. World units are pixels / `WORLD_SCALE` (16); the domain is the window
  size / 16, so resizing the window resizes the world.
- Linear and rotational state are proper velocities (`ParticleState.velW`, `angW`);
  `derived.vel` and `angVel` come from them in `cache-derived.wgsl` and equal them with
  relativity off. The spawn spin slider is a surface speed.
- `derived.bodyRSq` = ∛m² is the body radius and the source of moment of inertia,
  magnetic moment, and angular momentum. In black-hole mode `ParticleAux.radius` and
  `derived.radiusSq` hold the Kerr–Newman horizon instead.
- Charges are multiples of `BOSON_CHARGE` (0.1): `addParticle()` rounds, pions and
  leptons carry 0 or ±`BOSON_CHARGE`, and emission, absorption, decay, Schwinger
  discharge, extremal shedding, and Roche transfer move whole quanta.
- Energy totals include rest mass plus kinetic, spin, potential, field, and radiated terms.

### Integrator

`GPUPhysics.update()` gets the frame's whole tick count (`n·PHYSICS_DT`) and splits it
into at most 32 substeps from the previous frame's `maxAccel` readback,
`dtSafe = √(softening/a_max)` (no cyclotron limit). `_dispatchSubstep()` lists the order
in its pass comments: forces, external and field forces come before the fused
kick–rotate–kick, then spin-orbit and torques, radiation, drift, expansion, the 1PN
velocity-Verlet correction, the field step, collisions, disintegration, bosons, and the
boundary. Pion decay, boson interaction, dead-slot GC, history, quadrupole radiation,
colors, and trails run once per frame after the substeps.

The Boris rotation parameter is `(q/2m)·Bz + 2·Bgz`, scaled by dt/γ. Gravitomagnetism
uses the GEM sign: a moving mass sources `Bgz = −m(v×r̂)/r²`, and the GM dipole force
`+3L₁L₂/r⁴` attracts where the EM dipole's `−3μ₁μ₂/r⁴` repels aligned dipoles. In
`pair-force` the displacement is source − observer, so a positive radial coefficient
attracts. 1PN forces are velocity-dependent and break Newton's third law, hence the
velocity-Verlet correction.

### Forces and toggles

Sixteen toggles (`TOGGLE_KEYS`). Their dependency graph is the declarative
`_forms.bindDeps()` list in `ui.js`; `updateAllDeps()` adds the mode locks (Black hole
and the hidden Disintegration force Merge collisions, Expansion forces Despawn). Less
obvious couplings: Boson interaction needs the Barnes–Hut toggle (settings dropdown);
signal delay runs whenever Relativity is on; field gravity follows Gravity; kugelblitz
runs under Boson interaction with Gravity; 1PN's EIH sector runs with Gravitomagnetic
(not Gravity), Darwin with Magnetic, Bažański with both, scalar Breit with Yukawa.

Barnes–Hut picks tree walk over pairwise forces; collisions and hit tests use the tree
either way. With Higgs on, the Yukawa range is `yukawaMu·√(higgsMod_i·higgsMod_j)`,
`higgsMod = max(|φ|, HIGGS_MASS_FLOOR)` cached per particle in `axYukMod.z`.

Signal delay solves the light-cone condition against a per-particle history ring,
recorded only with Relativity on (`signal-delay-common.wgsl`). Removed particles keep
sourcing forces until their signal has crossed the domain: retired slots keep death
time, mass, and spin in `ParticleAux`.

### Black holes

- **Horizon.** `kerrNewmanRadius()` (`config.js`): `r₊ = M + √(M² − a² − Q²)`,
  `a = INERTIA_K·bodyRadiusSq·|ω|`. Super-extremal inputs clamp to `r₊ = M`, an
  effective radius for stable evolution, not a naked-singularity model. WGSL repeats
  the clamp in many shaders (grep `disc >= 0.0`).
- **Gravity.** Paczyński–Wiita, `Φ = −M / max(r − r₊, BH_PW_MIN_GAP)`, with
  `BH_SOFTENING`: `bhSourceRadius()` copies in `pair-force`, `forces-tree`,
  `compute-stats`, and `heatmap.wgsl` (the heatmap's ignores spin);
  `blackHoleRadialTerms()` in `config.js` for the effective-potential plot.
  Phenomenological, not a geodesic solve.
- **Capture.** In Merge mode a particle whose centre is inside another's horizon is
  swallowed with merge bookkeeping in `resolveCollisions`, whose broadphase searches the
  whole domain in black-hole mode so a small body deep inside a large horizon is found.
- **Extremal censorship.** An over-bound hole sheds same-sign leptons one quantum at a
  time, emitted in its rest frame and boosted, with a clamp to the nearest allowed charge
  as backstop. It runs in black-hole mode whatever the Disintegration toggle says:
  `disintegration.wgsl` with `DISINT_FEATURE_EXTREMAL`.
- **Hawking** (Black hole + Radiation): Kerr–Newman temperature, Stefan–Boltzmann
  power, none at extremality, on the hole's clock (`dM = P·dt/γ`). Mass leaves at fixed
  proper velocity; each photon is drawn isotropically in the rest frame, boosted, and the
  hole takes the recoil. Below `MIN_MASS` a hole sheds leftover charge as leptons and
  ends in two back-to-back rest-frame photons carrying its four-momentum.
- **Schwinger** (Black hole + Coulomb + Radiation; `schwingerDischarge` in
  `radiation.wgsl`): the rate runs on the hole's clock, and each event emits one
  same-sign lepton in the hole's rest frame, boosted, with exact momentum recoil. It
  costs the hole one charge quantum and `ELECTRON_MASS` but not the lepton's kinetic
  energy; subtracting that too makes the discharge run away.
- **Superradiance** (Black hole + Axion): the rate scales as α² instead of the real
  α⁸, which is too steep to see. Accepted dE enters axion `fieldDot` as an
  energy-normalized impulse and the hole loses `dM = dE`, `dJ = dE/μ_a`, so it
  saturates at `Ω_H ≤ μ_a`. The rate uses `dt/γ`, valid for slow holes (`Ω_H > μ` is
  frame-dependent for a hole crossing the lab grid). `depositSuperradiance`
  (`field-deposit.wgsl`) reads φ² from `axYukMod[pid].w`, written earlier in the substep
  by `applyAxionForces`, and has its own three-group layout.

### Bosons

- Pool caps live in `config.js`: 512 particles, 4096 photons, 1024 pions + 1024
  leptons. Leptons share the pion buffer, told apart by `Pion.kind` (0 pion, 1 lepton).
- Absorption adds the boson's full four-momentum (`absorbFourMomentum()`), so the
  target's invariant mass changes with its proper velocity; charged pions move charge.
  `emitterId` blocks self-absorption, and nothing is absorbed before `BOSON_MIN_AGE`.
- Pion decay runs on the pion's clock: once per frame, `P = 1 − exp(−ln2·Δτ/T½)` with
  `Δτ = dt/γ` (`PION_HALF_LIFE` 32, `CHARGED_PION_HALF_LIFE` 64; pions always dilate,
  since they always carry true proper velocity). `restFrameDt()` and `boostToLab()`
  live in `shared-relativity.wgsl`.
- `PHOTON_CULL_AGE` and `LEPTON_CULL_AGE` are pool culls in lab time, not lifetimes.
- Boson lensing (photons 2× Newtonian, pions `1 + v²`) follows the Gravity toggle.
- Leptons come from Schwinger discharge, extremal shedding, evaporation remnants, and
  charged-pion decay. Photon → pair conversion is deliberately absent.
- **Annihilation** (Merge mode, matter meets antimatter) emits two photons conserving
  lab-frame energy and momentum: the 32-byte `MergeResult`
  (`p0 = x, y, energy, type`, `p1 = px, py, _, _`) → `merge-photons.wgsl` on-device.
  Merge and annihilation energies also excite the scalar fields.
- **Kugelblitz**: a boson-tree node whose energy exceeds half its full extent (hoop
  conjecture) collapses into a particle of mass `√(E² − |P|²)` and proper velocity
  `P/m`; near-null clusters are rejected, and only consumed bosons that were counted as
  radiated leave the radiated totals. `kugelblitz.wgsl` has no minimum-count guard
  because its `N_PARTICLE_COUNT` node word is a visitor-flag counter, not a subtree count.

### Scalar fields

The Higgs and axion fields live on 128² grids with PQS (cubic B-spline, 4×4 stencil)
deposition and interpolation, values clamped to `±SCALAR_FIELD_MAX`. Both fields step by
one joint Störmer–Verlet KDK per substep (`_dispatchFieldStep`), so the Higgs–axion
portal and the shared metric are evaluated at matching times.

**Couplings** (`field-forces.wgsl`, `field-deposit.wgsl`). Higgs: particle mass is
`baseMass·max(|φ|, HIGGS_MASS_FLOOR)`, and particles source the field with
`HIGGS_COUPLING·baseMass`. Axion: `axMod = 1 + g·a` scales EM couplings and charges
source it with `g·q²`; a Peccei–Quinn `yukMod` scales Yukawa and flips sign for
antimatter. Scalar sources couple through proper time (`× 1/γ`). Merge and annihilation
excitations enter `fieldDot` as impulses solved against the existing `fieldDot` cross
term, so field kinetic energy rises by exactly the event energy (`field-excitation.wgsl`).

**Grid gravity.** With Gravity on, the fields evolve in the metric
`ds² = −e^{2Φ}dt² + e^{−2Φ}d𝐱²`, where the Klein–Gordon equation is exactly
`φ̈ = e^{4Φ}∇²φ − e^{2Φ}V′ + 4Φ̇φ̇` (the 3+1 weak-field form at small Φ, with no
gradient-coupling term). Particle sources carry `e^{5Φ}` in the kick (the e^{Φ} of
proper time on top of the kinetic normalization), and damping is a proper-time rate
(`× e^{Φ}`). `field-gravity.wgsl` builds Φ on one shared grid
(`createGravityGridBuffers`): Φ_F from both fields' energy (also the field → particle
force) and Φ_P from the particles' rest mass, each an FFT convolution with
`−1/√(r² + ℓ²)`, `ℓ = SHEET_THICKNESS` (8, independent of the particle softening ε).
`metricPhi = Φ_F + Φ_P` is solved before the first half-kick and after the drift; Φ̇ is
the backward difference between consecutive post-drift solves. The FFT stage
parameters are a static uniform table picked by dynamic offset: a `queue.writeBuffer`
per stage would land before the whole encoder ran (that bug left Φ ≡ 0 until
2026-10-23). The circular convolution treats every boundary mode as periodic.

### GPU backend

- **Shaders.** `fetchShader()` loads `src/gpu/shaders/<file>?v=${SHADER_VERSION}`;
  `getSharedPrefix()` prepends `buildWGSLConstants()` (generated from `config.js` and
  the palette), `shared-structs`, `shared-topology`, `shared-rng`, and
  `shared-relativity.wgsl`. Tree walkers add `shared-tree-nodes.wgsl`; many shaders
  also prepend `common.wgsl`.
- **Buffers.** Packed structs (`shared-structs.wgsl`, sizes in `gpu-buffers.js`) keep
  each stage within the 10 storage buffers `requestDevice()` asks for.
- **Pass plan.** `pass-graph.js` derives dispatch booleans from toggles only, not alive
  counts. Pool-sized boson passes use indirect dispatch from `dispatch-args.wgsl`,
  with a max-capacity fallback.
- **Tree.** `computeBounds`, `initRoot`, `insertParticles` (lock-free CAS, one body per
  leaf), `computeAggregates` (bottom-up via visitor flags).
- **Events.** Merge, disintegration, and kugelblitz events, hit tests, stats,
  maxAccel, ghost count, and the free-slot stack come back through async `mapAsync`
  readbacks a frame late; `GPUBackend` spawns fragments, transfers, and kugelblitz
  particles from them.
- `_phase5Ready` holds field dispatches until the async field pipelines exist.

### Rendering

`GPURenderer` draws on `#gpuCanvas`, behind the 2D `#simCanvas` that `Overlay` uses for
the spawn-drag line. It clears to `_PALETTE.{light,dark}.canvas`, with light/dark
pipeline pairs that `setTheme()` swaps. `syncRendererTheme()` in `ui.js` sets both;
`GPUBackend.create()` adopts `sim.overlay.isLight` after `renderer.init()` because it is
created after the first sync. WGSL theme colors are light/dark constant pairs picked by
the `isDarkMode` uniform. The sidebar plots redraw with every stats readback, so their
canvas text needs no font-load redraw.

## Conventions

- **Naming.** Code, comments, and UI text say "signal delay" or "finite-speed force
  propagation", never "retarded potential(s)" (a9's rule; `docs/ROADMAP.md` §12 adds
  "light-cone" and "Liénard–Wiechert").
- **Force laws.** A force-law change touches `pair-force`, `forces-tree`, `onePN`,
  `compute-stats` (PE), and `heatmap.wgsl`, and `effective-potential.js` for the plot.
- **Constants.** WGSL constants are generated from `config.js`, but the toggle bits are
  written twice in `gpu-constants.js` (WGSL string and JS exports), and tree node
  layouts are repeated in `boson-tree` and `kugelblitz.wgsl`. JS uniform writers follow
  WGSL struct member order; the post-substep `dt` is a raw write at byte 0 of
  `SimUniforms`. Event records are mirrored between shaders and the readback parsers in
  `gpu-physics.js`: a 32-byte `MergeResult` change also touches `MERGE_RESULT_SIZE`,
  `collision.wgsl`, `merge-photons.wgsl`, and the field-excitation upload. The stats
  readback layout is listed at the top of `compute-stats.wgsl`.
- **Shader cache.** Bump `SHADER_VERSION` after any WGSL edit; the query string is the
  only cache key.
- **New toggle or parameter.** Update `physics-contract.js`, `physics-settings.js`,
  `ui.js` (`toggleDefs`, deps), `presets.js` `TOGGLE_MAP`, `save-load.js` `TOGGLE_SYNC`,
  and `GPUPhysics.setToggles()` with its bit, then check that saves round-trip it.
- **Saves.** `version: 1` holds particles, toggles, parameters, modes, speed, friction,
  and camera; fields and bosons are not saved. The quick-save key `nohair-quicksave`
  and download name `nohair-state.json` are stored names; renaming them orphans saves.
- **GPU slots.** `GPUPhysics.addParticle()` initializes every per-particle buffer.
  `axYukMod` starts at `(1, 1, 1, 0)` because its components are multiplicative
  modulations (EM coupling, Yukawa coupling, Higgs range factor) that zeros would switch
  off. The alive sentinel for `deathTime` is `FLT_MAX` (3.4028235e38), not `Infinity`.
  Slots are recycled through the free stack, so a slot index names a particle only
  while it lives.
- **Command ordering.** `queue.writeBuffer()` lands at submit, before any of the
  encoder's passes, and the frame's substeps are encoded before one submit: anything
  that must differ between passes or substeps goes through
  `encoder.copyBufferToBuffer()`, `clearBuffer()`, or a dynamic offset into a static
  table (the FFT). Each readback channel's pending flag skips new copies while its
  staging buffer is mapped and clears in `finally`, so a lost device cannot wedge it.
- **Bind groups.** One buffer may not fill two writable bindings of a dispatch; dummy
  placeholders come in distinct buffers.
- **WGSL.** Merge resolution guards with `mass <= EPSILON`, not `== 0`, because pairs
  race; NaN guards come before global-memory writes; render pipelines use premultiplied
  alpha with `srcFactor: 'one'`; entry points sharing a module declare shared bindings
  `read_write`.
- **History stride.** The counter advances by the frame's tick count and subtracts
  `HISTORY_STRIDE` rather than resetting.
- **Topology.** Klein and RP² crossings flip velocity and spin; periodic modes add
  ghost copies so tree forces cross the boundary, and history interpolation wraps
  through `minImage()`.
- **Input.** The antimatter toolbar mode (X) drives touch only; mouse users spawn
  antimatter with right-click. Click resolution is `InputHandler._resolveClickHit()`:
  a click of the particle's own kind selects, the other kind deletes; black-hole mode
  never spawns antimatter.
- **CSS.** The shared `.mode-toggles` sets `display: flex`, which beats the `hidden`
  attribute, so those rows are shown and hidden with `style.display`.
- **URLs.** Geon's own files load by relative URL (`styles.css`, `colors.js`, `main.js`,
  the shaders), which resolves only under `/geon/` with its trailing slash.

## Open work

`docs/ROADMAP.md` holds the plan: §2.2–2.3 list known physics bugs and audit leftovers,
§3 the milestones. Not tracked there:

- Hidden Disintegration (its control's parent is `display:none`; no preset enables
  it): fragments split the parent's charge evenly and `addParticle()` rounds each
  share, so charge survives only when it divides into `SPAWN_COUNT` quanta, and a
  Coulomb-driven breakup leaves fragments over threshold, cascading into dust.
- `pass-graph.js` gates photon passes on Radiation, but `merge-photons.wgsl` emits
  annihilation photons with Radiation off; those photons then never update (found by
  reading the code, not reproduced).
- The `torque-render.wgsl` header table swaps the contact (0.5) and superradiance (1.0)
  arc offsets relative to `getTorqueOffset()`.
- The Kepler preset places its planets at random angles without zeroing the total
  momentum, so the system drifts at up to ~0.1c.
- `sim.totalRadiated` only ever decreases (kugelblitz): nothing adds GPU-emitted
  radiation to it, so the stats' radiated column reads 0.
