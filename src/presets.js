// ─── Preset Definitions ───
// Six curated presets, each a figure that opens on its own frame. A preset sets toggles,
// engine settings and visuals, then spawns its bodies.
import { DEFAULT_DOMAIN, DEFAULT_PION_MASS, DEFAULT_HIGGS_MASS, DEFAULT_AXION_MASS, SPEED_OPTIONS, DEFAULT_SPEED_INDEX } from './config.js';

// Each preset may set `domain: [w, h]` in world units; the default is DEFAULT_DOMAIN square.
export const PRESETS = {
    cyclotron: {
        name: 'Cyclotron drift',
        desc: 'Charges of both signs circle a uniform magnetic field and drift together across an electric one: in spacetime, helices of opposite hand leaning the same way',
        toggles: {
            gravity: false, coulomb: true, magnetic: true, gravitomag: false,
            relativity: true, onepn: false, blackhole: false,
            radiation: true, spinorbit: false, disintegration: false,
            barneshut: false, bosonInter: false, yukawa: false, axion: false, expansion: false, higgs: false,
        },
        settings: { collision: 'pass', boundary: 'loop', topology: 'torus', speed: 16, extBz: 0.8, extElectric: 0.12, extElectricAngle: 90 },
        visuals: { trails: true, velocity: false, force: false, forceComponents: false, potential: false },
        spawn(sim) {
            // Gyration radius r = γmv/(qB) and period T = 2πγm/(qB): at v = 0.5c, |q| = 0.4 and
            // B = 0.8, r ≈ 1.8 and T ≈ 23, so the default depth shows three or four turns. The
            // drift E×B/B² = 0.15c is the same for either sign; synchrotron light leaves at 45°.
            const W = sim.domainW, H = sim.domainH;
            const spots = [[0.2, 0.25], [0.45, 0.2], [0.75, 0.3], [0.3, 0.55], [0.6, 0.5], [0.85, 0.62], [0.2, 0.8], [0.55, 0.82]];
            spots.forEach(([fx, fy], i) => {
                const q = i % 2 ? -0.4 : 0.4;
                const v = 0.35 + 0.25 * ((i * 37) % 7) / 6;
                const a = i * 2.1;
                sim.addParticle(fx * W, fy * H, v * Math.cos(a), v * Math.sin(a), { mass: 1, charge: q, spin: 0 });
            });
        },
    },

    twinBounce: {
        name: 'Twin paradox',
        desc: 'One twin flies to a wall at 0.8c and back, returning younger; on the traveller’s slice the home clock leaps 2vd at the turn',
        toggles: {
            gravity: false, coulomb: false, magnetic: false, gravitomag: false,
            relativity: true, onepn: false, blackhole: false,
            radiation: false, spinorbit: false, disintegration: false,
            barneshut: false, bosonInter: false, yukawa: false, axion: false, expansion: false, higgs: false,
        },
        settings: { collision: 'pass', boundary: 'bounce', speed: 16 },
        visuals: { trails: false, clocks: true, velocity: false, force: false, forceComponents: false, potential: false },
        domain: [160, 40],
        spawn(sim) {
            // Home at rest; the traveller leaves at 0.8c (γ = 5/3), turns at the far wall and
            // comes back, ageing 0.6 of home's time apart from the turn
            const y = sim.domainH / 2;
            sim.addParticle(12, y - 3, 0, 0, { mass: 1, charge: 0, spin: 0 });
            sim.addParticle(12, y + 3, 0.8, 0, { mass: 1, charge: 0, spin: 0 });
        },
    },

    wheel: {
        name: 'Relativistic wheel',
        desc: 'A wheel spinning at 0.9c, moving at 0.9c: contracted, its spoke bent, its clock slow',
        toggles: {
            gravity: false, coulomb: false, magnetic: false, gravitomag: false,
            relativity: true, onepn: false, blackhole: false,
            radiation: false, spinorbit: false, disintegration: false,
            barneshut: false, bosonInter: false, yukawa: false, axion: false, expansion: false, higgs: false,
        },
        settings: { collision: 'pass', boundary: 'loop', topology: 'torus', speed: 16 },
        visuals: { trails: false, clocks: true, velocity: false, force: false, forceComponents: false, potential: false },
        spawn(sim) {
            const cx = sim.domainW / 2, cy = sim.domainH / 2;
            // The same wheel twice, rim speed 0.9: at rest, and crossing the torus at 0.9c.
            // The moving spoke bends by 2·v·v_rim ≈ 93° across the diameter.
            sim.addParticle(cx, cy - 12, 0, 0, { mass: 40, charge: 0, spin: 0.9 });
            sim.addParticle(cx, cy + 12, 0.9, 0, { mass: 40, charge: 0, spin: 0.9 });
        },
    },

    bremsstrahlung: {
        name: 'Bremsstrahlung',
        desc: 'A beam of electrons at 0.95c swings past a heavy nucleus, and each, bent, sheds light beamed along its path',
        toggles: {
            gravity: false, coulomb: true, magnetic: true, gravitomag: false,
            relativity: true, onepn: false, blackhole: false,
            radiation: true, spinorbit: false, disintegration: false,
            barneshut: false, bosonInter: false, yukawa: false, axion: false, expansion: false, higgs: false,
        },
        settings: { collision: 'pass', boundary: 'despawn', speed: 32 },
        visuals: { trails: true, velocity: false, force: false, forceComponents: false, potential: false },
        spawn(sim) {
            // A nucleus of charge 6, heavy enough to barely recoil, and the first electron of a
            // beam already on its way. At 0.95c (γ = 3.2) an electron is unbound anywhere in the
            // domain; passing within the softening length (8) it turns through tens of degrees
            // and radiates a few photons, beamed forward by Larmor's γ⁴. The beam alternates
            // sides, so the momentum the deflected electrons hand the nucleus cancels
            const cx = sim.domainW / 2, cy = sim.domainH / 2;
            sim.addParticle(cx, cy, 0, 0, { mass: 60, charge: 6, spin: 0 });
            this._beam = { next: 0, k: 0 };
            this._fire(sim, cx - 18);
        },
        /** The beam: another electron every 24, from alternate edges, at the next impact parameter. */
        tick(sim) {
            if (sim._gpuPhysics.simTime >= this._beam.next) this._fire(sim);
        },
        _fire(sim, x) {
            const k = this._beam.k++, dir = k % 2 ? -1 : 1;
            const b = [2, -4, 6, -3, 5, -7][k % 6];
            const x0 = x ?? (dir > 0 ? 1 : sim.domainW - 1);
            sim.addParticle(x0, sim.domainH / 2 + b, 0.95 * dir, 0, { mass: 0.3, charge: -1, spin: 0 });
            this._beam.next = sim._gpuPhysics.simTime + 24;
        },
    },

    kibbleZurek: {
        name: 'Kibble–Zurek walls',
        desc: 'A Higgs field quenched through its symmetry-breaking transition freezes into ±v domains; a slower quench leaves fewer walls',
        domain: [128, 128],
        toggles: {
            gravity: false, coulomb: false, magnetic: false, gravitomag: false,
            relativity: false, onepn: false, blackhole: false,
            radiation: false, spinorbit: false, disintegration: false,
            barneshut: false, bosonInter: false, yukawa: false, axion: false, expansion: false, higgs: true,
        },
        settings: { collision: 'pass', boundary: 'loop', topology: 'torus', speed: 16, higgsMass: 0.75 },
        visuals: { trails: false, velocity: false, force: false, forceComponents: false, potential: false },
        spawn(sim) {
            // The symmetric phase, φ ≈ 0, with a Langevin bath; the mass term crosses the
            // transition 120 time units in
            const gp = sim._gpuPhysics;
            gp.setField('higgs', () => 1e-3 * (Math.random() - 0.5));
            gp.setHiggsQuench(120, 1e-4);
            // The simulation steps only with a body: one tracer, too light to bias the field
            sim.addParticle(sim.domainW / 2, sim.domainH / 2, 0, 0, { mass: 1e-3, charge: 0, spin: 0 });
        },
    },

    microlensing: {
        name: 'Microlensing',
        desc: 'A mass drifts in front of a backdrop star: the star splits into two images and brightens along the Paczyński light curve',
        domain: [96, 96],
        toggles: {
            gravity: true, coulomb: false, magnetic: false, gravitomag: false,
            relativity: false, onepn: false, blackhole: false,
            radiation: false, spinorbit: false, disintegration: false,
            barneshut: false, bosonInter: false, yukawa: false, axion: false, expansion: false, higgs: false,
        },
        settings: { collision: 'pass', boundary: 'loop', topology: 'torus', speed: 16 },
        visuals: { trails: false, velocity: false, force: false, forceComponents: false, potential: false },
        spawn(sim) {
            // θ_E = √(4MD) = 8.9 at D = 1; the lens passes 0.3 θ_E from the star, so μ peaks
            // near 3.4
            const cx = sim.domainW / 2, cy = sim.domainH / 2, M = 20;
            const thetaE = Math.sqrt(4 * M);
            sim.addParticle(cx - 36, cy + 0.3 * thetaE, 0.3, 0, { mass: M, charge: 0, spin: 0 });
            sim.lens.distance = 1;
            const slider = document.getElementById('lensDistanceInput');
            if (slider) { slider.value = 0; slider.dispatchEvent(new Event('input')); }
            sim.lensPanel.setLensing(true);
            sim.lensPanel.setProbe(true, { x: cx, y: cy, r: 1.2 });
        },
    },
};

