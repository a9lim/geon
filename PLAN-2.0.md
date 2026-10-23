# Geon 2.0 — Scouting and Design Plan

Scouting pass, 2026-10-23, by Claude with a9. Codex reviewed the physics
claims adversarially the same day; its corrections are folded in and marked
"(Codex)" where they changed the design. This is a planning document, not an
implementation record: nothing below has been built yet. Line numbers are as
of commit `566e908`. A future session should treat the "Decided" and "Open
decisions" sections as the contract and everything else as a design sketch to
sharpen.

Tags: **[standard]** textbook physics with a known answer · **[synthesis]**
our own derivation or design applying standard physics · **[speculative]**
scope or model choices that need prototyping before they're trusted.
Cost: **S** about one session · **M** a few sessions · **L** a milestone ·
**XL** a multi-milestone subsystem.

## 0. What a9 has decided so far

- **Next session, on the current codebase:** fix the internal-clock bug
  (§3.1). Internal processes currently run on lab time. This ships before any
  2.0 work.
- **In scope for 2.0:**
  - spin shown as a single spoke instead of the arc and arrowhead, drawn
    through the Lorentz map so length contraction comes for free (§3.3);
  - proper-time clocks (§3.2);
  - frame switching (§3.4), which is the piece of relativity Geon is missing;
  - a background reference grid rather than stars, because a grid works at
    every scale (§3.5);
  - honest cosmology (§3.6).
- **Wanted but very ambitious:** a dust species, possibly gas-like (§3.7), and
  paintable gas and refractive media (§3.9).
- **Asked for in detail:** the quantum layer (§3.8).

## 1. Thesis: Geon 2.0 is a spacetime simulator

Geon 1.x computes *space at the current instant*. Every feature a9 picked
needs *spacetime*: a frame switch re-slices world-lines, a clock is a
world-line's proper length, a light-cone view intersects world-lines with a
null cone, and cosmology is a statement about how the slices themselves
stretch. Three organizing ideas follow from that.

1. **World-lines are first-class state.** Every entity records a history,
   including proper time and orientation. The history serves the physics
   (signal delay, Liénard–Wiechert fields) and the renderer (frames, the
   light-cone view, the Minkowski panel) alike.
2. **A view is a hypersurface.**
   - Lab simultaneity, a boosted simultaneity plane, the past light cone of an
     observer, comoving slices and rotating coordinates are all *choices of
     slice and coordinate map*.
   - One WGSL "slicer" handles all of them. It finds where a world-line meets a
     hypersurface by bisecting a monotone function, then refines with a
     Hermite fit.
   - Signal-delay forces already use the light-cone case of this slicer
     (`src/signal-delay.js`).
3. **Internal processes run on proper time.**
   - Decay, evaporation, discharge, mass transfer and spin phase all advance
     by `dτ`, not `dt`.
   - One helper supplies `dτ/dt` (kinematic, and gravitational once clocks
     land).

Cross-cutting rule: **every phenomenon ships with its analytic number.**
Examples are γβcτ survival lengths, `v/(1−v)` apparent speeds, the spoke twist
`2·v·v_rim`, Einstein radii, `E ∝ 1/a`, and the 2D hydrogen spectrum. These
numbers become the test suite the June audit (`AUDIT.md` §1) found missing;
`tests/` in the parent repo still has nothing for Geon.

## 2. Scouting findings (current state)

### Relativity and time

- **No internal process is time-dilated.**
  - Pion decay uses a fixed per-step probability: `src/config.js:73-74`,
    `src/cpu-physics.js:126`, `src/gpu/shaders/bosons.wgsl:298`.
  - Hawking mass loss is `power·dt`: `src/integrator.js:1167`,
    `src/gpu/shaders/radiation.wgsl:203`.
  - The Schwinger accumulator: `src/integrator.js:1217`.
  - Superradiance: `src/axion-field.js:219-274`.
  - Roche transfer: `src/integrator.js:2002`.
  - The spin update has no γ: `src/integrator.js:1033`.
  - Landau–Lifshitz radiation reaction *is* written covariantly
    (`src/integrator.js:1042-1080`), so it is fine.
- **Roche transfer has two independent bugs** (Codex; hidden feature).
  - `dM = overflow·ROCHE_TRANSFER_RATE·p.mass` has **no timestep factor**, on
    either backend. The rate therefore depends on how often the check runs.
  - The Eggleton ratio is computed as donor/total mass. Eggleton's formula
    uses donor/companion (`src/integrator.js:1994`).
- **There is no proper-time state and no orientation state.** Spin is
  `angw`/`angVel` only. Nothing tracks the angle a spoke would need.
- **The README claims Thomas precession; the code has none.** `README.md:20`
  says "spin-orbit coupling: spin-curvature and Thomas precession", but
  `grep -ri thomas src/` finds nothing. This is doc drift to fix, or §3.3's
  precession item makes it true.
- **History buffers:**
  - CPU and GPU both store 256 samples at a stride of 64 fixed physics steps,
    i.e. 0.5 time units per sample and about 128 time units of span
    (`src/integrator.js:1611`, `src/config.js:112-114`).
  - Interpolation is piecewise linear.
  - The GPU layout is 6 floats per sample: posX, posY, velX, velY, angW, time
    (`src/gpu/gpu-constants.js:163`).
  - History is recorded only while relativity is on.
  - Times are f32 on the GPU, including `creationTime`
    (`src/gpu/gpu-physics.js:1962`).
  - History holds kinematics only: no mass, charge, field state or lifecycle
    events. It cannot reconstruct a past *scene*, only past positions.
- **Signal delay uses a toy aberration factor.** Forces scale by
  `1/(1 − n·v)³`, capped at 100 (`src/forces.js:180-192`). The heatmap uses
  delayed positions with a plain `1/r` (`src/heatmap.js:68`), which is not the
  Liénard–Wiechert potential.

### Cosmology

- The expansion is implemented as Hubble flow about the **domain centre**,
  `x += H(x − c)dt`, with `w *= 1 − H dt`. It applies to **particles only**
  (`src/integrator.js:1339-1350`; GPU version in
  `src/gpu/shaders/expansion.wgsl`).
- As a result:
  - photons, pions and leptons neither redshift nor co-expand;
  - H is constant;
  - scalar fields get no Hubble friction;
  - in loop mode the flow is discontinuous across the wrap, so it does not
    match the torus.

### Fields

- **Weak-field Klein–Gordon coupling bug (Codex, verified).** Both fields
  carry a self-gravity coupling with a spurious `2∇Φ·∇φ` term and no `Φ̇φ̇`
  term: CPU `src/axion-field.js:166-176` and the Higgs equivalent, GPU
  `src/gpu/shaders/field-evolve.wgsl:110-111, 192-193`.
  - For the 3+1 metric `−(1+2Φ)dt² + (1−2Φ)dx²`, first order gives
    `φ̈ = (1+4Φ)∇²φ − (1+2Φ)V′ + 4Φ̇φ̇`, with **no** gradient-coupling term.
  - A genuine 2+1 metric gives `+1·∇Φ·∇φ` and `+3Φ̇φ̇`.
  - The code matches neither convention.
  - `SELFGRAV_PHI_MAX = 0.25` is not weak-field. At the lower clamp
    `1 + 4Φ = 0`.
- The axion field is also deliberately damped: `damp = AXION_COUPLING·m_a`,
  roughly Q = 20 (`src/axion-field.js:91`). Numerical viscosity `ν∇²φ̇` is
  added on top.
- The Higgs field is critically damped, `damp = 2m_H`
  (`src/higgs-field.js:80`). It is a real Z₂ double well, `V = μ²/4(φ²−1)²`,
  and has a thermal-restoration term deposited from particle kinetic energy
  (`src/higgs-field.js:117-140`).
