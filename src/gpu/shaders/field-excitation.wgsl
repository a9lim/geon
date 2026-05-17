// ─── Field Excitations ───
// Deposit Gaussian wave packets from collision events into fieldDot.
// The amplitude is solved so the immediate field kinetic-energy increase
// equals the event energy, including the current local fieldDot cross term.

// Excitation events are written to a small append buffer by the collision resolve pass.
struct ExcitationEvent {
    x: f32,
    y: f32,
    energy: f32,
    _pad: f32,
};

@group(0) @binding(0) var<storage, read_write> fieldDot: array<f32>;
@group(0) @binding(1) var<storage, read> events: array<ExcitationEvent>;
@group(0) @binding(2) var<uniform> uniforms: FieldUniforms;
@group(0) @binding(3) var<storage, read> eventCount: array<u32>;  // [0] = count

@compute @workgroup_size(1)
fn depositExcitations(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x != 0u || gid.y != 0u) { return; }

    let nEvents = eventCount[0];
    if (nEvents == 0u) { return; }

    let cellW = uniforms.domainW / f32(GRID);
    let cellH = uniforms.domainH / f32(GRID);
    if (cellW < EPSILON || cellH < EPSILON) { return; }

    let sigma = FIELD_EXCITATION_SIGMA;
    let sigmaSq = sigma * sigma;
    let cutoffSq = 9.0 * sigmaSq;  // 3σ cutoff
    let cellArea = cellW * cellH;
    let last = i32(GRID) - 1;

    for (var e = 0u; e < nEvents; e++) {
        let evt = events[e];
        if (evt.energy < EPSILON) { continue; }

        let gxEvt = evt.x / cellW;
        let gyEvt = evt.y / cellH;
        let range = i32(ceil(3.0 * sigma));
        let ix0 = max(0, i32(floor(gxEvt)) - range);
        let ix1 = min(last, i32(floor(gxEvt)) + range);
        let iy0 = max(0, i32(floor(gyEvt)) - range);
        let iy1 = min(last, i32(floor(gyEvt)) + range);

        var linear: f32 = 0.0;
        var quad: f32 = 0.0;
        for (var iy = iy0; iy <= iy1; iy++) {
            let dy = f32(iy) - gyEvt;
            for (var ix = ix0; ix <= ix1; ix++) {
                let dx = f32(ix) - gxEvt;
                let rSq = dx * dx + dy * dy;
                if (rSq > cutoffSq) { continue; }
                let w = exp(-rSq / (2.0 * sigmaSq));
                let idx = u32(iy) * GRID + u32(ix);
                linear += fieldDot[idx] * w;
                quad += w * w;
            }
        }

        let B = cellArea * linear;
        let C = cellArea * quad;
        if (C <= EPSILON) { continue; }
        let amp = (-B + sqrt(max(0.0, B * B + 2.0 * C * evt.energy))) / C;
        if (amp <= 0.0 || amp != amp) { continue; }

        for (var iy = iy0; iy <= iy1; iy++) {
            let dy = f32(iy) - gyEvt;
            for (var ix = ix0; ix <= ix1; ix++) {
                let dx = f32(ix) - gxEvt;
                let rSq = dx * dx + dy * dy;
                if (rSq > cutoffSq) { continue; }
                let idx = u32(iy) * GRID + u32(ix);
                fieldDot[idx] += amp * exp(-rSq / (2.0 * sigmaSq));
            }
        }
    }
}
