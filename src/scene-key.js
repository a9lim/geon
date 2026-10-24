// ─── The key ───
// The plate's Reference: a hairline box at the stage's bottom right naming each mark the scene is
// drawing now, and only those: the kinds of body present, their world lines and clocks, light,
// the spacetime view's cone and events, the Fields overlay's layers, the scalar fields' hatching,
// a uniform external field with its value, the lensed backdrop. Each swatch is drawn with the
// scene's own mark in the scene's own ink. Rebuilt only when its rows change; G hides it with
// the rulers, and it stays out of a small stage. The same swatches make the margin's Forces
// and Physics sections a legend (decorateMargin).
import { getLang } from './i18n.js';
import { CLOCK_PERIOD } from './config.js';

const ink = (n) => `var(--ink-${n})`;
const MUTED = 'var(--text-muted)', TEXT = 'var(--text)', ACCENT = 'var(--accent)', GROUND = 'var(--bg-canvas)';
// A body is its ink mixed into the ground inside an outline of the ink, as particle.wgsl draws it
const fillOf = (c) => `color-mix(in srgb, ${c} var(--key-body), ${GROUND})`;
const markOf = (c) => `color-mix(in srgb, ${c} 55%, ${TEXT})`;
const fmt = (x) => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

const line = (x1, y1, x2, y2, c, w = 1, extra = '') =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${c};stroke-width:${w}"${extra}/>`;
const circle = (cx, cy, r, stroke, fill = 'none', w = 1, extra = '') =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" style="stroke:${stroke};fill:${fill};stroke-width:${w}"${extra}/>`;
const path = (d, c, w = 1, extra = '') => `<path d="${d}" style="stroke:${c};fill:none;stroke-width:${w}"${extra}/>`;

/** Hatching across a w × h box at (x, y): lines of constant x + y (rising) or x − y. */
function hatch(x, y, w, h, rising, c) {
    let out = '';
    for (let s = -h; s < w + h; s += 3.5) {
        const [x1, x2] = rising ? [x + s, x + s + h] : [x + s + h, x + s];
        out += line(x1, y + h, x2, y, c, 0.9);
    }
    // A nested svg clips to its own box
    return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">${out}</svg>`;
}

/** ⊙ (out of the plane) or ⊗ (into it), as heatmap-render.wgsl draws Bz. */
function bSymbol(cx, cy, into, c) {
    const k = 2.2;
    return circle(cx, cy, 3.6, c, 'none', 1) + (into
        ? line(cx - k, cy - k, cx + k, cy + k, c) + line(cx - k, cy + k, cx + k, cy - k, c)
        : circle(cx, cy, 1.1, 'none', c, 0));
}

/** A short arrow through the swatch's middle at angle a (radians, y down). */
function arrow(a, c) {
    const ux = Math.cos(a), uy = Math.sin(a), L = 9, h = 3.2;
    const x1 = 13 - ux * L, y1 = 7 - uy * L, x2 = 13 + ux * L, y2 = 7 + uy * L;
    const p = (s, t) => `${(x2 - ux * s - uy * t).toFixed(2)},${(y2 - uy * s + ux * t).toFixed(2)}`;
    return line(x1.toFixed(2), y1.toFixed(2), x2.toFixed(2), y2.toFixed(2), c, 1.1)
        + `<path d="M${p(h, -h * 0.7)}L${x2.toFixed(2)},${y2.toFixed(2)}L${p(h, h * 0.7)}" style="stroke:${c};fill:none;stroke-width:1.1;stroke-linejoin:round"/>`;
}

/** A wave packet: a sinusoid under a Gaussian envelope, as boson-render.wgsl draws a photon. */
function packet(c) {
    let d = '';
    for (let k = 0; k <= 48; k++) {
        const s = -11 + 22 * k / 48, env = Math.exp(-((s / 11) ** 2) * 2.4);
        d += `${k ? 'L' : 'M'}${(13 + s).toFixed(2)},${(7 - 2.6 * env * Math.sin(2 * Math.PI * s / 5)).toFixed(2)}`;
    }
    return path(d, c, 1.2);
}

