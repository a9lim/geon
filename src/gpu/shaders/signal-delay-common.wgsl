// ─── Signal Delay Common ───
// Binary-search + quadratic light-cone solver over the world-line store
// (worldline.wgsl documents the sample layout: t at +0, x, y at +1, +2, proper
// velocity at +3, +4, angw at +9). Segments between samples are taken as straight.
// Prepended to consuming shaders (after shared-topology.wgsl which provides fullMinImageP).
// Callers declare wlData/wlMeta bindings.
//
// Requires constants: WL_STRIDE, WL_META_STRIDE, WL_LEN, WL_MASK,
// EPSILON, TOPO_TORUS, TOPO_KLEIN.

struct DelayedState {
    x: f32, y: f32,
    vx: f32, vy: f32,
    angw: f32,
    valid: bool,
};

// Helper: compute base index into wlData for a given particle and sample
fn histSampleBase(srcIdx: u32, sampleIdx: u32) -> u32 {
    return srcIdx * WL_LEN * WL_STRIDE + sampleIdx * WL_STRIDE;
}

// Coordinate velocity of a sample (stored as proper velocity)
fn wlVel(base: u32) -> vec2<f32> {
    let w = vec2<f32>(wlData[base + 3u], wlData[base + 4u]);
    return w * inverseSqrt(1.0 + dot(w, w));
}

