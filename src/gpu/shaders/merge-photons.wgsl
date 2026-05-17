// Emits momentum-conserving photon pairs from matter/antimatter merge events.

const MERGE_ANNIHILATION: u32 = 0u;

struct MergeResult {
    p0: vec4<f32>, // x, y, energy, type
    p1: vec4<f32>, // px, py, pad, pad
};

@group(0) @binding(0) var<storage, read> mergeResults: array<MergeResult>;
@group(0) @binding(1) var<storage, read> mergeCounter: array<u32>;
@group(0) @binding(2) var<storage, read_write> photons: array<Photon>;
@group(0) @binding(3) var<storage, read_write> phCount: atomic<u32>;

fn appendPhoton(x: f32, y: f32, dirX: f32, dirY: f32, energy: f32) {
    let phIdx = atomicAdd(&phCount, 1u);
    if (phIdx < MAX_PHOTONS) {
        var ph: Photon;
        ph.posX = x + dirX * SPAWN_OFFSET_FLOOR;
        ph.posY = y + dirY * SPAWN_OFFSET_FLOOR;
        ph.velX = dirX;
        ph.velY = dirY;
        ph.energy = energy;
        ph.emitterId = 0xFFFFFFFFu;
        ph.lifetime = 0.0;
        ph.flags = 1u;
        photons[phIdx] = ph;
    } else {
        atomicSub(&phCount, 1u);
    }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= min(mergeCounter[0], MAX_PARTICLES)) { return; }

    let ev = mergeResults[i];
    if (u32(ev.p0.w + 0.5) != MERGE_ANNIHILATION) { return; }

    let energy = ev.p0.z;
    if (energy <= EPSILON) { return; }

    var betaX = ev.p1.x / energy;
    var betaY = ev.p1.y / energy;
    var betaSq = betaX * betaX + betaY * betaY;
    if (betaSq > 1.0) {
        let invBeta = inverseSqrt(betaSq);
        betaX *= invBeta;
        betaY *= invBeta;
        betaSq = 1.0;
    }

    var perpX: f32;
    var perpY: f32;
    if (betaSq > EPSILON) {
        let invBeta = inverseSqrt(betaSq);
        perpX = -betaY * invBeta;
        perpY = betaX * invBeta;
    } else {
        let angle = pcgRand((i + 1u) * 747796405u) * TWO_PI;
        perpX = cos(angle);
        perpY = sin(angle);
    }

    let spread = sqrt(max(0.0, 1.0 - betaSq));
    let ePh = 0.5 * energy;
    appendPhoton(ev.p0.x, ev.p0.y, betaX + spread * perpX, betaY + spread * perpY, ePh);
    appendPhoton(ev.p0.x, ev.p0.y, betaX - spread * perpX, betaY - spread * perpY, ePh);
}
