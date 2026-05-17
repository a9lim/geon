# AGENTS.md

Part of the **a9l.im** portfolio. See root `AGENTS.md` for the shared design system and shared code policy. Sibling projects: `shoals`, `cyano`, `gerry`, `scripture`.

## Rules

- Always prefer shared modules over project-specific reimplementations. Check `shared-*.js` files before adding utility code.
- Never use the phrase "retarded potential(s)" in code, comments, or user-facing text. Use "signal delay" or "finite-speed force propagation" instead.

## Running Locally

```bash
cd path/to/a9lim.github.io && python -m http.server
```

Serve from root — shared files load via absolute paths. No build step, test framework, or linter.

## Overview

Interactive particle physics simulator. Boris integrator, BH tree acceleration, Higgs/Axion scalar fields, WebGPU compute+render backend with CPU fallback, 19 presets across gravity/EM/exotic/cosmological scenarios. Zero dependencies, vanilla ES6 modules.

## Architecture

**`main.js`** (~640 lines): Simulation shell, input/UI/state ownership, backend selection (CPU/GPU), and `window.sim` for debugging. The frame loop is intentionally backend-agnostic: it accrues fixed timestep debt, then delegates stepping, input polling, and rendering through `sim.runtimeBackend`.

**Two interchangeable runtime backends**:
- **CPU**: `CPUPhysics` owns CPU stepping, boson lifecycles, dead-particle cleanup, and Canvas rendering over `integrator.js` / `renderer.js`.
- **GPU**: `GPUBackend` owns GPU canvas/device lifecycle, CPU↔GPU snapshots, GPU auto-save recovery, event readback handling, `GPUPhysics` compute, and `GPURenderer` instanced rendering.

Falls back to CPU on WebGPU unavailability or device loss. Force CPU via `?cpu=1`.

Backend switching should go through `sim.useGPUBackend()` / `sim.useCPUBackend()`. Single-step and main-loop stepping should go through `sim.runtimeBackend.stepOnce(sim)` / `sim.runtimeBackend.step(sim)` rather than branching directly on `sim.backend` in UI or loop code.

**Key modules**: `integrator.js` (Boris substep loop, all physics), `forces.js` (pairForce, BH tree walk, 1PN), `scalar-field.js` (PQS grid base), `higgs-field.js` / `axion-field.js` (field subclasses), `quadtree.js` (SoA flat typed arrays, pool-based), `physics-contract.js` (shared toggle/parameter/save-load contract), `ui.js` (toggle deps via shared `_forms.bindDeps`, mode locking, backend switching), `presets.js` (19 scenarios).

## Physics

### Units & State

c = G = ħ = 1. All velocities are fractions of c. Both linear (`p.w` = γv) and rotational (`p.angw`) state use proper velocity. When relativity off: `vel = w` identity.

`p.bodyRadiusSq` is always the intrinsic body radius squared (`∛mass²`) and is the source of spin inertia/magnetic moment/angular momentum. In black-hole mode, `p.radiusSq` is the effective Kerr-Newman horizon radius squared and must not be used for spin inertia. Energy stats include rest mass (`totalMass`) plus kinetic, spin, field, potential, and radiated terms.

### Boris Integrator (per substep)

Half-kick → Boris rotation (Bz + Bgz + extBz) → half-kick → spin-orbit/radiation/pion emission → drift → 1PN velocity-Verlet correction → scalar field evolution (Störmer-Verlet KDK) → quadtree rebuild + collisions → external/scalar field forces

Adaptive substepping: `dtSafe = min(√(softening/a_max), (2π/ω_c)/8)`. Max 32 substeps.

### Sign Conventions

All GEM interactions are **attractive** (gravity has one sign of "charge"):
- GM dipole: `+3L₁L₂/r⁴` (positive = attractive)
- GM Boris parameter: `+2Bgz` (co-moving masses attract)
- Angular velocity (y-down canvas): `rx·vy - ry·vx` gives positive for clockwise on screen

### Toggle Dependencies

```
Forces:                        Physics:
  Gravity                        Relativity          [signal delay auto-activates]
    -> Gravitomagnetic             -> 1PN             [requires Magnetic, GM, or Yukawa]
    (field gravity auto-on)        -> Black Hole      [+Gravity, locks collision to Merge]
  Coulomb                        Spin-Orbit           [requires Magnetic or GM]
    -> Magnetic                  Radiation             [requires Gravity, Coulomb, or Yukawa]
  Yukawa               [independent]  Boson Interaction [requires BH + (Gravity OR Coulomb)]
                                         -> Kugelblitz  [auto, requires Gravity]
  Axion                [requires Coulomb, Yukawa, or BH]
  Higgs                [independent]
Disintegration                   [requires Gravity, locks collision to Merge] **HIDDEN**
Barnes-Hut                       [independent]
Expansion                        [independent, in Engine tab]
```

