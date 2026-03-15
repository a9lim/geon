# GPU Quadrupole Radiation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port EM and GW quadrupole radiation from CPU (`integrator.js` lines 1175–1355) to GPU compute shaders, closing the last radiation parity gap.

**Architecture:** Three-dispatch pipeline per frame (after substeps): (1) workgroup-reduce center-of-mass + total KE, (2) compute per-particle d³I/d³Q contributions using CoM + workgroup-reduce global sums + update residual force history (after jerk is computed), (3) finalize power, apply tangential drag, accumulate per-particle energy, emit photons/gravitons. Uses workgroup shared-memory reduction with per-workgroup partial sums written to a small reduction buffer — no CPU readback needed. The JS dispatcher re-writes uniforms with full-frame `PHYSICS_DT` before quadrupole dispatch (not substep dt).

**Tech Stack:** WGSL compute shaders, WebGPU storage buffers, existing `gpu-physics.js`/`gpu-pipelines.js`/`gpu-buffers.js` infrastructure.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/gpu/shaders/common.wgsl:106-111` | Extend `RadiationState` struct (32B → 64B) |
| Modify | `src/gpu/shaders/radiation.wgsl:67-72` | Update standalone `RadiationState` copy |
| Modify | `src/gpu/shaders/forces-tree.wgsl:138-143` | Update standalone `RadiationState` copy |
| Create | `src/gpu/shaders/quadrupole.wgsl` | 3-entry-point compute shader |
| Modify | `src/gpu/gpu-buffers.js:29,37-84,261-302` | `RADIATION_STATE_SIZE` 32→64, add `quadReductionBuf`, update exports |
| Modify | `src/gpu/gpu-constants.js:10-28,117-214` | Import + emit `QUADRUPOLE_POWER_CLAMP`, `MAX_QUAD_WORKGROUPS` |
| Modify | `src/gpu/gpu-pipelines.js:368-633` | Add 3 quadrupole pipelines to `createPhase4Pipelines()` |
| Modify | `src/gpu/gpu-physics.js` | Extend `_addParticleRadData`, add `_dispatchQuadrupole()`, bind groups, wire into post-substep |

---

## Chunk 1: Data Layer (RadiationState + Buffers + Constants)

### Task 1: Extend RadiationState struct in all shader files

The `RadiationState` struct is defined in 3 places. All must be updated identically.

**Files:**
- Modify: `src/gpu/shaders/common.wgsl:106-111`
- Modify: `src/gpu/shaders/radiation.wgsl:67-72`
- Modify: `src/gpu/shaders/forces-tree.wgsl:138-143`

- [ ] **Step 1: Update `common.wgsl` RadiationState**

Replace lines 104-111:
```wgsl
// Radiation accumulator state per particle.
// 64 bytes = 16 × f32. Packed quadrupole history + accumulators.
struct RadiationState {
    jerkX: f32, jerkY: f32,
    radAccum: f32, hawkAccum: f32, yukawaRadAccum: f32,
    radDisplayX: f32, radDisplayY: f32,
    qResFx0: f32,           // residual force history t-2 (was _pad)
    qResFy0: f32,
    qResFx1: f32,           // residual force history t-1
    qResFy1: f32,
    qResCount: f32,          // warmup counter (0/1/2, stored as f32)
    quadAccum: f32,          // GW quadrupole energy accumulator
    emQuadAccum: f32,        // EM quadrupole energy accumulator
    d3IContrib: f32,         // scratch: per-particle GW contribution norm
    d3QContrib: f32,         // scratch: per-particle EM contribution norm
};
```

- [ ] **Step 2: Update `radiation.wgsl` standalone copy**

Replace lines 67-72 with the identical struct (same field names and order).

- [ ] **Step 3: Update `forces-tree.wgsl` standalone copy**

Replace lines 138-143 with the identical struct.

- [ ] **Step 4: Bump shader version**

In `gpu-pipelines.js` line 12, increment `SHADER_VERSION` (17 → 18) to invalidate browser cache.

---

### Task 2: Update buffer sizes and add reduction buffer

**Files:**
- Modify: `src/gpu/gpu-buffers.js:26-34,82-84,261-302`

- [ ] **Step 1: Update RADIATION_STATE_SIZE constant**

Change line 29:
```js
const RADIATION_STATE_SIZE = 64; // 16 × 4 bytes (was 32)
```

- [ ] **Step 2: Add quadrupole reduction buffer**

After the `radiationState` buffer (line 84), add:
```js
    // ── Quadrupole radiation reduction buffer ──
    // Workgroup partial sums for 2-pass reduction. Layout:
    //   [0 .. MAX_WG*4): CoM pass: {comXw, comYw, totalMass, totalKE} per workgroup
    //   [MAX_WG*4 .. MAX_WG*12): Contrib pass: {d3Ixx,d3Ixy,d3Iyy, d3Qxx,d3Qxy,d3Qyy, totalD3I,totalD3Q} per wg
    const MAX_QUAD_WG = Math.ceil(maxParticles / 64);
    const quadReductionBuf = storageBuffer('quadReduction', 4, MAX_QUAD_WG * 12); // f32 elements
```

- [ ] **Step 3: Add to return object**

Add after the `radiationState` entry in the return block (~line 273):
```js
        quadReductionBuf,
        MAX_QUAD_WG,
