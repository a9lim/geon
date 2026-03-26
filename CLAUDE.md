# CLAUDE.md

Part of the **a9l.im** portfolio. See root `CLAUDE.md` for the shared design system, head loading order, CSS conventions, and shared code policy. Sibling projects: `shoals`, `cyano`, `gerry`.

## Shared Code Policy

Always prefer shared modules over project-specific reimplementations. This project uses: `shared-tokens.js`, `shared-utils.js`, `shared-haptics.js`, `shared-toolbar.js`, `shared-forms.js`, `shared-intro.js`, `shared-base.css`, `shared-tabs.js`, `shared-camera.js`, `shared-info.js`, `shared-shortcuts.js`, `shared-touch.js`, `shared-tooltip.js`. Before adding utility code, check whether a `shared-*.js` file already provides it. New utilities useful across projects should be added to the shared files in the root repo.

## Style Rule

Never use the phrase "retarded potential(s)" in code, comments, or user-facing text. Use "signal delay" or "finite-speed force propagation" instead.

## Running Locally

```bash
cd path/to/a9lim.github.io && python -m http.server
```

Serve from `a9lim.github.io/` -- shared files load via absolute paths. ES6 modules require HTTP. No build step, test framework, or linter.

## File Map

```
main.js                   838 lines  Simulation class, fixed-timestep loop, backend selection (CPU/GPU),
                                      pair production, pion/lepton loop, dirty-flag render, window.sim
index.html                498 lines  UI: 4-tab sidebar, reference overlay, zoom controls, field sliders
styles.css                295 lines  Project-specific CSS overrides, toggle/slider theme colors
colors.js                  18 lines  Project color tokens (extends shared-tokens.js)
PERFORMANCE_AUDIT.md              Performance audit notes
PHYSICS_AUDIT.md                  Physics accuracy audit notes
src/
  integrator.js          1622 lines  CPU physics: Boris substep loop, radiation, pion emission/absorption,
                                      field excitations, tidal, GW quadrupole, expansion, Roche, external fields,
                                      Hertz bounce, scalar fields
  fft.js                  112 lines  Compact radix-2 FFT: in-place Cooley-Tukey for 2D convolution, no dependencies
  scalar-field.js         858 lines  ScalarField base: PQS grid, topology-aware deposition, Laplacian, C²
                                      gradients, field energy, excitations, particle-field gravity, self-gravity
  forces.js               921 lines  CPU pairForce(), computeAllForces(), calculateForce() (BH walk, uses
                                      BH_THETA_SQ const directly), compute1PN(), topology-aware boson
                                      gravity, PE accumulator (resetPEAccum/getPEAccum),
                                      Higgs-modulated Yukawa μ (higgsMod per particle)
  ui.js                   716 lines  setupUI(), declarative dependency graph, info tips, reference overlay,
                                      shortcuts, dirty flag, KaTeX render cache, lazy field init triggers
  reference.js            725 lines  REFERENCE object: physics reference content (KaTeX math)
  renderer.js             707 lines  CPU Canvas 2D renderer (used as fallback when GPU unavailable)
  presets.js              680 lines  PRESETS (19 scenarios, 4 groups), loadPreset(), SLIDER_MAP, TOGGLE_MAP/TOGGLE_ORDER
  input.js                393 lines  InputHandler: mouse/touch, left/right-click symmetry (matter/antimatter),
                                      GPU deferred hit test (pollGPUHitResult), tree-accelerated CPU hit test
  quadtree.js             348 lines  QuadTreePool: SoA flat typed arrays, pool-based, zero GC, depth guard,
                                      iterative insert, direct quadrant child selection, boson distribution
  heatmap.js              315 lines  64x64 potential field overlay, signal-delayed positions, force-toggle-aware
  higgs-field.js          384 lines  HiggsField: Mexican hat potential, mass modulation, thermal phase transitions,
                                      portal coupling (otherField param), portalEnergy(),
                                      modulatePionMasses(), higgsMod caching
  axion-field.js          328 lines  AxionField: quadratic potential, aF² EM coupling, PQ pseudoscalar coupling,
                                      portal coupling (otherField param)
  signal-delay.js         260 lines  getDelayedState() (3-phase light-cone solver, creationTime/deathTime guards,
                                      minImage-wrapped interpolation for periodic boundaries)
  save-load.js            259 lines  saveState(), loadState(), downloadState(), uploadState(), quickSave/Load()
                                      Persists: yukawaMu, axionMass, higgsMass, extGravity/Electric/Bz + angles
  stats-display.js        250 lines  Sidebar energy/momentum/drift readout, textContent change detection
  effective-potential.js  247 lines  V_eff(r) sidebar canvas, auto-scaling, axMod/yukMod/higgsMod modulation, dirty-flag skip
  pion.js                 261 lines  Massive Yukawa force carrier: proper velocity, (1+v²) GR deflection, decay, pool,
                                      baseMass for Higgs mass modulation in flight. Charged decay emits Lepton.
  lepton.js               113 lines  Lepton (electron/positron): massive charged fermion, proper velocity,
                                      gravity + Coulomb deflection via BH tree, object pool, no decay
  potential.js            211 lines  computePE(), treePE(), pairPE() (7 PE terms)
  energy.js               195 lines  KE, spin KE, PE, field energy, momentum, angular momentum
  config.js               168 lines  Named constants, mode enums (COL_*/BOUND_*/TORUS/KLEIN/RP²), helpers
  collisions.js           158 lines  handleCollisions(), resolveMerge(), annihilation, relativistic merge KE
  particle.js             133 lines  Particle: pos, vel, w, angw, baseMass, 11 force Vec2s, higgsMod, signal delay history
  phase-plot.js           137 lines  Phase space r-v_r plot (512-sample ring buffer)
  topology.js             131 lines  minImage(), wrapPosition() for Torus/Klein/RP² (RP² uses iterative
                                      wrapping, max 2 passes, to handle simultaneous x+y out-of-bounds)
  massless-boson.js        91 lines  MasslessBoson: pos, vel, energy, type ('em'/'grav'), BH tree lensing, pool
  vec2.js                  58 lines  Vec2 class: set, clone, add, sub, scale, mag, normalize, dist
  boson-utils.js           59 lines  treeDeflectBoson()/treeDeflectBosonCoulomb(): shared BH tree walk
                                      for photon/pion lensing, topology-aware via minImage
  backend-interface.js     56 lines  PhysicsBackend/RenderBackend typedefs, BACKEND_CPU/BACKEND_GPU constants
  cpu-physics.js           25 lines  CPUPhysics: thin adapter wrapping Physics (integrator.js) to PhysicsBackend
  relativity.js            25 lines  angwToAngVel(), setVelocity()
  canvas-renderer.js       20 lines  CanvasRenderer: thin adapter wrapping Renderer to RenderBackend
  gpu/
    gpu-physics.js       3893 lines  GPUPhysics: WebGPU compute pipeline orchestrator, addParticle/serialize,
                                      all dispatch methods, bind group creation, adaptive substepping, readback,
                                      readbackFieldData() for GPU→CPU field migration, per-field uniform
                                      buffers (Higgs/Axion), pre-allocated write buffers, _phase5Ready guard
    gpu-pipelines.js     1966 lines  Pipeline + bind group layout creation for all compute/render shaders,
                                      fetchShader() (single source of truth), getSharedPrefix() caching
    gpu-renderer.js      1215 lines  WebGPU instanced rendering: particles, bosons, field overlays, heatmap,
                                      trails, force arrows, spin rings, torque arcs, dashed rings
                                      (dual light/dark pipeline variants)
    gpu-buffers.js        569 lines  Buffer allocation: packed structs, quadtree, collision, field, history,
                                      trail buffers, staging, boson tree visitor flags
    gpu-constants.js      299 lines  buildWGSLConstants(): generates WGSL const block from config.js +
                                      _PALETTE colors, single source of truth for JS/WGSL constants.
                                      paletteRGB() delegates to _parseHex(); hslToRGB via _hsl2rgb()
    shaders/               52 files  WGSL compute + render shaders (10120 lines total)
```

