// ─── Potential Field Heatmap ───
// 128x128 grid potential from particles. Gravity, Coulomb, Yukawa contributions, and the
// magnetic field Bz (out of the plane, so a value, not a direction): moving charges
// (Biot–Savart, or with signal delay B = n̂ × E of the Liénard–Wiechert field), spin
// dipoles (−μ/r³ in the plane) and the external Bz, as pair-force.wgsl has them.
// Two entry points:
//   computeHeatmap:     O(N*GRID²) pairwise, with signal delay support
//   computeHeatmapTree: O(log(N)*GRID²) BH tree walk, no signal delay (non-periodic only)
// Dead/retired particles always use pairwise scan with signal delay history.
// With signal delay each source sits at its retarded state (shared-worldline.wgsl), and the
// electric potential is the Liénard–Wiechert q/(κR), κ = 1 − n̂·β; gravity and Yukawa keep
// their static forms at the retarded position.

struct HeatmapUniforms {
    // Camera/viewport for world-space grid
    viewLeft: f32,
    viewTop: f32,
    cellW: f32,
    cellH: f32,
    // Physics params
    softeningSq: f32,
    yukawaCoupling: f32,
    yukawaMu: f32,
    simTime: f32,
    // Domain
    domainW: f32,
    domainH: f32,
    // Toggle bits
    doGravity: u32,
    doCoulomb: u32,
    doYukawa: u32,
    useDelay: u32,
    periodic: u32,
    topologyMode: u32,
    particleCount: u32,
    useTree: u32,   // 1 when BH tree available
    blackHole: u32,
    scaleA: f32,
    doMagnetic: u32,
    extBz: f32,
};

// Group 0: particleState + particleAux + treeNodes (read_write for encoder compat)
@group(0) @binding(0) var<storage, read_write> particles: array<ParticleState>;
@group(0) @binding(1) var<storage, read_write> particleAux: array<ParticleAux>;
@group(0) @binding(2) var<storage, read_write> nodes: array<u32>;

@group(1) @binding(0) var<storage, read_write> gravPotential: array<f32>;
@group(1) @binding(1) var<storage, read_write> elecPotential: array<f32>;
@group(1) @binding(2) var<storage, read_write> yukawaPotential: array<f32>;
@group(1) @binding(3) var<uniform> hu: HeatmapUniforms;
@group(1) @binding(4) var<storage, read_write> magField: array<f32>;

// Group 2: world lines (only read when useDelay != 0)
@group(2) @binding(0) var<storage, read_write> wlData: array<f32>;
@group(2) @binding(1) var<storage, read_write> wlMeta: array<u32>;

// Constants provided by generated wgslConstants block.
// Node accessors from shared-tree-nodes.wgsl (prepended).

// Yukawa cutoff: exp(-mu*r) < 0.002 when mu*r > 6
fn yukawaCutoffSq(mu: f32) -> f32 {
    let cutoff = 6.0 / mu;
    return cutoff * cutoff;
}

fn bhSourceRadius(m: f32, charge: f32) -> f32 {
    if (m <= EPSILON) { return 0.0; }
    let disc = m * m - charge * charge;
    return select(m, m + sqrt(max(0.0, disc)), disc >= 0.0);
}

fn gravityPotential(rawRSq: f32, mass: f32, radius: f32, invR: f32, blackHole: bool) -> f32 {
    if (blackHole) {
        let rawR = sqrt(max(rawRSq, EPSILON));
        let gap = max(rawR - radius, BH_PW_MIN_GAP);
        return -mass / gap;
    }
    return -mass * invR;
}

// ─── Helper: accumulate potential from one source at displacement (dx, dy) ───
fn accumulatePotential(
    dx: f32, dy: f32,
    mass: f32, charge: f32,
    radius: f32,
    kappa: f32,
    doG: bool, doC: bool, doY: bool,
    softeningSq: f32, yCutSq: f32,
    yukCoupling: f32, yukMu: f32,
    gPhi: ptr<function, f32>,
    ePhi: ptr<function, f32>,
    yPhi: ptr<function, f32>,
) {
    let rawRSq = dx * dx + dy * dy;
    let rSq = rawRSq + softeningSq;
    let invR = 1.0 / sqrt(rSq);

    if (doG) { *gPhi += gravityPotential(rawRSq, mass, radius, invR, hu.blackHole != 0u); }
    if (doC) { *ePhi += charge * invR / kappa; }
    if (doY && rSq < yCutSq) {
        let r = 1.0 / invR;
        *yPhi -= yukCoupling * mass * exp(-yukMu * r) * invR;
    }
}