export const PRESET_ORDER = [
    'cyclotron', 'twinBounce', 'wheel', 'bremsstrahlung', 'kibbleZurek', 'microlensing',
];

// ─── Toggle/Setting Application ───

const TOGGLE_MAP = {
    gravity: 'gravity-toggle',
    bosonInter: 'bosoninter-toggle',
    coulomb: 'coulomb-toggle',
    magnetic: 'magnetic-toggle',
    gravitomag: 'gravitomag-toggle',
    relativity: 'relativity-toggle',
    onepn: 'onepn-toggle',
    blackhole: 'blackhole-toggle',
    radiation: 'radiation-toggle',
    spinorbit: 'spinorbit-toggle',
    disintegration: 'disintegration-toggle',
    barneshut: 'barneshut-toggle',
    yukawa: 'yukawa-toggle',
    axion: 'axion-toggle',
    expansion: 'expansion-toggle',
    higgs: 'higgs-toggle',
};

// Parent toggles first so dependency cascades run before children are set
const TOGGLE_ORDER = [
    'gravity', 'coulomb', 'relativity',
    'bosonInter', 'gravitomag', 'magnetic',
    'onepn', 'blackhole',
    'spinorbit', 'radiation', 'disintegration', 'barneshut',
    'yukawa', 'axion', 'expansion', 'higgs',
];

