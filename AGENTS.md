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
  (open `http://localhost:8000/geon/tests/physics-validation.html` and press Run, or call
  `runAll()` from the console; `runAll('Liénard')` runs the cases whose names contain the
  string). Every new feature adds its oracle there (`docs/ROADMAP.md` §1.1).
  The stager skips `tests/`, so it never deploys.

## Layout

```
index.html               page shell, sidebar (Settings / Stats / Particle / Frame), JSON-LD
main.js                  Simulation: state, device lifecycle, fixed-timestep loop
colors.js                charge and spin hues added to the shared palette
i18n/strings.js          UI strings (en, ja); merges strings-reference.js (reference overlay)
src/config.js            constants, mode enums, Kerr–Newman and Paczyński–Wiita helpers
src/physics-settings.js  the toggle and parameter store (sim.settings)
src/physics-contract.js  toggle/parameter keys shared by save/load and the GPU slot map
src/ui.js                controls, toggle dependencies, settings dropdown, shortcuts, about
src/input.js             spawn, select, delete through GPU hit tests
src/overlay.js           the 2D canvas above the GPU canvas: the spawn-drag line
src/presets.js           22 presets (PRESET_ORDER); each may set its domain
src/cosmology.js         the scale factor a(t): schedules, the Friedmann closure, horizons
src/cosmology-panel.js   the Stats tab's expansion readouts and the overlay's horizons
src/frames.js            the observer the view is drawn for (sim.frames), FrameParams
src/frame-panel.js       the Frame tab: frame choice, parameters, readouts, scrubber
src/minkowski.js         the Frame tab's 1+1 spacetime diagram
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
src/gpu/shaders/         62 WGSL files; shared-*.wgsl are prepended includes
tests/physics-validation.html   analytic oracles against a headless GPUPhysics
```

## How it works

### State and the frame loop

`Simulation` (`main.js`) owns the domain, camera, modes, selection, and the settings
store `sim.settings` (`physics-settings.js`), which `ui.js` writes and
`GPUBackend.applySettings()` copies into `GPUPhysics.setToggles()`. View flags (trails,
clocks, vectors) live in `sim.view`, the potential heatmap's state in `sim.heatmap`.

The domain is state, not the window: `sim.domainW`/`domainH` in world units, square
`DEFAULT_DOMAIN` (64) unless a preset sets `domain: [w, h]` or a save carries one.
`sim.setDomain()` resizes the GPU domain and calls `fitCamera()`, which fits it to the
window; resizing the window moves only the camera. Clear restores the default.

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
clears itself; each stats readback carries the selection it was requested for
(`selectedIdx`), so one still in flight when the selection changes is ignored.

### Units and particle state

- c = G = ħ = 1. `WORLD_SCALE` (16) is pixels per world unit at zoom 1; the camera's
  zoom is relative to it.
- Linear and rotational state are proper velocities (`ParticleState.velW`, `angW`);
  `derived.vel` and `angVel` come from them in `cache-derived.wgsl` and equal them with
  relativity off. The spawn spin slider is a surface speed.
- `derived.bodyRSq` = ∛m² is the body radius and the source of moment of inertia,
  magnetic moment, and angular momentum. In black-hole mode `ParticleAux.radius` and
  `derived.radiusSq` hold the Kerr–Newman horizon instead.
- Charges are multiples of `BOSON_CHARGE` (0.1): `addParticle()` rounds, pions and
  leptons carry 0 or ±`BOSON_CHARGE`, and emission, absorption, decay, Schwinger
  discharge, extremal shedding, and Roche transfer move whole quanta.
- Energy totals include rest mass plus kinetic, spin, potential, field, and radiated
  terms. Radiated is the boson pools (`boson-ledger.wgsl`: photons, pions and leptons),
  the radiation bodies have lost but not yet emitted (the `RadiationState`
  accumulators), and escaped radiation: the pool culls bound memory, so what they
  remove goes to `GPUPhysics.ledger.escapedE` instead of vanishing. Stats readbacks
  carry the state version, scale factor and ledger as of their request, so a readback
  in flight across a reset, spawn or removal can't set the drift baseline.