## Key Imports

```
main.js       <- Physics, Renderer, InputHandler, Particle, HiggsField, AxionField,
                 Heatmap, PhasePlot, EffectivePotentialPlot, StatsDisplay, setupUI, config,
                 MasslessBoson, Pion, Lepton, save-load, relativity,
                 BACKEND_CPU/BACKEND_GPU (backend-interface), CPUPhysics, CanvasRenderer,
                 GPUPhysics, GPURenderer

integrator.js <- QuadTreePool, config, MasslessBoson, Pion, angwToAngVel,
                 forces (resetForces/computeAllForces/compute1PN/computeBosonGravity/findLeptonAnnihilations),
                 handleCollisions, computePE, topology

forces.js     <- config, getDelayedState, topology
energy.js     <- config, topology (window.sim for fields)
potential.js  <- config, topology
scalar-field.js <- config, topology (minImage for gravity)
higgs-field.js  <- config, ScalarField
axion-field.js  <- config, ScalarField
boson-utils.js  <- config (BOSON_SOFTENING_SQ), topology (minImage)
massless-boson.js <- Vec2, config, boson-utils (topology params passed through)
pion.js         <- Vec2, config, boson-utils, Lepton (topology params passed through)
lepton.js       <- Vec2, config, boson-utils (topology params passed through)
save-load.js    <- BACKEND_GPU (backend-interface)

gpu-physics.js   <- gpu-buffers, gpu-pipelines (fetchShader + pipeline creators), gpu-constants
gpu-pipelines.js <- gpu-constants (buildWGSLConstants), exports fetchShader + getSharedPrefix
gpu-renderer.js  <- gpu-pipelines (fetchShader + render pipeline creators)
gpu-constants.js <- config, _PALETTE, _parseHex, _hsl2rgb (generates WGSL const block from JS constants + palette)
```

## Physics Engine

### Units & State Variables

c = G = ħ = 1. All velocities are fractions of c.

Both linear and rotational state use proper-velocity (celerity):

| State | Derived | Formula | Cap |
|---|---|---|---|
| `p.w` (γv) | `p.vel` | v = w / √(1 + w²) | \|v\| < c |
| `p.angw` | `p.angVel` | ω = W / √(1 + W²r²) | surface vel < c |

When relativity is off: `vel = w`, `angVel = angw` (identity).

Key derived quantities (INERTIA_K = 0.4, MAG_MOMENT_K = 0.2):
- Moment of inertia: `I = 0.4mr²`
- Magnetic moment: `μ = 0.2qωr²` -- cached as `p.magMoment`
- Angular momentum: `L = Iω` -- cached as `p.angMomentum`
- Particle radius: `r = ∛(mass)`; BH mode: `kerrNewmanRadius()` in config.js

`magMoment`/`angMomentum` cached per particle at start of `computeAllForces()` using `bodyRadiusSq` (intrinsic body radius, not horizon radius in BH mode). Used by `pairForce()`, `pairPE()`, BH leaf walks, spin-orbit, display. Ghost particles carry these cached fields.

### Per-Particle Force Vectors

11 Vec2s reset each substep via `resetForces()`: `forceGravity`, `forceCoulomb`, `forceMagnetic`, `forceGravitomag`, `force1PN`, `forceSpinCurv`, `forceRadiation`, `forceYukawa`, `forceExternal`, `forceHiggs`, `forceAxion`.

3 torque scalars: `torqueSpinOrbit`, `torqueFrameDrag`, `torqueTidal`.

### Boris Integrator

Per substep (inside `Physics.update()` while loop):

1. Store `_f1pnOld` (if 1PN enabled)
2. **Half-kick**: `w += F/m · dt/2` (E-like forces)
3. **Boris rotation**: rotate w in combined Bz + Bgz + extBz plane (preserves |v| exactly)
4. **Half-kick**: `w += F/m · dt/2`
5. Spin-orbit energy coupling, Stern-Gerlach/Mathisson-Papapetrou kicks, frame-drag torque
6. Radiation reaction (Landau-Lifshitz)
7. Pion emission (scalar Larmor, when Yukawa enabled) + radiation reaction on emitter
8. **Drift**: `vel = w / √(1 + w²)`, `pos += vel · dt`
9. Cosmological expansion (if enabled)
10. **1PN velocity-Verlet correction**: rebuild tree (if BH on), recompute 1PN at new positions, kick `w += (F_new - F_old) · dt/(2m)`. VV tree reused for step 12 when BH+1PN both on.
11. **Scalar fields**: evolve Higgs/Axion (Störmer-Verlet KDK), modulate masses, interpolate axMod
12. Reuse VV tree or rebuild quadtree, collisions (annihilation + merge KE tracking), repel, photon/pion absorption
13. Deposit field excitations from merge KE into active scalar fields
14. External fields, Higgs/Axion gradient forces, sync axMod, reset + recompute forces

