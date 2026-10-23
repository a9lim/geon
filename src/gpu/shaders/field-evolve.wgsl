// ─── Scalar Field Evolution (Fused) ───
// KDK half-kicks compute Laplacian inline (no separate Laplacian pass).
// NaN/Inf fixup integrated into drift + kick (no separate fixup pass).

@group(0) @binding(0) var<storage, read_write> field: array<f32>;
@group(0) @binding(1) var<storage, read_write> fieldDot: array<f32>;
@group(0) @binding(2) var<storage, read> otherField: array<f32>;       // cross-field for portal coupling (was laplacian)
@group(0) @binding(3) var<storage, read_write> source: array<f32>;     // rw for encoder compat
@group(0) @binding(4) var<storage, read_write> thermal: array<f32>;    // rw for encoder compat
@group(0) @binding(5) var<storage, read_write> metricPhi: array<f32>;     // rw for encoder compat
@group(0) @binding(6) var<storage, read_write> metricPhiDot: array<f32>;  // rw for encoder compat
@group(0) @binding(7) var<storage, read_write> fieldGradX: array<f32>;  // field gradients (rw for computeGridGradients)
@group(0) @binding(8) var<storage, read_write> fieldGradY: array<f32>;
@group(0) @binding(9) var<uniform> uniforms: FieldUniforms;

// ─── Metric coefficients ───
// Fields evolve in ds² = −e^{2Φ}dt² + e^{−2Φ}d𝐱² (Φ from field-gravity.wgsl),
// where the Klein–Gordon equation is exactly
//   φ̈ = e^{4Φ}∇²φ − e^{2Φ}V′ + 4Φ̇φ̇,
// with no gradient-coupling term. It linearizes to the 3+1 weak-field form
// (1+4Φ)∇²φ − (1+2Φ)V′ + 4Φ̇φ̇ and never degenerates. A point particle couples
// through its proper time (e^{Φ}/γ dt, the 1/γ applied at deposit), so its
// source carries e^{4Φ}·e^{Φ} = e^{5Φ}. Damping is a rate in proper time, so it
// picks up one lapse factor e^{Φ}. Returns (e^{4Φ}, e^{2Φ}, e^{Φ}, Φ̇).
//
// Under expansion the field is the 3D field of a slab of FRW: φ̈ + 3Hφ̇ − ∇²φ + V′ = source/a,
// with ∇² in physical coordinates (the grid is comoving, so its cells grow with a) and the
// source spread over a slab a·ℓ thick.
fn metricCoeffs(idx: u32) -> vec4<f32> {
    if (uniforms.gravityEnabled == 0u) { return vec4<f32>(1.0, 1.0, 1.0, 0.0); }
    let lapse = exp(clamp(metricPhi[idx], -METRIC_PHI_CLAMP, METRIC_PHI_CLAMP));
    let lapseSq = lapse * lapse;
    return vec4<f32>(lapseSq * lapseSq, lapseSq, lapse, metricPhiDot[idx]);
}

// ─── Inline Laplacian helper ───
// 5-point stencil with topology-aware border handling.
fn inlineLaplacian(ix: u32, iy: u32, idx: u32, invCWsq: f32, invCHsq: f32) -> f32 {
    let fC = field[idx];

    // Interior fast path (covers ~99.6% of cells)
    if (ix > 0u && ix < GRID_LAST && iy > 0u && iy < GRID_LAST) {
        return (field[idx - 1u] + field[idx + 1u] - 2.0 * fC) * invCWsq
             + (field[idx - GRID] + field[idx + GRID] - 2.0 * fC) * invCHsq;
    }

    // Border: topology-aware via nbIndex
    let bcMode = uniforms.boundaryMode;
    let topoMode = uniforms.topologyMode;
    let vacValue = select(0.0, 1.0, uniforms.currentFieldType == 0u);
    let iL = nbIndex(i32(ix) - 1, i32(iy), bcMode, topoMode);
    let iR = nbIndex(i32(ix) + 1, i32(iy), bcMode, topoMode);
    let iT = nbIndex(i32(ix), i32(iy) - 1, bcMode, topoMode);
    let iB = nbIndex(i32(ix), i32(iy) + 1, bcMode, topoMode);
    let fL = select(vacValue, field[max(iL, 0)], iL >= 0);
    let fR = select(vacValue, field[max(iR, 0)], iR >= 0);
    let fT = select(vacValue, field[max(iT, 0)], iT >= 0);
    let fB = select(vacValue, field[max(iB, 0)], iB >= 0);
    return (fL + fR - 2.0 * fC) * invCWsq + (fT + fB - 2.0 * fC) * invCHsq;
}

