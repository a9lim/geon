// ─── Boson Gravity Tree ───
// Build BH tree from alive photons + pions for boson gravity.
// Lightweight: only totalMass + CoM (no charge/dipole aggregates).
// Traversal shaders: particle<-boson gravity and boson<->boson mutual gravity.
//
// Standalone shader — defines own structs (NOT prepended with common.wgsl).
// Uses CAS lock insertion + bottom-up visitor-flag aggregation (matches tree-build.wgsl).

// Constants provided by generated wgslConstants block.

// Struct definitions (ParticleState, AllForces, Photon, Pion, SimUniforms) provided by shared-structs.wgsl.

// Boson tree node: same 20-word layout as particle tree but only mass+CoM used
const NODE_WORDS: u32 = 20u;
const NONE: i32 = -1;
const LOCK_BIT: i32 = -2147483648; // 0x80000000 (MSB)

// Node field offsets
const N_MIN_X: u32 = 0u;
const N_MIN_Y: u32 = 1u;
const N_MAX_X: u32 = 2u;
const N_MAX_Y: u32 = 3u;
const N_COM_X: u32 = 4u;
const N_COM_Y: u32 = 5u;
const N_TOTAL_MASS: u32 = 6u;
const N_PARTICLE_COUNT: u32 = 12u;
const N_DIVIDED: u32 = 13u;
const N_NW: u32 = 14u;
const N_NE: u32 = 15u;
const N_SW: u32 = 16u;
const N_SE: u32 = 17u;
const N_PARTICLE_IDX: u32 = 18u;
const N_PARENT: u32 = 19u;

// Group 0: uniforms + boson tree nodes (atomic) + counter + visitor flags
@group(0) @binding(0) var<uniform> u: SimUniforms;
@group(0) @binding(1) var<storage, read_write> bosonTree: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> bosonNodeCounter: atomic<u32>;
@group(0) @binding(3) var<storage, read_write> bosonVisitorFlags: array<atomic<u32>>;

// Group 1: photon pool (packed)
@group(1) @binding(0) var<storage, read_write> photons: array<Photon>;
@group(1) @binding(1) var<storage, read_write> phCount: atomic<u32>;

// Group 2: pion pool (packed)
@group(2) @binding(0) var<storage, read_write> pions: array<Pion>;
@group(2) @binding(1) var<storage, read_write> piCount: atomic<u32>;

// Group 3: particle state + force accumulators (read_write for encoder compat)
@group(3) @binding(0) var<storage, read_write> particles: array<ParticleState>;
@group(3) @binding(1) var<storage, read_write> allForces: array<AllForces>;

// ── Atomic node accessors ──

fn nodeF32(nodeIdx: u32, field: u32) -> f32 {
    return bitcast<f32>(atomicLoad(&bosonTree[nodeIdx * NODE_WORDS + field]));
}

fn nodeU32(nodeIdx: u32, field: u32) -> u32 {
    return atomicLoad(&bosonTree[nodeIdx * NODE_WORDS + field]);
}

fn setNodeF32(nodeIdx: u32, field: u32, val: f32) {
    atomicStore(&bosonTree[nodeIdx * NODE_WORDS + field], bitcast<u32>(val));
}

fn setNodeU32(nodeIdx: u32, field: u32, val: u32) {
    atomicStore(&bosonTree[nodeIdx * NODE_WORDS + field], val);
}

// Atomic CAS on particleIndex field (for lock protocol)
fn casParticleIdx(nodeIdx: u32, expected: i32, desired: i32) -> i32 {
    let offset = nodeIdx * NODE_WORDS + N_PARTICLE_IDX;
    let result = atomicCompareExchangeWeak(&bosonTree[offset], bitcast<u32>(expected), bitcast<u32>(desired));
    return bitcast<i32>(result.old_value);
}

fn getParentIndex(nodeIdx: u32) -> i32 {
    return bitcast<i32>(atomicLoad(&bosonTree[nodeIdx * NODE_WORDS + N_PARENT]));
}

fn atomicAddParticleCount(nodeIdx: u32, val: u32) -> u32 {
    return atomicAdd(&bosonTree[nodeIdx * NODE_WORDS + N_PARTICLE_COUNT], val);
}

