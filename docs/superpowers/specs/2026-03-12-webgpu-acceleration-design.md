# WebGPU Acceleration Design Spec

**Date**: 2026-03-12
**Status**: Approved
**Scope**: Full GPU acceleration of physics + rendering for physsim, with CPU fallback

## Overview

Refactor the N-body physics simulation to run entirely on the GPU via WebGPU compute shaders, with WebGPU instanced rendering replacing Canvas 2D. The existing JS physics engine is preserved as a CPU fallback for browsers without WebGPU support (~20-25% of users). The UI layer (HTML/CSS sidebar, toolbar, overlays) is shared between both backends.

### Goals

- **Performance**: 50-200x physics speedup, enabling 1K-100K particles at 60 FPS
- **Rendering**: GPU-native instanced draws, zero CPU-GPU transfer for rendering
- **Compatibility**: Automatic fallback to existing CPU path when WebGPU unavailable
- **Correctness**: Bit-level physics parity not required, but energy conservation and qualitative behavior must match CPU path
- **Incremental migration**: Each phase independently testable against CPU backend

### Non-Goals

- WebGL2 GPGPU fallback (too hostile a programming model for diminishing returns)
- Web Worker offloading of CPU path (orthogonal optimization)
- 3D rendering or Three.js dependency

## 1. Data Model — SoA Particle State on GPU

All particle state stored as Structure-of-Arrays in `GPUBuffer` instances with `STORAGE | COPY_SRC` usage. Fixed-capacity pool with `MAX_PARTICLES = 4096` (tunable, power of 2).

### Core State Buffers (read/write every substep)

| Buffer | Type | Description |
|--------|------|-------------|
| `posX`, `posY` | f32[] | Position |
| `velWX`, `velWY` | f32[] | Proper velocity (celerity) |
| `angW` | f32[] | Angular proper velocity |
| `mass` | f32[] | Current mass (Higgs-modulated) |
| `baseMass` | f32[] | Intrinsic mass (Higgs coupling) |
| `charge` | f32[] | Charge |

### Derived/Cached Buffers (written once per substep)

| Buffer | Type | Description |
|--------|------|-------------|
| `radius` | f32[] | cbrt(mass) or Kerr-Newman r+ |
| `gamma` | f32[] | Lorentz factor |
| `magMoment` | f32[] | 0.2 * q * angVel * r² |
| `angMomentum` | f32[] | 0.4 * m * r² * angVel |
| `axMod`, `yukMod` | f32[] | Field modulation factors |

### Force Accumulators (packed vec4)

| Buffer | Type | Contents |
|--------|------|----------|
| `forces0` | vec4\<f32\>[] | gravity.xy, coulomb.xy |
| `forces1` | vec4\<f32\>[] | magnetic.xy, gravitomag.xy |
| `forces2` | vec4\<f32\>[] | f1pn.xy, spinCurv.xy |
| `forces3` | vec4\<f32\>[] | radiation.xy, yukawa.xy |
| `forces4` | vec4\<f32\>[] | external.xy, higgs.xy |
| `forces5` | vec4\<f32\>[] | axion.xy, (pad), (pad) |
| `torques` | vec4\<f32\>[] | spinOrbit, frameDrag, tidal, (pad) |
| `bFields` | vec4\<f32\>[] | Bz, Bgz, extBz, (pad) |

### Particle Metadata

| Buffer | Type | Description |
|--------|------|-------------|
| `flags` | u32[] | Bitfield: alive, retired, antimatter, BH mode, ghost |
| `color` | u32[] | Packed RGBA for rendering |
| `creationTime` | f32[] | Signal delay causality |
| `particleId` | u32[] | Unique ID (emitter tracking) |

### Pool Management

- `aliveCount`: atomic\<u32\> — current live particle count
- `freeStack`: u32[MAX_PARTICLES] — indices of free slots
- `freeTop`: atomic\<u32\> — stack pointer
- **Spawn**: atomic pop from freeStack, write initial state, set alive flag
- **Remove**: clear alive flag, atomic push to freeStack
- **Compaction**: periodic via parallel prefix sum when fragmentation > 50%