- The Higgs symmetry is **explicitly biased** (Codex). The field resets to +1,
  exterior cells read +1, and particles deposit a positive linear source. Any
  domain-wall experiment has to remove all three.
- The GPU has a general complex 2D Stockham FFT at the grid size
  (`src/gpu/shaders/field-fft.wgsl`). The quantum layer and lensing can reuse
  it.

### Charge and units

- `BOSON_CHARGE = 0.1` (`src/config.js:76`) makes the fine-structure constant
  α = e²/ħc = 0.01, within a factor of 1.4 of nature's 1/137.
  **[synthesis]**
- A mass-1 particle has reduced Compton wavelength 1, Schwarzschild radius 2
  and body radius `m^(1/3)` = 1. Geon's bodies are effectively Planck-mass
  objects, so `ħ = 1` is not foreign to a quantum layer.
- `ELECTRON_MASS = 0.01` puts the sim's electron Bohr radius at about 10⁴
  units. A quantum layer therefore needs its own particle-mass parameter.

### Rendering

- **Spin indicator:**
  - CPU: arc plus arrowhead in `src/renderer.js:326-345`.
  - GPU: `spin-render.wgsl` and `ring-render.wgsl`.
  - Torque arcs (`torque-render.wgsl`) sit at ring offsets 0.5 and 1.0.
- **Particles:** the GPU draws a screen-aligned quad and discards outside a
  circle (`src/gpu/shaders/particle.wgsl`). An ellipse needs only the quad
  corners transformed in `vs_main`.

### Domain

- The physics domain is the **window size / 16** (`main.js:99-100, 490`).
  Resizing the window changes the simulated universe.

### Pools

- `PHOTON_LIFETIME = 256` and `LEPTON_LIFETIME = 512` are pool culls
  (`src/cpu-physics.js:111,138`, `src/gpu/shaders/bosons.wgsl:121-123,
  186-189`). A null particle has no proper time, so this is not physics.
  Leptons are documented as stable but are culled anyway. A bound photon
  structure (a geon) would be destroyed by the photon cull.

### Infrastructure

- Plasma, a sibling project, is WebGPU-only with no CPU fallback, and has
  physics-validation tests (`projects/plasma/tests/`, including convergence
  tests).
- The WGSL→JS transpiler (`lib/wgsl/transpile.js`) is retained and unwired:
  - its contract covers compute kernels only, with no textures or samplers;
  - the site's CSP forbids runtime `eval`, so it can only be used at build
    time;
  - `tests/wgsl-transpile/gpu-diff.mjs` is a GPU-golden differential harness
    that drives an installed headed Chrome.
- The structure items from the audit are still present:
  - `integrator.js` is 2021 lines, and `update()` alone is about 1100
    (lines 785-1886);
  - `gpu-physics.js` is 4442 lines;
  - about 15 mechanisms are implemented twice and kept in parity by hand.

## 3. Feature designs

### 3.1 Internal clocks on proper time — the next session (S)

**[standard]** A process with rate Γ₀ in its own rest frame runs at Γ₀/γ in
the lab.

**But don't apply one blanket factor (Codex).** Each process needs its clock
defined before any boost or lapse is applied, and emitted quanta need
transforming consistently. "Lapse × 1/γ everywhere" mixes quantities that are
defined on different clocks.

**Fix list (CPU and GPU together):**

| Process | CPU | GPU | Clock | Change |
|---|---|---|---|---|
| π⁰ / π± decay | `cpu-physics.js:126` (probabilities `config.js:73-74`) | `bosons.wgsl:298` | pion proper time | `P = 1 − exp(−ln2·Δτ/T½)` with `Δτ = dt·m/E`. This is not `P_old/γ`. |
| Hawking evaporation | `integrator.js:1167` | `radiation.wgsl:203` | hole's rest-frame asymptotic time | `dE = P·dt/γ`. Emit the burst in the hole frame and boost it, rather than isotropically in the lab. Once clocks land, external potentials from *other* bodies apply; the hole's own horizon lapse never does. |
| Schwinger discharge | `integrator.js:1217` | `radiation.wgsl` (schwingerDischarge) | hole's rest-frame asymptotic time | `dRate·dt/γ`, with leptons emitted in the hole frame and boosted. |
| Superradiance | `axion-field.js:219-274` | `field-deposit.wgsl` depositSuperradiance | hole's asymptotic frame | `dt/γ` is a first step only: the condition `Ω_H > μ` is frame-dependent for a hole moving through a lab-grid field. Document it as valid for slow holes. |
| Roche transfer (hidden) | `integrator.js:1994-2002` | `disintegration.wgsl` | donor proper time | **Add the missing timestep factor**, and fix `q` to donor/companion. |
| Pion emission (Yukawa "Larmor") | `integrator.js:1265` | `radiation.wgsl` | — | Check whether it needs the relativistic Liénard form, as EM gets via LL, rather than a 1/γ. |
| Photon/lepton lifetimes | `cpu-physics.js:111,138` | `bosons.wgsl:121-123,186-189` | none | Rename to culls and document them as non-physical. Keep lab time. Plan an exemption for bound photons. |

**GPU pion note:** the GPU folds N fixed ticks into `1 − (1 − p)^N` to match
the CPU's per-tick rate (see the AGENTS.md semantic gotchas). Replace both
with the single closed form `P = 1 − exp(−ln2·Δτ/T½)`, where Δτ is the whole
dilated interval, so CPU and GPU agree by construction.

**Design:**
- Add a helper `restFrameDt(entity, dt)`.
- For now it returns `dt/γ` from the entity's own w, or from E/m for bosons.
  The gravitational lapse joins in §3.2, only where the process's clock calls
  for it.
- Gate it behind the relativity toggle: with relativity off, it returns `dt`.

**Verification oracles:**
- **Pion beam:** with forces off, a pass-mode beam of π⁰ at fixed γ should
  have survival `N(x) = N₀·exp(−x·ln2/(γβ·T½))`. At T½ = 32 the mean life is
  about 46 units; at γ = 5 the decay length is about 230 units, against about
  46 undilated.
- **Moving black hole:** a hole at γ = 2 should take twice the lab time to
  evaporate.

Also update `README.md`/`about.md`, which currently imply relativistic
consistency.

### 3.2 Proper-time clocks (S–M)

**State:**
- Add per-entity `τ`, recorded in history so frames can read it on any slice
  (§4.2).
- **Multi-body, weak field:** `dτ = dt·√max(0, 1 + 2Φ_N − v²)`, with Φ_N the
  Newtonian potential summed at the particle. This is the leading weak-field,
  slow-motion form, using coordinate speed.
- **Static clock near one Schwarzschild hole [standard]:** `1 + 2Φ_N = 1 − 2M/r`
  is exactly `−g_tt` (signature −+++), so the static clock is exact.
- **Moving clock near one hole (Codex):** use the exact form
  `(dτ/dt)² = f − ṙ²/f − r²Ω̇²`, with `f = 1 − 2M/r`. Equivalently
  `dτ/dt = √f/γ_local`.
- In black-hole mode, **do not** put the Paczyński–Wiita Φ into the lapse: it
  vanishes at r = 4M, not at the horizon. Use Newtonian Φ, the exact
  single-hole form above for the dominant hole, or the equatorial ZAMO lapse
  if Kerr geodesics land (§5.2). **[synthesis, phenomenological in PW mode]**

**Display:**
- An optional "clocks" overlay: a thin outer ring arc that sweeps once per
  proper-time period (a stopwatch sweep), separate from the spoke. The spoke
  is matter; the sweep is time.
- Fast and deep-potential clocks visibly lag. Near a horizon the sweep
  freezes.
- The particle panel shows τ and dτ/dt numerically.

**Optional clock lattice (§3.5):** dots at grid intersections that pulse at the
local lapse, making gravitational time dilation a visible field.

