// ─── Tidal Disintegration & Roche Lobe Overflow ───
// One thread per particle. Checks tidal stress > self-gravity.
// Writes events to an append buffer for CPU-side fragment spawning.
// Roche: Eggleton (1983) L1 mass transfer.

// Constants provided by generated wgslConstants block.

// Struct definitions (ParticleState, ParticleAux, ParticleDerived) provided by shared-structs.wgsl.

struct DisintUniforms {
    softeningSq: f32,
    domainW: f32,
    domainH: f32,
    tidalStrength: f32,  // 0.3
    rocheThreshold: f32, // 0.9
    rocheTransferRate: f32, // 0.01
    minMass: f32,        // MIN_MASS
    spawnCount: u32,     // 4
    particleCount: u32,
    periodic: u32,
    topologyMode: u32,
    features: u32,
};

const DISINT_FRAGMENT: u32 = 0u;
const DISINT_TRANSFER: u32 = 1u;
const DISINT_FEATURE_BREAKUP: u32 = 1u;
const DISINT_FEATURE_EXTREMAL: u32 = 2u;

struct DisintEvent {
    particleIdx: u32,
    eventType: u32,       // 0=fragment, 1=transfer
    targetIdx: u32,       // strongest other (for transfer)
    transferMass: f32,
    spawnX: f32,          // fragment: posX, transfer: spawn posX
    spawnY: f32,          // fragment: posY, transfer: spawn posY
    spawnVX: f32,         // fragment: velWX, transfer: spawn velX
    spawnVY: f32,         // fragment: velWY, transfer: spawn velY
    mass: f32,            // parent mass
    charge: f32,          // fragment: parent charge, transfer: proportional charge
    angW: f32,            // parent angW
    radius: f32,          // fragment: parent radius, transfer: source charge after transfer
};

// Group 0: particleState + particleAux + derived (read_write for encoder compat)
@group(0) @binding(0) var<storage, read_write> particles: array<ParticleState>;
@group(0) @binding(1) var<storage, read_write> particleAux: array<ParticleAux>;
@group(0) @binding(2) var<storage, read_write> derived: array<ParticleDerived>;

@group(1) @binding(0) var<storage, read_write> events: array<DisintEvent>;
@group(1) @binding(1) var<storage, read_write> eventCounter: atomic<u32>;
@group(1) @binding(2) var<uniform> du: DisintUniforms;

@group(2) @binding(0) var<storage, read_write> pions: array<Pion>;
@group(2) @binding(1) var<storage, read_write> piCount: atomic<u32>;

