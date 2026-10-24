// ─── Overlay ───
// The 2D canvas above the WebGPU canvas: the spawn-drag line, in an expanding universe the
// Hubble radius and event horizon around the observer, and in the spacetime view the lab
// box's edges below the plane and its time axis. (The domain's edge is part of the
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

    resize(width, height) {
        this.width = width;
        this.height = height;
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
    };

    /**
     * Clear the canvas, then draw the spacetime view's box (`box`: { view, w, h } when the
     * view is tilted), the horizons (`horizons`: { center, hubble, event, labels }, physical
     * lengths) and the drag line, if one is in progress.
     */
    draw(camera, input, horizons = null, box = null) {
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        if (box) this._drawBox(box);
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
    _drawBox({ view, w, h, obs }) {
        const ctx = this.ctx;
        const f = view.frame();
        const t = view.tilt;
        const D = f.depth;
        const now = obs.nowGPU;
        const at = (x, y, time) => {
            const d = view.display(x, y, time, obs);
            return view.toScreen(d.x, d.y, d.h, f);
        };
        // Near the observer, a periodic or large domain's box is the one around the camera
        const corners = [[0, 0], [w, 0], [w, h], [0, h]];
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
