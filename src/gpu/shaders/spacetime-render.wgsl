// spacetime-render.wgsl — the spacetime view: world lines, the selected body's past light
// cone, and boson world lines, under the present plane (src/spacetime.js).
//
// The camera's view matrix takes (x, y, h) with h the time before the present (h ≤ 0) to
// clip space, so these passes and the 2D ones share one projection. Lines are ribbons a
// few px wide built in screen space; the fragment draws a hairline core and, along a body's
// world line, a bead at every beadStep of its proper time (bead spacing reads the clock).
//
// World lines read the history ring (worldline.wgsl writes it; layout in
// shared-worldline.wgsl): samples sit on the covering plane, mapped back here through the
// slot's current deck, and on a periodic domain to the image nearest the body now, with a
// break wherever consecutive points jump a seam. A merge records two samples at one time:
// that is a break too.
//
// Draws (instances × vertices):
//   vs_line    maxParticles × 4·(WL_LEN + 1), triangle strip: per sample an incoming and
//              an outgoing pair, so a break zeroes one segment without bridging it
//   vs_cone    4 rings × 2·(CONE_SEGS + 1), triangle strip
//   vs_boson   (MAX_PHOTONS + PION_POOL_CAP) × 4, triangle strip
//   vs_pierce  maxParticles × 4, triangle strip: where each world line crosses the
//              observer's present, while the lab is boosting toward it or shows it tilted
//
// Coordinates (src/spacetime.js): with an observer moving at u, every event is boosted at
// rapidity ψ = s·atanh|u| about the anchor event A = (t_A, x_A) on the observer's present,
// so s = 0 is the lab's own coordinates and s = 1 the observer's, where its present lies
// flat at h = 0 and A sits at the camera's centre. In the boost frame itself the anchor
// comes from the slicer's FrameState, the same one the bodies were sliced with.

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

struct SpacetimeParams {
    tNow: f32,          // GPU time of the present (the world-line clock)
    depth: f32,         // time shown below the plane
    tilt: f32,          // 0 in the plane view … 1 at the spacetime elevation
    beadStep: f32,      // proper time between beads
    domainW: f32,
    domainH: f32,
    topology: i32,      // TOPO_*, or −1 when the boundary is not periodic
    selected: u32,      // the selected slot, or 0xFFFFFFFF
    scaleA: f32,        // cosmological scale factor (samples are comoving)
    maxParticles: u32,  // slots in use (the alive count's high-water mark)
    s: f32,             // 0 lab coordinates … 1 the observer's
    psi: f32,           // display rapidity, s·atanh|u|
    n: vec2<f32>,       // the observer's direction of motion
    offset: vec2<f32>,  // displayed position = boosted offset from the anchor + this
    tA: f32,            // anchor event: GPU time
    lag: f32,           // now − t_A
    xA: vec2<f32>,      // anchor event: lab position
    aNow: vec2<f32>,    // the observer's lab position now (images are taken nearest it)
    observing: u32,     // 1 when there is an observer to boost toward
    frameOn: u32,       // 1 in the boost frame: read the anchor from the slicer instead
    pierce: f32,        // slice points: 0 none, 1 rings (lab, tilted present), 2 filled (boosting)
    phi: f32,           // the observer's rapidity, atanh|u|
};

// The slicer's observer (frame-slice.wgsl)
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
    topology: f32,
    kind: f32,
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> params: SpacetimeParams;
@group(0) @binding(2) var<storage, read> wlData: array<f32>;
@group(0) @binding(3) var<storage, read> wlMeta: array<u32>;
@group(0) @binding(4) var<storage, read> particles: array<ParticleState>;
@group(0) @binding(5) var<storage, read> color: array<u32>;
@group(0) @binding(6) var<storage, read> photonPool: array<Photon>;
@group(0) @binding(7) var<storage, read> phCount: array<u32>;
@group(0) @binding(8) var<storage, read> pionPool: array<Pion>;
@group(0) @binding(9) var<storage, read> piCount: array<u32>;
@group(0) @binding(10) var<storage, read> frameState: FrameState;
@group(0) @binding(11) var<storage, read> particleAux: array<ParticleAux>;

const HALF_PX: f32 = 4.0;       // ribbon half-width, room for a bead
const BEAD_PX: f32 = 2.1;       // bead radius
const CONE_SEGS: u32 = 72u;
const NO_TAU: f32 = -1.0;       // no clock along this line (light)

