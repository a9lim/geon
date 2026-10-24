// ─── Radiation Reaction Shaders ───
// Four entry points:
//   larmorRadiation — Landau-Lifshitz Larmor radiation (requires Coulomb + Radiation)
//   hawkingRadiation — Kerr-Newman BH evaporation on the hole's clock (requires Black Hole + Radiation)
//   pionEmission — Scalar Larmor pion emission (requires Yukawa + Radiation)
//   schwingerDischarge — Vacuum e+e- pair production (requires Black Hole + Coulomb)
//
// All kernels accumulate energy into per-particle accumulators and emit
// photons/pions via atomic append to boson pool buffers.
//
// Prepended with: wgslConstants + shared-structs.wgsl
// Shared structs (ParticleState, ParticleAux, ParticleDerived, AllForces,
// RadiationState, Photon, Pion) provided by shared-structs.wgsl.

// pcgHash/pcgRand from shared-rng.wgsl (prepended)

// Uses SimUniforms from shared-structs.wgsl (prepended).
@group(0) @binding(0) var<uniform> u: SimUniforms;

// Group 1: packed particle data (read_write for encoder compat on shared buffers)
@group(1) @binding(0) var<storage, read_write> particles: array<ParticleState>;
@group(1) @binding(1) var<storage, read_write> particleAux: array<ParticleAux>;
@group(1) @binding(2) var<storage, read_write> derived: array<ParticleDerived>;
@group(1) @binding(3) var<storage, read_write> allForces: array<AllForces>;
@group(1) @binding(4) var<storage, read_write> radState: array<RadiationState>;
@group(1) @binding(5) var<storage, read_write> axYukMod: array<vec4<f32>>;

// Group 2: photon pool
@group(2) @binding(0) var<storage, read_write> photons: array<Photon>;
@group(2) @binding(1) var<storage, read_write> phCount: atomic<u32>;

// Group 3: pion pool
@group(3) @binding(0) var<storage, read_write> pions: array<Pion>;
@group(3) @binding(1) var<storage, read_write> piCount: atomic<u32>;

