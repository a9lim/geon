// ─── 1PN pair forces ───
// The O(v²/c²) two-body corrections that the other force sectors leave out, as one force
// on the observer. Shared by pair-force.wgsl, forces-tree.wgsl and onePN.wgsl, so the
// velocity-Verlet recompute matches the force pass exactly.
//
// r is source − observer (image resolved), invR and invRSq its softened 1/r and 1/r²;
// N = −r/r points from source to observer. Harmonic gauge, order-reduced, equal time;
// softening the denominators is a modeling prescription.
//
//   EIH (Gravitomagnetic + 1PN): the two-body EIH acceleration minus its v₁·v₂ sector,
//     (4M/r²)[N(v₁·v₂) − v₂(N·v₁)], which the Boris rotation supplies as 4m v × Bg:
//       a = (M/r²){N[−v₁² − 2v₂² + (3/2)(N·v₂)² + (5m + 4M)/r] + v₁(4N·v₁ − 3N·v₂) + 3v₂(N·v₂)}.
//     EIH gives dv/dt, the integrator kicks w = γv, and the Newtonian kick already gives
//     dw/dt = a_N, so with Relativity on the 1PN kick adds ½v₁²a_N + v₁(v₁·a_N).
//   Bažański (Gravitomagnetic + Coulomb + 1PN): the mixed Gq² static term beyond what the
//     Liénard–Wiechert field already carries (its acceleration field holds the Darwin
//     induction term): F = [q₁q₂(6m + 5M) − (q₁²M + q₂²m)]·r/r⁴.
//   Scalar Breit (Yukawa + 1PN): massive scalar exchange at O(v²), below.

fn pair1PN(
    r: vec2<f32>, invR: f32, invRSq: f32,
    vo: vec2<f32>, vs: vec2<f32>,
    m: f32, M: f32, qo: f32, qs: f32,
    eihOn: bool, bazOn: bool, breitOn: bool, relOn: bool,
    yukMu: f32, yukCoupling: f32,   // Higgs-modulated μ; coupling × yukMod pair factor
) -> vec2<f32> {
    var f = vec2(0.0);
    let N = -r * invR;

    if (eihOn) {
        let vo2 = dot(vo, vo);
        let vs2 = dot(vs, vs);
        let nVo = dot(N, vo);
        let nVs = dot(N, vs);
        let k = M * invRSq;
        let radial = -vo2 - 2.0 * vs2 + 1.5 * nVs * nVs + (5.0 * m + 4.0 * M) * invR;
        var a = k * (N * radial + vo * (4.0 * nVo - 3.0 * nVs) + vs * (3.0 * nVs));
        if (relOn) {
            let aN = -k * N;
            a += 0.5 * vo2 * aN + vo * dot(vo, aN);
        }
        f += m * a;
    }

    if (bazOn) {
        let crossCoeff = qo * qs * (6.0 * m + 5.0 * M) - (qo * qo * M + qs * qs * m);
        f += r * (crossCoeff * invRSq * invRSq);
    }

    if (breitOn && m > EPSILON && M > EPSILON) {
        // From L = (K e^{−μr}/r)[1 + ½(−v₁² − v₂² + v₁·v₂ − α(n·v₁)(n·v₂))], K = g m₁m₂, the
        // scalar sourced by m/γ (Chen, Tu & Wang 2021, arXiv:2111.00211, Eq. 59); the acceleration terms are
        // order-reduced with the two-body Yukawa accelerations (the H term). n points to the
        // source here. This is the kick correction, d(γv)/dt.
        let rLen = 1.0 / invR;
        let muR = yukMu * rLen;
        let expMuR = select(0.0, exp(-muR), muR < 80.0);
        let n = r * invR;
        let a = dot(n, vo);
        let b = dot(n, vs);
        let alpha = 1.0 + muR;
        let beta = 0.5 * yukCoupling * m * M * expMuR * invRSq;
        let D = alpha * alpha + alpha + 1.0;
        let f0 = 2.0 * alpha * beta;
        let H = rLen * f0 * (2.0 / m + (1.0 - alpha) / M);
        f += beta * (n * (-alpha * dot(vo, vo) - D * b * b + H) + 2.0 * alpha * ((a - b) * vo + b * vs));
    }

    return f;
}