const VISUAL_MAP = {
    trails: 'trailsToggle',
    clocks: 'clocksToggle',
    velocity: 'velocityToggle',
    force: 'forceToggle',
    forceComponents: 'forceComponentsToggle',
    potential: 'potentialToggle',
};

const MODE_GROUPS = {
    collision: { id: 'collision-toggles', attr: 'collision' },
    boundary: { id: 'boundary-toggles', attr: 'boundary' },
    topology: { id: 'topology-toggles', attr: 'topology' },
    potentialMode: { id: 'potential-mode-toggles', attr: 'potential' },
};

// Select menus: a preset's value is the option's value
const SELECT_MAP = {
    schedule: 'cosmo-schedule',
};

// Checkboxes outside the toggle list, with their defaults
const CHECK_MAP = {
    fieldDamping: ['fieldDampingToggle', true],
};

// Sliders whose control holds a transform of the setting (hubble is logarithmic)
const SLIDER_TRANSFORM = {
    hubble: (v) => Math.log10(Math.max(v, 1e-4)),
};

const SLIDER_MAP = {
    friction: 'frictionInput',
    yukawaMu: 'yukawaMuInput',
    axionMass: 'axionMassInput',
    hubble: 'hubbleInput',
    higgsMass: 'higgsMassInput',
    extGravity: 'extGravityInput',
    extGravityAngle: 'extGravityAngleInput',
    extElectric: 'extElectricInput',
    extElectricAngle: 'extElectricAngleInput',
    extBz: 'extBzInput',
};

