// ─── Overlay ───
// The 2D canvas above the WebGPU canvas: the Fields overlay's contours and field lines
// (src/field-atlas.js), the spawn-drag line, in an expanding universe the Hubble radius and
// event horizon around the observer, and in the spacetime view the lab box's edges below the
// plane and its time axis. (The domain's edge is part of the
// background grid, grid-render.wgsl, so it follows frames.) Everything maps through the
// camera, which src/spacetime.js routes through the tilt.
const _PAL = window._PALETTE;
const _r = window._r;

export default class Overlay {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;
        this.isLight = true;
        this.setTheme(true);
    }

    resize(width, height, dpr = 1) {
        this.width = width;
        this.height = height;
        this.dpr = dpr;
    }

    setTheme(isLight) {
        this.isLight = isLight;
        const T = isLight ? _PAL.light : _PAL.dark;
        this._ink = T.text;
        this._dragColor = _r(T.text, isLight ? 0.4 : 0.5);
        this._removeDragColor = _r(T.textMuted, isLight ? 0.6 : 0.7);
        this._horizonColor = _r(T.accent, isLight ? 0.5 : 0.55);
        this._labelColor = T.textMuted;
    }

    /** Words drawn on the canvas, in the page's language (main.js sets them). */
    _labels = {
        now: 'now', ago: (s) => `${s} ago`,
        observer: 'the observer’s present', lab: 'the lab’s present',
        length: 'length, c = 1',
    };

    /**
     * Clear the canvas, then draw the field atlas (`atlas`, when the Fields overlay is on), the
     * spacetime view's box (`box`: { view, w, h, obs, x0, y0 } when the view is tilted), the
     * scale (`rulers`: { tilt } while the rulers show: a scale bar seen from above, the box's
     * dimension line tilted), the horizons (`horizons`: { center, hubble, event, labels },
     * physical lengths) and the drag line, if one is in progress.
     */
    draw(camera, input, horizons = null, box = null, atlas = null, rulers = null) {
        const ctx = this.ctx;
        const d = this.dpr || 1;
        ctx.setTransform(d, 0, 0, d, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        if (atlas) atlas.draw(ctx, camera, this.isLight, _FONT.text);
        if (box) this._drawBox(box, rulers);
        if (rulers && rulers.tilt < 0.98) this._drawScaleBar(camera.zoom, 1 - rulers.tilt);
        if (horizons) this._drawHorizons(camera, horizons);
        if (!input || !input.isDragging) return;
        const a = camera.worldToScreen(input.dragStart.x, input.dragStart.y);
        const b = camera.worldToScreen(input.currentPos.x, input.currentPos.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = input._rightButton ? this._removeDragColor : this._dragColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    /**
     * The lab box under the present plane: its corners' world lines (at rest in the lab), its
     * floor at the depth, and a time axis at the corner nearest the left edge. Boosted toward
     * an observer (box.obs active) every event goes through the display transform, and the
     * presents that aren't the plane on top get their own outlines: the observer's, tilted
     * in the lab's coordinates, and the lab's, tilted the other way in the observer's.
     */
    _drawBox({ view, w, h, obs, x0, y0 }, rulers) {
        const ctx = this.ctx;
        const f = view.frame();
        const t = view.tilt;
        const D = f.depth;
        const now = obs.nowGPU;
        const at = (x, y, time) => {
            const d = view.display(x, y, time, obs);
            return view.toScreen(d.x, d.y, d.h, f);
        };
        // The box's origin comes from GPUBackend.render (the one around the observer on a torus)
        const corners = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
        const top = corners.map(([x, y]) => at(x, y, now));
        const bottom = corners.map(([x, y]) => at(x, y, now - D));
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = _r(this._ink, 0.16 * t);
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            ctx.moveTo(top[i].x, top[i].y);
            ctx.lineTo(bottom[i].x, bottom[i].y);
        }
        ctx.stroke();
        ctx.strokeStyle = _r(this._ink, 0.09 * t);
        ctx.beginPath();
        bottom.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = `italic 12px ${_FONT.text}`;
        if (obs.active) {
            // The presents that are not the flat plane on top
            const plane = (pts, alpha, label) => {
                if (alpha < 0.02) return;
                ctx.beginPath();
                pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
                ctx.closePath();
                ctx.fillStyle = _r(this._ink, 0.035 * alpha);
                ctx.fill();
                ctx.strokeStyle = _r(this._ink, 0.42 * alpha);
                ctx.stroke();
                let r = 0;
                for (let i = 1; i < 4; i++) if (pts[i].x > pts[r].x) r = i;
                ctx.fillStyle = _r(this._labelColor, alpha);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, pts[r].x + 8, pts[r].y);
            };
            const sliceT = (x, y) => obs.tA + obs.u[0] * (x - obs.xA[0]) + obs.u[1] * (y - obs.xA[1]);
            plane(corners.map(([x, y]) => at(x, y, sliceT(x, y))), (1 - obs.s) * t, this._labels.observer);
            plane(top, obs.s * t, this._labels.lab);
        }

        // The time axis: ticks every few bead steps, read as time before the present on top
        let k = 0;
        for (let i = 1; i < 4; i++) if (top[i].x < top[k].x) k = i;
        if (rulers && t > 0.02) {
            const fade = t * (obs.active ? 1 - obs.s : 1);
            if (fade > 0.02) this._drawDimension(corners, k, f, now, at, fade);
        }
        const base = obs.active && obs.s > 0.5
            ? at(corners[k][0], corners[k][1], obs.tA + obs.u[0] * (corners[k][0] - obs.xA[0]) + obs.u[1] * (corners[k][1] - obs.xA[1]))
            : top[k];
        const step = 2 ** Math.round(Math.log2(D / 4));
        const unit = f.kz * f.ce;   // px per unit of display time
        ctx.strokeStyle = _r(this._ink, 0.32 * t);
        ctx.fillStyle = _r(this._labelColor, t);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(base.x, base.y + D * unit);
        ctx.stroke();
        for (let s = 0; s <= D + 1e-6; s += step) {
            const y = base.y + s * unit;
            ctx.beginPath();
            ctx.moveTo(base.x - 3, y);
            ctx.lineTo(base.x + 3, y);
            ctx.stroke();
            ctx.fillText(s === 0 ? this._labels.now : this._labels.ago(s), base.x - 8, y);
        }
    }

    /**
     * A scale bar at the stage's bottom left, as on a map: a length of 1, 2 or 5 × 10^k at most
     * 120 px long, ticked in fifths or quarters, `S` px to the unit.
     */
    _drawScaleBar(S, alpha) {
        if (!(S > 0) || this.width < 420) return;
        const ctx = this.ctx;
        const raw = 120 / S, p10 = 10 ** Math.floor(Math.log10(raw));
        const m = [5, 2, 1].find((v) => v * p10 <= raw) || 1;
        const step = m * p10, L = step * S, n = m === 2 ? 4 : 5;
        const x = window.innerWidth > 900 ? 20 : 14, y = this.height - 22;
        ctx.lineWidth = 1;
        ctx.strokeStyle = _r(this._ink, 0.7 * alpha);
        ctx.beginPath();
        ctx.moveTo(x, y + 0.5);
        ctx.lineTo(x + L, y + 0.5);
        for (let i = 0; i <= n; i++) {
            const X = Math.round(x + L * i / n) + 0.5;
            ctx.moveTo(X, y + 0.5);
            ctx.lineTo(X, y + 0.5 - (i === 0 || i === n ? 5 : 3));
        }
        ctx.stroke();
        ctx.fillStyle = _r(this._labelColor, alpha);
        ctx.font = `12.5px ${_FONT.text}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'center';
        ctx.fillText('0', x, y + 5);
        ctx.fillText(String(+step.toPrecision(3)), x + L, y + 5);
        ctx.font = `italic 12.5px ${_FONT.text}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(this._labels.length, x, y - 8);
    }

    /**
     * The box's dimension line, as on a drawing: along the present's front edge away from the
     * time axis, set out from the box, ticked every 1, 2 or 5 × 10^k, with 0, the edge's length
     * and the unit.
     */
    _drawDimension(corners, k, f, now, at, alpha) {
        const ctx = this.ctx;
        // Of the two edges not meeting the time axis's corner, the one nearer the viewer
        const edges = [[(k + 1) % 4, (k + 2) % 4], [(k + 2) % 4, (k + 3) % 4]];
        const mid = ([i, j]) => at((corners[i][0] + corners[j][0]) / 2, (corners[i][1] + corners[j][1]) / 2, now).y;
        let [i, j] = mid(edges[0]) > mid(edges[1]) ? edges[0] : edges[1];
        // Read left to right on screen
        if (at(...corners[i], now).x > at(...corners[j], now).x) [i, j] = [j, i];
        const [ax, ay] = corners[i], [bx, by] = corners[j];
        const len = Math.hypot(bx - ax, by - ay);
        const cx = (corners[0][0] + corners[2][0]) / 2, cy = (corners[0][1] + corners[2][1]) / 2;
        // Out from the box, about 14 px on the plane
        let nx = -(by - ay) / len, ny = (bx - ax) / len;
        if (nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
        const off = 14 / f.kz, tick = 4 / f.kz;
        const P = (s, o) => at(ax + (bx - ax) * s / len + nx * o, ay + (by - ay) * s / len + ny * o, now);
        const raw = len / 6, p10 = 10 ** Math.floor(Math.log10(raw));
        const step = ([1, 2, 5, 10].map((v) => v * p10).find((v) => v >= raw)) || p10;
        ctx.lineWidth = 1;
        ctx.strokeStyle = _r(this._ink, 0.45 * alpha);
        ctx.beginPath();
        const a0 = P(0, off), a1 = P(len, off);
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(a1.x, a1.y);
        for (let s = 0; s <= len + 1e-6; s += step) {
            const p = P(s, off), q = P(s, off - tick);
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
        }
        const e0 = P(len, off), e1 = P(len, off - tick);
        ctx.moveTo(e0.x, e0.y);
        ctx.lineTo(e1.x, e1.y);
        ctx.stroke();
        ctx.fillStyle = _r(this._labelColor, alpha);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `12px ${_FONT.text}`;
        const l0 = P(0, off + 12 / f.kz), l1 = P(len, off + 12 / f.kz), lm = P(len / 2, off + 12 / f.kz);
        ctx.fillText('0', l0.x, l0.y);
        ctx.fillText(String(+len.toPrecision(3)), l1.x, l1.y);
        ctx.font = `italic 12px ${_FONT.text}`;
        ctx.fillText(this._labels.length, lm.x, lm.y);
    }

    /** Dashed circles on the plane: c/H, and the event horizon when it is finite. */
    _drawHorizons(camera, hz) {
        const ctx = this.ctx;
        const [cx, cy] = hz.center;
        const z = camera.zoom;
        const maxR = 4 * Math.hypot(this.width, this.height);
        ctx.lineWidth = 1;
        ctx.font = `italic 11px ${_FONT.text}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const circle = (r, dash, label) => {
            const rs = r * z;
            if (!isFinite(rs) || rs < 4 || rs > maxR) return;
            ctx.strokeStyle = this._horizonColor;
            ctx.setLineDash(dash);
            ctx.beginPath();
            for (let i = 0; i <= 96; i++) {
                const a = i / 96 * 2 * Math.PI;
                const p = camera.worldToScreen(cx + r * Math.cos(a), cy + r * Math.sin(a));
                if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            const top = camera.worldToScreen(cx, cy - r);
            ctx.fillStyle = this._labelColor;
            ctx.fillText(label, top.x, top.y - 3);
        };
        circle(hz.hubble, [4, 4], hz.hubbleLabel);
        if (Math.abs(hz.event - hz.hubble) > 0.02 * hz.hubble) circle(hz.event, [1, 3], hz.eventLabel);
    }
}
