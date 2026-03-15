# GPU Signal Delay Parity — Design Spec

**Date:** 2026-03-15
**Status:** Approved
**Scope:** Bring GPU signal delay implementation to full parity with CPU, fix aberration gaps in both backends

## Problem Statement

The GPU physics backend records signal delay history (`history.wgsl`) and has a working light-cone solver (`getDelayedStateGPU`), but force computation shaders (`pair-force.wgsl`, `forces-tree.wgsl`, `onePN.wgsl`) do not use signal-delayed positions. They compute forces from current-time positions with only the aberration factor applied — physically incorrect since aberration is a correction on top of retarded positions, not a standalone effect.

Additionally:
- Dead/retired particles exert zero force in GPU mode (CPU fades them via signal delay history)
- GPU heatmap doesn't iterate dead particles
- No `creationTime` guard in GPU extrapolation (CPU rejects extrapolation past particle creation)
- CPU BH tree walk: ghosts skip signal delay, aggregates skip aberration — both should be fixed

## Design

### 1. Interleaved History Buffer

**Current:** 7 separate buffers — `histPosX`, `histPosY`, `histVelWX`, `histVelWY`, `histAngW`, `histTime`, `histMeta`.

**New:** 2 buffers total:

1. **`histData`** (f32): Interleaved `[posX, posY, velX, velY, angW, time]` per sample. Stride = 6. Indexed as `histData[particleIdx * HISTORY_LEN * 6 + sampleIdx * 6 + field]`. Size: `maxParticles × HISTORY_LEN × 6 × 4` bytes.

2. **`histMeta`** (u32): Expanded from 2 to 4 u32 per particle: `[writeIdx, count, creationTimeBits, _pad]`. `creationTimeBits = bitcast<u32>(simTime)` at spawn. Size: `maxParticles × 16` bytes.

**Rationale:** Reduces 7 buffer bindings to 2 (fits within `maxStorageBuffersPerShaderStage` limit of 10). Per-sample reads become contiguous 24-byte fetches (cache-line friendly). `creationTime` in histMeta lets the solver reject extrapolation past creation.

**Migration constraint:** The `histMeta` stride change from 2 → 4 u32 per particle must be applied atomically across ALL consumers. Any shader still indexing `srcIdx * 2u` will read garbage. All readers (`history.wgsl`, `heatmap.wgsl`, `signal-delay-common.wgsl`) and all writers (`gpu-physics.js` `addParticle`/`reset`/`deserialize`) must update in the same change.

**Files changed:**
- `gpu-buffers.js` — replace 7 allocations with 2, expand histMeta stride
- `history.wgsl` — write interleaved format; on FLAG_REBORN clear, also write `histMeta[i*4+2] = bitcast<u32>(u.simTime)` to record spawn time for recycled slots
- `gpu-physics.js` — `addParticle()`, `reset()`, `deserialize()` init histMeta with creationTime
- `gpu-pipelines.js` — update bind group layouts for history

### 2. Shared Signal Delay Lookup

**New file: `src/gpu/shaders/signal-delay-common.wgsl`**

Contains `getDelayedStateGPU()` rewritten for interleaved buffer format. Includes:
- NR light-cone solver (phase 1) + exact quadratic (phase 2) + backward extrapolation (phase 3)
- `minImageDisp()` for topology-aware periodic boundaries (Torus/Klein/RP²)
- `creationTime` rejection: reads `histMeta[srcIdx * 4 + 2]`, rejects extrapolation past creation
- Dead particle guard: `isDead=true` skips extrapolation (phase 3)

**Integration pattern:** Prepended to consuming shaders (like `common.wgsl`). Consumers declare `histData` and `histMeta` bindings at their chosen group/binding. The shared file references them by name.

**`history.wgsl`:** The existing `getDelayedStateGPU()` function (lines 165-419) is **removed** from `history.wgsl`. It is replaced by the new version in `signal-delay-common.wgsl`. `history.wgsl` retains only the `recordHistory` entry point. The old function has zero callers in the current codebase (it exists but is never imported by other shaders), so this is purely organizational.

**`heatmap.wgsl`:** Replaces its inline `getRetardedPosition()` with the shared function, gaining `creationTime` check and dead-particle guard it currently lacks.

### 3. Jerk Migration: AllForces._pad → AllForces.jerk

To free a storage buffer binding in force shaders (needed by `forces-tree.wgsl` to stay within the 10-buffer limit), jerk accumulation moves from `RadiationState` to `AllForces`.

**Change:** Rename `AllForces._pad: vec2<f32>` → `AllForces.jerk: vec2<f32>`. Force shaders (`pair-force.wgsl`, `forces-tree.wgsl`) write jerk into `allForces[i].jerk` instead of `radiationState[i].jerkX/jerkY`. The `radiationState` binding is removed from both force shaders.

**Downstream:** `radiation.wgsl` reads jerk from `allForces[i].jerk` instead of `radiationState[i].jerkX/jerkY`. The `RadiationState` struct keeps `jerkX`/`jerkY` fields for backward compat but they become unused by force shaders.

