// ── Shared PCG hash RNG ──
// High-quality hash-based PRNG for GPU shaders.
// Usage: pcgRand(seed) returns f32 in [0, 1).

fn pcgHash(seed: u32) -> u32 {
    var state = seed * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn pcgRand(seed: u32) -> f32 {
    return f32(pcgHash(seed)) / 4294967296.0;
}