/**
 * Bz at the cell from one source at rel = source − cell, moving at coordinate velocity vel
 * (acceleration acc, for the delayed field's radiation term), with spin angw. Signs as in
 * pair-force.wgsl: Biot–Savart Bz = −q (v × r)_z/r³, a dipole's in-plane −μ/r³.
 */
fn accumulateBz(rel: vec2<f32>, vel: vec2<f32>, acc: vec2<f32>, charge: f32, mass: f32, angw: f32,
                delayed: bool, bz: ptr<function, f32>) {
    let rawRSq = dot(rel, rel);
    let invR = inverseSqrt(rawRSq + hu.softeningSq);
    let invR3 = invR * invR * invR;
    if (delayed) {
        let R = sqrt(rawRSq);
        if (R > EPSILON) {
            let n = -rel / R;
            let kappa = max(1.0 - dot(n, vel), LW_KAPPA_MIN);
            let k3 = 1.0 / (kappa * kappa * kappa);
            let sigma = R * invR;
            let nb = n - vel;
            let eVel = nb * ((1.0 - dot(vel, vel)) * k3 / (R * R));
            let cz = nb.x * acc.y - nb.y * acc.x;
            let eRad = vec2(n.y, -n.x) * (cz * k3 / R);
            let E = (eVel + eRad) * (charge * sigma * sigma * sigma);
            *bz += n.x * E.y - n.y * E.x;
        }
    } else {
        *bz -= charge * (vel.x * rel.y - vel.y * rel.x) * invR3;
    }
    let bodyRSq = pow(max(mass, EPSILON), 2.0 / 3.0);
    let angVel = select(angw, angw * inverseSqrt(1.0 + angw * angw * bodyRSq), hu.useDelay != 0u);
    *bz -= MAG_MOMENT_K * charge * angVel * bodyRSq * invR3;
}

fn coordVelOf(w: vec2<f32>) -> vec2<f32> {
    return select(w, w * inverseSqrt(1.0 + dot(w, w)), hu.useDelay != 0u);
}

/** Liénard–Wiechert κ = 1 − n̂·β at a retarded state, n̂ from the source to the cell. */
fn lwKappa(ret: Retarded) -> f32 {
    let R = length(ret.rel);
    if (R < EPSILON) { return 1.0; }
    return max(1.0 + dot(ret.rel / R, ret.vel), LW_KAPPA_MIN);
}

/** Retired particles keep sourcing until the light from their world line's end has passed. */
fn accumulateRetired(
    wx: f32, wy: f32, doG: bool, doC: bool, doY: bool, isPeriodic: bool, yCutSq: f32,
    gPhi: ptr<function, f32>, ePhi: ptr<function, f32>, yPhi: ptr<function, f32>,
    doM: bool, bz: ptr<function, f32>,
) {
    for (var di = 0u; di < hu.particleCount; di++) {
        let dp = particles[di];
        if ((dp.flags & FLAG_RETIRED) == 0u) { continue; }
        if ((dp.flags & FLAG_ALIVE) != 0u) { continue; }

        let ret = retardedState(di, wx, wy, hu.simTime,
            vec2(dp.posX, dp.posY), vec2(0.0), 0.0, 0.0, dp.charge,
            false, isPeriodic, hu.domainW, hu.domainH, hu.topologyMode, hu.scaleA);
        if (!ret.valid) { continue; }

        accumulatePotential(ret.rel.x, ret.rel.y, ret.mass, ret.charge, bhSourceRadius(ret.mass, ret.charge),
            lwKappa(ret), doG, doC, doY, hu.softeningSq, yCutSq, hu.yukawaCoupling, hu.yukawaMu,
            gPhi, ePhi, yPhi);
        if (doM) { accumulateBz(ret.rel, ret.vel, ret.acc, ret.charge, ret.mass, ret.angw, true, bz); }
    }
}