// ─── Landau-Lifshitz Larmor Radiation ───
// Ports integrator.js Larmor radiation. Requires Coulomb + Radiation.
@compute @workgroup_size(64)
fn larmorRadiation(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if ((particles[i].flags & FLAG_ALIVE) == 0u) { return; }

    let coulombOn = (u.toggles0 & COULOMB_BIT) != 0u;
    let radiationOn = (u.toggles0 & RADIATION_BIT) != 0u;
    if (!coulombOn || !radiationOn) { return; }
    if (abs(particles[i].charge) < EPSILON) { return; }

    let wx = particles[i].velWX; let wy = particles[i].velWY;
    let wMagSq = wx * wx + wy * wy;
    if (wMagSq < EPSILON * EPSILON) { return; }

    let gamma = sqrt(1.0 + wMagSq);
    let qSq = particles[i].charge * particles[i].charge;
    let mInv = derived[i].invMass;
    let tau = 2.0 / 3.0 * qSq * mInv;

    // Term 1: jerk — analytical only (from force pass)
    // Covers: gravity, Coulomb, Yukawa, magnetic dipole, GM dipole,
    // Bazanski cross, EIH position-only
    let af = allForces[i];
    var rs = radState[i];
    var fRadX = tau * af.jerk.x;
    var fRadY = tau * af.jerk.y;

    let relativityOn = (u.toggles0 & RELATIVITY_BIT) != 0u;
    if (relativityOn && gamma > 1.0) {
        let invG3 = 1.0 / (gamma * gamma * gamma);
        fRadX *= invG3;
        fRadY *= invG3;

        let invGamma = 1.0 / gamma;
        let vx = wx * invGamma; let vy = wy * invGamma;
        let ftv = allForces[i].totalForce; let fx = ftv.x; let fy = ftv.y;
        let fSq = fx * fx + fy * fy;
        let vDotF = vx * fx + vy * fy;

        // Terms 2+3: power-dissipation along v
        let t23 = -tau * gamma * (fSq - vDotF * vDotF) * mInv;
        fRadX += t23 * vx;
        fRadY += t23 * vy;
    }

    // Apply radiation reaction to proper velocity
    let dt = u.dt;
    let keBefore = wMagSq / (gamma + 1.0) * particles[i].mass;
    particles[i].velWX += fRadX * dt * mInv;
    particles[i].velWY += fRadY * dt * mInv;

    // Store display force (reuse rs from backward-diff section, already loaded + modified)
    rs.radDisplayX = fRadX;
    rs.radDisplayY = fRadY;
    // Copy to allForces.f3.xy for arrow rendering
    var afRad = allForces[i];
    afRad.f3.x = fRadX;
    afRad.f3.y = fRadY;
    allForces[i] = afRad;

    // Compute energy lost
    let wx2 = particles[i].velWX; let wy2 = particles[i].velWY;
    let wMagSqAfter = wx2 * wx2 + wy2 * wy2;
    let gammaAfter = sqrt(1.0 + wMagSqAfter);
    let keAfter = wMagSqAfter / (gammaAfter + 1.0) * particles[i].mass;
    let dE = max(0.0, keBefore - keAfter);

    // Accumulate for photon emission
    rs.radAccum += dE;

    // Emit photon when threshold reached
    if (rs.radAccum >= PHOTON_QUANTUM) {
        let phIdx = atomicAdd(&phCount, 1u);
        if (phIdx < MAX_PHOTONS) {
            // sin²θ dipole pattern: peak emission ⊥ to acceleration (rejection sampling)
            let ftv3 = allForces[i].totalForce;
            let ax = ftv3.x * mInv;
            let ay = ftv3.y * mInv;
            let aMag = sqrt(ax * ax + ay * ay);
            var emitAngle: f32;
            if (aMag > EPSILON) {
                let accelAngle = atan2(ay, ax);
                // Rejection-sample sin²θ: up to 8 tries, fallback to perpendicular
                var accepted = false;
                var seedBase = (i * 2654435761u) ^ (u.frameCount * 1664525u);
                for (var t: u32 = 0u; t < MAX_REJECTION_SAMPLES; t++) {
                    let theta = pcgRand(seedBase ^ (t * 1234567u)) * TWO_PI;
                    let sinTh = sin(theta);
                    if (pcgRand(seedBase ^ (t * 7654321u + 1u)) <= sinTh * sinTh) {
                        emitAngle = accelAngle + theta;
                        accepted = true;
                        break;
                    }
                }
                if (!accepted) {
                    // Fallback: perpendicular to acceleration (θ = π/2)
                    emitAngle = accelAngle + HALF_PI;
                }
                // Relativistic aberration: beam forward at high γ
                if (gamma > ABERRATION_THRESHOLD) {
                    let beta = sqrt(max(1.0 - 1.0 / (gamma * gamma), 0.0));
                    let vx2 = wx * (1.0 / gamma); let vy2 = wy * (1.0 / gamma);
                    let velAngle = atan2(vy2, vx2);
                    let delta = emitAngle - velAngle;
                    let sinD = sin(delta); let cosD = cos(delta);
                    let denom = 1.0 + beta * cosD;
                    emitAngle = velAngle + atan2(sinD / (gamma * denom), (cosD + beta) / denom);
                }
            } else {
                // No net acceleration: isotropic emission
                emitAngle = pcgRand((i * 2654435761u) ^ (u.frameCount * 1664525u)) * TWO_PI;
            }
            let cosA = cos(emitAngle); let sinA = sin(emitAngle);
            let offset = max(particleAux[i].radius * SPAWN_OFFSET_MUL, SPAWN_OFFSET_FLOOR);
            var ph: Photon;
            ph.posX = particles[i].posX + cosA * offset;
            ph.posY = particles[i].posY + sinA * offset;
            ph.velX = cosA; ph.velY = sinA;
            ph.energy = rs.radAccum;
            ph.emitterId = particleAux[i].particleId;
            ph.lifetime = 0.0; ph.flags = 1u;
            photons[phIdx] = ph;
            rs.radAccum = 0.0;
        } else {
            atomicSub(&phCount, 1u);
        }
    }
    radState[i] = rs;
}

// ─── Hawking Radiation ───
// Kerr-Newman BH evaporation. Requires Black Hole + Radiation.
// The hole radiates on its own clock: dM = P·dτ with dτ = dt/γ. Mass leaves
// at fixed proper velocity (isotropic rest-frame emission keeps the velocity),
// and each photon is drawn isotropically in the hole's rest frame and boosted,
// with the per-photon recoil that keeps lab momentum exact.