// Allocate a new tree node, returns index
fn allocNode() -> u32 {
    return atomicAdd(&bosonNodeCounter, 1u);
}

// Initialize a node with bounds and parent index
fn initNode(idx: u32, minX: f32, minY: f32, maxX: f32, maxY: f32, parentIdx: i32) {
    let base = idx * NODE_WORDS;
    atomicStore(&bosonTree[base + N_MIN_X], bitcast<u32>(minX));
    atomicStore(&bosonTree[base + N_MIN_Y], bitcast<u32>(minY));
    atomicStore(&bosonTree[base + N_MAX_X], bitcast<u32>(maxX));
    atomicStore(&bosonTree[base + N_MAX_Y], bitcast<u32>(maxY));
    atomicStore(&bosonTree[base + N_COM_X], bitcast<u32>(0.0));
    atomicStore(&bosonTree[base + N_COM_Y], bitcast<u32>(0.0));
    atomicStore(&bosonTree[base + N_TOTAL_MASS], bitcast<u32>(0.0));
    atomicStore(&bosonTree[base + N_PARTICLE_COUNT], 0u);
    atomicStore(&bosonTree[base + N_DIVIDED], 0u);
    atomicStore(&bosonTree[base + N_NW], 0xFFFFFFFFu);
    atomicStore(&bosonTree[base + N_NE], 0xFFFFFFFFu);
    atomicStore(&bosonTree[base + N_SW], 0xFFFFFFFFu);
    atomicStore(&bosonTree[base + N_SE], 0xFFFFFFFFu);
    atomicStore(&bosonTree[base + N_PARTICLE_IDX], bitcast<u32>(NONE));
    atomicStore(&bosonTree[base + N_PARENT], bitcast<u32>(parentIdx));
}

// Determine which child a point falls into
fn quadrantChild(parent: u32, x: f32, y: f32, midX: f32, midY: f32,
                 nw: u32, ne: u32, sw: u32, se: u32) -> u32 {
    if (x < midX) { return select(nw, sw, y >= midY); }
    else { return select(ne, se, y >= midY); }
}

fn childFor(nodeIdx: u32, px: f32, py: f32) -> u32 {
    let minX = nodeF32(nodeIdx, N_MIN_X);
    let minY = nodeF32(nodeIdx, N_MIN_Y);
    let maxX = nodeF32(nodeIdx, N_MAX_X);
    let maxY = nodeF32(nodeIdx, N_MAX_Y);
    let midX = (minX + maxX) * 0.5;
    let midY = (minY + maxY) * 0.5;
    let nw = nodeU32(nodeIdx, N_NW);
    let ne = nodeU32(nodeIdx, N_NE);
    let sw = nodeU32(nodeIdx, N_SW);
    let se = nodeU32(nodeIdx, N_SE);
    return quadrantChild(nodeIdx, px, py, midX, midY, nw, ne, sw, se);
}

fn subdivide(nodeIdx: u32) {
    let minX = nodeF32(nodeIdx, N_MIN_X);
    let minY = nodeF32(nodeIdx, N_MIN_Y);
    let maxX = nodeF32(nodeIdx, N_MAX_X);
    let maxY = nodeF32(nodeIdx, N_MAX_Y);
    let cx = (minX + maxX) * 0.5;
    let cy = (minY + maxY) * 0.5;
    let parentI32 = i32(nodeIdx);

    let nw = allocNode();
    let ne = allocNode();
    let sw = allocNode();
    let se = allocNode();

    initNode(nw, minX, minY, cx, cy, parentI32);
    initNode(ne, cx, minY, maxX, cy, parentI32);
    initNode(sw, minX, cy, cx, maxY, parentI32);
    initNode(se, cx, cy, maxX, maxY, parentI32);

    setNodeU32(nodeIdx, N_NW, nw);
    setNodeU32(nodeIdx, N_NE, ne);
    setNodeU32(nodeIdx, N_SW, sw);
    setNodeU32(nodeIdx, N_SE, se);
}