struct VOut {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,      // rgb, alpha
    @location(1) across: f32,           // px from the line's centre
    @location(2) tau: f32,              // proper time here, or NO_TAU
    @location(3) pxPerTau: f32,         // screen px per unit of proper time along the line
    @location(4) @interpolate(flat) core: f32,  // hairline half-width, px
};

fn collapsed() -> VOut {
    var o: VOut;
    o.position = vec4(0.0, 0.0, 0.0, 1.0);
    o.color = vec4(0.0);
    o.across = 0.0;
    o.tau = NO_TAU;
    o.pxPerTau = 0.0;
    o.core = 0.0;
    return o;
}

fn project(p: vec2<f32>, h: f32) -> vec4<f32> {
    return camera.viewMatrix * vec4(p.x, p.y, h, 1.0);
}

fn toPx(c: vec4<f32>) -> vec2<f32> {
    return vec2(c.x * camera.canvasWidth * 0.5, -c.y * camera.canvasHeight * 0.5);
}

fn offsetClip(c: vec4<f32>, px: vec2<f32>) -> vec4<f32> {
    return c + vec4(px.x * 2.0 / camera.canvasWidth, -px.y * 2.0 / camera.canvasHeight, 0.0, 0.0);
}

fn unpack(packed: u32) -> vec3<f32> {
    return vec3(f32(packed & 0xFFu), f32((packed >> 8u) & 0xFFu), f32((packed >> 16u) & 0xFFu)) / 255.0;
}

fn ink() -> vec3<f32> { return select(COLOR_TEXT_LIGHT, COLOR_TEXT_DARK, camera.isDarkMode > 0.5); }
fn accent() -> vec3<f32> { return select(COLOR_ACCENT_LIGHT, COLOR_ACCENT_DARK, camera.isDarkMode > 0.5); }
fn dark() -> bool { return camera.isDarkMode > 0.5; }

/** Opacity by age: full at the plane, faint deep in the past, gone past the depth. */
fn ageAlpha(h: f32) -> f32 {
    let D = params.depth;
    return (0.2 + 0.75 * clamp(1.0 + h / D, 0.0, 1.0)) * smoothstep(-D, -0.9 * D, h);
}

// ─── The observer and the display transform ───

struct Obs {
    observing: bool,
    s: f32,
    phi: f32,
    psi: f32,
    n: vec2<f32>,
    u: vec2<f32>,
    offset: vec2<f32>,
    tA: f32,
    lag: f32,
    xA: vec2<f32>,
    aNow: vec2<f32>,
};

fn observer() -> Obs {
    var o: Obs;
    o.observing = params.observing != 0u;
    o.s = params.s;
    o.phi = params.phi;
    o.psi = params.psi;
    o.n = params.n;
    o.offset = params.offset;
    o.tA = params.tA;
    o.lag = params.lag;
    o.xA = params.xA;
    o.aNow = params.aNow;
    if (params.frameOn != 0u && frameState.valid > 0.5) {
        let su = min(length(frameState.u), MAX_SPEED_RATIO);
        o.s = 1.0;
        o.phi = atanh(su);
        o.psi = o.phi;
        o.n = select(vec2(1.0, 0.0), frameState.u / max(su, 1e-9), su > 1e-6);
        o.offset = vec2(0.0);
        o.tA = frameState.tA;
        o.lag = frameState.lag;
        o.xA = frameState.xA;
        o.aNow = frameState.aNow;
    }
    o.u = o.n * tanh(o.phi);
    return o;
}

/** A lab event in display coordinates (x, y, h): the plane of the present at h = 0. */
fn disp(o: Obs, pos: vec2<f32>, t: f32) -> vec3<f32> {
    if (!o.observing) { return vec3(pos, t - params.tNow); }
    let d = pos - o.xA;
    let dt = t - o.tA;
    let par = dot(d, o.n);
    let ch = cosh(o.psi);
    let sh = sinh(o.psi);
    let par2 = ch * par - sh * dt;
    let dt2 = ch * dt - sh * par;
    let xy = o.offset + (d - par * o.n) + par2 * o.n;
    return vec3(xy, dt2 - (1.0 - o.s) * o.lag);
}

