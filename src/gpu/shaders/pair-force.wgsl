// O(N^2) tiled pairwise force computation.
// Each workgroup loads TILE_SIZE source particles into shared memory,
// then each thread accumulates forces from all sources onto its particle.
//
// With Relativity on, every source acts from its retarded state on its world line
// (shared-worldline.wgsl): charges through their Liénard–Wiechert fields, everything else
// through the static laws at the retarded position, scaled by the toy aberration factor
// (1 − n̂·v)⁻³. Retired particles keep acting until the light from their world line's end
// has passed. With Barnes–Hut and Relativity on, this pass carries EM alone
// (EM_PAIRWISE_BIT) and the tree walk adds the rest.
//
// Uses packed ParticleState + ParticleDerived + ParticleAux structs. Jerk written to AllForces.
// Requires shared-worldline.wgsl and shared-1pn.wgsl prepended.

const TILE_SIZE: u32 = 64u;

// Source particle data loaded into shared memory per tile
struct TileParticle {
    posX: f32,
    posY: f32,
    velX: f32,
    velY: f32,
    wX: f32,         // proper velocity, for the source's current world-line point
    wY: f32,
    angW: f32,
    mass: f32,
    charge: f32,
    angVel: f32,
    magMoment: f32,
    angMomentum: f32,
    axMod: f32,
    yukMod: f32,
    higgsMod: f32,
    bodyRadSq: f32,  // pow(mass, 2/3) — true body radius squared (not BH horizon)
    srcIdx: u32,     // global index for signal delay lookup
};

var<workgroup> tile: array<TileParticle, TILE_SIZE>;

// Bind group 0: uniforms
@group(0) @binding(0) var<uniform> uniforms: SimUniforms;

// Bind group 1: particle state (read_write for encoder compat) — 4 bindings
@group(1) @binding(0) var<storage, read_write> particles: array<ParticleState>;
@group(1) @binding(1) var<storage, read_write> derived: array<ParticleDerived>;
@group(1) @binding(2) var<storage, read_write> axYukMod: array<vec4<f32>>;  // packed: axMod, yukMod, higgsMod, pad
@group(1) @binding(3) var<storage, read_write> particleAux: array<ParticleAux>;

// Bind group 2: force accumulators + maxAccel — 2 bindings
@group(2) @binding(0) var<storage, read_write> allForces: array<AllForces>;
@group(2) @binding(1) var<storage, read_write> maxAccel: array<atomic<u32>>;

// Bind group 3: world lines (shared-worldline.wgsl)
@group(3) @binding(0) var<storage, read_write> wlData: array<f32>;
@group(3) @binding(1) var<storage, read_write> wlMeta: array<u32>;

// ── Source data struct for force computation (used by both tile loop and dead loop) ──
struct SourceData {
    rx: f32, ry: f32,          // source − observer, image already resolved
    velX: f32, velY: f32,      // coordinate velocity
    accX: f32, accY: f32,      // coordinate acceleration (retarded sources only)
    mass: f32, charge: f32,
    angVel: f32, magMoment: f32, angMomentum: f32,
    axMod: f32, yukMod: f32, higgsMod: f32,
    delayed: bool,             // a retarded state: Liénard–Wiechert EM, aberrated static laws
};

// ── Force accumulator struct (passed by pointer to helper) ──
struct ForceAccum {
    gravX: f32, gravY: f32,
    coulX: f32, coulY: f32,
    magX: f32, magY: f32,
    gmX: f32, gmY: f32,
    pnX: f32, pnY: f32,
    yukX: f32, yukY: f32,
    totalX: f32, totalY: f32,
    jerkX: f32, jerkY: f32,
    bz: f32, bgz: f32,
    dbzdx: f32, dbzdy: f32,
    dbgzdx: f32, dbgzdy: f32,
    frameDrag: f32, tidal: f32,
};

fn bhSourceRadius(m: f32, charge: f32, angVel: f32, angMomentum: f32) -> f32 {
    if (m <= EPSILON) { return 0.0; }
    let bodyR = pow(m, 1.0 / 3.0);
    let bodyRSq = bodyR * bodyR;
    var omega = angVel;
    if (abs(omega) < EPSILON && abs(angMomentum) > EPSILON) {
        let denom = INERTIA_K * m * bodyRSq;
        if (denom > EPSILON) { omega = angMomentum / denom; }
    }
    let a = INERTIA_K * bodyRSq * abs(omega);
    let disc = m * m - a * a - charge * charge;
    return select(m, m + sqrt(max(0.0, disc)), disc >= 0.0);
}