/** A body: its fill, outline and, by kind, its sign or its spoke. */
function body(c, mark) {
    const R = 5.2;
    let out = circle(13, 7, R, c, mark === 'anti' ? GROUND : fillOf(c), 1.25);
    const m = markOf(c), k = R * 0.42;
    if (mark === '+' || mark === '-') {
        out += line(13 - k, 7, 13 + k, 7, m, 1.1);
        if (mark === '+') out += line(13, 7 - k, 13, 7 + k, m, 1.1);
        out += line(13 + R * 0.6 * 0.6, 7 - R * 0.6 * 0.8, 13 + R * 0.6, 7 - R * 0.8, m, 1.1);   // the rim tick
    } else if (mark === 'spoke') {
        out += line(13, 7, 13 + R * 0.6, 7 - R * 0.8, m, 1.1);
    }
    return out;
}

const SWATCH = {
    pos: () => body(ink('sienna'), '+'),
    neg: () => body(ink('prussian'), '-'),
    neutral: () => body(MUTED, 'spoke'),
    anti: () => body(MUTED, 'anti'),
    hole: () => circle(13, 7, 4.4, 'var(--key-void-edge)', 'var(--key-void)', 0.8)
        + circle(13, 7, 6.4, `color-mix(in srgb, ${TEXT} 55%, transparent)`, 'none', 1, ' stroke-dasharray="2 2"'),
    selected: () => body(MUTED, 'spoke') + circle(13, 7, 6.6, ACCENT, 'none', 1.25),
    trail: () => line(1, 7, 25, 7, MUTED, 1) + [4, 11, 18, 25].map((x) => circle(x - 0.5, 7, 1.7, 'none', MUTED, 0)).join(''),
    clock: () => circle(13, 7, 5.6, `color-mix(in srgb, ${MUTED} 45%, transparent)`, 'none', 1)
        + path('M13,1.4 A5.6,5.6 0 1 1 7.4,7', MUTED, 1.4),
    light: () => packet(ink('ochre')),
    cone: () => path('M13,1.5 L4,11.5 M13,1.5 L22,11.5', ACCENT, 1)
        + path('M4,11.5 A9,2 0 0 0 22,11.5', ACCENT, 1)
        + path('M4,11.5 A9,2 0 0 1 22,11.5', ACCENT, 1, ' stroke-dasharray="1.5 2"'),
    event: () => line(13, 0, 13, 14, MUTED, 1) + circle(13, 7, 3.3, TEXT, GROUND, 1),
    gravity: () => path('M1,10 C7,3 17,3 25,9', ink('umber'), 1.3)
        + line(7.5, 5.6, 8.6, 7.9, ink('umber')) + line(13, 4.3, 13.2, 6.8, ink('umber')) + line(18.6, 4.9, 17.8, 7.3, ink('umber')),
    efield: () => path('M1,10 C8,10 14,4 25,4', ink('prussian'), 1)
        + path('M11.4,4.6 L14.2,6.8 L11.0,8.3', ink('prussian'), 1, ' stroke-linejoin="round"'),
    equi: () => line(1, 4, 25, 4, ink('sienna'), 1.3) + line(1, 10.5, 25, 10.5, ink('prussian'), 1.3, ' stroke-dasharray="4 3"'),
    bz: () => bSymbol(7, 7, false, ink('verdigris')) + bSymbol(19, 7, true, ink('verdigris')),
    yukawa: () => path('M1,9 C8,3 17,3 25,9', ink('viridian'), 1.4, ' stroke-dasharray="0.1 3" stroke-linecap="round"'),
    higgs: () => hatch(1, 1, 11, 12, true, ink('sap')) + hatch(14, 1, 11, 12, false, ink('violet')) + line(13, 0, 13, 14, TEXT, 1.4),
    axion: () => hatch(1, 1, 11, 12, true, ink('ochre')) + hatch(14, 1, 11, 12, false, ink('indigo')) + line(13, 0, 13, 14, TEXT, 1.4),
    extB: (o) => bSymbol(13, 7, o.into, ink('verdigris')),
    extE: (o) => arrow(o.angle, ink('prussian')),
    extG: (o) => arrow(o.angle, ink('umber')),
    lens: () => path('M1,3 C9,3 10,7 13,7 C16,7 17,3 25,3', MUTED, 1) + path('M1,11 C9,11 10,9 13,9 C16,9 17,11 25,11', MUTED, 1),
    star: () => path('M6,9 A7,7 0 0 1 11,2.6', ACCENT, 1.6) + circle(19, 9, 1.6, 'none', ACCENT, 0),
    // The margin's legend: a force that draws only its arrows, and the torque arc
    force: (o) => arrow(0, ink(o.ink)),
    torque: (o) => path('M8,10.5 A5.5,5.5 0 1 1 18.5,9', ink(o.ink), 1.1)
        + path('M16.2,7.4 L18.5,9 L19.6,6.4', ink(o.ink), 1.1, ' stroke-linejoin="round"'),
};

