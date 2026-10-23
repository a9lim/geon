// ─── Expansion panel ───
// The Stats tab's readouts for an expanding universe (cosmology.js): the scale factor, the
// Hubble rate, the Hubble radius c/H and the event horizon, the mean density the Friedmann
// closure sources from, and a(t) and H(t) over the run. Shown while the universe expands or
// after it has.
import { t } from './i18n.js';

const _PAL = window._PALETTE;
const fmt = (v) => !isFinite(v) ? '∞' : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(2) : v.toPrecision(3);

export default class CosmologyPanel {
    constructor(sim) {
        this.sim = sim;
        const $ = (id) => document.getElementById(id);
        this.el = {
            section: $('cosmo-section'),
            a: $('cosmo-a'), H: $('cosmo-H'), rH: $('cosmo-rH'), rE: $('cosmo-rE'),
            rho: $('cosmo-rho'), rhoRow: $('cosmo-rho-row'),
            canvas: $('cosmo-plot'),
        };
        this.ctx = this.el.canvas.getContext('2d');
    }

    /** Refresh the readouts and plot (the backend calls this with the stats cadence). */
    update() {
        const gp = this.sim._gpuPhysics;
        if (!gp) return;
        const c = gp.cosmology;
        const show = gp.expanding || gp.scaleA !== 1;
        if (this.el.section.hidden === show) this.el.section.hidden = !show;
        if (!show) return;
        this.el.a.textContent = fmt(c.a);
        this.el.H.textContent = fmt(c.H);
        this.el.rH.textContent = fmt(c.hubbleRadius);
        this._event = c.eventHorizon();
        this.el.rE.textContent = fmt(this._event);
        const friedmann = c.schedule === 'friedmann' && gp.expanding;
        // .stat-row's display beats the hidden attribute
        this.el.rhoRow.style.display = friedmann ? '' : 'none';
        if (friedmann) this.el.rho.textContent = fmt(c.density(c.a));
        this.draw();
    }

    /** ln a (accent) and H (muted) against lab time, each on its own scale. */
    draw() {
        const c = this.sim._gpuPhysics.cosmology;
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
        const hist = c.history;
        if (hist.length < 2) return;
        const pal = this.sim.overlay.isLight ? _PAL.light : _PAL.dark;
        const t0 = hist[0].t, t1 = hist[hist.length - 1].t;
        const pad = 6;
        const line = (val, color) => {
            let lo = Infinity, hi = -Infinity;
            for (const s of hist) { const v = val(s); if (v < lo) lo = v; if (v > hi) hi = v; }
            if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            hist.forEach((s, i) => {
                const x = pad + (w - 2 * pad) * (s.t - t0) / Math.max(t1 - t0, 1e-9);
                const y = h - pad - (h - 2 * pad) * (val(s) - lo) / (hi - lo);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
        };
        line(s => s.H, pal.textMuted);
        line(s => Math.log(s.a), pal.accent);
        ctx.font = `italic 11px ${_FONT.text}`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = pal.accent;
        ctx.fillText('ln a', pad, pad - 2);
        ctx.fillStyle = pal.textMuted;
        ctx.textAlign = 'right';
        ctx.fillText('H', w - pad, pad - 2);
        ctx.textAlign = 'left';
    }

    /** The overlay's horizons around `center` (physical): c/H, and the event horizon if finite. */
    horizons() {
        const gp = this.sim._gpuPhysics;
        if (!gp || !gp.expanding) return null;
        const c = gp.cosmology;
        return { hubble: c.hubbleRadius, event: this._event ?? c.eventHorizon(), hubbleLabel: t('cosmo.hubbleRadiusShort'), eventLabel: t('cosmo.eventHorizonShort') };
    }
}
