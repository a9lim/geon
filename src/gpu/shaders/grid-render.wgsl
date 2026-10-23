// ─── The background grid: lab rulers and the domain edge ───
// Under expansion the rulers are comoving: spaced 2^k in x/a, so in the physical view they
// stretch with the universe and in the comoving view they stand still.
// One sheet at rest in the lab, behind the slab. A full-screen pass maps each pixel back to
// lab coordinates on the current slice and draws multiscale hairlines at spacings 2^k,
// faded in by their on-screen spacing (12–48 px), plus the domain edge (the seams, in loop
// mode). In a non-lab frame the map is the observer's: lab-static points sit contracted by
// 1/γ along u (x′∥ = Δ∥/γ on the slice) and turned by the co-rotation angle, so the rulers
// show the lab lattice as the observer sees it.

struct CameraUniforms {
    viewMatrix: mat4x4<f32>,
    invViewMatrix: mat4x4<f32>,
    zoom: f32,
    canvasWidth: f32,
    canvasHeight: f32,
    isDarkMode: f32,
    relativityOn: f32,
    blackHoleOn: f32,
    showClocks: f32,
    frameOn: f32,
};

struct GridParams {
    domainW: f32,       // physical
    domainH: f32,
    periodic: u32,
    showLines: u32,
    scaleA: f32,        // the rulers are comoving
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

// FrameState as frame-slice.wgsl writes it
struct FrameState {
    u: vec2<f32>,
    gamma: f32,
    tA: f32,
    xA: vec2<f32>,
    aNow: vec2<f32>,
    phi: f32,
    lag: f32,
    lorentz: f32,
    valid: f32,
    omega: f32,
    images: f32,
    domainW: f32,
    domainH: f32,
    topology: f32,      // the loop topology, or −1 when the domain isn't periodic
    kind: f32,          // FrameParams.kind
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> grid: GridParams;
@group(0) @binding(2) var<storage, read> frame: FrameState;

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vsFullscreen(@builtin(vertex_index) vid: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32(i32(vid & 1u)) * 4.0 - 1.0;
    let y = f32(i32(vid >> 1u)) * 4.0 - 1.0;
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    return out;
}

fn rotate(p: vec2<f32>, a: f32) -> vec2<f32> {
    let c = cos(a);
    let s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

/** Lab position of an observer-frame point on the slice. */
fn labOf(xo: vec2<f32>) -> vec2<f32> {
    if (camera.frameOn < 0.5 || frame.valid < 0.5) { return xo; }
    var d = xo;
    let su = length(frame.u);
    if (su > 1e-6 && frame.gamma > 1.0) {
        let n = frame.u / su;
        d = xo + (frame.gamma - 1.0) * dot(xo, n) * n;
    }
    return frame.xA + rotate(d, frame.phi);
}

/** Coverage of the lines at multiples of s along one axis, given lab units per pixel. */
fn lineCoverage(coord: f32, s: f32, perPx: f32) -> f32 {
    let distPx = abs(fract(coord / s + 0.5) - 0.5) * s / max(perPx, 1e-9);
    return 1.0 - smoothstep(0.0, 1.0, distPx);
}

fn gridAlpha(lab: vec2<f32>, fw: vec2<f32>) -> f32 {
    let f = max(fw.x, fw.y);
    // Finest level at least 12 px apart; it fades in from 12 to 24 px
    let k0 = ceil(log2(12.0 * f));
    var a = 0.0;
    for (var j = 0; j < 3; j++) {
        let s = exp2(k0 + f32(j));
        let fade = select(1.0, smoothstep(12.0, 24.0, s / f), j == 0);
        let weight = fade * (0.45 + 0.275 * f32(j));
        let c = max(lineCoverage(lab.x, s, fw.x), lineCoverage(lab.y, s, fw.y));
        a = max(a, c * weight);
    }
    return a;
}

fn edgeAlpha(lab: vec2<f32>, fw: vec2<f32>) -> f32 {
    let W = grid.domainW;
    let H = grid.domainH;
    if (grid.periodic != 0u) {
        // The seams: every multiple of the domain size
        return max(lineCoverage(lab.x, W, fw.x), lineCoverage(lab.y, H, fw.y));
    }
    let inX = lab.x >= -fw.x && lab.x <= W + fw.x;
    let inY = lab.y >= -fw.y && lab.y <= H + fw.y;
    var a = 0.0;
    if (inY) { a = max(a, max(1.0 - smoothstep(0.0, 1.0, abs(lab.x) / fw.x), 1.0 - smoothstep(0.0, 1.0, abs(lab.x - W) / fw.x))); }
    if (inX) { a = max(a, max(1.0 - smoothstep(0.0, 1.0, abs(lab.y) / fw.y), 1.0 - smoothstep(0.0, 1.0, abs(lab.y - H) / fw.y))); }
    return a;
}

@fragment
fn fsGrid(in: VertexOutput) -> @location(0) vec4<f32> {
    let ndc = vec2(in.pos.x / camera.canvasWidth * 2.0 - 1.0, 1.0 - in.pos.y / camera.canvasHeight * 2.0);
    let world = (camera.invViewMatrix * vec4(ndc, 0.0, 1.0)).xy;
    let lab = labOf(world);
    let fw = max(fwidth(lab), vec2(1e-6));

    let dark = camera.isDarkMode > 0.5;
    let ink = select(COLOR_TEXT_LIGHT, COLOR_TEXT_DARK, dark);
    // Hairline weights: the edge matches --border (text at 12% / 13%), rulers sit below it
    let edge = edgeAlpha(lab, fw) * select(0.12, 0.13, dark);
    let lines = select(0.0, gridAlpha(lab / grid.scaleA, fw / grid.scaleA) * select(0.075, 0.09, dark), grid.showLines != 0u);
    let a = max(edge, lines);
    return vec4(ink * a, a);
}
