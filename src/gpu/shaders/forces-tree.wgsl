// ─── Barnes-Hut Tree Walk Force Computation ───
// One thread per alive particle. Stack-based iterative traversal.
// Uses theta=0.5 opening angle criterion.
// Accumulates into the same force buffers as pairwise path.

// Constants provided by generated wgslConstants block.
// Shader-specific constants:
const NONE: i32 = -1;
const MAX_STACK: u32 = 128u;

// Node layout accessors from shared-tree-nodes.wgsl (prepended)

@group(0) @binding(0) var<storage, read_write> nodes: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: SimUniforms;

// Group 1: packed particle structs (read_write for encoder compat)
@group(1) @binding(0) var<storage, read_write> particleState: array<ParticleState>;
@group(1) @binding(2) var<storage, read_write> derived_in: array<ParticleDerived>;
@group(1) @binding(3) var<storage, read_write> axYukMod_in: array<vec4<f32>>; // packed: axMod, yukMod, higgsMod, pad

// Group 2: force accumulators + maxAccel — 2 bindings (radiationState removed, jerk now in AllForces)
@group(2) @binding(0) var<storage, read_write> allForces: array<AllForces>;
@group(2) @binding(1) var<storage, read_write> maxAccel: array<atomic<u32>>;

// Group 3: world lines (shared-worldline.wgsl)
@group(3) @binding(0) var<storage, read_write> wlData: array<f32>;
@group(3) @binding(1) var<storage, read_write> wlMeta: array<u32>;

// Shared pairForce function (from pair-force.wgsl, imported or inlined)
// This function accumulates E-like forces and B-field contributions
// for one source acting on one receiver particle.
// For the tree walk, sources are either individual leaf particles
// or aggregate node data (mass, charge, CoM, etc.).

// Inline the core force accumulation (matches pairForce in forces.js):
// jerkOut: function-scope pointer for accumulating analytical jerk (radiation)
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