/** An inline swatch: the scene's mark for `kind` (SWATCH), 26 × 14 px. */
export function swatch(kind, o = {}, cls = '') {
    return `<svg class="${cls}" viewBox="0 0 26 14" width="26" height="14" aria-hidden="true">${kind ? SWATCH[kind](o) : ''}</svg>`;
}

// The Forces and Physics sections as a legend: each switch's row leads with the mark that
// force makes in the scene, in its ink (a mode, which draws nothing, keeps the space)
const LEGEND = [
    ['gravity-toggle', 'gravity'], ['gravitomag-toggle', 'force', { ink: 'madder' }],
    ['coulomb-toggle', 'efield'], ['magnetic-toggle', 'bz'], ['yukawa-toggle', 'yukawa'],
    ['axion-toggle', 'axion'], ['higgs-toggle', 'higgs'],
    ['relativity-toggle', null], ['onepn-toggle', 'force', { ink: 'mulberry' }], ['blackhole-toggle', 'hole'],
    ['spinorbit-toggle', 'torque', { ink: 'violet' }], ['radiation-toggle', 'light'], ['bosoninter-toggle', null],
];

export function decorateMargin() {
    for (const [id, kind, o] of LEGEND) {
        const label = document.querySelector(`.ctrl-row > label[for="${id}"]`);
        if (label && !label.querySelector('.row-swatch')) label.insertAdjacentHTML('afterbegin', swatch(kind, o, 'row-swatch'));
    }
}

const WORDS = {
    en: {
        title: 'Reference',
        pos: 'Positive charge', neg: 'Negative charge', neutral: 'Neutral', anti: 'Antimatter, hollow',
        hole: 'A horizon, its ergosphere dashed',
        selected: 'The selected body',
        trail: (n) => `A world line from above, a bead every ${n} of proper time`,
        worldline: (n) => `A world line, a bead every ${n} of proper time`,
        clock: (p) => `A clock, one turn per ${p} of proper time`,
        light: 'Light; a shorter wave carries more energy',
        cone: 'The red body’s past light cone',
        event: 'An event: a birth, death, merger or kick',
        gravity: 'Gravity’s potential, ticked downhill',
        efield: 'The charges’ electric field lines',
        equi: 'Equipotentials, + solid and − dashed',
        bz: 'B out of the plane, and into it',
        yukawa: 'Yukawa’s potential',
        higgs: 'The Higgs at +v and −v, a wall between',
        axion: 'The axion above and below zero',
        extB: (b, into) => `A uniform B of ${b}, ${into ? 'into' : 'out of'} the plane`,
        extE: (e) => `A uniform E of ${e}`,
        extG: (g) => `Uniform gravity of ${g}`,
        lens: 'The backdrop’s rulers, bent by the lens',
        star: 'The backdrop star’s images',
    },
    ja: {
        title: '凡例',
        pos: '正の電荷', neg: '負の電荷', neutral: '中性', anti: '反物質（中空）',
        hole: '地平線。破線はエルゴ球',
        selected: '選択した物体',
        trail: (n) => `上から見た世界線。固有時${n}ごとに珠`,
        worldline: (n) => `世界線。固有時${n}ごとに珠`,
        clock: (p) => `時計。固有時${p}で一周`,
        light: '光。波が短いほどエネルギーが大きい',
        cone: '赤い物体の過去光円錐',
        event: '事象：生成、消滅、合体、衝撃',
        gravity: '重力ポテンシャル。ひげは下りの側',
        efield: '電荷の電気力線',
        equi: '等電位線。＋は実線、−は破線',
        bz: '平面から出る磁場と、入る磁場',
        yukawa: '湯川ポテンシャル',
        higgs: 'ヒッグス場の＋vと−v、その間の壁',
        axion: 'アクシオン場の正と負',
        extB: (b, into) => `一様な磁場 ${b}、平面${into ? 'に入る' : 'から出る'}向き`,
        extE: (e) => `一様な電場 ${e}`,
        extG: (g) => `一様な重力 ${g}`,
        lens: 'レンズに曲げられた背景の目盛り',
        star: '背景の星の像',
    },
};

export default class SceneKey {
    constructor(sim) {
        this.sim = sim;
        this.el = document.getElementById('scene-key');
        this._sig = null;
        this._at = 0;
    }

