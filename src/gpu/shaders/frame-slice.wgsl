// ─── Frames: slicing world lines on an observer's hyperplane ───
// A non-lab frame is an observer with lab velocity u and an anchor event (t_A, X_A). Its
// "now" is the hyperplane t − u·x = t_A − u·X_A (Lorentz, Relativity on) or t = t_A
// (Galilean, Relativity off; co-rotation always). Every body is drawn where its world line
// crosses that slice, in the observer's coordinates.
//
// Entry points:
//   frameAnchor     — one thread: the observer's u, anchor, and lag (writes FrameState)
//   sliceWorldLines — one thread per (slot, image): the view buffers the renderer draws
//
// Positions are carried in an anchor-centred lab frame: each body's world line is mapped
// from its covering plane through the image nearest the frame's reference point aNow (the
// anchor's wrapped lab position now), so bodies on a torus land next to the observer.
// The lagged view sets t_A = now − |u|γ·max(x′·û) over the visible rectangle (plus any
// scrub), so the whole visible slice lies in the computed past.
//
// Prepended with the shared prefix and shared-worldline.wgsl.

struct FrameParams {
    kind: u32,          // 1 zero momentum, 2 particle, 3 boost, 4 co-rotating
    slot: u32,          // particle frame: the observer's slot
    lorentz: u32,       // 1: Lorentz slices and boosts; 0: Galilean
    images: u32,        // 1, or 9 on a torus
    boost: vec2<f32>,   // boost frame's lab velocity
    origin: vec2<f32>,  // boost and co-rotating frames: reference position (lab) at refT
    refT: f32,
    nowT: f32,          // current GPU time
    lookBack: f32,      // scrubber: extra lag
    omega: f32,         // co-rotation rate
    viewCenter: vec2<f32>,  // the visible rectangle, observer coordinates
    viewHalf: vec2<f32>,
    aliveCount: u32,
    domainW: f32,
    domainH: f32,
    periodic: u32,
    topology: u32,
    maxLag: f32,        // the recorded history's reach
    _pad0: f32,
    _pad1: f32,
};