fn bhInvPotential(rawRSq: f32, m: f32, charge: f32, angVel: f32, angMomentum: f32) -> f32 {
    let rawR = sqrt(max(rawRSq, EPSILON));
    let gap = max(rawR - bhSourceRadius(m, charge, angVel, angMomentum), BH_PW_MIN_GAP);
    return 1.0 / gap;
}

// ── Accumulate pairwise forces from one source onto the observer ──
// Modifies accum in-place. All toggle/config params are module-scope or passed explicitly.
fn accumulatePairForce(
    pVelX: f32, pVelY: f32,
    pMass: f32, pCharge: f32, pAngVel: f32,
    pMagMom: f32, pAngMom: f32,
    pAxMod: f32, pYukMod: f32, pHiggsMod: f32,
    pRi5: f32,
    src: SourceData,
    softeningSq: f32,
    yukMu: f32, yukCutoffSq: f32,
    gravOn: bool, coulOn: bool, magOn: bool, gmOn: bool,
    onePNOn: bool, yukawaOn: bool, higgsOn: bool, radOn: bool, bhOn: bool,
    relOn: bool, needAxMod: bool,
    accum: ptr<function, ForceAccum>,
) {
    let rx = src.rx;
    let ry = src.ry;

    let rawRSq = rx * rx + ry * ry;
    let rSq = rawRSq + softeningSq;
    let invRSq = 1.0 / rSq;
    let invR = sqrt(invRSq);
    let invR3 = invR * invRSq;
    let invR5 = invR3 * invRSq;

    // Toy signal-delay aberration for the static laws (not EM, which is Liénard–Wiechert)
    var aberr: f32 = 1.0;
    if (src.delayed) {
        let nDotV = -(rx * src.velX + ry * src.velY) * invR;
        let denom = max(1.0 - nDotV, ABERRATION_CLAMP_MIN);
        aberr = min(1.0 / (denom * denom * denom), ABERRATION_CLAMP_MAX);
    }
    let invR3a = invR3 * aberr;
    let invR5a = invR5 * aberr;

    // Relative velocity for jerk computation
    let vrx = src.velX - pVelX;
    let vry = src.velY - pVelY;
    let rDotVr = rx * vrx + ry * vry;

    // (v_s × r)_z for the moving-source fields
    let crossSV = src.velX * ry - src.velY * rx;

    // Axion modulation (geometric mean, guarded against negative products)
    let axModPair = select(1.0, sqrt(max(pAxMod * src.axMod, 0.0)), needAxMod);

    // -- Gravity --
    if (gravOn) {
        let k = pMass * src.mass;
        var fDir = k * invR3a;
        var pwJerkFactor = 0.0;
        if (bhOn) {
            let rawR = sqrt(max(rawRSq, EPSILON));
            let invRawR = 1.0 / rawR;
            let invGap = bhInvPotential(rawRSq, src.mass, src.charge, src.angVel, src.angMomentum);
            let pwForceScale = invRawR * invGap * invGap;
            fDir = k * pwForceScale * aberr;
            pwJerkFactor = pwForceScale * (invRawR * invRawR + 2.0 * invRawR * invGap) * aberr;
        }
        (*accum).gravX += rx * fDir;
        (*accum).gravY += ry * fDir;
        (*accum).totalX += rx * fDir;
        (*accum).totalY += ry * fDir;

        if (radOn) {
            let jRadial = select(-3.0 * rDotVr * k * invRSq * invR3a,
                                 -k * rDotVr * pwJerkFactor,
                                 bhOn);
            (*accum).jerkX += vrx * fDir + rx * jRadial;
            (*accum).jerkY += vry * fDir + ry * jRadial;
        }

        // Tidal locking torque
        let crossRV = rx * (src.velY - pVelY) - ry * (src.velX - pVelX);
        let wOrbit = crossRV * invRSq;
        let dw = pAngVel - wOrbit;
        var coupling = src.mass;
        if (coulOn && pMass > EPSILON) {
            coupling += pCharge * src.charge / pMass;
        }
        let invR6 = invRSq * invRSq * invRSq;
        (*accum).tidal -= TIDAL_STRENGTH * coupling * coupling * pRi5 * invR6 * dw;
    }

    // -- Charges: Liénard–Wiechert from a retarded state, else Coulomb and Biot–Savart --
    if (coulOn || magOn) {
        let kq = -(pCharge * src.charge) * axModPair;
        if (src.delayed) {
            // E = q[(n̂ − β)(1 − β²)/(κ³R²) + n̂ × ((n̂ − β) × β̇)/(κ³R)], B = n̂ × E, with R and n̂
            // from the retarded position to the observer. Both terms carry σ³, σ = R/√(R² + ε²),
            // so at β = 0 the field is the softened Coulomb field.
            let R = sqrt(rawRSq);
            if (R > EPSILON) {
                let n = vec2(-rx, -ry) / R;
                let b = vec2(src.velX, src.velY);
                let bd = vec2(src.accX, src.accY);
                let kappa = max(1.0 - dot(n, b), LW_KAPPA_MIN);
                let k3 = 1.0 / (kappa * kappa * kappa);
                let sigma = R * invR;
                let sig3 = sigma * sigma * sigma;
                let nb = n - b;
                let eVel = nb * ((1.0 - dot(b, b)) * k3 / (R * R));
                let cz = nb.x * bd.y - nb.y * bd.x;
                let eRad = vec2(n.y, -n.x) * (cz * k3 / R);
                let E = (eVel + eRad) * (src.charge * sig3 * axModPair);
                if (coulOn) {
                    let f = pCharge * E;
                    (*accum).coulX += f.x;
                    (*accum).coulY += f.y;
                    (*accum).totalX += f.x;
                    (*accum).totalY += f.y;
                    // Jerk for radiation reaction: the static form at the retarded state
                    if (radOn) {
                        let fDir = kq * invR3;
                        let jRadial = -3.0 * rDotVr * kq * invRSq * invR3;
                        (*accum).jerkX += vrx * fDir + rx * jRadial;
                        (*accum).jerkY += vry * fDir + ry * jRadial;
                    }
                }
                if (magOn) {
                    (*accum).bz += n.x * E.y - n.y * E.x;
                }
            }
        } else if (coulOn) {
            let fDir = kq * invR3;
            (*accum).coulX += rx * fDir;
            (*accum).coulY += ry * fDir;
            (*accum).totalX += rx * fDir;
            (*accum).totalY += ry * fDir;

            if (radOn) {
                let jRadial = -3.0 * rDotVr * kq * invRSq * invR3;
                (*accum).jerkX += vrx * fDir + rx * jRadial;
                (*accum).jerkY += vry * fDir + ry * jRadial;
            }
        }
    }

    // -- 1PN: EIH remainder, Bažański, scalar Breit (shared-1pn.wgsl) --
    if (onePNOn) {
        let yukModPair = sqrt(max(pYukMod * src.yukMod, 0.0));
        let mu = select(yukMu, yukMu * sqrt(pHiggsMod * src.higgsMod), higgsOn);
        let f = pair1PN(vec2(rx, ry), invR, invRSq,
                        vec2(pVelX, pVelY), vec2(src.velX, src.velY),
                        pMass, src.mass, pCharge, src.charge,
                        gmOn, gmOn && coulOn, yukawaOn && rawRSq < yukCutoffSq, relOn,
                        mu, uniforms.yukawaCoupling * yukModPair);
        (*accum).pnX += f.x;
        (*accum).pnY += f.y;
        (*accum).totalX += f.x;
        (*accum).totalY += f.y;
    }

    // -- Magnetic: dipole-dipole force, and Bz from the dipole and (without delay) the moving charge --
    if (magOn) {
        let fDir = -3.0 * (pMagMom * src.magMoment) * invR5a * axModPair;
        (*accum).magX += rx * fDir;
        (*accum).magY += ry * fDir;
        (*accum).totalX += rx * fDir;
        (*accum).totalY += ry * fDir;

        // Analytical jerk: F = 3μ₁μ₂·r/r⁵, d/dt(1/r⁵) = -5·rDotVr/r⁷
        if (radOn) {
            let invR7a = invR5a * invRSq;
            let jRadial = 15.0 * (pMagMom * src.magMoment) * rDotVr * invR7a * axModPair;
            (*accum).jerkX += vrx * fDir + rx * jRadial;
            (*accum).jerkY += vry * fDir + ry * jRadial;
        }

        // Biot–Savart, B = q v_s × R̂/R² with R̂ from source to observer: Bz = −q (v_s × r)_z/r³
        let BzMoving = -src.charge * crossSV * invR3 * axModPair;
        if (!src.delayed) { (*accum).bz += BzMoving; }

        // Its gradient, for spin-orbit (the static form at the retarded state when delayed)
        let cq = -src.charge * axModPair;
        (*accum).dbzdx += 3.0 * BzMoving * rx * invRSq + cq * src.velY * invR3;
        (*accum).dbzdy += 3.0 * BzMoving * ry * invRSq - cq * src.velX * invR3;

        // In-plane field of the dipole, −μ/r³. Dipole–dipole forces are the direct term
        // above, so the dipole field adds no gradient for spin-orbit.
        (*accum).bz -= src.magMoment * invR3 * axModPair;
    }

    // -- Gravitomagnetic (F = 4m v × Bg; parallel mass currents repel) --
    if (gmOn) {
        let fDir = 3.0 * (pAngMom * src.angMomentum) * invR5a;
        (*accum).gmX += rx * fDir;
        (*accum).gmY += ry * fDir;
        (*accum).totalX += rx * fDir;
        (*accum).totalY += ry * fDir;

        // Analytical jerk: F = 3L₁L₂·r/r⁵, d/dt(1/r⁵) = -5·rDotVr/r⁷
        if (radOn) {
            let invR7a = invR5a * invRSq;
            let jRadial = -15.0 * (pAngMom * src.angMomentum) * rDotVr * invR7a;
            (*accum).jerkX += vrx * fDir + rx * jRadial;
            (*accum).jerkY += vry * fDir + ry * jRadial;
        }

        // Moving mass: Bg = −m_s (v_s × R)/R³ = +m_s (v_s × r)_z/r³; 4m v × Bg is EIH's v₁·v₂ sector
        let BgzMoving = src.mass * crossSV * invR3;
        (*accum).bgz += BgzMoving;
        (*accum).dbgzdx += 3.0 * BgzMoving * rx * invRSq + src.mass * src.velY * invR3;
        (*accum).dbgzdy += 3.0 * BgzMoving * ry * invRSq - src.mass * src.velX * invR3;

        // Spin: +J/(2r³) in the plane (prograde orbits feel the repulsion that gives
        // Ω_pro = Ω_K − J/r³); no gradient, as for the EM dipole
        (*accum).bgz += 0.5 * src.angMomentum * invR3;

        // Frame-dragging torque: aligns spins toward co-rotation
        (*accum).frameDrag += 2.0 * src.angMomentum * (src.angVel - pAngVel) * invR3;
    }

    // -- Yukawa --
    if (yukawaOn && rawRSq < yukCutoffSq) {
        let r_dist = 1.0 / invR;
        let mu = select(yukMu, yukMu * sqrt(pHiggsMod * src.higgsMod), higgsOn);
        let muR = mu * r_dist;
        let expMuR = select(0.0, exp(-muR), muR < 80.0);
        let yukModPair = sqrt(max(pYukMod * src.yukMod, 0.0));
        let yukCoupling = uniforms.yukawaCoupling;
        let yukInvRa = invR * aberr;
        let fDir = yukCoupling * yukModPair * pMass * src.mass * expMuR
                   * (invRSq + mu * invR) * yukInvRa;
        (*accum).yukX += rx * fDir;
        (*accum).yukY += ry * fDir;
        (*accum).totalX += rx * fDir;
        (*accum).totalY += ry * fDir;

        if (radOn) {
            let jRadial = -(3.0 * invRSq + 3.0 * mu * invR + mu * mu)
                          * rDotVr * yukCoupling * yukModPair * pMass * src.mass
                          * expMuR * invRSq * yukInvRa;
            (*accum).jerkX += vrx * fDir + rx * jRadial;
            (*accum).jerkY += vry * fDir + ry * jRadial;
        }
    }
}

