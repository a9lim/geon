// ─── Topology Module ───
// Minimum-image separation and position wrapping for torus, Klein bottle,
// and real projective plane boundary topologies.

export const TORUS = 0;
export const KLEIN = 1;
export const RP2   = 2;

// Reusable scratch objects for candidate computation (zero alloc)
const _c = { x: 0, y: 0 };

/** Torus-wrap a single axis value into [-half, +half]. */
function torusWrap(d, full, half) {
    if (d > half) d -= full; else if (d < -half) d += full;
    return d;
}

/**
 * Minimum-image separation from observer (ox,oy) to source (sx,sy).
 * Writes result into out.x, out.y.
 *
 * Torus: 1 candidate (standard periodic wrap).
 * Klein bottle: 2 candidates (identity + y-glide).
 * RP²: 4 candidates (identity + y-glide + x-glide + both).
 */
export function minImage(ox, oy, sx, sy, topology, W, H, halfW, halfH, out) {
    let dx = sx - ox;
    let dy = sy - oy;

    if (topology === TORUS) {
        out.x = torusWrap(dx, W, halfW);
        out.y = torusWrap(dy, H, halfH);
        return;
    }

    // Candidate 0: standard torus wrap
    let bx = torusWrap(dx, W, halfW);
    let by = torusWrap(dy, H, halfH);
    let bestDx = bx, bestDy = by, bestSq = bx * bx + by * by;

    // Candidate 1: y-glide  (x,y) ~ (W-x, y+H)
    // Glide image of source: (W - sx, sy + H)
    _c.x = torusWrap((W - sx) - ox, W, halfW);
    _c.y = torusWrap((sy + H) - oy, H, halfH);
    let sq = _c.x * _c.x + _c.y * _c.y;
    if (sq < bestSq) { bestDx = _c.x; bestDy = _c.y; bestSq = sq; }

    if (topology === RP2) {
        // Candidate 2: x-glide  (x,y) ~ (x+W, H-y)
        _c.x = torusWrap((sx + W) - ox, W, halfW);
        _c.y = torusWrap((H - sy) - oy, H, halfH);
        sq = _c.x * _c.x + _c.y * _c.y;
        if (sq < bestSq) { bestDx = _c.x; bestDy = _c.y; bestSq = sq; }

        // Candidate 3: both glides  (x,y) ~ (W-x+W, H-y+H) = (2W-x, 2H-y)
        // But 2W-x wraps same as -x mod W, so just (W-x, H-y) shifted differently
        _c.x = torusWrap((2 * W - sx) - ox, W, halfW);
        _c.y = torusWrap((2 * H - sy) - oy, H, halfH);
        sq = _c.x * _c.x + _c.y * _c.y;
        if (sq < bestSq) { bestDx = _c.x; bestDy = _c.y; bestSq = sq; }
    }

    out.x = bestDx;
    out.y = bestDy;
}

/**
 * Wrap particle position into domain [0,W]×[0,H], applying velocity/spin
 * flips for non-orientable topologies.
 *
 * Torus: simple modular wrap.
 * Klein: x wraps normally; y-wrap flips x, negates w.x, vel.x, angw, angVel.
 * RP²: x-wrap flips y (negates w.y, vel.y, angw, angVel);
 *       y-wrap flips x (negates w.x, vel.x, angw, angVel).
 */
export function wrapPosition(p, topology, W, H) {
    if (topology === TORUS) {
        if (p.pos.x < 0) p.pos.x += W;
        else if (p.pos.x > W) p.pos.x -= W;
        if (p.pos.y < 0) p.pos.y += H;
        else if (p.pos.y > H) p.pos.y -= H;
        return;
    }

    if (topology === KLEIN) {
        // x wraps normally
        if (p.pos.x < 0) p.pos.x += W;
        else if (p.pos.x > W) p.pos.x -= W;
        // y-wrap flips x
        if (p.pos.y < 0) {
            p.pos.y += H;
            p.pos.x = W - p.pos.x;
            p.w.x = -p.w.x; p.vel.x = -p.vel.x;
            p.angw = -p.angw; p.angVel = -p.angVel;
        } else if (p.pos.y > H) {
            p.pos.y -= H;
            p.pos.x = W - p.pos.x;
            p.w.x = -p.w.x; p.vel.x = -p.vel.x;
            p.angw = -p.angw; p.angVel = -p.angVel;
        }
        return;
    }

    // RP2: both axes flip
    // x-wrap flips y
    if (p.pos.x < 0) {
        p.pos.x += W;
        p.pos.y = H - p.pos.y;
        p.w.y = -p.w.y; p.vel.y = -p.vel.y;
        p.angw = -p.angw; p.angVel = -p.angVel;
    } else if (p.pos.x > W) {
        p.pos.x -= W;
        p.pos.y = H - p.pos.y;
        p.w.y = -p.w.y; p.vel.y = -p.vel.y;
        p.angw = -p.angw; p.angVel = -p.angVel;
    }
    // y-wrap flips x
    if (p.pos.y < 0) {
        p.pos.y += H;
        p.pos.x = W - p.pos.x;
        p.w.x = -p.w.x; p.vel.x = -p.vel.x;
        p.angw = -p.angw; p.angVel = -p.angVel;
    } else if (p.pos.y > H) {
        p.pos.y -= H;
        p.pos.x = W - p.pos.x;
        p.w.x = -p.w.x; p.vel.x = -p.vel.x;
        p.angw = -p.angw; p.angVel = -p.angVel;
    }
}