// ─── Entry 1: Pairwise with signal delay support ───
@compute @workgroup_size(8, 8)
fn computeHeatmap(@builtin(global_invocation_id) gid: vec3<u32>) {
    let gx = gid.x;
    let gy = gid.y;
    if (gx >= HGRID || gy >= HGRID) { return; }

    let wx = hu.viewLeft + (f32(gx) + 0.5) * hu.cellW;
    let wy = hu.viewTop + (f32(gy) + 0.5) * hu.cellH;

    var gPhi: f32 = 0.0;
    var ePhi: f32 = 0.0;
    var yPhi: f32 = 0.0;
    var bz: f32 = hu.extBz;

    let doG = hu.doGravity != 0u;
    let doC = hu.doCoulomb != 0u;
    let doY = hu.doYukawa != 0u;
    let doM = hu.doMagnetic != 0u;
    let useDelay = hu.useDelay != 0u;
    let isPeriodic = hu.periodic != 0u;
    let yCutSq = select(1e30, yukawaCutoffSq(hu.yukawaMu), doY);

    // Alive particles
    for (var i = 0u; i < hu.particleCount; i++) {
        let p = particles[i];
        if ((p.flags & FLAG_ALIVE) == 0u) { continue; }

        if (useDelay) {
            let ret = retardedState(i, wx, wy, hu.simTime,
                vec2(p.posX, p.posY), vec2(p.velWX, p.velWY), p.angW, p.mass, p.charge,
                true, isPeriodic, hu.domainW, hu.domainH, hu.topologyMode, hu.scaleA);
            if (!ret.valid) { continue; } // outside past light cone — particle not yet visible
            accumulatePotential(ret.rel.x, ret.rel.y, ret.mass, ret.charge, particleAux[i].radius,
                lwKappa(ret), doG, doC, doY, hu.softeningSq, yCutSq, hu.yukawaCoupling, hu.yukawaMu,
                &gPhi, &ePhi, &yPhi);
            if (doM) { accumulateBz(ret.rel, ret.vel, ret.acc, ret.charge, ret.mass, ret.angw, true, &bz); }
        } else {
            var d = vec2(p.posX - wx, p.posY - wy);
            if (isPeriodic) { d = fullMinImageP(wx, wy, p.posX, p.posY, hu.domainW, hu.domainH, hu.topologyMode); }
            accumulatePotential(d.x, d.y, p.mass, p.charge, particleAux[i].radius, 1.0,
                doG, doC, doY, hu.softeningSq, yCutSq, hu.yukawaCoupling, hu.yukawaMu,
                &gPhi, &ePhi, &yPhi);
            if (doM) { accumulateBz(d, coordVelOf(vec2(p.velWX, p.velWY)), vec2(0.0), p.charge, p.mass, p.angW, false, &bz); }
        }
    }

    // Dead/retired particles: signal delay fade-out
    if (useDelay) {
        accumulateRetired(wx, wy, doG, doC, doY, isPeriodic, yCutSq, &gPhi, &ePhi, &yPhi, doM, &bz);
    }

    let idx = gy * HGRID + gx;
    gravPotential[idx] = gPhi;
    elecPotential[idx] = ePhi;
    yukawaPotential[idx] = yPhi;
    magField[idx] = bz;
}

// ─── Entry 2: BH tree walk (no signal delay) ───
// Uses theta criterion: if node_size/distance < theta, use aggregate.
// Falls back to leaf-level evaluation at individual particles.

const HM_MAX_STACK: u32 = 48u;
const HM_NONE: i32 = -1;