```

- [ ] **Step 4: Update RADIATION_STATE_SIZE export**

In the existing `export { ... }` block at the bottom, ensure `RADIATION_STATE_SIZE` is already exported (it is — the value change propagates automatically).

---

### Task 3: Update gpu-physics.js for new RadiationState size

**Files:**
- Modify: `src/gpu/gpu-physics.js:83,1233-1235,2912-2913`

- [ ] **Step 1: Resize _addParticleRadData**

Change line 83:
```js
const _addParticleRadData = new Float32Array(16);    // RADIATION_STATE_SIZE / 4
```

- [ ] **Step 2: Verify addParticle and deserialize zeroing**

Lines 1234 and 2912 already use `_addParticleRadData.fill(0)` + `RADIATION_STATE_SIZE`. Since both the array and constant were updated, these automatically write 64 bytes of zeros. No code change needed — just verify.

---

### Task 4: Add QUADRUPOLE_POWER_CLAMP to WGSL constants

**Files:**
- Modify: `src/gpu/gpu-constants.js:10-28,117-165`

- [ ] **Step 1: Add import**

Add `QUADRUPOLE_POWER_CLAMP` and `PHYSICS_DT` to the config.js import block (line 16, after `LL_FORCE_CLAMP`):
```js
    LL_FORCE_CLAMP, MIN_MASS, BH_NAKED_FLOOR, ELECTRON_MASS,
    QUADRUPOLE_POWER_CLAMP, PHYSICS_DT,
```

Note: `PHYSICS_DT` is already imported on line 15 for `BOSON_MIN_AGE_TIME` computation. If so, just add `QUADRUPOLE_POWER_CLAMP` to the existing import.

- [ ] **Step 2: Add WGSL constants**

After line 136 (`LL_FORCE_CLAMP`), add:
```js
const QUADRUPOLE_POWER_CLAMP: f32 = ${wf(QUADRUPOLE_POWER_CLAMP)};
const MAX_QUAD_WG: u32 = ${Math.ceil(GPU_MAX_PARTICLES / 64)}u;
const PHYSICS_DT: f32 = ${wf(PHYSICS_DT)};
```

---

## Chunk 2: Quadrupole Shader

### Task 5: Write quadrupole.wgsl

**Files:**
- Create: `src/gpu/shaders/quadrupole.wgsl`

This is a standalone shader (NOT prepended with common.wgsl). It defines its own structs and receives `buildWGSLConstants()` at compile time. Three entry points share the same bind group layout.

- [ ] **Step 1: Write the full shader**

Create `src/gpu/shaders/quadrupole.wgsl` with this content:

```wgsl
// ─── Quadrupole Radiation Shaders ───
// Three entry points dispatched once per frame (after all substeps):
//   quadrupoleCoM    — workgroup-reduce center of mass + totalKE
//   quadrupoleContrib — compute per-particle d³I/d³Q + update residual force history, workgroup-reduce global sums
//   quadrupoleApply  — finalize power, apply drag, accumulate energy, emit photons/gravitons
//
// Standalone shader — defines own structs (NOT prepended with common.wgsl).
// Constants provided by generated wgslConstants block.

// ── RNG ──
fn pcgHash(seed: u32) -> u32 {
    var state = seed * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}
fn pcgRand(seed: u32) -> f32 {
    return f32(pcgHash(seed)) / 4294967296.0;
}

// ── Packed struct definitions (must match common.wgsl / writeUniforms() byte layout) ──

struct ParticleState {
    posX: f32, posY: f32,
    velWX: f32, velWY: f32,
    mass: f32, charge: f32, angW: f32,
    baseMass: f32,
    flags: u32,
};

struct ParticleAux {
    radius: f32,
    particleId: u32,
    deathTime: f32,
    deathMass: f32,
    deathAngVel: f32,
};

struct ParticleDerived {
    magMoment: f32,
    angMomentum: f32,
    invMass: f32,
    radiusSq: f32,
    velX: f32,
    velY: f32,
    angVel: f32,
    _pad: f32,
};

struct AllForces {
    f0: vec4<f32>,          // gravity.xy, coulomb.xy
    f1: vec4<f32>,          // magnetic.xy, gravitomag.xy
    f2: vec4<f32>,          // f1pn.xy, spinCurv.xy
    f3: vec4<f32>,          // radiation.xy, yukawa.xy
    f4: vec4<f32>,          // external.xy, higgs.xy
    f5: vec4<f32>,          // axion.xy, pad, pad
    torques: vec4<f32>,
    bFields: vec4<f32>,
    bFieldGrads: vec4<f32>,
    totalForce: vec2<f32>,
    _pad: vec2<f32>,
};

struct RadiationState {
    jerkX: f32, jerkY: f32,
    radAccum: f32, hawkAccum: f32, yukawaRadAccum: f32,
    radDisplayX: f32, radDisplayY: f32,
    qResFx0: f32,
    qResFy0: f32,
    qResFx1: f32,
    qResFy1: f32,
    qResCount: f32,
    quadAccum: f32,
    emQuadAccum: f32,
    d3IContrib: f32,
    d3QContrib: f32,
};

