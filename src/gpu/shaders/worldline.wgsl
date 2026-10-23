// ─── World Lines ───
// Every particle's history: a ring of WL_LEN samples, one every WORLDLINE_DT of the
// world-line clock (lab time, or conformal time under expansion), recorded whatever the
// toggles. Samples are comoving (x/a) and carry dw/dη = a·(dw/dt − H·w): within a frame the
// universe is static and expansion.wgsl applies the Hubble drag in one step, but the world
// line's acceleration is the continuous one. Signal delay solves its light cone against it, and
// frame slicing reads it. shared-worldline.wgsl documents the layout and reads it back.
//
// Samples are on the covering plane: position, proper velocity, dw/dt and θ go through
// the slot's deck (C = A·x + b), which boundary.wgsl keeps continuous across crossings.
//
// Entry points:
//   recordWorldLines — a sample for every particle (when one is due), plus breaks
//   recordBreaks     — breaks only (every other substep)
// A break records a merge's jump: the old body extrapolated to now, then the merged body,
// both at the same time, so no segment interpolates across the jump.

@group(0) @binding(0) var<uniform> u: SimUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<ParticleState>;  // rw: clears FLAG_WL_BREAK
@group(0) @binding(2) var<storage, read> allForces: array<AllForces>;
@group(0) @binding(3) var<storage, read> clocks: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> particleAux: array<ParticleAux>;

@group(1) @binding(0) var<storage, read_write> wlData: array<f32>;
@group(1) @binding(1) var<storage, read_write> wlMeta: array<u32>;

fn deckOf(i: u32) -> vec4<f32> {
    let mb = i * WL_META_STRIDE;
    let bits = wlMeta[mb + 4u];
    return vec4(select(1.0, -1.0, (bits & 1u) != 0u), select(1.0, -1.0, (bits & 2u) != 0u),
                bitcast<f32>(wlMeta[mb + 5u]), bitcast<f32>(wlMeta[mb + 6u]));
}

/** Append one sample (12 floats, already on the cover) to slot i's ring. */
fn appendSample(i: u32, s0: vec4<f32>, s1: vec4<f32>, s2: vec4<f32>) {
    let metaBase = i * WL_META_STRIDE;
    let writeIdx = wlMeta[metaBase];
    let count = wlMeta[metaBase + 1u];
    let base = i * WL_LEN * WL_STRIDE + (writeIdx & WL_MASK) * WL_STRIDE;
    wlData[base + 0u] = s0.x;
    wlData[base + 1u] = s0.y;
    wlData[base + 2u] = s0.z;
    wlData[base + 3u] = s0.w;
    wlData[base + 4u] = s1.x;
    wlData[base + 5u] = s1.y;
    wlData[base + 6u] = s1.z;
    wlData[base + 7u] = s1.w;
    wlData[base + 8u] = s2.x;
    wlData[base + 9u] = s2.y;
    wlData[base + 10u] = s2.z;
    wlData[base + 11u] = s2.w;
    wlMeta[metaBase] = (writeIdx + 1u) & WL_MASK;
    wlMeta[metaBase + 1u] = min(count + 1u, WL_LEN);
}

/** The current state of slot i as a sample: t, x, y, wx, wy, ax, ay, τ, θ, angw, m, q. */
fn writeCurrent(i: u32) {
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
    dwdt -= u.hubble * w;
    let c = clocks[i];

    // Onto the cover, comoving; a mirror reverses θ's sense and angw's sign
    let deck = deckOf(i);
    let pos = deck.xy * vec2(p.posX, p.posY) / u.scaleA + deck.zw;
    let wc = deck.xy * w;
    let ac = deck.xy * dwdt * u.scaleA;
    let theta = atan2(deck.y * sin(c.z), deck.x * cos(c.z));
    let angw = deck.x * deck.y * p.angW;
    // A retired slot's mass is zeroed by merges and annihilation; its death mass is the last
    let retired = (p.flags & FLAG_ALIVE) == 0u;
    let m = select(p.mass, particleAux[i].deathMass, retired);

    appendSample(i, vec4(u.simTime, pos, wc.x), vec4(wc.y, ac, c.x), vec4(theta, angw, m, p.charge));
}

/** Slot i's newest sample carried by uniform motion to now: the old body at the merge. */
fn writeExtrapolatedNewest(i: u32) {
    let metaBase = i * WL_META_STRIDE;
    let count = wlMeta[metaBase + 1u];
    if (count == 0u) { return; }
    let base = i * WL_LEN * WL_STRIDE + ((wlMeta[metaBase] + WL_LEN - 1u) & WL_MASK) * WL_STRIDE;
    let dt = max(u.simTime - wlData[base], 0.0);
    let w = vec2(wlData[base + 3u], wlData[base + 4u]);
    let g = sqrt(1.0 + dot(w, w));
    let pos = vec2(wlData[base + 1u], wlData[base + 2u]) + (w / g) * dt;
    appendSample(i,
        vec4(u.simTime, pos, w.x),
        vec4(w.y, wlData[base + 5u], wlData[base + 6u], wlData[base + 7u] + u.scaleA * dt / g),
        vec4(wlData[base + 8u], wlData[base + 9u], wlData[base + 10u], wlData[base + 11u]));
}

/** Returns true when slot i still needs its regular sample. */
fn recordCommon(i: u32) -> bool {
    let flags = particles[i].flags;

    // A newly retired particle records one final sample, then FLAG_DEATH_HIST stops it
    if ((flags & FLAG_RETIRED) != 0u && (flags & FLAG_ALIVE) == 0u) {
        if ((flags & FLAG_DEATH_HIST) != 0u) { return false; }
        particles[i].flags = flags | FLAG_DEATH_HIST;
        writeCurrent(i);
        return false;
    }
    if ((flags & FLAG_ALIVE) == 0u) { return false; }

    if ((flags & FLAG_WL_BREAK) != 0u) {
        writeExtrapolatedNewest(i);
        writeCurrent(i);
        particles[i].flags = flags & ~FLAG_WL_BREAK;
        return false;
    }
    return true;
}

@compute @workgroup_size(64)
fn recordWorldLines(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if (recordCommon(i)) { writeCurrent(i); }
}

@compute @workgroup_size(64)
fn recordBreaks(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    let flags = particles[i].flags;
    if ((flags & FLAG_WL_BREAK) == 0u && (flags & FLAG_ALIVE) != 0u) { return; }
    _ = recordCommon(i);
}
