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

struct CameraUniforms {
    viewMatrix: mat4x4<f32>,
    invViewMatrix: mat4x4<f32>,
    zoom: f32,
    canvasWidth: f32,
    canvasHeight: f32,
    isDarkMode: f32,
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
    maxParticles: u32,
    _pad0: u32,
    _pad1: u32,
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

/** On a periodic domain, the image of q nearest the body now. */
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

@vertex
fn vs_line(@builtin(vertex_index) vid: u32, @builtin(instance_index) s: u32) -> VOut {
    if (params.tilt < 0.002 || s >= params.maxParticles) { return collapsed(); }
    let flags = particles[s].flags;
    let alive = (flags & FLAG_ALIVE) != 0u;
    if (!alive && (flags & FLAG_RETIRED) == 0u) { return collapsed(); }
    let mb = s * WL_META_STRIDE;
    let count = min(wlMeta[mb + 1u], WL_LEN);
    if (count == 0u) { return collapsed(); }
    let start = (wlMeta[mb] + WL_LEN - count) & WL_MASK;
    let bits = wlMeta[mb + 4u];
    let deck = vec4(select(1.0, -1.0, (bits & 1u) != 0u), select(1.0, -1.0, (bits & 2u) != 0u),
                    bitcast<f32>(wlMeta[mb + 5u]), bitcast<f32>(wlMeta[mb + 6u]));
    let n = count + select(0u, 1u, alive);

    let i = min(vid >> 2u, n - 1u);
    let outgoing = (vid & 2u) != 0u;
    let side = select(-1.0, 1.0, (vid & 1u) != 0u);

    // The body's latest point fixes which image the whole line is drawn through
    let anchor = linePoint(s, n - 1u, start, count, deck).pos;
    var cur = linePoint(s, i, start, count, deck);
    cur.pos = nearImage(cur.pos, anchor);
    var prev = cur;
    var next = cur;
    if (i > 0u) { prev = linePoint(s, i - 1u, start, count, deck); prev.pos = nearImage(prev.pos, anchor); }
    if (i + 1u < n) { next = linePoint(s, i + 1u, start, count, deck); next.pos = nearImage(next.pos, anchor); }

    let h = cur.t - params.tNow;
    let c = project(cur.pos, h);
    let pPrev = toPx(project(prev.pos, prev.t - params.tNow));
    let pNext = toPx(project(next.pos, next.t - params.tNow));
    let pCur = toPx(c);
    var dir = pNext - pPrev;
    if (dot(dir, dir) < 1e-6) { dir = vec2(1.0, 0.0); }
    dir = normalize(dir);
    let normal = vec2(-dir.y, dir.x);

    // This vertex belongs to the segment into i (incoming) or out of it (outgoing)
    var visible = true;
    if (outgoing) { visible = i + 1u < n && (vid >> 2u) < n && !isBreak(cur, next); }
    else { visible = i > 0u && (vid >> 2u) < n && !isBreak(prev, cur); }

    let selected = s == params.selected;
    var rgb = mix(unpack(color[s]), ink(), 0.35);
    if (selected) { rgb = accent(); }
    let a = select(0.0, ageAlpha(h) * params.tilt * select(0.85, 1.0, selected), visible && h <= 0.0);

    var o: VOut;
    o.position = offsetClip(c, normal * side * HALF_PX);
    o.color = vec4(rgb, a);
    o.across = side * HALF_PX;
    o.tau = cur.tau;
    let dTau = abs(next.tau - prev.tau);
    o.pxPerTau = select(0.0, length(pNext - pPrev) / max(dTau, 1e-5), dTau > 1e-6);
    o.core = select(0.6, 0.95, selected);
    return o;
}

// ─── The selected body's past light cone ───

@vertex
fn vs_cone(@builtin(vertex_index) vid: u32, @builtin(instance_index) k: u32) -> VOut {
    let sel = params.selected;
    if (params.tilt < 0.002 || sel >= params.maxParticles) { return collapsed(); }
    let b = particles[sel];
    if ((b.flags & FLAG_ALIVE) == 0u) { return collapsed(); }
    let r = params.depth * f32(k + 1u) / 4.0;
    let j = vid >> 1u;
    let side = select(-1.0, 1.0, (vid & 1u) != 0u);
    let ang = f32(j) * TWO_PI / f32(CONE_SEGS);
    let centre = vec2(b.posX, b.posY);
    let p = centre + r * vec2(cos(ang), sin(ang));
    let c = project(p, -r);
    let d = 0.01;
    let ahead = toPx(project(centre + r * vec2(cos(ang + d), sin(ang + d)), -r));
    let behind = toPx(project(centre + r * vec2(cos(ang - d), sin(ang - d)), -r));
    var dir = ahead - behind;
    if (dot(dir, dir) < 1e-8) { dir = vec2(1.0, 0.0); }
    dir = normalize(dir);
    var o: VOut;
    o.position = offsetClip(c, vec2(-dir.y, dir.x) * side * 2.0);
    o.color = vec4(accent(), 0.42 * (1.0 - 0.18 * f32(k)) * params.tilt);
    o.across = side * 2.0;
    o.tau = NO_TAU;
    o.pxPerTau = 0.0;
    o.core = 0.5;
    return o;
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
        rgb = select(select(INK_OCHRE_L, INK_OCHRE_D, dk), select(INK_MADDER_L, INK_MADDER_D, dk), grav);
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
    // Back along its straight path to where it was emitted, or to the depth
    let L = min(age, params.depth);
    if (L <= 0.0) { return collapsed(); }
    let end = (vid & 2u) != 0u;           // 0, 1: the past end; 2, 3: now
    let side = select(-1.0, 1.0, (vid & 1u) != 0u);
    let h = select(-L, 0.0, end);
    let p0 = pos - vel * L;
    let c0 = project(p0, -L);
    let c1 = project(pos, 0.0);
    var dir = toPx(c1) - toPx(c0);
    let lenPx = length(dir);
    if (lenPx < 1e-4) { return collapsed(); }
    dir = dir / lenPx;
    let c = select(c0, c1, end);
    var o: VOut;
    o.position = offsetClip(c, vec2(-dir.y, dir.x) * side * HALF_PX);
    o.color = vec4(rgb, strength * ageAlpha(h) * params.tilt);
    o.across = side * HALF_PX;
    // Proper time from the emission: L/γ in all, for the beads of a massive boson
    o.tau = select(NO_TAU, select(0.0, L * invGamma, end), invGamma > 0.0);
    o.pxPerTau = select(0.0, lenPx / max(L * invGamma, 1e-5), invGamma > 0.0);
    o.core = 0.55;
    return o;
}

// ─── Shared fragment: hairline core, proper-time beads ───

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
    if (in.color.a < 0.004) { discard; }
    let d = abs(in.across);
    let aa = 0.6;
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