// Insert a boson into the tree (CAS lock protocol, matches tree-build.wgsl)
@compute @workgroup_size(64)
fn insertBosonsIntoTree(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    let phN = atomicLoad(&phCount);
    let piN = atomicLoad(&piCount);
    let total = phN + piN;
    if (i >= total) { return; }

    var bx: f32; var by: f32; var bMass: f32;
    if (i < phN) {
        // Photon: source mass = energy
        if ((photons[i].flags & 1u) == 0u) { return; }
        bx = photons[i].posX; by = photons[i].posY;
        bMass = photons[i].energy;
    } else {
        let pi = i - phN;
        if ((pions[pi].flags & 1u) == 0u) { return; }
        bx = pions[pi].posX; by = pions[pi].posY;
        // Pion source mass = gravMass = m * gamma
        let wx = pions[pi].wX; let wy = pions[pi].wY;
        let gamma = sqrt(1.0 + wx * wx + wy * wy);
        bMass = pions[pi].mass * gamma;
    }

    // CAS lock insertion: walk from root, subdivide on collision
    var cur: u32 = 0u;
    var depth: u32 = 0u;

    loop {
        if (depth >= MAX_DEPTH) { break; }

        // Try to CAS particleIndex from NONE to our boson index (claim empty leaf)
        let prev = casParticleIdx(cur, NONE, i32(i));

        if (prev == NONE) {
            // Successfully claimed empty node — we are a leaf
            setNodeU32(cur, N_PARTICLE_COUNT, 1u);
            let parentIdx = getParentIndex(cur);
            if (parentIdx >= 0) {
                atomicAddParticleCount(u32(parentIdx), 1u);
            }
            break;
        }

        // Node is occupied or being subdivided
        let prevUnlocked = prev & ~LOCK_BIT;

        if (prevUnlocked >= 0 && bitcast<i32>(nodeU32(cur, N_NW)) == NONE) {
            // Occupied leaf with no children — try to lock for subdivision
            let lockResult = casParticleIdx(cur, prev, prev | LOCK_BIT);
            if (lockResult == prev) {
                // Got the lock — subdivide
                subdivide(cur);

                // Reinsert displaced boson into correct child
                let displacedIdx = u32(prev);
                var dispX: f32; var dispY: f32;
                if (displacedIdx < phN) {
                    dispX = photons[displacedIdx].posX;
                    dispY = photons[displacedIdx].posY;
                } else {
                    let dpi = displacedIdx - phN;
                    dispX = pions[dpi].posX;
                    dispY = pions[dpi].posY;
                }

                let childForDisplaced = childFor(cur, dispX, dispY);
                // Write displaced boson as leaf of child
                atomicStore(&bosonTree[childForDisplaced * NODE_WORDS + N_PARTICLE_IDX], bitcast<u32>(prev));
                setNodeU32(childForDisplaced, N_PARTICLE_COUNT, 1u);
                atomicAddParticleCount(cur, 1u); // cur now has one populated child

                // Mark current node as internal (clear particleIndex)
                atomicStore(&bosonTree[cur * NODE_WORDS + N_PARTICLE_IDX], bitcast<u32>(NONE));

                // Descend into correct child for our boson
                cur = childFor(cur, bx, by);
                depth += 1u;
                continue;
            }
            // Failed to lock — someone else is subdividing. Spin/retry.
        }

        // Node has children (internal node) or is being subdivided — descend
        if (bitcast<i32>(nodeU32(cur, N_NW)) != NONE) {
            cur = childFor(cur, bx, by);
            depth += 1u;
        }
        // If NW is still NONE, another thread is subdividing — spin (bounded by depth guard)
    }
}

