// ─── World Lines: reading the store ───
// worldline.wgsl writes the samples; this include reads them. Prepended after
// shared-topology.wgsl and shared-relativity.wgsl; callers declare the wlData (f32) and
// wlMeta (u32) bindings.
//
// Sample, WL_STRIDE = 12 f32:
//   [0] t  [1] x  [2] y  [3] wx  [4] wy  [5] ax  [6] ay  [7] τ  [8] θ  [9] angw  [10] m  [11] q
// Positions, velocities (w, proper), accelerations (dw/dη), θ and angw are on the
// covering plane: the slot's deck maps its wrapped position x to C = A·x/a + b, A a
// diagonal of ±1, and boundary.wgsl updates the deck at every crossing so C never
// jumps. Times are GPU times (the world-line clock minus the rolling epoch).
//
// The store is comoving and conformal: positions are x/a and times conformal time η
// (dη = dt/a), so w, the peculiar proper velocity, is dC/dη and light runs at 1 in (η, C).
// Without expansion a = 1, η is lab time and C the lab position. Maxwell's equations are
// conformally invariant, so a Liénard–Wiechert field solved in (η, C) is exact in an
// expanding universe; retardedState() converts back to physical (see there).
//
// Meta, WL_META_STRIDE = 8 u32:
//   [0] writeIdx  [1] count  [2] creationTime (f32 bits)  [3] generation
//   [4] deck flips (bit 0: x mirrored, bit 1: y mirrored)  [5] bx  [6] by (f32 bits)  [7] _pad
//
// Between samples a world line is the cubic Hermite through the two positions and
// velocities; accelerations, angw and m interpolate linearly, q is the earlier sample's.

fn wlSampleBase(src: u32, ringIdx: u32) -> u32 {
    return src * WL_LEN * WL_STRIDE + (ringIdx & WL_MASK) * WL_STRIDE;
}

/** The slot's deck as (sx, sy, bx, by): cover = (sx·x + bx, sy·y + by). */
fn wlDeck(src: u32) -> vec4<f32> {
    let mb = src * WL_META_STRIDE;
    let bits = wlMeta[mb + 4u];
    return vec4(select(1.0, -1.0, (bits & 1u) != 0u), select(1.0, -1.0, (bits & 2u) != 0u),
                bitcast<f32>(wlMeta[mb + 5u]), bitcast<f32>(wlMeta[mb + 6u]));
}

/** Coordinate velocity from a proper velocity (c = 1). */
fn wlCoordVel(w: vec2<f32>) -> vec2<f32> {
    return w * inverseSqrt(1.0 + dot(w, w));
}

/** Coordinate acceleration dv/dt from proper velocity w and dw/dt. */
fn wlCoordAcc(w: vec2<f32>, wdot: vec2<f32>) -> vec2<f32> {
    let g = sqrt(1.0 + dot(w, w));
    let v = w / g;
    return (wdot - v * dot(v, wdot)) / g;
}

/** One point on a world line, on the covering plane. */
struct WLPoint {
    t: f32,
    pos: vec2<f32>,
    vel: vec2<f32>,    // coordinate velocity
    acc: vec2<f32>,    // coordinate acceleration
    tau: f32,
    theta: f32,
    angw: f32,
    mass: f32,
    charge: f32,
};

fn wlReadPoint(base: u32) -> WLPoint {
    var p: WLPoint;
    p.t = wlData[base];
    p.pos = vec2(wlData[base + 1u], wlData[base + 2u]);
    let w = vec2(wlData[base + 3u], wlData[base + 4u]);
    p.vel = wlCoordVel(w);
    p.acc = wlCoordAcc(w, vec2(wlData[base + 5u], wlData[base + 6u]));
    p.tau = wlData[base + 7u];
    p.theta = wlData[base + 8u];
    p.angw = wlData[base + 9u];
    p.mass = wlData[base + 10u];
    p.charge = wlData[base + 11u];
    return p;
}

/** A source's recorded history plus, while it lives, its current state as a last point. */
struct WLView {
    src: u32,
    start: u32,        // ring index of the oldest sample
    count: u32,        // recorded samples
    n: u32,            // count, plus one for the current state
    creation: f32,
    now: WLPoint,      // valid when n > count
};

fn wlView(src: u32, alive: bool, now: WLPoint) -> WLView {
    let mb = src * WL_META_STRIDE;
    var v: WLView;
    v.src = src;
    v.count = wlMeta[mb + 1u];
    v.start = (wlMeta[mb] + WL_LEN - v.count) & WL_MASK;
    v.creation = bitcast<f32>(wlMeta[mb + 2u]);
    v.now = now;
    v.n = v.count + select(0u, 1u, alive && v.count > 0u);
    return v;
}