struct Photon {
    posX: f32, posY: f32,
    velX: f32, velY: f32,
    energy: f32,
    emitterId: u32, lifetime: f32, flags: u32,
};

struct Uniforms {
    dt: f32,
    simTime: f32,
    domainW: f32,
    domainH: f32,
    _speedScale: f32,
    _softening: f32,
    _softeningSq: f32,
    toggles0: u32,
    _toggles1: u32,
    yukawaCoupling: f32,
    _yukawaMu: f32,
    _higgsMass: f32,
    _axionMass: f32,
    _boundaryMode: u32,
    _topologyMode: u32,
    _collisionMode: u32,
    _maxParticles: u32,
    aliveCount: u32,
    _extGravity: f32,
    _extGravityAngle: f32,
    _extElectric: f32,
    _extElectricAngle: f32,
    _extBz: f32,
    _bounceFriction: f32,
    _extGx: f32,
    _extGy: f32,
    _extEx: f32,
    _extEy: f32,
    _axionCoupling: f32,
    _higgsCoupling: f32,
    _particleCount: u32,
    _bhTheta: f32,
    frameCount: u32,
    _pad4: u32,
};

// ── Bind groups (shared by all 3 entry points) ──

@group(0) @binding(0) var<uniform> u: Uniforms;

// Group 1: particle data
@group(1) @binding(0) var<storage, read_write> particles: array<ParticleState>;
@group(1) @binding(1) var<storage, read_write> particleAux: array<ParticleAux>;
@group(1) @binding(2) var<storage, read_write> derived: array<ParticleDerived>;
@group(1) @binding(3) var<storage, read_write> allForces: array<AllForces>;
@group(1) @binding(4) var<storage, read_write> radState: array<RadiationState>;

// Group 2: photon pool
@group(2) @binding(0) var<storage, read_write> photons: array<Photon>;
@group(2) @binding(1) var<storage, read_write> phCount: atomic<u32>;

// Group 3: reduction buffer
// Layout: [0..MAX_QUAD_WG*4): CoM partials, [MAX_QUAD_WG*4..MAX_QUAD_WG*12): d³ partials
@group(3) @binding(0) var<storage, read_write> reductionBuf: array<f32>;

// ── Workgroup shared memory ──
var<workgroup> sh_comXw: array<f32, 64>;
var<workgroup> sh_comYw: array<f32, 64>;
var<workgroup> sh_mass: array<f32, 64>;
var<workgroup> sh_ke: array<f32, 64>;

// For contrib pass: 8 accumulators
var<workgroup> sh_d3Ixx: array<f32, 64>;
var<workgroup> sh_d3Ixy: array<f32, 64>;
var<workgroup> sh_d3Iyy: array<f32, 64>;
var<workgroup> sh_d3Qxx: array<f32, 64>;
var<workgroup> sh_d3Qxy: array<f32, 64>;
var<workgroup> sh_d3Qyy: array<f32, 64>;
var<workgroup> sh_totalD3I: array<f32, 64>;
var<workgroup> sh_totalD3Q: array<f32, 64>;

// ── Helper: workgroup tree reduction (power-of-2 stride) ──
// After this, lane 0 holds the sum. All arrays of same size share the barrier.
fn workgroupReduce4(lid: u32) {
    // Reduce 4 arrays in lockstep (CoM pass)
    for (var stride: u32 = 32u; stride > 0u; stride >>= 1u) {
        workgroupBarrier();
        if (lid < stride) {
            sh_comXw[lid] += sh_comXw[lid + stride];
            sh_comYw[lid] += sh_comYw[lid + stride];
            sh_mass[lid] += sh_mass[lid + stride];
            sh_ke[lid] += sh_ke[lid + stride];
        }
    }
    workgroupBarrier();
}

fn workgroupReduce8(lid: u32) {
    // Reduce 8 arrays in lockstep (contrib pass)
    for (var stride: u32 = 32u; stride > 0u; stride >>= 1u) {
        workgroupBarrier();
        if (lid < stride) {
            sh_d3Ixx[lid] += sh_d3Ixx[lid + stride];
            sh_d3Ixy[lid] += sh_d3Ixy[lid + stride];
            sh_d3Iyy[lid] += sh_d3Iyy[lid + stride];
            sh_d3Qxx[lid] += sh_d3Qxx[lid + stride];
            sh_d3Qxy[lid] += sh_d3Qxy[lid + stride];
            sh_d3Qyy[lid] += sh_d3Qyy[lid + stride];
            sh_totalD3I[lid] += sh_totalD3I[lid + stride];
            sh_totalD3Q[lid] += sh_totalD3Q[lid + stride];
        }
    }
    workgroupBarrier();
}

