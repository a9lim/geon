// ── Shared topology-aware minimum image displacement ──
// Parameterized version: takes domain dimensions and topology mode as arguments.
// Prepended to standalone shaders that need minimum-image calculations.
// Requires constants: TOPO_TORUS, TOPO_KLEIN (from wgslConstants block).

fn fullMinImageP(ox: f32, oy: f32, sx: f32, sy: f32,
                 domW: f32, domH: f32, topo: u32) -> vec2<f32> {
    let halfW = domW * 0.5;
    let halfH = domH * 0.5;

    if (topo == TOPO_TORUS) {
        var rx = sx - ox;
        if (rx > halfW) { rx -= domW; } else if (rx < -halfW) { rx += domW; }
        var ry = sy - oy;
        if (ry > halfH) { ry -= domH; } else if (ry < -halfH) { ry += domH; }
        return vec2(rx, ry);
    }

    // Candidate 0: only torus-wrap axes with translational (not glide) periodicity.
    var dx0 = sx - ox;
    var dy0 = sy - oy;
    if (topo == TOPO_KLEIN) {
        if (dx0 > halfW) { dx0 -= domW; } else if (dx0 < -halfW) { dx0 += domW; }
    }
    var bestSq = dx0 * dx0 + dy0 * dy0;
    var bestDx = dx0;
    var bestDy = dy0;

    if (topo == TOPO_KLEIN) {
        // Klein: y-wrap is glide reflection (x,y) ~ (W-x, y+H)
        let gx = domW - sx;
        var dx1 = gx - ox;
        if (dx1 > halfW) { dx1 -= domW; } else if (dx1 < -halfW) { dx1 += domW; }
        var dy1 = (sy + domH) - oy;
        if (dy1 > domH) { dy1 -= 2.0 * domH; } else if (dy1 < -domH) { dy1 += 2.0 * domH; }
        let dSq1 = dx1 * dx1 + dy1 * dy1;
        if (dSq1 < bestSq) { bestDx = dx1; bestDy = dy1; bestSq = dSq1; }
        var dy1b = (sy - domH) - oy;
        if (dy1b > domH) { dy1b -= 2.0 * domH; } else if (dy1b < -domH) { dy1b += 2.0 * domH; }
        let dSq1b = dx1 * dx1 + dy1b * dy1b;
        if (dSq1b < bestSq) { bestDx = dx1; bestDy = dy1b; }
    } else {
        // RP²: both axes carry glide reflections (translational periods 2W, 2H)
        // Candidate 1: y-glide  (x,y) ~ (W-x, y+H)
        let gx = domW - sx;
        let dxG = gx - ox;
        var dyG = (sy + domH) - oy;
        if (dyG > domH) { dyG -= 2.0 * domH; } else if (dyG < -domH) { dyG += 2.0 * domH; }
        let dSqG = dxG * dxG + dyG * dyG;
        if (dSqG < bestSq) { bestDx = dxG; bestDy = dyG; bestSq = dSqG; }

        // Candidate 2: x-glide  (x,y) ~ (x+W, H-y)
        let gy = domH - sy;
        var dxH = (sx + domW) - ox;
        if (dxH > domW) { dxH -= 2.0 * domW; } else if (dxH < -domW) { dxH += 2.0 * domW; }
        let dyH = gy - oy;
        let dSqH = dxH * dxH + dyH * dyH;
        if (dSqH < bestSq) { bestDx = dxH; bestDy = dyH; bestSq = dSqH; }

        // Candidate 3: both glides  (x,y) ~ (2W-x, 2H-y)
        var dxC = (2.0 * domW - sx) - ox;
        if (dxC > domW) { dxC -= 2.0 * domW; } else if (dxC < -domW) { dxC += 2.0 * domW; }
        var dyC = (2.0 * domH - sy) - oy;
        if (dyC > domH) { dyC -= 2.0 * domH; } else if (dyC < -domH) { dyC += 2.0 * domH; }
        let dSqC = dxC * dxC + dyC * dyC;
        if (dSqC < bestSq) { bestDx = dxC; bestDy = dyC; }
    }

    return vec2(bestDx, bestDy);
}
