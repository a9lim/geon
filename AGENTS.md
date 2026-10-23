# Geon

Geon is a relativistic many-body sandbox at a9l.im/geon: charged, spinning particles
under gravity, electromagnetism, gravitomagnetism, Yukawa and scalar fields, with black
holes, radiation, and photon/pion/lepton pools. Vanilla ES modules with two backends,
WebGPU compute + instanced rendering and a CPU integrator + Canvas 2D; KaTeX from
jsDelivr renders the reference overlay.
It is a submodule of the a9l.im repository (`a9lim.github.io`, at `projects/geon`); the
root `AGENTS.md` covers the shared layer, design system, build, and deployment.

`docs/ROADMAP.md` is the plan of record: versions 1.5–3.0, open decisions, known physics
bugs, and the decided retirement of the CPU path (WebGPU only). This file describes the
code as it is; the CPU sections stay accurate until that retirement lands.

## Running and checking

- Preview from the parent build at `http://localhost:8000/geon/`. `?cpu=1` forces the
  CPU backend, `?lang=ja` Japanese; `window.sim` is the live `Simulation`.
- Syntax: `for f in main.js colors.js src/*.js src/gpu/*.js i18n/*.js; do node --check "$f"; done`
- WGSL compiles only in the browser, so check the console after shader edits.
  Pipelines are created synchronously, so a compile error shows up as a WebGPU
  validation error rather than a throw; a missing shader file does throw, and init then
  logs `[physsim] GPU init failed, falling back to CPU`.
- There is no test suite yet (`docs/ROADMAP.md` §10.3 plans one).

## Layout

```
index.html               page shell, sidebar (Settings / Stats / Particle), JSON-LD
main.js                  Simulation: state, backend selection, fixed-timestep loop
colors.js                charge and spin hues added to the shared palette
i18n/strings.js          UI strings (en, ja); merges strings-reference.js (reference overlay)
src/config.js            constants, mode enums, Kerr–Newman and Paczyński–Wiita helpers
src/physics-contract.js  toggle/parameter keys shared by save/load and the GPU slot map
src/ui.js                controls, toggle dependencies, settings dropdown, shortcuts, about
src/input.js             spawn, select, delete; GPU hit-test polling
src/presets.js           15 presets (PRESET_ORDER)
src/save-load.js         quick save (localStorage), JSON download/upload
src/stats-display.js     conservation readouts, selected-particle panel
src/i18n.js, reference.js, backend-interface.js
src/cpu-physics.js       CPU runtime adapter: ticks, boson lifecycles, evaporation, events
src/integrator.js        Physics: the toggle store and the CPU Boris substep loop
src/forces.js            pairForce with inline PE, Barnes–Hut walk, 1PN, boson forces
src/collisions.js, quadtree.js, topology.js, signal-delay.js, energy.js, potential.js
src/scalar-field.js      PQS grid base for higgs-field.js and axion-field.js
src/particle.js, massless-boson.js (photons), pion.js, lepton.js, boson-utils.js
src/renderer.js, heatmap.js      Canvas 2D rendering and potential heatmap
src/phase-plot.js, effective-potential.js, plot-labels.js   Particle-tab plots (CPU only)
src/fft.js, relativity.js, vec2.js
src/canvas-renderer.js   unused; nothing imports it
src/gpu/gpu-backend.js   GPU runtime adapter: device lifecycle, CPU↔GPU sync, events, auto-save
src/gpu/gpu-physics.js   GPUPhysics: buffers, dispatch, readbacks, serialize
src/gpu/gpu-pipelines.js pipelines, fetchShader, SHADER_VERSION
src/gpu/gpu-buffers.js   allocation and packed struct sizes
src/gpu/gpu-constants.js generated WGSL constants and toggle bits
src/gpu/gpu-renderer.js  instanced rendering, light/dark pipeline pairs
src/gpu/pass-graph.js    per-frame dispatch plan
src/gpu/shaders/         54 WGSL files; shared-*.wgsl are prepended includes
```

## How it works

### State and the frame loop

`Simulation` (`main.js`) owns the CPU-side particle and boson arrays, camera, and modes.
`sim.physics`, the CPU `Physics` from `integrator.js`, is the toggle and parameter store
in both modes: `ui.js` writes it and copies it into `GPUPhysics.setToggles()` via
`_buildGPUToggles()`.

