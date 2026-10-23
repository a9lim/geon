// ─── The scalar fields in expansion's energy ledger ───
// A field's slab energy is a·E, E = Σ(½φ̇² + ½|∇φ|² + V)·cellArea on the comoving grid
// (cosmology.js). Expansion changes it two ways, and this pass books both into
// cosmoAccum[0] (the energy expansion took; f32 bits, compare-and-swap):
//   modes 0 and 2, every substep: around hubbleFriction (field-evolve.wgsl), +a·K before and
//                            −a·K after, so W gets exactly the kinetic energy friction removed
//   mode 1, at each stretch: cells ×r², gradients² ×1/r², thickness ×r, so the slab energy
//                            changes by a[(r³ − 1)(K + V) + (r − 1)G]
// Together these give d(ρa³) = −3HP·a³ dt for a homogeneous field. One workgroup sums the
// grid from the live state, so nothing lags a readback. (K and V here are the grid's own;
// the gradient term uses wrapped central differences, which the evolution's 5-point
// Laplacian doesn't share exactly, so G's booking is approximate.)

struct LedgerUniforms {
    mode: u32,          // 0 before friction, 2 after it, 1 stretch
    higgsOn: u32,
    axionOn: u32,
    _pad0: u32,
    scaleA: f32,        // a when the step began
    ratio: f32,         // stretch: a_new/a_old
    _pad1: f32,
    cellArea: f32,
    invCellWSq: f32,
    invCellHSq: f32,
    higgsMass: f32,
    axionMass: f32,
};

@group(0) @binding(0) var<uniform> lu: LedgerUniforms;
@group(0) @binding(1) var<storage, read> higgsField: array<f32>;
@group(0) @binding(2) var<storage, read> higgsFieldDot: array<f32>;
@group(0) @binding(3) var<storage, read> axionField: array<f32>;
@group(0) @binding(4) var<storage, read> axionFieldDot: array<f32>;
@group(0) @binding(5) var<storage, read_write> cosmoAccum: array<atomic<u32>>;

const FL_WG: u32 = 256u;
var<workgroup> shK: array<f32, FL_WG>;
var<workgroup> shG: array<f32, FL_WG>;
var<workgroup> shV: array<f32, FL_WG>;

fn wrapIdx(ix: i32, iy: i32) -> u32 {
    let g = i32(GRID);
    return u32(((iy % g) + g) % g) * GRID + u32(((ix % g) + g) % g);
}

/** ½|∇φ|² by central differences (periodic: expansion always runs in loop mode). */
fn gradEnergy(ix: i32, iy: i32, isHiggs: bool) -> f32 {
    var dx: f32;
    var dy: f32;
    if (isHiggs) {
        dx = higgsField[wrapIdx(ix + 1, iy)] - higgsField[wrapIdx(ix - 1, iy)];
        dy = higgsField[wrapIdx(ix, iy + 1)] - higgsField[wrapIdx(ix, iy - 1)];
    } else {
        dx = axionField[wrapIdx(ix + 1, iy)] - axionField[wrapIdx(ix - 1, iy)];
        dy = axionField[wrapIdx(ix, iy + 1)] - axionField[wrapIdx(ix, iy - 1)];
    }
    return 0.125 * (dx * dx * lu.invCellWSq + dy * dy * lu.invCellHSq);
}

@compute @workgroup_size(FL_WG)
fn fieldLedger(@builtin(local_invocation_index) lid: u32) {
    var K = 0.0;
    var G = 0.0;
    var V = 0.0;
    let muSqH = 0.5 * lu.higgsMass * lu.higgsMass;
    let mASq = lu.axionMass * lu.axionMass;
    for (var idx = lid; idx < GRID * GRID; idx += FL_WG) {
        let ix = i32(idx % GRID);
        let iy = i32(idx / GRID);
        if (lu.higgsOn != 0u) {
            let phi = higgsField[idx];
            let fd = higgsFieldDot[idx];
            K += 0.5 * fd * fd;
            V += muSqH * (-0.5 * phi * phi + 0.25 * phi * phi * phi * phi) + 0.25 * muSqH;
            if (lu.mode == 1u) { G += gradEnergy(ix, iy, true); }
        }
        if (lu.axionOn != 0u) {
            let a = axionField[idx];
            let fd = axionFieldDot[idx];
            K += 0.5 * fd * fd;
            V += 0.5 * mASq * a * a;
            if (lu.mode == 1u) { G += gradEnergy(ix, iy, false); }
        }
        if (lu.higgsOn != 0u && lu.axionOn != 0u) {
            let phi = higgsField[idx];
            let a = axionField[idx];
            V += 0.5 * HIGGS_AXION_COUPLING * phi * phi * a * a;
        }
    }
    shK[lid] = K;
    shG[lid] = G;
    shV[lid] = V;
    workgroupBarrier();
    for (var s = FL_WG / 2u; s > 0u; s >>= 1u) {
        if (lid < s) {
            shK[lid] += shK[lid + s];
            shG[lid] += shG[lid + s];
            shV[lid] += shV[lid + s];
        }
        workgroupBarrier();
    }
    if (lid != 0u) { return; }

    let area = lu.cellArea;
    var work: f32;
    if (lu.mode != 1u) {
        work = select(-1.0, 1.0, lu.mode == 0u) * lu.scaleA * shK[0] * area;
    } else {
        let r = lu.ratio;
        work = -lu.scaleA * area * ((r * r * r - 1.0) * (shK[0] + shV[0]) + (r - 1.0) * shG[0]);
    }
    if (work == 0.0) { return; }
    var old = atomicLoad(&cosmoAccum[0]);
    loop {
        let res = atomicCompareExchangeWeak(&cosmoAccum[0], old, bitcast<u32>(bitcast<f32>(old) + work));
        if (res.exchanged) { break; }
        old = res.old_value;
    }
}