// Emit one photon of rest-frame energy eRest in rest-frame direction dir from a
// body at pos with proper velocity w. Returns the photon's lab momentum, or
// zero if the pool is full (the energy is then dropped, as before).
fn emitBoostedPhoton(pos: vec2<f32>, w: vec2<f32>, eRest: f32, dir: vec2<f32>,
                     offset: f32, emitter: u32) -> vec2<f32> {
    let lab = boostToLab(eRest, eRest * dir, w);
    let pMag = length(lab.yz);
    if (pMag < EPSILON) { return vec2<f32>(0.0); }
    let phIdx = atomicAdd(&phCount, 1u);
    if (phIdx >= MAX_PHOTONS) { atomicSub(&phCount, 1u); return vec2<f32>(0.0); }
    let n = lab.yz / pMag;
    var ph: Photon;
    ph.posX = pos.x + n.x * offset;
    ph.posY = pos.y + n.y * offset;
    ph.velX = n.x; ph.velY = n.y;
    ph.energy = pMag;
    ph.emitterId = emitter;
    ph.lifetime = 0.0; ph.flags = 1u;
    photons[phIdx] = ph;
    return lab.yz;
}

// Emit one lepton in rest-frame direction dir from a body with proper
// velocity w, at rest-frame speed restSpeed. Returns (emitted, lab px, lab py);
// emitted is 0 when the pool is full.
fn emitBoostedLepton(pos: vec2<f32>, w: vec2<f32>, restSpeed: f32, dir: vec2<f32>,
                     charge: f32, offset: f32, emitter: u32) -> vec3<f32> {
    let li = atomicAdd(&piCount, 1u);
    if (li >= PION_POOL_CAP) { atomicSub(&piCount, 1u); return vec3<f32>(0.0); }
    let s = min(restSpeed, MAX_SPEED_RATIO);
    let g = 1.0 / sqrt(max(1.0 - s * s, EPSILON));
    let lab = boostToLab(ELECTRON_MASS * g, ELECTRON_MASS * g * s * dir, w);
    let pLen = length(lab.yz);
    let n = select(dir, lab.yz / max(pLen, EPSILON), pLen > EPSILON);
    var lep: Pion;
    lep.posX = pos.x + n.x * offset;
    lep.posY = pos.y + n.y * offset;
    lep.wX = lab.y / ELECTRON_MASS;
    lep.wY = lab.z / ELECTRON_MASS;
    lep.mass = ELECTRON_MASS;
    lep.charge = charge;
    lep.energy = 0.0;
    lep.emitterId = emitter;
    lep.age = 0u; lep.flags = 1u;
    lep.kind = 1u; lep._pad1 = 0u;
    pions[li] = lep;
    return vec3<f32>(1.0, lab.yz);
}

