# Geon Roadmap

The one authoritative future-plans document for Geon. It merges and
supersedes the June audit (`AUDIT.md`, 2026-06-09) and the 2.0 scouting plan
(`PLAN-2.0.md`, 2026-10-23); both remain in git history.

`AGENTS.md` describes Geon as it is. This file describes where it is going.
When an item lands, delete it here, or move it to §2.1 with its commit, and
update `AGENTS.md`.

Written by Claude with a9. Codex adversarially reviewed the physics claims
twice on 2026-10-23; corrections that changed the design are marked
"(Codex)". Paths are relative to the Geon root. Line numbers are as of commit
`bda3baf` unless stated otherwise.

This file lives in `docs/` so the parent build's stager never deploys it
(`tools/stage-assets.mjs` skips `docs/`). Keep future planning documents
here too.

Tags: **[standard]** textbook physics with a known answer · **[synthesis]**
our own derivation or design applying standard physics · **[speculative]**
scope or model choices that need prototyping before they're trusted.
Cost: **S** about one session · **M** a few sessions · **L** a milestone ·
**XL** a multi-milestone subsystem.

## 0. Decisions

### Decided

| Date | Decision | Where |
|---|---|---|
| 2026-10-23 | **WebGPU only.** Retire the CPU physics and Canvas renderer entirely. | §4 |
| 2026-10-23 | **The 3D convention:** the simulation is a 2D slice of a 3D world. | §1.2 |
| 2026-10-23 | **Next session:** the internal-clock fix (§5.1). Fix only the GPU copies, since the CPU path is retiring; that part is a recommendation. | §3 |
| 2026-10-23 | **The version plan:** 1.5 = M0–M4 (WebGPU only, the spoke, clocks, frames, honest cosmology, lensing); 2.0 = a full visual overhaul; 2.1 = brushwork (M8 media, then M5 dust, M6 gas); 2.5 = quantum (M7); then 3.0 = 3D. | §3 |
| 2026-10-23 | **Lengths: two knobs.** A sheet thickness ℓ (physical, and comoving when expansion is on) for fields and grid gravity; a numerical softening ε for particle forces only. | §1.2 |
| 2026-10-23 | **3D views are parked for 3.0.** That covers the spacetime, inclined and embedding views. 1.5 ships the 1+1 Minkowski panel instead. | §9 |
| 2026-10-23 | **Photons stay planar.** The planar emission surrogate is kept, labelled, with consistent recoil. | §1.2 |

### Open

1. **Default frame-view mode:** lagged (filled) or true-now (uncomputed region
   shown). §5.4.
2. **Clock display:** a sweep ring (proposed), a pulse, or numeric only. §5.2.
3. **Expansion outside loop mode:** keep it as a labelled "expanding cloud"
   with a centre, or disable it. §5.6.
4. **Gas solver:** SPH (recommended; shares particle infrastructure with dust)
   or Plasma's Eulerian solver. §7.3.
5. **Quantum interpretation surface:** measurement-as-spawn, Bohmian tracers,
   both, or neither. §8.
6. **Liénard–Wiechert fields:** bring them in before frames, so frames are
   honest for EM on day one, or after. §11.1.
7. **The 2.0 overhaul's scope:** which pillars are in, and whether it includes
   a rendering-architecture rewrite. §6.

## 1. Direction

### 1.1 Thesis: a spacetime simulator

Geon 1.x computes *space at the current instant*. Every chosen feature from
1.5 on
needs *spacetime*: a frame switch re-slices world-lines, a clock is a
world-line's proper length, a light-cone view intersects world-lines with a
null cone, and cosmology is about how the slices themselves stretch.

1. **World-lines are first-class state.** Every entity records a history,
   including proper time, orientation, and an event log of births, deaths,
   merges and mass changes. The history serves the physics (signal delay,
   Liénard–Wiechert) and the renderer (frames, the light-cone camera, the
   spacetime view) alike.
2. **A view is a hypersurface.** Lab simultaneity, a boosted simultaneity
   plane, an observer's past light cone, comoving slices and rotating
   coordinates are all *choices of slice and coordinate map*. One WGSL
   "slicer" handles all of them by bisecting a monotone function along each
   world-line. Signal-delay forces already use the light-cone case
   (`src/signal-delay.js`).
3. **Internal processes run on proper time.** Decay, evaporation, discharge,
   mass transfer and spin phase advance by each process's own clock, not lab
   `dt` (§5.1).

**Cross-cutting rule: every phenomenon ships with its analytic number.**
Examples: γβcτ survival lengths, the spoke twist `2·v·v_rim`, the twin-paradox
jump `2vd`, Einstein radii, `E ∝ 1/a`, and the 2D-hydrogen spectrum. These
numbers are the test suite Geon has never had (§10.3).

### 1.2 The 3D convention: 3D parent physics, named planar reductions

a9's decision: **the simulation is a 2D slice of a 3D world.**

Codex's review turned that into a precise form: *3+1 parent physics with
specified planar reductions*. A confined slab, a homogeneous cosmological
slice and an equatorial symmetry plane are **different reductions**, not three
readings of one model. Geon uses each where it fits, and says which.

| Reduction | Applies to | Exact part | Approximate part |
|---|---|---|---|
| **Symmetry plane** | point particles with z-spins and their mutual 3D forces, including Kerr–Newman equatorial motion | Planar orbits are an invariant sector of 3D dynamics under z → −z reflection symmetry. | Softening. Anything that breaks the reflection symmetry. |
| **Confined slab** | fields, the quantum particle, thin-disk gravity of dust and gas | Project the 3D *action* onto a fixed transverse profile, `φ = ψ(x,y,t)·χ(z)` with `∫χ²dz = 1`. | A single transverse mode. Profile integrals rescale the couplings: transverse energy `λ_z = ∫|χ′|²dz`, and the quartic picks up `∫χ⁴dz`, which shifts the Higgs minima. Gravity carries a finite-thickness factor F(kℓ). Interactions must stay too weak to excite higher transverse modes. |
| **FRW background** | cosmology | The slab is a slice of homogeneous 3D FRW. The background closes through `ρ̄ = Σ̄_phys/(a·ℓ_c)` ∝ a⁻³ for matter. | Perturbations live only in the slab (sheet kernel); off-slab perturbations are ignored. A z-independent perturbation would be an infinite column with 3D Poisson gravity `Φ_k = −4πGδρ_k/k²`, which is a different model. |

**Three lengths, never silently identified (Codex):**

| Length | What it is | Where it acts | How it scales |
|---|---|---|---|
| **ℓ_conf** | The physical thickness of the sheet that spread-out things occupy: fields and the quantum particle. | Converts the field's surface density to volume density for its self-gravity. Sets the finite-thickness factor F(kℓ). Adds a transverse energy `~1/ℓ²`, which acts like extra mass. Rescales the Higgs quartic by `∫χ⁴ ~ 1/ℓ`. Decides whether hydrogen looks 2D (thin) or starts crossing to 3D (thick). | Fixed in physical units. |
| **ℓ_c** | How thick a slab of the universe the simulated slice represents. | Only cosmology. It converts the sim's mean surface density into the volume density Friedmann needs, `ρ̄ = Σ̄_phys/(a·ℓ_c)`, and sets grid gravity's comoving softening. | Fixed in comoving units, so it grows ∝ a physically. |
| **ε** | Numerical softening, `1/r² → 1/(r² + ε²)`, so close passes don't blow up. | Point-particle forces. For point particles in the symmetry plane, ε is not physical at all. | A numerical knob. It should be small enough not to change results. |

**Why not one length:**
- They answer different questions, and in an expanding universe they *scale
  differently*: one is physical, one is comoving, one is numerical.
- Equating them would let a numerical stability knob silently change physics.
  This happens today: field self-gravity reuses the particle softening
  (`toggles.softeningSq` passed into the field update, `src/integrator.js:1382`),
  so turning on black-hole mode drops it from 8 to 4 and quietly halves the
  field's implied thickness.

**Decided scheme (2026-10-23): two knobs.**
- **ℓ, the sheet thickness.** Physical in static presets. Comoving when
  expansion is on, because the slab is a slice of the universe there and
  stretches with it. ℓ then *is* ℓ_c, and the physical thickness is `a·ℓ`.
  Grid gravity (fields, dust) uses ℓ as its softening.
- **ε, numerical softening** for particle–particle forces only.

The tie is explicit and per mode, which is what Codex asked for.

**Consequences:**

- **Forces** are 3D laws in the symmetry plane. In-plane photon deflection
  `4M/b` is the asymptotic result for an *isolated point mass*. Neither a
  slab distribution nor today's force code inherits it automatically.