// ── A SourceData from a retarded state ──
fn makeDelayedSource(ret: Retarded, sAxMod: f32, sYukMod: f32, sHiggsMod: f32) -> SourceData {
    var src: SourceData;
    src.rx = ret.rel.x;
    src.ry = ret.rel.y;
    src.velX = ret.vel.x;
    src.velY = ret.vel.y;
    src.accX = ret.acc.x;
    src.accY = ret.acc.y;
    src.mass = ret.mass;
    src.charge = ret.charge;
    // Dipole moments from the retarded angular proper velocity
    let bodyRadSq = pow(max(ret.mass, EPSILON), 2.0 / 3.0);
    let sAngVel = ret.angw / sqrt(1.0 + ret.angw * ret.angw * bodyRadSq);
    src.angVel = sAngVel;
    src.magMoment = MAG_MOMENT_K * ret.charge * sAngVel * bodyRadSq;
    src.angMomentum = INERTIA_K * ret.mass * sAngVel * bodyRadSq;
    src.axMod = sAxMod;
    src.yukMod = sYukMod;
    src.higgsMod = sHiggsMod;
    src.delayed = true;
    return src;
}

@compute @workgroup_size(TILE_SIZE)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
) {
    let idx = gid.x;
    let localIdx = lid.x;
    let N = uniforms.aliveCount;

    // Load this thread's particle (observer)
    let alive = idx < N && (particles[idx].flags & FLAG_ALIVE) != 0u;

    var pPosX: f32 = 0.0;
    var pPosY: f32 = 0.0;
    var pVelX: f32 = 0.0;
    var pVelY: f32 = 0.0;
    var pMass: f32 = 0.0;
    var pCharge: f32 = 0.0;
    var pAngVel: f32 = 0.0;
    var pMagMom: f32 = 0.0;
    var pAngMom: f32 = 0.0;
    var pAxMod: f32 = 1.0;
    var pYukMod: f32 = 1.0;
    var pHiggsMod: f32 = 1.0;
    var pInvMass: f32 = 0.0;
    // Pre-hoisted tidal locking constant: ri5 = mass^(5/3) = bodyRadiusSq^2 * bodyRadius
    var pRi5: f32 = 0.0;

    if (alive) {
        let p = particles[idx];
        pPosX = p.posX;
        pPosY = p.posY;
        pMass = p.mass;
        pCharge = p.charge;
        let d = derived[idx];
        pVelX = d.velX;
        pVelY = d.velY;
        pAngVel = d.angVel;
        pMagMom = d.magMoment;
        pAngMom = d.angMomentum;
        pInvMass = d.invMass;
        let aym = axYukMod[idx];
        pAxMod = aym.x;
        pYukMod = aym.y;
        pHiggsMod = aym.z;
        let pBodyRSq = d.bodyRSq;
        pRi5 = pBodyRSq * pBodyRSq * sqrt(pBodyRSq);
    }

    // With Barnes–Hut and Relativity this pass carries EM alone; the tree walk adds the rest
    let emOnly = hasToggle1(EM_PAIRWISE_BIT);
    let gravOn = hasToggle0(GRAVITY_BIT) && !emOnly;
    let coulOn = hasToggle0(COULOMB_BIT);
    let magOn = hasToggle0(MAGNETIC_BIT);
    let gmOn = hasToggle0(GRAVITOMAG_BIT) && !emOnly;
    let onePNOn = hasToggle0(ONE_PN_BIT) && !emOnly;
    let relOn = hasToggle0(RELATIVITY_BIT);
    let yukawaOn = hasToggle0(YUKAWA_BIT) && !emOnly;
    let higgsOn = hasToggle0(HIGGS_BIT);
    let radOn = hasToggle0(RADIATION_BIT);
    let bhOn = hasToggle0(BLACK_HOLE_BIT);
    let isPeriodic = uniforms.boundaryMode == BOUND_LOOP;
    let domW = uniforms.domainW;
    let domH = uniforms.domainH;
    let topo = uniforms.topologyMode;

    let softeningSq = uniforms.softeningSq;

    // Axion EM modulation flag
    let needAxMod = (coulOn || magOn) && hasToggle0(AXION_BIT);

    // Yukawa cutoff: exp(-mu*r) < 0.002 when mu*r > 6
    // When Higgs enabled, muEff can be as small as yukawaMu * HIGGS_MASS_FLOOR — widen cutoff
    let yukMu = uniforms.yukawaMu;
    let muMin = select(yukMu, yukMu * HIGGS_MASS_FLOOR, higgsOn);
    let yukCutoffSq = select(1e30, (6.0 / muMin) * (6.0 / muMin), yukawaOn && muMin > EPSILON);

    // Forces are computed at pre-drift positions, so the observer sits one substep back
    // on the world-line clock: dη = dt/a
    let sdTime = uniforms.simTime - uniforms.dt / uniforms.scaleA;

    // Per-thread force accumulator
    var accum: ForceAccum;
    accum.gravX = 0.0; accum.gravY = 0.0;
    accum.coulX = 0.0; accum.coulY = 0.0;
    accum.magX = 0.0; accum.magY = 0.0;
    accum.gmX = 0.0; accum.gmY = 0.0;
    accum.pnX = 0.0; accum.pnY = 0.0;
    accum.yukX = 0.0; accum.yukY = 0.0;
    accum.totalX = 0.0; accum.totalY = 0.0;
    accum.jerkX = 0.0; accum.jerkY = 0.0;
    accum.bz = 0.0; accum.bgz = 0.0;
    accum.dbzdx = 0.0; accum.dbzdy = 0.0;
    accum.dbgzdx = 0.0; accum.dbgzdy = 0.0;
    accum.frameDrag = 0.0; accum.tidal = 0.0;

    // Number of tiles needed to cover all particles
    let numTiles = (N + TILE_SIZE - 1u) / TILE_SIZE;

    for (var t: u32 = 0u; t < numTiles; t++) {
        // Collaborative tile load: each thread loads one source particle
        let tileSrcIdx = t * TILE_SIZE + localIdx;
        if (tileSrcIdx < N && (particles[tileSrcIdx].flags & FLAG_ALIVE) != 0u) {
            let sp = particles[tileSrcIdx];
            tile[localIdx].posX = sp.posX;
            tile[localIdx].posY = sp.posY;
            let sd = derived[tileSrcIdx];
            tile[localIdx].velX = sd.velX;
            tile[localIdx].velY = sd.velY;
            tile[localIdx].wX = sp.velWX;
            tile[localIdx].wY = sp.velWY;
            tile[localIdx].angW = sp.angW;
            tile[localIdx].mass = sp.mass;
            tile[localIdx].charge = sp.charge;
            tile[localIdx].angVel = sd.angVel;
            tile[localIdx].magMoment = sd.magMoment;
            tile[localIdx].angMomentum = sd.angMomentum;
            let saym = axYukMod[tileSrcIdx];
            tile[localIdx].axMod = saym.x;
            tile[localIdx].yukMod = saym.y;
            tile[localIdx].higgsMod = saym.z;
            tile[localIdx].bodyRadSq = sd.bodyRSq;
            tile[localIdx].srcIdx = tileSrcIdx;
        } else {
            // Mark as invalid (zero mass = no force contribution)
            tile[localIdx].mass = 0.0;
            tile[localIdx].srcIdx = 0xFFFFFFFFu;
        }

        workgroupBarrier();

        // Each thread accumulates forces from all sources in this tile
        if (alive) {
            for (var j: u32 = 0u; j < TILE_SIZE; j++) {
                let sIdx = t * TILE_SIZE + j;
                if (sIdx >= N || sIdx == idx) { continue; }
                let s = tile[j];
                if (s.mass < EPSILON) { continue; }

                var src: SourceData;
                if (relOn) {
                    let ret = retardedState(
                        s.srcIdx, pPosX, pPosY, sdTime,
                        vec2(s.posX, s.posY), vec2(s.wX, s.wY), s.angW, s.mass, s.charge,
                        true, isPeriodic, domW, domH, topo, uniforms.scaleA,
                    );
                    if (!ret.valid) { continue; }
                    src = makeDelayedSource(ret, s.axMod, s.yukMod, s.higgsMod);
                } else {
                    var d = vec2(s.posX - pPosX, s.posY - pPosY);
                    if (isPeriodic) { d = fullMinImage(pPosX, pPosY, s.posX, s.posY); }
                    src.rx = d.x;
                    src.ry = d.y;
                    src.velX = s.velX;
                    src.velY = s.velY;
                    src.accX = 0.0;
                    src.accY = 0.0;
                    src.mass = s.mass;
                    src.charge = s.charge;
                    src.angVel = s.angVel;
                    src.magMoment = s.magMoment;
                    src.angMomentum = s.angMomentum;
                    src.axMod = s.axMod;
                    src.yukMod = s.yukMod;
                    src.higgsMod = s.higgsMod;
                    src.delayed = false;
                }

                accumulatePairForce(
                    pVelX, pVelY,
                    pMass, pCharge, pAngVel,
                    pMagMom, pAngMom,
                    pAxMod, pYukMod, pHiggsMod, pRi5,
                    src, softeningSq,
                    yukMu, yukCutoffSq,
                    gravOn, coulOn, magOn, gmOn,
                    onePNOn, yukawaOn, higgsOn, radOn,
                    bhOn, relOn, needAxMod,
                    &accum,
                );
            }
        }

        workgroupBarrier();
    }

    // ── Retired particles keep acting until the light from their world line's end has passed ──
    if (alive && relOn) {
        let totalCount = uniforms.particleCount;
        for (var ri: u32 = 0u; ri < totalCount; ri++) {
            let flags = particles[ri].flags;
            if ((flags & FLAG_RETIRED) == 0u || (flags & FLAG_ALIVE) != 0u) { continue; }

            let rp = particles[ri];
            let ret = retardedState(
                ri, pPosX, pPosY, sdTime,
                vec2(rp.posX, rp.posY), vec2(0.0), 0.0, 0.0, rp.charge,
                false, isPeriodic, domW, domH, topo, uniforms.scaleA,
            );
            if (!ret.valid) { continue; }

            let deadAxYuk = axYukMod[ri];
            let src = makeDelayedSource(
                ret,
                select(deadAxYuk.x, 1.0, abs(deadAxYuk.x) < EPSILON),
                select(deadAxYuk.y, 1.0, abs(deadAxYuk.y) < EPSILON),
                select(deadAxYuk.z, 1.0, abs(deadAxYuk.z) < EPSILON),
            );

            accumulatePairForce(
                pVelX, pVelY,
                pMass, pCharge, pAngVel,
                pMagMom, pAngMom,
                pAxMod, pYukMod, pHiggsMod, pRi5,
                src, softeningSq,
                yukMu, yukCutoffSq,
                gravOn, coulOn, magOn, gmOn,
                onePNOn, yukawaOn, higgsOn, radOn,
                bhOn, relOn, needAxMod,
                &accum,
            );
        }
    }

    // Write accumulated forces to packed AllForces struct
    if (alive) {
        var af: AllForces;
        af.f0 = vec4(accum.gravX, accum.gravY, accum.coulX, accum.coulY);
        af.f1 = vec4(accum.magX, accum.magY, accum.gmX, accum.gmY);
        af.f2 = vec4(accum.pnX, accum.pnY, 0.0, 0.0);  // spinCurv filled by spin-orbit pass
        af.f3 = vec4(0.0, 0.0, accum.yukX, accum.yukY);   // radiation.xy filled by Phase 4
        af.f4 = vec4(0.0, 0.0, 0.0, 0.0);           // external/higgs filled by later passes
        af.f5 = vec4(0.0, 0.0, 0.0, 0.0);           // axion filled by later passes
        af.torques = vec4(0.0, accum.frameDrag, accum.tidal, 0.0);
        // NaN guard on B-field accumulators — corruption here propagates to Boris rotation + spin-orbit
        af.bFields = vec4(
            select(accum.bz, 0.0, accum.bz != accum.bz),
            select(accum.bgz, 0.0, accum.bgz != accum.bgz),
            0.0, 0.0);  // extBz added by external fields pass
        af.bFieldGrads = vec4(
            select(accum.dbzdx, 0.0, accum.dbzdx != accum.dbzdx),
            select(accum.dbzdy, 0.0, accum.dbzdy != accum.dbzdy),
            select(accum.dbgzdx, 0.0, accum.dbgzdx != accum.dbgzdx),
            select(accum.dbgzdy, 0.0, accum.dbgzdy != accum.dbgzdy));
        // NaN guard on total force and jerk — must happen BEFORE writing to global memory
        af.totalForce = vec2(
            select(accum.totalX, 0.0, accum.totalX != accum.totalX),
            select(accum.totalY, 0.0, accum.totalY != accum.totalY)
        );
        af.jerk = vec2(
            select(accum.jerkX, 0.0, accum.jerkX != accum.jerkX),
            select(accum.jerkY, 0.0, accum.jerkY != accum.jerkY)
        );

        allForces[idx] = af;

        // Adaptive substepping: atomicMax of |F/m|^2 as fixed-point u32
        let totalFSq = af.totalForce.x * af.totalForce.x + af.totalForce.y * af.totalForce.y;
        let accelSq = totalFSq * pInvMass * pInvMass;
        // Guard against NaN/Inf which would corrupt adaptive stepping
        if (accelSq == accelSq && accelSq < 1e20) {
            let accelBits = bitcast<u32>(sqrt(accelSq));
            atomicMax(&maxAccel[0], accelBits);
        }
    }
}