// Bottom-up aggregate via visitor flags (leaf->root walk).
// Each boson thread finds its leaf, writes leaf data, then walks up via N_PARENT.
// Last visitor to each internal node aggregates children.
@compute @workgroup_size(64)
fn computeBosonAggregates(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    let phN = atomicLoad(&phCount);
    let piN = atomicLoad(&piCount);
    let total = phN + piN;
    if (i >= total) { return; }

    var bx: f32; var by: f32; var bMass: f32;
    var alive: bool;
    if (i < phN) {
        alive = (photons[i].flags & 1u) != 0u;
        bx = photons[i].posX; by = photons[i].posY;
        bMass = photons[i].energy;
    } else {
        let pi = i - phN;
        alive = (pions[pi].flags & 1u) != 0u;
        bx = pions[pi].posX; by = pions[pi].posY;
        let wx = pions[pi].wX; let wy = pions[pi].wY;
        let gamma = sqrt(1.0 + wx * wx + wy * wy);
        bMass = pions[pi].mass * gamma;
    }
    if (!alive) { return; }

    // Walk root->leaf to find our leaf node
    var leafNode: u32 = 0u;
    var depth: u32 = 0u;
    loop {
        if (depth >= MAX_DEPTH) { break; }
        if (bitcast<i32>(nodeU32(leafNode, N_NW)) == NONE) { break; } // leaf
        leafNode = childFor(leafNode, bx, by);
        depth += 1u;
    }

    // Write leaf aggregates (single boson)
    setNodeF32(leafNode, N_TOTAL_MASS, bMass);
    if (bMass > 0.0) {
        setNodeF32(leafNode, N_COM_X, bx);
        setNodeF32(leafNode, N_COM_Y, by);
    }

    // Walk up to root via parent indices
    var curNode: i32 = getParentIndex(leafNode);
    loop {
        if (curNode < 0) { break; } // reached root's parent (NONE)

        let nodeU = u32(curNode);
        // Each visitor increments the flag. Only the last visitor (the one
        // that brings the count up to the number of populated children) is
        // allowed to aggregate and continue climbing.
        let expectedVisitors = nodeU32(nodeU, N_PARTICLE_COUNT); // populated child count
        let prev2 = atomicAdd(&bosonVisitorFlags[nodeU], 1u);
        if (prev2 < expectedVisitors - 1u) {
            // Not the last visitor — exit
            break;
        }

        // Last visitor — aggregate children
        let c0 = nodeU32(nodeU, N_NW);
        let c1 = nodeU32(nodeU, N_NE);
        let c2 = nodeU32(nodeU, N_SW);
        let c3 = nodeU32(nodeU, N_SE);

        let m0 = nodeF32(c0, N_TOTAL_MASS);
        let m1 = nodeF32(c1, N_TOTAL_MASS);
        let m2 = nodeF32(c2, N_TOTAL_MASS);
        let m3 = nodeF32(c3, N_TOTAL_MASS);
        let totalM = m0 + m1 + m2 + m3;

        setNodeF32(nodeU, N_TOTAL_MASS, totalM);
        if (totalM > EPSILON) {
            let invM = 1.0 / totalM;
            setNodeF32(nodeU, N_COM_X, (nodeF32(c0, N_COM_X) * m0 + nodeF32(c1, N_COM_X) * m1 + nodeF32(c2, N_COM_X) * m2 + nodeF32(c3, N_COM_X) * m3) * invM);
            setNodeF32(nodeU, N_COM_Y, (nodeF32(c0, N_COM_Y) * m0 + nodeF32(c1, N_COM_Y) * m1 + nodeF32(c2, N_COM_Y) * m2 + nodeF32(c3, N_COM_Y) * m3) * invM);
        }

        curNode = getParentIndex(nodeU);
    }
}

// Shared BH gravity force: F = massFactor * nodeMass / (r^2 + softening)^{3/2} * r_hat
fn bhGravForce(dx: f32, dy: f32, nodeMass: f32, massFactor: f32) -> vec2f {
    let rSq = dx * dx + dy * dy + BOSON_SOFTENING_SQ;
    let invRSq = 1.0 / rSq;
    let f = massFactor * nodeMass * sqrt(invRSq) * invRSq;
    return vec2f(dx * f, dy * f);
}