fn projectEvent(o: Obs, pos: vec2<f32>, t: f32) -> vec4<f32> {
    let e = disp(o, pos, t);
    return project(e.xy, e.z);
}

// ─── World lines ───

struct LinePoint {
    pos: vec2<f32>,
    t: f32,
    tau: f32,
};

/** Sample i of slot s (oldest first); i == count is the body now, while it lives. */
fn linePoint(s: u32, i: u32, start: u32, count: u32, deck: vec4<f32>) -> LinePoint {
    var p: LinePoint;
    if (i >= count) {
        let b = particles[s];
        p.pos = vec2(b.posX, b.posY);
        p.t = params.tNow;
        // The clock now: the last sample's τ advanced at that sample's rate
        let last = s * WL_LEN * WL_STRIDE + ((start + count - 1u) & WL_MASK) * WL_STRIDE;
        let w = vec2(wlData[last + 3u], wlData[last + 4u]);
        p.tau = wlData[last + 7u] + (p.t - wlData[last]) * inverseSqrt(1.0 + dot(w, w));
        return p;
    }
    let base = s * WL_LEN * WL_STRIDE + ((start + i) & WL_MASK) * WL_STRIDE;
    let c = vec2(wlData[base + 1u], wlData[base + 2u]);
    // Cover → this image: x = A·(C − b)·a, A the deck's ±1 diagonal
    p.pos = deck.xy * (c - deck.zw) * params.scaleA;
    p.t = wlData[base];
    p.tau = wlData[base + 7u];
    return p;
}

/** On a periodic domain, the image of q nearest a reference point. */
fn nearImage(q: vec2<f32>, anchor: vec2<f32>) -> vec2<f32> {
    if (params.topology < 0) { return q; }
    return anchor + fullMinImageP(anchor.x, anchor.y, q.x, q.y, params.domainW, params.domainH, u32(params.topology));
}

/** True when the segment between consecutive points a, b is not drawn. */
fn isBreak(a: LinePoint, b: LinePoint) -> bool {
    let jump = length(b.pos - a.pos);
    let seam = params.topology >= 0 && jump > 0.45 * min(params.domainW, params.domainH);
    let merge = (b.t - a.t) < 1e-4 && jump > 1e-3;
    return seam || merge;
}

/** A slot's world line as stored: where its ring starts, how many samples, its deck. */
struct Line {
    ok: bool,
    alive: bool,
    start: u32,
    count: u32,
    n: u32,             // samples, plus the body now while it lives
    deck: vec4<f32>,
    anchor: vec2<f32>,  // the image the whole line is drawn through: of the body now
};

fn lineOf(s: u32, o: Obs) -> Line {
    var l: Line;
    l.ok = false;
    if (s >= params.maxParticles) { return l; }
    let flags = particles[s].flags;
    l.alive = (flags & FLAG_ALIVE) != 0u;
    if (!l.alive && (flags & FLAG_RETIRED) == 0u) { return l; }
    let mb = s * WL_META_STRIDE;
    l.count = min(wlMeta[mb + 1u], WL_LEN);
    if (l.count == 0u) { return l; }
    l.start = (wlMeta[mb] + WL_LEN - l.count) & WL_MASK;
    let bits = wlMeta[mb + 4u];
    l.deck = vec4(select(1.0, -1.0, (bits & 1u) != 0u), select(1.0, -1.0, (bits & 2u) != 0u),
                  bitcast<f32>(wlMeta[mb + 5u]), bitcast<f32>(wlMeta[mb + 6u]));
    l.n = l.count + select(0u, 1u, l.alive);
    // The body's latest point, in the image nearest the observer when there is one
    var a = linePoint(s, l.n - 1u, l.start, l.count, l.deck).pos;
    if (o.observing) { a = nearImage(a, o.aNow); }
    l.anchor = a;
    l.ok = true;
    return l;
}

fn pointOf(s: u32, l: Line, i: u32) -> LinePoint {
    var p = linePoint(s, i, l.start, l.count, l.deck);
    p.pos = nearImage(p.pos, l.anchor);
    return p;
}

/** The observer's present through A: g = (t − t_A) − u·(x − x_A), rising along a world line. */
fn sliceG(o: Obs, p: LinePoint) -> f32 {
    return (p.t - o.tA) - dot(o.u, p.pos - o.xA);
}