Enable/disable cascade and slider group visibility use shared `_forms.bindDeps()` in `ui.js`. `updateAllDeps()` calls `updateDeps()` (from `bindDeps`) plus sim-specific mode locking (collision/boundary) and GPU sync.

### Kerr-Newman Horizons

`kerrNewmanRadius(M, radiusSq, angVel, charge)` in `config.js`: sub-extremal `r₊ = M + √(M² - a² - Q²)`. Super-extremal toy inputs (`a² + Q² > M²`) clamp to `r₊ = M` as an effective radius for stable rendering/evolution; this is not a physical naked-singularity or cosmic-censorship model. Same clamp logic appears in `cache-derived.wgsl`, `radiation.wgsl`, and `field-deposit.wgsl`.

### Schwinger Discharge

Schwinger discharge at BH horizons. Rate: `Γ = (e²Q²)/(π²Σ) × exp(-πE_cr Σ/|Q|)`, `Σ = r₊² + a²` (KN area factor), `e = BOSON_CHARGE`, `E_cr = m_e²/e`. Threshold `0.5·E_cr`. Lepton KE from horizon potential: `eΦ_H - m_e` where `Φ_H = |Q|r₊/Σ`. Per event: BH loses `BOSON_CHARGE` charge and `ELECTRON_MASS` mass (KE not subtracted — prevents runaway). Same-sign lepton escapes, opposite falls back. Requires BH + Coulomb + Radiation. Accumulates rate per substep; emits at 1. CPU: `integrator.js` (after Hawking). GPU: `radiation.wgsl` `schwingerDischarge`, leptons share pion pool (`kind=1u`). Generic high-energy photon-to-particle conversion was intentionally removed; do not reintroduce it under a new name.

### Superradiance

Axion field amplification by spinning BHs. Rate: `Γ = (M·μ_a)² · max(Ω_H - μ_a, 0) · (1 + φ²)`, where `Ω_H = a/Σ` is horizon angular velocity and `φ` is the local axion field amplitude. Phenomenological α² scaling (real rate ∝ α⁸, too steep for interactive sim). The `(1 + φ²)` factor gives exponential cloud growth (stimulated amplification) from a constant vacuum seed (spontaneous), analogous to stimulated emission `Γ = A(1+n)`. Back-reaction: BH loses mass `dM = dE` and angular momentum `dJ = dE/μ_a` (m=1 mode at frequency ω ≈ μ_a; entropy production `TdS = dE(Ω_H/μ_a − 1) > 0`). Natural saturation when `Ω_H ≤ μ_a`. No accumulator (continuous deposit, not discrete event). Deposits an energy-normalized PQS impulse into axion `fieldDot`: the immediate field kinetic-energy increase equals the accepted `dE`, then the same `dE` is removed from BH mass/spin. Requires BH + Axion. CPU: `axion-field.js` `_depositSuperradiance()` samples field via `interpolate()` and normalizes against local `fieldDot`. GPU: `field-deposit.wgsl` `depositSuperradiance` reads `φ²` from `axYukMod[pid].w` (set by `field-forces.wgsl` `applyAxionForces` at pass 5c, consumed at pass 15) and adds the normalized impulse with `finalizeDepositAdd`. GPU deposit pipeline has a 3-group layout (group 2 = axYukMod read-only) separate from the 2-group layout used by other deposit entry points. Torque display: `torqueSuperradiance` (CPU) / `f5.z` (GPU), rendered as indigo arc at offset 1.0 (second ring from center; contact torque is innermost at 0.5).

### Kugelblitz Collapse

Boson energy exceeding the hoop conjecture threshold (E > r/2, natural units) condenses into a massive particle. Detection walks the boson BH tree after aggregation: `totalMass[node]` (= total source energy) vs full node extent / 2. Smallest qualifying node collapses first. Collects all bosons in subtree, computes COM/momentum/charge/angular momentum, then spawns a particle from the invariant mass `sqrt(E² - |P|²)` and velocity `P/E`. Near-null clusters are rejected rather than becoming superluminal massive particles. Radiation bookkeeping subtracts only consumed previously-radiated photons/pions from `totalRadiated` and radiated momentum. Guards: CPU uses `MIN_KUGELBLITZ_COUNT` (4) + `MIN_KUGELBLITZ_ENERGY` (0.2); GPU skips count check (GPU `N_PARTICLE_COUNT` is a visitor-flag protocol value, not subtree count) and uses energy + size only. Max 1 per substep. Requires Gravity + Boson Interaction (no separate toggle). CPU: `integrator.js` `_checkKugelblitz()`, node size = `bw * 2` (full extent from half-extents). GPU: `kugelblitz.wgsl` `checkKugelblitz`, node size = `maxX - minX` (full extent), 48-byte event readback to CPU for particle spawn. `totalCount` array on `QuadTreePool` (computed in `calculateBosonDistribution`) tracks boson count per node for CPU path.