fn wlPointAt(v: WLView, i: u32) -> WLPoint {
    if (i >= v.count) { return v.now; }
    return wlReadPoint(wlSampleBase(v.src, v.start + i));
}

fn wlTimeAt(v: WLView, i: u32) -> f32 {
    if (i >= v.count) { return v.now.t; }
    return wlData[wlSampleBase(v.src, v.start + i)];
}

fn wlPosAt(v: WLView, i: u32) -> vec2<f32> {
    if (i >= v.count) { return v.now.pos; }
    let b = wlSampleBase(v.src, v.start + i);
    return vec2(wlData[b + 1u], wlData[b + 2u]);
}

/** The point at offset s ∈ [0, Δ] into the segment from p0 to p1 (cubic Hermite). */
fn wlHermite(p0: WLPoint, p1: WLPoint, s: f32) -> WLPoint {
    let dt = p1.t - p0.t;
    var out = p0;
    if (dt <= EPSILON) { return p0; }
    let u = clamp(s / dt, 0.0, 1.0);
    let u2 = u * u;
    let u3 = u2 * u;
    let h00 = 2.0 * u3 - 3.0 * u2 + 1.0;
    let h10 = u3 - 2.0 * u2 + u;
    let h01 = -2.0 * u3 + 3.0 * u2;
    let h11 = u3 - u2;
    out.pos = h00 * p0.pos + h10 * dt * p0.vel + h01 * p1.pos + h11 * dt * p1.vel;
    let d00 = 6.0 * u2 - 6.0 * u;
    let d10 = 3.0 * u2 - 4.0 * u + 1.0;
    let d01 = -6.0 * u2 + 6.0 * u;
    let d11 = 3.0 * u2 - 2.0 * u;
    out.vel = (d00 * p0.pos + d01 * p1.pos) / dt + d10 * p0.vel + d11 * p1.vel;
    out.t = p0.t + u * dt;
    out.acc = mix(p0.acc, p1.acc, u);
    out.tau = mix(p0.tau, p1.tau, u);
    out.angw = mix(p0.angw, p1.angw, u);
    out.mass = mix(p0.mass, p1.mass, u);
    // θ wraps; interpolate the short way round
    let dth = p1.theta - p0.theta;
    out.theta = p0.theta + u * (dth - TWO_PI * round(dth / TWO_PI));
    out.charge = p0.charge;
    return out;
}

/** Uniform motion from p back (s < 0) or forward along its velocity. */
fn wlExtrapolate(p: WLPoint, s: f32) -> WLPoint {
    var out = p;
    out.t = p.t + s;
    out.pos = p.pos + p.vel * s;
    out.acc = vec2(0.0);
    let g = 1.0 / sqrt(max(1.0 - dot(p.vel, p.vel), EPSILON));
    out.tau = p.tau + s / g;
    out.theta = p.theta;
    return out;
}

// ─── The past light cone ───
// g(t) = |C(t) − X_o| − (T − t) increases strictly along a subluminal world line, so the
// root is bracketed by a binary search over the points, then found on its segment by
// Newton's method on the Hermite (g' = n̂·v + 1 ≥ 1 − |v| > 0).

struct Retarded {
    rel: vec2<f32>,    // source − observer, in the observer's orientation
    vel: vec2<f32>,
    acc: vec2<f32>,
    angw: f32,
    mass: f32,
    charge: f32,
    valid: bool,
};

fn wlConeG(p: vec2<f32>, t: f32, xo: vec2<f32>, T: f32) -> f32 {
    return length(p - xo) - (T - t);
}

/**
 * The state of source `src` that observer (obsX, obsY) sees at GPU time T.
 * nowPos is the source's current wrapped position (its death position once retired),
 * nowW its proper velocity, nowAngw, nowMass, nowCharge its current values; a retired
 * source has no current point, and its world line ends at its death snapshot. Positions
 * and the domain are physical, scaleA the current scale factor.
 *
 * The cone is solved in comoving, conformal coordinates and the result returned physical:
 * rel = a·ΔC, and acc = (dv/dη)/a, which is (a_ret/a)·dv/dt. Fed to the flat-space
 * Liénard–Wiechert formula, those give exactly E_phys = E_conformal/a²: the Coulomb part
 * falls with the proper distance now, and the radiation part is dimmed by 1/(1 + z).
 */