/** Where slot s's world line crosses the observer's present, if it does in its recorded span. */
struct Pierce {
    found: bool,
    p: LinePoint,
};

fn pierceOf(s: u32, l: Line, o: Obs) -> Pierce {
    var out: Pierce;
    out.found = false;
    let last = pointOf(s, l, l.n - 1u);
    let first = pointOf(s, l, 0u);
    if (sliceG(o, last) < 0.0 || sliceG(o, first) > 0.0) { return out; }
    var lo = 0u;
    var hi = l.n - 1u;
    for (var it = 0; it < 12; it++) {
        if (hi - lo <= 1u) { break; }
        let mid = (lo + hi) >> 1u;
        if (sliceG(o, pointOf(s, l, mid)) <= 0.0) { lo = mid; } else { hi = mid; }
    }
    let a = pointOf(s, l, lo);
    let b = pointOf(s, l, hi);
    let ga = sliceG(o, a);
    let gb = sliceG(o, b);
    let k = select(0.0, clamp(ga / (ga - gb), 0.0, 1.0), abs(ga - gb) > 1e-9);
    out.p.pos = mix(a.pos, b.pos, k);
    out.p.t = mix(a.t, b.t, k);
    out.p.tau = mix(a.tau, b.tau, k);
    out.found = true;
    return out;
}

@vertex
fn vs_line(@builtin(vertex_index) vid: u32, @builtin(instance_index) s: u32) -> VOut {
    if (params.tilt < 0.002) { return collapsed(); }
    let o = observer();
    let l = lineOf(s, o);
    if (!l.ok) { return collapsed(); }
    let n = l.n;

    let i = min(vid >> 2u, n - 1u);
    let outgoing = (vid & 2u) != 0u;
    let side = select(-1.0, 1.0, (vid & 1u) != 0u);

    let cur = pointOf(s, l, i);
    var prev = cur;
    var next = cur;
    if (i > 0u) { prev = pointOf(s, l, i - 1u); }
    if (i + 1u < n) { next = pointOf(s, l, i + 1u); }

    let e = disp(o, cur.pos, cur.t);
    let h = e.z;
    let c = project(e.xy, h);
    let pPrev = toPx(projectEvent(o, prev.pos, prev.t));
    let pNext = toPx(projectEvent(o, next.pos, next.t));
    var dir = pNext - pPrev;
    if (dot(dir, dir) < 1e-6) { dir = vec2(1.0, 0.0); }
    dir = normalize(dir);
    let normal = vec2(-dir.y, dir.x);

    // This vertex belongs to the segment into i (incoming) or out of it (outgoing)
    var visible = true;
    if (outgoing) { visible = i + 1u < n && (vid >> 2u) < n && !isBreak(cur, next); }
    else { visible = i > 0u && (vid >> 2u) < n && !isBreak(prev, cur); }

    // Ahead of the observer's present is the observer's future: faint, as not yet seen
    let ahead = o.observing && sliceG(o, cur) > 0.0;
    let selected = s == params.selected;
    var rgb = mix(unpack(color[s]), ink(), 0.35);
    if (selected) { rgb = accent(); }
    var a = ageAlpha(h) * params.tilt * select(0.85, 1.0, selected);
    if (ahead) { a = mix(0.3, 0.12, o.s) * params.tilt; }
    a = select(0.0, a, visible && (h <= 0.0 || ahead));

    var out: VOut;
    out.position = offsetClip(c, normal * side * HALF_PX);
    out.color = vec4(rgb, a);
    out.across = side * HALF_PX;
    out.tau = cur.tau;
    let dTau = abs(next.tau - prev.tau);
    out.pxPerTau = select(0.0, length(pNext - pPrev) / max(dTau, 1e-5), dTau > 1e-6 && !ahead);
    out.core = select(0.6, 0.95, selected);
    return out;
}

// ─── The selected body's past light cone ───