fn accumulateForce(
    af: ptr<function, AllForces>,
    rx: f32, ry: f32,            // source − observer, image resolved
    pMass: f32, pCharge: f32,
    pMagMoment: f32, pAngMomentum: f32,
    pAngVel: f32, pVelX: f32, pVelY: f32,
    pAxMod: f32, pYukMod: f32, pHiggsMod: f32,
    svx: f32, svy: f32,
    sMass: f32, sCharge: f32,
    sAngVel: f32, sMagMoment: f32, sAngMomentum: f32,
    sAxMod: f32, sYukMod: f32, sHiggsMod: f32,
    pRi5: f32,
    jerkOut: ptr<function, vec2<f32>>,
    useAberration: bool,
    // Hoisted toggle booleans (G9: avoids re-reading uniforms.toggles0 per call)
    gravOn: bool, coulOn: bool, magOn: bool, gmOn: bool,
    yukOn: bool, onePNOn: bool, bazOn: bool, higgsOn: bool, radOn: bool, bhOn: bool,
    relOn: bool, needAxMod: bool,
) {
    let softeningSq = uniforms.softeningSq;
    let rawRSq = rx * rx + ry * ry;
    let rSq = rawRSq + softeningSq;
    let invRSq = 1.0 / rSq;
    let invR = sqrt(invRSq);
    let invR3 = invR * invRSq;
    let invR5 = invR3 * invRSq;

    // Toy signal-delay aberration: not a full moving-source field reconstruction.
    var aberr: f32 = 1.0;
    if (useAberration) {
        let nDotV = -(rx * svx + ry * svy) * invR;
        let denom = max(1.0 - nDotV, ABERRATION_CLAMP_MIN);
        aberr = min(1.0 / (denom * denom * denom), ABERRATION_CLAMP_MAX);
    }
    let invR3a = invR3 * aberr;
    let invR5a = invR5 * aberr;

    var axModPair: f32 = 1.0;
    if (needAxMod) {
        axModPair = sqrt(max(pAxMod * sAxMod, 0.0));
    }

    // Relative velocity for jerk computation
    let vrx = svx - pVelX;
    let vry = svy - pVelY;
    let rDotVr = rx * vrx + ry * vry;

    // Gravity: +m1*m2/r^2 (attractive)
    if (gravOn) {
        let k = pMass * sMass;
        var fDir = k * invR3a;
        var pwJerkFactor = 0.0;
        if (bhOn) {
            let rawR = sqrt(max(rawRSq, EPSILON));
            let invRawR = 1.0 / rawR;
            let invGap = bhInvPotential(rawRSq, sMass, sCharge, sAngVel, sAngMomentum);
            let pwForceScale = invRawR * invGap * invGap;
            fDir = k * pwForceScale * aberr;
            pwJerkFactor = pwForceScale * (invRawR * invRawR + 2.0 * invRawR * invGap) * aberr;
        }
        let fx = rx * fDir;
        let fy = ry * fDir;
        (*af).f0.x += fx;
        (*af).f0.y += fy;
        (*af).totalForce.x += fx;
        (*af).totalForce.y += fy;

        // Analytical jerk for Larmor radiation
        if (radOn) {
            let jRadial = select(-3.0 * rDotVr * k * invRSq * invR3a,
                                 -k * rDotVr * pwJerkFactor,
                                 bhOn);
            (*jerkOut).x += vrx * fDir + rx * jRadial;
            (*jerkOut).y += vry * fDir + ry * jRadial;
        }

        // Tidal locking torque
        let crossRV = rx * (svy - pVelY) - ry * (svx - pVelX);
        let wOrbit = crossRV * invRSq;
        let dw = pAngVel - wOrbit;
        var coupling = sMass;
        if (coulOn && pMass > EPSILON) {
            coupling += pCharge * sCharge / pMass;
        }
        let invR6 = invRSq * invRSq * invRSq;
        (*af).torques.z += -TIDAL_STRENGTH * coupling * coupling * pRi5 * invR6 * dw;
    }

    // Coulomb: -q1*q2/r^2 (like repels). With Relativity on, EM runs pairwise as
    // Liénard–Wiechert (EM_PAIRWISE_BIT) and coulOn/magOn arrive false here.
    if (coulOn) {
        let k = -(pCharge * sCharge) * axModPair;
        let fDir = k * invR3;
        let fx = rx * fDir;
        let fy = ry * fDir;
        (*af).f0.z += fx;
        (*af).f0.w += fy;
        (*af).totalForce.x += fx;
        (*af).totalForce.y += fy;

        // Analytical jerk for Larmor radiation
        if (radOn) {
            let jRadial = -3.0 * rDotVr * k * invRSq * invR3;
            (*jerkOut).x += vrx * fDir + rx * jRadial;
            (*jerkOut).y += vry * fDir + ry * jRadial;
        }
    }

    // (v_s × r)_z for the moving-source fields
    let crossSV = svx * ry - svy * rx;

    // Magnetic: dipole-dipole + Bz field
    if (magOn) {
        let axMod = axModPair;
        // Dipole-dipole radial: F = -3*mu1*mu2/r^4 (aligned dipoles repel)
        let fDir = -3.0 * (pMagMoment * sMagMoment) * invR5a * axMod;
        let fx = rx * fDir;
        let fy = ry * fDir;
        (*af).f1.x += fx;
        (*af).f1.y += fy;
        (*af).totalForce.x += fx;
        (*af).totalForce.y += fy;

        // Analytical jerk: F = 3μ₁μ₂·r/r⁵, d/dt(1/r⁵) = -5·rDotVr/r⁷
        if (radOn) {
            let invR7a = invR5a * invRSq;
            let jRadial = 15.0 * (pMagMoment * sMagMoment) * rDotVr * invR7a * axMod;
            (*jerkOut).x += vrx * fDir + rx * jRadial;
            (*jerkOut).y += vry * fDir + ry * jRadial;
        }

        // Biot–Savart from the moving charge, Bz = −q (v_s × r)_z/r³, and its gradient
        let cq = -sCharge * axMod;
        let BzMoving = cq * crossSV * invR3;
        (*af).bFields.x += BzMoving;
        (*af).bFieldGrads.x += 3.0 * BzMoving * rx * invRSq + cq * svy * invR3;
        (*af).bFieldGrads.y += 3.0 * BzMoving * ry * invRSq - cq * svx * invR3;

        // In-plane dipole field, −μ/r³ (no gradient: spin-spin is the direct term above)
        (*af).bFields.x -= sMagMoment * invR3 * axMod;
    }

    // Gravitomagnetic: dipole + Bgz field (F = 4m v × Bg; parallel mass currents repel)
    if (gmOn) {
        let fDir = 3.0 * (pAngMomentum * sAngMomentum) * invR5a;
        let fx = rx * fDir;
        let fy = ry * fDir;
        (*af).f1.z += fx;
        (*af).f1.w += fy;
        (*af).totalForce.x += fx;
        (*af).totalForce.y += fy;

        // Analytical jerk: F = 3L₁L₂·r/r⁵, d/dt(1/r⁵) = -5·rDotVr/r⁷
        if (radOn) {
            let invR7a = invR5a * invRSq;
            let jRadial = -15.0 * (pAngMomentum * sAngMomentum) * rDotVr * invR7a;
            (*jerkOut).x += vrx * fDir + rx * jRadial;
            (*jerkOut).y += vry * fDir + ry * jRadial;
        }

        // Moving mass: Bg = +m (v_s × r)_z/r³, and its gradient
        let BgzMoving = sMass * crossSV * invR3;
        (*af).bFields.y += BgzMoving;
        (*af).bFieldGrads.z += 3.0 * BgzMoving * rx * invRSq + sMass * svy * invR3;
        (*af).bFieldGrads.w += 3.0 * BgzMoving * ry * invRSq - sMass * svx * invR3;

        // Spin: +J/(2r³) in the plane (no gradient)
        (*af).bFields.y += 0.5 * sAngMomentum * invR3;

        // Frame-dragging torque
        let fdTorque = 2.0 * sAngMomentum * (sAngVel - pAngVel) * invR3;
        (*af).torques.y += fdTorque;
    }

    // Yukawa (Higgs-modulated μ when both enabled)
    var mu = uniforms.yukawaMu;
    var yukModPair = 1.0;
    var yukInRange = false;
    if (yukOn) {
        mu = select(uniforms.yukawaMu, uniforms.yukawaMu * sqrt(pHiggsMod * sHiggsMod), higgsOn);
        let cutoffSq = select((6.0 / uniforms.yukawaMu) * (6.0 / uniforms.yukawaMu), (6.0 / max(mu, EPSILON)) * (6.0 / max(mu, EPSILON)), higgsOn);
        yukInRange = rawRSq < cutoffSq;
        if (yukInRange) {
            let r = 1.0 / invR;
            let muR = mu * r;
            let expMuR = select(0.0, exp(-muR), muR < 80.0);
            yukModPair = sqrt(max(pYukMod * sYukMod, 0.0));
            let yukInvRa = invR * aberr;
            let fDir = uniforms.yukawaCoupling * yukModPair * pMass * sMass * expMuR * (invRSq + mu * invR) * yukInvRa;
            let fx = rx * fDir;
            let fy = ry * fDir;
            (*af).f3.z += fx;
            (*af).f3.w += fy;
            (*af).totalForce.x += fx;
            (*af).totalForce.y += fy;

            // Analytical jerk for pion emission radiation
            if (radOn) {
                let jRadial = -(3.0 * invRSq + 3.0 * mu * invR + mu * mu)
                              * rDotVr * uniforms.yukawaCoupling * yukModPair * pMass * sMass
                              * expMuR * invRSq * yukInvRa;
                (*jerkOut).x += vrx * fDir + rx * jRadial;
                (*jerkOut).y += vry * fDir + ry * jRadial;
            }
        }
    }

    // 1PN: EIH remainder, Bažański, scalar Breit (shared-1pn.wgsl)
    if (onePNOn) {
        let f = pair1PN(vec2(rx, ry), invR, invRSq,
                        vec2(pVelX, pVelY), vec2(svx, svy),
                        pMass, sMass, pCharge, sCharge,
                        gmOn, bazOn, yukInRange, relOn,
                        mu, uniforms.yukawaCoupling * yukModPair);
        (*af).f2.x += f.x;
        (*af).f2.y += f.y;
        (*af).totalForce.x += f.x;
        (*af).totalForce.y += f.y;
    }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let pIdx = gid.x;
    if (pIdx >= uniforms.aliveCount) { return; }

    let ps = particleState[pIdx];
    if ((ps.flags & FLAG_ALIVE) == 0u) { return; }
    if ((ps.flags & FLAG_GHOST) != 0u) { return; } // Ghosts don't receive forces

    let px = ps.posX;
    let py = ps.posY;
    let pMass = ps.mass;
    let pCharge = ps.charge;
    let pDerived = derived_in[pIdx];
    let pMagMoment = pDerived.magMoment;
    let pAngMomentum = pDerived.angMomentum;
    let pBodyRadiusSq = pDerived.bodyRSq; // true body radius² from cache-derived
    // Pre-hoist ri5 = mass^(5/3) for tidal locking (avoids pow() per pair in accumulateForce)
    let pBodyRadius = sqrt(pBodyRadiusSq);
    let pRi5 = pBodyRadiusSq * pBodyRadiusSq * pBodyRadius;
    let pAngW = ps.angW;
    let pAym = axYukMod_in[pIdx];
    let pAxMod = pAym.x;
    let pYukMod = pAym.y;
    let pHiggsMod = pAym.z;

    // Derive velocity from proper velocity
    let wSq = ps.velWX * ps.velWX + ps.velWY * ps.velWY;
    let relOn = (uniforms.toggles0 & RELATIVITY_BIT) != 0u;
    let invGamma = select(1.0, 1.0 / sqrt(1.0 + wSq), relOn);
    let pVelX = ps.velWX * invGamma;
    let pVelY = ps.velWY * invGamma;
    let pAngVel = select(pAngW, pAngW / sqrt(1.0 + pAngW * pAngW * pBodyRadiusSq), relOn);

    let pInvMass = pDerived.invMass;

    let thetaSq = uniforms.bhTheta * uniforms.bhTheta;

    // G9: Hoist toggle reads before the tree walk loop (avoids repeated uniform reads per call)
    let _t0 = uniforms.toggles0;
    // With Relativity on, EM runs pairwise (Liénard–Wiechert) and the walk leaves it out
    let _emHere  = (uniforms.toggles1 & EM_PAIRWISE_BIT) == 0u;
    let _gravOn  = (_t0 & GRAVITY_BIT)     != 0u;
    let _coulOn  = (_t0 & COULOMB_BIT)     != 0u && _emHere;
    let _magOn   = (_t0 & MAGNETIC_BIT)    != 0u && _emHere;
    let _gmOn    = (_t0 & GRAVITOMAG_BIT)  != 0u;
    let _yukOn   = (_t0 & YUKAWA_BIT)      != 0u;
    let _onePNOn = (_t0 & ONE_PN_BIT)      != 0u;
    let _bazOn   = _gmOn && (_t0 & COULOMB_BIT) != 0u;
    let _higgsOn = (_t0 & HIGGS_BIT)       != 0u;
    let _radOn   = (_t0 & RADIATION_BIT)   != 0u;
    let _bhOn    = (_t0 & BLACK_HOLE_BIT)  != 0u;
    let _needAxMod = (_coulOn || _magOn) && (_t0 & AXION_BIT) != 0u;

    // Local jerk accumulator for radiation analytical jerk
    var localJerk = vec2<f32>(0.0, 0.0);

    // Load AllForces struct ONCE from global memory (zeroed by resetForces, or holding the
    // pairwise EM pass's result)
    var localAF = allForces[pIdx];

    let isPeriodic = uniforms.boundaryMode == BOUND_LOOP;
    let domW = uniforms.domainW;
    let domH = uniforms.domainH;
    let topo = uniforms.topologyMode;

    // Forces are computed at pre-drift positions, so the observer sits one substep back
    // on the world-line clock: dη = dt/a
    let sdTime = uniforms.simTime - uniforms.dt / uniforms.scaleA;

    // Stack-based iterative tree walk
    var stack: array<u32, 48>;
    var stackTop: u32 = 0u;
    stack[0] = 0u; // push root
    stackTop = 1u;

    loop {
        if (stackTop == 0u) { break; }
        stackTop -= 1u;
        let nodeIdx = stack[stackTop];

        // Ghost leaves weigh nothing (tree-build.wgsl), so they end here
        let nodeMass = getTotalMass(nodeIdx);
        if (nodeMass < EPSILON) { continue; }

        let comX = getComX(nodeIdx);
        let comY = getComY(nodeIdx);
        var comDisp = vec2<f32>(comX - px, comY - py);
        if (isPeriodic) {
            comDisp = fullMinImageP(px, py, comX, comY, domW, domH, topo);
        }
        let dSq = dot(comDisp, comDisp);
        let size = getMaxX(nodeIdx) - getMinX(nodeIdx); // node width

        let isLeaf = getNW(nodeIdx) == NONE;
        let particleIdx = getParticleIndex(nodeIdx);

        if (isLeaf && particleIdx >= 0) {
            // Leaf node: accumulate from the individual particle
            let sIdx = u32(particleIdx);
            if (sIdx == pIdx) { continue; }
            let sPs = particleState[sIdx];
            let sIsRetired = (sPs.flags & FLAG_RETIRED) != 0u && (sPs.flags & FLAG_ALIVE) == 0u;
            if ((sPs.flags & FLAG_ALIVE) == 0u && !sIsRetired) { continue; }
            if (sIsRetired && !relOn) { continue; }
            let sAYM = axYukMod_in[sIdx];

            if (relOn) {
                // The source's retarded state; a retired source's world line ends at its death
                let ret = retardedState(
                    sIdx, px, py, sdTime,
                    vec2(sPs.posX, sPs.posY), vec2(sPs.velWX, sPs.velWY), sPs.angW, sPs.mass, sPs.charge,
                    !sIsRetired, isPeriodic, domW, domH, topo, uniforms.scaleA,
                );
                if (!ret.valid) { continue; }
                let bodyRadSq = pow(max(ret.mass, EPSILON), 2.0 / 3.0);
                let sAngVelRet = ret.angw / sqrt(1.0 + ret.angw * ret.angw * bodyRadSq);
                let sMagMomRet = MAG_MOMENT_K * ret.charge * sAngVelRet * bodyRadSq;
                let sAngMomRet = INERTIA_K * ret.mass * sAngVelRet * bodyRadSq;
                accumulateForce(
                    &localAF, ret.rel.x, ret.rel.y, pMass, pCharge,
                    pMagMoment, pAngMomentum, pAngVel, pVelX, pVelY,
                    pAxMod, pYukMod, pHiggsMod,
                    ret.vel.x, ret.vel.y,
                    ret.mass, ret.charge,
                    sAngVelRet, sMagMomRet, sAngMomRet,
                    select(sAYM.x, 1.0, abs(sAYM.x) < EPSILON),
                    select(sAYM.y, 1.0, abs(sAYM.y) < EPSILON),
                    select(sAYM.z, 1.0, abs(sAYM.z) < EPSILON),
                    pRi5,
                    &localJerk,
                    true, // aberration
                    _gravOn, _coulOn, _magOn, _gmOn, _yukOn, _onePNOn, _bazOn, _higgsOn, _radOn, _bhOn,
                    relOn, _needAxMod,
                );
            } else {
                var d = vec2<f32>(sPs.posX - px, sPs.posY - py);
                if (isPeriodic) { d = fullMinImageP(px, py, sPs.posX, sPs.posY, domW, domH, topo); }
                let sDerived = derived_in[sIdx];
                accumulateForce(
                    &localAF, d.x, d.y, pMass, pCharge,
                    pMagMoment, pAngMomentum, pAngVel, pVelX, pVelY,
                    pAxMod, pYukMod, pHiggsMod,
                    sDerived.velX, sDerived.velY,
                    sPs.mass, sPs.charge,
                    sDerived.angVel,
                    sDerived.magMoment, sDerived.angMomentum,
                    sAYM.x, sAYM.y, sAYM.z,
                    pRi5,
                    &localJerk,
                    false, // no aberration
                    _gravOn, _coulOn, _magOn, _gmOn, _yukOn, _onePNOn, _bazOn, _higgsOn, _radOn, _bhOn,
                    relOn, _needAxMod,
                );
            }
        } else if (!isLeaf && (size * size < thetaSq * dSq)) {
            // Distant node: aggregate multipole data at its current centre of mass
            let avgVx = getTotalMomX(nodeIdx) / nodeMass;
            let avgVy = getTotalMomY(nodeIdx) / nodeMass;

            accumulateForce(
                &localAF, comDisp.x, comDisp.y, pMass, pCharge,
                pMagMoment, pAngMomentum, pAngVel, pVelX, pVelY,
                pAxMod, pYukMod, pHiggsMod,
                avgVx, avgVy,
                nodeMass, getTotalCharge(nodeIdx),
                0.0, // sAngVel = 0 for aggregate
                getTotalMagMoment(nodeIdx), getTotalAngMomentum(nodeIdx),
                1.0, 1.0, 1.0, // axMod/yukMod/higgsMod = 1 for aggregate
                pRi5,
                &localJerk,
                false, // no aberration on aggregate nodes — velocities are not delayed
                _gravOn, _coulOn, _magOn, _gmOn, _yukOn, _onePNOn, _bazOn, _higgsOn, _radOn, _bhOn,
                relOn, _needAxMod,
            );
        } else if (!isLeaf) {
            // Push children (only valid ones; NONE = -1 would become garbage u32)
            if (stackTop + 4u <= MAX_STACK) {
                let nw = getNW(nodeIdx);
                let ne = getNE(nodeIdx);
                let sw = getSW(nodeIdx);
                let se = getSE(nodeIdx);
                if (nw != NONE) { stack[stackTop] = u32(nw); stackTop += 1u; }
                if (ne != NONE) { stack[stackTop] = u32(ne); stackTop += 1u; }
                if (sw != NONE) { stack[stackTop] = u32(sw); stackTop += 1u; }
                if (se != NONE) { stack[stackTop] = u32(se); stackTop += 1u; }
            }
        }
    }

    // Write accumulated jerk to AllForces (NaN guard)
    localAF.jerk += vec2(
        select(localJerk.x, 0.0, localJerk.x != localJerk.x),
        select(localJerk.y, 0.0, localJerk.y != localJerk.y)
    );

    // NaN guard on B-field accumulators — corruption propagates to Boris rotation + spin-orbit
    localAF.bFields = vec4(
        select(localAF.bFields.x, 0.0, localAF.bFields.x != localAF.bFields.x),
        select(localAF.bFields.y, 0.0, localAF.bFields.y != localAF.bFields.y),
        localAF.bFields.z, localAF.bFields.w);
    localAF.bFieldGrads = vec4(
        select(localAF.bFieldGrads.x, 0.0, localAF.bFieldGrads.x != localAF.bFieldGrads.x),
        select(localAF.bFieldGrads.y, 0.0, localAF.bFieldGrads.y != localAF.bFieldGrads.y),
        select(localAF.bFieldGrads.z, 0.0, localAF.bFieldGrads.z != localAF.bFieldGrads.z),
        select(localAF.bFieldGrads.w, 0.0, localAF.bFieldGrads.w != localAF.bFieldGrads.w));

    // Write accumulated forces back to global memory ONCE
    allForces[pIdx] = localAF;

    // Adaptive substepping: atomicMax of |F/m| as fixed-point u32
    let totalFSq = localAF.totalForce.x * localAF.totalForce.x + localAF.totalForce.y * localAF.totalForce.y;
    let accelSq = totalFSq * pInvMass * pInvMass;
    if (accelSq == accelSq && accelSq < 1e20) {
        let accelBits = bitcast<u32>(sqrt(accelSq));
        atomicMax(&maxAccel[0], accelBits);
    }
}
