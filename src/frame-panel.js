// ─── Frame panel ───
// The Frame tab: which observer the view is drawn for (frames.js), its parameters, what it
// reads (speed, γ, and how far behind the lab its now is), and the look-back scrubber, which
// only acts while paused.
import { FRAME_KEYS, FRAME_LAB, FRAME_PARTICLE, FRAME_BOOST, FRAME_COROTATE, FRAME_FREEFALL } from './frames.js';
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

        this._fmtSpeed = v => Math.tanh(v).toFixed(2) + 'c';
        this._fmtDir = v => Math.round(v) + '°';
        // The boost here and the scene's Boost slider are one setting (ui.js setBoost)
        _forms.bindSlider($('frameRapidityInput'), $('frameSpeedValue'), v => {
            sim.frames.rapidity = v;
            sim.syncBoost?.();
            sim._dirty = true;
        }, this._fmtSpeed);
        _forms.bindSlider($('frameDirInput'), $('frameDirValue'), v => {
            sim.frames.direction = v * Math.PI / 180;
            sim.syncBoost?.();
            sim._dirty = true;
        }, this._fmtDir);
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

    /** Show the boost frame's speed and direction as frames.js holds them. */
    syncBoost() {
        const f = this.sim.frames, $ = (id) => document.getElementById(id);
        const deg = ((f.direction * 180 / Math.PI) % 360 + 360) % 360;
        $('frameRapidityInput').value = f.rapidity;
        $('frameSpeedValue').textContent = this._fmtSpeed(f.rapidity);
        $('frameDirInput').value = deg;
        $('frameDirValue').textContent = this._fmtDir(deg);
    }

    /** The next frame in the list (B). */
    cycle() {
        // The next frame, skipping the ones that follow a particle when nothing is selected
        let kind = this.sim.frames.kind;
        do kind = (kind + 1) % FRAME_KEYS.length;
        while ((kind === FRAME_PARTICLE || kind === FRAME_FREEFALL) && this.sim.selectedIdx < 0);
        this.choose(FRAME_KEYS[kind]);
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
        this.sim.syncCoords?.();
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
        if (this.sim.frames.followsParticle) this.choose('lab');
    }
}

export { FRAME_LAB };