After all substeps: record signal-delay history (strided, HISTORY_STRIDE=64), read cached PE from force-loop accumulator (`getPEAccum()`), reconstruct velocity-dependent display forces.

**Adaptive substepping**: `dtSafe = min(√(softening/a_max), (2π/ω_c)/8)` where `ω_c = max(|qBz/m|, 4|Bgz|, |q·extBz/m|)`. Capped at MAX_SUBSTEPS = 32.

**Fixed-timestep loop**: PHYSICS_DT = 1/128. Accumulator collects `rawDt × speedScale`, drained in fixed chunks.

## Force Types

### E-like Forces (radial)

Plummer softening: SOFTENING = 8 (SQ = 64); BH mode: BH_SOFTENING = 4 (SQ = 16).

| Force | Formula | PE | Toggle |
|---|---|---|---|
| Gravity | `+m₁m₂/r²` (attractive) | `-m₁m₂/r` | Gravity |
| Coulomb | `-q₁q₂/r²` (like-repels) | `+q₁q₂/r` | Coulomb |
| Magnetic dipole | `-3μ₁μ₂/r⁴` (aligned repel) | `+μ₁μ₂/r³` | Coulomb + Magnetic |
| GM dipole | `+3L₁L₂/r⁴` (co-rotating attract) | `-L₁L₂/r³` | Gravity + GM |

### B-like Forces (velocity-dependent, Boris rotation)

**Lorentz** (Coulomb + Magnetic): Bz from moving charge + spinning dipole. Display: `forceMagnetic += (q·vy·Bz, -q·vx·Bz)`.

**Gravitomagnetic** (Gravity + GM): Bgz from moving/spinning mass. Boris parameter: `+2Bgz·dt/γ`. Display: `forceGravitomag += (4m·vy·Bgz, -4m·vx·Bgz)`.

**Frame-dragging torque**: `τ = 2L_s(ω_s - ω_p)/r³`. Drives spin alignment.

### Tidal Locking

Always active when Gravity on (no toggle). `τ = -0.3 · coupling² · r_body⁵/r⁶ · (ω_spin - ω_orbit)`.

### Yukawa Potential

Independent toggle. `F = -g²m₁m₂e^{-μr}/r² · (1+μr)`. Parameters: `yukawaCoupling` (14), `yukawaMu` (0.15, slider 0.05-0.25). Includes analytical jerk for radiation. Emits pions as massive force carriers.

**Higgs mass modulation** (when Higgs enabled): Pion mass (Yukawa range parameter μ) derives from the Higgs mechanism. `μ_eff = yukawaMu · √(higgsMod_i · higgsMod_j)` where `higgsMod = max(|φ(x)|, HIGGS_MASS_FLOOR)` cached per particle during `modulateMasses()`. Geometric mean per pair (same pattern as `axMod`). Pion emission uses `yukawaMu · emitter.higgsMod`. Pions in flight: `modulatePionMasses()` interpolates Higgs field at pion position, conserves momentum. During phase transition (φ→0), Yukawa approaches Coulomb-like 1/r². GPU: `higgsMod` in `axYukMod.z` (vec4), used in pair-force, forces-tree, onePN, radiation, compute-stats shaders.

**Scalar Breit correction** (requires 1PN): O(v²/c²) from massive scalar boson exchange. `δH = g²m₁m₂e^{-μr}/(2r) · [v₁·v₂ + (r̂·v₁)(r̂·v₂)(1+μr)]`. Into `force1PN`, velocity-Verlet corrected. Uses Higgs-modulated μ when Higgs enabled.

### External Background Fields

No toggle -- controlled by slider values (default 0). Gravity (`F = mg`), Electric (`F = qE`), Magnetic (uniform Bz via Boris rotation). Direction angle sliders auto-show when strength > 0.

### Bounce (Hertz Contact)

`F = K · δ^{1.5}` (K=1). Tangential friction transfers torque. Quadtree-accelerated when BH on, O(n²) fallback when off -- do not early-return when `root < 0`.

## Scalar Fields

### Base Class (`ScalarField`)

PQS (cubic B-spline, order 3) grid on 64×64 (CPU) or 128×128 (GPU). 4×4 stencil per particle. C² interpolation and C² gradients (PQS-interpolated central-difference grid gradients). Pre-allocated weight arrays for zero-alloc hot path.

Key methods: `_nb()` (topology-aware neighbor, absolute coords), `_depositPQS()` (interior fast path + border fallback), `_computeLaplacian()` (interior fast path + border path), `_computeGridGradients()`, `_computeViscosity()`, `interpolate()`, `gradient()`, `interpolateWithGradient()` (fused, single stencil walk), `_fieldEnergy()`, `depositExcitation()`, `_computeEnergyDensity()`, `applyGravForces()`, `gravPE()`, `computeSelfGravity()`.

**Particle-field gravity** (requires Gravity): F = -m·∇Φ via PQS interpolation of pre-computed potential gradients, O(N×16). Topology-aware via `_nb()` for border stencils. Subclasses override `_addPotentialEnergy()` for V(φ). Active whenever gravity is on.