// ═══════════════════════════════════════════════════════════════════
// Entry Point 1: quadrupoleCoM
// Workgroup-reduce CoM + totalKE. History shift deferred to pass 2 (after jerk uses it).
// ═══════════════════════════════════════════════════════════════════
@compute @workgroup_size(64)
fn quadrupoleCoM(
    @builtin(global_invocation_id) gid: vec3u,
    @builtin(local_invocation_id) lid: vec3u,
    @builtin(workgroup_id) wgid: vec3u,
) {
    let i = gid.x;
    let localId = lid.x;
    let alive = i < u.aliveCount && (particles[i].flags & FLAG_ALIVE) != 0u;

    // Load per-particle values
    var mXw: f32 = 0.0;
    var mYw: f32 = 0.0;
    var m: f32 = 0.0;
    var ke: f32 = 0.0;

    if (alive) {
        let mass = particles[i].mass;
        mXw = particles[i].posX * mass;
        mYw = particles[i].posY * mass;
        m = mass;

        // KE = mass * wSq / (gamma + 1)
        let wx = particles[i].velWX;
        let wy = particles[i].velWY;
        let wSq = wx * wx + wy * wy;
        if (wSq > EPSILON_SQ) {
            ke = mass * wSq / (sqrt(1.0 + wSq) + 1.0);
        }
        // NOTE: residual force history shift is done in quadrupoleContrib (pass 2)
        // AFTER the backward-difference jerk computation uses the old history values.
    }

    // Store into shared memory
    sh_comXw[localId] = mXw;
    sh_comYw[localId] = mYw;
    sh_mass[localId] = m;
    sh_ke[localId] = ke;

    // Workgroup reduction
    workgroupReduce4(localId);

    // Lane 0 writes partial sums to reduction buffer
    if (localId == 0u) {
        let base = wgid.x * 4u;
        reductionBuf[base + 0u] = sh_comXw[0];
        reductionBuf[base + 1u] = sh_comYw[0];
        reductionBuf[base + 2u] = sh_mass[0];
        reductionBuf[base + 3u] = sh_ke[0];
    }
}