### Integrator

`GPUPhysics.update()` gets the frame's whole tick count (`n·PHYSICS_DT`) and splits it
into at most 32 substeps from the previous frame's `maxAccel` readback,
`dtSafe = √(softening/a_max)` (no cyclotron limit), and submits each substep as its own
command buffer so that substep's uniforms (`simTime` above all) are the ones its passes
read. `_dispatchSubstep()` lists the order in its pass comments: forces, external and
field forces come before the fused kick–rotate–kick, then spin-orbit and torques,
radiation, drift, clocks, the 1PN velocity-Verlet correction, the field step,
collisions, disintegration, bosons, the boundary, and the world lines (a sample whenever
the world-line clock crosses the next `WORLDLINE_DT` mark, else merge breaks and death
snapshots only). After the substeps, once per frame: the expansion (below), the pool
culls, pion decay, boson interaction, dead-slot GC, quadrupole radiation, colors, and
trails. The scheme is the staggered Boris pusher:
both half-kicks precede the drift, so velocities sit half a kick from positions, and
spin-orbit kicks change `w` directly rather than through `totalForce`.

GPU times are f32 relative to a rolling epoch on the world-line clock: lab time, or
conformal time η (dη = dt/a) while the universe expands, kept in f64 as
`conformalTime`; `gpuTime = conformalTime − timeEpoch`, and `_maybeRebaseEpoch()`
advances the epoch by `EPOCH_STEP` (256) once GPU time passes `EPOCH_SPAN` (512),
shifting every stored time back (`worldline-rebase.wgsl`). `SimUniforms.simTime` is that
clock: only world-line samples, creation times and `ParticleAux.deathTime` hold
absolute GPU times. Lab time `simTime` stays an f64 in JS.

### Expansion

Expansion requires the torus (decision 3, refined after Codex's review: the toggle
switches the boundary to loop and the topology to torus): the universe is the periodic
domain, a slab of comoving thickness `SHEET_THICKNESS` cut from flat 3D FRW. Klein and RP²
are out because they aren't homogeneous: there the minimum-image pull of a uniform
background doesn't cancel.

- **The scale factor** (`cosmology.js`, `GPUPhysics.cosmology`): `step(dt)` integrates
  `da/dt = a·H(a)` by RK4 for the schedule chosen under the toggle: de Sitter, matter,
  radiation, ΛCDM (Ω_m 0.3), or the Friedmann closure `H² = (8π/3)ρ̄ + H_Λ²`. The slider
  (logarithmic) is H₀ for the imposed schedules and the vacuum H_Λ for the closure, whose
  ρ̄ comes from each stats readback (`_absorbLedger`): rest plus kinetic energy of bodies,
  pions and leptons, photons with pending and escaped radiation, and the fields' slab
  energy, over `a³·W_c·H_c·ℓ`; between readbacks matter and fields scale as a⁻³ and
  radiation as a⁻⁴. a stops at `A_MAX` (1000, single precision) with a toast.
- **Physical coordinates on a growing domain.** `sim.domainW/H` is the comoving domain
  (state, saved); `GPUPhysics.domainW/H` is a times it (`setComovingDomain`). The forces
  never see a. `update()` splits the stretch symmetrically (Strang): `expansion.wgsl`
  scales every position (bodies, retired bodies, photons, pions, trails) by √r about the
  domain's corner and every peculiar momentum and photon energy by 1/√r before the
  substeps and again after them, r = a_new/a_old, and the substeps run in a static
  universe at the midpoint a (`_frameA`, which `scaleA` returns meanwhile). On the torus
  that is the comoving dynamics, `ẋ = Hx + v`, `ẇ = f − Hw`, which at low speed is
  `d̈ = (ä/a)d + f`; the mean density's pull cancels over each body's minimum-image
  cell. `GPUBackend._advance` splits a frame whose H·dt exceeds 0.02. The camera follows the universe (`sim.followExpansion`); the comoving
  view zooms out with it, and the grid's rulers are comoving.
