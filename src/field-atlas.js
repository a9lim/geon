// ─── The field atlas ───
// The Fields overlay drawn the way a survey sheet or a physics text would print it, on the 2D
// overlay canvas, from GPUPhysics.heatmapReadback (the heatmap grids over the view, the
// electric field and the bodies, a frame or two late):
//   - gravity's potential as contours in umber, at nice geometric levels, every 1 and 3 ×10^k
//     heavier and labelled, ticked downhill like a map's depression contours;
//   - the charges' electric field as field lines in prussian, traced from the charges through
//     the Liénard–Wiechert field (so an accelerating charge's lines kink where its news has
//     reached), a line ending where it runs into another so they never bundle, with
//     equipotentials at the index levels, solid in sienna where the potential is positive and
//     dashed in prussian where it is negative. A uniform external field has no structure to draw and would swamp
//     the charges' own (softened) fields, so it stays out of both and is named in the key;
//   - Yukawa's potential as dotted contours in viridian.
// Bz stays on the GPU (heatmap-render.wgsl, ⊙ and ⊗). Everything keeps to the domain, and
// maps through the camera, which src/spacetime.js routes through the tilt.
const _PAL = window._PALETTE;
const _r = window._r;

const MANTISSAS = [1, 1.5, 2, 3, 5, 7];
const LEVEL_SPAN = { gravity: 40, elecPos: 10, elecNeg: 10, yukawa: 20 };  // top/span … top
const TICK_PX = 14;             // spacing of the downhill ticks
const LINE_SEED_K = 10;         // field lines for a charge of 0.4, scaled as √|q|
const STEP_CELLS = 0.6;         // field-line step, in grid cells
const MAX_STEPS = 900;
const SEPARATION_CELLS = 1.2;   // a line stops within this of another line

/** Marching squares on grid f (n × n) at level L, stitched into polylines in grid coordinates. */
function contourLines(f, n, L) {
    const segs = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const a = f[j * n + i] - L, b = f[j * n + i + 1] - L, c = f[(j + 1) * n + i + 1] - L, d = f[(j + 1) * n + i] - L;
        const pts = [];
        if ((a > 0) !== (b > 0)) pts.push([i + a / (a - b), j]);
        if ((b > 0) !== (c > 0)) pts.push([i + 1, j + b / (b - c)]);
        if ((d > 0) !== (c > 0)) pts.push([i + d / (d - c), j + 1]);
        if ((a > 0) !== (d > 0)) pts.push([i, j + a / (a - d)]);
        if (pts.length === 2) segs.push(pts);
        else if (pts.length === 4) {
            if ((a > 0) === ((a + b + c + d) / 4 > 0)) { segs.push([pts[0], pts[1]]); segs.push([pts[2], pts[3]]); }
            else { segs.push([pts[3], pts[0]]); segs.push([pts[1], pts[2]]); }
        }
    }
    const key = p => Math.round(p[0] * 1e4) * 1e6 + Math.round(p[1] * 1e4);
    const ends = new Map();
    segs.forEach((s, k) => { for (const e of s) { const kk = key(e); let l = ends.get(kk); if (!l) ends.set(kk, l = []); l.push(k); } });
    const used = new Uint8Array(segs.length), lines = [];
    for (let k = 0; k < segs.length; k++) {
        if (used[k]) continue;
        used[k] = 1;
        const fwd = [segs[k][1]], back = [segs[k][0]];
        for (const arr of [fwd, back]) {
            for (;;) {
                const tk = key(arr[arr.length - 1]);
                const m = (ends.get(tk) || []).find(i => !used[i]);
                if (m === undefined) break;
                used[m] = 1;
                arr.push(key(segs[m][0]) === tk ? segs[m][1] : segs[m][0]);
            }
        }
        const line = back.reverse().concat(fwd);
        if (line.length >= 3) lines.push(line);
    }
    return lines;
}

/** Nice levels m·10^k between top/span and top; `index` marks the 1s and 3s. */
function niceLevels(top, span) {
    if (!(top > 0)) return [];
    const out = [];
    for (let k = Math.floor(Math.log10(top / span)); k <= Math.ceil(Math.log10(top)); k++) {
        for (const m of MANTISSAS) {
            const v = m * 10 ** k;
            if (v >= top / span && v <= top) out.push({ v, index: m === 1 || m === 3 });
        }
    }
    return out;
}

const fmt = v => {
    const a = Math.abs(v), s = a >= 1 ? a.toPrecision(2) : a.toPrecision(1);
    return (v < 0 ? '−' : '+') + String(+s);
};

export default class FieldAtlas {
    constructor(sim) {
        this.sim = sim;
        this.source = null;     // the readback the drawing was built from
        this.contours = [];     // { pts (world), kind, index, label, downLeft }
        this.lines = [];        // field lines, world points
    }

