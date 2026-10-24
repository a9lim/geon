// ─── The figure caption ───
// One live italic line under the scene saying what you are looking at, with its current
// values: the preset, the view, the observer's frame, the selected body. Rebuilt a few
// times a second (shared/colophon.js caption() writes only on change).
import { getLang } from './i18n.js';

const fmt = (x, d = 2) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(d));

const TEXT = {
    en: {
        paused: 'Paused. ',
        empty: (touch) => `An empty plane. ${touch ? 'Tap' : 'Click'} to place a body, and drag to throw it.`,
        plane: (n, touch) => `Seen from above, the present holds ${n} ${n === 1 ? 'body' : 'bodies'}, each trail the shadow of a world line. ${touch ? 'Spacetime' : 'Alt-drag, W or Spacetime'} tilts the plane into time.`,
        spacetime: (D, B) => `Spacetime, ${D} deep. Each world line climbs to the plane of the present, beaded every ${B} of its own time, so a moving clock beads more sparsely; light runs at 45°.`,
        observer: (v, g, lag) => `In the coordinates of an observer moving at ${v}c (γ = ${g}): the plane is that observer’s present${lag ? `, ${lag} behind the lab` : ''}, and the lab’s rulers shrink by 1/γ.`,
        selected: (v, tau) => ` The red body moves at ${v}c; its clock reads ${tau}.`,
    },
    ja: {
        paused: '一時停止中。',
        empty: (touch) => `空の平面。${touch ? 'タップ' : 'クリック'}で物体を置き、ドラッグで投げる。`,
        plane: (n, touch) => `上から見た現在に物体が${n}個。軌跡はそれぞれ世界線の影。${touch ? '「時空」' : 'Alt+ドラッグ、W、または「時空」'}で平面を時間の方へ傾ける。`,
        spacetime: (D, B) => `深さ${D}の時空。世界線は現在の平面まで昇り、固有時${B}ごとに珠を打つ。動く時計ほど珠はまばらで、光は45°に進む。`,
        observer: (v, g, lag) => `速さ${v}c（γ = ${g}）で動く観測者の座標。平面はその観測者の現在${lag ? `で、実験室より${lag}遅れる` : 'で'}、実験室の物差しは1/γに縮む。`,
        selected: (v, tau) => `赤い物体の速さは${v}c、その時計は${tau}。`,
    },
};

export default class Caption {
    constructor(sim) {
        this.sim = sim;
        this.titleEl = document.getElementById('caption-title');
        this.set = _colophon.caption(document.getElementById('caption-text'), 250);
        this._force = true;
        this._touch = window.matchMedia('(pointer: coarse)').matches;
        this._preset = document.getElementById('preset-select');
    }

    /** Rewrite on the next update, without waiting out the throttle. */
    refresh() { this._force = true; }

    update() {
        const sim = this.sim;
        const L = TEXT[getLang()] || TEXT.en;
        const opt = this._preset.selectedOptions[0];
        const stop = getLang() === 'ja' ? '。' : '. ';
        const title = this._preset.value !== 'none' && opt ? opt.textContent.trim() + stop : '';
        if (this.titleEl.textContent !== title) this.titleEl.textContent = title;

        const n = sim.gpu ? sim.gpu.physics.aliveCount : 0;
        let text = sim.running ? '' : L.paused;
        if (n === 0) {
            text += L.empty(this._touch);
        } else if (sim.frames.active) {
            const st = sim.frames.state;
            const v = st && st.valid ? Math.hypot(st.ux, st.uy) : sim.frames.boostSpeed;
            const g = 1 / Math.sqrt(1 - Math.min(v * v, 0.9999));
            text += L.observer(fmt(v), fmt(g), st && st.valid && st.lag > 0.05 ? fmt(st.lag, 1) : '');
        } else if (sim.spacetime.tilt > 0.5) {
            const D = sim.spacetime.depth();
            text += L.spacetime(Math.round(D), 2 ** Math.round(Math.log2(D / 14)));
        } else if (this._preset.value !== 'none') {
            // Seen from above, a preset says what it shows
            const key = 'preset.' + this._preset.value + '.desc';
            const desc = window._i18n ? window._i18n.t(key, '') : '';
            text += desc && desc !== key ? desc + '.' : L.plane(n, this._touch);
        } else {
            text += L.plane(n, this._touch);
        }
        const sel = sim.selectedIdx >= 0 ? sim.stats.selected : null;
        if (sel) text += L.selected(fmt(sel.speed), fmt(sel.tau, 1));
        this.set(text, this._force);
        this._force = false;
    }
}