fn retardedState(
    src: u32, obsX: f32, obsY: f32, T: f32,
    nowPos: vec2<f32>, nowW: vec2<f32>, nowAngw: f32, nowMass: f32, nowCharge: f32,
    alive: bool, periodic: bool, domW: f32, domH: f32, topo: u32, scaleA: f32,
) -> Retarded {
    var r: Retarded;
    r.valid = false;

    // The nearest image of the source fixes which copy of its world line the observer
    // sees; L carries the source's cover orientation onto the observer's.
    var d = nowPos - vec2(obsX, obsY);
    var imageFlips = vec2(1.0, 1.0);
    if (periodic) {
        let mi = fullMinImageFlipsP(obsX, obsY, nowPos.x, nowPos.y, domW, domH, topo);
        d = mi.xy;
        imageFlips = mi.zw;
    }
    let invA = 1.0 / scaleA;
    let deck = wlDeck(src);
    let L = deck.xy * imageFlips;
    let cNow = deck.xy * nowPos * invA + deck.zw;
    let xo = cNow - L * d * invA;

    var now: WLPoint;
    now.t = T;
    now.pos = cNow;
    now.vel = wlCoordVel(deck.xy * nowW);
    now.tau = 0.0;
    now.theta = 0.0;
    now.angw = deck.x * deck.y * nowAngw;
    now.mass = nowMass;
    now.charge = nowCharge;
    var v = wlView(src, alive, now);
    if (v.count == 0u) { return r; }
    // The current point carries the newest sample's acceleration
    let newest = wlPointAt(v, v.count - 1u);
    if (v.n > v.count) { v.now.acc = newest.acc; v.now.tau = newest.tau; }

    var p: WLPoint;
    let oldest = wlPointAt(v, 0u);
    if (wlConeG(oldest.pos, oldest.t, xo, T) > 0.0) {
        // The light left before the first sample: uniform motion back from it, no further
        // than the source's creation (−∞ for preset and loaded bodies)
        let dx = oldest.pos - xo;
        let Tr = T - oldest.t;
        let a = dot(oldest.vel, oldest.vel) - 1.0;
        let h = dot(dx, oldest.vel) + Tr;
        let c = dot(dx, dx) - Tr * Tr;
        let disc = h * h - a * c;
        if (disc < 0.0 || abs(a) < EPSILON) { return r; }
        // With a = v² − 1 < 0 the roots are (−h ± √disc)/a; the past cone's is the "+" one
        // (for v = 0 it gives s = Tr − |dx|; the other is the future cone's, Tr + |dx|)
        let s = (-h + sqrt(disc)) / a;
        if (s > 0.0 || oldest.t + s < v.creation) { return r; }
        p = wlExtrapolate(oldest, s);
    } else {
        let lastIdx = v.n - 1u;
        if (wlConeG(wlPosAt(v, lastIdx), wlTimeAt(v, lastIdx), xo, T) <= 0.0) {
            // Inside the cone of the last point: a retired source whose signal has passed
            return r;
        }
        // g(i_lo) ≤ 0 < g(i_hi)
        var lo = 0u;
        var hi = lastIdx;
        for (var it = 0; it < 12; it++) {
            if (hi - lo <= 1u) { break; }
            let mid = (lo + hi) >> 1u;
            if (wlConeG(wlPosAt(v, mid), wlTimeAt(v, mid), xo, T) <= 0.0) { lo = mid; } else { hi = mid; }
        }
        let p0 = wlPointAt(v, lo);
        let p1 = wlPointAt(v, hi);
        let dt = p1.t - p0.t;
        if (dt <= EPSILON) {
            p = p1;
        } else {
            // Start from the chord's exact root, then refine on the Hermite
            let vc = (p1.pos - p0.pos) / dt;
            let dx = p0.pos - xo;
            let Tr = T - p0.t;
            let a = dot(vc, vc) - 1.0;
            let h = dot(dx, vc) + Tr;
            let c = dot(dx, dx) - Tr * Tr;
            var s = 0.5 * dt;
            let disc = h * h - a * c;
            if (disc >= 0.0 && abs(a) > EPSILON) { s = (-h + sqrt(disc)) / a; }
            s = clamp(s, 0.0, dt);
            for (var k = 0; k < 3; k++) {
                let q = wlHermite(p0, p1, s);
                let rv = q.pos - xo;
                let rl = max(length(rv), EPSILON);
                let g = rl - (T - q.t);
                let gp = dot(rv / rl, q.vel) + 1.0;
                s = clamp(s - g / max(gp, 0.05), 0.0, dt);
            }
            p = wlHermite(p0, p1, s);
        }
    }

    r.rel = scaleA * L * (p.pos - xo);
    r.vel = L * p.vel;
    r.acc = invA * L * p.acc;
    r.angw = L.x * L.y * p.angw;
    r.mass = p.mass;
    r.charge = p.charge;
    r.valid = true;
    return r;
}