@vertex
fn vs_cone(@builtin(vertex_index) vid: u32, @builtin(instance_index) k: u32) -> VOut {
    let sel = params.selected;
    if (params.tilt < 0.002 || sel >= params.maxParticles) { return collapsed(); }
    let o = observer();
    let l = lineOf(sel, o);
    if (!l.ok || !l.alive) { return collapsed(); }
    // The apex: the body where the observer sees it now (its lab present without a boost)
    var apex = pointOf(sel, l, l.n - 1u);
    if (o.observing) {
        let pc = pierceOf(sel, l, o);
        if (!pc.found) { return collapsed(); }
        apex = pc.p;
    }
    let r = params.depth * f32(k + 1u) / 4.0;
    let j = vid >> 1u;
    let side = select(-1.0, 1.0, (vid & 1u) != 0u);
    let ang = f32(j) * TWO_PI / f32(CONE_SEGS);
    let d = 0.01;
    // A lab-time ring of the cone: invariant as a set, so it boosts like everything else
    let c = projectEvent(o, apex.pos + r * vec2(cos(ang), sin(ang)), apex.t - r);
    let ahead = toPx(projectEvent(o, apex.pos + r * vec2(cos(ang + d), sin(ang + d)), apex.t - r));
    let behind = toPx(projectEvent(o, apex.pos + r * vec2(cos(ang - d), sin(ang - d)), apex.t - r));
    var dir = ahead - behind;
    if (dot(dir, dir) < 1e-8) { dir = vec2(1.0, 0.0); }
    dir = normalize(dir);
    var out: VOut;
    out.position = offsetClip(c, vec2(-dir.y, dir.x) * side * 2.0);
    out.color = vec4(accent(), 0.42 * (1.0 - 0.18 * f32(k)) * params.tilt);
    out.across = side * 2.0;
    out.tau = NO_TAU;
    out.pxPerTau = 0.0;
    out.core = 0.5;
    return out;
}

// ─── Bosons: light on 45° lines, pions and leptons on timelike ones ───

@vertex
fn vs_boson(@builtin(vertex_index) vid: u32, @builtin(instance_index) idx: u32) -> VOut {
    if (params.tilt < 0.002) { return collapsed(); }
    var pos: vec2<f32>;
    var vel: vec2<f32>;
    var age: f32;
    var rgb: vec3<f32>;
    var invGamma = 0.0;             // dτ/dt; 0 for light
    var strength = 0.7;
    let dk = dark();
    if (idx < MAX_PHOTONS) {
        if (idx >= phCount[0]) { return collapsed(); }
        let ph = photonPool[idx];
        if ((ph.flags & 1u) == 0u) { return collapsed(); }
        pos = vec2(ph.posX, ph.posY);
        vel = vec2(ph.velX, ph.velY);
        age = ph.lifetime;
        let grav = (ph.flags & 2u) != 0u;
        // Light in the displayed coordinates takes its Doppler factor γψ(1 − uψ·v̂)
        let ob = observer();
        let uPsi = ob.n * tanh(ob.psi);
        let D = (1.0 - dot(uPsi, vel)) / sqrt(max(1.0 - dot(uPsi, uPsi), 1e-6));
        var light = select(INK_OCHRE_L, INK_OCHRE_D, dk);
        if (D < 1.0) { light = mix(light, select(INK_SIENNA_L, INK_SIENNA_D, dk), clamp((1.0 - D) / 0.3, 0.0, 1.0)); }
        else { light = mix(light, select(INK_INDIGO_L, INK_INDIGO_D, dk), clamp((D - 1.0) / 0.45, 0.0, 1.0)); }
        rgb = select(light, select(INK_MADDER_L, INK_MADDER_D, dk), grav);
        strength = 0.55;
    } else {
        let k = idx - MAX_PHOTONS;
        if (k >= piCount[0]) { return collapsed(); }
        let p = pionPool[k];
        if ((p.flags & 1u) == 0u) { return collapsed(); }
        pos = vec2(p.posX, p.posY);
        let w = vec2(p.wX, p.wY);
        invGamma = inverseSqrt(1.0 + dot(w, w));
        vel = w * invGamma;
        age = f32(p.age) * PHYSICS_DT;
        let lepton = p.kind == 1u;
        rgb = select(select(INK_MULBERRY_L, INK_MULBERRY_D, dk), select(INK_VERDIGRIS_L, INK_VERDIGRIS_D, dk), lepton);
        strength = 0.8;
    }
    let o = observer();
    if (o.observing) { pos = nearImage(pos, o.aNow); }
    // Back along its straight path to where it was emitted, or to the depth
    let L = min(age, params.depth * 1.6);
    if (L <= 0.0) { return collapsed(); }
    let end = (vid & 2u) != 0u;           // 0, 1: the past end; 2, 3: now
    let side = select(-1.0, 1.0, (vid & 1u) != 0u);
    let e0 = disp(o, pos - vel * L, params.tNow - L);
    let e1 = disp(o, pos, params.tNow);
    let c0 = project(e0.xy, e0.z);
    let c1 = project(e1.xy, e1.z);
    var dir = toPx(c1) - toPx(c0);
    let lenPx = length(dir);
    if (lenPx < 1e-4) { return collapsed(); }
    dir = dir / lenPx;
    let c = select(c0, c1, end);
    let h = select(e0.z, e1.z, end);
    var out: VOut;
    out.position = offsetClip(c, vec2(-dir.y, dir.x) * side * HALF_PX);
    out.color = vec4(rgb, strength * ageAlpha(min(h, 0.0)) * params.tilt * select(1.0, 0.0, h > 0.5));
    out.across = side * HALF_PX;
    // Proper time from the emission: L/γ in all, for the beads of a massive boson
    out.tau = select(NO_TAU, select(0.0, L * invGamma, end), invGamma > 0.0);
    out.pxPerTau = select(0.0, lenPx / max(L * invGamma, 1e-5), invGamma > 0.0);
    out.core = 0.55;
    return out;
}