// ─── Higgs KDK Half-Kick (Fused: inline Laplacian + NaN guard) ───
// V(φ) = -½μ²φ² + ¼λφ⁴, VEV=1, λ=μ²=m_H²/2
// ddphi = e^{4Φ}∇²φ + e^{2Φ}(μ²_eff·φ - μ²·φ³) + e^{5Φ}·source/cellArea - e^{Φ}·2m_H·φ̇ + 4Φ̇φ̇
@compute @workgroup_size(8, 8)
fn higgsHalfKick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let ix = gid.x;
    let iy = gid.y;
    if (ix >= GRID || iy >= GRID) { return; }

    let idx = iy * GRID + ix;
    // G17: Read precomputed cell dims from FieldUniforms (avoids per-thread division)
    let cellW = uniforms.cellW;
    let cellH = uniforms.cellH;
    let cellArea = cellW * cellH;
    let invCellArea = select(0.0, 1.0 / cellArea, cellArea > EPSILON);
    let invCWsq = uniforms.invCellWSq;
    let invCHsq = uniforms.invCellHSq;

    let mH = uniforms.higgsMass;
    let muSq = 0.5 * mH * mH;
    let damp = select(0.0, 2.0 * mH, uniforms.damping != 0u);
    let halfDt = uniforms.dt * 0.5;

    let phi = field[idx];
    let lapI = inlineLaplacian(ix, iy, idx, invCWsq, invCHsq);
    let muSqEff = muSq - thermal[idx];  // Phase transition: KE reduces effective μ²
    let srcTerm = source[idx] * invCellArea * uniforms.invScaleA;
    let fdC = fieldDot[idx];

    // Numerical viscosity: ν·∇²(ȧ) with ν = 1/(2√(1/dx²+1/dy²)) → Q=1 at Nyquist, vanishes for physical modes
    var fdL: f32; var fdR: f32; var fdT: f32; var fdB: f32;
    if (ix > 0u && ix < GRID_LAST && iy > 0u && iy < GRID_LAST) {
        // Interior fast path: direct indexing
        fdL = fieldDot[idx - 1u];
        fdR = fieldDot[idx + 1u];
        fdT = fieldDot[idx - GRID];
        fdB = fieldDot[idx + GRID];
    } else {
        // Border: topology-aware via nbIndex
        let bcMode = uniforms.boundaryMode;
        let topoMode = uniforms.topologyMode;
        let iL = nbIndex(i32(ix) - 1, i32(iy), bcMode, topoMode);
        let iR = nbIndex(i32(ix) + 1, i32(iy), bcMode, topoMode);
        let iT = nbIndex(i32(ix), i32(iy) - 1, bcMode, topoMode);
        let iB = nbIndex(i32(ix), i32(iy) + 1, bcMode, topoMode);
        fdL = select(fdC, fieldDot[iL], iL >= 0);
        fdR = select(fdC, fieldDot[iR], iR >= 0);
        fdT = select(fdC, fieldDot[iT], iT >= 0);
        fdB = select(fdC, fieldDot[iB], iB >= 0);
    }
    let fdLap = (fdL + fdR - 2.0 * fdC) * invCWsq + (fdT + fdB - 2.0 * fdC) * invCHsq;
    let viscosity = 0.5 * inverseSqrt(invCWsq + invCHsq) * fdLap;

    // −V′ (thermally shifted) and the Higgs–axion portal −λa²φ
    var force = muSqEff * phi - muSq * phi * phi * phi;
    if (uniforms.higgsEnabled != 0u && uniforms.axionEnabled != 0u) {
        let portalA = otherField[idx];
        force -= HIGGS_AXION_COUPLING * portalA * portalA * phi;
    }

    let mc = metricCoeffs(idx);
    let ddphi = mc.x * lapI + mc.y * force + mc.x * mc.z * srcTerm
              - mc.z * damp * fdC + viscosity + 4.0 * mc.w * fdC - 3.0 * uniforms.hubble * fdC;

    var newFdot = fdC + ddphi * halfDt;
    // NaN/Inf guard: reset fieldDot and field to VEV (matching CPU higgs-field.js:112)
    if (newFdot != newFdot || abs(newFdot) > 1e6) {
        newFdot = 0.0;
        field[idx] = 1.0;  // Reset to VEV=1
    }
    fieldDot[idx] = newFdot;
}