@compute @workgroup_size(64)
fn hawkingRadiation(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if ((particles[i].flags & FLAG_ALIVE) == 0u) { return; }

    let blackHoleOn = (u.toggles0 & BLACK_HOLE_BIT) != 0u;
    let radiationOn = (u.toggles0 & RADIATION_BIT) != 0u;
    if (!blackHoleOn || !radiationOn) { return; }
    if (particles[i].mass <= 0.0) { return; }

    let M = particles[i].mass;
    let bodyRSq = pow(M, 2.0 / 3.0); // cbrt(M)^2
    let angw = particles[i].angW;
    let angvel = angw / sqrt(1.0 + angw * angw * bodyRSq);
    let a = INERTIA_K * bodyRSq * abs(angvel); // I_K * r² * |ω|
    let Q = particles[i].charge;
    let disc = M * M - a * a - Q * Q;

    var power: f32 = 0.0;
    if (disc > EPSILON) {
        let rPlus = M + sqrt(disc);
        let denom = max(rPlus * rPlus + a * a, EPSILON);
        let kappa = sqrt(disc) / denom;
        let T = kappa / TWO_PI;
        let A = 4.0 * PI * (rPlus * rPlus + a * a);
        let sigma = PI * PI / 60.0;
        power = sigma * T * T * T * T * A;
    }
    // else extremal: no radiation

    let w = vec2<f32>(particles[i].velWX, particles[i].velWY);
    let relOn = (u.toggles0 & RELATIVITY_BIT) != 0u;
    let dE = min(power * restFrameDt(u.dt, w, relOn), particles[i].mass);

    let preMass = particles[i].mass;
    if (dE > 0.0) {
        particles[i].mass -= dE;
        particles[i].baseMass *= 1.0 - dE / preMass;
    }
    // Skip normal emission if no energy radiated AND not at evaporation floor
    // (Schwinger can drain mass below MIN_MASS even when Hawking power is zero)
    if (dE <= 0.0 && particles[i].mass > MIN_MASS) { return; }

    var rs = radState[i];
    rs.hawkAccum += dE;   // rest-frame energy awaiting emission
    let pos = vec2<f32>(particles[i].posX, particles[i].posY);
    let emitter = particleAux[i].particleId;

    // Full evaporation: mass dropped to or below MIN_MASS
    if (particles[i].mass <= MIN_MASS) {
        // Schwinger burst: shed remaining charge as leptons
        let coulombOn = (u.toggles0 & COULOMB_BIT) != 0u;
        if (coulombOn) {
            var remQ = particles[i].charge;
            let csign = select(-1.0, 1.0, remQ > 0.0);
            var seed = (i * 7654321u) ^ u.frameCount;
            for (var ci = 0u; ci < 16u; ci++) {
                if (abs(remQ) < BOSON_CHARGE - EPSILON) { break; }
                seed = seed * 747796405u + 2891336453u;
                let lAngle = f32(seed) / 4294967296.0 * TWO_PI;
                // Fixed toy rest-frame speed 1/√3
                let lep = emitBoostedLepton(pos, w, 0.57735, vec2<f32>(cos(lAngle), sin(lAngle)),
                                            csign * BOSON_CHARGE, SPAWN_OFFSET_FLOOR, emitter);
                if (lep.x == 0.0) { break; }
                remQ -= csign * BOSON_CHARGE;
                particles[i].mass -= ELECTRON_MASS;
            }
            particles[i].charge = remQ;
        }

        // Emit the remaining rest energy as two photons, back-to-back in the
        // hole's frame: that conserves the hole's full four-momentum.
        let finalEnergy = rs.hawkAccum + max(particles[i].mass, 0.0);
        if (finalEnergy > 0.0) {
            let angle = pcgRand((i * 12345u) ^ u.frameCount) * TWO_PI;
            let dir = vec2<f32>(cos(angle), sin(angle));
            emitBoostedPhoton(pos, w, 0.5 * finalEnergy, dir, SPAWN_OFFSET_FLOOR, emitter);
            emitBoostedPhoton(pos, w, 0.5 * finalEnergy, -dir, SPAWN_OFFSET_FLOOR, emitter);
        }
        rs.hawkAccum = 0.0;
        radState[i] = rs;

        // Kill the particle
        particles[i].mass = 0.0;
        particles[i].flags = (particles[i].flags & ~FLAG_ALIVE) | FLAG_RETIRED;
        particleAux[i].deathTime = u.simTime;
        particleAux[i].deathMass = preMass;
        particleAux[i].deathAngVel = angvel;
        return;
    }

    // Update derived state after mass loss
    let newM = particles[i].mass;
    let newBodyRSq = pow(newM, 2.0 / 3.0);
    let newAngVel = particles[i].angW / sqrt(1.0 + particles[i].angW * particles[i].angW * newBodyRSq);
    let newA = INERTIA_K * newBodyRSq * abs(newAngVel);
    let newDisc = newM * newM - newA * newA - Q * Q;
    let newRadius = select(newM, newM + sqrt(max(0.0, newDisc)), newDisc >= 0.0);

    var drd = derived[i];
    drd.invMass = select(0.0, 1.0 / newM, newM > EPSILON);
    drd.radiusSq = newRadius * newRadius;
    drd.bodyRSq = newBodyRSq;
    derived[i] = drd;
    particleAux[i].radius = newRadius;

    // Emit a photon once the accumulated rest-frame energy reaches threshold.
    if (rs.hawkAccum >= MIN_MASS) {
        let angle = pcgRand((i * 12345u) ^ u.frameCount) * TWO_PI;
        let eRest = rs.hawkAccum;
        let pPh = emitBoostedPhoton(pos, w, eRest, vec2<f32>(cos(angle), sin(angle)),
                                    max(newRadius * 1.5, 1.0), emitter);
        if (dot(pPh, pPh) > 0.0) {
            // The hole already lost lab momentum w·eRest with its mass; the
            // photon carries pPh. The difference is the photon's recoil.
            let wNew = w + (w * eRest - pPh) / newM;
            particles[i].velWX = wNew.x;
            particles[i].velWY = wNew.y;
            rs.hawkAccum = 0.0;
        }
    }
    radState[i] = rs;
}

