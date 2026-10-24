// update-colors.wgsl — Recompute each body's packed RGBA ink from its charge.
//
// The ink reads the sign of the charge, at full strength for any nonzero charge: sienna
// for positive, prussian for negative, graphite when neutral. |q| is read off the Particle
// tab, not the ink. particle.wgsl draws the sign as a mark as well, so it survives in grey,
// and draws antimatter hollow. In black-hole mode every body is a horizon: its ink (used by
// its world line) is the text colour, and particle.wgsl fills the disk with the void.

// Struct definition (ParticleState) provided by shared-structs.wgsl.

struct ColorUniforms {
    blackHoleEnabled: u32,
    isDarkMode: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<uniform> params: ColorUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<ParticleState>;
@group(0) @binding(2) var<storage, read_write> color: array<u32>;

// Constants (FLAG_ALIVE, FLAG_ANTIMATTER, BOSON_CHARGE, the INK_* pairs)
// provided by generated wgslConstants block.

fn packRGBA(c: vec3<f32>, a: f32) -> u32 {
    let q = vec4<u32>(clamp(vec4(c, a) * 255.0, vec4(0.0), vec4(255.0)));
    return q.x | (q.y << 8u) | (q.z << 16u) | (q.w << 24u);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= arrayLength(&particles)) { return; }
    var p = particles[idx];
    if ((p.flags & FLAG_ALIVE) == 0u) { return; }

    // BH no-hair: strip antimatter flag
    let isBH = (params.blackHoleEnabled != 0u);
    if (isBH && (p.flags & FLAG_ANTIMATTER) != 0u) {
        p.flags = p.flags & ~FLAG_ANTIMATTER;
        particles[idx].flags = p.flags;
    }

    let dk = params.isDarkMode != 0u;
    var ink = select(INK_GRAPHITE_L, INK_GRAPHITE_D, dk);
    if (p.charge > 0.5 * BOSON_CHARGE) { ink = select(INK_SIENNA_L, INK_SIENNA_D, dk); }
    else if (p.charge < -0.5 * BOSON_CHARGE) { ink = select(INK_PRUSSIAN_L, INK_PRUSSIAN_D, dk); }
    if (isBH) { ink = select(COLOR_TEXT_LIGHT, COLOR_TEXT_DARK, dk); }
    color[idx] = packRGBA(ink, 1.0);
}