**Key point for frames:** clock *readings* are invariant. What changes between
frames is *which readings are simultaneous*. That is the whole twin paradox
(§3.4).

**Oracles:** γ for a free particle; `√(1 − 2M/r)` for a static clock (held in
place); a circular Schwarzschild orbit should give `√(1 − 3M/r)`.

### 3.3 The spoke, drawn through the Lorentz map (M)

a9's call: a single spoke replaces the spin arc and arrowhead. Length
contraction comes with it.

**Rendering [synthesis]:**
- Each body is drawn as its disk in the *centre's inertial frame*, with one
  spoke at body angle θ, pushed through the exact Lorentz map in the fragment
  shader.
- A rotating disk has no global comoving inertial frame (Codex), so the
  centre's frame is the honest choice.
- For a pixel at lab offset Δx from the centre (along v):
  - the centre-frame coordinates are `x′ = γΔx`, `y′ = Δy`;
  - the centre-frame time offset is `t′ − t′_c = −γvΔx`.
- The spoke is drawn where the rest-frame material angle equals
  `θ_c + ω₀·(t′ − t′_c)`.
- **What you see:**
  - The disk is contracted by 1/γ along v. This needs only the quad-corner
    transform in `vs_main` of `particle.wgsl`.
  - Because of relativity of simultaneity, **the spoke bends**. The material
    angle shifts by `−ω₀γvΔx` across the body; the texture phase `θ′ − ω₀t′`
    shifts by `+`. The total twist across the contracted diameter is
    `2·v·v_rim` radians, with `v_rim = ω₀r`. At v = 0.9 and v_rim = 0.9 that
    is about 93°.
  - A spoke instantaneously perpendicular to v stays straight. A spoke along v
    curves most.
- The spoke's own rotation rate in the lab is `ω₀/γ` (time dilation), applied
  by advancing θ in proper time.
- **Black holes:** turn the spoke at the horizon angular velocity
  `Ω_H = a/(r₊² + a²)` rather than at a "body" rate, and contract the horizon
  and ergosphere the same way (a boosted Kerr–Schild horizon is contracted in
  lab coordinates). **[standard for horizon contraction; synthesis for the
  display rule]**
- **Collisions stay circular.** There are no rigid bodies in special
  relativity, so contracted collision shapes would be false precision. The
  radius is a toy.
- Torque arcs stay available as a diagnostic overlay. Spin ring offsets are
  re-laid around the spoke.

**State:** add orientation θ per particle (CPU, GPU, save/load via
`physics-contract.js`, and history).

**Precession of the spoke [standard physics, synthesis to show it]:**
- A z-spin vector cannot precess about z, since `Ω × S = 0` (Codex).
- What *does* rotate is an **in-plane** transported axis, and that is exactly
  what θ is. Precession updates θ only, as `θ = θ_FW + ω₀τ`, and **never**
  `angw` or S_z.
- The spoke therefore shows:
  - Thomas precession, `2π(γ − 1)` per circular orbit, retrograde;
  - geodetic (de Sitter) precession, `3πM/r` per orbit, prograde;
  - Lense–Thirring precession from GEM: in the equatorial plane of a spinning
    mass, `Ω = −J/r³`, opposite to J.
- A non-spinning "gyroscope" carried around an orbit comes back rotated. That
  is the holonomy of the transport connection: the same kind of object as
  `comma`'s pumps, except that comma's connection is flat and this one, for
  the geodetic part, is curved.
- This makes the README's Thomas claim true and adds Gravity Probe B's two
  effects.

**Oracles:**
- the spoke twist formula;
- contraction ratio 1/γ;
- the Thomas and de Sitter angles over one orbit in a Bz field or Kepler orbit.

### 3.4 Frame switching (L, with M sub-steps)

**[synthesis design; standard physics]**

**Frames:**

| Frame | Kind | Notes |
|---|---|---|
| Lab | inertial | Default. The simulation's own frame. |
| Zero-momentum | inertial | Boost to total `P/E`. Annihilation photons go back-to-back. |
| Selected particle | instantaneous rest frame | Follows the particle; the slice re-tilts as it accelerates. |
| Custom boost | inertial | Rapidity slider and direction. |
| Free fall | local inertial (Galilean, accelerated) | Subtracts the selected particle's acceleration. External uniform gravity disappears and tidal residue remains: Einstein's "happiest thought" as a button. |
| Co-rotating | rotating (Galilean) | Shows Lagrange points and Jacobi curves. With relativity on, draws the **light cylinder** r = 1/Ω, where the rotating frame breaks. |
| Comoving | cosmological | Display mode from §3.6. |

**How a boosted view is built:**
- Pick an observer event `(t_O, x_O)` with velocity v, then form the
  hyperplane `t = t_O + v·(x − x_O)`.
- For every world-line, solve `g(t) = t − v·x(t) − const = 0`. g is strictly
  monotone for subluminal motion, so this is bisection over samples plus a
  per-segment solve: the same structure as `signal-delay.js`, with a linear
  equation instead of a quadratic.
- Transform each intersection event into observer coordinates.
- Velocities follow from relativistic velocity addition. Contraction and the
  spoke use the *boosted* velocity. Clocks read `τ` at the intersection event.
- **Requirements (Codex):**
  - World-lines must be continuous and **unwrapped**.
  - History must bracket the slice.
  - The store must reconstruct the *scene*, not only positions: mass, charge,
    births, deaths and merges, via the event log in §4.2.

**Periodic domains are time-shifted under boosts (Codex) [standard]:**
- The torus identification `x ~ x + L` holds at equal *lab* time. In a boosted
  frame it becomes `x′ ~ x′ + γL` with a time offset `−γvL`.
- Plain torus wrapping is therefore wrong there. Image copies need their own
  time shifts.
- The deeper fact: **on a torus the lab is the topologically preferred frame**,
  the only one in which the identification is simultaneous. A twin who circles
  the torus ages less, without any turnaround (Barrow & Levin 2001).
- That makes a preset of its own: "the twin paradox in a compact universe."

**The future wedge:**
- With `t_O` = lab-now, every point with `v·(x − x_O) > 0` lies in the lab
  future, which hasn't been computed.
- **Lagged mode (proposed default):** set
  `t_O = now − max_visible v·(x − x_O)` so the whole slice lies in the computed
  past. The HUD says "your now = lab − 23 units". Smooth lag changes with
  damping.
- **True-now mode:** shade the uncomputed half-plane as "hasn't happened yet in
  the lab". This is itself a vivid picture of relativity of simultaneity.

**Entities other than particles:**
- **Photons:** use straight-line back-extrapolation from the current state,
  bounded by birth time. Lensing within the lag window is ignored; document
  this. Colour by `E′ = γ(E − v·p)`, and aberrate their directions.
  - With an isotropic photon background, a moving frame shows a **CMB-like
    dipole**.
  - A thermal gas gives a leading temperature dipole with higher multipoles at
    large boosts. Number-weighted displays need the transformed sampling
    weights, not just recoloured photons (Codex).
- **Pions:** the same approximation, which is worse because forces act on
  them. A short boson history ring can come later.
- **Scalar fields** are Lorentz scalars, so sampling a field snapshot ring at
  the tilted time is *exact* given history.
  - Store about 64 snapshots at 64², or about 1 MB per field.
  - Use storage buffers with manual trilinear interpolation to stay inside the
    transpiler's compute contract. A 3D texture is fine on the render side.
  - Honest caveat: the lattice and its damping define a preferred frame anyway.
- **The heatmap:** potentials are not scalars (φ is the time component of
  A^μ). In boosted frames, either hide it or compute Liénard–Wiechert
  potentials from the boosted world-lines (§5.1).