- **World lines are comoving and conformal:** samples hold C = x/a on the cover,
  conformal time and dw/dη = a·(dw/dt − H·w) (the continuous Hubble drag, though the
  frame applies it at the stretches), and boundary decks are comoving.
  `retardedState(…, scaleA)` solves the flat cone in (η, C) and returns `rel·a` and
  `acc/a`, so the flat-space Liénard–Wiechert formula gives E_phys = E_conformal/a²
  (Maxwell is conformally invariant), with radiation fields dimmed by 1/(1 + z): exact
  for the trajectory the samples describe, which is interpolated (Hermite positions,
  linear accelerations) and sees one image of each source.
  The other laws use the same physical retarded position. Non-lab frames are off once a
  ≠ 1 (FRW has no global boosts); the spacetime diagram becomes the conformal diagram.
- **Fields** (below) feel Hubble friction, thin their particle sources by 1/a and count
  a slab energy of a times the grid's.
- **The ledger.** `GPUPhysics.ledger.expansionWork` is the energy the expansion took,
  so `E_total + W` should hold: kinetic and photon redshift summed exactly in
  `expansion.wgsl` (`cosmoAccum[0]`); the fields' share in `field-ledger.wgsl`, the
  Hubble friction metered exactly around its own operator (`hubbleFriction`) and the
  stretch from the state just before it; and in JS the stretched potentials to first
  order (`stats[26]` = Σ d·∂V/∂d) and the escaped background's redshift (culled photons
  arrive comoving, a·E, and convert at the a they're read at; culled leptons are matter).
  Momentum drift compares a·P, which expansion conserves on the torus.