- **In-sheet gravity [standard]:** a non-rotating barotropic sheet has
  `ω² = c_s²k² − 2πGΣ₀|k|·F(kℓ)`, with F(0) = 1.
  - A rotating sheet adds the epicyclic term κ². Collisionless matter needs
    its own response function.
  - In an expanding background, with comoving k:
    `δ̈ + 2Hδ̇ + [c_s²k²/a² − 2πGΣ̄_phys|k|F(|k|ℓ)/a]·δ = 0`.
  - Growth is scale-dependent, not the 3D δ ∝ a. Geon's in-plane structure
    formation is galactic-disk dynamics.
  - F depends on the transverse profile, not just a nominal softening.
- **Fields:**
  - Use the 3+1 *parent* coefficients: `φ̈ = (1+4Φ)∇²φ − (1+2Φ)V′ + 4Φ̇φ̇`,
    with no gradient-coupling term.
  - The *projected* equation adds transverse integrals of Φ(z), χ and χ′.
    Using the midplane Φ and one effective mass is a further, labelled
    approximation.
  - The current field self-gravity integrates field density over dA with no
    thickness normalization. Define `Σ = ∫ρ dz` before calling it a surface
    density.
  - In FRW, the transverse term of a fixed comoving profile is `λ_z/a²`, not a
    constant mass shift. Derive the FRW perturbation terms before combining
    the KG gravity terms with `3Hφ̇`.
- **Radiation:** 3D rate formulas apply, each within its own approximations
  (area × Stefan–Boltzmann Hawking power is greybody-free).
  - **Decided: photons stay planar.** Emission uses `|p_∥| = E` and an
    in-plane angular pattern, as a *labelled surrogate* for 3D emission.
  - Codex's conditions for keeping it honest:
    - total emitted energy comes from the 3D rate formulas;
    - in-plane recoil is consistent, so emitter plus photon conserve energy
      and planar momentum;
    - `about.md` and the UI say it is a surrogate, which reproduces neither
      3D recoil statistics, nor 3D angular distribution, nor reabsorption.
  - The physical alternative is 3D photons with a hidden `z, p_z`, with
    `|p_∥| < E`, escape bookkeeping and transverse recoil. It is deferred to
    3.0, where photons are 3D anyway.
  - In cosmology, radiation energy stays in the background accounting.
- **Gravitational waves:** use the 3D quadrupole and TT projection, including
  its zz component. In-plane (edge-on) observers of an in-plane circular
  binary see `h_× = 0` and `h_+` at half its face-on amplitude. This also
  sidesteps the fact that 2+1 GR has no gravitational waves.
- **The quantum particle:**
  - The ideal 2D-hydrogen spectrum `(n − ½)⁻²` needs strong confinement and
    an unscreened 1/r.
  - With finite thickness, average the interaction over the transverse
    profiles. Plummer softening is a surrogate. Overlapping continuous
    profiles give logarithmic short-range behaviour. Rytova–Keldysh is a
    different thing (dielectric screening).
  - A single-mode solver cannot cross over to 3D; that needs accessible
    transverse modes, ℓ ≫ a₀.
- **Kugelblitz:** the hoop criterion `E > R/2` is a spherical compactness
  heuristic.
  - Use 3D extent including slab thickness, and define radius versus
    diameter.
  - Lab energy is boost-dependent, so use invariant mass while keeping
    momentum, angular momentum and escape in view.
  - Label it phenomenological.
- **Confinement stresses** are anisotropic. They can't be counted as isotropic
  FRW matter.

## 2. Current state

### 2.1 Done since the June audit

- **Black-hole fidelity (audit §2):** the Paczyński–Wiita pseudo-potential
  with Kerr–Newman `r₊`, horizon capture in merge mode, and extremal
  censorship by quantized lepton shedding with a clamp backstop. All
  documented in `AGENTS.md`.
- **Geon 2.0 scouting:** this document, `bda3baf` and later.
- **Doc drift:** `AGENTS.md`'s preset count now matches `presets.js` (15).

### 2.2 Physics bugs and gaps found by the 2.0 scouting

- **No internal process is time-dilated.**
  - Pion decay uses a fixed per-step probability: `src/config.js:73-74`,
    `src/gpu/shaders/bosons.wgsl:298`. The GPU folds N ticks into
    `1 − (1 − p)^N`.
  - Hawking: `power·dt`, `src/gpu/shaders/radiation.wgsl:203`.
  - Schwinger: `src/gpu/shaders/radiation.wgsl` (schwingerDischarge).
  - Superradiance: `src/gpu/shaders/field-deposit.wgsl`
    (depositSuperradiance).
  - Spin update: no γ.
  - Landau–Lifshitz radiation reaction is written covariantly and is fine.
- **Roche transfer (hidden feature) has two bugs (Codex).**
  - There is no timestep factor: `dM = overflow·ROCHE_TRANSFER_RATE·mass`, on
    both backends.
  - The Eggleton ratio is donor/total mass instead of donor/companion
    (`src/integrator.js:1994`; GPU `disintegration.wgsl`).
- **The weak-field KG coupling is wrong (Codex, verified).**
  - Both fields carry a spurious `2∇Φ·∇φ` term and no `Φ̇φ̇` term
    (`src/gpu/shaders/field-evolve.wgsl:110-111, 192-193`, plus the CPU
    copies).
  - The 3+1 parent form has `+4Φ̇φ̇` and no gradient term (§1.2). Projection
    corrections and the missing thickness normalization of the field's
    self-gravity source are separate follow-ups.
  - `SELFGRAV_PHI_MAX = 0.25` is not weak-field: at the lower clamp,
    `1 + 4Φ = 0`.
- **The Higgs Z₂ is explicitly biased.** The field resets to +1, exterior
  cells read +1, and particles deposit a positive linear source. Any
  domain-wall work must remove all three.
- **Field damping is ether-like friction:** axion `damp = AXION_COUPLING·m_a`
  (Q ≈ 20), Higgs critical damping `2m_H`, and numerical viscosity `ν∇²φ̇` on
  top. It gives fields a preferred frame and kills self-bound lumps.
- **Cosmology is centred and partial.**
  - Hubble flow `x += H(x − c)dt` runs about the *domain centre*, with
    `w *= 1 − H dt`, on particles only (`src/gpu/shaders/expansion.wgsl`).
  - Photons, pions and leptons neither redshift nor co-expand.
  - H is constant; fields get no Hubble friction.
  - In loop mode the flow is discontinuous across the wrap.
- **History is kinematics only.**
  - 256 samples at a stride of 64 physics steps (0.5 time units each, about
    128 time units of span).
  - Linear interpolation, f32 times.
  - Recorded only while relativity is on.
  - No mass, charge or lifecycle events, so it cannot reconstruct a past
    scene.
- **Signal delay is a toy.**
  - Forces scale by `1/(1 − n·v)³`, capped at 100.
  - The heatmap uses delayed positions with a plain 1/r, which is not the
    Liénard–Wiechert potential.
- **Pool culls pose as physics.** `PHOTON_LIFETIME = 256` and
  `LEPTON_LIFETIME = 512` are pool culls. Leptons are documented as stable.
  Any bound photon structure is destroyed.
- **The README claims Thomas precession** (`README.md:20`), but no code
  implements it. Spin has no orientation state at all.

### 2.3 Still open from the June audit

- **Tests (audit §1, its top item):** there are still none for Geon.
  - The audit's route was to make the CPU engine headless for Node, then use
    the transpiler as a GPU↔CPU parity oracle. That is **obsolete** now that
    the CPU path is retired.
  - The new route is in §10.3.
- **Preset coverage (audit §3):** still 15 presets, and none turns on boson
  interaction.
  - Nothing exercises superradiance, Schwinger discharge, kugelblitz,
    Roche/disintegration, the Klein/RP² topologies or the external fields.
  - Annihilation is only incidental (Peccei–Quinn).
  - Geon still can't make a geon (§11.3).
- **Share-by-URL (audit §4):** not done. The only query parameters are `cpu`
  and `lang`.
  - Plan: a `#state=` fragment holding the serialized state, gzipped with
    `CompressionStream` and base64url-encoded, plus `?preset=`.
  - That lets blog posts embed live Geon states through the iframe directive.
  - Note that `?cpu=1` goes away with the CPU path.
- **GPU-hidden diagnostics (audit §6):** the phase-space plot and the
  effective-potential panel are hidden in GPU mode
  (`src/stats-display.js:151-152`). With the CPU path retired they would
  vanish entirely, so porting them is **a prerequisite** of §4.