**Field self-gravity** (requires Gravity): Weak-field GR correction to Klein-Gordon. Φ computed via FFT convolution with Green's function G(r) = -1/√(r²+ε²) on the full grid, O(N² log N). Green's function uses `minImage()` for periodic topologies on CPU (exact circular convolution for torus; approximate for Klein/RP² due to non-translationally-invariant glide reflections). GPU uses wrapped-index distances (approximate for all periodic topologies). Gradients of Φ computed via topology-aware central differences (`_nb()`/`nbIndex()`). Φ clamped to ±`SELFGRAV_PHI_MAX` (0.2) to prevent Laplacian sign-flip instability when `1+4Φ < 0`. `computeSelfGravity()` takes `(domainW, domainH, softeningSq, bcMode, topoConst)` — callers pass boundary mode directly, not a boolean periodic flag. Called twice per KDK cycle (pre-kick + post-drift) for O(dt²) accuracy on GR correction terms.

**Numerical viscosity**: `ν·∇²(ȧ)` in both KDK half-kicks, where `ν = 1/(2√(1/dx²+1/dy²))`. Gives Q=1 at Nyquist frequency, vanishes for physical (long-wavelength) modes. Prevents grid-scale noise from ringing indefinitely at high resolution.

Field arrays: `field`/`fieldDot` (not `phi`/`phiDot`). Field clamp: SCALAR_FIELD_MAX = 2. Merge excitation amplitude capped at `EXCITATION_MAX_AMPLITUDE` (1.0).

### Higgs Field

Independent toggle. Mexican hat `V(φ) = -½μ²φ² + ¼λφ⁴`. VEV=1; `λ = μ² = m_H²/2`. Slider: m_H 0.25-0.75 (default 0.50). Mass generation: `m_eff = baseMass · max(|φ(x)|, 0.05)`. Rate clamp: `HIGGS_MASS_MAX_DELTA = 4`. Gradient force into `forceHiggs`. Phase transitions: `μ²_eff = μ² - KE_local`.

### Axion Field

Independent toggle; requires Coulomb or Yukawa. Quadratic `V(a) = ½m_a²a²`, vacuum at a=0. Slider: m_a 0.01-0.10 (default 0.05).

**Scalar EM coupling (aF², when Coulomb on)**: Same for matter/antimatter. `α_eff = α(1+g·a)`. Per-particle `p.axMod`, geometric mean pairwise.

**PQ coupling (when Yukawa on)**: Flips sign for antimatter. `yukMod = 1+g·a` (matter) / `1-g·a` (antimatter). At vacuum: CP conserved.

### Higgs-Axion Portal Coupling

When both fields active: `V_portal = ½λφ²a²` (`HIGGS_AXION_COUPLING = 0.01`). Adds `-λa²φ` to Higgs EOM, `-λφ²a` to Axion EOM. Self-gravity correction: `-2Φ·λa²φ` / `-2Φ·λφ²a`. Portal energy (`½λ∫φ²a²dA`) counted in `higgsFieldEnergy` to avoid double-counting. GPU: separate group 1 bind group (`portalGroup1Layout`) provides the other field's buffer (dummy zeros when only one field active). No toggle/slider — always active when both fields are on.

## Pions (Massive Force Carriers)

Mass = `yukawaMu` (stored as `baseMass`). Proper velocity `w`: `vel = w/√(1+w²)`. GR deflection: `(1+v²)` factor. When Higgs enabled, emission mass = `yukawaMu · emitter.higgsMod`; in-flight mass modulated by local Higgs field via `modulatePionMasses()` (momentum-conserving).

**Emission**: Scalar Larmor `P = g²F_yuk²/3`. Species: π⁰ (50%), π⁺/π⁻ (25% each). MAX_PIONS = 256 (CPU), GPU_MAX_PIONS = 1024 (GPU).

**Decay**: π⁰→2γ (half-life 32), π⁺→e⁺+γ (half-life 64), π⁻→e⁻+γ (half-life 64). Two-body kinematics in rest frame, Lorentz-boosted. Charged decay products are emitted as Lepton objects (not full particles).

**Absorption**: Quadtree overlap query (CPU: `queryReuse()`, GPU: tree range query in `bosons-tree-walk.wgsl` when BH on, pairwise fallback in `bosons.wgsl` when BH off). Self-absorption permanently blocked by `emitterId`.

**Gravitational lensing**: Photon (2x Newtonian, null geodesic) and pion ((1+v²) GR factor) deflection by particles. CPU: topology-aware BH tree walk via `treeDeflectBoson()` (uses `minImage` for periodic boundaries). GPU: BH particle tree walk (`bosons-tree-walk.wgsl`) when BH on, pairwise (`bosons.wgsl`) when off.

**Coulomb deflection**: Charged pions (π⁺/π⁻) feel Coulomb force from particles (always on when Coulomb enabled). `F = -q_pion · q_particle / r²`. Tree-accelerated when BH on, pairwise fallback. GPU: integrated into `updatePions`/`updatePionsTree`.

**π⁺π⁻ annihilation** (requires Boson Interaction toggle): Opposite-charge pions within softening distance annihilate into 2 photons. COM-frame kinematics with Lorentz boost. CPU: `findPionAnnihilations()` via boson tree range query. GPU: pairwise scan in `annihilatePions` entry point.

**Boson Interaction** (requires Barnes-Hut + (Gravity OR Coulomb) -> Boson Interaction toggle): Boson↔boson gravity (BH tree walks), pion↔pion Coulomb (BH tree walk with charge aggregates), π⁺π⁻ annihilation, and e⁺e⁻ annihilation. GPU boson tree (`boson-tree.wgsl`) uses CAS+lock insertion and visitor-flag bottom-up aggregation with mass + charge. CPU uses separate `_bosonPool` QuadTreePool with `calculateBosonDistribution()` (mass + charge).

## Leptons (Electrons/Positrons)

Stable charged fermions produced by charged pion decay (π⁺→e⁺+γ, π⁻→e⁻+γ). Mass = `ELECTRON_MASS` (0.05). Proper velocity `w`: `vel = w/√(1+w²)`. GR deflection: `(1+v²)` factor (same as pions).

**CPU**: Separate `Lepton` class (`src/lepton.js`) with object pool (`Lepton.acquire()`/`.release()`). Stored in `sim.leptons[]` array. `_kind = 2` distinguishes from photons (`_kind = 0`) and pions (`_kind = 1`) in the boson tree for annihilation queries. Despawns after `LEPTON_LIFETIME = 512`.