// ═══════════════════════════════════════════════════════════════════
// Entry Point 2: quadrupoleContrib
// Finalize CoM from partial sums. Compute per-particle d³I/d³Q contributions.
// Update residual force history AFTER jerk computation (matches CPU order).
// Workgroup-reduce to global d³ sums.
// ═══════════════════════════════════════════════════════════════════
@compute @workgroup_size(64)
fn quadrupoleContrib(
    @builtin(global_invocation_id) gid: vec3u,
    @builtin(local_invocation_id) lid: vec3u,
    @builtin(workgroup_id) wgid: vec3u,
) {
    let i = gid.x;
    let localId = lid.x;
    let numWG = (u.aliveCount + 63u) / 64u;

    // Finalize CoM from all workgroup partial sums (each thread reads all — max 64 iterations)
    var comXw: f32 = 0.0;
    var comYw: f32 = 0.0;
    var totalMass: f32 = 0.0;
    for (var wg: u32 = 0u; wg < numWG; wg++) {
        let base = wg * 4u;
        comXw += reductionBuf[base + 0u];
        comYw += reductionBuf[base + 1u];
        totalMass += reductionBuf[base + 2u];
    }
    var comX: f32 = 0.0;
    var comY: f32 = 0.0;
    if (totalMass > EPSILON) {
        comX = comXw / totalMass;
        comY = comYw / totalMass;
    }

    let alive = i < u.aliveCount && (particles[i].flags & FLAG_ALIVE) != 0u;
    let gravOn = (u.toggles0 & GRAVITY_BIT) != 0u;
    let coulombOn = (u.toggles0 & COULOMB_BIT) != 0u;
    let gwQuad = gravOn;
    let emQuad = coulombOn;

    // Per-particle d³ contribution
    var d3I_xx: f32 = 0.0; var d3I_xy: f32 = 0.0; var d3I_yy: f32 = 0.0;
    var d3Q_xx: f32 = 0.0; var d3Q_xy: f32 = 0.0; var d3Q_yy: f32 = 0.0;
    var contribI: f32 = 0.0;
    var contribQ: f32 = 0.0;

    if (alive) {
        // Coordinate velocity from proper velocity
        let wx = particles[i].velWX;
        let wy = particles[i].velWY;
        let wSq = wx * wx + wy * wy;
        let invGamma = 1.0 / sqrt(1.0 + wSq);
        let vx = wx * invGamma;
        let vy = wy * invGamma;

        // CoM-relative position
        let x = particles[i].posX - comX;
        let y = particles[i].posY - comY;

        // Total force
        let Fx = allForces[i].totalForce.x;
        let Fy = allForces[i].totalForce.y;

        // Total jerk = analytical (from force pass) + backward-difference residual
        var Jx = radState[i].jerkX;
        var Jy = radState[i].jerkY;

        let rs = radState[i];
        let count = u32(rs.qResCount);
        // Use PHYSICS_DT (fixed timestep constant) for backward-difference spacing,
        // matching CPU where quadrupole runs once per update() with dt ≈ PHYSICS_DT.
        let dt = PHYSICS_DT;

        if (count >= 2u && dt > EPSILON) {
            // O(dt²) 3-point backward derivative
            let invDt = 1.0 / dt;
            let c0 = 0.5 * invDt;
            let c1 = -2.0 * invDt;
            let c2 = 1.5 * invDt;
            // Current residual = totalForce - grav - coulomb - yukawa
            let af = allForces[i];
            let resFx = af.totalForce.x - af.f0.x - af.f0.z - af.f3.z;
            let resFy = af.totalForce.y - af.f0.y - af.f0.w - af.f3.w;
            Jx += c0 * rs.qResFx0 + c1 * rs.qResFx1 + c2 * resFx;
            Jy += c0 * rs.qResFy0 + c1 * rs.qResFy1 + c2 * resFy;
        } else if (count >= 1u && dt > EPSILON) {
            // O(dt) 2-point backward fallback
            let af = allForces[i];
            let resFx = af.totalForce.x - af.f0.x - af.f0.z - af.f3.z;
            let resFy = af.totalForce.y - af.f0.y - af.f0.w - af.f3.w;
            Jx += (resFx - rs.qResFx1) / dt;
            Jy += (resFy - rs.qResFy1) / dt;
        }
        // else: jerk not ready for this particle, use analytical only

        // Mass quadrupole d³I_ij/dt³
        if (gwQuad) {
            let d3I_xx_i = 6.0 * vx * Fx + 2.0 * x * Jx;
            let d3I_xy_i = Jx * y + 3.0 * Fx * vy + 3.0 * vx * Fy + x * Jy;
            let d3I_yy_i = 6.0 * vy * Fy + 2.0 * y * Jy;
            d3I_xx = d3I_xx_i;
            d3I_xy = d3I_xy_i;
            d3I_yy = d3I_yy_i;
            contribI = d3I_xx_i * d3I_xx_i + 2.0 * d3I_xy_i * d3I_xy_i + d3I_yy_i * d3I_yy_i;
        }

        // Charge quadrupole d³Q_ij/dt³
        if (emQuad) {
            let qm = particles[i].charge * derived[i].invMass;
            let d3Q_xx_i = qm * (6.0 * vx * Fx + 2.0 * x * Jx);
            let d3Q_xy_i = qm * (Jx * y + 3.0 * Fx * vy + 3.0 * vx * Fy + x * Jy);
            let d3Q_yy_i = qm * (6.0 * vy * Fy + 2.0 * y * Jy);
            d3Q_xx = d3Q_xx_i;
            d3Q_xy = d3Q_xy_i;
            d3Q_yy = d3Q_yy_i;
            contribQ = d3Q_xx_i * d3Q_xx_i + 2.0 * d3Q_xy_i * d3Q_xy_i + d3Q_yy_i * d3Q_yy_i;
        }

        // Store per-particle contribution norms in scratch fields
        // AND shift residual force history (AFTER jerk computation used old values)
        var rsW = radState[i];
        rsW.d3IContrib = contribI;
        rsW.d3QContrib = contribQ;
        // Shift history: t-1 → t-2, current → t-1 (matches CPU order in integrator.js:1241-1243)
        let af2 = allForces[i];
        let curResFx = af2.totalForce.x - af2.f0.x - af2.f0.z - af2.f3.z;
        let curResFy = af2.totalForce.y - af2.f0.y - af2.f0.w - af2.f3.w;
        rsW.qResFx0 = rsW.qResFx1;
        rsW.qResFy0 = rsW.qResFy1;
        rsW.qResFx1 = curResFx;
        rsW.qResFy1 = curResFy;
        if (rsW.qResCount < 2.0) {
            rsW.qResCount += 1.0;
        }
        radState[i] = rsW;
    }

    // Load into shared memory for reduction
    sh_d3Ixx[localId] = d3I_xx;
    sh_d3Ixy[localId] = d3I_xy;
    sh_d3Iyy[localId] = d3I_yy;
    sh_d3Qxx[localId] = d3Q_xx;
    sh_d3Qxy[localId] = d3Q_xy;
    sh_d3Qyy[localId] = d3Q_yy;
    sh_totalD3I[localId] = contribI;
    sh_totalD3Q[localId] = contribQ;

    // Workgroup reduction
    workgroupReduce8(localId);

    // Lane 0 writes partial sums
    if (localId == 0u) {
        let base = MAX_QUAD_WG * 4u + wgid.x * 8u;
        reductionBuf[base + 0u] = sh_d3Ixx[0];
        reductionBuf[base + 1u] = sh_d3Ixy[0];
        reductionBuf[base + 2u] = sh_d3Iyy[0];
        reductionBuf[base + 3u] = sh_d3Qxx[0];
        reductionBuf[base + 4u] = sh_d3Qxy[0];
        reductionBuf[base + 5u] = sh_d3Qyy[0];
        reductionBuf[base + 6u] = sh_totalD3I[0];
        reductionBuf[base + 7u] = sh_totalD3Q[0];
    }
}