struct FrameState {
    u: vec2<f32>,       // observer's lab velocity (zero for co-rotation)
    gamma: f32,
    tA: f32,            // anchor event: lab GPU time
    xA: vec2<f32>,      // anchor event: position in the anchor-centred lab frame
    aNow: vec2<f32>,    // that frame's reference point, the anchor's wrapped position now
    phi: f32,           // co-rotation angle at t_A (lab → observer turns by −phi)
    lag: f32,           // now − t_A
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

@group(0) @binding(0) var<uniform> fp: FrameParams;
@group(0) @binding(1) var<storage, read_write> frame: FrameState;
@group(0) @binding(2) var<storage, read> particles: array<ParticleState>;
@group(0) @binding(3) var<storage, read> particleAux: array<ParticleAux>;
@group(0) @binding(4) var<storage, read> wlData: array<f32>;
@group(0) @binding(5) var<storage, read> wlMeta: array<u32>;

@group(1) @binding(0) var<storage, read_write> viewState: array<ParticleState>;
@group(1) @binding(1) var<storage, read_write> viewAux: array<ParticleAux>;
@group(1) @binding(2) var<storage, read_write> viewDerived: array<ParticleDerived>;
@group(1) @binding(3) var<storage, read_write> viewClocks: array<vec4<f32>>;
// (Colors stay per slot: particle.wgsl reads color[instance / images] in a frame.)

fn wrapToDomain(p: vec2<f32>) -> vec2<f32> {
    if (fp.periodic == 0u || fp.topology != TOPO_TORUS) { return p; }
    return p - vec2(fp.domainW, fp.domainH) * floor(p / vec2(fp.domainW, fp.domainH));
}

fn coordVel(w: vec2<f32>) -> vec2<f32> {
    return select(w, w * inverseSqrt(1.0 + dot(w, w)), fp.lorentz != 0u);
}

/**
 * The point where world line v crosses g(t, C) = t − uc·C − c = 0, on the covering plane
 * (uc = 0 gives the point at time c). status: 0 found, 1 before the source existed,
 * 2 after its world line ends (retired) or in its future (alive).
 */
struct SlicePoint {
    p: WLPoint,
    status: u32,
};

fn sliceG(t: f32, pos: vec2<f32>, uc: vec2<f32>, c: f32) -> f32 {
    return t - dot(uc, pos) - c;
}

fn wlOnSlice(v: WLView, uc: vec2<f32>, c: f32) -> SlicePoint {
    var out: SlicePoint;
    out.status = 0u;
    if (v.count == 0u) { out.status = 1u; return out; }
    let last = v.n - 1u;
    if (sliceG(wlTimeAt(v, last), wlPosAt(v, last), uc, c) < 0.0) { out.status = 2u; return out; }

    let oldest = wlPointAt(v, 0u);
    if (sliceG(oldest.t, oldest.pos, uc, c) > 0.0) {
        // Before the first sample: uniform motion back, no further than creation
        let denom = 1.0 - dot(uc, oldest.vel);
        let s = -sliceG(oldest.t, oldest.pos, uc, c) / max(denom, EPSILON);
        if (oldest.t + s < v.creation) { out.status = 1u; return out; }
        out.p = wlExtrapolate(oldest, s);
        return out;
    }

    var lo = 0u;
    var hi = last;
    for (var it = 0; it < 12; it++) {
        if (hi - lo <= 1u) { break; }
        let mid = (lo + hi) >> 1u;
        if (sliceG(wlTimeAt(v, mid), wlPosAt(v, mid), uc, c) <= 0.0) { lo = mid; } else { hi = mid; }
    }
    let p0 = wlPointAt(v, lo);
    let p1 = wlPointAt(v, hi);
    let dt = p1.t - p0.t;
    if (dt <= EPSILON) { out.p = p1; return out; }
    // Linear start, then Newton on the Hermite (g' = 1 − uc·v > 0)
    let g0 = sliceG(p0.t, p0.pos, uc, c);
    let g1 = sliceG(p1.t, p1.pos, uc, c);
    var s = clamp(dt * g0 / (g0 - g1), 0.0, dt);
    for (var k = 0; k < 3; k++) {
        let q = wlHermite(p0, p1, s);
        let g = sliceG(q.t, q.pos, uc, c);
        let gp = 1.0 - dot(uc, q.vel);
        s = clamp(s - g / max(gp, 0.05), 0.0, dt);
    }
    out.p = wlHermite(p0, p1, s);
    return out;
}

fn rotate(p: vec2<f32>, a: f32) -> vec2<f32> {
    let c = cos(a);
    let s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

/** A slot's world line as a WLView whose current point is its live state. */
fn currentView(i: u32, alive: bool) -> WLView {
    let p = particles[i];
    let deck = wlDeck(i);
    var now: WLPoint;
    now.t = fp.nowT;
    now.pos = deck.xy * vec2(p.posX, p.posY) + deck.zw;
    now.vel = coordVel(deck.xy * vec2(p.velWX, p.velWY));
    now.acc = vec2(0.0);
    now.tau = 0.0;
    now.theta = 0.0;
    now.angw = deck.x * deck.y * p.angW;
    now.mass = p.mass;
    now.charge = p.charge;
    var v = wlView(i, alive, now);
    if (v.n > v.count && v.count > 0u) {
        // The current point carries the newest sample's τ and θ forward
        let newest = wlPointAt(v, v.count - 1u);
        let g = 1.0 / sqrt(max(1.0 - dot(newest.vel, newest.vel), EPSILON));
        v.now.tau = newest.tau + (fp.nowT - newest.t) / select(1.0, g, fp.lorentz != 0u);
        v.now.theta = newest.theta;
        v.now.acc = newest.acc;
    }
    return v;
}

@compute @workgroup_size(1)
fn frameAnchor() {
    var st: FrameState;
    st.lorentz = select(0.0, 1.0, fp.lorentz != 0u);
    st.omega = fp.omega;
    st.images = f32(fp.images);
    st.domainW = fp.domainW;
    st.domainH = fp.domainH;
    st.topology = select(-1.0, f32(fp.topology), fp.periodic != 0u);
    st.kind = f32(fp.kind);
    st.valid = 1.0;
    st.phi = 0.0;
    st.u = vec2(0.0);
    let domain = vec2(fp.domainW, fp.domainH);

    // ── The observer's velocity and reference point now ──
    var uNow = vec2(0.0);
    if (fp.kind == 1u) {
        // Zero momentum: u = P/E (P/M without relativity), anchored on the centre of energy,
        // which moves uniformly at u. On a torus the centre is taken about the heaviest body.
        var refIdx = 0u;
        var heaviest = -1.0;
        for (var i = 0u; i < fp.aliveCount; i++) {
            let p = particles[i];
            if ((p.flags & FLAG_ALIVE) != 0u && p.mass > heaviest) { heaviest = p.mass; refIdx = i; }
        }
        let r0 = vec2(particles[refIdx].posX, particles[refIdx].posY);
        var P = vec2(0.0);
        var E = 0.0;
        var moment = vec2(0.0);
        for (var i = 0u; i < fp.aliveCount; i++) {
            let p = particles[i];
            if ((p.flags & FLAG_ALIVE) == 0u) { continue; }
            let w = vec2(p.velWX, p.velWY);
            let e = select(p.mass, p.mass * sqrt(1.0 + dot(w, w)), fp.lorentz != 0u);
            P += p.mass * w;
            E += e;
            var d = vec2(p.posX, p.posY) - r0;
            if (fp.periodic != 0u) { d = fullMinImageP(r0.x, r0.y, p.posX, p.posY, fp.domainW, fp.domainH, fp.topology); }
            moment += e * d;
        }
        if (E <= EPSILON) { st.valid = 0.0; frame = st; return; }
        uNow = P / E;
        st.aNow = wrapToDomain(r0 + moment / E);
    } else if (fp.kind == 2u) {
        let p = particles[fp.slot];
        if ((p.flags & FLAG_ALIVE) == 0u) { st.valid = 0.0; frame = st; return; }
        st.aNow = vec2(p.posX, p.posY);
        uNow = coordVel(vec2(p.velWX, p.velWY));
    } else if (fp.kind == 3u) {
        uNow = fp.boost;
        st.aNow = wrapToDomain(fp.origin + fp.boost * (fp.nowT - fp.refT));
    } else {
        st.aNow = fp.origin;
    }

    // ── The lag: the whole visible slice in the computed past ──
    let lorentz = fp.lorentz != 0u && fp.kind != 4u;
    var u = select(vec2(0.0), uNow, lorentz);
    var lag = fp.lookBack;
    if (lorentz) {
        // The slice reaches t_A + |u|γ·(x′·û) at observer position x′; the latest visible
        // point is the corner furthest along û
        let s = min(length(u), MAX_SPEED_RATIO);
        if (s > 1e-6) {
            let n = u / length(u);
            let reach = dot(fp.viewCenter, n) + abs(fp.viewHalf.x * n.x) + abs(fp.viewHalf.y * n.y);
            lag += s / sqrt(1.0 - s * s) * max(reach, 0.0) + 0.25;
        }
    }
    lag = min(lag, fp.maxLag);
    st.tA = fp.nowT - lag;

    // ── The anchor event ──
    if (fp.kind == 2u) {
        // On the observer's own world line at t_A; its velocity there sets the frame
        let v = currentView(fp.slot, true);
        let deck = wlDeck(fp.slot);
        let sp = wlOnSlice(v, vec2(0.0), st.tA);
        if (sp.status != 0u) { st.valid = 0.0; frame = st; return; }
        st.xA = st.aNow + deck.xy * (sp.p.pos - v.now.pos);
        uNow = deck.xy * sp.p.vel;
        u = select(vec2(0.0), uNow, lorentz);
        if (!lorentz) { st.u = uNow; }
    } else if (fp.kind == 4u) {
        st.xA = st.aNow;
        st.phi = fp.omega * (st.tA - fp.refT);
    } else {
        // Zero momentum and boost: the reference point moves uniformly at u
        st.xA = st.aNow - uNow * lag;
    }
    st.u = select(uNow, vec2(0.0), fp.kind == 4u);
    let su = min(length(st.u), MAX_SPEED_RATIO);
    st.gamma = select(1.0, 1.0 / sqrt(1.0 - su * su), lorentz);
    st.lag = lag;
    frame = st;
}

fn writeInvalid(k: u32) {
    var s: ParticleState;
    s.flags = 0u;
    viewState[k] = s;
}

@compute @workgroup_size(64)
fn sliceWorldLines(@builtin(global_invocation_id) gid: vec3u) {
    let k = gid.x;
    let images = max(fp.images, 1u);
    let i = k / images;
    if (i >= fp.aliveCount) { return; }
    let img = k - i * images;
    let st = frame;
    if (st.valid < 0.5) { writeInvalid(k); return; }

    let p = particles[i];
    let alive = (p.flags & FLAG_ALIVE) != 0u;
    let retired = (p.flags & FLAG_RETIRED) != 0u && !alive;
    if ((!alive && !retired) || (p.flags & FLAG_GHOST) != 0u) { writeInvalid(k); return; }

    // The image of this body nearest the frame's reference point, then the torus copies
    let xNow = vec2(p.posX, p.posY);
    var d = xNow - st.aNow;
    var flips = vec2(1.0, 1.0);
    if (fp.periodic != 0u) {
        let mi = fullMinImageFlipsP(st.aNow.x, st.aNow.y, xNow.x, xNow.y, fp.domainW, fp.domainH, fp.topology);
        d = mi.xy;
        flips = mi.zw;
    }
    if (images == 9u) {
        d += vec2(f32(img % 3u) - 1.0, f32(img / 3u) - 1.0) * vec2(fp.domainW, fp.domainH);
    }
    let deck = wlDeck(i);
    let L = deck.xy * flips;
    let base = st.aNow + d;   // the image's position now, anchor-centred lab frame

    let v = currentView(i, alive);
    // In cover coordinates the slice t − u·(base + L·(C − C_now)) = t_A − u·X_A reads
    // t − (L·u)·C = c1
    let lorentz = st.lorentz > 0.5 && fp.kind != 4u;
    let uS = select(vec2(0.0), st.u, lorentz);
    let uc = L * uS;
    let c1 = st.tA - dot(uS, st.xA) + dot(uS, base) - dot(uc, v.now.pos);
    let sp = wlOnSlice(v, uc, c1);
    if (sp.status != 0u) { writeInvalid(k); return; }
    let q = sp.p;

    // Lab event in the anchor-centred frame, then the observer's coordinates
    let X = base + L * (q.pos - v.now.pos);
    let V = L * q.vel;
    let delta = X - st.xA;
    var xo = delta;
    var vo = V - st.u;
    if (fp.kind == 4u) {
        xo = rotate(delta, -st.phi);
        vo = rotate(V - st.omega * vec2(-delta.y, delta.x), -st.phi);
    } else if (lorentz) {
        let su = length(st.u);
        if (su > 1e-6) {
            let n = st.u / su;
            // On the slice t − t_A = u·Δ, so x′∥ = Δ∥/γ and x′⊥ = Δ⊥
            xo = delta + (1.0 / st.gamma - 1.0) * dot(delta, n) * n;
            // Relativistic velocity addition
            let vPar = dot(V, n);
            let vPerp = V - vPar * n;
            let den = 1.0 - su * vPar;
            vo = ((vPar - su) * n + vPerp / st.gamma) / den;
        } else {
            vo = V;
        }
    }

    let m = max(q.mass, EPSILON);
    let bodyRSq = pow(m, 2.0 / 3.0);
    let angw = L.x * L.y * q.angw;
    let vs = min(length(vo), MAX_SPEED_RATIO);
    let gv = select(1.0, 1.0 / sqrt(1.0 - vs * vs), fp.lorentz != 0u);

    var s: ParticleState;
    s.posX = xo.x;
    s.posY = xo.y;
    s.velWX = vo.x * gv;
    s.velWY = vo.y * gv;
    s.mass = q.mass;
    s.charge = q.charge;
    s.angW = angw;
    s.baseMass = q.mass;
    s.flags = FLAG_ALIVE | (p.flags & FLAG_ANTIMATTER);
    viewState[k] = s;

    var a: ParticleAux;
    a.radius = select(pow(m, 1.0 / 3.0), particleAux[i].radius, alive);
    a.particleId = particleAux[i].particleId;
    a.deathTime = 1e38;   // alive sentinel (above the 1e30 threshold)
    a.deathMass = 0.0;
    a.deathAngVel = 0.0;
    viewAux[k] = a;

    var dv: ParticleDerived;
    dv.velX = vo.x;
    dv.velY = vo.y;
    let angVel = select(angw, angw / sqrt(1.0 + angw * angw * bodyRSq), fp.lorentz != 0u);
    dv.angVel = angVel;
    dv.bodyRSq = bodyRSq;
    dv.radiusSq = a.radius * a.radius;
    dv.invMass = 1.0 / m;
    dv.magMoment = MAG_MOMENT_K * q.charge * angVel * bodyRSq;
    dv.angMomentum = INERTIA_K * m * angVel * bodyRSq;
    viewDerived[k] = dv;

    let theta = atan2(L.y * sin(q.theta), L.x * cos(q.theta));
    let phase = q.tau - CLOCK_PERIOD * floor(q.tau / CLOCK_PERIOD);
    viewClocks[k] = vec4(q.tau, phase, select(theta, theta - st.phi, fp.kind == 4u), 1.0);
}
