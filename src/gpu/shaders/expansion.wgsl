// ─── Cosmological expansion ───
// Once per frame (cosmology.js has the model): the periodic domain grows from a to a·r,
// every position scales by r about the domain's corner, and every peculiar momentum by 1/r.
// On a torus, Klein bottle or RP² the scaling is homogeneous, with no centre, and it is
// the comoving dynamics exactly. Massive bodies keep a·w (peculiar momentum ∝ 1/a holds at
// any speed), photons redshift (E ∝ 1/a), and trails and retired bodies' death positions
// scale with everything else. Field grids are comoving already and don't move.
//
// The kinetic and radiation energy the expansion removes is summed into cosmoAccum[0]
// (f32 bits, added by compare-and-swap) for the energy ledger.
//
// Entry points: expandParticles, expandPhotons, expandPions, expandTrails.

struct ExpansionUniforms {
    ratio: f32,          // a_new / a_old
    relativity: u32,
    particleCount: u32,  // slots to scan (high-water mark)
    photonCount: u32,
    pionCount: u32,
    trailCount: u32,     // trail entries to scale: particleCount × trail length
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<uniform> eu: ExpansionUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<ParticleState>;
@group(0) @binding(2) var<storage, read_write> photons: array<Photon>;
@group(0) @binding(3) var<storage, read_write> pions: array<Pion>;
@group(0) @binding(4) var<storage, read_write> trailX: array<f32>;
@group(0) @binding(5) var<storage, read_write> trailY: array<f32>;
@group(0) @binding(6) var<storage, read_write> cosmoAccum: array<atomic<u32>>;
// The pools' high-water marks: entries past them are stale
@group(0) @binding(7) var<storage, read_write> phCount: atomic<u32>;
@group(0) @binding(8) var<storage, read_write> piCount: atomic<u32>;

var<workgroup> wgWork: array<f32, 64>;

/** Sum v over the workgroup and add it to cosmoAccum[0]. Every invocation must call it. */
fn accumulateWork(lid: u32, v: f32) {
    wgWork[lid] = v;
    workgroupBarrier();
    for (var s = 32u; s > 0u; s >>= 1u) {
        if (lid < s) { wgWork[lid] += wgWork[lid + s]; }
        workgroupBarrier();
    }
    if (lid == 0u && wgWork[0] != 0.0) {
        let add = wgWork[0];
        var old = atomicLoad(&cosmoAccum[0]);
        loop {
            let res = atomicCompareExchangeWeak(&cosmoAccum[0], old, bitcast<u32>(bitcast<f32>(old) + add));
            if (res.exchanged) { break; }
            old = res.old_value;
        }
    }
}

fn kinetic(m: f32, w: vec2<f32>) -> f32 {
    let w2 = dot(w, w);
    if (eu.relativity != 0u) { return m * w2 / (sqrt(1.0 + w2) + 1.0); }   // m(γ − 1)
    return 0.5 * m * w2;
}

@compute @workgroup_size(64)
fn expandParticles(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
    let i = gid.x;
    var work = 0.0;
    if (i < eu.particleCount) {
        var p = particles[i];
        let alive = (p.flags & FLAG_ALIVE) != 0u;
        if (alive || (p.flags & FLAG_RETIRED) != 0u) {
            p.posX *= eu.ratio;
            p.posY *= eu.ratio;
            if (alive) {
                let w0 = vec2(p.velWX, p.velWY);
                let w1 = w0 / eu.ratio;
                work = kinetic(p.mass, w0) - kinetic(p.mass, w1);
                p.velWX = w1.x;
                p.velWY = w1.y;
            }
            particles[i] = p;
        }
    }
    accumulateWork(lid, work);
}

@compute @workgroup_size(64)
fn expandPhotons(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
    let i = gid.x;
    var work = 0.0;
    if (i < min(eu.photonCount, atomicLoad(&phCount))) {
        var ph = photons[i];
        if ((ph.flags & 1u) != 0u) {
            ph.posX *= eu.ratio;
            ph.posY *= eu.ratio;
            let e1 = ph.energy / eu.ratio;
            work = ph.energy - e1;
            ph.energy = e1;
            photons[i] = ph;
        }
    }
    accumulateWork(lid, work);
}

@compute @workgroup_size(64)
fn expandPions(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
    let i = gid.x;
    var work = 0.0;
    if (i < min(eu.pionCount, atomicLoad(&piCount))) {
        var pi = pions[i];
        if ((pi.flags & 1u) != 0u) {
            pi.posX *= eu.ratio;
            pi.posY *= eu.ratio;
            let w0 = vec2(pi.wX, pi.wY);
            let w1 = w0 / eu.ratio;
            work = kinetic(pi.mass, w0) - kinetic(pi.mass, w1);
            pi.wX = w1.x;
            pi.wY = w1.y;
            // A pion's energy budget pays for the kinetic loss; a lepton's field is its age
            if (pi.kind == 0u) { pi.energy = max(pi.energy - work, pi.mass); }
            pions[i] = pi;
        }
    }
    accumulateWork(lid, work);
}

@compute @workgroup_size(64)
fn expandTrails(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= eu.trailCount) { return; }
    trailX[i] *= eu.ratio;
    trailY[i] *= eu.ratio;
}