`_loopBody` adds the capped frame time × `speedScale` to `sim.accumulator`, then calls
`sim.runtimeBackend.step()`, `.pollInput()`, and `.render()` (render only when `_dirty`;
the loop stops while the tab is hidden). `runtimeBackend` is the `GPUBackend` once
WebGPU initialized, otherwise `CPUPhysics`; backend switches go through
`sim.useGPUBackend()` / `sim.useCPUBackend()`, so the loop never branches on
`sim.backend`. `selectBackend()` falls back to CPU on `?cpu=1`, missing `navigator.gpu`,
or any adapter, device, or `GPUBackend.create()` failure. On device loss the sim
switches to CPU and loads the GPU auto-save (every 300 stepped frames). The "GPU
acceleration" toggle in the settings dropdown switches at runtime; GPU→CPU reads back
particles, block-averages the 128² fields to 64², and clears bosons.

`sim.addParticle()` builds a CPU `Particle` and hands it to `backend.addParticle()`. On
GPU the buffers are authoritative and the CPU array is not kept current; readbacks
(`snapshotToCPU`, `serialize`, stats, hit tests) bring state back.

### Units and particle state

- c = G = ħ = 1. World units are pixels / `WORLD_SCALE` (16); the domain is the window
  size / 16, so resizing the window resizes the world.
- Linear and rotational state are proper velocities (`p.w` = γv, `p.angw`); `vel` and
  `angVel` derive from them (`relativity.js`) and equal them with relativity off. The
  spawn spin slider is a surface speed.
- `p.bodyRadiusSq` = ∛m² is the body radius and the source of moment of inertia,
  magnetic moment, and angular momentum. In black-hole mode `p.radius` / `p.radiusSq`
  hold the Kerr–Newman horizon instead.
- Charges are multiples of `BOSON_CHARGE` (0.1): both backends round in `addParticle()`,
  pions and leptons carry 0 or ±`BOSON_CHARGE`, and emission, absorption, decay,
  Schwinger discharge, extremal shedding, and Roche transfer move whole quanta.
- Energy totals include rest mass plus kinetic, spin, potential, field, and radiated terms.

### Integrator

CPU `Physics.update()` runs once per `PHYSICS_DT` tick with adaptive substeps,
`dtSafe = min(√(softening/a_max), (2π/ω_c)/8)`, at most 32. A substep: save old 1PN
force → half-kick → Boris rotation → half-kick → spin-orbit and torques → radiation
(Landau–Lifshitz, Hawking, Schwinger, pion emission) → drift → expansion → 1PN
velocity-Verlet correction → Higgs and axion evolution → quadtree rebuild → merge
collisions → force recompute (pair, external, and field forces, bounce contact, boson
interaction). Then once per tick: history, quadrupole radiation, display forces,
boundary.

GPU `GPUPhysics.update()` gets the frame's whole tick count (`n·PHYSICS_DT`) and splits
it into at most 32 substeps from the previous frame's `maxAccel` readback alone (no
cyclotron limit). `_dispatchSubstep()` lists the order in its pass comments: forces,
external and field forces come before the fused kick–rotate–kick, and pion decay, boson
interaction, dead-slot GC, history, and quadrupole run once per frame after the
substeps.

The Boris rotation parameter is `(q/2m)·Bz + 2·Bgz`, scaled by dt/γ. Gravitomagnetism
uses the GEM sign: a moving mass sources `Bgz = −m(v×r̂)/r²`, and the GM dipole force
`+3L₁L₂/r⁴` attracts where the EM dipole's `−3μ₁μ₂/r⁴` repels aligned dipoles. In
`pairForce` the displacement is source − observer, so a positive radial coefficient
attracts.

### Forces and toggles

Sixteen toggles (`TOGGLE_KEYS`). Their dependency graph is the declarative
`_forms.bindDeps()` list in `ui.js`; `updateAllDeps()` adds the mode locks (Black hole
and the hidden Disintegration force Merge collisions, Expansion forces Despawn). Less
obvious couplings: Boson interaction needs the Barnes–Hut toggle (settings dropdown);
signal delay runs whenever Relativity is on; field gravity follows Gravity; kugelblitz
runs under Boson interaction with Gravity; 1PN's EIH sector runs with Gravitomagnetic
(not Gravity), Darwin with Magnetic, Bažański with both, scalar Breit with Yukawa.

Barnes–Hut picks tree walk over pairwise forces; the CPU quadtree is rebuilt every
substep regardless, since collisions, bounce contact, and hit tests query it. With
Higgs on, the Yukawa range is `yukawaMu·√(higgsMod_i·higgsMod_j)`, `higgsMod =
max(|φ|, HIGGS_MASS_FLOOR)` cached per particle (GPU `axYukMod.z`).