**Impact on binding counts:**
- `pair-force.wgsl`: drops from 6 → 5 existing storage (before adding history)
- `forces-tree.wgsl`: drops from 9 → 8 existing storage (before adding history)

### 4. pair-force.wgsl Signal Delay

**Bind group layout (after jerk migration + history addition):**
- Group 0: uniforms (1 uniform)
- Group 1: particles + derived + axYukMod + particleAux (4 storage)
- Group 2: allForces + maxAccel (2 storage)
- Group 3: histData + histMeta (2 storage)

Total: 8 storage + 1 uniform. Within limits.

**Tile struct change:** The `TileParticle` struct is split into two modes:

When signal delay is **off** (relativity disabled): tile caches all current source data as today (`posX, posY, velX, velY, mass, charge, angVel, magMoment, angMomentum, axMod, yukMod, radiusSq`). No performance regression.

When signal delay is **on**: tile caches only observer-independent properties:
```wgsl
struct TileParticle {
    mass: f32, charge: f32,
    axMod: f32, yukMod: f32,
    bodyRadiusSq: f32,  // pow(mass, 2/3), NOT derived.radiusSq (BH horizon)
    srcIdx: u32,        // index into histData for signal delay lookup
};
```
Each thread calls `getDelayedStateGPU(srcIdx, myPosX, myPosY, ...)` to get retarded position/velocity/angw. The retarded state is observer-dependent and cannot be shared via tile.

**Retarded dipole recomputation (matching CPU `forces.js:105-109`):**
```
bodyRadiusSq = pow(mass, 2.0/3.0)  // NOT derived.radiusSq (BH horizon in BH mode)
sAngVel = retAngw / sqrt(1 + retAngw² * bodyRadiusSq)
sMagMoment = MAG_MOMENT_K * charge * sAngVel * bodyRadiusSq
sAngMomentum = INERTIA_K * mass * sAngVel * bodyRadiusSq
```

**Dead particle loop:** After tile loop, scan `[0, aliveCount)` for `FLAG_RETIRED & !FLAG_ALIVE`. Call `getDelayedStateGPU(ri, ..., isDead=true)`. Use `deathMass`/`deathAngVel` from `ParticleAux`. Apply aberration.

**Signal delay failure:** When `getDelayedStateGPU` returns `valid=false`, skip the source entirely (matching CPU `continue` at `forces.js:102`).

### 5. forces-tree.wgsl Signal Delay

**Bind group layout (after jerk migration + history addition):**
- Group 0: nodes + uniforms (1 storage + 1 uniform)
- Group 1: particleState + particleAux + derived + axYukMod + ghostOriginalIdx (5 storage)
- Group 2: allForces + maxAccel (2 storage)
- Group 3: histData + histMeta (2 storage)

Total: 10 storage + 1 uniform. At limit.

**Leaf nodes, non-ghost:** `getDelayedStateGPU(srcIdx, ...)`, recompute dipoles from retarded angw, apply aberration. Skip source on `valid=false`.