**GPU**: Leptons share the Pion struct and pion pool buffer (no extra bind groups needed). Distinguished by `Pion.kind` field (0=pion, 1=lepton). The `energy` field is repurposed as a lifetime accumulator. `piCount` atomic tracks both pions and leptons. Buffer capacity = `PION_POOL_CAP = GPU_MAX_PIONS + MAX_LEPTONS` (1280). Leptons are not absorbed by particles and do not decay.

**Interactions** (gated behind Boson Interaction toggle): Gravity and Coulomb via boson tree (same as pions). e⁺e⁻ annihilation → 2γ (COM-frame kinematics, Lorentz-boosted). CPU: `findLeptonAnnihilations()` + `_annihilateLeptons()`. GPU: same `annihilatePions` entry point with `kind` check ensures only same-kind pairs annihilate.

**Rendering**: Cyan circles, size = `0.25 + 2 * mass` (same formula as photons/pions; with ELECTRON_MASS=0.05 gives radius ~0.35). Glow halo in dark mode. CPU: `drawLeptons()` in renderer.js. GPU: `vertexPion` checks `kind` to select cyan color.

## Advanced Physics

### 1PN Corrections

Requires Relativity. Four O(v²/c²) sectors into `force1PN`:
- **EIH** (GM + 1PN): perihelion precession.
- **Darwin EM** (Magnetic + 1PN): EM remainder.
- **Bazanski** (GM + Magnetic + 1PN): mixed 1/r³.
- **Scalar Breit** (Yukawa + 1PN): massive scalar exchange.

NOT Newton's 3rd law. Velocity-Verlet corrected. `compute1PN()` zeroes `force1PN` before accumulating. GPU uses BH tree walk (`compute1PNTree` in `onePN.wgsl`) when Barnes-Hut enabled, with post-drift tree rebuild. Falls back to O(N²) pairwise when BH off.

### Radiation

Requires Gravity, Coulomb, or Yukawa. Single toggle, four mechanisms:
- **Larmor dipole** (Coulomb): Landau-Lifshitz. Analytical jerk (gravity, Coulomb, Yukawa, dipoles, Bazanski, EIH position-only).
- **EM quadrupole** (Coulomb): `P = (1/180)|d³Q_ij/dt³|²`. Emits photons.
- **GW quadrupole** (Gravity): `P = (1/5)|d³I^TF_ij/dt³|²`. Emits gravitons (red).
- **Pion emission** (Yukawa): `P = g²F_yuk²/3`. Emits pions.

Self-absorption permanently blocked by `emitterId` for both photons and pions.

### Black Hole Mode

Requires Gravity + Relativity. Locks collision to Merge.
- **No hair**: Antimatter erased. Pair production disabled.
- **Kerr-Newman**: `r₊ = M + √(M² - a² - Q²)`, naked singularity floor.
- **Hawking** (requires Radiation): `T = κ/(2π)`, `P = σT⁴A`. Full evaporation emits final photon burst.

### Signal Delay

Auto-activates with Relativity. Per-particle circular history buffers (Float64Array[256], recorded every HISTORY_STRIDE=64 calls):
1. Newton-Raphson segment search (≤8 iterations)
2. Exact quadratic solve on converged segment
3. Constant-velocity extrapolation for early history (skipped for dead particles)

**Causality**: `creationTime` rejects extrapolation past creation. Dead particles continue exerting forces via signal delay until `simTime - deathTime > 2·domain_diagonal`.

**Periodic boundary interpolation**: When `periodic` is true, position interpolation between history samples uses `minImage()` to wrap displacements across domain seams.

**Liénard-Wiechert aberration**: `(1 - n̂·v_source)^{-3}`, clamped [0.01, 100]. Applied to gravity, Coulomb, Yukawa, dipole at leaf level only (not BH tree aggregate nodes, which use current-time positions). Not 1PN (already O(v²)).

### Additional Physics

- **Spin-Orbit**: Stern-Gerlach `F = +μ·∇(Bz)`, Mathisson-Papapetrou `F = -L·∇(Bgz)`.
- **Disintegration & Roche**: Tidal + centrifugal + Coulomb stress. Eggleton (1983) Roche lobe.
- **Expansion**: `pos += H(pos - center)dt`, `w *= (1-Hdt)`. Default H = 0.001.
- **Antimatter & Pair Production**: Right-click spawns. Annihilation emits photons. Pair production from energetic photons near massive bodies.

## Sign Conventions (IMPORTANT)

All GEM interactions are **attractive** (gravity has one sign of "charge"):
- GM dipole: `+3L₁L₂/r⁴` (positive = attractive)
- GM Boris parameter: `+2Bgz` (co-moving masses attract)
- Bgz field: `-m_s(v_s × r̂)_z/r²` (negative sign in code)
- Frame-drag torque: positive drives co-rotation

**Angular velocity convention (y-down canvas)**: 2D cross product `rx·vy - ry·vx` gives positive for clockwise on screen.

## Energy, PE & Collisions

**PE**: Accumulated inline during `pairForce()` via `_peAccum`. 9 terms. `potential.js` kept as fallback for preset-load recomputation.

**Energy**: Relativistic KE = `wSq/(γ+1)·mass`. `pfiEnergy` = particle-field interaction from Higgs + Axion.

**Collisions**: Pass / bounce (Hertz) / merge. Always tree-accelerated broadphase. Merge kills both parents, creates new particle, retires parents for signal delay fade-out.

## Topology

Boundary "loop": Torus (TORUS=0), Klein bottle (KLEIN=1), RP² (RP2=2). `minImage()` zero-alloc via `out` parameter. `wrapPosition()` for RP² uses iterative wrapping (max 2 passes) to handle simultaneous x+y out-of-bounds from glide reflections.

## Quadtree

`QuadTreePool`: SoA typed arrays, 512-node pool (grows). BH_THETA = 0.5, QUADTREE_CAPACITY = 4. Depth guard max 48. **Always built** every substep regardless of BH toggle -- used by collisions, hit testing, and optionally BH force computation.