### Annihilation

Matter/antimatter particle annihilation emits two photons with exact lab-frame energy and momentum conservation. CPU carries collision event `{energy, px, py}` through `collisions.js` and emits via `sim.emitPhotonBurstWithMomentum()`. GPU collision events are 32-byte `MergeResult` records (`p0 = x,y,energy,type`, `p1 = px,py,pad,pad`); `merge-photons.wgsl` runs immediately after `resolveCollisions` and appends the two photons on-device. Field excitations consume the same merge-event readback and include both merge and annihilation event energies.

### Quantized Boson Charge

All charges quantized in units of `BOSON_CHARGE` (config.js, default 0.1). `addParticle()` rounds to nearest multiple (CPU `main.js`, GPU `gpu-physics.js`). Pions/leptons carry `±BOSON_CHARGE` or `0.0`. Conservation maintained: emission/absorption/decay/disintegration all transfer in `BOSON_CHARGE` quanta. Annihilation uses `abs(charge) < EPSILON` (not exact equality).

### Higgs Mass Modulation

When Higgs enabled, Yukawa range parameter μ_eff = `yukawaMu · √(higgsMod_i · higgsMod_j)` where `higgsMod = max(|φ(x)|, HIGGS_MASS_FLOOR)` cached per particle. Geometric mean per pair. GPU: `higgsMod` in `axYukMod.z`.

### Scalar Field Base

PQS (cubic B-spline) grid: 64×64 (CPU), 128×128 (GPU). 4×4 stencil. C² interpolation and gradients. Field arrays: `field`/`fieldDot` (not `phi`/`phiDot`). Clamp: SCALAR_FIELD_MAX = 2.

Self-gravity via FFT convolution with Green's function. `computeSelfGravity(domainW, domainH, softeningSq, bcMode, topoConst)` — callers pass boundary mode directly, not a boolean. Called twice per KDK for O(dt²) accuracy.

Merge/annihilation scalar excitations are energy-normalized impulses into `fieldDot`: CPU `depositExcitation()` and GPU `field-excitation.wgsl` solve the local amplitude from the current `fieldDot` cross term so the immediate kinetic-energy increase equals the event energy. Do not restore the old `scale * sqrt(energy)` cap model.

## GPU

### Capacity Limits

| Resource | CPU | GPU |
|----------|-----|-----|
| Particles | 128 | 512 |
| Photons | 1024 | 4096 |
| Pions | 256 | 1024 |
| Leptons | 256 | 1024 (shares pion pool, total 2048) |

### Shader Organization

All shaders prepended with `wgslConstants + shared-structs.wgsl + shared-topology.wgsl + shared-rng.wgsl`. Tree-walk shaders add `shared-tree-nodes.wgsl`. `fetchShader()` in `gpu-pipelines.js` is single source of truth.

`SHADER_VERSION` in gpu-pipelines.js must be bumped after shader edits to invalidate browser cache.

### GPU Pass Graph

`gpu/pass-graph.js` derives per-frame dispatch booleans from current toggles and alive counts. Use it to skip whole inactive pass families (spin-orbit, torque application, radiation subpasses, boson update/interaction, kugelblitz readback) without scattering ad hoc toggle checks through the frame loop. Keep the plan conservative: if existing photons/pions/leptons/bosons may still need cleanup or absorption, keep their update passes alive even when the creation toggle is off.

Boson pool pass sizes are generated by `dispatch-args.wgsl` into an indirect-dispatch buffer (photons, pions/leptons, total bosons, boson-tree nodes). Use indirect dispatch for pool-sized boson passes when available; keep the explicit max-capacity fallback for portability.

### GPU Tree Build

4 dispatches (computeBounds, initRoot, insertParticles, computeAggregates). Lock-free CAS insertion. Visitor-flag bottom-up aggregation. Tree resets use `encoder.copyBufferToBuffer` (not `queue.writeBuffer`) because the tree may be built twice per substep; queue-level operations would execute before the encoder starts.

### GPU ↔ CPU Sync