    /** Rebuild on the next update. */
    refresh() { this._at = 0; this._sig = null; }

    /** The rows the scene calls for now: [kind, text, swatch options]. */
    _rows(L) {
        const sim = this.sim, ph = sim.settings, view = sim.spacetime;
        const rows = [];
        const tilted = view && view.tilt > 0.05;
        const lab = !sim.frames.active;
        const bodies = sim.scene ? sim.scene.bodies : [];
        // The bodies by kind (each is drawn at least 2 px across, particle.wgsl)
        let pos = false, neg = false, neutral = false, anti = false, any = false;
        for (const b of bodies) {
            if (!b.alive) continue;
            any = true;
            if (b.anti) anti = true;
            else if (b.q > 0.05) pos = true;
            else if (b.q < -0.05) neg = true;
            else neutral = true;
        }
        if (ph.blackHoleEnabled) {
            if (any) rows.push(['hole', L.hole]);
        } else {
            if (pos) rows.push(['pos', L.pos]);
            if (neg) rows.push(['neg', L.neg]);
            if (neutral) rows.push(['neutral', L.neutral]);
            if (anti) rows.push(['anti', L.anti]);
        }
        if (sim.selectedIdx >= 0) rows.push(['selected', L.selected]);
        if (any && (tilted || (sim.view.trails && lab))) {
            const n = 2 ** Math.round(Math.log2(view.depth() / 14));
            rows.push(['trail', tilted ? L.worldline(n) : L.trail(n)]);
        }
        if (any && sim.view.showClocks) rows.push(['clock', L.clock(CLOCK_PERIOD)]);
        if (tilted && sim.selectedIdx >= 0) rows.push(['cone', L.cone]);
        if (tilted && any) rows.push(['event', L.event]);
        if ((sim.stats.photonE || 0) > 1e-6) rows.push(['light', L.light]);

        // The Fields overlay's layers (lab only), as GPUBackend.render picks them
        if (sim.heatmap.enabled && lab) {
            const m = sim.heatmap.mode, on = (k) => m === 'all' || m === k;
            if (ph.gravityEnabled && on('gravity')) rows.push(['gravity', L.gravity]);
            if (ph.coulombEnabled && on('electric')) {
                if (pos || neg) rows.push(['efield', L.efield]);
                if (m === 'electric') rows.push(['equi', L.equi]);
            }
            if ((ph.magneticEnabled || ph.extBz !== 0) && on('magnetic')) rows.push(['bz', L.bz]);
            if (ph.yukawaEnabled && on('yukawa')) rows.push(['yukawa', L.yukawa]);
        }
        if (ph.higgsEnabled && lab) rows.push(['higgs', L.higgs]);
        if (ph.axionEnabled && lab) rows.push(['axion', L.axion]);

        // A uniform external field has no structure to draw, so the key names it
        if (ph.extBz) rows.push(['extB', L.extB(fmt(Math.abs(ph.extBz)), ph.extBz > 0), { into: ph.extBz > 0 }]);
        if (ph.extElectric) rows.push(['extE', L.extE(fmt(ph.extElectric)), { angle: ph.extElectricAngle || 0 }]);
        if (ph.extGravity) rows.push(['extG', L.extG(fmt(ph.extGravity)), { angle: ph.extGravityAngle || 0 }]);

        if (sim.lens.on && lab) {
            rows.push(['lens', L.lens]);
            if (sim.lens.star) rows.push(['star', L.star]);
        }
        return rows;
    }

    update() {
        const now = performance.now();
        if (now - this._at < 250) return;
        this._at = now;
        const sim = this.sim;
        const stage = this.el.parentElement;
        const room = stage.clientWidth >= 700 && stage.clientHeight >= 420;
        const L = WORDS[getLang()] || WORDS.en;
        const rows = room && sim.view.grid ? this._rows(L) : [];
        const sig = rows.length ? getLang() + rows.map((r) => r[0] + r[1]).join('|') : '';
        if (sig === this._sig) return;
        this._sig = sig;
        this.el.hidden = !rows.length;
        if (!rows.length) { this.el.replaceChildren(); return; }
        this.el.innerHTML = `<div class="scene-key-in"><p class="scene-key-title">${L.title}</p>`
            + rows.map(([kind, text, o]) => `<div class="scene-key-row">${swatch(kind, o)}<span>${text}</span></div>`).join('')
            + '</div>';
    }
}
