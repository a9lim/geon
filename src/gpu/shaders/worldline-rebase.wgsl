// ─── World-line epoch rebase ───
// GPU times are f32 relative to a rolling epoch (config.js EPOCH_SPAN, EPOCH_STEP). When the
// epoch advances by `shift`, every stored time moves back by it: world-line samples, creation
// times, and ParticleAux death times (the alive sentinel and −∞ are unchanged by it). Each
// world line is also mapped by the inverse of its deck, so the deck returns to the identity
// and covering-plane coordinates stay near the domain: C′ = A(C − b), with w, dw/dt mirrored
// by A, θ reflected, and angw negated under an odd number of mirrors.

struct RebaseUniforms {
    shift: f32,
    slots: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<uniform> ru: RebaseUniforms;
@group(0) @binding(1) var<storage, read_write> wlData: array<f32>;
@group(0) @binding(2) var<storage, read_write> wlMeta: array<u32>;
@group(0) @binding(3) var<storage, read_write> particleAux: array<ParticleAux>;

@compute @workgroup_size(64)
fn rebaseWorldLines(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= ru.slots) { return; }

    let mb = i * WL_META_STRIDE;
    let bits = wlMeta[mb + 4u];
    let A = vec2(select(1.0, -1.0, (bits & 1u) != 0u), select(1.0, -1.0, (bits & 2u) != 0u));
    let b = vec2(bitcast<f32>(wlMeta[mb + 5u]), bitcast<f32>(wlMeta[mb + 6u]));
    let det = A.x * A.y;

    let count = wlMeta[mb + 1u];
    let start = (wlMeta[mb] + WL_LEN - count) & WL_MASK;
    for (var k = 0u; k < count; k++) {
        let base = i * WL_LEN * WL_STRIDE + ((start + k) & WL_MASK) * WL_STRIDE;
        wlData[base] -= ru.shift;
        let pos = A * (vec2(wlData[base + 1u], wlData[base + 2u]) - b);
        wlData[base + 1u] = pos.x;
        wlData[base + 2u] = pos.y;
        wlData[base + 3u] *= A.x;
        wlData[base + 4u] *= A.y;
        wlData[base + 5u] *= A.x;
        wlData[base + 6u] *= A.y;
        let th = wlData[base + 8u];
        wlData[base + 8u] = atan2(A.y * sin(th), A.x * cos(th));
        wlData[base + 9u] *= det;
    }

    wlMeta[mb + 2u] = bitcast<u32>(bitcast<f32>(wlMeta[mb + 2u]) - ru.shift);
    wlMeta[mb + 4u] = 0u;
    wlMeta[mb + 5u] = 0u;
    wlMeta[mb + 6u] = 0u;
    particleAux[i].deathTime -= ru.shift;
}