Signal delay solves the light-cone condition against a per-particle history ring,
recorded only with Relativity on (`signal-delay.js`, `signal-delay-common.wgsl`).
Removed particles keep sourcing forces until their signal has crossed the domain:
`sim.deadParticles` on CPU, retired slots with death time, mass, and spin in
`ParticleAux` on GPU.

### Black holes

- **Horizon.** `kerrNewmanRadius()` (`config.js`): `r₊ = M + √(M² − a² − Q²)`,
  `a = INERTIA_K·bodyRadiusSq·|ω|`. Super-extremal inputs clamp to `r₊ = M`, an
  effective radius for stable evolution, not a naked-singularity model. WGSL repeats
  the clamp in many shaders (grep `disc >= 0.0`).
- **Gravity.** Paczyński–Wiita, `Φ = −M / max(r − r₊, BH_PW_MIN_GAP)`, with
  `BH_SOFTENING`: CPU `blackHoleRadialTerms()`; GPU `bhSourceRadius()` copies in
  `pair-force`, `forces-tree`, `compute-stats`, and `heatmap.wgsl` (the heatmap's
  ignores spin). Phenomenological, not a geodesic solve.
- **Capture.** In Merge mode a particle whose centre is inside another's horizon is
  swallowed with merge bookkeeping: CPU `resolveHorizonCapture()`, GPU
  `resolveCollisions`, whose broadphase searches the whole domain in black-hole mode so
  a small body deep inside a large horizon is found.
- **Extremal censorship.** An over-bound hole sheds same-sign leptons one quantum at a
  time, with `quantizedCensoredBlackHoleCharge()` as clamp backstop. It runs in
  black-hole mode whatever the Disintegration toggle says: CPU
  `checkDisintegration().chargeSheds` → `CPUPhysics._handleExtremalChargeShed()`, GPU
  `disintegration.wgsl` with `DISINT_FEATURE_EXTREMAL`.
- **Hawking** (Black hole + Radiation): Kerr–Newman temperature, Stefan–Boltzmann
  power, none at extremality. Below `MIN_MASS` a hole sheds leftover charge as leptons
  and ends in a photon burst.
- **Schwinger** (Black hole + Coulomb + Radiation; rate in the comment above the CPU
  block in `integrator.js`, GPU `schwingerDischarge` in `radiation.wgsl`): each event
  emits one same-sign lepton and costs the hole one charge quantum and `ELECTRON_MASS`
  but not the lepton's kinetic energy; subtracting that too makes the discharge run
  away.
- **Superradiance** (Black hole + Axion): the rate scales as α² instead of the real
  α⁸, which is too steep to see. Accepted dE enters axion `fieldDot` as an
  energy-normalized impulse and the hole loses `dM = dE`, `dJ = dE/μ_a`, so it
  saturates at `Ω_H ≤ μ_a`. CPU `AxionField._depositSuperradiance()`; GPU
  `depositSuperradiance` (`field-deposit.wgsl`) reads φ² from `axYukMod[pid].w`, written
  earlier in the substep by `applyAxionForces`, and has its own three-group layout.

### Bosons

- Pool caps live in `config.js` (CPU 128 particles / 1024 photons / 256 pions /
  256 leptons; GPU 512 / 4096 / 1024 + 1024). GPU leptons share the pion buffer,
  told apart by `Pion.kind` (0 pion, 1 lepton).
- Absorption adds the boson's full four-momentum (`_absorbFourMomentum()`), so the
  target's invariant mass changes with its proper velocity; charged pions move charge.
  `emitterId` blocks self-absorption, and nothing is absorbed before `BOSON_MIN_AGE`.
- Pion decay is a per-tick probability on CPU; the GPU decays once per frame with
  `1 − (1 − p)^N` for N ticks.
- Leptons come from Schwinger discharge, extremal shedding, evaporation remnants, and
  charged-pion decay. Photon → pair conversion is deliberately absent.
- **Annihilation** (Merge mode, matter meets antimatter) emits two photons conserving
  lab-frame energy and momentum: CPU events `{energy, px, py}` →
  `sim.emitPhotonBurstWithMomentum()`; GPU 32-byte `MergeResult`
  (`p0 = x, y, energy, type`, `p1 = px, py, _, _`) → `merge-photons.wgsl` on-device.
  Merge and annihilation energies also excite the scalar fields.