### Signal Delay History (lazy allocation, only when relativity enabled)

```
histPosX, histPosY: f32[MAX_PARTICLES × HISTORY_LEN]
histVelWX, histVelWY: f32[MAX_PARTICLES × HISTORY_LEN]
histAngW: f32[MAX_PARTICLES × HISTORY_LEN]
histTime: f32[MAX_PARTICLES × HISTORY_LEN]
histWriteIdx: u32[MAX_PARTICLES]
```

HISTORY_LEN = 256. Total memory: ~24 MB for 4096 particles. Allocated on first relativity toggle.

**Precision note**: The CPU path uses Float64 for history. On GPU, f32 has ~7 decimal digits. For `histTime`, this means simTime values above ~1000 lose sub-step resolution, degrading Newton-Raphson convergence. Mitigation: store **relative time** (`simTime - recordTime` as f32) rather than absolute simTime, giving full precision for recent history entries. The NR tolerance on GPU should be relaxed to ~1e-5 (vs CPU's 1e-12). This is an accepted precision trade-off — qualitative behavior matches, exact trajectories may diverge at long simulation times.

### Dead Particles (Signal Delay Fade-Out)

Particles removed during simulation (merge, annihilation, despawn) transition to RETIRED state (not FREE). Retired particles:
- Keep their history buffers intact
- Continue exerting forces via signal delay (pairwise only, excluded from BH tree)
- Have `_deathMass`, `_deathAngVel` frozen at removal time (stored in their SoA slots)
- Are garbage-collected when `simTime - deathTime > 2 * domainDiagonal`
- Only then transition to FREE and their slot is pushed onto `freeStack`

The `flags` bitfield encodes three states: ALIVE (bit 0), RETIRED (bit 1), with neither = FREE. The force computation iterates alive particles via tree walk AND retired particles via brute-force pairwise (matching CPU behavior).

### Uniforms Buffer

Single `GPUBuffer` with all simulation parameters, uploaded from JS each frame:

```wgsl
struct SimUniforms {
    dt: f32,
    simTime: f32,
    domainW: f32, domainH: f32,
    speedScale: f32,
    softening: f32, softeningSq: f32,
    // Toggle bitfield (2 × u32 = 64 bits, future-proof)
    toggles0: u32,  // bits 0-15: gravity, coulomb, magnetic, gravitomag, 1pn, relativity,
                    //   spinOrbit, radiation, blackHole, disintegration, expansion,
                    //   yukawa, higgs, axion, barnesHut, bosonGrav
    toggles1: u32,  // bits 0-3: fieldGrav, hertzBounce, (reserved)
    yukawaCoupling: f32, yukawaMu: f32,
    higgsMass: f32, axionMass: f32,
    extGravX: f32, extGravY: f32,
    extElecX: f32, extElecY: f32,
    extBz: f32,
    boundaryMode: u32,
    topologyMode: u32,
    collisionMode: u32,
    fieldResolution: u32,  // 64, 128, 256 (configurable)
    // ...
};
```

Toggle checks in WGSL via bitwise operations: `let gravityOn = (uniforms.toggles0 & GRAVITY_BIT) != 0u;`

### baseMass Synchronization

`baseMass` must stay in sync with `mass` across all modification sites:
- **Higgs toggle-off**: mass restored to baseMass (field forces pass)
- **Merge**: winner's baseMass += loser's baseMass (collision resolve pass)
- **Hawking evaporation**: baseMass scaled proportionally (radiation pass)
- **Higgs modulation**: mass = baseMass * max(|phi|, 0.05), rate-clamped ±4*dt (field forces pass)

### Known Precision Differences from CPU

- **Adaptive substepping**: `maxAcceleration` read from previous frame (1-frame latency). In high-acceleration scenarios, first frame may use stale dtSafe. Acceptable at 60 FPS.
- **Signal delay**: f32 history with relative-time encoding vs CPU's Float64 absolute time. NR tolerance relaxed to ~1e-5.
- **Force computation**: f32 vs f64 throughout. May affect energy conservation at ~1e-6 level. Qualitative behavior preserved.

## 2. Compute Pipeline Architecture

JS orchestrator encodes a single `GPUCommandBuffer` per frame containing all substep work. GPU executes sequentially (implicit barriers between compute passes). Single `device.queue.submit()` per frame.

### Per-Substep Pipeline

```
Pass  1:  resetForces           — zero force/torque/bField accumulators
Pass  2:  cacheParticleDerived  — radius, gamma, magMoment, angMomentum, axMod, yukMod
Pass  3:  generateGhosts        — (if periodic) create ghost particles at domain edges
Pass  4:  buildQuadtree         — bounds reduction, iterative insertion, aggregate (3 dispatches)
Pass  5:  computeForces         — O(N²) tiled or BH tree walk + dead-particle pairwise
Pass  6:  borisHalfKick         — w += F_electric/m * dt/2
Pass  7:  borisRotation         — rotate w in Bz + Bgz + extBz plane
Pass  8:  borisHalfKick2        — second half-kick
Pass  9:  spinOrbitKick         — Stern-Gerlach + Mathisson-Papapetrou forces into w
Pass 10:  applyTorques          — update angW from torques (tidal, frame-drag, contact)
Pass 11:  radiationReaction     — Landau-Lifshitz (Larmor), Hawking, pion emission
Pass 12:  borisDrift            — vel = w/sqrt(1+w²), pos += vel*dt
Pass 13:  cosmologicalExpansion — (if enabled) pos += H*(pos-center)*dt, w *= (1-H*dt)
Pass 14:  compute1PN_VV         — (if 1PN) rebuild tree, recompute 1PN, VV correction kick
Pass 15:  scalarFieldEvolve     — (per field) deposit, Laplacian, KDK, gradients
Pass 16:  scalarFieldForces     — PQS interpolation, gradient forces, Higgs mass modulation
Pass 17:  collisionDetect       — tree broadphase, write pairs to append buffer
Pass 18:  collisionResolve      — process pairs, merge mass/momentum, retire removed particles
Pass 19:  fieldExcitations      — deposit merge KE as Gaussian wave packets into fields
Pass 20:  disintegrationCheck   — (if enabled) tidal stress vs self-gravity, spawn fragments
Pass 21:  bosonUpdate           — photon/pion drift, BH lensing, absorption, pion decay
Pass 22:  pairProduction        — energetic photons near massive bodies → particle pairs
Pass 23:  recordHistory         — (if relativity) append to ring buffers
Pass 24:  boundaryWrap          — wrap/bounce/despawn per topology
Pass 25:  deadParticleGC        — retire expired dead particles (simTime - deathTime > 2*diag)
```

Post-substep: trail append, color update, boson tree build (if boson gravity on).

**Boson gravity** (when enabled): requires separate boson tree build + traversal. A `buildBosonTree` dispatch constructs a second tree from photon/pion SoA pools. `computeBosonGravity` walks the boson tree for each particle. `applyBosonBosonGravity` handles mutual boson-boson gravity with GR deflection factors (2 for photons, 1+v² for pions).

### Adaptive Substepping

Computed on CPU using `maxAcceleration` read back from previous frame (4-byte staging buffer, 1-frame latency, zero stall). Same `dtSafe = min(sqrt(softening/a_max), (2pi/omega_c)/8)` formula, capped at MAX_SUBSTEPS = 32.

### Boson Handling

Photons and pions in separate SoA pools (MAX_PHOTONS = 512, MAX_PIONS = 256). Updated in dedicated compute passes after particle physics. Pion decay writes to photon pool via atomic append.

### Readback Strategy

- **Per-frame**: 64-byte statsBuffer (KE, PE, momentum, particle count, maxAcceleration). Double-buffered staging, zero stall.
- **On-demand**: selected particle state (~256 bytes), triggered by selection.
- **On-demand**: full state for save/load, user-triggered.
- **Hit testing**: GPU compute dispatch queries quadtree with click position, writes hit index to 4-byte buffer.

## 3. GPU Quadtree — GraphWaGu-Style Pointerless

Chosen for simplicity and proven WebGPU implementation. Closely matches CPU quadtree pattern. Karras radix tree reserved for future Phase 2 optimization if N > 10K.

### Node Structure

```wgsl
struct QTNode {
    minX: f32, minY: f32, maxX: f32, maxY: f32,  // bounding box
    comX: f32, comY: f32,                          // center of mass
    totalMass: f32, totalCharge: f32,
    totalMagMoment: f32, totalAngMomentum: f32,
    totalMomentumX: f32, totalMomentumY: f32,
    nw: i32, ne: i32, sw: i32, se: i32,           // child indices (-1 = empty)
    particleIndex: i32,                             // -1 if internal
    particleCount: u32,
};
```

Buffer: `QTNode[6 * MAX_PARTICLES]`. Counter: `atomic<u32>` for next free slot.

### Build Pipeline (3 dispatches)

1. **computeBounds**: parallel min/max reduction over alive particles (dead/free slots filtered via alive flag) → root node bounds. Workgroup-local reduction, then atomicMin/atomicMax to global.
2. **insertParticles**: one thread per particle, walk from root to appropriate leaf. Race resolution protocol:
   - Each node has a lock bit (MSB of `particleIndex`). Thread acquires lock via `atomicCompareExchangeWeak`.
   - If empty child: CAS to claim slot, write leaf node, release lock.
   - If occupied leaf: lock owner subdivides (creates 4 children, reinserts displaced particle), then inserts own particle. Loser spins (bounded retry, max 64 iterations) then retries from current node.
   - Depth guard: max 48 levels. If exceeded, particle is added to an overflow list (processed by a follow-up serial fixup dispatch — rare, only for degenerate particle distributions).
   - **Alternative for future**: sort particles by Morton code first, then build top-down by finding split points (avoids all insertion races, Karras-style). Deferred to Phase 2 optimization.
3. **computeAggregates**: bottom-up via atomic visitor flags. Each leaf thread walks to root via parent index (stored during insertion). First visitor to an internal node sets a flag and exits; second visitor computes aggregate (mass, CoM, charge, magMoment, angMomentum, momentumXY) from its children.

### Ghost Generation (periodic boundaries)

A `generateGhosts` compute dispatch runs before tree build for periodic boundaries. One thread per alive particle checks proximity to each domain edge (within `softening` distance). Ghost entries appended to particle SoA after alive particles (using `atomicAdd` on a ghost counter). Ghost flags encode:
- Torus: position wrapped, velocity unchanged
- Klein: y-wrap mirrors x-position and negates vx
- RP²: x-wrap mirrors y + negates vy, y-wrap mirrors x + negates vx

Ghosts are inserted into tree but skip force self-accumulation (GHOST bit in flags). Ghost slots are recycled each substep (counter reset to 0).

### Traversal

Stack-based iterative walk (private stack array, max depth 48). Used for:
- **Force computation**: θ = 0.5 opening angle criterion
- **Collision broadphase**: overlap test (distance < radius_i + radius_j)
- **Hit testing**: single-path point query from root to leaf

### Topology

Ghost particles generated at domain edges before tree build for periodic boundaries. Ghosts carry the GHOST flag bit — inserted into tree for force computation but skip self-accumulation.

## 4. Scalar Field Compute Shaders

64×64 grid operations mapped to 8×8 workgroup tiles. Grid resolution configurable (default 128×128 on GPU, 64×64 on CPU). Both scalar field resolution and energy density grid resolution independently configurable as power-of-2 values.

### Per-Field Buffers

```
field, fieldDot, laplacian, source, gradX, gradY, energyDensity: f32[GRID_RES²]
```

Self-gravity (when Field Gravity enabled):
```
coarseRho, coarsePhi: f32[COARSE_RES²]  // default 8×8 or 16×16
selfGravPhi, sgGradX, sgGradY: f32[GRID_RES²]
```

### Dispatch Sequence (per field, per substep)

1. **clearAndDeposit**: clear source grid; particle-centric PQS deposition via two-pass approach: (a) each particle scatters its 4×4 PQS stencil contributions to a per-particle scratch buffer (`f32[MAX_PARTICLES × 16]`), (b) a grid-centric gather pass sums contributions per cell. This avoids atomic float issues entirely — no atomic operations needed. Alternative for higher particle counts: atomic fixed-point i32 with Q8.24 encoding (range ±128, precision 6e-8), sufficient for source values given mass ~0.01-100 and coupling ~0.05-14
2. **computeLaplacian**: 5-point stencil, interior fast-path for bulk cells, boundary-aware edges
3. **KDK half-kick + drift**: fieldDot += ddot * dt/2; field += fieldDot * dt; clamp
4. **recomputeLaplacian**: same shader as step 2 (barrier needed, separate dispatch)
5. **KDK second half-kick**: fieldDot += ddot * dt/2
6. **computeGridGradients**: central differences → gradX, gradY
7. **applyFieldForces**: particle-centric PQS interpolation of gradients, apply forces + Higgs mass modulation

Self-gravity adds 5 more dispatches: computeEnergyDensity, downsampleRho, computeCoarsePotential, upsamplePhi, computeSelfGravGradients.

### Field Excitations

Post-collision dispatch deposits Gaussian wave packets into fieldDot via the same two-pass scatter/gather approach as PQS deposition. Amplitude `0.5 * sqrt(keLost)`, σ = 2 cells. Split between Higgs/Axion by coupling-weighted ratio.

### Thermal Phase Transitions (Higgs)

A `computeLocalKE` dispatch deposits particle KE onto grid via PQS atomics. KDK dispatch reads as per-cell modifier: `μ²_eff = μ² - KE_local`.

## 5. WebGPU Render Pipeline

Single render pass per frame after all compute substeps. Particle state read directly from compute storage buffers — zero CPU-GPU transfer.

### Canvas Setup

```js
const context = canvas.getContext('webgpu');
context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'premultiplied' });
```

UI overlays (sidebar, toolbar, intro) remain HTML/CSS floating over the canvas.

### Draw Calls (in order)

1. **Field / heatmap overlay**: fullscreen triangle, fragment shader samples field buffer or heatmap buffer, bilinear upscale, color-maps values. Heatmap computed via a `heatmap.wgsl` compute pass (gravity/Coulomb/Yukawa potential on configurable grid, tree-accelerated when BH on). Depth write off, alpha blending.
2. **Trails**: instanced line strips from trail ring buffer. Vertex shader fades alpha by age, handles topology wrap-break.
3. **Particles**: instanced point sprites. Vertex shader reads pos/radius/color from SoA buffers, applies camera matrix. Fragment shader draws circle with soft falloff (replaces shadowBlur glow). Dark mode: additive blend (`src-alpha, one`). Light mode: standard alpha blend.
4. **Force arrows**: instanced triangles (shaft + head), 1 draw per force color. Vertex shader reads force vectors from accumulator buffers.
5. **Spin rings**: instanced arcs, 2 draws (positive/negative). Vertex shader reads angW.
6. **Photons/Pions**: instanced point sprites from boson SoA pools. Alpha fade by age.
7. **Ergospheres**: instanced circle outlines (BH mode only).
8. **Selected highlight / antimatter markers**: extra instances with outline shader.

### Camera

2D affine transform as `mat4x4<f32>` uniform (2D affine embedded in 4×4 for predictable 64-byte alignment — WGSL `mat3x3` has 48-byte stride due to vec4 column padding). Updated from JS on zoom/pan (shared-camera.js handlers unchanged).

```wgsl
struct CameraUniforms {
    viewMatrix: mat4x4<f32>,      // 2D affine in top-left 3×3, w=1
    invViewMatrix: mat4x4<f32>,   // for input hit-testing (clip → world)
    zoom: f32,
    canvasWidth: f32,
    canvasHeight: f32,
    _pad: f32,
};
```

### Theme Switching

Two pre-built render pipelines (additive blend for dark, alpha blend for light). Swapped on theme change — no pipeline recreation.

### What Stays on Canvas 2D Overlay

- V_eff plot (200-sample sidebar canvas)
- Phase plot (sidebar canvas)
- Stats text (HTML textContent)
- Info tips, toasts, overlays (HTML/CSS)

These read from the per-frame readback stats buffer.

### Dirty Flag

GPU path respects `sim._dirty`. When paused with no interaction, skip both compute and render passes.

## 6. CPU-GPU Bridge & Fallback

### Feature Detection

```js
async function selectBackend() {
    if (!navigator.gpu) return 'cpu';
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return 'cpu';
    const device = await adapter.requestDevice({ requiredLimits: { ... } });
    if (!device) return 'cpu';
    return 'gpu';
}
```

### Shared Interface Contract

Both `GPUPhysics` and `CPUPhysics` implement:

```
update(dt)                     — advance simulation
getParticleCount()             — alive count
getParticleState(index)        — single particle data for UI
getStats()                     — KE, PE, momentum, drift
addParticle(props)             — spawn
removeParticle(index)          — delete
getSelectedForceBreakdown(i)   — 11 force vectors for detail panel
getFieldData(fieldType)        — field overlay data
setUniforms(params)            — toggles, sliders
serialize() / deserialize()    — save/load (same JSON format, cross-backend compatible)
reset()                        — clear all
loadPreset(name)               — preset loading
```

### Rendering Fork

```js
if (backend === 'gpu') {
    renderer = new GPURenderer(canvas, device, gpuPhysics);
} else {
    renderer = new CanvasRenderer(canvas);
}
```

### Input Handling

Hit testing via GPU quadtree point query (single-path walk, one dispatch, writes hit index). One-frame latency, imperceptible.

### Error Recovery

```js
device.lost.then((info) => {
    physics = new CPUPhysics(/* restore from last auto-save */);
    renderer = new CanvasRenderer(canvas);
    showToast('GPU lost — switched to CPU mode');
});
```

## 7. File Structure

```
physsim/
  main.js                     # Entry: backend detection, loop, orchestration
  index.html                  # Unchanged
  styles.css                  # Unchanged
  colors.js                   # Unchanged
  src/
    # Shared (both backends)
    config.js                 # Constants, enums, helpers
    presets.js                # Preset definitions
    reference.js              # Reference overlay content
    ui.js                     # UI setup, dependency graph
    input.js                  # Mouse/touch (delegates hit-test to backend)
    save-load.js              # Serialize/deserialize adapter
    topology.js               # minImage/wrapPosition (CPU path + shared constants)
    vec2.js                   # Vec2 class (CPU path)
    effective-potential.js    # V_eff sidebar canvas (shared, reads from readback)
    phase-plot.js             # Phase space sidebar canvas (shared, reads from readback)
    stats-display.js          # Stats tab readout (shared, reads from readback)

    # CPU Backend (existing code, moved + renamed)
    cpu/
      cpu-physics.js          # CPUPhysics wrapper
      cpu-renderer.js         # Canvas 2D renderer
      cpu-integrator.js       # Physics loop
      cpu-forces.js           # Force computation
      cpu-quadtree.js         # SoA quadtree
      cpu-particle.js         # Particle class
      cpu-collisions.js
      cpu-scalar-field.js
      cpu-higgs-field.js
      cpu-axion-field.js
      cpu-signal-delay.js
      cpu-energy.js
      cpu-potential.js
      cpu-heatmap.js
      cpu-massless-boson.js
      cpu-pion.js
      cpu-boson-utils.js
      cpu-relativity.js

    # GPU Backend (new)
    gpu/
      gpu-physics.js          # Buffer creation, pipeline setup, command encoding
      gpu-renderer.js         # WebGPU render pipeline, instanced draws
      gpu-buffers.js          # SoA allocation, pool management, staging
      gpu-pipelines.js        # Compute + render pipeline creation
      gpu-readback.js         # Double-buffered stats, on-demand queries, hit test
      shaders/
        common.wgsl           # Shared structs, utility functions
        reset-forces.wgsl
        cache-derived.wgsl
        tree-build.wgsl
        forces-pairwise.wgsl  # O(N²) tiled
        forces-tree.wgsl      # BH tree walk
        pair-force.wgsl       # Shared pairforce logic
        boris.wgsl
        onePN.wgsl
        field-deposit.wgsl
        field-evolve.wgsl
        field-forces.wgsl
        field-selfgrav.wgsl
        field-excitation.wgsl
        collision.wgsl
        bosons.wgsl
        boson-tree.wgsl       # Boson gravity: separate tree build + traversal
        history.wgsl
        boundary.wgsl
        expansion.wgsl        # Cosmological expansion
        disintegration.wgsl   # Tidal disintegration + Roche
        pair-production.wgsl  # Photon → particle pair creation
        ghost-gen.wgsl        # Ghost particle generation for periodic boundaries
        spin-torques.wgsl     # Spin-orbit kick + torque application
        radiation.wgsl        # Larmor, Hawking, pion emission
        dead-gc.wgsl          # Dead particle garbage collection
        hit-test.wgsl
        update-colors.wgsl
        trails.wgsl
        heatmap.wgsl          # Potential field heatmap compute
        particle.wgsl         # Render: particle sprites
        trail-render.wgsl     # Render: trail lines
        boson-render.wgsl     # Render: photon/pion sprites
        field-render.wgsl     # Render: scalar field overlay
        heatmap-render.wgsl   # Render: potential heatmap overlay
        arrow-render.wgsl     # Render: force arrows
        spin-render.wgsl      # Render: spin arcs
```

## 8. Migration Phases

1. **Phase 0**: Move CPU files to `src/cpu/` with `cpu-` prefix, create `CPUPhysics`/`CanvasRenderer` wrappers, move shared files (effective-potential, phase-plot, stats-display) up. Verify nothing breaks.
2. **Phase 1**: Scaffold `gpu/`, implement SoA buffer setup + simplest compute (reset, cache derived, drift, boundary wrap) + instanced particle rendering. Particles visible, move in straight lines, bounce/wrap.
3. **Phase 2**: Port pairwise force computation (all 11 types) + full Boris integrator (half-kick, rotation, drift) + spin-orbit kick + torque application. Physics correct for gravity + Coulomb + magnetic + GM with spin dynamics.
4. **Phase 3**: Port quadtree build (GraphWaGu-style) + BH tree walk + ghost generation + tree-based collision detection/resolution + dead particle retirement. Full N-body with tree acceleration.
5. **Phase 4**: Port 1PN velocity-Verlet + radiation reaction (Larmor, Hawking) + Yukawa + pion emission/decay/absorption + signal delay history + boson gravity. Advanced physics parity.
6. **Phase 5**: Port scalar fields (Higgs, Axion) with configurable resolution + field excitations + thermal phase transitions + self-gravity + disintegration/Roche + cosmological expansion + pair production + heatmap. Full feature parity.
7. **Phase 6**: Polish — presets, save/load cross-backend, error recovery, configurable grid resolution UI, performance tuning, GPU indicator badge.

Each phase independently testable: run both backends side-by-side, compare energy/momentum stats output. Phases 2-5 each enable specific presets for validation.

## References

- Karras (2012), "Maximizing Parallelism in the Construction of BVHs, Octrees, and k-d Trees" — GPU radix tree construction (future Phase 2 tree optimization)
- Dyken et al. (2022), "GraphWaGu: GPU Powered Large Scale Graph Layout Computation and Rendering for the Web" — WebGPU Barnes-Hut with pointerless quadtree, buffer-based stack traversal
- WebGPU Fundamentals, "Compute Shader Basics" — workgroup sizing, dispatch patterns, race conditions
- WebGPU Galaxy tutorial — compute shader particle systems, storage buffers, instanced rendering
