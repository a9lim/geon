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
| `forces5` | vec2\<f32\>[] | axion.xy |
| `torques` | vec4\<f32\>[] | spinOrbit, frameDrag, tidal, (pad) |
| `bFields` | vec4\<f32\>[] | Bz, Bgz, extBz, (pad) |

### Particle Metadata

| Buffer | Type | Description |
|--------|------|-------------|
| `flags` | u32[] | Bitfield: alive, antimatter, BH mode, ghost |
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

### Uniforms Buffer

Single `GPUBuffer` with all simulation parameters, uploaded from JS each frame:

```wgsl
struct SimUniforms {
    dt: f32,
    simTime: f32,
    domainW: f32, domainH: f32,
    speedScale: f32,
    softening: f32, softeningSq: f32,
    toggles: u32,  // bitfield: gravity, coulomb, magnetic, gm, 1pn, relativity, ...
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

Toggle checks in WGSL via bitwise operations: `let gravityOn = (uniforms.toggles & GRAVITY_BIT) != 0u;`

## 2. Compute Pipeline Architecture

JS orchestrator encodes a single `GPUCommandBuffer` per frame containing all substep work. GPU executes sequentially (implicit barriers between compute passes). Single `device.queue.submit()` per frame.

### Per-Substep Pipeline

```
Pass  1: resetForces           — zero force/torque/bField accumulators
Pass  2: cacheParticleDerived  — radius, gamma, magMoment, angMomentum, axMod, yukMod
Pass  3: buildQuadtree         — bounds reduction, iterative insertion, aggregate (3 dispatches)
Pass  4: computeForces         — O(N²) tiled or BH tree walk (reads tree from Pass 3)
Pass  5: borisHalfKick         — w += F_electric/m * dt/2
Pass  6: borisRotation         — rotate w in Bz + Bgz + extBz plane
Pass  7: borisHalfKick2        — second half-kick
Pass  8: borisDrift            — vel = w/sqrt(1+w²), pos += vel*dt
Pass  9: compute1PN_VV         — (if 1PN) rebuild tree, recompute 1PN, VV correction kick
Pass 10: scalarFieldEvolve     — (per field) deposit, Laplacian, KDK, gradients
Pass 11: scalarFieldForces     — PQS interpolation, gradient forces, Higgs mass modulation
Pass 12: collisionDetect       — tree broadphase, write pairs to append buffer
Pass 13: collisionResolve      — process pairs with atomic CAS on alive flags
Pass 14: recordHistory         — (if relativity) append to ring buffers
Pass 15: boundaryWrap          — wrap/bounce/despawn per topology
```

Post-substep: boson updates (drift, decay, absorption, lensing), trail append, color update.

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

1. **computeBounds**: parallel min/max reduction → root node bounds
2. **insertParticles**: one thread per particle, walk from root, atomic CAS to claim/subdivide
3. **computeAggregates**: bottom-up via atomic visitor flags, accumulate mass/CoM/charge/moments

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

1. **clearAndDeposit**: clear source grid; particle-centric PQS deposition via atomic fixed-point i32 (WGSL lacks atomic f32)
2. **computeLaplacian**: 5-point stencil, interior fast-path for bulk cells, boundary-aware edges
3. **KDK half-kick + drift**: fieldDot += ddot * dt/2; field += fieldDot * dt; clamp
4. **recomputeLaplacian**: same shader as step 2 (barrier needed, separate dispatch)
5. **KDK second half-kick**: fieldDot += ddot * dt/2
6. **computeGridGradients**: central differences → gradX, gradY
7. **applyFieldForces**: particle-centric PQS interpolation of gradients, apply forces + Higgs mass modulation

Self-gravity adds 5 more dispatches: computeEnergyDensity, downsampleRho, computeCoarsePotential, upsamplePhi, computeSelfGravGradients.

### Field Excitations

Post-collision dispatch deposits Gaussian wave packets into fieldDot via atomic fixed-point. Amplitude `0.5 * sqrt(keLost)`, σ = 2 cells. Split between Higgs/Axion by coupling-weighted ratio.

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

1. **Field overlay**: fullscreen triangle, fragment shader samples field buffer, bilinear upscale, color-maps values. Depth write off, alpha blending.
2. **Trails**: instanced line strips from trail ring buffer. Vertex shader fades alpha by age, handles topology wrap-break.
3. **Particles**: instanced point sprites. Vertex shader reads pos/radius/color from SoA buffers, applies camera matrix. Fragment shader draws circle with soft falloff (replaces shadowBlur glow). Dark mode: additive blend (`src-alpha, one`). Light mode: standard alpha blend.
4. **Force arrows**: instanced triangles (shaft + head), 1 draw per force color. Vertex shader reads force vectors from accumulator buffers.
5. **Spin rings**: instanced arcs, 2 draws (positive/negative). Vertex shader reads angW.
6. **Photons/Pions**: instanced point sprites from boson SoA pools. Alpha fade by age.
7. **Ergospheres**: instanced circle outlines (BH mode only).
8. **Selected highlight / antimatter markers**: extra instances with outline shader.

### Camera

2D affine transform as `mat3x3<f32>` uniform. Updated from JS on zoom/pan (shared-camera.js handlers unchanged).

```wgsl
struct CameraUniforms {
    viewMatrix: mat3x3<f32>,
    invViewMatrix: mat3x3<f32>,
    zoom: f32,
    canvasWidth: f32,
    canvasHeight: f32,
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
    topology.js               # minImage/wrapPosition (CPU path)
    vec2.js                   # Vec2 class (CPU path)

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
      cpu-effective-potential.js
      cpu-phase-plot.js
      cpu-stats-display.js

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
        history.wgsl
        boundary.wgsl
        hit-test.wgsl
        update-colors.wgsl
        trails.wgsl
        particle.wgsl         # Render: particle sprites
        trail-render.wgsl     # Render: trail lines
        boson-render.wgsl     # Render: photon/pion sprites
        field-render.wgsl     # Render: field overlay
        arrow-render.wgsl     # Render: force arrows
        spin-render.wgsl      # Render: spin arcs
```

## 8. Migration Phases

1. **Phase 0**: Move CPU files to `src/cpu/` with `cpu-` prefix, create `CPUPhysics` wrapper, verify nothing breaks
2. **Phase 1**: Scaffold `gpu/`, implement buffer setup + simplest compute (reset, drift, boundary) + instanced particle rendering. Particles visible but non-interacting.
3. **Phase 2**: Port pairwise force computation + Boris integrator. Physics becomes correct for basic gravity + Coulomb.
4. **Phase 3**: Port quadtree build + BH tree walk + collision detection/resolution. Full N-body with tree acceleration.
5. **Phase 4**: Port 1PN, radiation, Yukawa, pions, signal delay. Advanced physics parity.
6. **Phase 5**: Port scalar fields (Higgs, Axion) with configurable resolution. Field-particle coupling.
7. **Phase 6**: Polish — presets, save/load, error recovery, configurable grid resolution UI, performance tuning.

Each phase independently testable: run both backends, compare stats output.

## References

- Karras (2012), "Maximizing Parallelism in the Construction of BVHs, Octrees, and k-d Trees" — GPU radix tree construction (future Phase 2 tree optimization)
- Dyken et al. (2022), "GraphWaGu: GPU Powered Large Scale Graph Layout Computation and Rendering for the Web" — WebGPU Barnes-Hut with pointerless quadtree, buffer-based stack traversal
- WebGPU Fundamentals, "Compute Shader Basics" — workgroup sizing, dispatch patterns, race conditions
- WebGPU Galaxy tutorial — compute shader particle systems, storage buffers, instanced rendering