**Input:**
- v1 is view-only in non-lab frames: select, camera, pause, scrub.
- v2 could map a spawn in a boosted frame to lab-now along the world-line that
  passes through the click on the slice. It appears after the lag, which is
  honest but strange.

**Block-universe scrubber:**
- When paused, the user scrubs observer time and rapidity, and the slice
  re-renders from stored world-lines. Re-slicing a frozen spacetime costs
  nothing.

**Minkowski panel:**
- A sidebar plot of world-lines projected onto the boost axis (x_∥ vs t), with
  the current slice, the light cone and proper-time ticks.
- Switching frames shears the axes.
- It is a 1+1D projection; label it as such.

**Accelerated observer (corrected by Codex) [standard]:**
- Under constant proper acceleration, the instantaneous rest-frame slices all
  pivot about the **Rindler bifurcation line**, at Fermi distance 1/a behind
  the observer. The horizons are the null lines through it.
- The observer's chart covers only its own wedge. Past the pivot, the observer
  slices sweep backward in lab time; draw the pivot and both null lines.
- Finite-duration acceleration produces no true event horizon. Say so in the UI
  once the acceleration stops.

**Covariance meter [synthesis, important; tightened by Codex]:**
- **[standard]** The Currie–Jordan–Sudarshan no-interaction theorem
  (canonical coordinates, Poincaré symmetry, the world-line condition) rules
  out a manifestly covariant point-particle Hamiltonian theory with
  interaction. Geon's instantaneous forces make the lab its ether.
- A fast bound system viewed in its own rest frame need not look like the same
  system at rest.
- **Preset:** two independently evolved atoms.
  - Atom A is at rest.
  - Atom B is A's state **consistently boosted** to 0.8c, with its history
    seeded to match. Boosting only the current positions is not enough.
  - Switch to B's frame, overlay A, and report a mismatch number.
- **What to expect, stated carefully:**
  - Newtonian forces miss at O(v²).
  - Darwin/1PN is covariant only through its retained order, for small
    velocities. It is no guarantee at 0.8c.
  - Geon's 1PN also currently runs alongside the toy aberration factor
    (`src/forces.js:180`). Turning 1PN on does **not** by itself establish
    Darwin-order accuracy.
  - Liénard–Wiechert (§5.1) can restore covariance for **EM only**. Gravity
    and Yukawa remain non-covariant unless they get their own field treatment.
- So the meter measures how covariant the physics is per force family, rather
  than passing or failing one atom.

**Twin paradox preset:**
- A home particle stays at rest; the traveller turns around instantly off a
  bounce wall, as in the textbook version.
- In the traveller's frame, the home clock reading on the slice jumps by `2vd`
  at turnaround, with d the home-frame distance.
- Variant: a gravitational-slingshot turnaround. The traveller then stays
  inertial (in free fall) throughout and still ages less. This is the
  geodesic twin paradox.

**Oracles:**
- the 1/γ contraction of lab rulers in the boosted frame;
- the 2vd jump (no γ; d in the home frame);
- the Rindler bifurcation at Fermi distance 1/a for a charge under constant
  proper acceleration;
- photon E′ = γ(E − v·p);
- round-trip proper-time difference for the twins, including the torus twin.

### 3.5 The background grid (M)

a9's call: a grid rather than stars, because it reads at every scale.

**One sheet, at rest in the lab, behind the simulation plane:**
- **Multiscale:** levels at spacing `s₀·2^k`, faded in by on-screen spacing
  (about 12 px to 48 px), with two or three levels visible at once. Major and
  minor weights come from `_PALETTE`. A scale bar is optional. Drawn as a
  full-screen fragment pass before particles.

**What the grid shows:**

1. **The lab's rulers.**
   - In a boosted frame, the lab lattice drawn on the observer's slice is an
     affine map of itself, compressed by 1/γ along v and drifting at −v.
   - The grid is how you *see* that the lab's rulers are contracted in your
     frame. Clicking back to lab undoes it.
2. **The lens.**
   - Treat the simulation plane as a thin lens, viewed down the z-axis, with
     the sheet behind it. Each screen point θ samples the sheet at
     `β = θ − α(θ)`.
   - **[standard]** α is the gradient of the *projected* potential
     `ψ(θ) = Σᵢ (4Mᵢ·D_LS/(D_L·D_S)) ln|θ − θᵢ|`, a 2D log kernel. That is
     different from the sim's own 1/r potential.
   - Fix the distance factors with one explicit normalization: a "backdrop
     distance" knob that defines `D_eff = D_LS/(D_L·D_S)` in simulation length
     units.
   - Compute α with the existing FFT and a log kernel, which needs explicit
     isolated or periodic handling (Codex), or by direct sum for a few masses.
   - Point masses give Einstein rings. Moving masses sweep caustics.
   - **BH capture disk:** the weak thin-lens formula *cannot* produce a shadow
     (Codex). Drawing the `3√3 M` Schwarzschild critical impact parameter as a
     black disk is an **imposed overlay**, labelled as such. Pole-on Kerr
     critical curves are circular but spin-dependent.
   - This is distinct from the in-plane photon bosons, which Geon already
     deflects in-plane by 2× Newtonian (`src/massless-boson.js:59-70`). The
     sheet is out-of-plane light; document both.
3. **Comoving coordinates.** In the cosmology "physical" display the comoving
   lattice stretches with a(t). In "comoving" display it is fixed and
   structures grow against it.
4. **Optional clock lattice:** intersection dots pulse at local `√(1 + 2Φ)`.

**Probes:**
- One bright "backdrop star" marker, whose magnification `|det A|⁻¹` is plotted
  in the sidebar as a microlensing light curve.
- **[standard]** Point-lens check: `μ(u) = (u² + 2)/(u√(u² + 4))`.

**Oracles:** Einstein radius `θ_E = √(4M·D_eff)`, the μ(u) curve, and the 1/γ
lattice compression.

### 3.6 Honest cosmology (L)

**What to fix:** the expansion has a centre; photons and bosons don't redshift;
H is constant; fields get no Hubble friction; the flow is discontinuous across
the loop wrap.