- **Kugelblitz**: a boson-tree node whose energy exceeds half its full extent (hoop
  conjecture) collapses into a particle of mass `√(E² − |P|²)` and velocity `P/E`;
  near-null clusters are rejected, and only consumed bosons that were counted as
  radiated leave the radiated totals. The GPU (`kugelblitz.wgsl`) skips the CPU's
  `MIN_KUGELBLITZ_COUNT` guard because its `N_PARTICLE_COUNT` node word is a
  visitor-flag counter, not a subtree count.

### Scalar fields

`ScalarField` (`scalar-field.js`) is a PQS (cubic B-spline, 4×4 stencil) grid with C²
interpolation and gradients, arrays `field` / `fieldDot`, values clamped to
`±SCALAR_FIELD_MAX`; 64² on CPU, 128² on GPU. Fields step by Störmer–Verlet KDK each
substep. Self-gravity is an FFT convolution with a softened Green's function;
`computeSelfGravity(domainW, domainH, softeningSq, bcMode, topoConst)` takes the
boundary mode, not a periodic flag, and runs twice per KDK (GPU: `field-selfgrav` and
the Stockham `field-fft.wgsl`, with `fft.js` building the Green's function).

The couplings are documented in the headers of `higgs-field.js` (mass =
`baseMass·max(|φ|, HIGGS_MASS_FLOOR)`) and `axion-field.js` (`axMod` for EM, a
Peccei–Quinn `yukMod` that flips sign for antimatter). Merge and annihilation
excitations enter `fieldDot` as impulses solved against the existing `fieldDot` cross
term, so field kinetic energy rises by exactly the event energy (CPU
`depositExcitation()`, GPU `field-excitation.wgsl`).

### GPU backend

- **Shaders.** `fetchShader()` loads `src/gpu/shaders/<file>?v=${SHADER_VERSION}`;
  `getSharedPrefix()` prepends `buildWGSLConstants()` (generated from `config.js` and
  the palette), `shared-structs`, `shared-topology`, and `shared-rng.wgsl`. Tree
  walkers add `shared-tree-nodes.wgsl`; many shaders also prepend `common.wgsl`.
- **Buffers.** Packed structs (`shared-structs.wgsl`, sizes in `gpu-buffers.js`) keep
  each stage within the 10 storage buffers `selectBackend()` requests.
- **Pass plan.** `pass-graph.js` derives dispatch booleans from toggles only, not alive
  counts. Pool-sized boson passes use indirect dispatch from `dispatch-args.wgsl`,
  with a max-capacity fallback.
- **Tree.** `computeBounds`, `initRoot`, `insertParticles` (lock-free CAS, one body per
  leaf; the CPU quadtree holds four), `computeAggregates` (bottom-up via visitor flags).
- **Events.** Merge, disintegration, and kugelblitz events, hit tests, stats,
  maxAccel, ghost count, and the free-slot stack come back through async `mapAsync`
  readbacks a frame late; `GPUBackend` spawns fragments, transfers, and kugelblitz
  particles from them.
- `_phase5Ready` holds field dispatches until the async field pipelines exist.

### Rendering

The CPU `Renderer` draws on `#simCanvas`, cleared transparent over the CSS ground.
`GPURenderer` draws on a `#gpuCanvas` behind it, cleared to
`_PALETTE.{light,dark}.canvas`, with light/dark pipeline pairs that `setTheme()` swaps.
`syncRendererTheme()` in `ui.js` sets both; `GPUBackend.create()` adopts
`sim.renderer.isLight` after `renderer.init()` because it is created after the first
sync. WGSL theme colors are light/dark constant pairs picked by the `isDarkMode`
uniform. The sidebar plots redraw continuously, so their canvas text needs no
font-load redraw.

## Conventions

- **Naming.** Code, comments, and UI text say "signal delay" or "finite-speed force
  propagation", never "retarded potential(s)" (a9's rule; `docs/ROADMAP.md` §12 adds
  "light-cone" and "Liénard–Wiechert").
- **Two implementations.** Every force law, emission process, and conservation rule
  exists in `src/*.js` and in WGSL. A force-law change touches `forces.js` (force and
  `_peAccum`), `potential.js`, `heatmap.js`, `effective-potential.js`, and the
  `pair-force`, `forces-tree`, `onePN`, `compute-stats`, and `heatmap` shaders. ROADMAP
  milestone M0 deliberately fixes only the GPU copies of code slated for deletion.
- **Constants.** WGSL constants are generated from `config.js`, but the toggle bits are
  written twice in `gpu-constants.js` (WGSL string and JS exports), tree node layouts
  are repeated in `boson-tree` and `kugelblitz.wgsl`, and `GPUPhysics.update()`
  hardcodes softening as `4 : 8`. JS uniform writers follow WGSL struct member order;
  the post-substep `dt` is a raw write at byte 0 of `SimUniforms`. Event records are
  mirrored between shaders and the readback parsers in `gpu-physics.js`: a 32-byte
  `MergeResult` change also touches `MERGE_RESULT_SIZE`, `collision.wgsl`,
  `merge-photons.wgsl`, and the field-excitation upload.
