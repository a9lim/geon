// Spin-orbit coupling: energy transfer + translational kicks.
// Stern-Gerlach: F = +μ ∇Bz (magnetic moment in B-field gradient).
// Mathisson-Papapetrou: F = +2L ∇Bgz. With F = 4m v × Bg on a point mass, a spinning body's
// gravitomagnetic moment is (4m/2m)·L = 2L, H = −2L·Bg.
// The gradients are of the moving-source fields only: spin-spin forces are the direct
// dipole-dipole terms in the force pass, so dipole fields carry no gradient here.
// Energy coupling: the kick's work F·v comes out of the spin, dω = −F·v dt/L.
//
// Uses packed ParticleState + ParticleDerived + AllForces structs.

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<ParticleState>;
@group(0) @binding(2) var<storage, read_write> derived: array<ParticleDerived>;
@group(0) @binding(3) var<storage, read_write> allForces: array<AllForces>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= uniforms.aliveCount) { return; }
    if ((particles[idx].flags & FLAG_ALIVE) == 0u) { return; }

    let spinOrbitOn = hasToggle0(SPIN_ORBIT_BIT);
    let hasMag = hasToggle0(MAGNETIC_BIT);
    let hasGM = hasToggle0(GRAVITOMAG_BIT);
    if (!spinOrbitOn || (!hasMag && !hasGM)) { return; }

    let aw = particles[idx].angW;
    let d = derived[idx];
    let aVel = d.angVel;
    if (abs(aVel) < EPSILON) { return; }

    let angMom = d.angMomentum;

    let m = particles[idx].mass;
    let q = particles[idx].charge;
    let invM = select(0.0, 1.0 / m, m > EPSILON);
    let dtOverM = uniforms.dt * invM;
    // Radius from derived radiusSq (sqrt)
    let r = sqrt(d.radiusSq);
    let relOn = hasToggle0(RELATIVITY_BIT);

    let vx = d.velX;
    let vy = d.velY;
    let mu = d.magMoment;
    let L = angMom;

    let af = allForces[idx];
    let dBzdx = af.bFieldGrads.x;
    let dBzdy = af.bFieldGrads.y;
    let dBgzdx = af.bFieldGrads.z;
    let dBgzdy = af.bFieldGrads.w;

    var newAngW = aw;
    var kickX: f32 = 0.0;
    var kickY: f32 = 0.0;
    var scX: f32 = 0.0;  // spin-curvature display force
    var scY: f32 = 0.0;
    var soTorque: f32 = 0.0;  // spin-orbit energy coupling torque (for display)

    // Clamp angMom denominator to avoid division-by-zero and extreme kicks in energy transfer.
    // Translational kicks (Stern-Gerlach, Mathisson-Papapetrou) still apply when angMom is small.
    // Floor at 1e-4 (not EPSILON) to prevent huge angular velocity changes for light spinning particles.
    let angMomSign = select(-1.0, 1.0, angMom >= 0.0);
    let safeAngMom = select(angMom, angMomSign * 1e-4, abs(angMom) < 1e-4);

    if (hasMag && abs(q) > EPSILON) {
        // Energy transfer: angw -= mu * (v . grad(Bz)) * dt / (I*omega)
        let sgCoupling = mu * (vx * dBzdx + vy * dBzdy);
        newAngW -= sgCoupling * uniforms.dt / safeAngMom;
        soTorque -= sgCoupling;  // record for display
        // Stern-Gerlach translational kick
        let sgX = mu * dBzdx * dtOverM;
        let sgY = mu * dBzdy * dtOverM;
        kickX += sgX;
        kickY += sgY;
        scX += mu * dBzdx;
        scY += mu * dBzdy;
    }

    if (hasGM) {
        // Energy transfer: angw -= 2L * (v . grad(Bgz)) * dt / (I*omega)
        let mpCoupling = 2.0 * L * (vx * dBgzdx + vy * dBgzdy);
        newAngW -= mpCoupling * uniforms.dt / safeAngMom;
        soTorque -= mpCoupling;  // record for display
        // Mathisson-Papapetrou translational kick, F = 2L ∇Bgz
        let mpX = 2.0 * L * dBgzdx * dtOverM;
        let mpY = 2.0 * L * dBgzdy * dtOverM;
        kickX += mpX;
        kickY += mpY;
        scX += 2.0 * L * dBgzdx;
        scY += 2.0 * L * dBgzdy;
    }

    // NaN guard
    if (newAngW != newAngW) { newAngW = 0.0; }

    // Derive angular velocity from angular proper velocity
    let sr = newAngW * r;
    let newAngVel = select(newAngW, newAngW / sqrt(1.0 + sr * sr), relOn);

    particles[idx].angW = newAngW;

    // Update angVel in derived struct
    var dOut = derived[idx];
    dOut.angVel = newAngVel;
    derived[idx] = dOut;

    // Apply translational kicks to proper velocity
    particles[idx].velWX = particles[idx].velWX + kickX;
    particles[idx].velWY = particles[idx].velWY + kickY;

    // Store spin-curvature display force in allForces.f2.zw
    // Store spin-orbit energy coupling torque in allForces.torques.x
    var afOut = allForces[idx];
    afOut.f2.z = scX;
    afOut.f2.w = scY;
    afOut.torques.x = soTorque;
    allForces[idx] = afOut;
}