- **Readouts:** the Stats tab's Expansion section (`cosmology-panel.js`): a, H, c/H, the
  event horizon (finite only with a vacuum term), the Friedmann density, and ln a and H
  over the run; the overlay rings the selection (or the view's centre) with c/H and the
  event horizon.

The Boris rotation parameter is `(q/2m)·Bz + 2·Bgz`, scaled by dt/γ, so the stored fields
act as `F = q v × B + 4m v × Bg`. In the force shaders the displacement r is source −
observer, so a positive radial coefficient attracts. The fields, in that convention:
- Moving charge (Biot–Savart, B = q v × R̂/R² with R̂ toward the observer):
  `Bz = −q (v × r)_z/r³`. Parallel currents attract.
- Magnetic dipole: `Bz = −μ/r³` in the plane; aligned dipoles side by side repel,
  `−3μ₁μ₂/r⁴`.
- Moving mass: `Bgz = +m (v × r)_z/r³`. Parallel mass currents repel, and `4m v × Bg` is
  exactly EIH's v₁·v₂ sector, which the 1PN pair force leaves out.
- Spinning mass: `Bgz = +J/(2r³)` in the plane, which slows prograde orbits
  (Ω_pro = Ω_K − J/r³); the gravitomagnetic dipole force `+3L₁L₂/r⁴` attracts.
Those signs were reversed until 2026-10-23 (`docs/ROADMAP.md` §2.1); the oracle page pins
each. 1PN forces are velocity-dependent and break Newton's third law, hence the
velocity-Verlet correction.

### Forces and toggles

Sixteen toggles (`TOGGLE_KEYS`). Their dependency graph is the declarative
`_forms.bindDeps()` list in `ui.js`; `updateAllDeps()` adds the mode locks (Black hole
and the hidden Disintegration force Merge collisions, Expansion forces Loop). Less
obvious couplings: Boson interaction needs the Barnes–Hut toggle (settings dropdown);
signal delay runs whenever Relativity is on, and with it charges interact through their
Liénard–Wiechert fields; field gravity follows Gravity; kugelblitz runs under Boson
interaction with Gravity. The 1PN pair forces (`shared-1pn.wgsl`, shared by the force
pass and the velocity-Verlet recompute): EIH with Gravitomagnetic (not Gravity),
Bažański's mixed static term with Gravitomagnetic and Coulomb, scalar Breit with Yukawa.
There is no Darwin term: Liénard–Wiechert carries EM to all orders in v.

Barnes–Hut picks tree walk over pairwise forces; collisions and hit tests use the tree
either way. With Relativity on as well, EM runs pairwise first (`EM_PAIRWISE_BIT`):
Liénard–Wiechert needs each source's world line, which tree aggregates lack, so the walk
carries everything else. Periodic modes put ghost copies in the tree for seam collisions
and hit tests, but ghosts weigh nothing in the aggregates (`tree-build.wgsl`), because
every walk takes minimum-image displacements and a weighted ghost would count its pair
twice. With Higgs on, the Yukawa range is `yukawaMu·√(higgsMod_i·higgsMod_j)`,
`higgsMod = max(|φ|, HIGGS_MASS_FLOOR)` cached per particle in `axYukMod.z`.

Signal delay finds each source's retarded state, `retardedState()` in
`shared-worldline.wgsl`: the image nearest the observer now fixes which copy of the world
line it sees; a binary search brackets the past light cone among the samples plus the
source's current state, and Newton's method finds it on the cubic Hermite segment. The
result carries position, velocity, acceleration, angw, mass and charge at the retarded
time. Charges act through their Liénard–Wiechert fields, E = q[(n̂ − β)(1 − β²)/(κ³R²) +
n̂ × ((n̂ − β) × β̇)/(κ³R)] and B = n̂ × E, both scaled by σ³ with σ = R/√(R² + ε²) so that
a charge at rest gives the softened Coulomb field, and κ floored at `LW_KAPPA_MIN`
(1/κ³ ≤ 100). Every other law is its static form at the retarded position times the toy
aberration factor (1 − n̂·v)⁻³. The heatmap's electric potential is q/(κR). Removed
particles keep sourcing forces until the light from their world line's end has passed:
retired slots keep their death snapshot. A source's past before its first sample is
extrapolated as uniform motion back to its creation time and is invalid before it, so a
body spawned by hand sources nothing until its light arrives; preset and loaded bodies are
created at `−∞` and act at once.

### Proper time, the spoke, and world lines

- **Clocks** (`clocks.wgsl`, after the drift; one `vec4` per slot in `buffers.clocks`:
  τ, ring phase, θ, lapse). τ advances by `dτ = dt·√max(0, 1 + 2Φ_N − v²)`, with Φ_N
  summed over particles with the force softening (`BH_SOFTENING` in black-hole mode;
  never Paczyński–Wiita, which vanishes at 4M). Field gravity Φ_F is not in the lapse.
  With Relativity off the lapse is 1.
- **Spoke angle θ** is the in-plane transported axis, `θ = θ_FW + ω₀τ`; it never
  touches `angW`. It advances by `ω·dτ` (ω the rest-frame rate, or Ω_H in black-hole
  mode) plus three precessions in lab time: Thomas, `(γ²/(γ+1))·(a × v)` from the
  non-gravitational acceleration only (`totalForce` minus the gravity, gravitomagnetic
  dipole, 1PN and external-gravity parts, plus the Boris magnetic Lorentz force);
  geodetic, `−(3/2)·(g × v)` with g the Newtonian field; and Lense–Thirring,
  `Σ −J_j/r³`, with Gravitomagnetic on. Klein and RP² crossings mirror θ
  (`boundary.wgsl`).
- **The spoke** (`particle.wgsl`): each body is its rest-frame disk pushed through the
  Lorentz map of its centre's velocity. The vertex shader contracts the quad by 1/γ
  along v; the fragment shader maps each lab offset to its rest-frame offset
  `Δ + (γ − 1)(Δ·n̂)n̂` and draws the spoke at `θ + ω·(−γvΔ∥)`, the angle it held at
  that point's rest-frame time, so a spinning, moving spoke bends by `2·v·v_rim` across
  the diameter. The spoke is drawn only on bodies at least 4 px in radius.
- **The Clocks overlay** (K, settings dropdown; `clock-render.wgsl`): a faint ring per
  body and an accent arc that fills once per `CLOCK_PERIOD` (16) of its proper time,
  contracted with the body. The particle panel shows τ and dτ/dt.
- **World lines** (`worldline.wgsl` writes, `shared-worldline.wgsl` reads): a ring of
  `WORLDLINE_LEN` (1024) samples per slot, one every `WORLDLINE_DT` (1/8) of the
  world-line clock (lab time, or conformal time under expansion: positions are then
  comoving, see Expansion), always recorded. A sample is 12 floats, `t, x, y, wx, wy, ax, ay, τ, θ, angw, m, q`
  (`WL_STRIDE`), with a = dw/dt including the Boris magnetic and gravitomagnetic
  rotation. Samples live on the covering plane: each slot's deck maps its wrapped
  position to `C = A·x + b` (A a diagonal of ±1), and `boundary.wgsl` updates the deck
  at every loop crossing so C never jumps; velocities, accelerations, θ and angw are
  mirrored with it. Meta (`WL_META_STRIDE` = 8): `writeIdx, count, creationTime,
  generation, deck flips, bx, by, _pad`; the generation counts the slot's occupants
  (`_slotGeneration`). `addParticle()` writes a birth sample and an identity deck; a
  removal writes a death snapshot with the death mass (`FLAG_DEATH_HIST`); a merge sets
  `FLAG_WL_BREAK` on the kept slot, and the next substep records the old body
  extrapolated to now and the merged body at the same time, so no segment smooths the
  jump. The epoch rebase also maps each line by its inverse deck, back to the identity.
- **Continuity.** An inelastic merge keeps the heavier parent's slot, so its τ and θ
  carry on; disintegration fragments and Roche transfers copy the parent's clock
  (`addParticle({ inheritClockFrom })`, through `_clockScratch`, since
  `copyBufferToBuffer` cannot copy within one buffer).

### Frames

`sim.frames` (`frames.js`) names the observer the view is drawn for: the lab (the
simulation's own frame), zero momentum, the selected particle, a boost (rapidity and
direction), or co-rotation at a rate Ω about the point the camera was on. Frames are a
view: spawning, selection, deletion and hover act in the lab, and `input.js` ignores the
canvas while a frame is active.

- **Slicing** (`frame-slice.wgsl`, from `GPUBackend.render()` each rendered frame).
  `frameAnchor` (one thread) finds the observer's lab velocity u and its anchor event
  (t_A, X_A) and writes `FrameState`; `sliceWorldLines` (one thread per slot and image)
  finds where each world line crosses the observer's now, `t − u·x = t_A − u·X_A` with
  Relativity on and `t = t_A` with it off or in co-rotation, and writes the view buffers
  (`viewState`, `viewAux`, `viewDerived`, `viewClocks`) that the body, clock and ring
  pipelines draw in place of the live ones. On the slice a lab offset Δ maps to
  `x′∥ = Δ∥/γ` with velocities by relativistic addition; τ and θ come from the world line at
  the crossing.
- **The lagged view.** t_A = now − lag with `lag = |u|γ·max(x′·û)` over the visible
  rectangle plus the scrubber's look-back, capped at the ring's reach (127), so everything
  drawn has already been computed. The HUD names the lag (`lab − 23`) and says when part
  of the slice falls outside the recorded history, where `wlOnSlice` extrapolates at
  constant velocity.
- **Images.** Each world line is mapped from its covering plane through the image nearest
  the frame's reference point (the anchor's wrapped position now). On a torus every body
  is drawn as its 3×3 nearest images (`frames.images`), `γL` apart along u with clocks
  `γvL` apart, because the torus identification holds at equal lab time; Klein and RP²
  draw the primary image only. Instances are `alive × images`, and `particle.wgsl` reads
  each body's colour at `instance / images`.