@compute @workgroup_size(8, 8)
fn computeHeatmapTree(@builtin(global_invocation_id) gid: vec3<u32>) {
    let gx = gid.x;
    let gy = gid.y;
    if (gx >= HGRID || gy >= HGRID) { return; }

    let wx = hu.viewLeft + (f32(gx) + 0.5) * hu.cellW;
    let wy = hu.viewTop + (f32(gy) + 0.5) * hu.cellH;

    var gPhi: f32 = 0.0;
    var ePhi: f32 = 0.0;
    var yPhi: f32 = 0.0;

    let doG = hu.doGravity != 0u;
    let doC = hu.doCoulomb != 0u;
    let doY = hu.doYukawa != 0u;
    let softeningSq = hu.softeningSq;
    let yCutSq = select(1e30, yukawaCutoffSq(hu.yukawaMu), doY);
    let yukCoupling = hu.yukawaCoupling;
    let yukMu = hu.yukawaMu;

    // Stack-based BH tree traversal
    var stack: array<u32, HM_MAX_STACK>;
    var top: i32 = 0;
    stack[0] = 0u;
    top = 1;

    while (top > 0) {
        top--;
        let nIdx = stack[u32(top)];

        let isLeaf = getNW(nIdx) == HM_NONE;

        if (isLeaf) {
            // Leaf node: evaluate individual particle
            let pIdx = getParticleIndex(nIdx);
            if (pIdx < 0) { continue; }
            let j = u32(pIdx);
            let pj = particles[j];
            if ((pj.flags & FLAG_ALIVE) == 0u) { continue; }

            let dx = pj.posX - wx;
            let dy = pj.posY - wy;
            let rawRSq = dx * dx + dy * dy;
            let rSq = rawRSq + softeningSq;
            let invR = 1.0 / sqrt(rSq);

            if (doG) { gPhi += gravityPotential(rawRSq, pj.mass, particleAux[j].radius, invR, hu.blackHole != 0u); }
            if (doC) { ePhi += pj.charge * invR; }
            if (doY && rSq < yCutSq) {
                let r = 1.0 / invR;
                yPhi -= yukCoupling * pj.mass * exp(-yukMu * r) * invR;
            }
        } else {
            // Internal node: check theta criterion
            let comX = getComX(nIdx);
            let comY = getComY(nIdx);
            let dx = comX - wx;
            let dy = comY - wy;
            let rawDistSq = dx * dx + dy * dy;
            let distSq = rawDistSq + softeningSq;

            let sizeX = getMaxX(nIdx) - getMinX(nIdx);
            let sizeY = getMaxY(nIdx) - getMinY(nIdx);
            let sizeSq = max(sizeX * sizeX, sizeY * sizeY);

            if (sizeSq < BH_THETA_SQ * distSq) {
                // Use aggregate: mass and charge from tree node
                let aggMass = getTotalMass(nIdx);
                let aggCharge = getTotalCharge(nIdx);
                let invR = 1.0 / sqrt(distSq);

                if (doG) { gPhi += gravityPotential(rawDistSq, aggMass, bhSourceRadius(aggMass, aggCharge), invR, hu.blackHole != 0u); }
                if (doC) { ePhi += aggCharge * invR; }
                if (doY && distSq < yCutSq) {
                    let r = 1.0 / invR;
                    yPhi -= yukCoupling * aggMass * exp(-yukMu * r) * invR;
                }
            } else if (top + 4 <= i32(HM_MAX_STACK)) {
                // Open node: push children
                let nw = getNW(nIdx); let ne = getNE(nIdx);
                let sw = getSW(nIdx); let se = getSE(nIdx);
                if (nw != HM_NONE) { stack[u32(top)] = u32(nw); top++; }
                if (ne != HM_NONE) { stack[u32(top)] = u32(ne); top++; }
                if (sw != HM_NONE) { stack[u32(top)] = u32(sw); top++; }
                if (se != HM_NONE) { stack[u32(top)] = u32(se); top++; }
            }
        }
    }

    // Bz has no tree aggregate (moving charges and dipoles): pairwise, as without the tree
    var bz: f32 = hu.extBz;
    let doM = hu.doMagnetic != 0u;
    if (doM) {
        for (var i = 0u; i < hu.particleCount; i++) {
            let p = particles[i];
            if ((p.flags & FLAG_ALIVE) == 0u) { continue; }
            accumulateBz(vec2(p.posX - wx, p.posY - wy), coordVelOf(vec2(p.velWX, p.velWY)), vec2(0.0),
                p.charge, p.mass, p.angW, false, &bz);
        }
    }

    // Dead/retired particles: always pairwise (signal delay needed)
    if (hu.useDelay != 0u) {
        accumulateRetired(wx, wy, doG, doC, doY, hu.periodic != 0u, yCutSq, &gPhi, &ePhi, &yPhi, doM, &bz);
    }

    let idx = gy * HGRID + gx;
    gravPotential[idx] = gPhi;
    elecPotential[idx] = ePhi;
    yukawaPotential[idx] = yPhi;
    magField[idx] = bz;
}

// ─── 3x3 Separable Box Blur ───
@group(0) @binding(0) var<storage, read_write> arr: array<f32>;
@group(0) @binding(1) var<storage, read_write> blurTemp: array<f32>;

@compute @workgroup_size(8, 8)
fn blurHorizontal(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= HGRID || y >= HGRID) { return; }

    let row = y * HGRID;
    let l = arr[row + select(0u, x - 1u, x > 0u)];
    let c = arr[row + x];
    let r = arr[row + select(HGRID - 1u, x + 1u, x < HGRID - 1u)];
    blurTemp[row + x] = (l + c + r) * (1.0 / 3.0);
}

@compute @workgroup_size(8, 8)
fn blurVertical(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= HGRID || y >= HGRID) { return; }

    let t = blurTemp[select(0u, y - 1u, y > 0u) * HGRID + x];
    let c = blurTemp[y * HGRID + x];
    let b = blurTemp[select(HGRID - 1u, y + 1u, y < HGRID - 1u) * HGRID + x];
    arr[y * HGRID + x] = (t + c + b) * (1.0 / 3.0);
}