// ═══════════════════════════════════════════════════════════════════
// Entry Point 3: quadrupoleApply
// Finalize global power, apply tangential drag, accumulate energy, emit photons.
// ═══════════════════════════════════════════════════════════════════
@compute @workgroup_size(64)
fn quadrupoleApply(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if ((particles[i].flags & FLAG_ALIVE) == 0u) { return; }

    let numWG = (u.aliveCount + 63u) / 64u;
    let gravOn = (u.toggles0 & GRAVITY_BIT) != 0u;
    let coulombOn = (u.toggles0 & COULOMB_BIT) != 0u;
    let gwQuad = gravOn;
    let emQuad = coulombOn;

    // Finalize CoM partial sums (need totalKE)
    var totalKE: f32 = 0.0;
    for (var wg: u32 = 0u; wg < numWG; wg++) {
        totalKE += reductionBuf[wg * 4u + 3u];
    }

    // Finalize d³ partial sums
    var d3Ixx: f32 = 0.0; var d3Ixy: f32 = 0.0; var d3Iyy: f32 = 0.0;
    var d3Qxx: f32 = 0.0; var d3Qxy: f32 = 0.0; var d3Qyy: f32 = 0.0;
    var totalD3I: f32 = 0.0;
    var totalD3Q: f32 = 0.0;

    for (var wg: u32 = 0u; wg < numWG; wg++) {
        let base = MAX_QUAD_WG * 4u + wg * 8u;
        d3Ixx += reductionBuf[base + 0u];
        d3Ixy += reductionBuf[base + 1u];
        d3Iyy += reductionBuf[base + 2u];
        d3Qxx += reductionBuf[base + 3u];
        d3Qxy += reductionBuf[base + 4u];
        d3Qyy += reductionBuf[base + 5u];
        totalD3I += reductionBuf[base + 6u];
        totalD3Q += reductionBuf[base + 7u];
    }

    // GW power: trace-free reduced quadrupole
    // I^TF_ij = I_ij - (1/3)δ_ij·trace. For 2D motion in 3D (I_zz=0): trace = I_xx + I_yy
    let trI = d3Ixx + d3Iyy;
    let d3Ixx_tf = d3Ixx - trI / 3.0;
    let d3Iyy_tf = d3Iyy - trI / 3.0;
    // d3Iyy_tf = d3Iyy - (d3Ixx + d3Iyy)/3 = (2*d3Iyy - d3Ixx)/3
    let gwPower = select(0.0, 0.2 * (d3Ixx_tf * d3Ixx_tf + 2.0 * d3Ixy * d3Ixy + d3Iyy_tf * d3Iyy_tf), gwQuad);

    // EM power: NOT trace-free
    let emPower = select(0.0, (1.0 / 180.0) * (d3Qxx * d3Qxx + 2.0 * d3Qxy * d3Qxy + d3Qyy * d3Qyy), emQuad);

    let quadPower = gwPower + emPower;
    if (quadPower <= 0.0 || totalKE <= EPSILON_SQ) { return; }

    // Use PHYSICS_DT constant (matches CPU where quadrupole uses this._dt ≈ PHYSICS_DT)
    let dt = PHYSICS_DT;
    var dE = quadPower * dt;
    dE = min(dE, QUADRUPOLE_POWER_CLAMP * totalKE);

    // Split proportionally between GW and EM channels
    let gwFrac = gwPower / quadPower;
    let gwDE = dE * gwFrac;
    let emDE = dE - gwDE;

    // Tangential drag: scale all proper velocities by (1 - f)
    let f = min(0.5 * dE / totalKE, 1.0);
    let scale = 1.0 - f;
    let fOverDt = f / dt;

    let wx = particles[i].velWX;
    let wy = particles[i].velWY;

    // Update display force (drag direction)
    var rs = radState[i];
    rs.radDisplayX -= particles[i].mass * wx * fOverDt;
    rs.radDisplayY -= particles[i].mass * wy * fOverDt;

    // Apply drag (NaN guard per project conventions)
    let newWx = wx * scale;
    let newWy = wy * scale;
    if (newWx == newWx && newWy == newWy) {
        particles[i].velWX = newWx;
        particles[i].velWY = newWy;
    }

    // Distribute energy proportional to per-particle contribution
    let invD3I = select(0.0, 1.0 / totalD3I, totalD3I > EPSILON_SQ);
    let invD3Q = select(0.0, 1.0 / totalD3Q, totalD3Q > EPSILON_SQ);

    if (invD3I > 0.0) { rs.quadAccum += gwDE * rs.d3IContrib * invD3I; }
    if (invD3Q > 0.0) { rs.emQuadAccum += emDE * rs.d3QContrib * invD3Q; }

    // ── Emit GW graviton ──
    if (rs.quadAccum >= MIN_MASS) {
        let phIdx = atomicAdd(&phCount, 1u);
        if (phIdx < MAX_PHOTONS) {
            // Quadrupole angular pattern: power ∝ (Axx·cos2φ + Axy·sin2φ)²
            let angle = quadSample(d3Ixx, d3Ixy, i, 0u);
            let cosA = cos(angle);
            let sinA = sin(angle);
            let offset = max(particleAux[i].radius * 1.5, 1.0);
            var ph: Photon;
            ph.posX = particles[i].posX + cosA * offset;
            ph.posY = particles[i].posY + sinA * offset;
            ph.velX = cosA;
            ph.velY = sinA;
            ph.energy = rs.quadAccum;
            ph.emitterId = particleAux[i].particleId;
            ph.lifetime = 0.0;
            ph.flags = 3u; // FLAG_ALIVE(1) | FLAG_GRAV(2)
            photons[phIdx] = ph;
            rs.quadAccum = 0.0;
        } else {
            atomicSub(&phCount, 1u);
        }
    }

    // ── Emit EM quadrupole photon ──
    if (rs.emQuadAccum >= MIN_MASS) {
        let phIdx = atomicAdd(&phCount, 1u);
        if (phIdx < MAX_PHOTONS) {
            let angle = quadSample(d3Qxx, d3Qxy, i, 1u);
            let cosA = cos(angle);
            let sinA = sin(angle);
            let offset = max(particleAux[i].radius * 1.5, 1.0);
            var ph: Photon;
            ph.posX = particles[i].posX + cosA * offset;
            ph.posY = particles[i].posY + sinA * offset;
            ph.velX = cosA;
            ph.velY = sinA;
            ph.energy = rs.emQuadAccum;
            ph.emitterId = particleAux[i].particleId;
            ph.lifetime = 0.0;
            ph.flags = 1u; // FLAG_ALIVE only (EM photon)
            photons[phIdx] = ph;
            rs.emQuadAccum = 0.0;
        } else {
            atomicSub(&phCount, 1u);
        }
    }

    radState[i] = rs;
}

