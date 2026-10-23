// ─── Boson pools in the energy ledger ───
// The pools are particles too: their energy and momentum count toward the totals, and the
// pool culls (which only bound memory) hand what they remove to an escaped-radiation
// account instead of deleting it.
//
// Entry points:
//   cullBosons   — once per frame: photons past PHOTON_CULL_AGE and leptons past
//                  LEPTON_CULL_AGE leave the pools; their energy and momentum are added to
//                  cosmoAccum[1..3] (f32 bits, by compare-and-swap), which the stats
//                  readback collects and clears
//   statsBosons  — with the stats: pool totals into stats[20..25]: photon E, px, py; pion
//                  and lepton E = m√(1 + w²), px, py; and stats[27], the radiation the
//                  bodies have lost but not yet emitted (RadiationState accumulators)

@group(0) @binding(0) var<storage, read_write> photons: array<Photon>;
@group(0) @binding(1) var<storage, read_write> pions: array<Pion>;
@group(0) @binding(2) var<storage, read_write> cosmoAccum: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> stats: array<f32>;
// The pools' high-water marks: entries past them are stale (a reset only zeroes the counts)
@group(0) @binding(4) var<storage, read_write> phCount: atomic<u32>;
@group(0) @binding(5) var<storage, read_write> piCount: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> particles: array<ParticleState>;
@group(0) @binding(7) var<storage, read_write> radState: array<RadiationState>;

const LEDGER_WG: u32 = 64u;
var<workgroup> wgSum: array<vec3<f32>, LEDGER_WG>;

fn atomicAddF32(slot: u32, v: f32) {
    if (v == 0.0) { return; }
    var old = atomicLoad(&cosmoAccum[slot]);
    loop {
        let res = atomicCompareExchangeWeak(&cosmoAccum[slot], old, bitcast<u32>(bitcast<f32>(old) + v));
        if (res.exchanged) { break; }
        old = res.old_value;
    }
}

/** Sum v over the workgroup into wgSum[0]. Every invocation must call it. */
fn reduce3(lid: u32, v: vec3<f32>) -> vec3<f32> {
    wgSum[lid] = v;
    workgroupBarrier();
    for (var s = LEDGER_WG / 2u; s > 0u; s >>= 1u) {
        if (lid < s) { wgSum[lid] += wgSum[lid + s]; }
        workgroupBarrier();
    }
    let total = wgSum[0];
    workgroupBarrier();
    return total;
}

@compute @workgroup_size(LEDGER_WG)
fn cullBosons(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
    let i = gid.x;
    var gone = vec3(0.0);
    if (i < min(atomicLoad(&phCount), arrayLength(&photons))) {
        var ph = photons[i];
        if ((ph.flags & 1u) != 0u && ph.lifetime > PHOTON_CULL_AGE) {
            ph.flags &= ~1u;
            photons[i] = ph;
            gone += ph.energy * vec3(1.0, ph.velX, ph.velY);
        }
    }
    if (i < min(atomicLoad(&piCount), arrayLength(&pions))) {
        var pi = pions[i];
        if ((pi.flags & 1u) != 0u && pi.kind == 1u && pi.energy > LEPTON_CULL_AGE) {
            pi.flags &= ~1u;
            pions[i] = pi;
            let w = vec2(pi.wX, pi.wY);
            gone += pi.mass * vec3(sqrt(1.0 + dot(w, w)), w);
        }
    }
    let total = reduce3(lid, gone);
    if (lid == 0u) {
        atomicAddF32(1u, total.x);
        atomicAddF32(2u, total.y);
        atomicAddF32(3u, total.z);
    }
}

@compute @workgroup_size(LEDGER_WG)
fn statsBosons(@builtin(local_invocation_index) lid: u32) {
    var ph = vec3(0.0);
    var pi = vec3(0.0);
    let nPh = min(atomicLoad(&phCount), arrayLength(&photons));
    let nPi = min(atomicLoad(&piCount), arrayLength(&pions));
    for (var i = lid; i < nPh; i += LEDGER_WG) {
        let p = photons[i];
        if ((p.flags & 1u) != 0u) { ph += p.energy * vec3(1.0, p.velX, p.velY); }
    }
    for (var i = lid; i < nPi; i += LEDGER_WG) {
        let p = pions[i];
        if ((p.flags & 1u) != 0u) {
            let w = vec2(p.wX, p.wY);
            pi += p.mass * vec3(sqrt(1.0 + dot(w, w)), w);
        }
    }
    // Energy taken from bodies and waiting for a whole boson: Larmor, Hawking (rest frame),
    // pion emission, and both quadrupole channels
    var pending = 0.0;
    for (var i = lid; i < min(arrayLength(&particles), arrayLength(&radState)); i += LEDGER_WG) {
        if ((particles[i].flags & FLAG_ALIVE) == 0u) { continue; }
        let r = radState[i];
        pending += r.radAccum + r.hawkAccum + r.yukawaRadAccum + r.quadAccum + r.emQuadAccum;
    }
    let phTotal = reduce3(lid, ph);
    let piTotal = reduce3(lid, pi);
    let pendTotal = reduce3(lid, vec3(pending, 0.0, 0.0));
    if (lid == 0u) {
        stats[27] = pendTotal.x;
        stats[20] = phTotal.x;
        stats[21] = phTotal.y;
        stats[22] = phTotal.z;
        stats[23] = piTotal.x;
        stats[24] = piTotal.y;
        stats[25] = piTotal.z;
    }
}
