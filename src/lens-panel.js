// ─── Backdrop panel ───
// The Frame tab's lensing controls: the grid as a lensed backdrop (lens-deflection.wgsl), its
// distance D = D_LS/(D_L·D_S) on a log slider, and the microlensing probe: a backdrop star,
// placed where the view's centre was, whose magnification is plotted as a light curve.
import { t } from './i18n.js';

const _PAL = window._PALETTE;
const CURVE_LEN = 400;

export default class LensPanel {
    constructor(sim) {
        this.sim = sim;
        const $ = (id) => document.getElementById(id);
        this.el = {
            distanceGroup: $('lens-distance-group'),
            probeGroup: $('lens-probe-group'),
            curveGroup: $('lens-curve-group'),
            mu: $('lens-mu'),
            canvas: $('lens-curve'),
            toggle: $('lensToggle'),
            probe: $('lensProbeToggle'),
            distance: $('lensDistanceInput'),
        };
        this.ctx = this.el.canvas.getContext('2d');
        this.curve = [];
        this._lastT = null;
        _forms.bindToggle(this.el.toggle, v => this.setLensing(v));
        _forms.bindToggle(this.el.probe, v => this.setProbe(v));
        _forms.bindSlider(this.el.distance, $('lensDistanceValue'), v => {
            sim.lens.distance = 10 ** v;
            sim._dirty = true;
        }, v => (10 ** v).toPrecision(2));
    }

    setLensing(on) {
        this.sim.lens.on = on;
        if (this.el.toggle.checked !== on) this.el.toggle.checked = on;
        this.el.distanceGroup.style.display = on ? '' : 'none';
        this.el.probeGroup.style.display = on ? '' : 'none';
        if (!on) this.setProbe(false);
        this.sim._dirty = true;
    }

    /** The star goes where the view's centre is now, a radius of 1/40 of the view. */
    setProbe(on, star = null) {
        const sim = this.sim;
        if (on && !sim.lens.on) this.setLensing(true);
        if (this.el.probe.checked !== on) this.el.probe.checked = on;
        if (on) {
            const cam = sim.camera;
            sim.lens.star = star ?? { x: cam.x, y: cam.y, r: Math.max(0.25, sim.width / cam.zoom / 40) };
        } else {
            sim.lens.star = null;
        }
        this.curve = [];
        this._lastT = null;
        this.el.curveGroup.style.display = on ? '' : 'none';
        sim._dirty = true;
    }

    /** Collect the probe's latest magnification and redraw (each rendered frame). */
    update() {
        const sim = this.sim;
        if (!sim.lens.star) return;
        const h = sim._gpuPhysics?.lensHits;
        if (!h || h.t === this._lastT) return;
        this._lastT = h.t;
        this.curve.push({ t: h.t, mu: h.magnification });
        if (this.curve.length > CURVE_LEN) this.curve.shift();
        this.el.mu.textContent = h.hits > 0 ? h.magnification.toFixed(3) : t('lens.outOfView');
        this.draw();
    }

    /** μ against lab time, with μ = 1 dashed. */
    draw() {
        const canvas = this.el.canvas;
        const w = canvas.parentElement.clientWidth || 240;
        const h = 72;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
        }
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const c = this.curve;
        if (c.length < 2) return;
        const pal = this.sim.overlay.isLight ? _PAL.light : _PAL.dark;
        const pad = 6;
        let hi = 1;
        for (const s of c) if (s.mu > hi) hi = s.mu;
        const t0 = c[0].t, t1 = c[c.length - 1].t;
        const X = (tt) => pad + (w - 2 * pad) * (tt - t0) / Math.max(t1 - t0, 1e-9);
        const Y = (mu) => h - pad - (h - 2 * pad) * mu / (hi * 1.05);
        ctx.strokeStyle = pal.textMuted;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad, Y(1));
        ctx.lineTo(w - pad, Y(1));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        c.forEach((s, i) => { if (i === 0) ctx.moveTo(X(s.t), Y(s.mu)); else ctx.lineTo(X(s.t), Y(s.mu)); });
        ctx.stroke();
        ctx.font = `italic 11px ${_FONT.text}`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = pal.accent;
        ctx.fillText('μ', pad, pad - 2);
    }

    /** Back to no lensing (Clear and presets). */
    reset() {
        this.setLensing(false);
    }
}
