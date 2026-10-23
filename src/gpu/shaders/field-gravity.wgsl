// ─── Grid Gravity: the metric potential the scalar fields evolve in ───
// One gravity grid serves both fields. Two potentials are solved by FFT
// convolution with the sheet kernel G(r) = -1/√(r² + ℓ²) (field-fft.wgsl):
//   Φ_F from the fields' energy density (also the field → particle force),
//   Φ_P from the particles' rest mass (deposited by field-deposit.wgsl).
// The fields see the total, metricPhi = Φ_F + Φ_P, and its time derivative.
// Particle–particle gravity stays in the force shaders, so Φ_P is never used
// as a force.

@group(0) @binding(0) var<uniform> uniforms: FieldUniforms;
@group(0) @binding(1) var<storage, read_write> fftComplex: array<f32>;   // interleaved re/im
@group(0) @binding(2) var<storage, read_write> phiF: array<f32>;
@group(0) @binding(3) var<storage, read_write> phiFGradX: array<f32>;    // per cell
@group(0) @binding(4) var<storage, read_write> phiFGradY: array<f32>;
@group(0) @binding(5) var<storage, read_write> phiP: array<f32>;
@group(0) @binding(6) var<storage, read_write> metricPhi: array<f32>;
@group(0) @binding(7) var<storage, read_write> metricPhiPrev: array<f32>;
@group(0) @binding(8) var<storage, read_write> metricPhiDot: array<f32>;
@group(0) @binding(9) var<storage, read_write> massGrid: array<f32>;

// Group 1: one field's state, for packFieldEnergy only.
@group(1) @binding(0) var<storage, read_write> field: array<f32>;
@group(1) @binding(1) var<storage, read_write> fieldDot: array<f32>;
@group(1) @binding(2) var<storage, read_write> gradX: array<f32>;
@group(1) @binding(3) var<storage, read_write> gradY: array<f32>;

// ─── Field energy density → FFT input ───
// ρ = ½φ̇² + ½|∇φ|² + V(φ), written as ρ·dA into the real part. The first
// active field sets the buffer; the second adds to it (gravAccumulate).
@compute @workgroup_size(8, 8)
fn packFieldEnergy(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID || gid.y >= GRID) { return; }
    let idx = gid.y * GRID + gid.x;

    let fd = fieldDot[idx];
    let gxi = gradX[idx];
    let gyi = gradY[idx];
    var rho = 0.5 * fd * fd + 0.5 * (gxi * gxi * uniforms.invCellWSq + gyi * gyi * uniforms.invCellHSq);
    let f = field[idx];
    if (uniforms.currentFieldType == 0u) {
        // Mexican hat V(φ) = μ²/4·(φ²-1)², shifted so V(1) = 0
        let muSq = 0.5 * uniforms.higgsMass * uniforms.higgsMass;
        rho += muSq * (-0.5 * f * f + 0.25 * f * f * f * f) + 0.25 * muSq;
    } else {
        // V(a) = ½m_a²a²
        rho += 0.5 * uniforms.axionMass * uniforms.axionMass * f * f;
    }

    let val = rho * uniforms.cellW * uniforms.cellH;
    if (uniforms.gravAccumulate != 0u) {
        fftComplex[2u * idx] += val;
    } else {
        fftComplex[2u * idx] = val;
    }
    fftComplex[2u * idx + 1u] = 0.0;
}

// ─── Particle mass → FFT input ───
@compute @workgroup_size(8, 8)
fn packMass(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID || gid.y >= GRID) { return; }
    let idx = gid.y * GRID + gid.x;
    fftComplex[2u * idx] = massGrid[idx];
    fftComplex[2u * idx + 1u] = 0.0;
}

// ─── FFT output → Φ_F and its per-cell gradient ───
@compute @workgroup_size(8, 8)
fn unpackPhiF(@builtin(global_invocation_id) gid: vec3<u32>) {
    let ix = gid.x;
    let iy = gid.y;
    if (ix >= GRID || iy >= GRID) { return; }
    let idx = iy * GRID + ix;
    phiF[idx] = fftComplex[2u * idx];

    if (ix > 0u && ix < GRID_LAST && iy > 0u && iy < GRID_LAST) {
        phiFGradX[idx] = (fftComplex[2u * (idx + 1u)] - fftComplex[2u * (idx - 1u)]) * 0.5;
        phiFGradY[idx] = (fftComplex[2u * (idx + GRID)] - fftComplex[2u * (idx - GRID)]) * 0.5;
        return;
    }
    let bcMode = uniforms.boundaryMode;
    let topoMode = uniforms.topologyMode;
    let iR = nbIndex(i32(ix) + 1, i32(iy), bcMode, topoMode);
    let iL = nbIndex(i32(ix) - 1, i32(iy), bcMode, topoMode);
    let iB = nbIndex(i32(ix), i32(iy) + 1, bcMode, topoMode);
    let iT = nbIndex(i32(ix), i32(iy) - 1, bcMode, topoMode);
    let fR = select(0.0, fftComplex[2u * u32(max(iR, 0))], iR >= 0);
    let fL = select(0.0, fftComplex[2u * u32(max(iL, 0))], iL >= 0);
    let fB = select(0.0, fftComplex[2u * u32(max(iB, 0))], iB >= 0);
    let fT = select(0.0, fftComplex[2u * u32(max(iT, 0))], iT >= 0);
    phiFGradX[idx] = (fR - fL) * 0.5;
    phiFGradY[idx] = (fB - fT) * 0.5;
}

// ─── FFT output → Φ_P ───
@compute @workgroup_size(8, 8)
fn unpackPhiP(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID || gid.y >= GRID) { return; }
    let idx = gid.y * GRID + gid.x;
    phiP[idx] = fftComplex[2u * idx];
}

// ─── metricPhi = Φ_F + Φ_P (before the first half-kick) ───
@compute @workgroup_size(8, 8)
fn combineMetric(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID || gid.y >= GRID) { return; }
    let idx = gid.y * GRID + gid.x;
    metricPhi[idx] = phiF[idx] + phiP[idx];
}

// ─── metricPhi after the field drift, and Φ̇ ───
// Φ̇ is the backward difference between consecutive post-drift potentials,
// one substep apart; both half-kicks of the next step use it.
@compute @workgroup_size(8, 8)
fn combineMetricDot(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID || gid.y >= GRID) { return; }
    let idx = gid.y * GRID + gid.x;
    let phi = phiF[idx] + phiP[idx];
    let dt = max(uniforms.dt, EPSILON);
    metricPhiDot[idx] = (phi - metricPhiPrev[idx]) / dt;
    metricPhiPrev[idx] = phi;
    metricPhi[idx] = phi;
}