- **GPU structure (audit §5):** status as of this writing. Recheck each
  before acting.
  - `gpu-physics.js` is 4442 lines. The audit recommended two extractions:
    the field subsystem, and a readback-channel helper (14 `mapAsync` call
    sites).
  - `pass-graph.js` covers radiation, boson and spin passes. Still missing:
    1PN, Barnes–Hut tree selection, field-gravity branches, pion decay and
    heatmap channels.
  - A `FRAGILE` raw write of `dt` at byte offset 0 of `SimUniforms`
    (`src/gpu/gpu-physics.js:3473`). Use a named offset.
  - Dead code: `_submitArrowDraw` (`src/gpu/gpu-renderer.js:992`) is kept
    "for backward compat" with no callers.
  - Heatmap camera/viewport math lives in `gpu-physics.js`
    (`dispatchHeatmap`) and is duplicated in `gpu-backend.js`. Move it to the
    renderer side.
  - Startup still has serial shader-fetch chains in `gpu-pipelines.js`, and
    `gpu-physics.js` `init()` re-fetches the shared WGSL itself.
  - The collision-resolution race is known and accepted at 512 particles.
    The fix, if it ever bites, is an atomic claim buffer.
- **Parked from the audit:** an ER=EPR thread, waiting for credible
  black-hole mode, which has now landed.
  - The cheap honest slice: tag annihilation photon pairs, which already have
    correlated momenta and an `emitterId`, and render the correlation (a
    faint link that decoheres on absorption).
  - This shows structure that exists rather than inventing physics. Fold it
    into an annihilation preset.

### 2.4 Reference facts from scouting

- **Units:** `BOSON_CHARGE = 0.1` makes α = e²/ħc = 0.01, within a factor of
  1.4 of nature's 1/137.
- A mass-1 body has reduced Compton wavelength 1, Schwarzschild radius 2 and
  body radius `m^(1/3)` = 1, i.e. Planck-scale. `ELECTRON_MASS = 0.01` puts
  the electron's Bohr radius near 10⁴ units, so a quantum layer needs its own
  particle mass.
- **The domain is the window size / 16** (`main.js:99-100, 490`). Resizing
  the window changes the universe.
- **The GPU has a general complex 2D Stockham FFT** at grid size
  (`src/gpu/shaders/field-fft.wgsl`). `fft.js` is imported by the GPU path for
  Green's-function setup.
- **Particles:** the GPU draws an instanced screen-aligned quad with a circle
  discard (`src/gpu/shaders/particle.wgsl`). The spin indicator is
  `spin-render.wgsl` plus `ring-render.wgsl`; torque arcs are
  `torque-render.wgsl` at ring offsets 0.5 and 1.0.
- **Infrastructure:**
  - Plasma is WebGPU-only and tests in the browser
    (`projects/plasma/tests/physics-validation.html` instantiates the
    production sim and reads back GPU state).
  - The WGSL→JS transpiler (`lib/wgsl/transpile.js`) is unwired. It handles
    compute kernels only, with no textures or samplers, and can only be used
    at build time under the CSP.
  - `tests/wgsl-transpile/gpu-diff.mjs` is a GPU-golden harness. On macOS it
    needs an installed, headed Chrome.

## 3. Versions and milestones

Versions set the order. Milestone IDs are stable names, not an order:
2.1 runs M8 before M5 and M6.

| Version | Theme | Milestones, in order | Gate |
|---|---|---|---|
| **1.5** | WebGPU only; relativity you can see; frames; honest cosmology; lensing | M0 → M0′ → M1 → M2 → M3 → M4 (§4, §5) | — |
| **2.0** | The full visual overhaul | scope to define (§6) | 1.5 |
| **2.1** | Brushwork | M8 → M5 → M6 (§7) | 2.0 |
| **2.5** | Quantum | M7 (§8) | 2.1 (painted walls) |
| **3.0** | 3D | §9 | 2.5 |

| ID | Version | Contents | Gate |
|---|---|---|---|
| **M0** (next session) | 1.5 | **GPU only; don't fix CPU copies slated for deletion.** The §5.1 clock fix (per-process clocks, emission boosts); the Roche timestep and Eggleton q; the 3+1 KG coefficients (§2.2); the lengths split (ε for particles, ℓ for field gravity, §1.2); seed the browser test page (§10.3) with the pion-beam and moving-BH oracles; fix the README Thomas claim. | none |
| **M0′** | 1.5 | Retire the CPU path (§4): port the phase plot and effective potential to readback; device-loss recovery; a "requires WebGPU" notice; delete about 8,100 lines; update the docs. Can share a session with M0. | M0 |
| **M1** | 1.5 | **Relativity you can see.** The world-line store (§10.2); τ and θ state; the spoke shader; clocks; spoke precession; domain decoupled from viewport (§10.4). | M0′ |
| **M2** | 1.5 | **Frames.** The slicer; lab, ZMF, particle and custom frames (view-only); lagged and true-now modes; the scrubber; the 1+1 Minkowski panel; the grid as lab rulers. | M1 |
| **M3** | 1.5 | **Honest cosmology.** Comoving rewrite; the a(t) selector and self-consistent background; redshift; Hubble friction; the ledger; horizons; misalignment and Kibble–Zurek presets. | M2 (grid) |
| **M4** | 1.5 | **Lensing.** Lens mode on the grid; microlensing probe. | M2 (grid) |
| **2.0** | 2.0 | The visual overhaul. Milestones are defined with its scope. | 1.5 |
| **M8** | 2.1 | **The brush, then refractive media.** The layer system and brush UI (§7.1); n grids, Fresnel optics, dispersion, Cherenkov, gravity as an index (§7.2). | 2.0 |
| **M5** | 2.1 | **Dust.** The PM collisionless species (§7.3). | M8 (brush), M3 (structure formation) |
| **M6** | 2.1 | **Gas.** The SPH species; sinks, accretion and cooling; painted gas (§7.3). | M5 |
| **M7** | 2.5 | **Quantum.** Rungs 1–2, then 3, then 4–5 (§8). The spectroscopy bench lands here, with M8's prism. | 2.1 |
| **3.0** | 3.0 | Genuinely 3D physics plus the 3D views (§9): the spacetime view, the inclined ray-traced view, the embedding diagram, and 3D photons. 2.x's symmetry-plane sector is an exact restriction of it; 2.x's slab models are effective reductions that 3.0 generalizes (§9.4). | 2.5 |

**Floating items** (not yet slotted):

| Item | Natural slot | Note |
|---|---|---|
| Liénard–Wiechert fields (§11.1) | 1.5, alongside M2, or later | Open decision 6. |
| Kerr equatorial geodesics (§11.2) | any time after M1 | |
| Share-by-URL (§2.3) | 2.0, with the UI work, or any time | Needs the domain decoupled from the viewport (M1). |
| Preset coverage (§2.3) | every version | Each version ships presets for its own features. The annihilation and photon-geon presets can land any time. |
| GW overlay, light-cone camera, Bell's spaceship, time reversal, Maxwell–Jüttner (§11) | unslotted | |

## 4. Retiring the CPU path (M0′, M)

**Decided:** WebGPU becomes the only backend. That means no Canvas physics or
renderer, no `?cpu=1`, and no CPU fallback when the device is lost.

**Port first, because only the CPU path has these:**
- **Phase-space plot and effective-potential panel.**
  - The effective potential is analytic JS over the toggles and
    selected-particle parameters. It needs the reference (heaviest) body's
    state in the readback.
  - The phase plot needs the selected and reference bodies' `r` and `v_r`
    every frame.
  - When these land in GPU mode they become the showcase for the PW and Kerr
    plunge.
- **Device-loss recovery.** Today a lost device falls back to the CPU. After
  retirement, recreate the device and restore from the existing GPU
  auto-save snapshot.
- **No-WebGPU visitors.** Plasma just throws (`src/gpu/device.js:37-38`).
  Geon should render a proper notice naming supported browsers, perhaps with a
  recorded clip, in the shared HUD style.
- **Save/load and stats.** `save-load.js` depends on `particle.js`, and
  `stats-display.js` imports CPU `energy.js`. GPU readback serialization and
  `updateEnergyGPU` already exist, so drop the CPU paths.
- **Backend abstraction.** `backend-interface.js` and the
  `sim.runtimeBackend` indirection collapse to one backend. Keep the frame
  loop's fixed-timestep accrual.

**Delete (about 8,100 lines):**
- `integrator.js`, `forces.js`, `collisions.js`, `quadtree.js`,
  `cpu-physics.js`;
- `renderer.js`, `canvas-renderer.js`, `heatmap.js`;
- `signal-delay.js`, `potential.js`, `energy.js`;
- `scalar-field.js`, `higgs-field.js`, `axion-field.js`;
- `particle.js`, `pion.js`, `lepton.js`, `massless-boson.js`,
  `boson-utils.js`.

**Keep:**
- `config.js`, `relativity.js` (used by `gpu-backend.js`),
  `physics-contract.js`, `fft.js`;
- `topology.js`, `effective-potential.js`, `phase-plot.js`, `plot-labels.js`;
- `ui.js`, `input.js` with `vec2.js`, `presets.js`, `save-load.js`,
  `stats-display.js`, `reference.js`, `i18n.js`.

**Docs to update:**
- Geon `AGENTS.md`: the two-backend architecture, the capacity table and the
  CPU gotchas.