export function loadPreset(name, sim, { quiet = false } = {}) {
    const preset = PRESETS[name];
    if (!preset) return;

    // 1. Clear state; each preset sets its own domain (square default)
    sim.reset();
    const [domainW, domainH] = preset.domain ?? [DEFAULT_DOMAIN, DEFAULT_DOMAIN];
    sim.setDomain(domainW, domainH);

    // 2. Apply physics toggles in dependency order
    for (const key of TOGGLE_ORDER) {
        if (!(key in preset.toggles)) continue;
        const el = document.getElementById(TOGGLE_MAP[key]);
        if (!el) continue;
        const want = preset.toggles[key];
        if (el.checked !== want) {
            el.checked = want;
            el.setAttribute('aria-checked', String(want));
            el.dispatchEvent(new Event('change'));
        }
    }

    // 3. Apply mode toggle groups
    if (preset.settings) {
        for (const [key, { id, attr }] of Object.entries(MODE_GROUPS)) {
            const val = preset.settings[key];
            if (val == null) continue;
            const group = document.getElementById(id);
            if (!group) continue;
            const target = group.querySelector(`[data-${attr}="${val}"]`);
            if (target) target.click();
        }

        // Sliders
        for (const [key, elId] of Object.entries(SLIDER_MAP)) {
            const val = preset.settings[key];
            if (val == null) continue;
            const el = document.getElementById(elId);
            if (!el) continue;
            el.value = SLIDER_TRANSFORM[key] ? SLIDER_TRANSFORM[key](val) : val;
            el.dispatchEvent(new Event('input'));
        }

        for (const [key, [elId, dflt]] of Object.entries(CHECK_MAP)) {
            const el = document.getElementById(elId);
            const want = preset.settings[key] ?? dflt;
            if (el && el.checked !== want) {
                el.checked = want;
                el.dispatchEvent(new Event('change'));
            }
        }

        for (const [key, elId] of Object.entries(SELECT_MAP)) {
            const el = document.getElementById(elId);
            if (!el) continue;
            const val = String(preset.settings[key] ?? el.querySelector('option')?.value ?? '');
            if (el.value !== val) {
                el.value = val;
                el.dispatchEvent(new Event('change'));
            }
        }

        // Speed: find nearest SPEED_OPTIONS index
        const presetSpeed = preset.settings.speed;
        if (presetSpeed != null) {
            let bestIdx = DEFAULT_SPEED_INDEX;
            let bestDist = Infinity;
            for (let i = 0; i < SPEED_OPTIONS.length; i++) {
                const d = Math.abs(SPEED_OPTIONS[i] - presetSpeed);
                if (d < bestDist) { bestDist = d; bestIdx = i; }
            }
            sim.speedIndex = bestIdx;
        } else {
            sim.speedIndex = DEFAULT_SPEED_INDEX;
        }
        sim.speedScale = SPEED_OPTIONS[sim.speedIndex];
        sim.syncSpeed?.();
    }

    // 4. Apply visual toggles
    if (preset.visuals) {
        for (const [key, elId] of Object.entries(VISUAL_MAP)) {
            const val = preset.visuals[key];
            if (val == null) continue;
            const el = document.getElementById(elId);
            if (!el) continue;
            if (el.checked !== val) {
                el.checked = val;
                el.dispatchEvent(new Event('change'));
            }
        }
    }

    // 5. Reset external fields (presets can override via settings)
    const extDefaults = { extGravity: 0, extGravityAngle: 90, extElectric: 0, extElectricAngle: 0, extBz: 0, yukawaMu: DEFAULT_PION_MASS, higgsMass: DEFAULT_HIGGS_MASS, axionMass: DEFAULT_AXION_MASS };
    for (const [key, elId] of Object.entries(SLIDER_MAP)) {
        if (key in extDefaults && !(preset.settings && key in preset.settings)) {
            const el = document.getElementById(elId);
            if (el && parseFloat(el.value) !== extDefaults[key]) {
                el.value = extDefaults[key];
                el.dispatchEvent(new Event('input'));
            }
        }
    }

    // 6. Spawn particles (as initial conditions: see Simulation.addParticle)
    sim._spawningPreset = true;
    try { preset.spawn(sim); } finally { sim._spawningPreset = false; }
    // A preset may keep its scene going (the bremsstrahlung beam); Simulation.reset() stops it
    sim.presetTick = preset.tick ? () => preset.tick(sim) : null;

    // 7. Reset baseline and notify (i18n: prefer translated preset name)
    sim.stats.resetBaseline();
    const localized = (typeof window !== 'undefined' && window._i18n)
        ? window._i18n.t('preset.' + name + '.name', preset.name)
        : preset.name;
    if (!quiet) showToast(localized);
}
