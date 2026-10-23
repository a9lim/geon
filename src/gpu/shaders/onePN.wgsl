// ─── 1PN Force Recomputation (Velocity-Verlet Correction) ───
// Recomputes the 1PN pair forces (shared-1pn.wgsl: EIH remainder, Bažański, scalar Breit)
// at post-drift positions and velocities, then corrects the kick by half their change.
//
// Three entry points:
//   compute1PN     — recomputes 1PN forces at post-drift positions (O(N²) pairwise)
//   compute1PNTree — recomputes 1PN forces via Barnes-Hut tree walk (O(N log N))
//   vvKick1PN      — applies VV correction kick: w += (f1pn_new - f1pn_old) * dt/(2m)
//
// Prepended with: wgslConstants + shared-structs.wgsl + shared-topology.wgsl + shared-rng.wgsl
//   + shared-relativity.wgsl + shared-tree-nodes.wgsl + shared-worldline.wgsl + shared-1pn.wgsl.
// With Relativity on, each source acts from its retarded state, without aberration (1PN is
// already O(v²/c²)). Retired particles are excluded from 1PN.

const NONE: i32 = -1;
const MAX_STACK: u32 = 48u;

// Uses SimUniforms from shared-structs.wgsl (prepended).
@group(0) @binding(0) var<uniform> u: SimUniforms;

// Group 1: particle state (read_write for encoder compat)
@group(1) @binding(0) var<storage, read_write> particles: array<ParticleState>;
@group(1) @binding(1) var<storage, read_write> derived: array<ParticleDerived>;
@group(1) @binding(2) var<storage, read_write> axYukMod: array<vec4<f32>>;  // packed: axMod, yukMod, higgsMod, pad

// Group 2: force outputs (particleState accessed via group 1 to avoid aliasing)
@group(2) @binding(0) var<storage, read_write> allForces: array<AllForces>;
@group(2) @binding(1) var<storage, read_write> f1pnOld: array<f32>; // rw for encoder compat

// Group 3: world lines, and the BH tree nodes (compute1PNTree only; accessor fns from
// shared-tree-nodes.wgsl reference 'nodes')
@group(3) @binding(0) var<storage, read_write> wlData: array<f32>;
@group(3) @binding(1) var<storage, read_write> wlMeta: array<u32>;
@group(3) @binding(2) var<storage, read_write> nodes: array<u32>;

struct PNObserver {
    pos: vec2<f32>,
    vel: vec2<f32>,
    mass: f32,
    charge: f32,
    yukMod: f32,
    higgsMod: f32,
};

fn pnObserver(i: u32, relOn: bool) -> PNObserver {
    var o: PNObserver;
    let p = particles[i];
    o.pos = vec2(p.posX, p.posY);
    // Current (post-drift) velocity: this is the endpoint of the VV correction
    let w = vec2(p.velWX, p.velWY);
    o.vel = select(w, w * inverseSqrt(1.0 + dot(w, w)), relOn);
    o.mass = p.mass;
    o.charge = p.charge;
    o.yukMod = axYukMod[i].y;
    o.higgsMod = axYukMod[i].z;
    return o;
}

/** 1PN force on observer o from a source at r = source − observer. */
fn pnFromSource(o: PNObserver, r: vec2<f32>, sVel: vec2<f32>, sMass: f32, sCharge: f32,
                sYukMod: f32, sHiggsMod: f32, relOn: bool) -> vec2<f32> {
    let gmOn = (u.toggles0 & GRAVITOMAG_BIT) != 0u;
    let coulOn = (u.toggles0 & COULOMB_BIT) != 0u;
    let yukOn = (u.toggles0 & YUKAWA_BIT) != 0u;
    let higgsOn = (u.toggles0 & HIGGS_BIT) != 0u;
    let invRSq = 1.0 / (dot(r, r) + u.softeningSq);
    let invR = sqrt(invRSq);
    let mu = select(u.yukawaMu, u.yukawaMu * sqrt(o.higgsMod * sHiggsMod), higgsOn);
    return pair1PN(r, invR, invRSq, o.vel, sVel, o.mass, sMass, o.charge, sCharge,
                   gmOn, gmOn && coulOn, yukOn, relOn,
                   mu, u.yukawaCoupling * sqrt(max(o.yukMod * sYukMod, 0.0)));
}

/** 1PN force on observer o from source j: retarded with Relativity on, else instantaneous. */
fn pnFromParticle(o: PNObserver, j: u32, relOn: bool, periodic: bool) -> vec2<f32> {
    let sp = particles[j];
    let aym = axYukMod[j];
    if (relOn) {
        let ret = retardedState(j, o.pos.x, o.pos.y, u.simTime,
                                vec2(sp.posX, sp.posY), vec2(sp.velWX, sp.velWY), sp.angW, sp.mass, sp.charge,
                                true, periodic, u.domainW, u.domainH, u.topologyMode);
        if (!ret.valid) { return vec2(0.0); }
        return pnFromSource(o, ret.rel, ret.vel, ret.mass, ret.charge, aym.y, aym.z, true);
    }
    var d = vec2(sp.posX, sp.posY) - o.pos;
    if (periodic) { d = fullMinImageP(o.pos.x, o.pos.y, sp.posX, sp.posY, u.domainW, u.domainH, u.topologyMode); }
    return pnFromSource(o, d, vec2(sp.velWX, sp.velWY), sp.mass, sp.charge, aym.y, aym.z, false);
}