// ─── Axion KDK Half-Kick (Fused: inline Laplacian + NaN guard) ───
// V(a) = ½m_a²a², vacuum at a=0
// ddA = e^{4Φ}∇²a - e^{2Φ}·m_a²·a + e^{5Φ}·source/cellArea - e^{Φ}·g·m_a·ȧ + 4Φ̇ȧ
@compute @workgroup_size(8, 8)
fn axionHalfKick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let ix = gid.x;
    let iy = gid.y;
    if (ix >= GRID || iy >= GRID) { return; }

    let idx = iy * GRID + ix;
    // G17: Read precomputed cell dims from FieldUniforms (avoids per-thread division)
    let cellW = uniforms.cellW;
    let cellH = uniforms.cellH;
    let cellArea = cellW * cellH;
    let invCellArea = select(0.0, 1.0 / cellArea, cellArea > EPSILON);
    let invCWsq = uniforms.invCellWSq;
    let invCHsq = uniforms.invCellHSq;

    let mA = uniforms.axionMass;
    let mASq = mA * mA;
    let damp = select(0.0, uniforms.axionCoupling * mA, uniforms.damping != 0u);  // ζ=g/2, Q=1/g → damp = g*m_a

    let aVal = field[idx];
    let lapI = inlineLaplacian(ix, iy, idx, invCWsq, invCHsq);
    let srcTerm = source[idx] * invCellArea * uniforms.invScaleA;
    let fdC = fieldDot[idx];

    // Numerical viscosity: ν·∇²(ȧ) with ν = 1/(2√(1/dx²+1/dy²)) → Q=1 at Nyquist, vanishes for physical modes
    var fdL: f32; var fdR: f32; var fdT: f32; var fdB: f32;
    if (ix > 0u && ix < GRID_LAST && iy > 0u && iy < GRID_LAST) {
        // Interior fast path: direct indexing
        fdL = fieldDot[idx - 1u];
        fdR = fieldDot[idx + 1u];
        fdT = fieldDot[idx - GRID];
        fdB = fieldDot[idx + GRID];
    } else {
        // Border: topology-aware via nbIndex
        let bcMode = uniforms.boundaryMode;
        let topoMode = uniforms.topologyMode;
        let iL = nbIndex(i32(ix) - 1, i32(iy), bcMode, topoMode);
        let iR = nbIndex(i32(ix) + 1, i32(iy), bcMode, topoMode);
        let iT = nbIndex(i32(ix), i32(iy) - 1, bcMode, topoMode);
        let iB = nbIndex(i32(ix), i32(iy) + 1, bcMode, topoMode);
        fdL = select(fdC, fieldDot[iL], iL >= 0);
        fdR = select(fdC, fieldDot[iR], iR >= 0);
        fdT = select(fdC, fieldDot[iT], iT >= 0);
        fdB = select(fdC, fieldDot[iB], iB >= 0);
    }
    let fdLap = (fdL + fdR - 2.0 * fdC) * invCWsq + (fdT + fdB - 2.0 * fdC) * invCHsq;
    let viscosity = 0.5 * inverseSqrt(invCWsq + invCHsq) * fdLap;

    // −V′ and the Higgs–axion portal −λφ²a
    var force = -mASq * aVal;
    if (uniforms.higgsEnabled != 0u && uniforms.axionEnabled != 0u) {
        let portalPhi = otherField[idx];
        force -= HIGGS_AXION_COUPLING * portalPhi * portalPhi * aVal;
    }

    let mc = metricCoeffs(idx);
    let ddA = mc.x * lapI + mc.y * force + mc.x * mc.z * srcTerm
            - mc.z * damp * fdC + viscosity + 4.0 * mc.w * fdC - 3.0 * uniforms.hubble * fdC;

    var newFdot = fdC + ddA * (uniforms.dt * 0.5);
    // NaN/Inf guard on fieldDot only (Axion vacuum is 0.0, handled by drift fixup)
    if (newFdot != newFdot || abs(newFdot) > 1e6) { newFdot = 0.0; }
    fieldDot[idx] = newFdot;
}