// ─── Pion Emission (Scalar Larmor) ───
// P = g² * F_yuk² / 3. Requires Yukawa + Radiation.
@compute @workgroup_size(64)
fn pionEmission(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if ((particles[i].flags & FLAG_ALIVE) == 0u) { return; }

    let yukawaOn = (u.toggles0 & YUKAWA_BIT) != 0u;
    let radiationOn = (u.toggles0 & RADIATION_BIT) != 0u;
    if (!yukawaOn || !radiationOn) { return; }

    // Read Yukawa force from packed allForces.f3.zw
    let fYukX = allForces[i].f3.z; let fYukY = allForces[i].f3.w;
    var fYukSq = fYukX * fYukX + fYukY * fYukY;
    if (fYukSq < EPSILON * EPSILON) { return; }
    // Radiated power is a Lorentz invariant set by the rest-frame force:
    // |F'|² = F∥² + γ²F⊥² (the scalar analogue of Liénard's γ⁶[a² − (v×a)²]).
    if ((u.toggles0 & RELATIVITY_BIT) != 0u) {
        let wE = vec2<f32>(particles[i].velWX, particles[i].velWY);
        let wESq = dot(wE, wE);
        if (wESq > EPSILON * EPSILON) {
            let fPar = dot(vec2<f32>(fYukX, fYukY), wE) * inverseSqrt(wESq);
            fYukSq += wESq * (fYukSq - fPar * fPar); // γ² − 1 = w²
        }
    }

    let dt = u.dt;
    let coupling = u.yukawaCoupling;
    var dE = coupling / 3.0 * fYukSq * dt;   // invariant power × lab dt

    var rs = radState[i];
    rs.yukawaRadAccum += dE;
    let higgsOn = (u.toggles0 & HIGGS_BIT) != 0u;
    let pionMass = select(u.yukawaMu, u.yukawaMu * axYukMod[i].z, higgsOn);

    if (rs.yukawaRadAccum >= pionMass + MIN_MASS) {
        let ke = rs.yukawaRadAccum - pionMass;
        if (ke > 0.0) {
            let piIdx = atomicAdd(&piCount, 1u);
            if (piIdx < PION_POOL_CAP) {
                // Scalar dipole emission angle: cos²θ rejection-sample from ±Yukawa force axis,
                // then Lorentz-boost from emitter rest frame to lab frame.
                let accelAngle = atan2(fYukY, fYukX);
                var angle: f32;
                var seedBase = (i * 2246822519u) ^ (u.frameCount * 2654435769u);
                var accepted = false;
                for (var t: u32 = 0u; t < MAX_REJECTION_SAMPLES; t++) {
                    let phi = pcgRand(seedBase ^ (t * 1234567u)) * TWO_PI;
                    let cosTheta = cos(phi - accelAngle);
                    if (pcgRand(seedBase ^ (t * 9876543u + 1u)) <= cosTheta * cosTheta) {
                        angle = phi;
                        accepted = true;
                        break;
                    }
                }
                if (!accepted) {
                    // Fallback: along ±acceleration axis
                    angle = accelAngle + select(0.0, PI, pcgRand(seedBase ^ 999u) < 0.5);
                }

                // Relativistic aberration: Lorentz boost from particle rest frame to lab frame
                let wx2 = particles[i].velWX; let wy2 = particles[i].velWY;
                let wSqPi = wx2 * wx2 + wy2 * wy2;
                if (wSqPi > EPSILON * EPSILON) {
                    let betaP = min(sqrt(wSqPi / (1.0 + wSqPi)), MAX_SPEED_RATIO);
                    if (betaP > EPSILON) {
                        let gammaP = 1.0 / sqrt(max(1.0 - betaP * betaP, EPSILON));
                        let invGammaPi = 1.0 / sqrt(1.0 + wSqPi);
                        let boostAngle = atan2(wy2 * invGammaPi, wx2 * invGammaPi);
                        let phiRel = angle - boostAngle;
                        let labRel = atan2(sin(phiRel), gammaP * (cos(phiRel) + betaP));
                        angle = labRel + boostAngle;
                    }
                }

                let speed = min(sqrt(max(ke * (ke + 2.0 * pionMass), 0.0)) / max(ke + pionMass, EPSILON), MAX_SPEED_RATIO);
                let gammaPI = 1.0 / sqrt(max(1.0 - speed * speed, EPSILON));
                let piWx = gammaPI * speed * cos(angle);
                let piWy = gammaPI * speed * sin(angle);

                // Species: 50% pi0, 25% pi+, 25% pi-
                // Neutral emitters cannot emit charged pions (no charge to transfer)
                let rng = pcgRand((i * 98765u) ^ (u.frameCount * 4321u));
                var piChg: f32 = 0.0;
                let emitterIsCharged = abs(particles[i].charge) >= EPSILON;
                if (rng > 0.5 && emitterIsCharged) {
                    let rng2 = pcgRand((i * 54321u) ^ (u.frameCount * 6789u));
                    piChg = select(-BOSON_CHARGE, BOSON_CHARGE, rng2 < 0.5);
                    // Transfer charge from emitter (particleState is rw)
                    particles[i].charge -= piChg;
                }

                let offset = max(particleAux[i].radius * SPAWN_OFFSET_MUL, SPAWN_OFFSET_FLOOR);
                var pi: Pion;
                pi.posX = particles[i].posX + cos(angle) * offset;
                pi.posY = particles[i].posY + sin(angle) * offset;
                pi.wX = piWx; pi.wY = piWy;
                pi.mass = pionMass;
                pi.charge = piChg;
                pi.energy = rs.yukawaRadAccum;
                pi.emitterId = particleAux[i].particleId;
                pi.age = 0u; pi.flags = 1u;
                pi.kind = 0u; pi._pad1 = 0u;
                pions[piIdx] = pi;

                // Radiation reaction: rescale emitter w
                let rrWx = particles[i].velWX; let rrWy = particles[i].velWY;
                let wSq = rrWx * rrWx + rrWy * rrWy;
                if (wSq > EPSILON * EPSILON) {
                    let gam = sqrt(1.0 + wSq);
                    let pKE = (gam - 1.0) * particles[i].mass;
                    if (pKE > rs.yukawaRadAccum) {
                        let keNew = pKE - rs.yukawaRadAccum;
                        let gammaNew = 1.0 + keNew / particles[i].mass;
                        let wSqNew = gammaNew * gammaNew - 1.0;
                        if (wSqNew > EPSILON * EPSILON) {
                            let sc = sqrt(wSqNew / wSq);
                            particles[i].velWX *= sc;
                            particles[i].velWY *= sc;
                        }
                    }
                }

                rs.yukawaRadAccum = 0.0;
            } else { atomicSub(&piCount, 1u); }
        }
    }
    radState[i] = rs;
}