- `README.md` and `about.md`: the tech, backend and accessibility sections.
- The parent `tests/wgsl-transpile/README.md`, which says "Geon keeps its own
  CPU backend".

**What this makes obsolete:**
- the June audit's plan to extract render concerns from `particle.js` and
  `scalar-field.js` for a headless CPU engine;
- the transpiler as a GPU↔CPU parity oracle;
- the decomposition of `integrator.js`'s 1100-line `update()`.

## 5. Geon 1.5: relativity you can see, frames, cosmology

The 1.5 feature designs. §4 (retiring the CPU path) is also part of 1.5.

### 5.1 Internal clocks on proper time (M0, S)

**[standard]** A process with rest-frame rate Γ₀ runs at Γ₀/γ in the lab.

**Not one blanket factor (Codex).** Each process needs its clock defined
before any boost or lapse is applied, and emitted quanta need transforming
consistently.

| Process | GPU site | Clock | Change |
|---|---|---|---|
| π⁰ / π± decay | `bosons.wgsl:298` (probabilities `config.js:73-74`) | pion proper time | `P = 1 − exp(−ln2·Δτ/T½)` with Δτ the whole dilated interval (`dt·m/E` per step). Replaces the `1 − (1 − p)^N` fold. |
| Hawking evaporation | `radiation.wgsl:203` | hole's rest-frame asymptotic time | `dE = P·dt/γ`. Emit in the hole frame and boost, rather than isotropically in the lab. External lapse from *other* bodies applies once clocks land; the hole's own horizon lapse never does. |
| Schwinger discharge | `radiation.wgsl` schwingerDischarge | same | `dRate·dt/γ`, with leptons emitted in the hole frame and boosted. |
| Superradiance | `field-deposit.wgsl` depositSuperradiance | hole's asymptotic frame | `dt/γ` as a first step only: `Ω_H > μ` is frame-dependent for a hole moving through a lab-grid field. Document it as valid for slow holes. |
| Roche transfer (hidden) | `disintegration.wgsl` | donor proper time | Add the missing timestep factor; fix q to donor/companion. |
| Pion emission (Yukawa "Larmor") | `radiation.wgsl` | — | Check whether it needs the relativistic Liénard form, as EM gets via LL. Don't just add 1/γ. |
| Photon/lepton lifetimes | `bosons.wgsl:121-123, 186-189` | none | Rename to culls and document them as non-physical; keep lab time; plan an exemption for bound photons. |

**Design:**
- A WGSL helper `restFrameDt(dt, w)` returns `dt/γ`, with γ from w, or from
  E/m for bosons.
- The gravitational lapse joins in §5.2, only where a process's clock calls
  for it.
- With relativity off it returns `dt`.

**Oracles:**
- **Pion beam:** with forces off, a pass-mode beam of π⁰ at fixed γ should
  survive as `N(x) = N₀·exp(−x·ln2/(γβ·T½))`. At T½ = 32 the mean life is
  about 46; at γ = 5 the decay length is about 230, against about 46
  undilated.
- **Moving hole:** a hole at γ = 2 takes twice the lab time to evaporate.

### 5.2 Proper-time clocks (M1, S–M)

**State:**
- Per-entity `τ`, recorded in history (§10.2).
- **Many bodies, weak field:** `dτ = dt·√max(0, 1 + 2Φ_N − v²)`. This is the
  leading weak-field, slow-motion form.
- **Static clock near one Schwarzschild hole [standard]:** `1 + 2Φ_N =
  1 − 2M/r = −g_tt` (signature −+++), which is exact.
- **Moving clock near one hole (Codex):** `(dτ/dt)² = f − ṙ²/f − r²Ω̇²`, with
  `f = 1 − 2M/r`; equivalently `dτ/dt = √f/γ_local`.
- **Black-hole mode:** never put the Paczyński–Wiita Φ in the lapse, because
  it vanishes at 4M. Use Newtonian Φ, the exact single-hole form for the
  dominant hole, or the ZAMO lapse once Kerr lands (§11.2).
  **[phenomenological in PW mode]**

**Display:**
- A "clocks" overlay: a thin outer ring arc that sweeps once per proper-time
  period, separate from the spoke. The spoke is matter; the sweep is time.
- An optional clock lattice of grid-intersection dots pulsing at the local
  lapse (§5.5).
- τ and dτ/dt appear in the particle panel.
- **Clock readings are invariant.** What changes between frames is which
  readings count as simultaneous.

**Oracles:**
- γ for a free particle;
- `√(1 − 2M/r)` for a clock held static;
- `√(1 − 3M/r)` on a circular Schwarzschild orbit.

### 5.3 The spoke, drawn through the Lorentz map (M1, M)

a9's call: a single spoke replaces the spin arc and arrowhead.

**Rendering [synthesis]:**
- Draw each body as its disk in its *centre's inertial frame*. A rotating
  disk has no global comoving frame (Codex).
- Push the disk, with one spoke at body angle θ, through the exact Lorentz
  map in the fragment shader:
  - a lab pixel at offset Δx along v maps to `x′ = γΔx`, `y′ = Δy`;
  - its time offset is `t′ − t′_c = −γvΔx`.
- **What you see:**
  - The disk contracts by 1/γ along v. This needs only the quad-corner
    transform in `vs_main` of `particle.wgsl`.
  - **The spoke bends** from relativity of simultaneity. The material angle
    shifts by `−ω₀γvΔx` across the body; the texture phase `θ′ − ω₀t′`
    shifts by `+`.
  - The total twist across the diameter is `2·v·v_rim` radians, about 93° at
    0.9/0.9.
  - A spoke instantaneously perpendicular to v stays straight.
- The lab rotation rate is `ω₀/γ`, via θ advancing in proper time.
- Under the 3D convention bodies are spheres. A contracted sphere is an
  oblate ellipsoid, which 3.0's inclined view (§9.2) would show.
- **Black holes:** the spoke turns at `Ω_H = a/(r₊² + a²)`. The horizon and
  ergosphere contract the same way (a boosted Kerr–Schild horizon is
  contracted in lab coordinates).
- **Collisions stay spherical.** There are no rigid bodies in special
  relativity.
- Torque arcs remain a diagnostic overlay.

**State:** orientation θ, in GPU buffers, `physics-contract.js` and history.

**Precession [standard physics, synthesis to show it]:**
- A z-spin vector cannot precess about z (Codex).
- What rotates is the in-plane transported axis θ: `θ = θ_FW + ω₀τ`. It never
  touches `angw` or S_z.
- The spoke shows:
  - Thomas precession, `2π(γ − 1)` per circular orbit, retrograde;
  - geodetic precession, `3πM/r` per orbit, prograde;
  - Lense–Thirring from GEM, equatorial, `Ω = −J/r³`.
- A non-spinning gyroscope comes back rotated after an orbit. That is a
  holonomy, the same kind of object as `comma`'s pumps, though comma's
  connection is flat and the geodetic one is curved.
- This makes the README's Thomas claim true and adds Gravity Probe B's two
  effects.
- In 3.0 (§9.4) spin becomes a vector and these become real spin precession,
  including g − 2.

**Oracles:** the twist formula; contraction 1/γ; Thomas and de Sitter angles
over one orbit.

### 5.4 Frame switching (M2, L)

**Frames:**

| Frame | Kind | Notes |
|---|---|---|
| Lab | inertial | The simulation's own frame. |
| Zero-momentum | inertial | Boost to total `P/E`. Annihilation photons go back-to-back. |
| Selected particle | instantaneous rest frame | The slice re-tilts as the particle accelerates. |
| Custom boost | inertial | Rapidity slider and direction. |
| Free fall | local inertial (Galilean, accelerated) | Subtract the selected particle's acceleration. Uniform external gravity vanishes and tides remain: Einstein's "happiest thought" as a button. |
| Co-rotating | rotating (Galilean) | Lagrange points and Jacobi curves. With relativity on, draw the light cylinder r = 1/Ω. |
| Comoving | cosmological | §5.6 display mode. |

**Building a boosted view:**
- Take the observer event `(t_O, x_O)` and velocity v, and form the
  hyperplane `t = t_O + v·(x − x_O)`.
- On each world-line, solve `g(t) = t − v·x(t) − const = 0`. g is monotone for
  subluminal motion, so bisect, then refine on the Hermite segment.
- Transform each intersection into observer coordinates. Velocities follow by
  relativistic addition; contraction and the spoke use boosted velocities;
  clocks read τ at the intersection.
- **Requirements (Codex):** world-lines continuous and unwrapped; history
  bracketing the slice; the event log reconstructs mass, charge, births,
  deaths and merges.

**Periodic domains (Codex) [standard]:**
- The torus identification `x ~ x + L` holds at equal *lab* time. Boosted, it
  becomes `x′ ~ x′ + γL` with time offset `−γvL`, so images need time shifts.
