// ─── Phase Space Plot ───
// r vs v_r relative to the most massive other body; 512-sample ring buffer.
// Fed from the GPU stats readback (selected and reference bodies).
import { TWO_PI, PHASE_BUFFER_LEN, BOUND_LOOP } from './config.js';
import { minImage } from './topology.js';
import { drawPlotLabels } from './plot-labels.js';

const _PAL = window._PALETTE;
const _miOut = { x: 0, y: 0 };

const BUFFER_LEN = PHASE_BUFFER_LEN;
const MARGIN = 24;

export default class PhasePlot {
    constructor() {
        this.enabled = true;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.rBuf = new Float32Array(BUFFER_LEN);
        this.vrBuf = new Float32Array(BUFFER_LEN);
        this.head = 0;
        this.count = 0;
        this.trackedId = -1;
        // R11: Cached CSS width (avoids reflow from clientWidth reads in draw loop)
        this._cachedWidth = 180;
    }

    /** R11: Call on resize to refresh cached CSS width. */
    cacheSize() {
        this._cachedWidth = this.canvas.clientWidth || 180;
    }

    reset() {
        this.trackedId = -1;
        this.head = 0;
        this.count = 0;
    }

    /**
     * @param {Object} sel - selected body: index, posX, posY, velX, velY
     * @param {Object|null} ref - reference body (same fields), or null for none
     * @param {Object} geom - domainW, domainH, boundaryMode, topology
     */
    update(sel, ref, geom) {
        if (!this.enabled || !sel) return;

        if (sel.index !== this.trackedId) {
            this.trackedId = sel.index;
            this.head = 0;
            this.count = 0;
        }

        // Radial quantities measured relative to the reference body (origin if none)
        const refX = ref ? ref.posX : 0, refY = ref ? ref.posY : 0;
        const refVx = ref ? ref.velX : 0, refVy = ref ? ref.velY : 0;

        let dx, dy;
        if (geom.boundaryMode === BOUND_LOOP) {
            minImage(refX, refY, sel.posX, sel.posY,
                     geom.topology, geom.domainW, geom.domainH,
                     geom.domainW * 0.5, geom.domainH * 0.5, _miOut);
            dx = _miOut.x; dy = _miOut.y;
        } else {
            dx = sel.posX - refX; dy = sel.posY - refY;
        }
        const r = Math.sqrt(dx * dx + dy * dy) || 1;
        const rx = dx / r, ry = dy / r;
        const dvx = sel.velX - refVx, dvy = sel.velY - refVy;
        const vr = dvx * rx + dvy * ry;

        this.rBuf[this.head] = r;
        this.vrBuf[this.head] = vr;
        this.head = (this.head + 1) % BUFFER_LEN;
        if (this.count < BUFFER_LEN) this.count++;
    }

    draw(isLight) {
        if (!this.enabled || this.count < 2) return;

        const ps = this._cachedWidth;
        const dpr = window.devicePixelRatio || 1;
        const px = Math.round(ps * dpr);
        if (this.canvas.width !== px || this.canvas.height !== px) {
            this.canvas.width = px;
            this.canvas.height = px;
        }
        const c = this.ctx;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);

        let rMin = Infinity, rMax = -Infinity, vrMin = Infinity, vrMax = -Infinity;
        for (let i = 0; i < this.count; i++) {
            const idx = (this.head - this.count + i + BUFFER_LEN) % BUFFER_LEN;
            const r = this.rBuf[idx], vr = this.vrBuf[idx];
            if (r < rMin) rMin = r; if (r > rMax) rMax = r;
            if (vr < vrMin) vrMin = vr; if (vr > vrMax) vrMax = vr;
        }
        const rRange = (rMax - rMin) || 1;
        const vrRange = (vrMax - vrMin) || 1;

        c.clearRect(0, 0, ps, ps);

        c.fillStyle = isLight ? _PAL.light.panelSolid + '44' : _PAL.dark.canvas + '88';
        c.fillRect(0, 0, ps, ps);

        c.strokeStyle = isLight ? _PAL.light.text + '33' : _PAL.dark.text + '33';
        c.lineWidth = 0.5;
        c.beginPath();
        c.moveTo(MARGIN, 0); c.lineTo(MARGIN, ps);
        c.moveTo(0, ps - MARGIN); c.lineTo(ps, ps - MARGIN);
        c.stroke();

        drawPlotLabels(c, ps, MARGIN, 'v', 'r', isLight);

        c.beginPath();
        c.lineWidth = 1.2;
        for (let i = 0; i < this.count; i++) {
            const idx = (this.head - this.count + i + BUFFER_LEN) % BUFFER_LEN;
            const x = MARGIN + ((this.rBuf[idx] - rMin) / rRange) * (ps - MARGIN - 4);
            const y = (ps - MARGIN) - ((this.vrBuf[idx] - vrMin) / vrRange) * (ps - MARGIN - 4);
            if (i === 0) {
                c.moveTo(x, y);
            } else {
                c.lineTo(x, y);
            }
        }
        const accent = isLight ? _PAL.light.accent : _PAL.dark.accent;
        c.strokeStyle = accent + 'CC';
        c.stroke();

        const lastIdx = (this.head - 1 + BUFFER_LEN) % BUFFER_LEN;
        const cx = MARGIN + ((this.rBuf[lastIdx] - rMin) / rRange) * (ps - MARGIN - 4);
        const cy = (ps - MARGIN) - ((this.vrBuf[lastIdx] - vrMin) / vrRange) * (ps - MARGIN - 4);
        c.fillStyle = accent;
        c.beginPath();
        c.arc(cx, cy, 3, 0, TWO_PI);
        c.fill();
    }
}