- **Shader cache.** Bump `SHADER_VERSION` after any WGSL edit; the query string is the
  only cache key.
- **New toggle or parameter.** Update `physics-contract.js`, `ui.js` (`toggleDefs`,
  deps), `presets.js` `TOGGLE_MAP`, `save-load.js` `TOGGLE_SYNC`, and
  `GPUPhysics.setToggles()` with its bit, then check that CPU and GPU saves round-trip it.
- **Saves.** `version: 1` holds particles, toggles, parameters, modes, speed, friction,
  and camera; fields and bosons are not saved. The quick-save key `nohair-quicksave`
  and download name `nohair-state.json` are stored names; renaming them orphans saves.
- **GPU slots.** `GPUPhysics.addParticle()` initializes every per-particle buffer.
  `axYukMod` starts at `(1, 1, 1, 0)` because its components are multiplicative
  modulations (EM coupling, Yukawa coupling, Higgs range factor) that zeros would switch
  off. The alive sentinel for `deathTime` is `FLT_MAX`
  (3.4028235e38), not `Infinity`.
- **Command ordering.** `queue.writeBuffer()` lands at submit, before any of the
  encoder's passes, so resets between dispatches in one command buffer use
  `encoder.copyBufferToBuffer()` or `clearBuffer()` (the tree can build twice per
  substep). Each readback channel's pending flag skips new copies while its staging
  buffer is mapped and clears in `finally`, so a lost device cannot wedge it.
- **WGSL.** Merge resolution guards with `mass <= EPSILON`, not `== 0`, because pairs
  race; NaN guards come before global-memory writes; render pipelines use premultiplied
  alpha with `srcFactor: 'one'`; entry points sharing a module declare shared bindings
  `read_write`.
- **CPU forces.** PE accumulates inside `pairForce()` (`_peAccum`); `potential.js` only
  recomputes it after preset loads. `computeAllForces()` caches `magMoment` and
  `angMomentum` from `bodyRadiusSq`, never the horizon. `forceRadiation` is zeroed for
  every particle before the substep loop because only Larmor sets it. 1PN forces are
  velocity-dependent and break Newton's third law, hence the velocity-Verlet
  correction; `compute1PN()` zeroes `force1PN` first.
- **History stride.** Both backends subtract `HISTORY_STRIDE` from the counter rather
  than resetting it; the GPU advances it by the frame's tick count.
- **Topology.** Klein and RP² crossings flip velocity and spin; RP² `wrapPosition()`
  iterates at most twice for simultaneous x/y crossings; periodic modes add ghost
  copies so tree forces cross the boundary, and history interpolation wraps through
  `minImage()`.
- **Lazy fields.** `sim.higgsField` / `sim.axionField` are `null` until first enabled;
  use `sim.ensureHiggsField()` / `ensureAxionField()`.
- **Input.** The antimatter toolbar mode (X) drives touch only; mouse users spawn
  antimatter with right-click. Click resolution is `InputHandler._resolveClickHit()`;
  black-hole mode never spawns antimatter.
- **CSS.** The shared `.mode-toggles` sets `display: flex`, which beats the `hidden`
  attribute, so those rows are shown and hidden with `style.display`.
- **URLs.** Geon's own files load by relative URL (`styles.css`, `colors.js`, `main.js`,
  the shaders), which resolves only under `/geon/` with its trailing slash.

## Open work

`docs/ROADMAP.md` holds the plan: §2.2–2.3 list known physics bugs and audit leftovers,
§3 the milestones (M0 next; M0′ retires the CPU path). Not tracked there:

- Hidden Disintegration (its control's parent is `display:none`; no preset enables
  it): fragments split the parent's charge evenly and `addParticle()` rounds each
  share, so charge survives only when it divides into `SPAWN_COUNT` quanta, and a
  Coulomb-driven breakup leaves fragments over threshold, cascading into dust.
- `pass-graph.js` gates photon passes on Radiation, but `merge-photons.wgsl` emits
  annihilation photons with Radiation off; those photons then never update (found by
  reading the code, not reproduced).
- `src/canvas-renderer.js` is dead, and the `torque-render.wgsl` header table swaps the
  contact (0.5) and superradiance (1.0) arc offsets relative to `getTorqueOffset()`.