- **On a torus the lab is the topologically preferred frame.** A twin who
  merely circles the torus ages less, with no turnaround
  (Barrow & Levin 2001). That's a preset of its own.

**The future region:**
- **Lagged mode:** set `t_O = now − max_visible v·(x − x_O)` so the slice is
  all computed past. The HUD reads "your now = lab − 23".
- **True-now mode:** shade the uncomputed half-plane, "not yet happened in the
  lab". (Open decision 1.)

**Other entities:**
- **Photons:** straight-line back-extrapolation, bounded by birth time;
  lensing inside the lag window is ignored.
  - Doppler colour `E′ = γ(E − v·p)`; aberrate their directions.
  - An isotropic photon background shows a CMB-like dipole. Number-weighted
    displays need transformed sampling weights (Codex).
- **Pions:** the same approximation, worse. A short history ring comes later.
- **Scalar fields** are Lorentz scalars, so sampling a snapshot ring at the
  tilted time is exact given history.
  - About 64 snapshots at 64² is about 1 MB per field.
  - Use storage buffers for kernels, textures on the render side.
  - The lattice and its damping still define a preferred frame.
- **The heatmap:** potentials aren't scalars. In boosted frames, hide it or
  compute Liénard–Wiechert potentials from boosted world-lines (§11.1).

**Input and tools:**
- v1 is view-only in non-lab frames.
- v2 maps a spawn to lab-now on the world-line through the click, so it
  appears after the lag.
- **Block-universe scrubber:** when paused, scrub observer time and rapidity
  and re-slice. It costs nothing.
- **Minkowski panel:** a sidebar plot of world-lines projected onto the boost
  axis (x_∥ vs t), with the current slice, the light cone and proper-time
  ticks. Switching frames shears its axes. Label it a 1+1 projection.
- The full 2+1 spacetime view (§9.1) is parked for 3.0.

**Accelerated observer (Codex) [standard]:**
- Under constant proper acceleration, the slices pivot about the Rindler
  bifurcation line at Fermi distance 1/a behind. The horizons are the null
  lines through it.
- The chart covers only its wedge; past the pivot, the slices sweep backward
  in lab time.
- Finite-duration acceleration gives no true horizon.

**Covariance meter [synthesis]:**
- **[standard]** By the Currie–Jordan–Sudarshan no-interaction theorem,
  instantaneous forces make the lab Geon's ether.
- **Preset:** atom A at rest. Atom B is A's state *consistently boosted* to
  0.8c, with history seeded to match. Switch to B's frame, overlay A, and
  report the mismatch.
- **Expectations, stated carefully:**
  - Newtonian forces miss at O(v²).
  - Darwin/1PN is covariant only through its retained order, at small v.
  - Geon's 1PN currently runs alongside the toy aberration factor, so it
    certifies nothing.
  - Liénard–Wiechert restores covariance for EM only.
- The meter measures covariance per force family.

**Twin paradox presets:**
- A bounce-wall turnaround: the home clock reading on the traveller's slice
  jumps by `2vd` (no γ; d in the home frame).
- A slingshot turnaround: geodesic, and the traveller still ages less.
- The torus twin, above.

**Oracles:**
- the 1/γ ruler contraction;
- the 2vd jump;
- the Rindler bifurcation at 1/a;
- `E′ = γ(E − v·p)`;
- round-trip ageing for all three twins.

### 5.5 The background grid (M2/M4, M)

a9's call: a grid rather than stars, because it reads at every scale.

**One sheet, at rest in the lab, parallel to the slab and behind it:**
- **Multiscale:** levels at `s₀·2^k`, faded in by on-screen spacing (about
  12–48 px), with 2–3 levels visible. Weights from `_PALETTE`. A full-screen
  pass before particles.

**What it shows:**

1. **Lab rulers.** In a boosted frame the lab lattice on the observer's slice
   is an affine map of itself: compressed by 1/γ along v, drifting at −v.
2. **The lens.**
   - Thin lens, viewed along z (natural under the 3D convention): each screen
     point θ samples `β = θ − α(θ)`.
   - **[standard]** α is the gradient of the projected potential
     `ψ = Σᵢ(4Mᵢ·D_LS/(D_L·D_S)) ln|θ − θᵢ|`, a 2D log kernel. That is not the
     sim's own potential.
   - A "backdrop distance" knob fixes `D_eff = D_LS/(D_L·D_S)` in sim units.
   - Compute it by FFT with a log kernel, with explicit isolated or periodic
     handling, or by direct sum.
   - Einstein rings and moving caustics.
   - The weak thin-lens formula *cannot* make a black-hole shadow. A
     `3√3 M` capture disk is an imposed, labelled overlay. The real shadow
     needs 3.0's ray-traced view (§9.2).
   - Geon's in-plane photons are deflected separately, by 2× Newtonian
     (`src/massless-boson.js:59-70` today).
3. **Comoving coordinates (§5.6):** the lattice stretches with a(t) in the
   physical display and stays fixed in the comoving one.
4. **Clock lattice (optional):** dots pulse at local `√(1 + 2Φ)`.

**Probe:** a "backdrop star" whose magnification `|det A|⁻¹` is plotted as a
microlensing light curve. **[standard]** Point lens:
`μ(u) = (u² + 2)/(u√(u² + 4))`.

**Oracles:** `θ_E = √(4M·D_eff)`, μ(u), and 1/γ lattice compression.

### 5.6 Honest cosmology (M3, L)

**Under the 3D convention (§1.2):** this is the *FRW-background* reduction.
The slab is a slice of homogeneous 3D FRW with comoving thickness ℓ_c.

**Design:**
- **Homogeneity needs periodic boundaries.** "Universe" mode requires loop
  topology. Elsewhere, label the centred flow an *expanding cloud* or disable
  it (open decision 3).
- **Comoving coordinates:**
  - state holds comoving x and peculiar proper velocity;
  - forces use physical separations `a·Δx`;
  - peculiar gravity is sourced only by in-slab δΣ.
  - In a uniform periodic sheet the background exerts no net in-plane force
    by symmetry, which also holds over the particle-centred min-image region.
    So no Jeans-swindle term is needed for the direct sum; the PM grid drops
    k = 0. **[synthesis; verify numerically]**
- **Peculiar momentum ∝ 1/a,** exact even relativistically. Implement it as
  `w ← w·a_old/a_new`, not `w *= 1 − H dt` (Codex).
- **Photon momentum ∝ 1/a** (redshift). Photons drift in comoving coordinates.
  Pions and leptons follow the massive rule.