// ─── Field Drift (with NaN/Inf fixup) ───
// field += fieldDot * dt, clamped to [-SCALAR_FIELD_MAX, SCALAR_FIELD_MAX]
@compute @workgroup_size(8, 8)
fn fieldDrift(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.y * GRID + gid.x;
    if (gid.x >= GRID || gid.y >= GRID) { return; }

    var newField = field[idx] + fieldDot[idx] * uniforms.dt;

    // NaN/Inf fixup: reset to vacuum value
    if (newField != newField || abs(newField) > 1e6) {
        let vacValue = select(0.0, 1.0, uniforms.currentFieldType == 0u);
        newField = vacValue;
        fieldDot[idx] = 0.0;
    }

    field[idx] = clamp(newField, -SCALAR_FIELD_MAX, SCALAR_FIELD_MAX);
}

// ─── Grid Gradients (central differences) ───
@compute @workgroup_size(8, 8)
fn computeGridGradients(@builtin(global_invocation_id) gid: vec3<u32>) {
    let ix = gid.x;
    let iy = gid.y;
    if (ix >= GRID || iy >= GRID) { return; }

    let idx = iy * GRID + ix;
    let bcMode = uniforms.boundaryMode;
    let topoMode = uniforms.topologyMode;
    let vacValue = select(0.0, 1.0, uniforms.currentFieldType == 0u);

    // Note: gradX/gradY are bound as read_write via separate bind group for output
    // Interior fast path
    if (ix > 0u && ix < GRID_LAST && iy > 0u && iy < GRID_LAST) {
        fieldGradX[idx] = (field[idx + 1u] - field[idx - 1u]) * 0.5;
        fieldGradY[idx] = (field[idx + GRID] - field[idx - GRID]) * 0.5;
        return;
    }

    // Border path
    let iL = nbIndex(i32(ix) - 1, i32(iy), bcMode, topoMode);
    let iR = nbIndex(i32(ix) + 1, i32(iy), bcMode, topoMode);
    let iT = nbIndex(i32(ix), i32(iy) - 1, bcMode, topoMode);
    let iB = nbIndex(i32(ix), i32(iy) + 1, bcMode, topoMode);
    let fL = select(vacValue, field[max(iL, 0)], iL >= 0);
    let fR = select(vacValue, field[max(iR, 0)], iR >= 0);
    let fT = select(vacValue, field[max(iT, 0)], iT >= 0);
    let fB = select(vacValue, field[max(iB, 0)], iB >= 0);
    fieldGradX[idx] = (fR - fL) * 0.5;
    fieldGradY[idx] = (fB - fT) * 0.5;
}