    /** Rebuild the drawing from a heatmap readback. */
    update(rb) {
        this.source = rb;
        const m = rb.meta, n = m.grid;
        const toWorld = ([i, j]) => [m.viewLeft + (i + 0.5) * m.cellW, m.viewTop + (j + 0.5) * m.cellH];
        const contours = [];
        const add = (f, kind, sign) => {
            let top = 0;
            for (let i = 0; i < f.length; i++) { const v = f[i] * sign; if (v > top) top = v; }
            for (const { v, index } of niceLevels(top, LEVEL_SPAN[kind])) {
                // Equipotentials beside field lines: the index levels only, so the lines lead
                if (kind !== 'gravity' && kind !== 'yukawa' && !index) continue;
                const L = v * sign;
                for (const line of contourLines(f, n, L)) {
                    // Which side is downhill: probe the grid a cell to the left of the middle
                    const k = line.length >> 1, a = line[k - 1], b = line[k + 1];
                    const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
                    const px = Math.round(line[k][0] - ty / tl), py = Math.round(line[k][1] + tx / tl);
                    const probe = px >= 0 && py >= 0 && px < n && py < n ? f[py * n + px] : L;
                    contours.push({ pts: line.map(toWorld), kind, index, label: fmt(L), downLeft: probe < L });
                }
            }
        };
        if (m.gravity) add(rb.grav, 'gravity', -1);
        if (m.coulomb) { add(rb.elec, 'elecPos', 1); add(rb.elec, 'elecNeg', -1); }
        if (m.yukawa) add(rb.yuk, 'yukawa', -1);
        this.contours = contours;
        this.lines = m.coulomb ? this._traceLines(rb) : [];
    }

    /** Field lines from the charges, through the charges' own E on the grid. */
    _traceLines(rb) {
        const m = rb.meta, n = m.grid, E = rb.E;
        const flags = new Uint32Array(rb.state.buffer, rb.state.byteOffset, rb.state.length);
        const charges = [];
        let pos = 0, neg = 0;
        for (let i = 0; i < m.n; i++) {
            const b = i * 9;
            if (!(flags[b + 8] & 1)) continue;
            const q = rb.state[b + 5];
            if (Math.abs(q) < 0.05) continue;
            charges.push({ x: rb.state[b], y: rb.state[b + 1], q, r: Math.cbrt(Math.max(rb.state[b + 4], 1e-6)) });
            if (q > 0) pos += q; else neg -= q;
        }
        if (charges.length === 0) return [];
        // Lines leave the sign that carries more charge and end on the other, or leave the view
        const from = pos >= neg ? 1 : -1;
        const field = (x, y) => {
            const gx = (x - m.viewLeft) / m.cellW - 0.5, gy = (y - m.viewTop) / m.cellH - 0.5;
            if (gx < 0 || gy < 0 || gx >= n - 1 || gy >= n - 1) return null;
            const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j;
            const k00 = 2 * (j * n + i), k10 = k00 + 2, k01 = k00 + 2 * n, k11 = k01 + 2;
            const ex = (E[k00] * (1 - fx) + E[k10] * fx) * (1 - fy) + (E[k01] * (1 - fx) + E[k11] * fx) * fy;
            const ey = (E[k00 + 1] * (1 - fx) + E[k10 + 1] * fx) * (1 - fy) + (E[k01 + 1] * (1 - fx) + E[k11 + 1] * fx) * fy;
            return [from * ex, from * ey];
        };
        const h = STEP_CELLS * Math.min(m.cellW, m.cellH);
        // Which line passed through each cell of a grid at the separation, so lines that
        // converge end instead of bundling
        const sep = SEPARATION_CELLS * Math.min(m.cellW, m.cellH);
        const sn = Math.ceil(n * Math.max(m.cellW, m.cellH) / sep);
        const owner = new Int32Array(sn * sn).fill(-1);
        const cellOf = (x, y) => {
            const i = Math.floor((x - m.viewLeft) / sep), j = Math.floor((y - m.viewTop) / sep);
            return i >= 0 && j >= 0 && i < sn && j < sn ? j * sn + i : -1;
        };
        const lines = [];
        for (const c of charges) {
            if (Math.sign(c.q) !== from) continue;
            const N = Math.max(4, Math.min(28, Math.round(LINE_SEED_K * Math.sqrt(Math.abs(c.q) / 0.4))));
            const r0 = c.r + 0.5 * h;
            for (let k = 0; k < N; k++) {
                const th = (k + 0.5) / N * 2 * Math.PI;
                let x = c.x + r0 * Math.cos(th), y = c.y + r0 * Math.sin(th);
                const pts = [[x, y]];
                const id = lines.length;
                for (let s = 0; s < MAX_STEPS; s++) {
                    const e1 = field(x, y);
                    if (!e1) break;
                    const l1 = Math.hypot(e1[0], e1[1]);
                    if (l1 < 1e-9) break;
                    const mx = x + 0.5 * h * e1[0] / l1, my = y + 0.5 * h * e1[1] / l1;
                    const e2 = field(mx, my);
                    if (!e2) break;
                    const l2 = Math.hypot(e2[0], e2[1]);
                    if (l2 < 1e-9) break;
                    x += h * e2[0] / l2; y += h * e2[1] / l2;
                    pts.push([x, y]);
                    if (charges.some(o => Math.sign(o.q) !== from && Math.hypot(x - o.x, y - o.y) < o.r)) break;
                    // Away from its own charge, a line ends on reaching one already drawn
                    const cell = cellOf(x, y);
                    if (cell >= 0) {
                        if (owner[cell] >= 0 && owner[cell] !== id && Math.hypot(x - c.x, y - c.y) > 3 * r0 + 2 * sep) break;
                        owner[cell] = id;
                    }
                }
                if (pts.length > 2) lines.push(pts);
            }
        }
        return lines;
    }

