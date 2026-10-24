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
    frameImages: f32,
    dpr: f32,           // device px per CSS px (the uniform sizes are CSS px)
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
    tilt: f32,          // the spacetime view's tilt (src/spacetime.js): 0 flat … 1
    boxX: f32,          // the lab box's origin: the domain, or on a torus with an observer
    boxY: f32,          // the translate of it around the observer (GPUBackend.render)
    _pad0: f32,
    _pad1: f32,
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
// Hairlines are one CSS px wide whatever the pixel ratio, with a one-device-px edge
fn hairline(distPx: f32) -> f32 {
    let h = 0.5 * max(camera.dpr, 1.0);
    return 1.0 - smoothstep(h - 0.5, h + 0.5, distPx);
}

fn lineCoverage(coord: f32, s: f32, perPx: f32) -> f32 {
    let distPx = abs(fract(coord / s + 0.5) - 0.5) * s / max(perPx, 1e-9);
    return hairline(distPx);
}

fn gridAlpha(lab: vec2<f32>, fw: vec2<f32>) -> f32 {
    let f = max(fw.x, fw.y) * max(camera.dpr, 1.0);   // world units per CSS px
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

fn edgeAlpha(lab: vec2<f32>, fw: vec2<f32>, seams: bool) -> f32 {
    let W = grid.domainW;
    let H = grid.domainH;
    if (seams) {
        // The seams: every multiple of the domain size
        return max(lineCoverage(lab.x, W, fw.x), lineCoverage(lab.y, H, fw.y));
    }
    let inX = lab.x >= -fw.x && lab.x <= W + fw.x;
    let inY = lab.y >= -fw.y && lab.y <= H + fw.y;
    var a = 0.0;
    if (inY) { a = max(a, max(hairline(abs(lab.x) / fw.x), hairline(abs(lab.x - W) / fw.x))); }
    if (inX) { a = max(a, max(hairline(abs(lab.y) / fw.y), hairline(abs(lab.y - H) / fw.y))); }
    return a;
}

fn starHash(k: vec2<f32>) -> vec4<f32> {
    let q = vec2<u32>(vec2<i32>(k) + vec2(1048576));
    var h = (q.x * 0x9E3779B1u) ^ (q.y * 0x85EBCA77u);
    var out: vec4<f32>;
    for (var i = 0; i < 4; i++) {
        h = (h ^ (h >> 15u)) * 0x2C1B3C6Du;
        h = (h ^ (h >> 12u)) * 0x297A2D39u;
        h = h ^ (h >> 15u);
        out[i] = f32(h & 0xFFFFu) / 65535.0;
    }
    return out;
}

@fragment
fn fsGrid(in: VertexOutput) -> @location(0) vec4<f32> {
    let css = in.pos.xy / max(camera.dpr, 1.0);
    let ndc = vec2(css.x / camera.canvasWidth * 2.0 - 1.0, 1.0 - css.y / camera.canvasHeight * 2.0);
    let world = (camera.invViewMatrix * vec4(ndc, 0.0, 1.0)).xy;
    let lab = labOf(world);
    let fw = max(fwidth(lab), vec2(1e-6));

    let dark = camera.isDarkMode > 0.5;
    let ink = select(COLOR_TEXT_LIGHT, COLOR_TEXT_DARK, dark);
    // Hairline weights: the edge matches --border (text at 12% / 13%), rulers sit below it
    var edge = edgeAlpha(lab, fw, grid.periodic != 0u) * select(0.12, 0.13, dark);

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
    // Tilted into spacetime the sheet is the present: the rulers keep to the domain, which
    // takes a faint fill and a firmer edge, so the plane reads as a slice above its past
    // (In a frame `lab` is still the lab point under the pixel, so the mask is the lab box)
    let tilt = grid.tilt;
    var fill = 0.0;
    var insideMask = 1.0;
    if (tilt > 0.0) {
        let m = fw * 1.5;
        let lb = lab - vec2(grid.boxX, grid.boxY);
        let inside = smoothstep(-m.x, m.x, lb.x) * smoothstep(-m.x, m.x, grid.domainW - lb.x)
                   * smoothstep(-m.y, m.y, lb.y) * smoothstep(-m.y, m.y, grid.domainH - lb.y);
        lines *= mix(1.0, inside, tilt);
        insideMask = mix(1.0, inside, tilt);
        fill = inside * tilt * select(0.03, 0.045, dark);
        // A periodic domain's seams repeat without end on the flat sheet; tilted, the box is one
        if (grid.periodic != 0u) {
            edge = mix(edge, edgeAlpha(lb, fw, false) * select(0.12, 0.13, dark), tilt);
        }
        edge = edge * mix(1.0, 3.2, tilt);
    }
    // The backdrop's stars: a fixed field in backdrop coordinates, so the lens moves, splits
    // and stretches their images (a star's image grows; its ink does not brighten)
    var stars = 0.0;
    if (lensed) {
        let cell = 4.5 * grid.scaleA;
        let c = floor(backdrop / cell);
        let bw = max(length(bfw), 1e-5);
        for (var oy = -1; oy <= 1; oy++) {
            for (var ox = -1; ox <= 1; ox++) {
                let k = c + vec2(f32(ox), f32(oy));
                let h = starHash(k);
                if (h.x > 0.3) { continue; }
                let pos = (k + h.yz) * cell;
                let r = mix(0.03, 0.08, h.w) * cell;
                let d = length(backdrop - pos);
                stars = max(stars, (1.0 - smoothstep(r - bw, r + bw, d)) * mix(0.22, 0.7, h.w * h.w));
            }
        }
        stars *= (1.0 - smoothstep(0.3, 0.7, shadow)) * insideMask;
    }
    var a = max(max(max(edge, lines), fill), stars);
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