**GPU tree build** (`tree-build.wgsl`): 4 dispatches (computeBounds, initRoot, insertParticles, computeAggregates). Lock-free CAS insertion with LOCK_BIT. Bottom-up aggregation via visitor-flag counting: `visitorFlags[node]` = number of populated children (set during insertion), `particleCount` on internal nodes = actual visit counter (reset to 0 on subdivision). Each non-empty child subtree sends exactly one thread (the last visitor) up to its parent. Tree resets use `encoder.copyBufferToBuffer` (not `queue.writeBuffer`) because the tree may be built twice per substep (before forces + after drift for 1PN VV); queue-level operations would execute before the encoder starts, preventing proper inter-build resets.

**Dead particles in GPU tree**: Retired particles (FLAG_RETIRED, mass zeroed) are inserted into the GPU BH tree alongside alive/ghost particles. `computeAggregates` uses `deathMass`/`deathAngVel` from `ParticleAux` for retired particle leaf data. At leaf level in `forces-tree.wgsl`, retired particles use signal delay with `isDead=true`. The CPU dead-particle path remains pairwise (separate loop in `computeAllForces`). The GPU `pair-force.wgsl` also keeps a pairwise dead scan for when BH is off.

## Toggle Dependencies

```
Forces:                        Physics:
  Gravity                        Relativity          [signal delay auto-activates]
    -> Gravitomagnetic             -> 1PN             [requires Magnetic, GM, or Yukawa]
    (field gravity auto-on)        -> Black Hole      [+Gravity, locks collision to Merge]
  Coulomb                        Spin-Orbit           [requires Magnetic or GM]
    -> Magnetic                  Radiation             [requires Gravity, Coulomb, or Yukawa]
  Yukawa               [independent]  Boson Interaction [requires BH + (Gravity OR Coulomb)]
  Axion                [requires Coulomb or Yukawa]
  Higgs                [independent]
Disintegration                   [requires Gravity, locks collision to Merge]
Barnes-Hut                       [independent]
Expansion                        [independent, in Engine tab]
```

Declarative `DEPS` array in `ui.js`, topological evaluation via `updateAllDeps()`.

Defaults on: gravity, coulomb, magnetic, gravitomag, 1PN, relativity, spin-orbit, radiation.
Defaults off: Boson Interaction, Yukawa, Axion, Higgs, Disintegration, Expansion, Barnes-Hut, Black Hole.

## UI

4-tab sidebar: Settings (mass/charge/spin, spawn mode, force/physics toggles), Engine (GPU toggle, BH, collisions, boundary/topology, external fields, visuals, speed), Stats (energy/momentum/drift/mass), Particle (selected details, force breakdown, phase plot, effective potential).

19 presets in 4 groups: Gravity (6), Electromagnetism (3), Exotic (8), Cosmological (2). First 9 via keyboard `1`-`9`. Speed: 1-64, default 32.

### Antimatter/Delete Toggle (`#mode-btn`)

Toolbar button toggled by click or `X` key. State exported via `getAntimatterMode()` from `ui.js`, consumed by `input.js`.

- **Normal mode** (default): tap canvas spawns matter, tap on particle selects it.
- **Antimatter mode**: tap canvas spawns antimatter, tap on particle deletes it, tap on antimatter particle selects it.

The button SVG gains a vertical bar when antimatter mode is active. `aria-pressed` and `aria-label` update on toggle.

### Touch Interactions

- **Single-finger tap**: spawn / select / delete (behavior depends on antimatter mode)
- **Two-finger pinch**: pan + zoom
- **Hint bar**: on `(pointer: coarse)` devices, text changes to "Tap to Spawn · Pinch to Zoom · X to Toggle Mode". Fades out after 5 seconds.

### Keyboard Shortcuts

Registered via `initShortcuts()` from `shared-shortcuts.js`. `?` key opens help overlay.

| Key | Action | Group |
|-----|--------|-------|
| Space | Pause / Play | Simulation |
| R | Reset simulation | Simulation |
| . | Speed up | Simulation |
| , | Slow down | Simulation |
| / | Step forward | Simulation |
| X | Toggle antimatter mode | Simulation |
| 1-9 | Load preset (Kepler, Precession, Inspiral, Tidal Lock, Roche, Hawking, Atom, Bremsstrahlung, Magnetic) | Presets |
| V | Toggle velocity vectors | View |
| F | Toggle acceleration vectors | View |
| C | Toggle acceleration components | View |
| T | Toggle theme | View |
| S | Toggle sidebar | View |
| Escape | Close panel | View |
| [ | Previous tab | View |
| ] | Next tab | View |
| = | Zoom in | View |
| - | Zoom out | View |
| 0 | Reset zoom | View |
| Ctrl+S | Quick save | Save / Load |
| Ctrl+L | Quick load | Save / Load |
| Ctrl+Shift+S | Download state | Save / Load |
| Ctrl+Shift+L | Upload state | Save / Load |

### Accessibility

- **Engine tab checkboxes**: all physics toggles have `role="switch"` and `aria-checked` synced in JS on every change (including cascading disables via `updateAllDeps()`).
- **About panel**: uses `trapFocus()` (from `shared-utils.js`) and `aria-modal="true"` (set in `shared-about.js`).
- **Reference overlay**: uses `trapFocus()` and `aria-modal="true"` (set in `shared-info.js`).
- **Toolbar buttons**: all have `aria-label` attributes (`index.html`). The `#mode-btn` also uses `aria-pressed`.
- **Touch targets**: `@media (pointer: coarse)` in `shared-base.css` expands `.tool-btn` to 44x44px, `.info-trigger` to 32x32px min, `.tab-btn` to 44px min-height.
- **Tab navigation**: `shared-tabs.js` supports Arrow Left/Right/Up/Down and Home/End key navigation between tab buttons.

## Backend Architecture

Two interchangeable backends via `selectBackend()`:

- **CPU**: `CPUPhysics` + `CanvasRenderer`. Thin adapters over integrator.js and renderer.js.
- **GPU**: `GPUPhysics` + `GPURenderer`. GPU renders to `<canvas id="gpuCanvas">` (z-index: -1). CPU canvas (z-index: 0) on top for 2D overlays.

Falls back to CPU on WebGPU unavailability or device loss. Force CPU via `?cpu=1`. Runtime toggle in Engine tab.

### Update Loop Architecture