// Gravitational force from bosons onto particles via BH tree walk.
@compute @workgroup_size(64)
fn computeBosonGravity(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if ((particles[i].flags & FLAG_ALIVE) == 0u) { return; }

    let px = particles[i].posX; let py = particles[i].posY;
    let pMass = particles[i].mass;

    var force = vec2f(0.0);

    // Stack-based BH tree walk (boson tree)
    var stack: array<u32, 48>;
    var top: i32 = 0;
    stack[0] = 0u; // root
    top = 1;

    while (top > 0) {
        top--;
        let nIdx = stack[top];
        let nodeMass = nodeF32(nIdx, N_TOTAL_MASS);
        if (nodeMass < EPSILON) { continue; }

        let cx = nodeF32(nIdx, N_COM_X);
        let cy = nodeF32(nIdx, N_COM_Y);
        let dx = cx - px;
        let dy = cy - py;
        let dSq = dx * dx + dy * dy;
        let size = nodeF32(nIdx, N_MAX_X) - nodeF32(nIdx, N_MIN_X);
        let isDivided = bitcast<i32>(nodeU32(nIdx, N_NW)) != NONE;

        if (!isDivided || size * size < BH_THETA_SQ * dSq) {
            force += bhGravForce(dx, dy, nodeMass, pMass);
        } else if (top + 4 <= 48) {
            stack[top] = nodeU32(nIdx, N_NW); top++;
            stack[top] = nodeU32(nIdx, N_NE); top++;
            stack[top] = nodeU32(nIdx, N_SW); top++;
            stack[top] = nodeU32(nIdx, N_SE); top++;
        }
    }

    // Add to gravity force accumulators (allForces.f0.xy = gravity)
    var af = allForces[i];
    af.f0.x += force.x;
    af.f0.y += force.y;
    allForces[i] = af;
}

// Mutual gravitational interaction between bosons via BH tree walk.
// GR receiver factors: 2 for photons (null geodesic), 1+v^2 for pions (massive).
@compute @workgroup_size(64)
fn applyBosonBosonGravity(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    let phN = atomicLoad(&phCount);
    let piN = atomicLoad(&piCount);
    let total = phN + piN;
    if (i >= total) { return; }

    let dt = u.dt;
    var bx: f32; var by: f32; var grFactor: f32;

    if (i < phN) {
        if ((photons[i].flags & 1u) == 0u) { return; }
        bx = photons[i].posX; by = photons[i].posY;
        grFactor = 2.0; // photon: null geodesic
    } else {
        let pi = i - phN;
        if ((pions[pi].flags & 1u) == 0u) { return; }
        bx = pions[pi].posX; by = pions[pi].posY;
        let wx = pions[pi].wX; let wy = pions[pi].wY;
        let wSq = wx * wx + wy * wy;
        let vSq = wSq / (1.0 + wSq);
        grFactor = 1.0 + vSq; // massive: 1+v^2
    }

    // BH tree walk of boson tree
    let massFactor = grFactor * dt;
    var kick = vec2f(0.0);

    var stack: array<u32, 48>;
    var top: i32 = 0;
    stack[0] = 0u;
    top = 1;

    while (top > 0) {
        top--;
        let nIdx = stack[top];
        let nodeMass = nodeF32(nIdx, N_TOTAL_MASS);
        if (nodeMass < EPSILON) { continue; }

        let cx = nodeF32(nIdx, N_COM_X);
        let cy = nodeF32(nIdx, N_COM_Y);
        let dx = cx - bx;
        let dy = cy - by;
        let dSq = dx * dx + dy * dy;
        let size = nodeF32(nIdx, N_MAX_X) - nodeF32(nIdx, N_MIN_X);
        let isDivided = bitcast<i32>(nodeU32(nIdx, N_NW)) != NONE;

        if (!isDivided || size * size < BH_THETA_SQ * dSq) {
            kick += bhGravForce(dx, dy, nodeMass, massFactor);
        } else if (top + 4 <= 48) {
            stack[top] = nodeU32(nIdx, N_NW); top++;
            stack[top] = nodeU32(nIdx, N_NE); top++;
            stack[top] = nodeU32(nIdx, N_SW); top++;
            stack[top] = nodeU32(nIdx, N_SE); top++;
        }
    }

    // Apply impulse
    if (i < phN) {
        var pvx = photons[i].velX + kick.x;
        var pvy = photons[i].velY + kick.y;
        // Renormalize photon to c=1
        let vSq = pvx * pvx + pvy * pvy;
        if (vSq > EPSILON) {
            let invV = inverseSqrt(vSq);
            pvx *= invV;
            pvy *= invV;
        }
        // NaN guard
        if (pvx != pvx || pvy != pvy) { pvx = 1.0; pvy = 0.0; }
        photons[i].velX = pvx;
        photons[i].velY = pvy;
    } else {
        let pi2 = i - phN;
        pions[pi2].wX += kick.x;
        pions[pi2].wY += kick.y;
    }
}
