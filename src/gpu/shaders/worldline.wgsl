// ─── World Lines ───
// Every particle's history: a ring of WL_LEN samples, one every WORLDLINE_DT of lab
// time, recorded whatever the toggles. Signal delay solves its light cone against it;
// frame slicing (M2) will too.
//
// Sample layout, WL_STRIDE = 12 f32:
//   [0] t  [1] x  [2] y  [3] wx  [4] wy  [5] ax  [6] ay  [7] τ  [8] θ  [9] angw  [10] m  [11] q
// (w = proper velocity, a = dw/dt including the Boris magnetic and gravitomagnetic
// rotation, τ = proper time, θ = spoke orientation.)
// Meta, WL_META_STRIDE = 4 u32: writeIdx, count, creationTime (f32 bits), _pad.

@group(0) @binding(0) var<uniform> u: SimUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<ParticleState>;  // rw: clears FLAG_REBORN
@group(0) @binding(2) var<storage, read> allForces: array<AllForces>;
@group(0) @binding(3) var<storage, read> clocks: array<vec4<f32>>;

@group(1) @binding(0) var<storage, read_write> wlData: array<f32>;
@group(1) @binding(1) var<storage, read_write> wlMeta: array<u32>;

fn writeSample(i: u32) {
    let metaBase = i * WL_META_STRIDE;
    let writeIdx = wlMeta[metaBase];
    let count = wlMeta[metaBase + 1u];
    let base = i * WL_LEN * WL_STRIDE + (writeIdx & WL_MASK) * WL_STRIDE;

    let p = particles[i];
    let af = allForces[i];
    let w = vec2<f32>(p.velWX, p.velWY);
    let relOn = (u.toggles0 & RELATIVITY_BIT) != 0u;
    let v = w / select(1.0, gammaFromW(w), relOn);
    var dwdt = af.totalForce;
    let rot = vec2<f32>(v.y, -v.x); // v × ẑ
    if ((u.toggles0 & MAGNETIC_BIT) != 0u || u.extBz != 0.0) { dwdt += p.charge * af.bFields.x * rot; }
    if ((u.toggles0 & GRAVITOMAG_BIT) != 0u) { dwdt += 4.0 * p.mass * af.bFields.y * rot; }
    dwdt /= max(p.mass, EPSILON);
    let c = clocks[i];

    wlData[base + 0u] = u.simTime;
    wlData[base + 1u] = p.posX;
    wlData[base + 2u] = p.posY;
    wlData[base + 3u] = w.x;
    wlData[base + 4u] = w.y;
    wlData[base + 5u] = dwdt.x;
    wlData[base + 6u] = dwdt.y;
    wlData[base + 7u] = c.x;
    wlData[base + 8u] = c.z;
    wlData[base + 9u] = p.angW;
    wlData[base + 10u] = p.mass;
    wlData[base + 11u] = p.charge;

    wlMeta[metaBase] = (writeIdx + 1u) & WL_MASK;
    wlMeta[metaBase + 1u] = min(count + 1u, WL_LEN);
}

@compute @workgroup_size(64)
fn recordWorldLines(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    let flags = particles[i].flags;

    // A newly retired particle records one final sample, then FLAG_DEATH_HIST stops it
    if ((flags & FLAG_RETIRED) != 0u && (flags & FLAG_ALIVE) == 0u) {
        if ((flags & FLAG_DEATH_HIST) != 0u) { return; }
        particles[i].flags = flags | FLAG_DEATH_HIST;
        writeSample(i);
        return;
    }
    if ((flags & FLAG_ALIVE) == 0u) { return; }

    // A merge product reborn in a recycled slot starts a fresh world line
    if ((flags & FLAG_REBORN) != 0u) {
        let metaBase = i * WL_META_STRIDE;
        wlMeta[metaBase] = 0u;
        wlMeta[metaBase + 1u] = 0u;
        wlMeta[metaBase + 2u] = bitcast<u32>(u.simTime);
        wlMeta[metaBase + 3u] = 0u;
        particles[i].flags = flags & ~FLAG_REBORN;
    }
    writeSample(i);
}