- **Bosons** (`boson-render.wgsl`) are drawn where their straight paths cross the slice,
  no earlier than their emission; photons take the Doppler factor `γ(1 − u·v̂)` in hue.
- **What frames skip:** trails, force and velocity arrows, torque arcs, the heatmap and
  the field overlays stay lab-only and are hidden in a frame.
- **The camera** in a frame is in observer coordinates with the observer at the origin;
  leaving the lab saves the lab camera and returning restores it. Resizing keeps the
  observer centred.
- **The scrubber** (Look back) adds lag while paused, so a paused run can be re-sliced
  further into its past.
- **The spacetime diagram** (`minkowski.js`): while the Frame tab is visible it reads the
  observer (or selection) and the 11 bodies nearest it every 250 ms
  (`readSlotsSnapshot`, `readWorldLines`) and plots their world lines projected on the
  observer's direction of motion, x′∥ across and t′ up at equal scales, with the
  observer's now, its light cone, the lab's now and proper-time ticks every `CLOCK_PERIOD/2`.
  In the lab its axes are lab x and t through the camera's centre.
- **Shortcuts:** B cycles frames (skipping the particle frame without a selection),
  L returns to the lab, G toggles the grid.

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
  An inelastic merge's lost kinetic energy excites the scalar fields instead (Scalar fields).
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
antimatter. Scalar sources couple through proper time (`× 1/γ`). An inelastic merge's lost
kinetic energy enters `fieldDot` as impulses solved against the existing `fieldDot` cross
term, so field kinetic energy rises by exactly the event energy, shared among the active
fields (`field-excitation.wgsl`); annihilation energy is all in its photons. Each event is
consumed once.