**Leaf nodes, ghost:** `getDelayedStateGPU(originalIdx, ...)` to get original's retarded position, then add periodic shift `(ghostPos - originalCurrentPos)`. Retarded velocity/angw come from the original's history. Recompute dipoles. Apply aberration. The periodic shift is time-invariant (domain geometry doesn't change).

**Aggregate nodes:** Current-time CoM position (no signal delay), but apply aberration using `avgVx/avgVy` from `totalMomentumX/Y / totalMass`.

**Dead particle loop:** Replace stub (line 633: `// Phase 4 will add signal delay lookup here`) with proper `getDelayedStateGPU(ri, ..., isDead=true)`. Use `deathMass`/`deathAngVel` from `ParticleAux`. Apply aberration.

### 6. onePN.wgsl Signal Delay

**Bind groups:** Add group 3: histData + histMeta (2 storage). Total: 7 storage + 1 uniform. Well within limits.

**Changes:**
- Prepend `signal-delay-common.wgsl`
- Each thread calls `getDelayedStateGPU(srcIdx, ...)` per source
- If `valid=false`, skip source
- Use retarded position/velocity for all 1PN terms (EIH, Darwin, Bazanski, Scalar Breit)
- **No aberration** — 1PN is already O(v²/c²); aberration would be O(v³/c³)
- Dead particles excluded from 1PN (matching CPU behavior)

### 7. Heatmap Dead Particles

After the alive-particle loop, add a second loop scanning `[0, particleCount)` for `FLAG_RETIRED & !FLAG_ALIVE`. Call `getDelayedStateGPU(i, ..., isDead=true)`. Use `deathMass` for gravity/Yukawa, `charge` for electric potential. The heatmap already has history bindings (group 2) — just switch to interleaved format and use the shared function.

### 8. Boundary-Killed Particles

`boundary.wgsl` sets `FLAG_RETIRED` but does NOT write `deathTime`. The `dead-gc.wgsl` frees these immediately (checks `deathT < 1e30`, boundary-killed particles retain the `1e30` sentinel). This means boundary-killed particles never appear in the dead-particle force loops — they're freed before the next frame's force computation.

This matches CPU behavior: the CPU `_retireParticle()` is only called from collision paths (merge/annihilation). Boundary despawn on CPU removes particles from the array directly without going through `_retireParticle()` or joining `deadParticles[]`. Neither backend applies signal delay fade-out to boundary-killed particles.

**Fix:** `boundary.wgsl` should write `particleAux[i].deathTime = uniforms.simTime` before setting `FLAG_RETIRED`. This enables signal delay fade-out for boundary-killed particles, which is physically more correct (forces propagate at light speed even from particles that left the domain). `dead-gc.wgsl` will then wait for the standard `2 * domainDiag` expiry before freeing the slot. On the CPU side, `_retireParticle()` should also be called for boundary despawn (or equivalent logic added to the boundary handler).

### 9. CPU-Side Fixes (forces.js)

**BH aggregate aberration:** Line 668 calls `pairForce()` without `signalDelayed`. Fix: pass `signalDelayed=true` when `useSignalDelay` is on. The aggregate's `avgVx/avgVy` provides the velocity for the aberration factor.

**Ghost signal delay:** Line 644 skips signal delay for ghosts (`!other.isGhost`). Fix: when signal delay is on, call `getDelayedState(real, particle, ...)` on the ghost's original, then add the periodic shift `(other.pos.x - real.pos.x, other.pos.y - real.pos.y)` to the retarded position. Retarded velocity/angw come from the original's history. Apply aberration.

## Aberration Coverage Matrix

| Path | Delayed Positions | Aberration | Notes |
|------|-------------------|------------|-------|
| CPU pairwise | Yes | Yes | Already correct |
| CPU BH leaf (real) | Yes | Yes | Already correct |
| CPU BH leaf (ghost) | No → Yes | No → Yes | Fix: retarded original + shift |
| CPU BH aggregate | No (CoM) | No → Yes | Fix: add aberration with avg vel |
| CPU dead particles | Yes | Yes | Already correct |
| CPU 1PN | Yes | No | Correct — O(v²) already |
| GPU pairwise | No → Yes | Wrong → Yes | Fix: retarded positions + aberration |
| GPU BH leaf (real) | No → Yes | No → Yes | Fix both |
| GPU BH leaf (ghost) | No → Yes | No → Yes | Fix: retarded original + shift |
| GPU BH aggregate | No (CoM) | No → Yes | Fix: add aberration with avg vel |
| GPU dead (tree) | Stub → Yes | No → Yes | Fix: replace stub |
| GPU dead (pairwise) | Missing → Yes | Missing → Yes | Fix: add dead loop |
| GPU 1PN | No → Yes | No | Correct — no aberration needed |
| GPU heatmap alive | Yes | N/A | Already works (potential, not force) |
| GPU heatmap dead | Missing → Yes | N/A | Fix: add dead loop |

## Files Changed

### New files
- `src/gpu/shaders/signal-delay-common.wgsl` — shared getDelayedStateGPU for interleaved format

### GPU shader changes
- `src/gpu/shaders/history.wgsl` — write interleaved format, remove getDelayedStateGPU (moved to shared), init creationTime on FLAG_REBORN clear
- `src/gpu/shaders/pair-force.wgsl` — signal delay lookup, dead particles, tile restructure, bind group restructure, jerk → AllForces
- `src/gpu/shaders/forces-tree.wgsl` — signal delay at leaves/ghosts, aberration on aggregates, fix dead stub, jerk → AllForces
- `src/gpu/shaders/onePN.wgsl` — signal delay lookup
- `src/gpu/shaders/heatmap.wgsl` — use shared function, add dead particle loop
- `src/gpu/shaders/common.wgsl` — rename AllForces._pad → AllForces.jerk
- `src/gpu/shaders/radiation.wgsl` — read jerk from AllForces instead of RadiationState
- `src/gpu/shaders/boundary.wgsl` — write deathTime before setting FLAG_RETIRED

### GPU infrastructure changes
- `src/gpu/gpu-buffers.js` — interleaved histData + expanded histMeta, remove 7 separate history buffers
- `src/gpu/gpu-pipelines.js` — bind group layouts for all affected shaders (pair-force, forces-tree, onePN, heatmap, history, radiation)
- `src/gpu/gpu-physics.js` — buffer init, creationTime in addParticle/reset/deserialize, bind group creation, dispatch updates, remove radiationState binding from force dispatches
- `src/gpu/gpu-constants.js` — HIST_STRIDE constant (6) for WGSL

### CPU changes
- `src/forces.js` — ghost signal delay + aberration, aggregate aberration
- `src/integrator.js` — call `_retireParticle()` for boundary despawn (signal delay fade-out)

## Performance Considerations

- **Pairwise O(N²):** Each pair now requires ~20-30 global memory reads for NR convergence (vs 0 today). This is the most expensive change. Mitigated by: interleaved layout (cache-friendly), early exit on convergence, tile still caches observer-independent data.
- **BH tree walk:** Signal delay only at leaves (typically O(N log N) leaf visits). Aggregates unchanged except for cheap aberration factor.
- **1PN:** Already O(N²); signal delay adds proportional cost.
- **When relativity is off:** Zero overhead — all signal delay paths gated by toggle check.