**CPU**: main.js drains the accumulator one PHYSICS_DT tick at a time. Each tick: `physics.update(PHYSICS_DT)` (adaptive substeps internally), then photon/pion update + decay, pair production, disintegration. Pion decay checked once per tick.

**GPU**: main.js calls `gpuPhysics.update(PHYSICS_DT * N)` once per frame with all accumulated ticks batched. Internally runs the same adaptive substep loop over the total dt. Post-substep passes (pion decay, boson interaction, quadrupole radiation, stats readback) run once per `update()` call. Pion decay probability scaled by `1-(1-p)^N` to match CPU's per-tick rate.

### Capacity Limits

| Resource | CPU | GPU |
|----------|-----|-----|
| Particles | MAX_PARTICLES = 128 | GPU_MAX_PARTICLES = 512 |
| Photons | MAX_PHOTONS = 1024 | GPU_MAX_PHOTONS = 4096 |
| Pions | MAX_PIONS = 256 | GPU_MAX_PIONS = 1024 |
| Leptons | MAX_LEPTONS = 256 | Shares pion pool (PION_POOL_CAP = 1280) |

CPU particle array pre-allocated to `MAX_PARTICLES` slots in constructor/reset to avoid reallocation. `addParticle()` caps at `MAX_PARTICLES` in CPU mode.

### GPU Packed Struct Buffers

| Struct | Size | Fields |
|--------|------|--------|
| `ParticleState` | 36B | posX/Y, velWX/Y, mass, charge, angW, baseMass, flags |
| `ParticleAux` | 20B | radius, particleId, deathTime, deathMass, deathAngVel |
| `ParticleDerived` | 32B | magMoment, angMomentum, invMass, radiusSq, velX/Y, angVel, bodyRSq |
| `AllForces` | 160B | 11 force vec2s, 3 torques, B-fields, B-gradients, totalForce, jerk |
| `RadiationState` | 48B | radAccum, hawkAccum, yukawaRadAccum, radDisplay, quadAccum, d3I/d3Q contrib |
| `Photon` | 32B | pos, vel, energy, emitterId, lifetime, flags |
| `Pion` | 48B | pos, w, mass, charge, energy, emitterId, age, flags, kind (0=pion, 1=lepton) |

### Shader Organization

**Shared includes** (prepended to ALL shaders via `getSharedPrefix()`):
- `shared-structs.wgsl`: All packed struct definitions (ParticleState, ParticleAux, ParticleDerived, AllForces, SimUniforms, RadiationState, Photon, Pion). Single source of truth — never redefine these in individual shaders.
- `shared-topology.wgsl`: `fullMinImageP(ox, oy, sx, sy, domW, domH, topo)` parameterized topology-aware minimum image function.
- `shared-rng.wgsl`: `pcgHash(seed)`/`pcgRand(seed)` PCG hash PRNG.

**Additional shared includes** (prepended selectively via `getTreePrefix()`):
- `shared-tree-nodes.wgsl`: Read-only BH node accessors (`getMinX`, `getComX`, `getTotalMass`, `getParticleIndex`, etc.). Used by forces-tree, collision, onePN (tree variant), and bosons-tree-walk. tree-build.wgsl has its own atomic versions.

**Prepend chains** (all start with `wgslConstants + shared-structs + shared-topology + shared-rng`):
- Phase 2 shaders + `boundary.wgsl`: + `common.wgsl` (toggle helpers, `fullMinImage` wrapper). Force shaders also get `signal-delay-common.wgsl`.
- Field shaders: + `field-common.wgsl` (FieldUniforms, PQS helpers).
- Tree-walk shaders (forces-tree, collision, onePN tree, bosons-tree-walk): + `shared-tree-nodes.wgsl` (node accessors).
- Signal delay shaders (forces-tree, onePN, heatmap): + `signal-delay-common.wgsl` (getDelayedStateGPU).
- All other standalone shaders: shared prefix only.
- `fetchShader()` exported from `gpu-pipelines.js` (single source of truth, imported by gpu-physics.js and gpu-renderer.js).

### GPU Scalar Field Pipeline

GPU field evolution (`_dispatchFieldEvolve`) uses fused dispatches to minimize pass count. Per field per substep (with self-gravity):

1. **Deposit** (source + thermal): PQS atomic deposition, finalize passes
2. **Self-gravity pre-kick**: fused `energyDensityHiggsAndPack` / `energyDensityAxionAndPack` writes ρ·cellArea directly to FFT complex buffer (group 2 = fftA) → Stockham FFT forward (14 butterfly stages) → `complexMultiply` by cached Ĝ → FFT inverse (14 stages) → fused `unpackAndSGGradients` reads complex IFFT output at stride 2, writes sgPhiFull + sgGradX/sgGradY
3. **Half-kick 1**: Laplacian computed inline via `inlineLaplacian()` helper (topology-aware 5-point stencil). Portal coupling adds `-λa²φ` (Higgs) or `-λφ²a` (Axion) when both fields active (single `otherField` read hoisted before both portal blocks). NaN/Inf guard on fieldDot; Higgs also resets field to VEV=1.0.
4. **Drift**: field += fieldDot·dt with NaN/Inf fixup (resets to vacuum value)
5. **Mid-KDK refresh**: `computeGridGradients` + full self-gravity pipeline again (restores O(dt²) for GR correction)
6. **Half-kick 2**: same fused pipeline as kick 1
7. **Grid gradients**: final `computeGridGradients` for force interpolation

Evolve bind group 0: field, fieldDot, otherField (portal coupling, read-only — dummy zeros when other field inactive), source, thermal, sgPhiFull, sgGradX, sgGradY, fieldGradX, fieldGradY, uniforms (11 bindings: 9 storage + 1 read-only-storage + 1 uniform = 10 storage per stage). Laplacian buffer removed (computed inline). FFT always ends with data in fftA (total stages = 2×log₂(GRID) is even for any power-of-2 grid). Self-gravity bind groups use 3 groups: g0 (field arrays + uniforms), g1 (SG outputs), g2 (fftA complex buffer). `SHADER_VERSION` in gpu-pipelines.js must be bumped after shader edits to invalidate browser cache.

### GPU ↔ CPU Sync