**Damping and the bath.** The fields' ether damping (Higgs `2m_H`, axion `g·m_a`) is the
`fieldDamping` setting, on by default. `setHiggsQuench(τ_Q, T)` (the Kibble–Zurek preset)
ramps the Higgs mass term as `ε·μ²`, ε = −1 + t/τ_Q clamped to [−1, 1], and adds a
Langevin bath `⟨ξ²⟩ = 2γT/(cellArea·dt)` on the Higgs damping, an independent draw per
half-kick. The quench and the bath do work the ledger doesn't book. The Higgs overlay measures
from the current vacuum √ε and colours φ < 0 with the enhanced hue.

**Under expansion** the grid is comoving (its cells grow with a, so the Laplacian is
physical), `hubbleFriction` applies `φ̇ ← φ̇·e^{−3H dt}` each substep, particle sources
thin by 1/a, and the slab's field energy and momentum are a times the grid's (stats,
Friedmann density, excitation and superradiance impulses scaled by 1/a). The
convention: the grid holds the dimensionally reduced field ψ = √ℓ·φ_3D, uniform through
the slab, so the slab's energy is a·ℓ·Σ(…)dA in φ terms and the ℓ is absorbed into ψ and
the couplings.

**Grid gravity.** With Gravity on, the fields evolve in the metric
`ds² = −e^{2Φ}dt² + e^{−2Φ}d𝐱²`, where the Klein–Gordon equation is exactly
`φ̈ = e^{4Φ}∇²φ − e^{2Φ}V′ + 4Φ̇φ̇` (the 3+1 weak-field form at small Φ, with no
gradient-coupling term). Particle sources carry `e^{5Φ}` in the kick (the e^{Φ} of
proper time on top of the kinetic normalization), and damping is a proper-time rate
(`× e^{Φ}`). `field-gravity.wgsl` builds Φ on one shared grid
(`createGravityGridBuffers`): Φ_F from both fields' energy (also the field → particle
force) and Φ_P from the particles' rest mass, each an FFT convolution with
`−1/√(r² + ℓ²)`, `ℓ = SHEET_THICKNESS` (8, independent of the particle softening ε).
ℓ is comoving: Ĝ is built on the comoving grid and the unpacks scale by 1/a, the fields'
source is their slab energy, and while the universe expands Ĝ drops k = 0.
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
the spawn-drag line. Each frame starts with the background grid (`grid-render.wgsl`), a
full-screen pass that clears and then draws the lab rulers and the domain edge: hairlines at
spacings 2^k, each level faded in between 12 and 24 px on screen, and the edge (or, in loop
mode, the seams) in the `--border` mix. The grid is a sheet at rest in the lab, so in a
non-lab frame each pixel maps back through the observer's slice and the rulers contract by
1/γ along u and turn with co-rotation; `sim.view.grid` (G) hides the rulers but not the
edge. Bodies, their clock rings, and their ring overlays share the camera uniforms'
`relativityOn`, `blackHoleOn`, `showClocks`, `frameOn` and `frameImages` flags. It clears to `_PALETTE.{light,dark}.canvas`, with light/dark
pipeline pairs that `setTheme()` swaps. `syncRendererTheme()` in `ui.js` sets both;
`GPUBackend.create()` adopts `sim.overlay.isLight` after `renderer.init()` because it is
created after the first sync. WGSL theme colors are light/dark constant pairs picked by
the `isDarkMode` uniform. The sidebar plots redraw with every stats readback, so their
canvas text needs no font-load redraw.