fn getDelayedStateGPU(
    srcIdx: u32,
    obsX: f32, obsY: f32,
    simTime: f32,
    periodic: bool,
    domW: f32, domH: f32,
    topoMode: u32,
    isDead: bool,
) -> DelayedState {
    var result: DelayedState;
    result.valid = false;

    let metaBase = srcIdx * WL_META_STRIDE;
    let writeIdx = wlMeta[metaBase];
    let count = wlMeta[metaBase + 1u];
    if (count == 0u) { return result; }

    let start = (writeIdx - count + WL_LEN) & WL_MASK;
    let newest = (writeIdx - 1u + WL_LEN) & WL_MASK;

    // Read oldest/newest timestamps from interleaved data
    let oldestBase = histSampleBase(srcIdx, start);
    let newestBase = histSampleBase(srcIdx, newest);
    let tOldest = wlData[oldestBase];
    let timeSpan = max(simTime - tOldest, 0.0);

    // Current distance to newest sample
    let nxPos = wlData[newestBase + 1u];
    let nyPos = wlData[newestBase + 2u];
    var cdx: f32; var cdy: f32;
    if (periodic) {
        let d = fullMinImageP(obsX, obsY, nxPos, nyPos, domW, domH, topoMode);
        cdx = d.x; cdy = d.y;
    } else {
        cdx = nxPos - obsX; cdy = nyPos - obsY;
    }
    let distSq = cdx * cdx + cdy * cdy;

    // ─── Phase 1: Binary search for the segment containing the light-cone root ───
    // g(t) = |x_src(t) - x_obs| - (now - t) is strictly monotone increasing
    // (g' = d_hat·v + 1 > 0 for |v| < c), so binary search on segment boundaries works.
    // A one-sample world line (just born) goes straight to extrapolation.
    if (count >= 2u && timeSpan >= EPSILON && distSq <= 4.0 * timeSpan * timeSpan) {
        var bsLo: i32 = 0;
        var bsHi: i32 = i32(count) - 2;
        for (var bsIter = 0; bsIter < 16; bsIter++) {
            if (bsLo >= bsHi) { break; }
            let mid = (bsLo + bsHi) >> 1;
            let midBase = histSampleBase(srcIdx, (start + u32(mid + 1)) & WL_MASK);
            let tMid = wlData[midBase];

            var bx: f32; var by: f32;
            if (periodic) {
                let d = fullMinImageP(obsX, obsY, wlData[midBase + 1u], wlData[midBase + 2u], domW, domH, topoMode);
                bx = d.x; by = d.y;
            } else {
                bx = wlData[midBase + 1u] - obsX;
                by = wlData[midBase + 2u] - obsY;
            }
            let g = sqrt(bx * bx + by * by) - (simTime - tMid);

            if (g < 0.0) { bsLo = mid + 1; }
            else { bsHi = mid; }
        }
        var segK = bsLo;

        // ─── Phase 2: Exact quadratic on converged segment (+/- 1 neighbor) ───
        let center = segK;
        for (var offset = 0; offset <= 1; offset++) {
            for (var dir = select(-1, 1, offset == 0); dir <= 1; dir += 2) {
                let k = center + offset * dir;
                if (k < 0 || k > i32(count) - 2) { continue; }

                let loBase = histSampleBase(srcIdx, (start + u32(k)) & WL_MASK);
                let hiBase = histSampleBase(srcIdx, ((start + u32(k)) + 1u) & WL_MASK);
                let tLo = wlData[loBase];
                let segDt = wlData[hiBase] - tLo;
                if (segDt < EPSILON) { continue; }

                let xLo = wlData[loBase + 1u]; let yLo = wlData[loBase + 2u];
                let xHi = wlData[hiBase + 1u]; let yHi = wlData[hiBase + 2u];

                var dx: f32; var dy: f32;
                var vx: f32; var vy: f32;
                if (periodic) {
                    let d0 = fullMinImageP(obsX, obsY, xLo, yLo, domW, domH, topoMode);
                    dx = d0.x; dy = d0.y;
                    let d1 = fullMinImageP(xLo, yLo, xHi, yHi, domW, domH, topoMode);
                    vx = d1.x / segDt; vy = d1.y / segDt;
                } else {
                    dx = xLo - obsX; dy = yLo - obsY;
                    vx = (xHi - xLo) / segDt; vy = (yHi - yLo) / segDt;
                }

                let rSq = dx * dx + dy * dy;
                let vSq = vx * vx + vy * vy;
                let dDotV = dx * vx + dy * vy;
                let T = simTime - tLo;

                let a = vSq - 1.0;
                let h = dDotV + T;
                let c = rSq - T * T;
                let disc = h * h - a * c;
                if (disc < 0.0) { continue; }

                let sqrtDisc = sqrt(max(disc, 0.0));
                var s_sol: f32;
                if (abs(a) < EPSILON) {
                    if (abs(h) < EPSILON) { continue; }
                    s_sol = -c / (2.0 * h);
                } else {
                    let s1 = (-h + sqrtDisc) / a;
                    let s2 = (-h - sqrtDisc) / a;
                    let ok1 = s1 >= -EPSILON && s1 <= segDt + EPSILON;
                    let ok2 = s2 >= -EPSILON && s2 <= segDt + EPSILON;
                    if (ok1 && ok2) { s_sol = max(s1, s2); }
                    else if (ok1) { s_sol = s1; }
                    else if (ok2) { s_sol = s2; }
                    else { continue; }
                }

                s_sol = clamp(s_sol, 0.0, segDt);
                let frac = s_sol / segDt;

                result.x = xLo + frac * (xHi - xLo);
                result.y = yLo + frac * (yHi - yLo);
                // Interpolate velocity and angw
                let vLo = wlVel(loBase); let vHi = wlVel(hiBase);
                result.vx = vLo.x + frac * (vHi.x - vLo.x);
                result.vy = vLo.y + frac * (vHi.y - vLo.y);
                let loAngw = wlData[loBase + 9u]; let hiAngw = wlData[hiBase + 9u];
                result.angw = loAngw + frac * (hiAngw - loAngw);
                result.valid = true;
                return result;
            }
        }
    }

    // Dead particles: don't extrapolate past buffer
    if (isDead) { return result; }

    // ─── Phase 3: Extrapolation from oldest sample ───
    // Before its first sample the source is taken to have moved uniformly, back to its
    // birth (wlMeta creation time; −∞ for preset and loaded bodies).
    {
        let xStart = wlData[oldestBase + 1u];
        let yStart = wlData[oldestBase + 2u];
        var dx: f32; var dy: f32;
        if (periodic) {
            let d = fullMinImageP(obsX, obsY, xStart, yStart, domW, domH, topoMode);
            dx = d.x; dy = d.y;
        } else {
            dx = xStart - obsX; dy = yStart - obsY;
        }

        let vOld = wlVel(oldestBase);
        let vx = vOld.x;
        let vy = vOld.y;
        let rSq = dx * dx + dy * dy;
        let vSq = vx * vx + vy * vy;
        let dDotV = dx * vx + dy * vy;
        let T = timeSpan;

        let a = vSq - 1.0;
        let h = dDotV + T;
        let c = rSq - T * T;
        let disc = h * h - a * c;
        if (disc < 0.0) { return result; }

        let sqrtDisc = sqrt(disc);
        var s_sol: f32;
        if (abs(a) < EPSILON) {
            if (abs(h) < EPSILON) { return result; }
            s_sol = -c / (2.0 * h);
        } else {
            let s1 = (-h + sqrtDisc) / a;
            let s2 = (-h - sqrtDisc) / a;
            let ok1 = s1 <= EPSILON;
            let ok2 = s2 <= EPSILON;
            if (ok1 && ok2) { s_sol = max(s1, s2); }
            else if (ok1) { s_sol = s1; }
            else if (ok2) { s_sol = s2; }
            else { return result; }
        }
        if (s_sol > 0.0) { s_sol = 0.0; }

        // Reject extrapolation past particle creation
        let creationTimeBits = wlMeta[srcIdx * WL_META_STRIDE + 2u];
        let creationTime = bitcast<f32>(creationTimeBits);
        if (tOldest + s_sol < creationTime) { return result; }

        result.x = xStart + vx * s_sol;
        result.y = yStart + vy * s_sol;
        result.vx = vx;
        result.vy = vy;
        result.angw = wlData[oldestBase + 9u];
        result.valid = true;
        return result;
    }
}