- `addParticle()` must initialize ALL per-particle buffers. `axYukMod` defaults to `(1.0, 1.0, 1.0, 0.0)` not `(0, 0, 0, 0)`
- Save/load parity goes through `physics-contract.js`. When adding a new toggle or scalar parameter, update the shared contract plus the GPU backing slot mapping, then verify CPU and GPU serialize/deserialize it.
- `queue.writeBuffer()` executes at queue time (before encoder starts), NOT inline with compute passes. Use `encoder.copyBufferToBuffer` for resets between dispatches within the same command buffer
- `_phase5Ready` flag guards field dispatches until async pipeline creation completes
- Async readback methods use try/catch/finally to clear pending flags on device loss
- Merge events are 32 bytes. If their layout changes, update `MERGE_RESULT_SIZE`, `collision.wgsl`, `merge-photons.wgsl`, readback parsing, and field-excitation upload together.

### Disintegration (Hidden)

UI toggle hidden via `style="display:none"` — still activatable via presets (Roche limit preset). Two mechanisms: tidal fragmentation (parent → SPAWN_COUNT children) and Roche lobe overflow (Eggleton 1983 mass transfer). Known bugs:

- **Charge cascade**: fragments inherit parent's charge/SPAWN_COUNT, but if Coulomb self-repulsion caused the breakup, fragments still exceed the threshold and cascade into dust. Needs a cooldown, charge redistribution fix, or minimum fragment mass floor.
- **GPU readback latency**: disintegration events have 1-frame latency (same as merge events). Parent state in `DisintEvent` is snapshot from detection frame; by readback time, particle has evolved further.
- `DisintEvent` struct is 48 bytes (12 fields). GPU uses `atomicAdd` on event counter, capped at `MAX_DISINT_EVENTS` (64).
- GPU Roche transfer stores the emitted packet charge in `DisintEvent.charge` and the source's post-transfer charge in the final event slot, exposed to JS as `sourceCharge`; `GPUPhysics.patchMassCharge()` applies both mass and charge conservation on readback.

## Gotchas

### Will Cause Bugs

- `_peAccum` PE is accumulated inline during `pairForce()` — `potential.js` is a fallback only for preset-load recomputation
- `forceRadiation` cleared for all particles before substep loop
- History recording strided at HISTORY_STRIDE=64; both CPU and GPU use subtraction (preserves remainder)
- `.mode-toggles` sets `display: flex` overriding `hidden` — use `style.display`
- External field trig cached once per frame via `_cacheExternalFields()`
- Lazy field init: Higgs/Axion fields are `null` until first toggle-on
- Bounce (Hertz) is always quadtree-accelerated when BH on, O(n²) when off — do not early-return when `root < 0`
- `magMoment`/`angMomentum` cached per particle at start of `computeAllForces()` using `bodyRadiusSq` (intrinsic body radius, not horizon radius in BH mode)
- Dead particles in GPU tree use `deathMass`/`deathAngVel` from `ParticleAux` for leaf data; CPU dead-particle path remains pairwise
- Generic photon pair production is gone by design. Schwinger discharge is the only remaining lepton-creation mechanism and is tied to BH + Coulomb + Radiation.

### WGSL

- Explicit parentheses required when mixing `*` with `^` (XOR)
- Multiple entry points sharing a module need `read_write` access on shared bindings
- WebGPU disallows binding the same buffer twice in a dispatch
- Staging buffers must not be copied to while mapped from previous `mapAsync`
- JS uniform write order must exactly match WGSL struct member order
- `deathTime` sentinel: `FLT_MAX` (3.4028235e38), not `Infinity`
- Collision merge: `mass <= EPSILON` guards (not `== 0`) for race conditions
- Render: premultiplied alpha (`color.rgb * alpha`) with `srcFactor: 'one'`
- NaN barriers before writing to global memory (not after)

### Topology

- `minImage()` uses `out` parameter for zero-alloc
- RP² `wrapPosition()` uses iterative wrapping (max 2 passes) for simultaneous x+y out-of-bounds
- Periodic boundary interpolation in signal delay uses `minImage()` to wrap displacements

### Semantic

- 1PN does NOT obey Newton's 3rd law — velocity-Verlet corrected
- `compute1PN()` zeroes `force1PN` before accumulating
- Self-absorption permanently blocked by `emitterId` for both photons and pions
- Photon/pion absorption adds full lab-frame four-momentum: target invariant mass/internal energy changes along with proper velocity; charged pions also transfer charge
- Leptons on GPU share pion buffer — distinguished by `Pion.kind` field (0=pion, 1=lepton)
- GPU pion decay probability scaled by `1-(1-p)^N` to match CPU's per-tick rate
- World coordinates: `sim.domainW/H` (viewport / WORLD_SCALE), not pixels
- `_PALETTE`/`_FONT` frozen by colors.js