## Conventions

- **Naming.** Code, comments, and UI text say "signal delay" or "finite-speed force
  propagation", never "retarded potential(s)" (a9's rule; `docs/ROADMAP.md` §12 adds
  "light-cone" and "Liénard–Wiechert").
- **Force laws.** A force-law change touches `pair-force`, `forces-tree`,
  `compute-stats` (PE), and `heatmap.wgsl`, and `effective-potential.js` for the plot;
  a 1PN change touches `shared-1pn.wgsl` alone. Spin-orbit (`spin-orbit.wgsl`) applies
  `F = μ∇Bz` and `F = +2L∇Bgz` (a spinning body's gravitomagnetic moment is 2L), from the
  moving-source field gradients only: dipole fields add no gradient, since the direct
  dipole-dipole terms already carry spin-spin.
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
- **Saves.** `version: 2` holds the domain, particles with τ and θ, toggles,
  parameters, modes, speed, friction, and camera; fields, bosons, and world lines are
  not saved. `migrateState()` lifts a version 1 save (domain = this window / 16, clocks
  at 0). The quick-save key `nohair-quicksave` and download name `nohair-state.json`
  are stored names; renaming them orphans saves.
- **GPU slots.** `GPUPhysics.addParticle()` initializes every per-particle buffer.
  `axYukMod` starts at `(1, 1, 1, 0)` because its components are multiplicative
  modulations (EM coupling, Yukawa coupling, Higgs range factor) that zeros would switch
  off. The alive sentinel for `deathTime` is `FLT_MAX` (3.4028235e38), not `Infinity`.
  Slots are recycled through the free stack, so a slot index names a particle only
  while it lives.
- **Command ordering.** `queue.writeBuffer()` lands at submit, before any of the
  encoder's passes. Substeps submit separately, so uniforms may differ between them;
  anything that must differ between passes of one substep goes through
  `encoder.copyBufferToBuffer()`, `clearBuffer()`, or a dynamic offset into a static
  table (the FFT). Each readback channel's pending flag skips new copies while its
  staging buffer is mapped and clears in `finally`, so a lost device cannot wedge it.
- **Bind groups.** One buffer may not fill two writable bindings of a dispatch; dummy
  placeholders come in distinct buffers.
- **WGSL.** Merge resolution guards with `mass <= EPSILON`, not `== 0`, because pairs
  race; NaN guards come before global-memory writes; render pipelines use premultiplied
  alpha with `srcFactor: 'one'`; entry points sharing a module declare shared bindings
  `read_write`.
- **World-line cadence** is by lab time, not ticks: `_nextWorldLineTime` steps to the
  next multiple of `WORLDLINE_DT`, so a sample lands at the end of the substep that
  crosses it.
- **Topology.** Klein and RP² crossings flip velocity and spin and mirror θ; periodic
  modes add ghost copies so tree forces cross the boundary, and world-line
  interpolation wraps through `minImage()`.
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
- The `magnetic` preset drives a body to about 0.99c, as it did before the 2026-10-23
  force-law fixes.
- `preset-select`'s shared-dropdown label may not refresh when a preset loads from the
  keyboard; `FramePanel._sync()` shows the fix (dispatch `change` after setting the value).
- The Kepler preset places its planets at random angles without zeroing the total
  momentum, so the system drifts at up to ~0.1c.
- `compute-stats.wgsl`'s velocity-dependent energies (Darwin field energy, the EIH and
  Bažański 1PN terms) predate the 2026-10-23 force audit and don't match the forces now
  applied, so 1PN and magnetic runs show a drift that is bookkeeping, not dynamics.
- Schwinger and extremal-shedding leptons carry kinetic energy the hole never pays
  (see Black holes); now that the pools count, the hawking preset's drift shows it.