    /** Draw on the overlay's context through the camera, kept to the domain. */
    draw(ctx, camera, isLight, font) {
        if (!this.source) return;
        const T = isLight ? _PAL.light : _PAL.dark;
        const sim = this.sim;
        const W = sim.physW, H = sim.physH;
        const S = (p) => camera.worldToScreen(p[0], p[1]);
        ctx.save();
        // The domain as a clip path
        const corners = [[0, 0], [W, 0], [W, H], [0, H]].map(S);
        ctx.beginPath();
        corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.clip();

        const stroke = (pts) => {
            ctx.beginPath();
            pts.forEach((p, i) => { const s = S(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
            ctx.stroke();
        };
        const styles = {
            gravity: { ink: T.inks.umber, a: [0.34, 0.6], dash: [] },
            elecPos: { ink: T.inks.sienna, a: [0.3, 0.55], dash: [] },
            elecNeg: { ink: T.inks.prussian, a: [0.3, 0.55], dash: [4, 3] },
            yukawa: { ink: T.inks.viridian, a: [0.4, 0.6], dash: [1, 3] },
        };
        const labels = [];
        for (const c of this.contours) {
            const st = styles[c.kind];
            ctx.strokeStyle = _r(st.ink, st.a[c.index ? 1 : 0]);
            ctx.lineWidth = c.index ? 1.3 : 1;
            ctx.setLineDash(st.dash);
            const screen = c.pts.map(S);
            ctx.beginPath();
            screen.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.stroke();
            if (c.kind === 'gravity') {
                // Ticks downhill, every TICK_PX along the contour, as on a depression contour
                ctx.setLineDash([]);
                ctx.beginPath();
                let acc = TICK_PX / 2;
                for (let i = 1; i < screen.length; i++) {
                    const a = screen[i - 1], b = screen[i], dx = b.x - a.x, dy = b.y - a.y, dl = Math.hypot(dx, dy);
                    acc += dl;
                    if (acc < TICK_PX || dl < 1e-3) continue;
                    acc = 0;
                    const s = c.downLeft ? 1 : -1, len = c.index ? 5 : 3.5;
                    ctx.moveTo(b.x, b.y);
                    ctx.lineTo(b.x + s * dy / dl * len, b.y - s * dx / dl * len);
                }
                ctx.stroke();
            }
            if (c.index && c.kind === 'gravity' && screen.length > 12) labels.push({ screen, text: c.label, ink: st.ink });
        }
        ctx.setLineDash([]);

        // Field lines, with a chevron midway along each
        ctx.strokeStyle = _r(T.inks.prussian, isLight ? 0.6 : 0.68);
        ctx.lineWidth = 1;
        for (const pts of this.lines) stroke(pts);
        ctx.beginPath();
        for (const pts of this.lines) {
            if (pts.length < 12) continue;
            const k = Math.floor(pts.length * 0.45), a = S(pts[k]), b = S(pts[k + 2]);
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            for (const sgn of [-1, 1]) {
                ctx.moveTo(a.x + 4 * Math.cos(ang), a.y + 4 * Math.sin(ang));
                ctx.lineTo(a.x + 4 * Math.cos(ang) - 5 * Math.cos(ang + sgn * 0.5), a.y + 4 * Math.sin(ang) - 5 * Math.sin(ang + sgn * 0.5));
            }
        }
        ctx.stroke();

        // Contour values on the index contours, knocked out of the line, skipping collisions
        ctx.font = `italic 12px ${font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const taken = [];
        for (const { screen, text, ink } of labels) {
            const w = ctx.measureText(text).width + 10;
            for (const frac of [0.5, 0.25, 0.75]) {
                const k = Math.max(2, Math.min(screen.length - 3, Math.floor(screen.length * frac)));
                const p = screen[k], a = screen[k - 2], b = screen[k + 2];
                if (p.x < 0 || p.y < 0 || p.x > sim.width || p.y > sim.height) continue;
                if (taken.some(t => Math.hypot(t[0] - p.x, t[1] - p.y) < (t[2] + w) / 2)) continue;
                let ang = Math.atan2(b.y - a.y, b.x - a.x);
                if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(ang);
                ctx.lineWidth = 4;
                ctx.lineJoin = 'round';
                ctx.strokeStyle = T.canvas;
                ctx.strokeText(text, 0, 0);
                ctx.fillStyle = _r(ink, 0.9);
                ctx.fillText(text, 0, 0);
                ctx.restore();
                taken.push([p.x, p.y, w]);
                break;
            }
        }
        ctx.restore();
    }
}
