// ─── UI Setup ───
import { loadPreset } from './presets.js';
import { PHYSICS_DT } from './config.js';

const HINT_FADE_DELAY = 5000;

export function setupUI(sim) {
    // ─── Intro screen dismiss ───
    const introScreen = document.getElementById('intro-screen');
    const introStart = document.getElementById('intro-start');
    const panel = document.getElementById('control-panel');
    const panelToggle = document.getElementById('panelToggle');

    if (introStart && introScreen) {
        introStart.addEventListener('click', () => {
            introScreen.classList.add('hidden');
            document.body.classList.add('app-ready');
            requestAnimationFrame(() => requestAnimationFrame(() => {
                panel.classList.add('open');
                panelToggle.classList.add('active');
            }));
            setTimeout(() => { introScreen.style.display = 'none'; }, 850);
            // Hint fade
            const hint = document.getElementById('hint-bar');
            if (hint) setTimeout(() => hint.classList.add('fade-out'), HINT_FADE_DELAY);
        });
    }

    // ─── Panel toggle ───
    const closePanel = () => {
        panel.classList.remove('open');
        panelToggle.classList.remove('active');
    };
    const togglePanel = () => {
        panel.classList.toggle('open');
        panelToggle.classList.toggle('active');
    };

    panelToggle.addEventListener('click', togglePanel);
    document.getElementById('panelClose').addEventListener('click', closePanel);

    if (typeof initSwipeDismiss === 'function') {
        initSwipeDismiss(panel, { onDismiss: closePanel });
    }

    // ─── Preset dialog ───
    const presetDialog = document.getElementById('preset-dialog');
    const presetBtn = document.getElementById('presetBtn');
    const presetBackdrop = presetDialog.querySelector('.preset-backdrop');

    const closePresetDialog = () => presetDialog.classList.remove('open');

    presetBtn.addEventListener('click', () => presetDialog.classList.add('open'));
    presetBackdrop.addEventListener('click', closePresetDialog);

    presetDialog.querySelectorAll('.preset-card').forEach(card => {
        card.addEventListener('click', () => {
            loadPreset(card.dataset.preset, sim);
            closePresetDialog();
        });
    });

    // ─── Clear ───
    document.getElementById('clearBtn').addEventListener('click', () => {
        sim.particles = [];
        sim.stats.resetBaseline();
        sim.selectedParticle = null;
        sim.physics._forcesInit = false;
        sim.photons = [];
        sim.totalRadiated = 0;
        sim.totalRadiatedPx = 0;
        sim.totalRadiatedPy = 0;
        sim.camera.reset(sim.width / 2, sim.height / 2, 1);
        showToast('Simulation cleared');
    });

    // ─── Pause / Resume ───
    const pauseBtn = document.getElementById('pauseBtn');
    const pauseIcon = document.getElementById('pauseIcon');
    const playIcon = document.getElementById('playIcon');

    pauseBtn.addEventListener('click', () => {
        sim.running = !sim.running;
        pauseIcon.hidden = !sim.running;
        playIcon.hidden = sim.running;
        pauseBtn.title = sim.running ? 'Pause' : 'Resume';
    });

    // ─── Mode toggles ───
    const bindToggleGroup = (id, attr, setter) => {
        const group = document.getElementById(id);
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('.mode-btn');
            if (!btn) return;
            group.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setter(btn.dataset[attr]);
        });
    };

    bindToggleGroup('collision-toggles', 'collision', (v) => { sim.collisionMode = v; });
    bindToggleGroup('boundary-toggles', 'boundary', (v) => {
        sim.boundaryMode = v;
        document.getElementById('topology-group').style.display = v === 'loop' ? '' : 'none';
    });
    bindToggleGroup('topology-toggles', 'topology', (v) => { sim.topology = v; });
    bindToggleGroup('interaction-toggles', 'mode', (v) => { sim.input.mode = v; });

    // ─── Force toggles ───
    const forceToggles = [
        { id: 'gravity-toggle', prop: 'gravityEnabled' },
        { id: 'coulomb-toggle', prop: 'coulombEnabled' },
        { id: 'magnetic-toggle', prop: 'magneticEnabled' },
        { id: 'gravitomag-toggle', prop: 'gravitomagEnabled' },
        { id: 'onepn-toggle', prop: 'onePNEnabled' },
        { id: 'relativity-toggle', prop: 'relativityEnabled' },
        { id: 'radiation-toggle', prop: 'radiationEnabled' },
        { id: 'tidal-toggle', prop: 'tidalEnabled' },
        { id: 'signaldelay-toggle', prop: 'signalDelayEnabled' },
        { id: 'spinorbit-toggle', prop: 'spinOrbitEnabled' },
        { id: 'barneshut-toggle', prop: 'barnesHutEnabled' },
    ];
    forceToggles.forEach(({ id, prop }) => {
        const el = document.getElementById(id);
        el.addEventListener('change', () => {
            sim.physics[prop] = el.checked;
            el.setAttribute('aria-checked', el.checked);
        });
    });

    // ─── Force toggle dependency helper ───
    // When a parent is off, disable the sub-toggle AND turn it off
    const setDepState = (el, prop, disabled) => {
        el.disabled = disabled;
        el.closest('.ctrl-row').classList.toggle('ctrl-disabled', disabled);
        if (disabled && el.checked) {
            el.checked = false;
            el.setAttribute('aria-checked', 'false');
            sim.physics[prop] = false;
        }
    };

    const relativityEl = document.getElementById('relativity-toggle');
    const bhEl = document.getElementById('barneshut-toggle');
    const gravEl = document.getElementById('gravity-toggle');
    const coulEl = document.getElementById('coulomb-toggle');

    // ─── Relativity → Spin-Orbit, Radiation ───
    const updateRelDeps = () => {
        const on = relativityEl.checked;
        setDepState(document.getElementById('spinorbit-toggle'), 'spinOrbitEnabled', !on);
        setDepState(document.getElementById('radiation-toggle'), 'radiationEnabled', !on);
    };
    relativityEl.addEventListener('change', updateRelDeps);
    updateRelDeps();

    // ─── Signal Delay requires Relativity + BH off ───
    const sdEl = document.getElementById('signaldelay-toggle');
    const updateSdDeps = () => {
        setDepState(sdEl, 'signalDelayEnabled', bhEl.checked || !relativityEl.checked);
    };
    bhEl.addEventListener('change', updateSdDeps);
    relativityEl.addEventListener('change', updateSdDeps);
    updateSdDeps();

    // ─── 1PN requires Gravity + Relativity ───
    const pnEl = document.getElementById('onepn-toggle');
    const updatePnDeps = () => {
        setDepState(pnEl, 'onePNEnabled', !(gravEl.checked && relativityEl.checked));
    };
    gravEl.addEventListener('change', updatePnDeps);
    relativityEl.addEventListener('change', updatePnDeps);
    updatePnDeps();

    // ─── Gravity → Gravitomagnetic ───
    const updateGravDeps = () => {
        setDepState(document.getElementById('gravitomag-toggle'), 'gravitomagEnabled', !gravEl.checked);
    };
    gravEl.addEventListener('change', updateGravDeps);
    updateGravDeps();

    // ─── Coulomb → Magnetic ───
    const updateCoulDeps = () => {
        setDepState(document.getElementById('magnetic-toggle'), 'magneticEnabled', !coulEl.checked);
    };
    coulEl.addEventListener('change', updateCoulDeps);
    updateCoulDeps();

    // ─── Visual toggles ───
    document.getElementById('trailsToggle').addEventListener('change', (e) => {
        sim.renderer.trails = e.target.checked;
    });
    document.getElementById('velocityToggle').addEventListener('change', (e) => {
        sim.renderer.showVelocity = e.target.checked;
    });
    document.getElementById('forceToggle').addEventListener('change', (e) => {
        sim.renderer.showForce = e.target.checked;
    });
    document.getElementById('forceComponentsToggle').addEventListener('change', (e) => {
        sim.renderer.showForceComponents = e.target.checked;
    });
    document.getElementById('potentialToggle')?.addEventListener('change', (e) => {
        sim.heatmap.enabled = e.target.checked;
    });
    document.getElementById('accelScalingToggle')?.addEventListener('change', (e) => {
        sim.renderer.accelScaling = e.target.checked;
    });

    // ─── Slider value displays ───
    const massSlider = document.getElementById('massInput');
    const massLabel = document.getElementById('massValue');
    const chargeSlider = document.getElementById('chargeInput');
    const chargeLabel = document.getElementById('chargeValue');
    const spinSlider = document.getElementById('spinInput');
    const spinLabel = document.getElementById('spinValue');
    const frictionSlider = document.getElementById('frictionInput');
    const frictionLabel = document.getElementById('frictionValue');

    massSlider.addEventListener('input', () => { massLabel.textContent = massSlider.value; });
    chargeSlider.addEventListener('input', () => { chargeLabel.textContent = chargeSlider.value; });
    spinSlider.addEventListener('input', () => { spinLabel.textContent = parseFloat(spinSlider.value).toFixed(2) + 'c'; });
    frictionSlider.addEventListener('input', () => {
        sim.physics.bounceFriction = parseFloat(frictionSlider.value);
        frictionLabel.textContent = parseFloat(frictionSlider.value).toFixed(2);
    });

    sim.dom.speedInput.addEventListener('input', () => {
        const val = parseFloat(sim.dom.speedInput.value);
        sim.speedScale = val;
        document.getElementById('speedValue').textContent = val;
    });

    // ─── Step button ───
    document.getElementById('stepBtn').addEventListener('click', () => {
        if (!sim.running) {
            sim.physics.update(sim.particles, PHYSICS_DT, sim.collisionMode, sim.boundaryMode, sim.topology, sim.domainW, sim.domainH, 0, 0);
            sim.renderer.render(sim.particles, 0, sim.camera, sim.photons);
        }
    });

    // ─── Zoom controls ───
    sim.camera.bindZoomButtons({
        zoomIn: document.getElementById('zoom-in-btn'),
        zoomOut: document.getElementById('zoom-out-btn'),
        reset: document.getElementById('zoom-reset-btn'),
        display: document.getElementById('zoom-level'),
        onReset: () => sim.camera.reset(sim.width / 2, sim.height / 2, 1),
    });

    // ─── Theme toggle ───
    const toggleTheme = () => {
        const html = document.documentElement;
        html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
        sim.renderer.setTheme(html.dataset.theme !== 'dark');
    };
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // ─── Keyboard shortcuts ───
    const presetKeys = ['solar', 'binary', 'galaxy', 'collision', 'magnetic'];
    const togglePause = () => {
        sim.running = !sim.running;
        pauseIcon.hidden = !sim.running;
        playIcon.hidden = sim.running;
        pauseBtn.title = sim.running ? 'Pause' : 'Resume';
    };

    const stepSim = () => {
        if (!sim.running) {
            sim.physics.update(sim.particles, PHYSICS_DT, sim.collisionMode, sim.boundaryMode, sim.topology, sim.domainW, sim.domainH, 0, 0);
            sim.renderer.render(sim.particles, 0, sim.camera, sim.photons);
        }
    };

    const shortcuts = [
        { key: 'Space', label: 'Pause / Play', group: 'Simulation', action: togglePause },
        { key: 'R', label: 'Reset simulation', group: 'Simulation', action: () => document.getElementById('clearBtn').click() },
        { key: '.', label: 'Step forward', group: 'Simulation', action: stepSim },
        { key: 'P', label: 'Open presets', group: 'Simulation', action: () => presetDialog.classList.add('open') },
        { key: '1', label: 'Solar System', group: 'Presets', action: () => { loadPreset('solar', sim); closePresetDialog(); } },
        { key: '2', label: 'Binary Stars', group: 'Presets', action: () => { loadPreset('binary', sim); closePresetDialog(); } },
        { key: '3', label: 'Galaxy', group: 'Presets', action: () => { loadPreset('galaxy', sim); closePresetDialog(); } },
        { key: '4', label: 'Collision', group: 'Presets', action: () => { loadPreset('collision', sim); closePresetDialog(); } },
        { key: '5', label: 'Magnetic', group: 'Presets', action: () => { loadPreset('magnetic', sim); closePresetDialog(); } },
        { key: 'V', label: 'Toggle velocity vectors', group: 'View', action: () => {
            const el = document.getElementById('velocityToggle');
            el.checked = !el.checked;
            sim.renderer.showVelocity = el.checked;
        }},
        { key: 'F', label: 'Toggle force vectors', group: 'View', action: () => {
            const el = document.getElementById('forceToggle');
            el.checked = !el.checked;
            sim.renderer.showForce = el.checked;
        }},
        { key: 'C', label: 'Toggle force components', group: 'View', action: () => {
            const el = document.getElementById('forceComponentsToggle');
            el.checked = !el.checked;
            sim.renderer.showForceComponents = el.checked;
        }},
        { key: 'T', label: 'Toggle theme', group: 'View', action: toggleTheme },
        { key: 'S', label: 'Toggle sidebar', group: 'View', action: togglePanel },
        { key: 'Escape', label: 'Close dialogs', group: 'View', action: closePresetDialog },
    ];

    if (typeof initShortcuts === 'function') {
        initShortcuts(shortcuts, { helpTitle: 'Keyboard Shortcuts' });
    }

    // ─── Info tips ───
    const infoData = {
        energy: { title: 'Energy', body: '$E = \\text{KE} + \\text{Spin KE} + \\text{PE} + \\text{Field} + \\text{Radiated}$.<br>$\\text{KE} = \\sum(\\gamma - 1)m$, $\\text{Spin KE} = \\sum \\tfrac{I(\\sqrt{1+W^2 r^2}-1)}{r^2}$, $I = \\tfrac{2}{5}mr^2$.<br>Field = Darwin $O(v^2/c^2)$ EM + gravitational corrections. Drift = numerical error.' },
        conserved: { title: 'Conserved Quantities', body: 'Momentum: $|\\sum m_i \\mathbf{w}_i + \\mathbf{p}_{\\text{field}} + \\mathbf{p}_{\\text{rad}}|$ (vector sum).<br>Angular mom: $\\sum(\\mathbf{r}_i \\times m_i \\mathbf{w}_i) + \\sum I_i W_i$ about COM.<br>Exactly conserved with gravity + Coulomb only, pairwise mode. Velocity-dependent forces carry momentum in unmodeled fields.' },
        spin: { title: 'Spin', body: '$\\omega = W / \\sqrt{1 + W^2 r^2}$, caps surface velocity below $c$.<br>Determines $\\mu = q\\omega r^2/5$ (magnetic moment) and $L = 2m\\omega r^2/5$ (angular momentum). Positive = CCW.' },
        gravity: { title: 'Gravity', body: '$F = m_1 m_2 / r^2$ ($G = 1$). Attractive between all massive particles.' },
        coulomb: { title: 'Coulomb', body: '$F = q_1 q_2 / r^2$. Like charges repel, opposites attract.' },
        magnetic: { title: 'Magnetic', body: 'Dipole: $F = 3\\mu_1 \\mu_2 / r^4$, $\\mu = q\\omega r^2/5$. Aligned perpendicular dipoles repel.<br>Lorentz: $\\mathbf{F} = q(\\mathbf{v} \\times \\mathbf{B})$ via Boris rotation, $\\mathbf{B}$ from moving charges + spinning dipoles.' },
        gravitomag: { title: 'Gravitomagnetic', body: 'Dipole: $F = 3L_1 L_2 / r^4$, $L = 2m\\omega r^2/5$. Co-rotating masses attract (GEM sign flip).<br>Linear: $\\mathbf{F} = 4m(\\mathbf{v} \\times \\mathbf{B}_g)$ via Boris rotation. Frame-dragging torque aligns spins.' },
        relativity: { title: 'Relativity', body: 'State: proper velocity $\\mathbf{w} = \\gamma\\mathbf{v}$ (unbounded). Derived: $\\mathbf{v} = \\mathbf{w}/\\sqrt{1+w^2}$, enforcing $|v| < c$.<br>When off: $\\mathbf{v} = \\mathbf{w}$ (classical mechanics).' },
        radiation: { title: 'Radiation', body: 'Larmor power: $P = \\tfrac{2q^2 a^2}{3}$. Reaction force: $\\tfrac{\\tau \\cdot d\\mathbf{F}/dt}{\\gamma^3}$ (Landau\u2013Lifshitz), $\\tau = \\tfrac{2q^2}{3m}$.<br>Accelerating charges emit photons that carry energy and momentum. Creates orbital decay.' },
        tidal: { title: 'Disintegration', body: 'Roche limit: fragments when tidal + centrifugal + Coulomb stress exceeds self-gravity.<br>Tidal acceleration $= M \\cdot R / r^3$. Splits into 3 pieces.' },
        signaldelay: { title: 'Signal Delay', body: '$|\\mathbf{x}_{\\text{src}}(t_{\\text{ret}}) - \\mathbf{x}_{\\text{obs}}| = t_{\\text{now}} - t_{\\text{ret}}$ ($c = 1$).<br>Forces use source positions from the light cone, solved analytically per piecewise-linear history segment. Pairwise mode only.' },
        spinorbit: { title: 'Spin\u2013Orbit', body: '$dE = -\\mu \\cdot (\\mathbf{v} \\cdot \\nabla B) \\cdot dt$ (EM) or $-L \\cdot (\\mathbf{v} \\cdot \\nabla B_g) \\cdot dt$ (GM).<br>Transfers energy between translation and spin. Also applies Stern\u2013Gerlach ($\\mathbf{F} = \\mu\\nabla B$) and Mathisson\u2013Papapetrou ($\\mathbf{F} = -L\\nabla B_g$) center-of-mass kicks.' },
        interaction: { title: 'Spawn Modes', body: '<b>Place</b> \u2014 spawn at rest.<br><b>Shoot</b> \u2014 drag to set velocity.<br><b>Orbit</b> \u2014 circular orbit around nearest massive body ($v = \\sqrt{M/r}$).' },
        barneshut: { title: 'Barnes\u2013Hut', body: 'On: $O(N \\log N)$ quadtree approximation ($\\theta = 0.5$).<br>Off: $O(N^2)$ exact pairwise \u2014 slower but conserves momentum and angular momentum exactly.' },
        collision: { title: 'Collisions', body: '<b>Pass</b> \u2014 no interaction.<br><b>Bounce</b> \u2014 elastic + spin friction transfer.<br><b>Merge</b> \u2014 conserves mass, charge, momentum, angular momentum.' },
        boundary: { title: 'Boundaries', body: '<b>Despawn</b> \u2014 removed on leaving viewport.<br><b>Loop</b> \u2014 periodic wrapping (opens topology selector).<br><b>Bounce</b> \u2014 reflect off edges.' },
        topology: { title: 'Topology', body: '<b>Torus</b> \u2014 both axes wrap normally.<br><b>Klein bottle</b> \u2014 y-wrap mirrors x and reverses horizontal velocity.<br><b>RP\u00B2</b> \u2014 both axes wrap with perpendicular flip. Non-orientable.' },
        onepn: { title: '1PN Correction', body: 'Einstein\u2013Infeld\u2013Hoffmann $O(v^2/c^2)$ correction to gravity.<br>Produces perihelion precession $\\approx 6\\pi M / a(1-e^2)$ rad/orbit. Velocity\u2013Verlet for 2nd-order accuracy. Requires Gravity + Relativity.' },
    };

    if (typeof createInfoTip === 'function') {
        document.querySelectorAll('.info-trigger[data-info]').forEach(trigger => {
            const key = trigger.dataset.info;
            if (infoData[key]) {
                createInfoTip(trigger, infoData[key]);
            }
        });
    }
}
