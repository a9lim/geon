// ─── Dead Particle Garbage Collection ───
// Transitions RETIRED particles to FREE when their signal delay history expires.
// Runs once per frame (not per substep).

const FLAG_ALIVE:   u32 = 1u;
const FLAG_RETIRED: u32 = 2u;

struct SimUniforms {
    dt: f32,
    simTime: f32,
    domainW: f32,
    domainH: f32,
    speedScale: f32,
    softening: f32,
    softeningSq: f32,
    toggles0: u32,
    toggles1: u32,
    yukawaCoupling: f32,
    yukawaMu: f32,
    higgsMass: f32,
    axionMass: f32,
    extGravX: f32,
    extGravY: f32,
    extElecX: f32,
    extElecY: f32,
    extBz: f32,
    boundaryMode: u32,
    topologyMode: u32,
    collisionMode: u32,
    aliveCount: u32,
    bhTheta: f32,
    totalCount: u32,
};

@group(0) @binding(0) var<storage, read_write> flags_buf: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read> deathTime_buf: array<f32>;
@group(0) @binding(2) var<uniform> uniforms: SimUniforms;
@group(0) @binding(3) var<storage, read_write> freeStack: array<u32>;
@group(0) @binding(4) var<storage, read_write> freeTop: atomic<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    // Scan all particle slots (not just alive count — retired particles may be anywhere)
    let maxSlots = uniforms.aliveCount; // Conservative: retired particles are within original alive range
    if (idx >= maxSlots) { return; }

    let f = atomicLoad(&flags_buf[idx]);

    // Only process RETIRED particles (not alive, not already free)
    if ((f & FLAG_RETIRED) == 0u) { return; }
    if ((f & FLAG_ALIVE) != 0u) { return; }

    let dt = deathTime_buf[idx];
    let domainDiag = sqrt(uniforms.domainW * uniforms.domainW + uniforms.domainH * uniforms.domainH);
    let expiry = 2.0 * domainDiag;

    if (uniforms.simTime - dt > expiry) {
        // Transition to FREE: clear all flags
        atomicStore(&flags_buf[idx], 0u);

        // Push slot to free stack
        let slot = atomicAdd(&freeTop, 1u);
        freeStack[slot] = idx;
    }
}