- `addParticle()` writes packed structs via `queue.writeBuffer()`
- `setToggles()` packs booleans into `toggles0`/`toggles1` u32 bitfields (including `HERTZ_BOUNCE_BIT` in toggles1), caches individual `_xxxEnabled` booleans and `_isDarkTheme`
- `serialize()`/`deserialize()` for save/load and GPU→CPU toggle
- `readbackFieldData()` reads Higgs/Axion field grids (128×128 Float32) for GPU→CPU migration with 2×2 downsampling to 64×64
- GPU hit test: `hitTest()`/`readHitResult()` with 1-frame latency via staging buffer
- GPU stats: `requestStats()`/`readStats()` at STATS_THROTTLE_MASK rate, 512-byte double-buffered staging
- Async readback methods (`_readbackMaxAccel`, `_readbackMergeResults`, `_readbackGhostCount`) use try/catch/finally to clear pending flags on device loss
- `_phase5Ready` flag guards field dispatches until async pipeline creation completes
- `device.lost` handler falls back to CPU with auto-save recovery

### WGSL Gotchas

- WGSL requires explicit parentheses when mixing `*` with `^` (XOR)
- Multiple entry points sharing a module need `read_write` access mode on shared bindings
- WebGPU disallows binding the same buffer twice in a dispatch
- Staging buffers must not be copied to while mapped from previous `mapAsync`
- JS uniform write order must exactly match WGSL struct member order
- `addParticle()` must initialize ALL per-particle buffers. `axYukMod` defaults to (1.0, 1.0, 1.0, 0.0) not (0, 0, 0, 0)
- `queue.writeBuffer()` executes at queue time (before encoder starts), NOT inline with compute passes. Use `encoder.copyBufferToBuffer()` from pre-allocated staging for resets between dispatches within the same command buffer (e.g., tree build resets between pre-force and post-drift builds)

### Numerical Stability (GPU)

- Division-by-zero: `select(0, 1/x, x > EPSILON)` or `max(x, EPSILON)`
- NaN barriers before writing to global memory (not after). Field NaN/Inf guards fused into half-kick (fieldDot) and drift (field) shaders.
- `sqrt(max(x, 0))` on all discriminants; `exp(-μr)` guarded with `select(0, ..., μr < 80)`
- `deathTime` sentinel uses `FLT_MAX` (3.4028235e38) not `Infinity`
- Collision merge: `mass <= EPSILON` guards (not `== 0`) for race conditions
- Render: premultiplied alpha (`color.rgb * alpha`) with `srcFactor: 'one'`

## Renderer

### Visual Style (both backends)

- **Particles**: r = ∛(mass) (BH: r₊), no glow. Neutral=slate (BH light: text color). Charged: RGB lerp base→red(+)/blue(-).
- **Trails**: circular Float32Array[256], wrap-detection for periodic boundaries
- **Force vectors**: gravity=red, coulomb=blue, magnetic=cyan, GM=rose, 1PN=orange, spin-curv=purple, radiation=yellow, yukawa=green, external=brown, higgs=lime, axion=indigo
- **Field overlays**: 64×64 (CPU) / 128×128 (GPU), bilinear-upscaled. Higgs: purple/lime. Axion: indigo/yellow.
- **Heatmap**: 64×64 (CPU) / 128×128 (GPU), 3-channel (gravity/slate, electric/blue-red, Yukawa/green), mode selector (All/Grav/Elec/Yukawa)
- **Photons**: yellow (EM) / red (grav), alpha fades over PHOTON_LIFETIME=256
- **Pions**: green, constant alpha
- **Leptons**: cyan, constant alpha, size = 0.25 + 2×mass (tiny due to ELECTRON_MASS=0.05)
- **V_eff plot**: 200-sample sidebar canvas

### GPU Renderer Passes

Particles, trails, field overlays, heatmap, bosons (photons + pions + leptons), spin rings, force arrows, torque arcs, dashed rings (ergosphere + antimatter). All with dual light/dark pipeline variants.

## Key Patterns

- `window.sim` for console debugging. `_PALETTE`/`_FONT` frozen by colors.js
- `Vec2.set(x,y)` in hot paths; `pairForce()` accumulates into `out` Vec2, zero alloc
- Module-level `_miOut` for zero-alloc `minImage()` output
- Particle constructor declares all properties upfront (V8 hidden class stability)
- World coordinates: `sim.domainW/H` (viewport / WORLD_SCALE), not pixels
- Theme: `data-theme` on `<html>` (not body)
- `.mode-toggles` sets `display: grid` overriding `hidden` -- use `style.display`
- External field trig cached once per frame via `_cacheExternalFields()`
- `forceRadiation` cleared for all particles before substep loop
- History recording counts `update()` calls, not substeps
- PE accumulated inline in `pairForce()` via `_peAccum`; `potential.js` is fallback only
- Object pooling: `MasslessBoson.acquire()`/`.release()`, `Pion.acquire()`/`.release()`, and `Lepton.acquire()`/`.release()` with pool caps
- Dirty flag: `sim._dirty` skips entire render/stats when paused with no interaction
- Batched rendering: force arrows, spin rings, photon alpha buckets -- O(forces) canvas calls not O(particles×forces)
- All periodic topologies use `minImage()` uniformly (torus, Klein, RP²); no inline fast paths
- Yukawa cutoff: skip `Math.exp` when `μr > 6`
- Lazy field init: Higgs/Axion fields `null` until first toggle-on
- KaTeX CSS preload + render cache
- Shared utilities: `_toolbar.initSidebar()` for panel toggle/close/swipe, `_toolbar.initTheme('geon-theme')` for theme persistence + system preference, `_toolbar.updatePlayBtn`/`updateSpeedBtn` for playback, `_intro.init()` for intro screen, `_forms.bindModeGroup()` for collision/boundary/topology/grid-res toggles, `_forms.bindSlider()` for all parameter sliders, `registerInfoTips()` for info tips, `initReferenceOverlay()`/`bindReferenceTriggers()` for reference pages, `trapFocus()` for modal focus trapping (about panel + reference overlay), `shared-tabs.js` for sidebar tab switching with arrow key navigation
- rAF-throttled hover, visibilitychange halt, accumulator cap = 2 frames