// ── Quadrupole rejection sampling ──
// Power ∝ (Axx·cos2φ + Axy·sin2φ)² where peak² = Axx² + Axy².
fn quadSample(Axx: f32, Axy: f32, particleIdx: u32, channel: u32) -> f32 {
    let peak2 = Axx * Axx + Axy * Axy;
    if (peak2 < EPSILON_SQ) {
        return pcgRand((particleIdx * 2654435761u) ^ (u.frameCount * 1664525u) ^ (channel * 999u)) * TWO_PI;
    }
    var seedBase = (particleIdx * 2246822519u) ^ (u.frameCount * 2654435769u) ^ (channel * 12345u);
    for (var t: u32 = 0u; t < 8u; t++) {
        let phi = pcgRand(seedBase ^ (t * 1234567u)) * TWO_PI;
        let c2 = cos(2.0 * phi);
        let s2 = sin(2.0 * phi);
        let h = Axx * c2 + Axy * s2;
        if (pcgRand(seedBase ^ (t * 7654321u + 1u)) * peak2 <= h * h) {
            return phi;
        }
    }
    // Fallback: random angle
    return pcgRand(seedBase ^ 999999u) * TWO_PI;
}
```

---

## Chunk 3: Pipeline + Dispatch Wiring

### Task 6: Add quadrupole pipelines to createPhase4Pipelines

**Files:**
- Modify: `src/gpu/gpu-pipelines.js:452-516,627-633`

- [ ] **Step 1: Add quadrupole pipeline creation**

After the radiation pipelines block (after `pionEmission` at line ~516) and before the bosons section (line 518), insert:

```js
    // ── Quadrupole radiation (quadrupole.wgsl) ──
    // Group 0: uniforms
    // Group 1: particleState (rw) + particleAux (rw) + derived (rw) + allForces (rw) + radiationState (rw) = 5
    // Group 2: photonPool (rw) + phCount (rw) = 2
    // Group 3: quadReductionBuf (rw) = 1
    // Total: 8 storage buffers per stage
    const quadCode = await fetchShader('quadrupole.wgsl', wgslConstants);
    const quadModule = device.createShaderModule({ label: 'quadrupole', code: quadCode });

    const quadG0 = device.createBindGroupLayout({
        label: 'quadrupole_g0',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
    });
    const quadG1 = device.createBindGroupLayout({
        label: 'quadrupole_g1',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // particleState (rw)
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // particleAux (rw)
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // derived (rw)
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // allForces (rw)
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // radiationState (rw)
        ],
    });
    const quadG2 = device.createBindGroupLayout({
        label: 'quadrupole_g2',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // photonPool
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // phCount
        ],
    });
    const quadG3 = device.createBindGroupLayout({
        label: 'quadrupole_g3',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // quadReductionBuf
        ],
    });

    const quadLayouts = [quadG0, quadG1, quadG2, quadG3];
    const quadPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: quadLayouts });

    const quadrupoleCoM = {
        pipeline: device.createComputePipeline({
            label: 'quadrupoleCoM', layout: quadPipelineLayout,
            compute: { module: quadModule, entryPoint: 'quadrupoleCoM' },
        }),
        bindGroupLayouts: quadLayouts,
    };
    const quadrupoleContrib = {
        pipeline: device.createComputePipeline({
            label: 'quadrupoleContrib', layout: quadPipelineLayout,
            compute: { module: quadModule, entryPoint: 'quadrupoleContrib' },
        }),
        bindGroupLayouts: quadLayouts,
    };
    const quadrupoleApply = {
        pipeline: device.createComputePipeline({
            label: 'quadrupoleApply', layout: quadPipelineLayout,
            compute: { module: quadModule, entryPoint: 'quadrupoleApply' },
        }),
        bindGroupLayouts: quadLayouts,
    };
```

- [ ] **Step 2: Add to return object**

In the return block (~line 627-633), add the three quadrupole pipelines:
```js
    return {
        recordHistory,
        compute1PN, vvKick1PN,
        larmorRadiation, hawkingRadiation, pionEmission,
        quadrupoleCoM, quadrupoleContrib, quadrupoleApply,
        ...bosonPipelines,
        ...bosonTreePipelines,
    };
