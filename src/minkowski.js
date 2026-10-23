// ─── Spacetime diagram ───
// The Frame tab's 1+1 plot: world lines projected on the observer's direction of motion,
// x′∥ across and t′ up, in the observer's coordinates, with its now (t′ = 0), its light
// cone, the lab's now, and proper-time ticks. Switching frames shears the axes. In the lab
// the axes are lab x and t through the camera's centre.
//
// World lines come back from the GPU a few times a second: the observer (or selection) and
// the bodies nearest it. Each is mapped like frame-slice.wgsl maps it, from its covering
// plane through the image nearest the frame's reference point.
import { BOUND_LOOP, WORLDLINE_LEN, CLOCK_PERIOD } from './config.js';
import { WL_STRIDE } from './gpu/gpu-constants.js';
import { minImage } from './topology.js';
import { FRAME_PARTICLE, FRAME_COROTATE } from './frames.js';

const _PAL = window._PALETTE;
const MAX_BODIES = 12;
const REFRESH_MS = 250;
const T_PAST = 110;        // the plot shows t′ from −T_PAST
const T_FUTURE = 14;       //                    to +T_FUTURE
const TICK = CLOCK_PERIOD / 2;
const _mi = { x: 0, y: 0, fx: 1, fy: 1 };

export default class MinkowskiPanel {
    constructor(sim, container) {
        this.sim = sim;
        this.container = container;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'minkowski-canvas';
        this.canvas.setAttribute('role', 'img');
        this.ctx = this.canvas.getContext('2d');
        container.appendChild(this.canvas);
        this._last = 0;
        this._pending = false;
        this.data = null;
        this._width = 260;
    }

    cacheSize() { this._width = this.container.clientWidth || 260; }

    /** On screen: the Frame tab active, and its panel open (side panel) or raised (sheet). */
    _visible() {
        const tab = document.getElementById('tab-frame');
        if (!tab || !tab.classList.contains('active')) return false;
        const r = this.container.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.left < window.innerWidth && r.right > 0;
    }

    /** Called every rendered frame; refreshes at REFRESH_MS while the Frame tab is open. */
    tick() {
        if (!this._visible()) return;
        const now = performance.now();
        if (!this._pending && now - this._last > REFRESH_MS) {
            this._last = now;
            this._pending = true;
            this._refresh().catch(() => {}).finally(() => { this._pending = false; });
        }
    }

    /** The observer's frame as the diagram uses it (lab times), or null while a frame's state is pending. */
    _frame() {
        const sim = this.sim;
        const gp = sim._gpuPhysics;
        if (sim.frames.active) {
            const st = sim.frames.state;
            if (!st || !st.valid) return null;
            return {
                u: [st.ux, st.uy], gamma: st.gamma, tA: st.tA, xA: st.xA, aNow: st.aNow,
                lorentz: st.lorentz && sim.frames.kind !== FRAME_COROTATE,
                corot: sim.frames.kind === FRAME_COROTATE, omega: st.omega, phi: st.phi,
            };
        }
        // The lab: lab x and t through the camera's centre, now
        const c = [sim.camera.x, sim.camera.y];
        return { u: [0, 0], gamma: 1, tA: gp.simTime, xA: c, aNow: c, lorentz: false, corot: false, omega: 0, phi: 0 };
    }

    async _refresh() {
        const sim = this.sim;
        const gp = sim._gpuPhysics;
        if (!gp || gp.aliveCount === 0) { this.data = null; this.draw(); return; }
        const frame = this._frame();
        if (!frame) return;
        const geom = { W: sim.domainW, H: sim.domainH, periodic: sim.boundaryMode === BOUND_LOOP, topo: sim.topology };

        // Which bodies: the observer or selection first, then the nearest to the reference point
        const snap = await gp.readSlotsSnapshot();
        const f = new Float32Array(snap.state), u = new Uint32Array(snap.state);
        const focus = sim.frames.kind === FRAME_PARTICLE ? sim.frames.slot : sim.selectedIdx;
        const cand = [];
        for (let i = 0; i < snap.n; i++) {
            if ((u[i * 9 + 8] & 1) === 0) continue;
            const d = this._image(frame.aNow, f[i * 9], f[i * 9 + 1], geom);
            cand.push({ i, d2: i === focus ? -1 : d.x * d.x + d.y * d.y });
        }
        cand.sort((a, b) => a.d2 - b.d2);
        const slots = cand.slice(0, MAX_BODIES).map(c => c.i);
        const pos = slots.map(i => [f[i * 9], f[i * 9 + 1]]);
        const wl = await gp.readWorldLines(slots);

        const lines = slots.map((slot, k) => this._project(wl.rings[k], wl.meta[k], pos[k], wl.epoch, frame, geom));
        this.data = { lines, focus: slots.indexOf(focus), frame, now: gp.simTime };
        this.cacheSize();
        this.draw();
    }

    _image(aNow, x, y, geom) {
        if (geom.periodic) {
            minImage(aNow[0], aNow[1], x, y, geom.topo, geom.W, geom.H, geom.W / 2, geom.H / 2, _mi);
            return { x: _mi.x, y: _mi.y, fx: _mi.fx, fy: _mi.fy };
        }
        return { x: x - aNow[0], y: y - aNow[1], fx: 1, fy: 1 };
    }