// ─── Slice points: the bodies where the observer's present cuts their world lines ───

struct POut {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) @interpolate(flat) ring: f32,     // 1: a ring, 0: filled
    @location(3) @interpolate(flat) px: f32,       // radius in px, for the ring's width
};

@vertex
fn vs_pierce(@builtin(vertex_index) vid: u32, @builtin(instance_index) s: u32) -> POut {
    var out: POut;
    out.position = vec4(0.0, 0.0, 0.0, 1.0);
    out.color = vec4(0.0);
    out.uv = vec2(0.0);
    out.ring = 0.0;
    out.px = 1.0;
    if (params.pierce < 0.5) { return out; }
    let o = observer();
    if (!o.observing) { return out; }
    let l = lineOf(s, o);
    if (!l.ok) { return out; }
    let pc = pierceOf(s, l, o);
    if (!pc.found) { return out; }
    let e = disp(o, pc.p.pos, pc.p.t);
    let r = max(particleAux[s].radius, 2.5 / camera.zoom);
    let corner = vec2(select(-1.0, 1.0, (vid & 1u) != 0u), select(-1.0, 1.0, (vid & 2u) != 0u));
    out.position = project(e.xy + corner * r * 1.25, e.z);
    let selected = s == params.selected;
    out.color = vec4(select(unpack(color[s]), accent(), selected), 1.0);
    out.uv = corner * 1.25;
    out.ring = select(0.0, 1.0, params.pierce < 1.5);
    out.px = r * camera.zoom;
    return out;
}

@fragment
fn fs_pierce(in: POut) -> @location(0) vec4<f32> {
    let d = length(in.uv);
    let aa = 1.0 / max(in.px, 1.0);
    var a = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
    if (in.ring > 0.5) {
        let w = max(1.2 / max(in.px, 1.0), 0.12);
        a *= smoothstep(1.0 - w - aa, 1.0 - w + aa, d) * 0.9;
    }
    a *= in.color.a;
    if (a < 0.003) { discard; }
    return vec4(in.color.rgb * a, a);
}

// ─── Shared fragment: hairline core, proper-time beads ───

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
    if (in.color.a < 0.004) { discard; }
    let d = abs(in.across);
    let aa = 0.6 / max(camera.dpr, 1.0);   // a one-device-px edge (across is CSS px)
    var cover = 1.0 - smoothstep(in.core - aa, in.core + aa, d);
    if (in.tau >= 0.0 && in.pxPerTau > 0.0) {
        let spacing = params.beadStep * in.pxPerTau;
        let k = round(in.tau / params.beadStep);
        let along = (in.tau - k * params.beadStep) * in.pxPerTau;
        let bd = length(vec2(along, in.across));
        // Beads closer than ~8 px would read as a thick line, not a clock: fade them out
        let show = smoothstep(6.0, 10.0, spacing);
        cover = max(cover, (1.0 - smoothstep(BEAD_PX - aa, BEAD_PX + aa, bd)) * show);
    }
    let a = in.color.a * cover;
    if (a < 0.003) { discard; }
    return vec4(in.color.rgb * a, a);
}