```

---

### Task 7: Wire quadrupole into gpu-physics.js

**Files:**
- Modify: `src/gpu/gpu-physics.js:141,621-658,2436-2481`

- [ ] **Step 1: Add bind group creation**

In `_createPhase4BindGroups()` (after the radiation bind groups at ~line 658), add:

```js
        // ── Quadrupole radiation (quadrupoleCoM, quadrupoleContrib, quadrupoleApply share bind groups) ──
        this._phase4BindGroups.quadG0 = bg('quadrupole_g0', p4.quadrupoleCoM.bindGroupLayouts[0],
            [this.uniformBuffer]);
        this._phase4BindGroups.quadG1 = bg('quadrupole_g1', p4.quadrupoleCoM.bindGroupLayouts[1],
            [b.particleState, b.particleAux, b.derived, b.allForces, b.radiationState]);
        this._phase4BindGroups.quadG2 = bg('quadrupole_g2', p4.quadrupoleCoM.bindGroupLayouts[2],
            [b.photonPool, b.phCount]);
        this._phase4BindGroups.quadG3 = bg('quadrupole_g3', p4.quadrupoleCoM.bindGroupLayouts[3],
            [b.quadReductionBuf]);
```

- [ ] **Step 2: Add _dispatchQuadrupole method**

After `_dispatchRadiation()` (~line 749), add:

```js
    /**
     * Dispatch quadrupole radiation passes (once per frame, after all substeps).
     * Requires Radiation + (Gravity or Coulomb) + at least 2 particles.
     * Three dispatches: CoM reduction → d³ contribution reduction → apply + emit.
     */
    _dispatchQuadrupole(encoder) {
        if (!this._radiationEnabled) return;
        if (this.aliveCount < 2) return;
        // Requires gravity or coulomb (same guard as CPU)
        const t0 = this._toggles0;
        if (!(t0 & 1) && !(t0 & 2)) return; // neither gravity nor coulomb

        const workgroups = Math.ceil(this.aliveCount / 64);
        const bgs = this._phase4BindGroups;
        const p4 = this._phase4;

        function setBindGroups(pass) {
            pass.setBindGroup(0, bgs.quadG0);
            pass.setBindGroup(1, bgs.quadG1);
            pass.setBindGroup(2, bgs.quadG2);
            pass.setBindGroup(3, bgs.quadG3);
        }

        // Pass 1: Reduce CoM + totalKE + update residual force history
        const p1 = encoder.beginComputePass({ label: 'quadrupoleCoM' });
        p1.setPipeline(p4.quadrupoleCoM.pipeline);
        setBindGroups(p1);
        p1.dispatchWorkgroups(workgroups);
        p1.end();

        // Pass 2: Compute d³I/d³Q contributions + reduce
        const p2 = encoder.beginComputePass({ label: 'quadrupoleContrib' });
        p2.setPipeline(p4.quadrupoleContrib.pipeline);
        setBindGroups(p2);
        p2.dispatchWorkgroups(workgroups);
        p2.end();

        // Pass 3: Apply drag + accumulate + emit photons/gravitons
        const p3 = encoder.beginComputePass({ label: 'quadrupoleApply' });
        p3.setPipeline(p4.quadrupoleApply.pipeline);
        setBindGroups(p3);
        p3.dispatchWorkgroups(workgroups);
        p3.end();
    }
```

- [ ] **Step 3: Wire into post-substep section**

In `update()`, in the post-substep block (~line 2457, after `_dispatchRecordHistory`), add:

```js
            // Quadrupole radiation (once per frame, after history recording — matches CPU order)
            // Uses PHYSICS_DT constant in shader (not u.dt which holds dtSub from last substep)
            this._dispatchQuadrupole(encoder);
```

- [ ] **Step 4: Commit**

```bash
git add src/gpu/shaders/quadrupole.wgsl src/gpu/shaders/common.wgsl src/gpu/shaders/radiation.wgsl src/gpu/shaders/forces-tree.wgsl src/gpu/gpu-buffers.js src/gpu/gpu-constants.js src/gpu/gpu-pipelines.js src/gpu/gpu-physics.js
git commit -m "feat(gpu): add quadrupole radiation (EM + GW) compute shaders

Three-dispatch pipeline per frame: CoM reduction → d³I/d³Q contribution
reduction → apply drag + emit photons/gravitons. Extends RadiationState
struct from 32B to 64B for residual force history and quadrupole
accumulators. Closes GPU/CPU radiation parity gap."
```

---

## Chunk 4: Update CLAUDE.md

### Task 8: Document quadrupole in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (radiation section and shader file map)

- [ ] **Step 1: Add quadrupole.wgsl to file map**

In the shader file map under `Phase 4: Advanced physics`, add:
```
      quadrupole.wgsl          Quadrupole radiation: CoM reduce, d³I/d³Q reduce, apply+emit (3 entries)
```

- [ ] **Step 2: Update dispatch sequence documentation**

In the "Dispatch sequence per substep" section, add a note in the post-substep section:
```
Post-substep (once per frame, separate encoder):
  heatmap, boson gravity, dead GC, history recording,
  quadrupole radiation (3 passes: CoM → d³ contrib → apply+emit),
  updateColors, trail recording.
```

- [ ] **Step 3: Update RadiationState documentation**

In the "Packed Struct Buffers" table, update RadiationState:
```
| `RadiationState` | 64B | jerkX/Y, radAccum, hawkAccum, yukawaRadAccum, radDisplayX/Y, qRes history, quadAccum, emQuadAccum, d3I/QContrib scratch | 16 fields → 1 buffer |
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add GPU quadrupole radiation to architecture docs"
```