    /** A world line as observer-frame points [{x, t, tau}], oldest first. */
    _project(ring, meta, xNow, epoch, fr, geom) {
        const count = meta[1];
        const start = (meta[0] + WORLDLINE_LEN - count) % WORLDLINE_LEN;
        const mf = new Float32Array(meta.buffer, meta.byteOffset, meta.length);
        const A = [(meta[4] & 1) ? -1 : 1, (meta[4] & 2) ? -1 : 1];
        const b = [mf[5], mf[6]];
        const img = this._image(fr.aNow, xNow[0], xNow[1], geom);
        const L = [A[0] * img.fx, A[1] * img.fy];
        const base = [fr.aNow[0] + img.x, fr.aNow[1] + img.y];
        const cNow = [A[0] * xNow[0] + b[0], A[1] * xNow[1] + b[1]];
        const su = Math.hypot(fr.u[0], fr.u[1]);
        const n = su > 1e-6 ? [fr.u[0] / su, fr.u[1] / su] : [1, 0];
        const pts = [];
        for (let k = 0; k < count; k++) {
            const o = ((start + k) % WORLDLINE_LEN) * WL_STRIDE;
            const t = ring[o] + epoch;
            const X = [base[0] + L[0] * (ring[o + 1] - cNow[0]), base[1] + L[1] * (ring[o + 2] - cNow[1])];
            const dx = X[0] - fr.xA[0], dy = X[1] - fr.xA[1], dt = t - fr.tA;
            let xp, tp;
            if (fr.corot) {
                const a = -(fr.phi + fr.omega * dt);
                xp = Math.cos(a) * dx - Math.sin(a) * dy;
                tp = dt;
            } else if (fr.lorentz && su > 1e-6) {
                const par = dx * n[0] + dy * n[1];
                tp = fr.gamma * (dt - su * par);
                xp = fr.gamma * (par - su * dt);
            } else {
                xp = dx * n[0] + dy * n[1];
                tp = dt;
            }
            pts.push({ x: xp, t: tp, tau: ring[o + 7] });
        }
        return pts;
    }

    draw() {
        const sim = this.sim;
        const isLight = sim.overlay.isLight;
        const pal = isLight ? _PAL.light : _PAL.dark;
        const w = this._width;
        const h = Math.round(w * 0.82);
        const dpr = window.devicePixelRatio || 1;
        if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
            this.canvas.width = Math.round(w * dpr);
            this.canvas.height = Math.round(h * dpr);
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
        }
        const c = this.ctx;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, w, h);

        // Equal scales, so light rays run at 45°; the observer's event sits near the top
        const s = h / (T_PAST + T_FUTURE);
        const ox = w / 2, oy = T_FUTURE * s;
        const X = (x) => ox + x * s;
        const Y = (t) => oy - t * s;

        // Axes and the light cone through the observer's event
        c.lineWidth = 1;
        c.strokeStyle = pal.text + '1F';
        c.beginPath();
        c.moveTo(0, Y(0)); c.lineTo(w, Y(0));
        c.moveTo(X(0), 0); c.lineTo(X(0), h);
        c.stroke();
        c.strokeStyle = pal.textMuted + '66';
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(X(-T_PAST), Y(-T_PAST)); c.lineTo(X(T_FUTURE), Y(T_FUTURE));
        c.moveTo(X(T_PAST), Y(-T_PAST)); c.lineTo(X(-T_FUTURE), Y(T_FUTURE));
        c.stroke();
        c.setLineDash([]);

        const d = this.data;
        if (d) {
            const fr = d.frame;
            // The lab's now: lab time = now, which is t′ = lag/γ − u·x′ in a boosted frame
            const lag = d.now - fr.tA;
            const su = fr.lorentz ? Math.hypot(fr.u[0], fr.u[1]) : 0;
            c.strokeStyle = pal.textMuted + '99';
            c.setLineDash([1, 3]);
            c.beginPath();
            const xr = w / (2 * s);
            c.moveTo(X(-xr), Y(lag / fr.gamma + su * xr));
            c.lineTo(X(xr), Y(lag / fr.gamma - su * xr));
            c.stroke();
            c.setLineDash([]);

            // World lines, with a tick every TICK of proper time
            d.lines.forEach((pts, k) => {
                if (pts.length < 2) return;
                const focus = k === d.focus;
                c.strokeStyle = focus ? pal.accent : pal.text + '8C';
                c.lineWidth = focus ? 1.4 : 1;
                c.beginPath();
                let started = false;
                for (let i = 0; i < pts.length; i++) {
                    const p = pts[i];
                    if (i > 0 && Math.abs(p.x - pts[i - 1].x) > 20) { started = false; }
                    if (!started) { c.moveTo(X(p.x), Y(p.t)); started = true; }
                    else c.lineTo(X(p.x), Y(p.t));
                }
                c.stroke();
                c.fillStyle = focus ? pal.accent : pal.text + 'B3';
                for (let i = 1; i < pts.length; i++) {
                    if (Math.floor(pts[i].tau / TICK) !== Math.floor(pts[i - 1].tau / TICK)) {
                        c.beginPath();
                        c.arc(X(pts[i].x), Y(pts[i].t), focus ? 2 : 1.5, 0, 2 * Math.PI);
                        c.fill();
                    }
                }
            });
        }

        // Your now: t′ = 0
        c.strokeStyle = pal.accent + 'B3';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, Y(0)); c.lineTo(w, Y(0));
        c.stroke();

        // Axis names
        c.fillStyle = pal.textMuted;
        c.font = `italic 12px ${_FONT.text}`;
        c.textBaseline = 'alphabetic';
        c.textAlign = 'left';
        c.fillText('t′', X(0) + 4, 12);
        c.textAlign = 'right';
        c.fillText('x′', w - 4, Y(0) - 4);
    }
}