fn write1PN(i: u32, f: vec2<f32>) {
    var afOut = allForces[i];
    afOut.f2.x = select(f.x, 0.0, f.x != f.x);
    afOut.f2.y = select(f.y, 0.0, f.y != f.y);
    allForces[i] = afOut;
}

@compute @workgroup_size(64)
fn compute1PN(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if ((particles[i].flags & FLAG_ALIVE) == 0u) { return; }

    let relOn = (u.toggles0 & RELATIVITY_BIT) != 0u;
    let periodic = u.boundaryMode == BOUND_LOOP;
    let o = pnObserver(i, relOn);

    var f = vec2(0.0);
    for (var j = 0u; j < u.aliveCount; j++) {
        if (j == i) { continue; }
        if ((particles[j].flags & FLAG_ALIVE) == 0u) { continue; }
        f += pnFromParticle(o, j, relOn, periodic);
    }
    write1PN(i, f);
}

@compute @workgroup_size(64)
fn compute1PNTree(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if ((particles[i].flags & FLAG_ALIVE) == 0u) { return; }
    if ((particles[i].flags & FLAG_GHOST) != 0u) { return; } // Ghosts don't receive forces

    let relOn = (u.toggles0 & RELATIVITY_BIT) != 0u;
    let periodic = u.boundaryMode == BOUND_LOOP;
    let o = pnObserver(i, relOn);
    var f = vec2(0.0);

    // Stack-based BH tree walk
    var stack: array<u32, 48>;
    var stackTop: u32 = 1u;
    stack[0] = 0u; // root

    loop {
        if (stackTop == 0u) { break; }
        stackTop -= 1u;
        let nodeIdx = stack[stackTop];

        // Ghost leaves weigh nothing (tree-build.wgsl), so they end here
        let nodeMass = getTotalMass(nodeIdx);
        if (nodeMass < EPSILON) { continue; }

        let comX = getComX(nodeIdx);
        let comY = getComY(nodeIdx);
        var d = vec2(comX, comY) - o.pos;
        if (periodic) {
            d = fullMinImageP(o.pos.x, o.pos.y, comX, comY, u.domainW, u.domainH, u.topologyMode);
        }
        let dSq = dot(d, d);
        let size = getMaxX(nodeIdx) - getMinX(nodeIdx);

        let isLeaf = getNW(nodeIdx) == NONE;
        let particleIdx = getParticleIndex(nodeIdx);

        if (isLeaf && particleIdx >= 0) {
            let sIdx = u32(particleIdx);
            if (sIdx == i) { continue; }
            // Retired particles are excluded from 1PN
            if ((particles[sIdx].flags & FLAG_ALIVE) == 0u) { continue; }
            f += pnFromParticle(o, sIdx, relOn, periodic);
        } else if (!isLeaf && (size * size < BH_THETA_SQ * dSq)) {
            // Distant node: aggregate data at its current centre of mass
            let avgW = vec2(getTotalMomX(nodeIdx), getTotalMomY(nodeIdx)) / nodeMass;
            let avgV = select(avgW, avgW * inverseSqrt(1.0 + dot(avgW, avgW)), relOn);
            f += pnFromSource(o, d, avgV, nodeMass, getTotalCharge(nodeIdx), 1.0, 1.0, relOn);
        } else if (!isLeaf) {
            // Near field: push 4 children
            if (stackTop + 4u <= MAX_STACK) {
                let nw = getNW(nodeIdx);
                let ne = getNE(nodeIdx);
                let sw = getSW(nodeIdx);
                let se = getSE(nodeIdx);
                if (nw != NONE) { stack[stackTop] = u32(nw); stackTop += 1u; }
                if (ne != NONE) { stack[stackTop] = u32(ne); stackTop += 1u; }
                if (sw != NONE) { stack[stackTop] = u32(sw); stackTop += 1u; }
                if (se != NONE) { stack[stackTop] = u32(se); stackTop += 1u; }
            }
        }
    }
    write1PN(i, f);
}

@compute @workgroup_size(64)
fn vvKick1PN(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if ((particles[i].flags & FLAG_ALIVE) == 0u) { return; }

    let halfDtOverM = u.dt * 0.5 * derived[i].invMass;
    let af1pn = allForces[i].f2;
    let newF = vec2f(af1pn.x, af1pn.y);
    let oldF = vec2f(f1pnOld[i * 2u], f1pnOld[i * 2u + 1u]);
    particles[i].velWX += (newF.x - oldF.x) * halfDtOverM;
    particles[i].velWY += (newF.y - oldF.y) * halfDtOverM;

    // NaN guard
    if (particles[i].velWX != particles[i].velWX || particles[i].velWY != particles[i].velWY) {
        particles[i].velWX = 0.0; particles[i].velWY = 0.0;
    }
}
