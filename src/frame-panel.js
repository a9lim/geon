// ─── Frame panel ───
// The Frame tab: which observer the view is drawn for (frames.js), its parameters, what it
// reads (speed, γ, and how far behind the lab its now is), and the look-back scrubber, which
// only acts while paused.
import { FRAME_KEYS, FRAME_LAB, FRAME_PARTICLE, FRAME_BOOST, FRAME_COROTATE } from './frames.js';
import { WORLDLINE_LEN, WORLDLINE_DT } from './config.js';
import { t } from './i18n.js';

export default class FramePanel {
    constructor(sim) {
        this.sim = sim;
        const $ = (id) => document.getElementById(id);
        this.el = {
            select: $('frame-select'),
            boost: $('frame-boost-group'),
            direction: $('frame-direction-group'),
            corotate: $('frame-corotate-group'),
            readout: $('frame-readout'),
            speed: $('frame-speed'),
            gamma: $('frame-gamma'),
            now: $('frame-now'),
            extrapolated: $('frame-extrapolated'),
            scrub: $('frame-scrub-group'),
            lookBack: $('frameLookBackInput'),
        };
        this.el.select.addEventListener('change', () => this.choose(this.el.select.value));

        _forms.bindSlider($('frameRapidityInput'), $('frameSpeedValue'), v => {
            sim.frames.rapidity = v;
            sim._dirty = true;
        }, v => Math.tanh(v).toFixed(2) + 'c');
        _forms.bindSlider($('frameDirInput'), $('frameDirValue'), v => {
            sim.frames.direction = v * Math.PI / 180;
            sim._dirty = true;
        }, v => Math.round(v) + '°');
        _forms.bindSlider($('frameOmegaInput'), $('frameOmegaValue'), v => {
            sim.frames.omega = v;
            sim._dirty = true;
        }, v => v.toFixed(3));
        _forms.bindSlider(this.el.lookBack, $('frameLookBackValue'), v => {
            sim.frames.lookBack = v;
            sim._dirty = true;
        }, v => v.toFixed(1));
        this._sync();
    }

    /** Switch to the frame named `key` ('lab', 'zmf', …); the particle frame needs a selection. */
    choose(key) {
        const sim = this.sim;
        const kind = Math.max(0, FRAME_KEYS.indexOf(key));
        if (kind !== FRAME_LAB && !sim.frames.allowed) {
            if (typeof showToast === 'function') showToast(t('frame.expanding'));
            sim.frames.set(FRAME_LAB);
        } else if (!sim.frames.set(kind)) {
            if (typeof showToast === 'function') showToast(t('frame.needSelection'));
        }
        this._sync();
    }

    /** The next frame in the list (B). */
    cycle() {
        const next = (this.sim.frames.kind + 1) % FRAME_KEYS.length;
        // Skip the particle frame when nothing is selected
        const kind = next === FRAME_PARTICLE && this.sim.selectedIdx < 0 ? next + 1 : next;
        this.choose(FRAME_KEYS[kind % FRAME_KEYS.length]);
    }

    _sync() {
        const frames = this.sim.frames;
        const key = FRAME_KEYS[frames.kind];
        if (this.el.select.value !== key) {
            // The shared dropdown redraws its label on 'change'; choose() then finds the
            // frame already set, so this doesn't recurse
            this.el.select.value = key;
            this.el.select.dispatchEvent(new Event('change'));
        }
        const show = (el, on) => { el.style.display = on ? '' : 'none'; };
        show(this.el.boost, frames.kind === FRAME_BOOST);
        show(this.el.direction, frames.kind === FRAME_BOOST);
        show(this.el.corotate, frames.kind === FRAME_COROTATE);
        this.el.readout.hidden = !frames.active;
        this.update();
    }

    /** Refresh the readouts (each rendered frame). */
    update() {
        const sim = this.sim;
        const frames = sim.frames;
        const paused = !sim.running;
        this.el.scrub.style.display = frames.active && paused ? '' : 'none';
        if (!frames.active) return;
        const st = frames.state;
        if (!st || !st.valid) {
            this.el.speed.textContent = '—';
            this.el.gamma.textContent = '—';
            this.el.now.textContent = '—';
            this.el.extrapolated.hidden = true;
            return;
        }
        const speed = Math.hypot(st.ux, st.uy);
        this.el.speed.textContent = speed.toFixed(3) + 'c';
        this.el.gamma.textContent = st.gamma.toFixed(3);
        this.el.now.textContent = st.lag > 0.05
            ? t('frame.nowLagged').replace('{lag}', st.lag.toFixed(1))
            : t('frame.nowLab');
        this.el.extrapolated.hidden = !this._outsideHistory(st);
    }

    /**
     * Whether the visible slice leaves the recorded history: its trailing edge before the
     * run began or the ring's oldest sample, or its leading edge past the lab's now (the lag
     * is capped at the ring's reach). frame-slice.wgsl extrapolates there.
     */
    _outsideHistory(st) {
        const sim = this.sim;
        const p = sim.frames.params();
        const now = sim._gpuPhysics ? sim._gpuPhysics.conformalTime : 0;
        let back = 0, ahead = 0;
        const s = Math.hypot(st.ux, st.uy);
        if (p && st.lorentz && s > 1e-6) {
            const nx = st.ux / s, ny = st.uy / s;
            const spread = Math.abs(p.viewHalfW * nx) + Math.abs(p.viewHalfH * ny);
            const along = p.viewX * nx + p.viewY * ny;
            back = s * st.gamma * Math.max(spread - along, 0);
            ahead = s * st.gamma * Math.max(spread + along, 0);
        }
        const start = Math.max(0, now - WORLDLINE_LEN * WORLDLINE_DT);
        return st.tA - back < start - 0.01 || st.tA + ahead > now + 0.01;
    }

    /** The particle frame's observer died: fall back to the lab. */
    observerLost() {
        if (this.sim.frames.kind === FRAME_PARTICLE) this.choose('lab');
    }
}

export { FRAME_LAB };
