// ─── Pair Production ───
// Photon → particle-antiparticle pair near massive bodies.
// One thread per photon. Writes spawn events to append buffer.

struct PairProdUniforms {
    minEnergy: f32,       // 0.5
    proximity: f32,       // 8.0
    probability: f32,     // 0.005
    minAge: u32,          // 64
    maxParticles: u32,    // 32
    currentParticleCount: u32,
    photonCount: u32,
    blackHoleEnabled: u32,
    simTime: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

struct PairEvent {
    photonIdx: u32,
    nearestParticleIdx: u32,
    photonEnergy: f32,
    photonPosX: f32,
    photonPosY: f32,
    photonVelX: f32,
    photonVelY: f32,
    _pad: f32,
};

@group(0) @binding(0) var<storage, read> photonPosX: array<f32>;
@group(0) @binding(1) var<storage, read> photonPosY: array<f32>;
@group(0) @binding(2) var<storage, read> photonEnergy: array<f32>;
@group(0) @binding(3) var<storage, read> photonVelX: array<f32>;
@group(0) @binding(4) var<storage, read> photonVelY: array<f32>;
@group(0) @binding(5) var<storage, read> photonAge: array<u32>;
@group(0) @binding(6) var<storage, read> photonAlive: array<u32>;

@group(1) @binding(0) var<storage, read> particlePosX: array<f32>;
@group(1) @binding(1) var<storage, read> particlePosY: array<f32>;
@group(1) @binding(2) var<storage, read> particleMass: array<f32>;
@group(1) @binding(3) var<storage, read> particleFlags: array<u32>;

@group(2) @binding(0) var<storage, read_write> pairEvents: array<PairEvent>;
@group(2) @binding(1) var<storage, read_write> pairCounter: atomic<u32>;
@group(2) @binding(2) var<uniform> pu: PairProdUniforms;

// Simple hash-based PRNG (per-thread deterministic from photon index + simTime)
fn pcgHash(input: u32) -> u32 {
    var state = input * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn randomFloat(seed: u32) -> f32 {
    return f32(pcgHash(seed)) / 4294967296.0;
}

const MAX_PAIR_EVENTS: u32 = 32u;

@compute @workgroup_size(256)
fn checkPairProduction(@builtin(global_invocation_id) gid: vec3<u32>) {
    let phIdx = gid.x;
    if (phIdx >= pu.photonCount) { return; }
    if (pu.blackHoleEnabled != 0u) { return; }
    if (photonAlive[phIdx] == 0u) { return; }
    if (photonEnergy[phIdx] < pu.minEnergy) { return; }
    if (photonAge[phIdx] < pu.minAge) { return; }
    if (pu.currentParticleCount >= pu.maxParticles) { return; }

    // Check probability
    let seed = phIdx * 12345u + bitcast<u32>(pu.simTime);
    if (randomFloat(seed) > pu.probability) { return; }

    // Find nearest massive body within proximity
    let phX = photonPosX[phIdx];
    let phY = photonPosY[phIdx];
    let proxSq = pu.proximity * pu.proximity;
    var minDistSq: f32 = proxSq;
    var nearestIdx: u32 = 0xFFFFFFFFu;

    for (var i = 0u; i < pu.currentParticleCount; i++) {
        let pflag = particleFlags[i];
        if ((pflag & 1u) == 0u) { continue; }
        if (particleMass[i] < 1e-9) { continue; }

        let dx = particlePosX[i] - phX;
        let dy = particlePosY[i] - phY;
        let dSq = dx * dx + dy * dy;
        if (dSq < minDistSq) {
            minDistSq = dSq;
            nearestIdx = i;
        }
    }

    if (nearestIdx == 0xFFFFFFFFu) { return; }

    // Write pair production event
    let slot = atomicAdd(&pairCounter, 1u);
    if (slot < MAX_PAIR_EVENTS) {
        var evt: PairEvent;
        evt.photonIdx = phIdx;
        evt.nearestParticleIdx = nearestIdx;
        evt.photonEnergy = photonEnergy[phIdx];
        evt.photonPosX = phX;
        evt.photonPosY = phY;
        evt.photonVelX = photonVelX[phIdx];
        evt.photonVelY = photonVelY[phIdx];
        pairEvents[slot] = evt;
    }
}