- **a(t):**
  - *imposed* schedules: exponential (today's behaviour), power law `t^p`, and
    matter, radiation and ΛCDM presets;
  - **or a self-consistent background closure** (Codex: defensible as an
    FRW background, not full self-consistency): `H² = (8π/3)ρ̄ + Λ/3` for the
    flat case, with `ρ̄ = Σ̄_phys/(a·ℓ_c)`. It requires:
    - every homogeneous component listed with its own continuity equation
      (matter, radiation, field energy);
    - **escaped radiation kept in the background**, not dropped;
    - confinement stresses kept out of the isotropic budget.
- **Peculiar gravity** with comoving surface density `Σ_c = a²Σ_phys` and
  fixed comoving softening ε_c:
  `Φ(x) = −(G/a)∫δΣ_c(x′)d²x′/√(|x − x′|² + ε_c²)`. Physical softening
  therefore grows ∝ a.
- **Fields:** `φ̈ + 3Hφ̇ − ∇²φ/a² + V′ = 0` for the 3D amplitude or a fixed
  comoving profile, whose transverse term is `λ_z/a²`. Derive the FRW
  perturbation terms before adding the KG gravity coupling.
- **Energy ledger:**
  - Local conservation: `d(ρa³) = −P·d(a³)`.
  - FRW has no conserved global energy for time translation, so add a
    **"redshift / expansion work"** stats line. Drift percentages then track
    numerical error only.
  - Don't call it a gravitational reservoir.
- **Horizons:** the Hubble radius c/H around the observer, and the de Sitter
  event horizon. Superluminal recession is labelled as allowed.
- **Displays:** comoving/physical toggle; a(t) and H(t) plots.

**Presets:**
- **Axion misalignment [standard]:**
  - frozen while H ≫ m_a; a crossover near H ~ m_a; then matter-like
    dilution ∝ a⁻³ once oscillations are fast and quadratic.
  - It needs explicit damping off.
- **Kibble–Zurek walls [standard: Kibble 1976, Zurek 1985]:**
  - remove the Higgs biases (§2.2);
  - specify a quench, e.g. a time-dependent mass or a temperature tied to
    a(t);
  - add fluctuation dynamics (Langevin).
  - KE deposition isn't a thermal bath.
  - Oracle: domain density versus quench time.
- **Structure formation:** a miniature cosmic web from Zel'dovich initial
  conditions, once dust lands. Expect thin-disk growth (§1.2), not 3D δ ∝ a.
- **CMB dipole:** a photon background plus a boosted frame.

**Oracles:**
- free photon `E ∝ 1/a`;
- peculiar momentum ∝ 1/a;
- imposed a(t) reproduced exactly;
- self-consistent a(t) for single-component sheets;
- zero net in-plane force from a uniform periodic background;
- axion `ρ ∝ a⁻³` after onset;
- the sheet dispersion relation `ω² = c_s²k² − 2πGΣ₀|k|·F(kℓ)` in a static
  background, and the expanding-sheet growth equation (§1.2).

## 6. Geon 2.0: the full visual overhaul

a9's call: a full visual overhaul marks 2.0. Its scope is **not yet
defined**. What follows is a starting sketch **[proposal]**, to be sharpened
with a9 before work starts (open decision 7).

**Why it sits after 1.5 and before 2.1:**
- 1.5 adds most of the new visual vocabulary: the spoke, clocks,
  contraction, frames and their HUD, the grid, lensing, the Minkowski panel,
  and cosmology's comoving and physical displays. The overhaul unifies all of
  it once, instead of restyling each piece as it lands.
- 2.1 then adds dense, layered visuals (dust sprites, gas splats, media
  tints, the brush), which want the overhaul's layer and tone system
  underneath them.

**Constraints:** the root design system governs every project.
- That means: editorial and quiet, one serif (Newsreader), a near-neutral
  ground, one per-theme oxblood accent, hairline rules, `_PALETTE.extended`
  data hues, canvas text at least 10px, light/dark parity, and none of the
  glow, shadow or gradient flourishes the root site rules out.
- The overhaul should read as that system applied to a physics canvas, not
  as a departure from it.

**Candidate pillars:**
1. **One visual grammar for entities.** A single legend for what encodes what:
   - size ↔ mass (radius `m^(1/3)`);
   - hue ↔ charge, or species;
   - the spoke ↔ orientation and spin;
   - the sweep ring ↔ proper time;
   - contraction ↔ velocity;
   - plus antimatter, horizons and ergospheres, and the photons, pions and
     leptons.
   Today's encodings grew one feature at a time.
2. **Hairline rendering.** Crisp, anti-aliased SDF strokes at constant screen
   width for spokes, rings, trails, vectors, the grid and horizons. The
   canvas would then match the site's hairline rules at every zoom.
3. **Fields and heatmaps as first-class.**
   - Perceptual, colour-vision-safe colormaps: diverging for signed
     quantities, sequential for magnitudes.
   - Explicit ranges and colorbars.
   - One colormap system shared by the heatmap, the scalar fields and lensing
     magnification.
4. **Layering and modes.**
   - A declared render-pass order, like the physics pass graph: ground, grid,
     fields, trails, bodies, bosons, overlays, HUD.
   - A "picture" mode, and a "diagnostics" mode that adds vectors, torque
     arcs and force components.
5. **Density without glow.** 2.1's dust and gas need additive accumulation
   that doesn't blow out: HDR accumulation and a tone map, tuned to the quiet
   register rather than to bloom.
6. **HUD and sidebar built around time and frames:**
   - the frame selector, observer and lag readout, clocks, the Minkowski
     panel and the ledger lines;
   - stats drawn with the shared `sparkline.js`;
   - the phase plot and effective potential, ported in M0′, redesigned to
     match.
7. **Multiscale and labels:** zoom-adaptive detail (glyph LOD, trail density),
   a scale bar, and Newsreader labels on the canvas.
8. **Accessibility and motion:** a reduced-motion mode, CVD-safe palettes,
   keyboard parity, and a layout that works at phone width.
9. **Presentation:**
   - presets that explain themselves, with captions or a short guided tour
     each;
   - a refreshed `about.md`;
   - new social-card art.

**Checks:**
- screenshot diffs across both themes and three zoom levels;
- a CVD-simulation pass over every colormap;
- frame-time budgets from GPU timestamp queries.

## 7. Geon 2.1: brushwork

In order: the brush and media (M8), then dust (M5), then gas (M6).

### 7.1 The brush and its layers (M8, M)

One brush paints typed layers, each serialized through `physics-contract.js`
as compressed grids.

| Layer | Representation | Physics |
|---|---|---|
| Gas / dust | spawner (§7.3) | density, temperature, velocity |
| Refractive medium | n grid plus dispersion | §7.2 |
| Walls | signed-distance grid | particle bounce; infinite potential for ψ |
| Potentials | grid | quantum barriers and wells |
| Field seeds | stamp | Higgs and axion amplitude |
| Flux tubes / field regions | grid | AB tubes; local E regions (Bell's spaceship, twins) |
| Detectors / probes | regions | spectrometer, quantum-cut counter, microlensing |

### 7.2 Refractive media (M8, M)

**Media are cheaper than they sound:**
- Photons travel at speed 1/n and follow `d(n·v̂)/ds = ∇n`.
- Fresnel-stochastic reflection at interfaces gives Snell's law, TIR and
  fibres.
- Dispersion n(E) makes prisms. With 2.5's quantum line spectra (§8), that's
  a full spectroscopy bench.
- Cherenkov light at `cos θ = 1/(nβ)`, at the Frank–Tamm rate.
- **Unification [synthesis]:** weak-field gravity is an index
  `n_eff = 1 − 2Φ`. Routing photon gravity through the medium code gives the
  same 4M/b deflection, and Shapiro delay falls out.

### 7.3 Dust and gas (M5 dust, M6 gas; XL)

Wanted, rated very ambitious.

**Two dynamics, shared infrastructure (Codex):** dust and gas share storage,
gravity and rendering behind a per-tracer species flag. They are not one EOS
knob.
- **Dust** is collisionless N-body: tracers interpenetrate under gravity
  alone. Collisionless matter multistreams; a pressureless *fluid* fails at
  shell crossing.
- **Gas** is SPH hydrodynamics: pressure, an energy equation, shocks and
  entropy. An isothermal-to-adiabatic knob *within* gas is fine.
- The soft-everywhere version is a mixture of the two species, not one fluid
  interpolating between them.

**Gravity is particle-mesh.**
- PQS deposit; FFT with the softened 1/r kernel. Under the 3D convention this
  is confined-slab gravity. The softening stands in for the slab thickness,
  and the true finite-thickness factor F(kℓ) depends on the transverse
  profile (§1.2).
- Real particles deposit too, but their mutual forces stay direct-sum. Keep
  the split explicit, P³M-style.
- WebGPU has no float atomics: use fixed-point i32 atomics or
  sort-and-reduce.

**Gas pressure is SPH:** Wendland or cubic-spline kernel, counting-sort
neighbour search, adaptive h, Monaghan viscosity, an energy equation.
- The alternative is Plasma's Eulerian HLLC/HLLD at B = 0: better shocks,
  bad vacuum handling, fixed resolution. Open decision 4.

**Coupling:**
- gravity both ways;
- accretion into particles and horizons, conserving momentum;
- drag and ram pressure;
- sinks: a Jeans-unstable clump becomes a Geon particle, star formation as a
  cousin of kugelblitz;
- cooling into photons and photon heating; Eddington later.

**Rendering:** dust as additive sprites; gas as a density splat tinted by
temperature.

**Frames:** density snapshot rings or back-extrapolation; no per-tracer
history.

**What it unlocks:**
- galaxy collisions with tidal tails, which revives the dropped galaxy
  preset;
- spiral density waves and bars. Thin-disk dynamics is exactly the 3D
  convention's regime.
- **dynamical friction**, which needs a resolved wake;
- Jeans fragmentation;
- accretion disks, whose inner edge sits near the PW ISCO. 6M holds only with
  Newtonian kinetics, so measure it.
- Bondi accretion; KH and RT instabilities; bow shocks;
- **the Bullet Cluster:** dust passes through, gas shocks and stalls, and the
  lensing grid shows the mass sitting off the gas. It needs the genuine hydro
  branch.

**Oracles:** acoustic speed; Sod; the sheet Jeans length; KH growth; the Bondi
rate; the Chandrasekhar friction time.

**Staging:** M5, PM dust (L); then M6, SPH gas (L), with sinks, accretion,
cooling (M) and painted gas through the brush (§7.1).

## 8. Geon 2.5: the quantum layer (M7, XL, laddered)

**What it looks like:**
- A glowing field on its own grid: brightness is `|ψ|²`, hue is `arg ψ`.
  Showing phase is honest, since the current is `|ψ|²∇arg ψ/m`.
- A moving packet is rainbow stripes one de Broglie wavelength apart; the drag
  sets the momentum.
- Bound states hold still while their hue cycles; superpositions slosh.
- A painted double slit fans the packet into fringes.
- Classical particles move through it and source its potential.

**Solver:**
- Split-step Fourier (Strang) on 256², optionally 512². Exactly unitary; it
  reuses the Stockham FFT.
- The potential is the classical one: Coulomb, gravity, Yukawa, external
  fields, painted walls.
- Boundaries: loop is native; despawn uses a complex absorbing layer; bounce
  uses hard walls; Klein and RP² use a double cover **[speculative]**.
- Units: `ħ = 1`, with a per-preset particle mass m_q and charge.
- Example: the Atom preset with Q = 3, q = 1 and m_q = 0.05 gives a₀ ≈ 6.7,
  E₁ ≈ −0.9 and a 1→2 period of about 8 time units.
- **Under the 3D convention** this is the *confined-slab* reduction. The
  particle is slab-confined, so hydrogen approaches 2D hydrogen only under
  strong confinement and an unscreened 1/r. Finite thickness means averaging
  the interaction over transverse profiles. A single-mode solver can't reach
  the 3D limit (§1.2).

**Rung 1 — one particle (L):**
- dispersion with a classical twin (where Ehrenfest holds and fails);
- double slit, gratings and the Talbot carpet; stadium scars (Heller 1984);
- tunnelling; **Gamow alpha decay** from the nucleus preset's
  Yukawa + Coulomb well, with Geiger–Nuttall emerging;
- bound states by imaginary time plus Gram–Schmidt;
- **2D hydrogen [standard]:** `E_n = −μ(qQ)²/(2(n − ½)²)`, bound 4× more
  tightly than 3D. Softening shifts the levels. Say so in the UI.
- **The hook:** with radiation on, the classical Atom spirals in (1911); the
  quantum one is stable.
- **COW:** the external-gravity slider shifts interferometer phase ∝ m²gA.

**Rung 2 — magnetism, 2D-native (M–L):**
- Landau levels `ω_c(n + ½)`.
- Torus flux quantization `qBA/2π ∈ ℤ`: the Bz slider snaps. It needs gauge
  transition functions.
- Quantum Hall edge states.
- **Aharonov–Bohm:** a painted flux tube. Classical particles feel nothing.
- Landau gauge makes the `(p_y − qBx)²` exponential exact in (x, k_y), but the
  composed step keeps splitting error, and the torus's magnetic boundary
  conditions break a naive periodic FFT in x. That's the main engineering
  risk.

**Rung 3 — relativistic (Dirac, toggled by Relativity) (M):**
- An irreducible massive 2+1 Dirac field has 2 components and **one spin
  species**; the mass sign picks the representation, and parity swaps them.
  Both species need 4 components (Codex).
- Free evolution is a 2×2 exponential per k; the spectral derivative avoids
  doubling.
- Zitterbewegung needs ± energy mixing: frequency 2E, scale about 1/(2m).
- The Klein zone needs `V > E + √(m² + p∥²)`, which is 2m only at normal
  incidence and threshold.
- Link it to Schwinger's `E_cr = m²/e`.

**Rung 4 — coupling to the classical world (M; model choices, labelled):**
- **Ehrenfest back-reaction:** honest for heavy–light pairs. Show its
  branching failure.
- **Quantum jumps (MCWF):** jump operators **plus** non-Hermitian no-jump
  evolution.
  - `A = 4ω³|d_fi|²/3` counts 3D photon modes, which the 3D convention
    supports. Under the decided planar surrogate (§1.2), the emitted photon
    is in-plane and carries the full ΔE. Label the direction sampling.
  - Include recoil and Doppler.
  - Results: line spectra with a spectrometer panel; resonant absorption; the
    photoelectric effect.
- **Measurement as spawning:** at a painted detector or the despawn edge,
  sample position from `|ψ|²` and momentum from the local current, then
  renormalize. Gamow decay then emits real alpha particles. Labelled
  Copenhagen-flavoured.
- **Bohmian tracers:** they never cross the axis only for reflection-symmetric
  states. Labelled.

**Rung 5 — fields (M–L):**
- **Gross–Pitaevskii:** quantized vortices.
  - Shedding thresholds depend on the obstacle and boundaries.
  - A vortex lattice needs an angular-momentum source plus dissipation; a
    co-rotating frame alone does nothing.
- **Schrödinger–Poisson ("fuzzy dark matter"):** the nonrelativistic limit of
  a self-gravitating axion field. Solitonic cores, granular halos. It joins
  the quantum layer, cosmology and the axion into one story.
- **A Klein–Gordon geon** (Kaup 1968; real-field oscillatons, Seidel & Suen
  1991):
  - after the KG fix, with per-preset viscosity, a reworked Φ clamp, and
    thin-slab gravity, *look for* a self-bound oscillating lump.
  - It would be a toy cousin of the real thing. **[speculative]**

**Out of scope:** many-body entanglement and lattice QFT. A curiosity: two
particles on a line fit on one 2D grid **[speculative]**.

**Oracles:** 2D hydrogen; barrier tunnelling; Talbot length `2d²/λ`; Landau
spacing; AB shift `qΦ_B`; ZB frequency; Klein transmission; norm to machine
precision.

## 9. Geon 3.0: 3D

**Decided 2026-10-23: all of this is parked for 3.0, after 2.5.** Until then
Geon stays a 2D view, with 1.5's 1+1 Minkowski panel (§5.4) standing in for
§9.1.

The 3D convention makes "3D" more than decoration: Geon *is* a slice of a 3D
world, so a 3D camera is looking at something real. Four options, in rising
ambition.

### 9.1 The spacetime view, 2+1 (3.0, M–L)

- Render the **block universe**: x and y across, t up.
  - World-lines as lines or tubes coloured by species, with proper-time ticks
    as beads.
  - Light cones from a picked event; a past cone is exactly what that event
    sees, i.e. the light-cone camera's surface.
  - The current frame's **now** as a translucent tilted plane.
  - Field history as a stacked translucent volume from the snapshot rings.
- **[standard]** A Lorentz boost is a linear map of this space that preserves
  the *Minkowski* cone, not Euclidean angles. In a Euclidean rendering it
  looks like a squeeze or shear, and switching frames visibly tilts the plane.
- **Label it flat-spacetime (Codex).** With gravity or FRW expansion, cones
  vary from place to place and a global simultaneity surface needn't be a
  plane. Draw local cones from the lapse where it matters.
- **What it makes visible:**
  - the twin paradox (the traveller's planes flip across the home
    world-line at turnaround: the 2vd jump);
  - Rindler (a hyperbolic world-line, planes pivoting about the bifurcation
    line);
  - the torus twin (time-shifted images stacked up);
  - cosmology (world-lines fanning out in physical coordinates, vertical in
    comoving ones);
  - kugelblitz and annihilation as world-line events.
- **Cost:** it reuses 1.5's world-line store (§10.2) and slicer directly. It's
  an orbit camera plus instanced lines, cones and planes. It supersedes 1.5's
  1+1 Minkowski panel.
- It's the most direct picture of the roadmap's thesis, which makes it the cheapest
  3.0 item to pull forward if wanted.

### 9.2 The inclined view: look at the slab from outside (3.0, L)

- A free 3D camera views the slab at any angle. Under the 3D convention
  bodies are lit spheres, and contraction makes them oblate ellipsoids.
- **Ray-traced lensing:**
  - march null geodesics from the camera through the masses: Schwarzschild for
    a dominant hole (exact for one non-spinning hole), Kerr after §11.2, and
    weak-field superposition elsewhere.
  - That gives real **shadows and photon rings** at any inclination, which the
    thin-lens grid (§5.5) cannot.
- **With dust and gas (§7.3):** an accretion disk seen at inclination shows the
  canonical black-hole image, with the far side of the disk lensed over the
  top and Doppler-beamed on the approaching side. **[standard physics;
  synthesis to render it here]**
- **With world-lines:** ray-trace through *spacetime* (rays sample the slicer
  at their own arrival times) and you get the true light-travel-time image,
  i.e. the light-cone camera (§11.6) in 3D. That's the stretch goal.
- The grid becomes a backdrop plane behind the slab in the scene.
- **With 3D photons**, which come in 3.0 and replace the planar surrogate,
  escaping radiation is visible leaving the slab.

### 9.3 Embedding diagram (3.0, S–M)

- **[standard]** Flamm's paraboloid `z = 2√(r_s(r − r_s))` is the exact
  isometric embedding of the exterior Schwarzschild equatorial constant-time
  slice. Under the 3D convention that is the midplane's own spatial geometry
  around one hole.
- **Kerr (Codex, correcting the draft):** the Boyer–Lindquist equatorial
  slice embeds as a surface of revolution for every r > r₊, extremal spin
  included (where it becomes an infinite throat):
  - `R(r) = √(r² + a² + 2Ma²/r)`;
  - `Z′² = r²/Δ − R′²`, with `Δ = r² − 2Mr + a²`.
- **Weak field:** the midplane's induced metric `(1 − 2Φ)(dx² + dy²)` has
  leading-order Gaussian curvature `K = ∇²_∥Φ`, which is ≈ −M/r³ off a point
  mass and matches Flamm.
  - A height graph over unchanged x, y can't reproduce that conformal factor.
  - A global Euclidean embedding isn't automatic.
  - For many bodies, show K as a heatmap. The embedding visualizes intrinsic
    geometry, not a displacement into the parent world's z.
- **The lesson to draw:** most of everyday gravity is *time* curvature. The
  sheet shows only space. A Newtonian "rubber sheet" is potential-height, not
  curvature, and must be labelled so if shown at all.

### 9.4 Geon 3.0: genuinely 3D physics (XL)

- 3.0 is the parent world itself. 2.x's particles become a reflection-symmetric
  sector of it, and 2.x's slab models become explicit confinement inside it.
  3.0 lifts the restriction:
  - **spin becomes a vector**: real Thomas, geodetic and Lense–Thirring
    precession of spin, and g − 2 via the BMT equation;
  - **non-equatorial Kerr orbits**;
  - **magnetic mirrors and bottles**, Van Allen belts and 3D field lines;
  - both GW polarizations;
  - 3D topologies (the 3-torus and friends);
  - 3D quantum (real hydrogen orbitals with spherical harmonics; Dirac
    4-spinors with fine structure);
  - an octree;
  - 128³ field grids (2M cells; fine on WebGPU, and 128³ split-step FFT is
    feasible);
  - volume rendering, with the 2D view as a *slice plane* through the 3D
    world.
- **What 1.5–2.5 can do now without hypothetical-consumer scaffolding:**
  - keep every physics formula in its 3D form (the convention already
    requires it);
  - keep the slicer dimension-agnostic in the math. Its monotone root-finding
    doesn't care whether spacetime is 2+1 or 3+1;
  - don't pre-generalize storage, trees or render.
  - 3.0 is a rewrite of storage, trees, grids and render that reuses the
    kernels' physics and the world-line design.
- **What carries over, and what doesn't (Codex):**
  - Only the *symmetry-plane* sector (§1.2) carries over exactly: planar
    orbits are an invariant sector of the 3D dynamics.
  - The confined-slab field projections, prescribed confinement, softening and
    discarded bulk radiation are *effective reductions*.
  - Evaluating a 3D field at z = 0 doesn't remove `∂_z²φ`.
  - So 3.0 generalizes 2.x's models. It won't reproduce 2.x just by hiding a
    coordinate, and the 2.x slab presets would need 3.0 counterparts with
    explicit confinement.

## 10. Architecture

### 10.1 WebGPU only

Decided (§4). WGSL is the single source of physics truth.
- Keep physics kernels on storage buffers so the transpiler can run them in
  Node; textures and samplers stay on the render side.
- Avoid barriers nested in control flow in kernels that tests transpile.

### 10.2 World-line store

- **Per sample:** `t` relative to a rolling f32 epoch, `x`, `y`, `wx`, `wy`,
  `τ`, `θ`, `angw`. That's 8 floats (32 B), up from 6.
- **Sampling:** time-based every `Δt_h`, with cubic Hermite interpolation from
  positions and velocities: O(Δt⁴) against linear's O(Δt²).
- **Span:** domain diagonal divided by c, plus the maximum boost lag, about
  128 units. 512 particles × 1024 samples at `Δt_h = 1/8` × 32 B = 16 MB.
- **Unwrapped positions** plus a wrap count, for time-shifted periodic images.
- **Event log:** births, deaths, merges, annihilations, mass and charge
  changes, and absorptions, keyed by time. Slices reconstruct scenes from it.
- **Always recorded,** not only with relativity on.
- **Bosons:** back-extrapolation first, short rings later.
- **Fields and dust density:** snapshot rings.
- **The slicer:** one WGSL module for spacelike planes `n·X = c` (n timelike)
  and past null cones.
  - Method: bisect, then Newton on the Hermite segment.
  - Consumers: signal delay, the light-cone camera, frames, the heatmap and
    the spacetime view.

### 10.3 Tests

- **Following Plasma:** a browser `tests/physics-validation.html` that
  instantiates the production sim, runs each analytic oracle, and reads back
  GPU state. Run it in an installed, headed Chrome on macOS.
- **Node kernel tests** through the transpiler where a kernel is pure compute.
  `gpu-diff.mjs` provides GPU-golden diffs.
- **Seed it in M0** with the pion beam and the moving black hole, then grow it
  with every feature's oracles.

### 10.4 Other structural moves

- **Decouple the domain from the viewport.** Presets define physical size; the
  window is a camera. This is needed for the multiscale grid, periodic
  cosmology, share-by-URL and reproducibility.
- **Finish the pass graph and the GPU extractions** (§2.3).
- **Name the pool culls** (off-domain, energy floor, age) as non-physical, with
  exemptions for bound structures.

## 11. Further explorations (not yet chosen)

Ordered by how much they strengthen the chosen work.

1. **Liénard–Wiechert fields (L).**
   - Replace the toy aberration with full velocity and acceleration fields
     from the world-line store: exact 3D Maxwell for point charges, which is
     what the 3D convention asks for.
   - Frames become honest for EM, and the covariance meter's EM column
     passes.
   - The heatmap shows the Heaviside pancake (field contraction, matching the
     spoke) and Purcell's kinked field lines.
   - It replaces Darwin's EM terms while on. The stats need an
     energy-in-transit term.
2. **Kerr equatorial geodesics (L).**
   - The slab with z-only spin is a Kerr–Newman equatorial plane, and
     equatorial motion stays there by symmetry, charged particles included.
   - Exact geodesics for test bodies around the heaviest hole in Kerr–Schild
     coordinates; PW elsewhere.
   - This brings:
     - the ISCO from 1M (prograde, extremal) to 9M (retrograde);
     - zoom-whirls and asymmetric photon orbits;
     - a real Penrose process;
     - an exact lapse for clocks;
     - Kerr V_eff in the panel;
     - Kerr ray tracing for 3.0's inclined view (§9.2).
3. **Make a geon in Geon.**
   - A photon ring on its own null orbit (~4E in toy units), which needs the
     cull exemption. It's unstable, as real geons are, ending in dispersal or
     kugelblitz.
   - The toy axion oscillaton, after the KG fixes (§8). **[speculative]**
4. **Bell's spaceship (S–M).** A tether whose rest length is proper length.
   Identical charges in an E region; the string snaps.
5. **Gravitational-wave strain overlay and chirp audio (M).**
   - A light-cone-delayed quadrupole field, consistent under the 3D
     convention: use the 3D quadrupole and TT projection, zz component
     included.
   - In-plane observers see `h_+` at half the face-on amplitude, and
     `h_× = 0`.
   - A ring of test masses; Web Audio at 2·f_orb.
6. **The light-cone camera (M).**
   - Sources at delayed positions: Doppler colour, D⁴ beaming, head-on
     delayed radial motion `v/(1 − v)`, and transverse
     `v·sinθ/(1 − v·cosθ)` up to γv (Rees 1966).
   - Paired with §5.3, it explains Terrell–Penrose. 3.0's spacetime ray
     tracing (§9.2) is its 3D form.
7. **Share-by-URL and preset coverage (S each)** (§2.3): an annihilation
   preset with the correlated-pair visual; superradiance; Schwinger;
   kugelblitz; external fields; Klein/RP².
8. **Time reversal (S).** Flip w, spin and external B. It retraces until chaos
   or something irreversible intervenes (Loschmidt). Add a shadow twin for
   Lyapunov divergence.
9. **The spectroscopy bench** (2.5: after §8 rung 4 and §7.2 media).
10. **Maxwell–Jüttner histogram (S).**

## 12. Gotchas

- f32 times on the GPU: use a rolling epoch.
- Field damping and viscosity are ether-like. Make them per-preset.
- The heatmap's delayed potential is not Liénard–Wiechert, and potentials
  aren't Lorentz scalars.
- WebGPU has no float atomics (dust deposition).
- The transpiler excludes textures, samplers and nested barriers.
- Torus identifications are simultaneous only in the lab frame.
- **Familiar approximation names don't certify Geon's hybrid integrator**
  (Codex). PW's 6M ISCO and Darwin's O(v²) covariance must be *measured*.
- **A dimensional label doesn't repair an equation** (Codex). The 3D
  convention fixes which parent equations to start from. The field equation,
  the gravity kernel, strong-field collapse and radiation transport still each
  need their own reduction.
- Never let one ℓ silently serve as confinement thickness, comoving slab
  thickness and numerical softening at once.
- The `AGENTS.md` naming rule covers every new string and comment. Use
  "signal delay", "light-cone" or "Liénard–Wiechert" for finite-speed
  propagation.
- Citations here are names and years. Verify each against its primary source
  (DOI resolver, Crossref) before it reaches `about.md` or JSON-LD (root
  `AGENTS.md` rule).
