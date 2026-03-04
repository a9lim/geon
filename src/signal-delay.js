// ─── Signal Delay ───
// Signal delay: solve for delayed time t_ret such that
// |x_source(t_ret) - x_observer(now)| = c·(now - t_ret) where c = 1.
//
// Three-phase solver:
//   1. Newton-Raphson on g(t) = |x_s(t)−x_obs| − (now−t) to converge into
//      the correct history segment. Guaranteed convergent for |v| < c.
//   2. Exact quadratic solve on that segment (piecewise-linear trajectory
//      makes the light-cone equation a quadratic with closed-form roots).
//   3. If t_ret predates the buffer, extrapolate backward from the oldest
//      sample at constant velocity (same quadratic, s ≤ 0).

import { HISTORY_SIZE } from './config.js';
import { TORUS, minImage } from './topology.js';

const _miOut = { x: 0, y: 0 };

// Pre-allocated return object — caller must consume before next call
const _delayedOut = { x: 0, y: 0, vx: 0, vy: 0 };

const NR_MAX_ITER = 6;

/**
 * Solve light-cone equation for delayed state of source as seen by observer.
 *
 * Returns a shared object (overwritten on every call) or null.
 * Caller must read fields before the next invocation.
 */
export function getDelayedState(source, observer, simTime, periodic, domW, domH, halfDomW, halfDomH, topology = TORUS) {
    if (!source.histX || source.histCount < 2) return null;

    const ox = observer.pos.x, oy = observer.pos.y;
    const N = HISTORY_SIZE;
    const count = source.histCount;
    const start = (source.histHead - count + N) % N;
    const newest = (source.histHead - 1 + N) % N;

    // Time bounds
    const tOldest = source.histTime[start];
    const tNewest = source.histTime[newest];
    const timeSpan = simTime - tOldest;
    if (timeSpan < 1e-12) return null;

    let cdx, cdy;
    if (periodic) {
        minImage(ox, oy, source.histX[newest], source.histY[newest],
                 topology, domW, domH, halfDomW, halfDomH, _miOut);
        cdx = _miOut.x; cdy = _miOut.y;
    } else {
        cdx = source.histX[newest] - ox;
        cdy = source.histY[newest] - oy;
    }
    const distSq = cdx * cdx + cdy * cdy;

    // ─── Buffer search: NR + quadratic on recorded history ───
    // Skip to extrapolation if solution clearly outside recorded range.
    buffer: {
    if (distSq > 4 * timeSpan * timeSpan) break buffer;

    // ─── Phase 1: Newton-Raphson to locate the segment containing t_ret ───
    // g(t) = |x_s(t) − x_obs| − (now − t),  g' = (d̂ · v_eff) + 1
    // Convergent for subluminal sources: |d̂ · v| < 1 ⇒ g' > 0.

    let t = simTime - Math.sqrt(distSq);   // initial guess: light travel time
    if (t < tOldest) t = tOldest;
    if (t > tNewest) t = tNewest;

    // Proportional segment estimate (O(1), assumes roughly uniform time spacing)
    let segK = Math.floor((t - tOldest) / (tNewest - tOldest) * (count - 1));
    if (segK > count - 2) segK = count - 2;
    if (segK < 0) segK = 0;
    // Short walk to correct for any non-uniformity
    while (segK < count - 2 && source.histTime[(start + segK + 1) % N] <= t) segK++;
    while (segK > 0 && source.histTime[(start + segK) % N] > t) segK--;

    let prevSegK = -1;
    for (let iter = 0; iter < NR_MAX_ITER; iter++) {
        if (segK === prevSegK) break;   // segment stabilized → go to analytical phase
        prevSegK = segK;

        const loIdx = (start + segK) % N;
        const hiIdx = (loIdx + 1) % N;
        const tLo = source.histTime[loIdx];
        const segDt = source.histTime[hiIdx] - tLo;
        if (segDt < 1e-12) {
            if (segK < count - 2) { segK++; prevSegK = -1; continue; }
            break buffer;
        }

        // Effective velocity (consistent with linear position interpolation)
        const xLo = source.histX[loIdx], yLo = source.histY[loIdx];
        let vxEff, vyEff;
        if (periodic) {
            minImage(xLo, yLo, source.histX[hiIdx], source.histY[hiIdx],
                     topology, domW, domH, halfDomW, halfDomH, _miOut);
            vxEff = _miOut.x / segDt;
            vyEff = _miOut.y / segDt;
        } else {
            vxEff = (source.histX[hiIdx] - xLo) / segDt;
            vyEff = (source.histY[hiIdx] - yLo) / segDt;
        }

        // Interpolated source position at t
        const s = t - tLo;
        const sx = xLo + vxEff * s;
        const sy = yLo + vyEff * s;

        // Separation
        let dx, dy;
        if (periodic) {
            minImage(ox, oy, sx, sy, topology, domW, domH, halfDomW, halfDomH, _miOut);
            dx = _miOut.x; dy = _miOut.y;
        } else {
            dx = sx - ox; dy = sy - oy;
        }

        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1e-12) break;               // source ≈ observer, skip to quadratic

        const g  = dist - (simTime - t);        // residual
        const gp = (dx * vxEff + dy * vyEff) / dist + 1;   // derivative
        if (Math.abs(gp) < 1e-12) break;

        t -= g / gp;

        // Clamp to history range
        if (t < tOldest) t = tOldest;
        if (t > tNewest) t = tNewest;

        // Walk segment index to contain new t
        while (segK < count - 2 && source.histTime[(start + segK + 1) % N] <= t) segK++;
        while (segK > 0 && source.histTime[(start + segK) % N] > t) segK--;
    }

    // ─── Phase 2: Exact quadratic solve on converged segment (± 1 neighbor) ───
    // Within a segment, x_s(tLo+s) = x_lo + v_eff·s is linear, so the
    // light-cone |x_s − x_obs|² = (now − tLo − s)² is a quadratic in s.
    const center = segK;
    for (let offset = 0; offset <= 1; offset++) {
        for (let dir = (offset === 0 ? 1 : -1); dir <= 1; dir += 2) {
            const k = center + offset * dir;
            if (k < 0 || k > count - 2) continue;

            const loIdx = (start + k) % N;
            const hiIdx = (loIdx + 1) % N;
            const tLo = source.histTime[loIdx];
            const segDt = source.histTime[hiIdx] - tLo;
            if (segDt < 1e-12) continue;

            // Separation at segment start: source(tLo) − observer
            let dx, dy;
            if (periodic) {
                minImage(ox, oy, source.histX[loIdx], source.histY[loIdx],
                         topology, domW, domH, halfDomW, halfDomH, _miOut);
                dx = _miOut.x; dy = _miOut.y;
            } else {
                dx = source.histX[loIdx] - ox;
                dy = source.histY[loIdx] - oy;
            }

            // Effective velocity (matches linear interpolation between recorded points)
            let vx, vy;
            if (periodic) {
                minImage(source.histX[loIdx], source.histY[loIdx],
                         source.histX[hiIdx], source.histY[hiIdx],
                         topology, domW, domH, halfDomW, halfDomH, _miOut);
                vx = _miOut.x / segDt;
                vy = _miOut.y / segDt;
            } else {
                vx = (source.histX[hiIdx] - source.histX[loIdx]) / segDt;
                vy = (source.histY[hiIdx] - source.histY[loIdx]) / segDt;
            }

            const rSq = dx * dx + dy * dy;
            const vSq = vx * vx + vy * vy;
            const dDotV = dx * vx + dy * vy;
            const T = simTime - tLo;

            // (v²−1)s² + 2(d·v + T)s + (r² − T²) = 0   [half-b form: h = b/2]
            const a = vSq - 1;
            const h = dDotV + T;
            const c = rSq - T * T;

            const disc = h * h - a * c;
            if (disc < 0) continue;

            const sqrtDisc = Math.sqrt(disc);
            let s;
            if (Math.abs(a) < 1e-12) {
                // v ≈ c: degenerate to linear 2h·s + c = 0
                if (Math.abs(h) < 1e-12) continue;
                s = -c / (2 * h);
            } else {
                const s1 = (-h + sqrtDisc) / a;
                const s2 = (-h - sqrtDisc) / a;
                // Pick valid root in [0, segDt]; prefer most recent (largest s)
                const ok1 = s1 >= -1e-9 && s1 <= segDt + 1e-9;
                const ok2 = s2 >= -1e-9 && s2 <= segDt + 1e-9;
                if (ok1 && ok2) s = Math.max(s1, s2);
                else if (ok1) s = s1;
                else if (ok2) s = s2;
                else continue;
            }

            // Clamp to segment
            if (s < 0) s = 0;
            else if (s > segDt) s = segDt;

            // Linearly interpolate state at t_ret = tLo + s
            const frac = s / segDt;
            _delayedOut.x  = source.histX[loIdx]  + frac * (source.histX[hiIdx]  - source.histX[loIdx]);
            _delayedOut.y  = source.histY[loIdx]  + frac * (source.histY[hiIdx]  - source.histY[loIdx]);
            _delayedOut.vx = source.histVx[loIdx] + frac * (source.histVx[hiIdx] - source.histVx[loIdx]);
            _delayedOut.vy = source.histVy[loIdx] + frac * (source.histVy[hiIdx] - source.histVy[loIdx]);
            return _delayedOut;
        }
    }

    } // buffer

    // ─── Extrapolation: constant-velocity backward projection from oldest sample ───
    // When the light-cone intersection predates recorded history, linearly
    // extrapolate from the oldest buffer entry.  Same quadratic, but s ≤ 0.
    {
        let dx, dy;
        if (periodic) {
            minImage(ox, oy, source.histX[start], source.histY[start],
                     topology, domW, domH, halfDomW, halfDomH, _miOut);
            dx = _miOut.x; dy = _miOut.y;
        } else {
            dx = source.histX[start] - ox;
            dy = source.histY[start] - oy;
        }

        const vx = source.histVx[start], vy = source.histVy[start];
        const rSq = dx * dx + dy * dy;
        const vSq = vx * vx + vy * vy;
        const dDotV = dx * vx + dy * vy;
        const T = timeSpan;

        // (v²−1)s² + 2(d·v + T)s + (r² − T²) = 0,  s ≤ 0
        const a = vSq - 1;
        const h = dDotV + T;
        const c = rSq - T * T;

        const disc = h * h - a * c;
        if (disc < 0) return null;

        const sqrtDisc = Math.sqrt(disc);
        let s;
        if (Math.abs(a) < 1e-12) {
            if (Math.abs(h) < 1e-12) return null;
            s = -c / (2 * h);
        } else {
            const s1 = (-h + sqrtDisc) / a;
            const s2 = (-h - sqrtDisc) / a;
            // s ≤ 0 (backward in time from oldest entry); pick closest to 0
            const ok1 = s1 <= 1e-9;
            const ok2 = s2 <= 1e-9;
            if (ok1 && ok2) s = Math.max(s1, s2);
            else if (ok1) s = s1;
            else if (ok2) s = s2;
            else return null;
        }

        if (s > 0) s = 0;

        _delayedOut.x  = source.histX[start] + vx * s;
        _delayedOut.y  = source.histY[start] + vy * s;
        _delayedOut.vx = vx;
        _delayedOut.vy = vy;
        return _delayedOut;
    }
}

