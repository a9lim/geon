// Save current 1PN forces from allForces.f2.xy into f1pnOld buffer.
// Must run AFTER force computation and BEFORE boris half-kick.
// This matches the CPU's `p._f1pnOld.x = p.force1PN.x` step.

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read_write> allForces: array<AllForces>;
@group(0) @binding(2) var<storage, read_write> f1pnOld: array<f32>;
@group(0) @binding(3) var<storage, read_write> flags: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= uniforms.aliveCount) { return; }
    if ((flags[idx] & FLAG_ALIVE) == 0u) { return; }

    let f1pn = allForces[idx].f2;
    f1pnOld[idx * 2u] = f1pn.x;
    f1pnOld[idx * 2u + 1u] = f1pn.y;
}