@compute @workgroup_size(256)
fn checkDisintegration(@builtin(global_invocation_id) gid: vec3<u32>) {
    let pid = gid.x;
    if (pid >= du.particleCount) { return; }
    let breakupOn = (du.features & DISINT_FEATURE_BREAKUP) != 0u;
    let extremalOn = (du.features & DISINT_FEATURE_EXTREMAL) != 0u;
    if (!breakupOn && !extremalOn) { return; }

    let p = particles[pid];
    let flag = p.flags;
    if ((flag & 1u) == 0u) { return; }

    let m = p.mass;
    if (m <= du.minMass) { return; }
    let d = derived[pid];
    let bodyRSq = max(d.bodyRSq, EPSILON);

    if (extremalOn) {
        let q0 = p.charge;
        let absQ = abs(q0);
        if (absQ >= BOSON_CHARGE - EPSILON) {
            let a = INERTIA_K * bodyRSq * abs(d.angVel);
            let qLimit = sqrt(max(m * m - a * a, 0.0));
            let targetAbs = floor((qLimit + EPSILON) / BOSON_CHARGE) * BOSON_CHARGE;
            if (absQ > targetAbs + EPSILON) {
                let sign = select(-1.0, 1.0, q0 > 0.0);
                let netGapPerLepton = max(BOSON_CHARGE - ELECTRON_MASS, BOSON_CHARGE * 0.5);
                let shedUnits = min(u32(ceil((absQ - targetAbs) / netGapPerLepton)), 64u);
                var emitted: u32 = 0u;
                var seed = (pid * 2654435761u) ^ du.particleCount;
                let offset = max(particleAux[pid].radius * SPAWN_OFFSET_MUL, SPAWN_OFFSET_FLOOR);
                for (var ci = 0u; ci < 64u; ci++) {
                    if (ci >= shedUnits) { break; }
                    let li = atomicAdd(&piCount, 1u);
                    if (li >= PION_POOL_CAP) {
                        atomicSub(&piCount, 1u);
                        break;
                    }
                    seed = seed * 747796405u + 2891336453u;
                    let angle = f32(seed) / 4294967296.0 * TWO_PI;
                    let cosA = cos(angle);
                    let sinA = sin(angle);
                    let speed = min(sqrt(max(ELECTRON_MASS * 3.0 * ELECTRON_MASS, 0.0)) / max(3.0 * ELECTRON_MASS, EPSILON), MAX_SPEED_RATIO);
                    let gammaL = 1.0 / sqrt(max(1.0 - speed * speed, EPSILON));
                    var lep: Pion;
                    lep.posX = p.posX + cosA * offset;
                    lep.posY = p.posY + sinA * offset;
                    lep.wX = gammaL * speed * cosA;
                    lep.wY = gammaL * speed * sinA;
                    lep.mass = ELECTRON_MASS;
                    lep.charge = sign * BOSON_CHARGE;
                    lep.energy = 0.0;
                    lep.emitterId = particleAux[pid].particleId;
                    lep.age = 0u;
                    lep.flags = 1u;
                    lep.kind = 1u;
                    lep._pad1 = 0u;
                    pions[li] = lep;
                    emitted++;
                }

                let emittedF = f32(emitted);
                let massLoss = min(ELECTRON_MASS * emittedF, max(m - du.minMass, 0.0));
                let newMass = m - massLoss;
                var newCharge = q0 - sign * BOSON_CHARGE * emittedF;

                particles[pid].mass = newMass;
                if (m > EPSILON) {
                    particles[pid].baseMass *= newMass / m;
                }

                let newBodyRSq = pow(max(newMass, EPSILON), 2.0 / 3.0);
                let newAngVel = p.angW / sqrt(1.0 + p.angW * p.angW * newBodyRSq);
                let newA = INERTIA_K * newBodyRSq * abs(newAngVel);
                let finalTargetAbs = floor((sqrt(max(newMass * newMass - newA * newA, 0.0)) + EPSILON) / BOSON_CHARGE) * BOSON_CHARGE;
                let targetCharge = sign * finalTargetAbs;
                if (abs(newCharge) > finalTargetAbs + EPSILON) {
                    newCharge = targetCharge;
                }
                particles[pid].charge = newCharge;
                let newDisc = newMass * newMass - newA * newA - newCharge * newCharge;
                let newRadius = select(newMass, newMass + sqrt(max(0.0, newDisc)), newDisc >= 0.0);
                var nd = d;
                nd.invMass = select(0.0, 1.0 / newMass, newMass > EPSILON);
                nd.radiusSq = newRadius * newRadius;
                nd.bodyRSq = newBodyRSq;
                nd.angVel = newAngVel;
                derived[pid] = nd;
                particleAux[pid].radius = newRadius;
                return;
            }
        }
    }

    if (!breakupOn) { return; }
    if (m < du.minMass * f32(du.spawnCount)) { return; }

    let rSq = max(d.radiusSq, EPSILON);
    let r = max(particleAux[pid].radius, EPSILON);
    let selfGravity = m / rSq;
    let w = d.angVel;
    let centrifugal = w * w * r;
    let q = p.charge;
    let coulombSelf = (q * q) / (4.0 * rSq);

    // Pure centrifugal/Coulomb breakup
    if (centrifugal + coulombSelf > selfGravity) {
        let slot = atomicAdd(&eventCounter, 1u);
        if (slot < MAX_DISINT_EVENTS) {
            var evt: DisintEvent;
            evt.particleIdx = pid;
            evt.eventType = DISINT_FRAGMENT;
            evt.spawnX = p.posX;
            evt.spawnY = p.posY;
            evt.spawnVX = p.velWX;
            evt.spawnVY = p.velWY;
            evt.mass = m;
            evt.charge = q;
            evt.angW = p.angW;
            evt.radius = r;
            events[slot] = evt;
        }
        return;
    }

    // Find strongest tidal source (O(N) scan — acceptable for N < 4096)
    var maxTidal: f32 = 0.0;
    var strongestIdx: u32 = 0u;
    var strongestDx: f32 = 0.0;
    var strongestDy: f32 = 0.0;
    var strongestDist: f32 = 0.0;
    let px = p.posX;
    let py = p.posY;
    let halfDomW = du.domainW * 0.5;
    let halfDomH = du.domainH * 0.5;

    for (var oi = 0u; oi < du.particleCount; oi++) {
        if (oi == pid) { continue; }
        let op = particles[oi];
        let oflag = op.flags;
        if ((oflag & 1u) == 0u) { continue; }

        var dx = op.posX - px;
        var dy = op.posY - py;

        // Minimum image (all topologies)
        if (du.periodic != 0u) {
            if (du.topologyMode == 0u) {
                // Torus fast path
                if (dx > halfDomW) { dx -= du.domainW; }
                else if (dx < -halfDomW) { dx += du.domainW; }
                if (dy > halfDomH) { dy -= du.domainH; }
                else if (dy < -halfDomH) { dy += du.domainH; }
            } else if (du.topologyMode == 1u) {
                // Klein: y-wrap is glide reflection
                var dx0 = dx;
                if (dx0 > halfDomW) { dx0 -= du.domainW; } else if (dx0 < -halfDomW) { dx0 += du.domainW; }
                var dy0 = dy;
                if (dy0 > halfDomH) { dy0 -= du.domainH; } else if (dy0 < -halfDomH) { dy0 += du.domainH; }
                var bestSq = dx0 * dx0 + dy0 * dy0;
                dx = dx0; dy = dy0;
                let gx = du.domainW - op.posX;
                var dx1 = gx - px;
                if (dx1 > halfDomW) { dx1 -= du.domainW; } else if (dx1 < -halfDomW) { dx1 += du.domainW; }
                var dy1 = (op.posY + du.domainH) - py;
                if (dy1 > du.domainH) { dy1 -= 2.0 * du.domainH; } else if (dy1 < -du.domainH) { dy1 += 2.0 * du.domainH; }
                let dSq1 = dx1 * dx1 + dy1 * dy1;
                if (dSq1 < bestSq) { dx = dx1; dy = dy1; bestSq = dSq1; }
                var dy1b = (op.posY - du.domainH) - py;
                if (dy1b > du.domainH) { dy1b -= 2.0 * du.domainH; } else if (dy1b < -du.domainH) { dy1b += 2.0 * du.domainH; }
                let dSq1b = dx1 * dx1 + dy1b * dy1b;
                if (dSq1b < bestSq) { dx = dx1; dy = dy1b; }
            } else {
                // RP²: both axes carry glide reflections
                // Candidate 0: direct torus wrap
                var dx0r = dx;
                if (dx0r > halfDomW) { dx0r -= du.domainW; } else if (dx0r < -halfDomW) { dx0r += du.domainW; }
                var dy0r = dy;
                if (dy0r > halfDomH) { dy0r -= du.domainH; } else if (dy0r < -halfDomH) { dy0r += du.domainH; }
                var bestSqR = dx0r * dx0r + dy0r * dy0r;
                dx = dx0r; dy = dy0r;

                // Candidate 1: y-glide reflection (x,y) ~ (W-x, y+H)
                let gxR = du.domainW - op.posX;
                var dxG = gxR - px;
                if (dxG > halfDomW) { dxG -= du.domainW; } else if (dxG < -halfDomW) { dxG += du.domainW; }
                var dyG = (op.posY + du.domainH) - py;
                if (dyG > du.domainH) { dyG -= 2.0 * du.domainH; } else if (dyG < -du.domainH) { dyG += 2.0 * du.domainH; }
                let dSqG = dxG * dxG + dyG * dyG;
                if (dSqG < bestSqR) { dx = dxG; dy = dyG; bestSqR = dSqG; }

                // Candidate 2: x-glide reflection (x,y) ~ (x+W, H-y)
                let gyR = du.domainH - op.posY;
                var dxH = (op.posX + du.domainW) - px;
                if (dxH > du.domainW) { dxH -= 2.0 * du.domainW; } else if (dxH < -du.domainW) { dxH += 2.0 * du.domainW; }
                var dyH = gyR - py;
                if (dyH > halfDomH) { dyH -= du.domainH; } else if (dyH < -halfDomH) { dyH += du.domainH; }
                let dSqH = dxH * dxH + dyH * dyH;
                if (dSqH < bestSqR) { dx = dxH; dy = dyH; bestSqR = dSqH; }

                // Candidate 3: combined double glide (x,y) ~ (W-x+W, H-y+H)
                var dxC = (du.domainW - op.posX + du.domainW) - px;
                if (dxC > du.domainW) { dxC -= 2.0 * du.domainW; } else if (dxC < -du.domainW) { dxC += 2.0 * du.domainW; }
                var dyC = (du.domainH - op.posY + du.domainH) - py;
                if (dyC > du.domainH) { dyC -= 2.0 * du.domainH; } else if (dyC < -du.domainH) { dyC += 2.0 * du.domainH; }
                let dSqC = dxC * dxC + dyC * dyC;
                if (dSqC < bestSqR) { dx = dxC; dy = dyC; }
            }
        }

        let distSq = dx * dx + dy * dy + du.softeningSq;
        let invDistSq = 1.0 / distSq;
        let tidalAccel = du.tidalStrength * op.mass * r * sqrt(invDistSq) * invDistSq;

        if (tidalAccel > maxTidal) {
            maxTidal = tidalAccel;
            strongestIdx = oi;
            strongestDx = dx;
            strongestDy = dy;
            strongestDist = sqrt(max(0.0, distSq - du.softeningSq));
        }
    }

    // Tidal breakup
    if (maxTidal + centrifugal + coulombSelf > selfGravity) {
        let slot = atomicAdd(&eventCounter, 1u);
        if (slot < MAX_DISINT_EVENTS) {
            var evt: DisintEvent;
            evt.particleIdx = pid;
            evt.eventType = DISINT_FRAGMENT;
            evt.spawnX = p.posX;
            evt.spawnY = p.posY;
            evt.spawnVX = p.velWX;
            evt.spawnVY = p.velWY;
            evt.mass = m;
            evt.charge = q;
            evt.angW = p.angW;
            evt.radius = r;
            events[slot] = evt;
        }
        return;
    }

    // Roche lobe overflow (Eggleton 1983)
    if (strongestDist > EPSILON && m > du.minMass * 4.0) {
        let rocheDist = strongestDist;
        let oMass = particles[strongestIdx].mass;
        let qRatio = m / (m + oMass);
        let q13 = pow(qRatio, 1.0 / 3.0);
        let q23 = q13 * q13;
        let rRoche = rocheDist * 0.49 * q23 / (0.6 * q23 + log(1.0 + q13));

        if (r > rRoche * du.rocheThreshold) {
            let l1Mag = sqrt(strongestDx * strongestDx + strongestDy * strongestDy);
            if (l1Mag > EPSILON) {
                let l1x = strongestDx / l1Mag;
                let l1y = strongestDy / l1Mag;
                let overflow = r / rRoche - du.rocheThreshold;
                let dM = min(overflow * du.rocheTransferRate * m, m * 0.1);

                if (dM >= du.minMass) {
                    let slot = atomicAdd(&eventCounter, 1u);
                    if (slot < MAX_DISINT_EVENTS) {
                        var evt: DisintEvent;
                        evt.particleIdx = pid;
                        evt.eventType = DISINT_TRANSFER;
                        evt.targetIdx = strongestIdx;
                        evt.transferMass = dM;
                        evt.spawnX = px + l1x * r * 1.2;
                        evt.spawnY = py + l1y * r * 1.2;
                        let escapeV = sqrt(oMass / max(rocheDist, EPSILON));
                        evt.spawnVX = p.velWX + (-l1y) * escapeV * 0.5;
                        evt.spawnVY = p.velWY + l1x * escapeV * 0.5;
                        evt.mass = m;
                        let dq = round(dM * q / (m * BOSON_CHARGE)) * BOSON_CHARGE;  // quantized charge transfer
                        evt.charge = dq;
                        evt.radius = q - dq;
                        events[slot] = evt;
                    }
                }
            }
        }
    }
}