/**
 * Interpolate position/velocity from circular history buffer at time t.
 * Uses binary search to find the bracketing segment.
 * @param {Object} p - Particle with history buffers
 * @param {number} t - Time to interpolate at
 * @returns {Object|null} {x, y, vx, vy} or null if out of range
 */
export function interpolateHistory(p, t) {
    if (!p.histX) return null;
    if (p.histCount < 2) return null;

    const N = HISTORY_SIZE;
    const start = (p.histHead - p.histCount + N) % N;

    // Check bounds
    const oldest = p.histTime[start];
    const newest = p.histTime[(p.histHead - 1 + N) % N];
    if (t < oldest || t > newest) return null;

    // Binary search for segment containing t
    let lo = 0, hi = p.histCount - 2;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (p.histTime[(start + mid) % N] <= t) lo = mid;
        else hi = mid - 1;
    }

    const loIdx = (start + lo) % N;
    const hiIdx = (loIdx + 1) % N;
    const dt = p.histTime[hiIdx] - p.histTime[loIdx];
    if (dt < 1e-12) return { x: p.histX[loIdx], y: p.histY[loIdx], vx: p.histVx[loIdx], vy: p.histVy[loIdx] };

    const frac = (t - p.histTime[loIdx]) / dt;
    return {
        x:  p.histX[loIdx]  + frac * (p.histX[hiIdx]  - p.histX[loIdx]),
        y:  p.histY[loIdx]  + frac * (p.histY[hiIdx]  - p.histY[loIdx]),
        vx: p.histVx[loIdx] + frac * (p.histVx[hiIdx] - p.histVx[loIdx]),
        vy: p.histVy[loIdx] + frac * (p.histVy[hiIdx] - p.histVy[loIdx]),
    };
}
