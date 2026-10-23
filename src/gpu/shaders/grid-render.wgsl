// ─── The background grid: lab rulers and the domain edge ───
// Under expansion the rulers are comoving: spaced 2^k in x/a, so in the physical view they
// stretch with the universe and in the comoving view they stand still.
//
// Lensing (lab frame only): the rulers are a backdrop seen through the slab's masses, so a
// pixel at θ draws the backdrop at β = θ − α(θ) from lens-deflection.wgsl's map, sampled
// bilinearly. The domain edge is in the slab and stays unlensed. The probe's backdrop star
// shows wherever a ray lands on it, so its images (arcs, an Einstein ring) appear; the
// imposed black-hole capture disks are filled with the ground's ink.
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
    lensOn: u32,
    lensRes: u32,
    starOn: u32,
    lensLeft: f32,      // the lens map's rectangle (lab)
    lensTop: f32,
    lensCellW: f32,
    lensCellH: f32,
    starX: f32,         // the probe's backdrop star (lab)
    starY: f32,
    starR: f32,
    _pad0: f32,
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
@group(0) @binding(3) var<storage, read> lensMap: array<vec4<f32>>;

/** The lens map at lab point p, bilinear: (αx, αy, shadow, _). */
fn lensAt(p: vec2<f32>) -> vec4<f32> {
    let n = i32(grid.lensRes);
    let g = vec2((p.x - grid.lensLeft) / grid.lensCellW - 0.5, (p.y - grid.lensTop) / grid.lensCellH - 0.5);
    let i0 = vec2<i32>(floor(g));
    let f = g - floor(g);
    let a = clamp(i0, vec2(0), vec2(n - 1));
    let b = clamp(i0 + vec2(1), vec2(0), vec2(n - 1));
    let s00 = lensMap[a.y * n + a.x];
    let s10 = lensMap[a.y * n + b.x];
    let s01 = lensMap[b.y * n + a.x];
    let s11 = lensMap[b.y * n + b.x];
    return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

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

    // The backdrop: lensed rulers and the probe's star
    var backdrop = lab;
    var shadow = 0.0;
    let lensed = grid.lensOn != 0u && camera.frameOn < 0.5;
    if (lensed) {
        let l = lensAt(lab);
        backdrop = lab - l.xy;
        shadow = l.z;
    }
    let bfw = max(fwidth(backdrop), vec2(1e-6));
    var lines = select(0.0, gridAlpha(backdrop / grid.scaleA, bfw / grid.scaleA) * select(0.075, 0.09, dark), grid.showLines != 0u);
    lines *= 1.0 - smoothstep(0.3, 0.7, shadow);
    var a = max(edge, lines);
    var color = ink * a;
    if (lensed && grid.starOn != 0u) {
        // A captured ray sees no star (the probe doesn't count it either)
        let ds = length(backdrop - vec2(grid.starX, grid.starY)) / grid.starR;
        let star = (1.0 - smoothstep(0.85, 1.0, ds)) * 0.9 * (1.0 - smoothstep(0.3, 0.7, shadow));
        let accent = select(COLOR_ACCENT_LIGHT, COLOR_ACCENT_DARK, dark);
        color = color * (1.0 - star) + accent * star;
        a = a + star * (1.0 - a);
    }
    if (lensed && shadow > 0.0) {
        // The imposed capture disk: the ground's ink at the edge's weight, so it reads as a hole
        let s = smoothstep(0.3, 0.7, shadow) * select(0.55, 0.7, dark);
        color = color * (1.0 - s) + ink * s * 0.35;
        a = a + s * 0.35 * (1.0 - a);
    }
    return vec4(color, a);
}