**The dimensional convention comes first (Codex's sharpest point).**

Geon mixes dimensions:
- its particle forces are 3D laws evaluated in a plane;
- its fields are genuine 2+1 fields, with a 2D Laplacian on a 2D grid.

The standard comoving N-body equations,
`ẍ + 2Hẋ = −∇ₓφ/a²` with `∇ₓ²φ = 4πG·a²(ρ − ρ̄)` (ρ a physical *volume*
density), are **3D**. A planar sheet with 1/r² in-plane forces obeys no local
2D version of that Poisson equation, and its mean density does not decelerate
the expansion the way a 3D Friedmann ball does.

**Proposed convention:**
- **Geon cosmology is a 2D comoving sheet in an *imposed* expansion
  schedule a(t).** Nothing in the sheet drives a(t).
- **Free-particle peculiar momentum ∝ 1/a.** This is dimension-independent and
  exact, even relativistically. Implement it as `w ← w·a_old/a_new` rather
  than `w *= 1 − H dt` (Codex).
- **Photon momentum ∝ 1/a** (dimension-independent).
- **Number densities in the sheet dilute as a⁻².**
- **Fields** are 2+1, so use 2+1 Hubble friction:
  `φ̈ + 2Hφ̇ − ∇²φ/a² + V′ = 0`. The 3+1 form would be `3Hφ̇`. Pick one,
  document it, and test it.
- **In-plane peculiar gravity** uses physical separations `a·Δx`.
  - In a uniform periodic sheet, the background exerts **no net in-plane
    force** by symmetry. That holds for the min-image region too, which is
    centred on each particle.
  - So no explicit Jeans-swindle term is needed for the direct sum. The PM
    grid drops k = 0.
  - **[synthesis; verify numerically]**

**Design:**
- **Homogeneity needs periodic boundaries.**
  - Expansion is "universe" mode only in loop topology.
  - In despawn or bounce mode, keep the centred flow but label it an
    *expanding cloud*, which honestly has a centre.
- **Comoving coordinates:** state holds comoving x and peculiar proper
  velocity.
- **a(t) schedule selector**, labelled as imposed:
  - exponential (constant H, today's behaviour);
  - power laws `a ∝ t^p` with p as a slider;
  - "matter-like" and "radiation-like" presets that borrow their 3+1
    exponents, labelled as borrowed.
  - The earlier "self-consistent H from the sim's own density" idea is
    **dropped**: it is undefined without a dimensional reduction (Codex).
- **Bosons:** photons redshift and drift in comoving coordinates; pions and
  leptons get peculiar momentum ∝ 1/a.
- **Energy ledger:**
  - FRW has no conserved global energy for time translation, though local
    stress-energy conservation holds: `d(ρa^d) = −P·d(a^d)` with d = 2 here.
  - Add a **"redshift / expansion work"** accounting line to the energy stats,
    so the drift percentage tracks numerical error only.
  - Don't present it as energy flowing into a gravitational reservoir.
- **Horizons:** draw the Hubble radius c/H around the observer, and the event
  horizon for de Sitter. Recession faster than c beyond it is labelled as
  allowed: it isn't motion through space.
- **Displays:** a comoving/physical toggle, and a(t) and H(t) plots in stats.

**Presets this unlocks:**
- **Axion misalignment [standard]:**
  - The axion field is overdamped and roughly frozen while H ≫ m_a.
  - It starts oscillating through a crossover around H ~ m_a.
  - Once oscillations are rapid in a near-quadratic potential, it dilutes like
    matter: ∝ a⁻³ in 3+1, ∝ a⁻² under the 2+1 convention above.
  - This is how axion dark matter is born.
  - It needs the explicit field damping (`src/axion-field.js:91`) off.
- **Kibble–Zurek domain walls [standard: Kibble 1976, Zurek 1985]:**
  - An unbiased Z₂ quench forms domains separated by walls, which appear as
    lines in the plane, and the walls then coarsen.
  - **Prerequisites (Codex):**
    - remove all three explicit biases (reset to +1, exterior +1, positive
      linear source);
    - specify a quench protocol, e.g. a time-dependent mass term or a
      temperature tied to a(t);
    - add fluctuation dynamics, e.g. Langevin noise.
  - Particle kinetic-energy deposition is not automatically a thermal bath, so
    cooling today's implementation would not be a Kibble–Zurek experiment.
  - **Oracle:** domain density versus quench time.
- **Structure formation:** a cosmic web in miniature from Zel'dovich initial
  conditions, once dust lands (§3.7).
- **CMB dipole:** a photon background plus the boosted frame from §3.4.

**Oracles:**
- free-photon `E ∝ 1/a`;
- free-particle peculiar momentum ∝ 1/a;
- the imposed a(t) reproduced exactly;
- uniform periodic background giving zero net in-plane force;
- axion energy density ∝ a⁻ᵈ after oscillation onset, with d set by the
  convention;
- linear growth rates measured, not quoted: the 3D δ ∝ a does not carry over
  to the sheet.

### 3.7 Dust, and gas (XL, staged)

a9 wants this but rates it very ambitious.

**Design idea, revised (Codex):** dust and gas **share storage, gravity and
rendering, but are two dynamics behind a per-tracer flag.** They are not one
equation-of-state knob. **[synthesis]**

- **Species:**
  - 64k–256k GPU tracers;
  - per tracer: position, proper velocity, mass, and a species flag;
  - gas tracers also carry smoothing length h, density and internal energy u.
- **Dust is collisionless N-body:** tracers interpenetrate under gravity only,
  with no SPH density, pressure or viscosity acting on them (stars, dark
  matter).
- **Why not a knob:** collisionless matter develops multistreaming and
  velocity dispersion. A single pressureless *fluid* fails at shell crossing,
  so "SPH with P → 0" is a fluid with no pressure, not stars.
- **Gas is SPH hydrodynamics:** pressure, an energy equation, and shocks with
  entropy production.
- An isothermal-to-adiabatic EOS knob *within* gas is still fine.
- The soft-everywhere version of the dust/gas split is a mixture: each region
  holds both species in some proportion, rather than one fluid interpolating
  between them.
- **Gravity: particle-mesh.**
  - Deposit with PQS (existing).
  - Solve with the FFT and the existing 3D-softened Green's function, so dust
    gravity matches particle gravity.
  - Interpolate forces back.
  - Real particles deposit into the grid as well, but their mutual forces stay
    direct-sum. Keep the split bookkeeping explicit, P³M-style, so nothing is
    double-counted.
  - WebGPU has **no float atomics**, so deposition at this scale needs
    fixed-point i32 atomics or a sort-and-reduce.
- **Pressure: SPH.**
  - Wendland or cubic-spline kernel;
  - neighbour search by GPU counting sort on a cell grid;
  - adaptive h;
  - Monaghan artificial viscosity for gas only;
  - an energy equation.
  - **Alternative considered:** reuse Plasma's Eulerian HLLC/HLLD solver with
    B = 0 (proven GPU code at 256², with multigrid gravity). It gives better
    shocks, handles vacuum badly and has a fixed resolution.
  - Since dust is a separate N-body species either way, the gas solver choice
    is genuinely open.
  - Recommendation: SPH, so gas and dust share particle infrastructure,
    borrowing Plasma's validation-test style.
- **Coupling to the existing physics:**
  - gravity in both directions;
  - **accretion** into particles and horizons, conserving momentum;
  - drag and ram pressure (gas only);
  - **sink formation**, where a Jeans-unstable clump becomes a real Geon
    particle with mass and spin from its angular momentum: star formation, a
    cousin of kugelblitz;
  - cooling into photons, and photon heating. Radiation pressure and the
    Eddington limit come later.
- **Rendering:** dust as additive point sprites (the galaxy look); gas as a
  density splat to a texture, tinted by temperature.
- **Frames:** no per-tracer history. Boosted views use a density-grid snapshot
  ring, or back-extrapolation, which is approximate.

**What it unlocks:**
- galaxy collisions with tidal tails (Toomre & Toomre), which also revives the
  dropped galaxy preset;
- spiral density waves and bar instability;
- **dynamical friction**: a massive particle moving through dust brakes on its
  own gravitational wake (Chandrasekhar), emergent and honest. It needs enough
  tracers and PM resolution to resolve the wake (Codex).
- Jeans fragmentation;
- accretion disks onto black holes. Their inner edge sits near the PW ISCO,
  which is 6M only with Newtonian kinetics and r₊ = 2M (Codex). Under Geon's
  relativistic integrator, measure it rather than assuming it.
- Bondi accretion;
- Kelvin–Helmholtz and Rayleigh–Taylor instabilities (with external gravity);
- bow shocks, the acoustic cousin of Cherenkov;
- **the Bullet Cluster**: dust and gas clusters collide.
  - The collisionless dust passes through while the gas shocks and stalls, and
    the lensing grid (§3.5) shows the mass sitting off the gas.
  - This needs the genuine hydro branch: shocks, entropy and ram pressure.

**Oracles:**
- acoustic wave speed;
- the Sod shock tube;
- the Jeans length `λ_J = c_s√(π/(Gρ))`;
- KH growth rate;
- the Bondi rate;
- the Chandrasekhar friction timescale.

**Staging:**
1. Collisionless dust via PM (L).
2. The SPH gas species (L).
3. Sinks, accretion and cooling (M).
4. The brush (§3.9).

### 3.8 The quantum layer (XL, laddered)

a9 asked what this would look like.

**What it looks like on screen:**
- The quantum particle is a glowing field on its own grid: brightness is
  probability `|ψ|²`, hue is the phase `arg ψ` (domain colouring).
- Showing the phase is honest: the probability current is `|ψ|²∇arg ψ/m`.
- **A free wavepacket** appears as rainbow stripes spaced by the de Broglie
  wavelength, moving and spreading. Dragging to spawn sets the momentum, which
  sets the stripe spacing.
- **A bound stationary state** has a static `|ψ|²` whose hue cycles uniformly.
  A superposition sloshes.
- **At a painted double slit** it fans into fringes.
- Classical Geon particles move through it and source its potential.

**Solver:**
- Split-step Fourier (Strang) on 256², with 512² optional. It is exactly
  unitary and reuses the existing complex Stockham FFT.
- The potential is the classical one the heatmap already knows how to compute:
  Coulomb, gravity, Yukawa, external fields and painted walls.
- Periodic boundaries are native, so loop mode just works.
- Despawn mode uses a complex absorbing layer. Bounce mode uses hard walls.
- Klein-bottle and RP² topologies would use the double-cover trick
  **[speculative]**.
- Units: `ħ = 1` already, with a separate quantum-particle mass m_q and charge
  q_q per preset.
- Scale: a₀ = 1/(m_q·|qQ|). Example: the Atom preset's Q = 3, q = 1 with
  m_q = 0.05 gives a₀ ≈ 6.7 units, a ground-state energy of about −0.9, and a
  1→2 period of about 8 time units, which fits the screen and runs at a
  watchable speed.

**Rung 1 — one particle, no magnetism (L):**
- dispersion, with a classical twin from the same (x, p) to show where
  Ehrenfest's theorem holds and where it fails;
- double slit, diffraction gratings, and the Talbot carpet (fractal revivals);
- quantum billiards: the stadium and its scars (Heller 1984);
- tunnelling through barriers;
- **Gamow alpha decay** out of the Atomic nucleus preset's Yukawa + Coulomb
  well, with the Geiger–Nuttall law emerging as parameters vary;
- bound states by imaginary-time relaxation, plus Gram–Schmidt for excited
  states;
- **[standard] it's Flatland hydrogen.** A plane-confined particle in an
  unsoftened 1/r potential is the *2D* hydrogen atom,
  `E_n = −μ(qQ)²/(2(n − ½)²)`, with μ the reduced mass (or m against a
  heavy nucleus).
  - Its ground state is bound 4× more tightly than in 3D, and the spectrum
    differs. Say so in the UI.
  - Softening shifts the levels, so use the softened value in the oracle.
- **The narrative hook:** with radiation on, the classical Atom preset
  spirals in (Larmor), which was the crisis of 1911. The quantum atom has a
  stable ground state.
- **COW experiment:** the external-gravity slider shifts an interferometer's
  phase by an amount ∝ m²gA (Colella–Overhauser–Werner 1975).
  **[standard]**

**Rung 2 — magnetism; 2D is its native habitat (M–L):**
- **Landau levels** in uniform Bz, `E = ω_c(n + ½)`. Coherent states circle
  without spreading.
- **Flux quantization on the torus:** loop mode needs an integer number of flux
  quanta, `qBA/2π ∈ ℤ`, so the Bz slider snaps. This is a topological
  quantization, alongside Geon's charge quantization.
  - Nonzero flux also needs gauge transition functions, i.e. twisted boundary
    conditions: no globally periodic A exists.
- **Quantum Hall edge states:** against bounce walls, wavepackets skip along
  the edges in one direction only, and route around painted defects.
- **Aharonov–Bohm:** a painted flux tube with zero B outside shifts the
  double-slit fringes. Classical particles feel nothing there. It's the
  starkest classical/quantum contrast available.
- **Implementation:**
  - In Landau gauge A = (0, Bx), the term `(p_y − qBx)²/2m` is diagonal in the
    mixed (x, k_y) representation. Its own exponential is exact with a partial
    FFT.
  - It does not commute with `p_x²/2m`, so the composed step keeps ordinary
    splitting error (Codex).
- **Risk:** the magnetic boundary conditions on the torus break a naive
  independent periodic FFT in x. That is the main engineering cost of this
  rung.

**Rung 3 — relativistic, toggled by Relativity (M):**
- In 2+1D an irreducible massive Dirac field has **2 components and
  describes one spin species** (Codex: the two components are not spin up and
  spin down).
  - The sign of the mass term picks which of the two inequivalent
    representations, and parity swaps them.
  - Both spin sectors need a 4-component reducible field, as in graphene's
    valleys.
  - Either way, spin is along z, which matches Geon.
- Free evolution is a 2×2 matrix exponential per k. The spectral derivative
  avoids the doubling that naive finite differences produce.
- Phenomena:
  - **Zitterbewegung** needs a packet that mixes positive- and
    negative-energy components. It oscillates at `2E` per mode, with length
    scale about `1/(2m)`.
  - The **Klein paradox** needs a step `V > E + √(m² + p∥²)`, which reduces to
    `V > 2m` only at normal incidence and threshold energy (Codex).
  - The massless limit gives graphene-like cones.
- The Klein paradox is where single-particle quantum mechanics breaks and pair
  creation takes over. The critical field `E_cr = m²/e` there is the same one
  the existing Schwinger discharge uses. Link the two in the UI.

**Rung 4 — coupling to the classical world (M; all model choices, label them):**
- **Back-reaction (Ehrenfest mean field):** classical particles feel the
  expected force from |ψ|².
  - Honest for a heavy nucleus with a light electron.
  - Visibly wrong for branching: a split packet pushes with its average and
    never says "which way". Show that failure rather than hide it.
- **Quantum jumps (Monte Carlo wavefunction method, Dalibard–Castin–Mølmer
  1992):**
  - an excited atom jumps down at the Einstein A rate, with
    `A = 4ω³|d_fi|²/3` (charge included in d) and the dipole matrix element
    taken from the grid;
  - each jump emits one of Geon's photons with energy ΔE.
  - **Model choices (Codex):**
    - That A counts 3D free-space photon modes, whereas Geon's photons live in
      the plane. Use the 3D rate and emit an in-plane photon, in keeping with
      "a 3D world restricted to a plane", and label it.
    - A real MCWF needs jump operators **and** the non-Hermitian no-jump
      evolution between jumps, not just random photon spawning.
    - Photon energy is ΔE only without recoil. Include recoil and Doppler for
      moving atoms.
  - The result is **line spectra**, with a spectrometer panel histogramming
    photon energies at a detector.
  - Resonant photons are absorbed (Lorentzian), giving fluorescence.
  - Photons above threshold eject the electron: the photoelectric effect, with
    the threshold set by frequency, not intensity.
- **Measurement as spawning (the Heisenberg cut):**
  - when probability flux reaches a painted detector or the despawn edge,
    sample a position from |ψ|², spawn a classical particle with momentum from
    the local current, and renormalize.
  - Gamow alpha decay then emits real alpha particles.
  - Label it Copenhagen-flavoured; the cut is ours.
- **Bohmian trajectories** as optional tracer dots, guided by `v = ∇S/m`.
  - With a reflection-symmetric state and setup, they never cross the symmetry
    axis, because the normal current vanishes there.
  - Unequal slit amplitudes or phases break that (Codex).
  - Label the interpretation.

**Rung 5 — fields; the most Geon-native rung (M–L):**
- **Gross–Pitaevskii** (add `g|ψ|²ψ`): a superfluid with quantized vortices.
  - Stirring it with a classical particle sheds vortex pairs above a critical
    speed. That speed depends on the obstacle and the boundaries; it is not
    the homogeneous Landau value (Codex).
  - A rotating trapped condensate relaxes to a vortex lattice only with an
    angular-momentum source plus dissipation, e.g. a small imaginary-time
    component. Changing to the co-rotating frame (§3.4) alone does nothing.
- **Schrödinger–Poisson ("fuzzy dark matter"):** the nonrelativistic limit of a
  self-gravitating axion field.
  - It shows solitonic cores and granular interference in halos, with quantum
    pressure standing in for the Jeans length.
  - This joins the quantum layer, cosmology (§3.6) and the axion field into one
    story.
- **A Klein–Gordon geon (downgraded after review):** self-gravitating scalar
  lumps were named "Klein–Gordon geons" by Kaup (1968); for real fields they
  are oscillatons (Seidel & Suen 1991).
  - Geon's axion field has a self-gravity coupling, but it is **not yet a
    solver for them** (Codex):
    - the weak-field KG terms are wrong (§2);
    - numerical viscosity and amplitude clipping remain even with explicit
      damping off;
    - gravity comes from a softened 1/r convolution of a *surface* density;
    - the Φ clamp at 0.25 is not weak-field.
  - **Prerequisites:**
    - fix the KG terms under a declared 2+1 or 3+1 convention;
    - make viscosity per-preset;
    - rework the clamp;
    - then *look for* a self-bound oscillating lump.
  - What results would be a Geon-native toy cousin of an oscillaton, not
    Seidel–Suen's object. **[speculative]**

**Explicitly out of scope:** many-body entanglement, which grows
exponentially, and lattice QFT.
- One niche curiosity: two particles on a *line* fit on one 2D grid, and
  entanglement then shows as non-product structure. **[speculative]**

**Oracles:**
- the 2D hydrogen spectrum;
- tunnelling rates for a rectangular barrier;
- Talbot length `2d²/λ`;
- Landau-level spacing;
- AB fringe shift `qΦ_B`;
- Zitterbewegung frequency;
- Klein transmission;
- norm conservation to machine precision.

### 3.9 Paintable layers: one brush, many layers (M for the brush, then per layer)

a9 calls these fun but ambitious. The enabling investment is a single brush
tool that paints into typed layers. Each layer is either a grid or a spawner,
and each serializes through `physics-contract.js` as compressed grids.

**Layers:**

| Layer | Representation | Physics |
|---|---|---|
| Gas / dust | spawner (§3.7) | density, temperature and velocity of the stroke |
| **Refractive medium** | grid of n, plus dispersion coefficient | see below |
| Walls | signed-distance grid | particle bounce geometry; an infinite potential for ψ |
| Potentials | grid | quantum barriers and wells |
| Field seeds | stamp | Higgs and axion amplitude |
| Flux tubes / field regions | grid | AB tubes; local E regions (Bell's spaceship and twin demos) |
| Detectors / probes | regions | spectrometer, Geiger counter (the quantum cut), microlensing probe |

**Media is cheaper than it sounds:**
- Photons travel at speed 1/n and follow the ray equation
  `d(n·v̂)/ds = ∇n`.
- At sharp interfaces, photons reflect stochastically with Fresnel
  probabilities: Snell's law, total internal reflection and optical fibres for
  free.
- Dispersion n(E) splits photons by energy in a prism. Combined with §3.8's
  line spectra, that's a full spectroscopy bench: atom, prism, spectrometer.
- A charge moving faster than 1/n emits **Cherenkov** photons at
  `cos θ = 1/(nβ)`, at the Frank–Tamm rate.
- **Unification [synthesis]:** weak-field gravity acts on light as an index
  `n_eff = 1 − 2Φ`.
  - Routing photon gravity through the medium code would replace the explicit
    2× Newtonian deflection.
  - It would give the same 4M/b deflection, and the **Shapiro delay** would
    emerge on its own.

## 4. Architecture for 2.0

### 4.1 Backend (open decision)

**Options:**
- **A. WebGPU-only, with WGSL as the single source of physics truth.** This is
  Plasma's precedent. The CPU path is retired; Node tests run the kernels
  through the transpiler and the GPU-golden harness.
- **B. Keep both backends.** Every feature then doubles. Several 2.0 layers
  aren't feasible on the CPU at all: 10⁵ tracers, 512² quantum grids,
  per-pixel lensing, world-line slicing for 4096 photons.
- **C. GPU-primary with a frozen CPU "lite" path:** lab frame and the 1.x
  physics only. It still taxes every shared physics fix, including §3.1.

**Recommendation: A.**
- It matches the standing "one authoritative path" preference.
- WebGPU ships in Chrome, Edge and Safari 26, and Firefox is rolling it out.
- A non-WebGPU visitor would get a "requires WebGPU" page, perhaps with a
  recorded clip.
- a9's call, because it drops real users.

**Constraints if A:**
- Keep physics kernels on storage buffers. Textures and samplers are outside
  the transpiler contract, so they belong on the render side only.
- Avoid barriers nested in control flow in kernels that tests need to
  transpile.

### 4.2 World-line store

**Per sample:**
- `t` (relative to a rolling f32 epoch), `x`, `y`, `wx`, `wy`, `τ`, `θ`,
  `angw`: 8 floats, 32 B.
- That is up from 6 floats today.

**Sampling:**
- Time-based, every `Δt_h`, using **cubic Hermite** interpolation from the
  stored positions and velocities. That gives O(Δt⁴) position error, against
  linear's O(Δt²).
- Today's spacing of 0.5 time units is coarse for short orbits.

**Span:**
- At least the domain diagonal divided by c, plus the maximum boost lag. For a
  domain of 100 × 62, that's roughly 128 units.
- With 1024 samples at `Δt_h = 1/8`: 512 particles × 1024 × 32 B = 16 MB. Fine.

**Unwrapped positions:**
- Store continuous coordinates plus a wrap count, so boosted views of periodic
  domains can apply the time-shifted images from §3.4.

**Event log (Codex):**
- Per entity: births, deaths, merges, annihilations, mass and charge changes,
  and absorptions, all keyed by time.
- Slices then reconstruct the *scene*, not just positions.
- Mass and charge on a slice come from the log, so they don't need storing in
  every sample.

**Recording:**
- Record **always**, not only when relativity is on, since clocks and frames
  need it.
- Bosons: back-extrapolation first, optional short rings later.
- Fields and dust density: snapshot rings (§3.4).

**The slicer:**
- One WGSL module with two hypersurface types:
  - a spacelike plane, `n·X = c` with n timelike;
  - the past null cone of an event.
- Method: bisect a monotone g over the samples, then a Newton refinement on the
  Hermite segment.
- Consumers: signal-delay forces, the light-cone camera (§5.6), frames, the
  heatmap and the Minkowski panel.

### 4.3 Other structural moves

- **Decouple the domain from the viewport.** A preset defines the physical
  domain; the window is only a camera. This is needed for the multiscale grid,
  periodic cosmology and reproducible presets. Today the domain is window / 16
  (`main.js:99-100`).
- **Finish the pass graph** (`AUDIT.md` §5). Each mechanism becomes a module
  with its own kernel, toggle dependencies, contract entries and an analytic
  test.
- **Tests:** start from Plasma's validation harness and Geon's analytic
  oracles. Run kernels in Node via the transpiler for fast checks, and
  `gpu-diff.mjs` for GPU-golden parity.
- **Pool culls are named culls.** Photon and lepton caps cull by
  off-domain, energy floor or age, explicitly labelled as non-physical, with
  exemptions for bound structures.

## 5. Further explorations (not yet chosen)

These are ordered by how much they strengthen the chosen features.

1. **Liénard–Wiechert fields (L).**
   - Replace the toy `1/(1 − n·v)³` (`src/forces.js:180`) with the full
     velocity and acceleration fields computed from the world-line store. That
     is exact 3D Maxwell for point charges.
   - It is what makes frame switching *honest physics* for EM, rather than a
     view of non-covariant dynamics. The covariance meter's EM column (§3.4)
     should then pass; gravity and Yukawa stay toy.
   - The heatmap would show the Heaviside "pancake": a moving charge's field is
     itself contracted by γ, which ties back to the spoke.
   - It would also show Purcell's kinked field lines expanding at c when a
     charge stops.
   - **Why not a 2D Maxwell grid:** that would give 1/r forces and Flatland
     wakes, because Huygens' principle fails in 2D. LW keeps Geon's 3D laws.
   - It replaces Darwin's EM terms while on. The stats need an
     energy-in-transit term.
2. **Kerr equatorial geodesics (L).**
   - Geon's plane with z-only spin *is* the equatorial plane of a
     Kerr–Newman hole, and equatorial motion stays there by reflection
     symmetry, charged particles included.
   - A "background spacetime" slot would integrate test bodies around the
     heaviest hole on exact geodesics in Kerr–Schild coordinates; everything
     else stays on PW.
   - This brings:
     - the ISCO, from 1M prograde to 9M retrograde at extremal spin;
     - zoom-whirl orbits;
     - asymmetric photon orbits;
     - a real Penrose process (the particle version of the superradiance Geon
       already has);
     - an exact lapse for the clocks;
     - the real Kerr V_eff in the effective-potential panel.
3. **A geon in Geon, two ways.**
   - A photon ring on its own null orbit (r ~ 4E in the toy's units). It needs
     the cull exemption; it is unstable, as real geons are, and ends by
     dispersing or collapsing into a kugelblitz.
   - A toy axion oscillaton, after the KG fixes in §3.8 rung 5.
     **[speculative]**
   - The audit flagged this and it's still true: 15 presets, none with boson
     interaction on.
4. **Bell's spaceship (S–M).** A tether whose rest length is a proper length
   (via the bond primitive of §3.7 or a dedicated spring). Accelerate two
   identical charges in an E region and the string snaps: length contraction
   as a force.
5. **Gravitational-wave strain overlay and chirp audio (M).**
   - A light-cone-delayed quadrupole field drawn edge-on, with + polarization only.
   - A ring of free test masses that deforms as the wave passes.
   - Web Audio at f = 2·f_orb, so the inspiral can be heard.
6. **The light-cone camera (M).**
   - Draw each source at its delayed position as seen from an observer:
     - Doppler colour;
     - D⁴ beaming;
     - head-on, the delayed radial position moves at `v/(1 − v)` (9c at 0.9);
     - transverse image motion `v·sinθ/(1 − v·cosθ)`, up to γv at
       cosθ = v (Rees 1966);
     - aberration for a moving observer.
   - Paired with §3.3, it explains the Terrell–Penrose effect: contraction is
     not what a camera sees.
   - `getDelayedState` already solves it.
7. **Time reversal (S).** Flip w, spin and external B. The run retraces until
   chaos amplifies round-off or something irreversible happens (radiation,
   merges, stochastic emission): Loschmidt's paradox. Add a perturbed "shadow
   twin" for Lyapunov divergence.
8. **Spectroscopy bench (preset, after §3.8 rung 4 and §3.9 media):** atom,
   prism, spectrometer.
9. **Maxwell–Jüttner histogram (S)** for hot gases. Relativistic equipartition
   emerges from collisions.

## 6. Proposed sequencing

| Milestone | Contents | Gate |
|---|---|---|
| **M0** (next session) | On 1.x: the §3.1 clock fix (per-process clocks, emission boosts); the Roche timestep factor and Eggleton q; seed analytic tests (pion beam, moving BH); the README Thomas drift. Also the KG self-gravity coefficients, once open decision 8 picks a convention. | none, except decision 8 for the KG item |
| **Decision gate** | §4.1 backend; §4.3 domain decoupling | a9 |
| **M1 — relativity you can see** | world-line store (§4.2), τ and θ state, the spoke shader, clocks, precession | M0 |
| **M2 — frames** | slicer; lab / ZMF / particle / custom frames (view-only); lagged and true-now modes; scrubber; Minkowski panel; the grid as lab rulers | M1 |
| **M3 — honest cosmology** | comoving rewrite, a(t) selector, redshift, Hubble friction, ledger, horizons; misalignment and Kibble–Zurek presets | M2 for the grid |
| **M4 — lensing** | lens mode on the grid, microlensing probe | grid |
| **M5–M6 — dust → gas** | PM dust; SPH; sinks and accretion; brush v1 | M3 for structure formation |
| **M7 — quantum** | rungs 1–2, then 3, then 4–5 | brush for walls |
| **M8 — media** | the refractive layer, Cherenkov, prism | brush; M7 for the bench |
| **Parallel options** | LW fields (best before or alongside M2); Kerr equatorial (any time after M1) | — |

## 7. Open decisions for a9

1. **Backend:** WebGPU-only (recommended), dual, or a frozen CPU lite path.
   §4.1.
2. **Default frame-view mode:** lagged (filled) or true-now (uncomputed wedge
   shown). §3.4.
3. **Clock display:** a sweep ring (proposed), a pulse, or a numeric readout
   only. §3.2.
4. **Expansion outside loop mode:** keep it as a labelled "expanding cloud"
   with a centre, or disable it. §3.6.
5. **Gas solver:** SPH, which shares particle infrastructure with the dust
   species (recommended), or Plasma's Eulerian solver. §3.7.
6. **Quantum interpretation surface:** whether to ship the measurement-as-spawn
   cut, Bohmian tracers, both, or neither. §3.8 rung 4.
7. **LW fields:** whether to bring them in before frames, so frames are honest
   for EM on day one, or after. §5.1.
8. **The dimensional convention for fields and cosmology:**
   - 2+1, matching the fields' 2D Laplacian. This gives 2Hφ̇, a⁻² dilution, and
     KG coupling `+∇Φ·∇φ + 3Φ̇φ̇`.
   - 3+1, matching the particles' 3D force laws. This gives 3Hφ̇, a⁻³, and no
     gradient term with `+4Φ̇φ̇`.
   - Recommendation: **2+1 for fields**, since their wave equation is already
     2+1. Particle forces stay 3D laws in the plane, and the mix is
     documented. §2, §3.6.

## 8. Gotchas found while scouting

- The domain is tied to the window size (`main.js:99-100, 490`).
- GPU times are f32. Store times relative to a rolling epoch in 2.0.
- Field damping (axion Q ≈ 20, Higgs critical) is an ether-like friction. It
  kills oscillatons and gives fields a preferred frame. Make it a per-preset
  knob.
- `PHOTON_LIFETIME` destroys any bound photon structure.
- The heatmap's delayed potential is not Liénard–Wiechert, and potentials
  aren't Lorentz scalars (relevant in boosted frames).
- WebGPU has no float atomics, which affects dust deposition.
- The transpiler contract excludes textures, samplers and nested barriers.
- The AGENTS.md naming rule applies to every new string and comment. Use
  "signal delay", "light-cone" or "Liénard–Wiechert" for finite-speed
  propagation.
- The paper citations here are names and years from memory or from the
  review. Verify each against its primary source (DOI resolver, Crossref)
  before any of them goes into `about.md` or JSON-LD, per the root AGENTS.md
  identifier rule.
- Leptons are documented as stable but culled at 512 time units.
- The weak-field KG coupling in both fields has a spurious `2∇Φ·∇φ` term and
  no `Φ̇φ̇` term (CPU and GPU).
- Roche transfer has no timestep factor, and its Eggleton q is donor/total
  instead of donor/companion.
- Torus identifications are simultaneous only in the lab frame. Boosted views
  of loop mode need time-shifted images.
- The Higgs Z₂ is explicitly biased (reset, exterior, source), so no
  symmetric-breaking experiment is valid until that's removed.
- Familiar approximation names don't certify Geon's hybrid integrator
  (Codex). Paczyński–Wiita's 6M ISCO and Darwin's O(v²) covariance both have
  to be **measured** here, not quoted.