// ─── Schwinger Discharge ───
// Vacuum e+e- pair production at BH horizon.
// Γ = (e²Q²)/(π²Σ) × exp(-πE_cr Σ/|Q|), Σ = r₊² + a² (KN area factor), on the
// hole's clock (dτ = dt/γ). The escaping lepton is emitted in the hole's rest
// frame and boosted; the hole takes the recoil that keeps lab momentum exact.
// Requires Black Hole + Coulomb + Radiation.
@compute @workgroup_size(64)
fn schwingerDischarge(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.aliveCount) { return; }
    if ((particles[i].flags & FLAG_ALIVE) == 0u) { return; }

    let blackHoleOn = (u.toggles0 & BLACK_HOLE_BIT) != 0u;
    let coulombOn = (u.toggles0 & COULOMB_BIT) != 0u;
    let radiationOn = (u.toggles0 & RADIATION_BIT) != 0u;
    if (!blackHoleOn || !coulombOn || !radiationOn) { return; }

    var M = particles[i].mass;
    if (M <= MIN_MASS) { return; }
    let Q = particles[i].charge;
    let absQ = abs(Q);
    if (absQ < BOSON_CHARGE - EPSILON) { return; }

    let bodyRSq = pow(M, 2.0 / 3.0);
    let angw = particles[i].angW;
    let angvel = angw / sqrt(1.0 + angw * angw * bodyRSq);
    let a = INERTIA_K * bodyRSq * abs(angvel);
    let disc = M * M - a * a - Q * Q;
    // Clamp super-extremal inputs to M as a toy effective radius for discharge.
    let rPlus = select(M, M + sqrt(max(0.0, disc)), disc >= 0.0);
    let rPlusSq = rPlus * rPlus;
    let sigma = rPlusSq + a * a; // KN horizon area factor
    let E_field = absQ / sigma;  // effective KN field strength

    if (E_field <= 0.5 * SCHWINGER_E_CR) { return; }

    // Γ = (e²Q²)/(π²Σ) × exp(-πE_cr/E), E_cr/E = E_cr·Σ/|Q|
    let w = vec2<f32>(particles[i].velWX, particles[i].velWY);
    let relOn = (u.toggles0 & RELATIVITY_BIT) != 0u;
    let dRate = SCHWINGER_COEFF * absQ * absQ / sigma * exp(-PI * SCHWINGER_E_CR / E_field)
              * restFrameDt(u.dt, w, relOn);

    var rs = radState[i];
    rs.schwingerAccum += dRate;
    if (rs.schwingerAccum < 1.0) {
        radState[i] = rs;
        return;
    }
    rs.schwingerAccum = 0.0;
    radState[i] = rs;

    // Same-sign lepton escapes; opposite-sign falls back into BH.
    // Rest-frame kinetic energy from the horizon electrostatic potential:
    // eΦ_H - m_e, with Φ_H = |Q|r₊/(r₊² + a²) for Kerr-Newman.
    let angle = pcgRand((i * 3456789u) ^ u.frameCount) * TWO_PI;
    let offset = max(particleAux[i].radius * SPAWN_OFFSET_MUL, SPAWN_OFFSET_FLOOR);
    let ePhi = BOSON_CHARGE * absQ * rPlus / sigma;
    let ke = max(ePhi - ELECTRON_MASS, 0.0);
    let restSpeed = select(sqrt(max(ke * (ke + 2.0 * ELECTRON_MASS), 0.0)) / max(ke + ELECTRON_MASS, EPSILON), 0.0, ke <= 0.0);
    let sign = select(-1.0, 1.0, Q > 0.0);
    let pos = vec2<f32>(particles[i].posX, particles[i].posY);
    let lep = emitBoostedLepton(pos, w, restSpeed, vec2<f32>(cos(angle), sin(angle)),
                                sign * BOSON_CHARGE, offset, particleAux[i].particleId);
    if (lep.x == 0.0) { return; } // pool full
    let pLep = lep.yz;

    // BH loses charge + one electron rest mass (not the lepton's kinetic
    // energy: charging that too makes the discharge run away). Lab momentum
    // is conserved exactly through the recoil.
    particles[i].charge -= sign * BOSON_CHARGE;
    let preMass = particles[i].mass;
    particles[i].mass -= ELECTRON_MASS;
    if (preMass > EPSILON) {
        particles[i].baseMass *= 1.0 - ELECTRON_MASS / preMass;
    }
    M = particles[i].mass;
    let wNew = (w * preMass - pLep) / max(M, EPSILON);
    particles[i].velWX = wNew.x;
    particles[i].velWY = wNew.y;

    // Update derived state after charge + mass change
    let newBodyRSq = pow(M, 2.0 / 3.0);
    let newAngVel = angw / sqrt(1.0 + angw * angw * newBodyRSq);
    let newA = INERTIA_K * newBodyRSq * abs(newAngVel);
    let newDisc = M * M - newA * newA - particles[i].charge * particles[i].charge;
    let newRadius = select(M, M + sqrt(max(0.0, newDisc)), newDisc >= 0.0);
    var drd = derived[i];
    drd.invMass = select(0.0, 1.0 / M, M > EPSILON);
    drd.radiusSq = newRadius * newRadius;
    drd.bodyRSq = newBodyRSq;
    derived[i] = drd;
    particleAux[i].radius = newRadius;
}
