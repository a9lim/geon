// ─── UI Setup ───
// Wires all panel controls, toggles, presets, shortcuts, and info tips to the sim.
import { loadPreset, PRESETS, PRESET_ORDER } from './presets.js';
import { WORLD_SCALE, DEFAULT_DOMAIN, COL_BOUNCE, BOUND_BOUNCE, BOUND_LOOP, SPEED_OPTIONS, colFromString, boundFromString, topoFromString } from './config.js';
import { REFERENCE } from './reference.js';
import { quickSave, quickLoad, downloadState, uploadState } from './save-load.js';

let antimatterMode = false;
export function getAntimatterMode() { return antimatterMode; }

// Push the settings store and modes to the GPU (a no-op until WebGPU is up).
function _syncGPU(sim) {
    if (sim.gpu) sim.gpu.applySettings(sim);
}

export function setupUI(sim) {
    const panel = document.getElementById('control-panel');
    const panelToggle = document.getElementById('panelToggle');

    // i18n helper bound to global runtime; falls back to passed default.
    const _T = (k, fb) => (window._i18n ? window._i18n.t(k, fb) : (fb != null ? fb : k));

    // ─── The margin: the controls column, opened by Controls and closed by its × ───
    // On a wide window it opens beside the scene, which shrinks to make room; on a narrow
    // one it rises over the scene as a sheet.
    const setMargin = (open) => {
        document.body.classList.toggle('margin-open', open);
        panelToggle.setAttribute('aria-expanded', String(open));
        _haptics.trigger('light');
    };
    const toggleMargin = () => setMargin(!document.body.classList.contains('margin-open'));
    panelToggle.addEventListener('click', toggleMargin);
    document.getElementById('panelClose').addEventListener('click', () => setMargin(false));
    panel.querySelector('.sheet-handle').addEventListener('click', () => setMargin(false));
    if (window.innerWidth > 900) setMargin(true);

    // ─── Antimatter mode (touch: a tap spawns antimatter while it is on) ───
    const modeBtn = document.getElementById('mode-btn');
    const _syncModeBtnLabels = () => {
        modeBtn.title = antimatterMode ? _T('topbar.modeAntimatterTitle') : _T('topbar.modeNormalTitle');
    };
    _syncModeBtnLabels();
    modeBtn.addEventListener('click', () => {
        antimatterMode = !antimatterMode;
        modeBtn.setAttribute('aria-pressed', String(antimatterMode));
        _syncModeBtnLabels();
    });

    // ─── Preset dropdown ───
    const presetSelect = document.getElementById('preset-select');
    presetSelect.addEventListener('change', () => {
        const key = presetSelect.value;
        if (key === 'none') {
            document.getElementById('clearBtn').click();
        } else if (key) {
            loadPreset(key, sim);
            sim._dirty = true;
            _haptics.trigger('medium');
        }
    });

    // ─── Clear ───
    document.getElementById('clearBtn').addEventListener('click', () => {
        sim.reset();
        sim.setDomain(DEFAULT_DOMAIN, DEFAULT_DOMAIN);
        sim.stats.resetBaseline();
        sim._dirty = true;
        showToast(_T('toast.cleared', 'Simulation cleared'));
        _haptics.trigger('warning');
    });

    // ─── Pause / Resume (the colophon's play button; mounted below with the theme) ───
    let colophon = null;
    const togglePause = () => {
        sim.running = !sim.running;
        _haptics.trigger(sim.running ? 'medium' : 'light');
        if (colophon) colophon.setPlaying(sim.running);
        sim.caption?.refresh();
        return sim.running;
    };

    // ─── Speed: a text button reading the multiple of real time ───
    const speedBtn = document.getElementById('speedBtn');
    const speedLabel = speedBtn.querySelector('.speed-label');
    const syncSpeed = () => {
        const x = sim.speedScale / 16;
        speedLabel.textContent = x + '×';
        speedBtn.title = _T('topbar.speedTitle', 'Speed') + ': ' + x + '× (, .)';
    };
    const cycleSpeed = () => {
        sim.speedIndex = (sim.speedIndex + 1) % SPEED_OPTIONS.length;
        sim.speedScale = SPEED_OPTIONS[sim.speedIndex];
        syncSpeed();
        _haptics.trigger('selection');
    };
    const decycleSpeed = () => {
        sim.speedIndex = (sim.speedIndex - 1 + SPEED_OPTIONS.length) % SPEED_OPTIONS.length;
        sim.speedScale = SPEED_OPTIONS[sim.speedIndex];
        syncSpeed();
        _haptics.trigger('selection');
    };
    speedBtn.addEventListener('click', cycleSpeed);
    speedBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); decycleSpeed(); });
    sim.syncSpeed = syncSpeed;
    syncSpeed();

    // ─── Mode toggles ───
    const collisionToggles = document.getElementById('collision-toggles');
    const boundaryToggles = document.getElementById('boundary-toggles');

    const _syncModesToGPU = () => {
        if (sim.gpu) sim.gpu.syncModes(sim);
    };
    _forms.bindModeGroup(collisionToggles, 'collision', (v) => {
        sim.collisionMode = colFromString(v);
        updateDeps();
        _syncModesToGPU();
    });
    _forms.bindModeGroup(boundaryToggles, 'boundary', (v) => {
        sim.boundaryMode = boundFromString(v);
        updateDeps();
        _syncModesToGPU();
    });
    _forms.bindModeGroup(document.getElementById('topology-toggles'), 'topology', (v) => {
        sim.topology = topoFromString(v);
        _syncModesToGPU();
    });



    // ─── Physics toggles ───
    const toggleDefs = [
        { id: 'gravity-toggle', prop: 'gravityEnabled' },
        { id: 'bosoninter-toggle', prop: 'bosonInterEnabled' },
        { id: 'coulomb-toggle', prop: 'coulombEnabled' },
        { id: 'magnetic-toggle', prop: 'magneticEnabled' },
        { id: 'gravitomag-toggle', prop: 'gravitomagEnabled' },
        { id: 'onepn-toggle', prop: 'onePNEnabled' },
        { id: 'relativity-toggle', prop: 'relativityEnabled' },
        { id: 'radiation-toggle', prop: 'radiationEnabled' },
        { id: 'disintegration-toggle', prop: 'disintegrationEnabled' },
        { id: 'spinorbit-toggle', prop: 'spinOrbitEnabled' },
        { id: 'barneshut-toggle', prop: 'barnesHutEnabled' },
        { id: 'yukawa-toggle', prop: 'yukawaEnabled' },
        { id: 'axion-toggle', prop: 'axionEnabled' },
        { id: 'blackhole-toggle', prop: 'blackHoleEnabled' },
        { id: 'expansion-toggle', prop: 'expansionEnabled' },
        { id: 'higgs-toggle', prop: 'higgsEnabled' },
    ];

    // Cache elements and prop lookup
    const tEl = {};
    const propById = {};
    toggleDefs.forEach(({ id, prop }) => {
        tEl[id] = document.getElementById(id);
        propById[id] = prop;
    });

    // ─── Declarative dependency graph ───
    // Evaluated in order: parents before children so cascading disables propagate.
    // enable deps: disabled when fn returns false; checked toggles auto-uncheck.
    // show deps: hidden when fn returns false; animated reveal/collapse.
    const updateDeps = _forms.bindDeps([
        // Enable/disable cascade
        { target: tEl['gravitomag-toggle'], enable: () => tEl['gravity-toggle'].checked },
        { target: tEl['bosoninter-toggle'], enable: () => tEl['barneshut-toggle'].checked && (tEl['gravity-toggle'].checked || tEl['coulomb-toggle'].checked) },
        { target: tEl['magnetic-toggle'], enable: () => tEl['coulomb-toggle'].checked },
        { target: tEl['radiation-toggle'], enable: () => tEl['gravity-toggle'].checked || tEl['coulomb-toggle'].checked || tEl['yukawa-toggle'].checked },
        { target: tEl['disintegration-toggle'], enable: () => tEl['gravity-toggle'].checked },
        { target: tEl['axion-toggle'], enable: () => tEl['coulomb-toggle'].checked || tEl['yukawa-toggle'].checked || tEl['blackhole-toggle'].checked },
        { target: tEl['blackhole-toggle'], enable: () => tEl['relativity-toggle'].checked && tEl['gravity-toggle'].checked },
        // Children of toggles that may have been disabled above
        { target: tEl['onepn-toggle'], enable: () => tEl['relativity-toggle'].checked && (tEl['magnetic-toggle'].checked || tEl['gravitomag-toggle'].checked || tEl['yukawa-toggle'].checked) },
        { target: tEl['spinorbit-toggle'], enable: () => tEl['magnetic-toggle'].checked || tEl['gravitomag-toggle'].checked },
        // Slider group visibility
        { target: 'yukawa-sliders', show: () => tEl['yukawa-toggle'].checked },
        { target: 'axion-sliders', show: () => tEl['axion-toggle'].checked },
        { target: 'hubble-group', show: () => tEl['expansion-toggle'].checked },
        { target: 'cosmo-schedule-group', show: () => tEl['expansion-toggle'].checked },
        { target: 'comoving-group', show: () => tEl['expansion-toggle'].checked },
        { target: 'field-damping-group', show: () => tEl['axion-toggle'].checked || tEl['higgs-toggle'].checked },
        { target: 'higgs-sliders', show: () => tEl['higgs-toggle'].checked },
        // Mode-dependent visibility
        { target: 'friction-group', show: () => sim.collisionMode === COL_BOUNCE || sim.boundaryMode === BOUND_BOUNCE },
        { target: 'topology-group', show: () => sim.boundaryMode === BOUND_LOOP },
    ], {
        onDisable: (el) => { sim.settings[propById[el.id]] = false; }
    });

    const updateAllDeps = () => {
        updateDeps();

        // Black hole or disintegration locks collision to merge
        const bhOn = tEl['blackhole-toggle'].checked;
        const disintOn = tEl['disintegration-toggle'].checked;
        if (bhOn || disintOn) {
            collisionToggles.querySelector('[data-collision="merge"]').click();
            collisionToggles.classList.add('ctrl-disabled');
        } else {
            collisionToggles.classList.remove('ctrl-disabled');
        }
        // Expansion locks the boundary to loop (decision 3) and the topology to the torus: the
        // universe is the periodic domain, and only the torus is homogeneous, so only there does
        // the mean density's minimum-image pull cancel (Klein and RP² leave a net force)
        const topologyToggles = document.getElementById('topology-toggles');
        if (tEl['expansion-toggle'].checked) {
            boundaryToggles.querySelector('[data-boundary="loop"]').click();
            boundaryToggles.classList.add('ctrl-disabled');
            topologyToggles.querySelector('[data-topology="torus"]').click();
            topologyToggles.classList.add('ctrl-disabled');
        } else {
            boundaryToggles.classList.remove('ctrl-disabled');
            topologyToggles.classList.remove('ctrl-disabled');
        }

        _syncGPU(sim);
    };

    // Push slider-only changes to GPU (toggles call updateAllDeps which already syncs)
    const _syncSlidersToGPU = () => _syncGPU(sim);

    // Wire every toggle: sync physics prop + re-evaluate all deps
    toggleDefs.forEach(({ id, prop }) => {
        tEl[id].addEventListener('change', () => {
            sim.settings[prop] = tEl[id].checked;
            tEl[id].setAttribute('aria-checked', String(tEl[id].checked));
            updateAllDeps();
            sim._dirty = true;
            _haptics.trigger('light');
        });
    });

    updateAllDeps();

    // ─── Visual toggles ─── (bindToggle fires the 'light' haptic itself)
    _forms.bindToggle(document.getElementById('trailsToggle'), (v) => {
        sim.view.trails = v;
        sim._dirty = true;
    });
    _forms.bindToggle(document.getElementById('clocksToggle'), (v) => {
        sim.view.showClocks = v;
        sim._dirty = true;
    });
    _forms.bindToggle(document.getElementById('gridToggle'), (v) => {
        sim.view.grid = v;
        sim._dirty = true;
    });
    _forms.bindToggle(document.getElementById('velocityToggle'), (v) => {
        sim.view.showVelocity = v;
        sim._dirty = true;
    });
    _forms.bindToggle(document.getElementById('forceToggle'), (v) => {
        sim.view.showForce = v;
        sim._dirty = true;
    });
    _forms.bindToggle(document.getElementById('forceComponentsToggle'), (v) => {
        sim.view.showForceComponents = v;
        sim._dirty = true;
    });
    const potentialToggle = document.getElementById('potentialToggle');
    const potentialModeBar = document.getElementById('potential-mode-toggles');
    potentialToggle?.addEventListener('change', (e) => {
        sim.heatmap.enabled = e.target.checked;
        if (potentialModeBar) potentialModeBar.parentElement.style.display = e.target.checked ? '' : 'none';
        _syncGPU(sim);
        sim._dirty = true;
        _haptics.trigger('light');
    });
    potentialModeBar?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-potential]');
        if (!btn) return;
        potentialModeBar.querySelector('.active')?.classList.remove('active');
        btn.classList.add('active');
        sim.heatmap.mode = btn.dataset.potential;
        // Sync heatmap mode to GPU
        if (sim._gpuPhysics) {
            sim._gpuPhysics._heatmapMode = btn.dataset.potential;
        }
        sim._dirty = true;
        _haptics.trigger('light');
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

    const _fmt2 = v => v.toFixed(2);
    _forms.bindSlider(massSlider, massLabel, () => _haptics.trigger('selection'), _fmt2);
    _forms.bindSlider(chargeSlider, chargeLabel, () => _haptics.trigger('selection'), _fmt2);
    _forms.bindSlider(spinSlider, spinLabel, () => _haptics.trigger('selection'), v => v.toFixed(2) + 'c');
    _forms.bindSlider(frictionSlider, frictionLabel, v => {
        sim.settings.bounceFriction = v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, _fmt2);

    // ─── Physics parameter sliders ───
    const yukawaMuSlider = document.getElementById('yukawaMuInput');
    const yukawaMuLabel = document.getElementById('yukawaMuValue');
    _forms.bindSlider(yukawaMuSlider, yukawaMuLabel, v => {
        sim.settings.yukawaMu = v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, _fmt2);

    const axionMassSlider = document.getElementById('axionMassInput');
    const axionMassLabel = document.getElementById('axionMassValue');
    _forms.bindSlider(axionMassSlider, axionMassLabel, v => {
        sim.settings.axionMass = v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, _fmt2);

    // Logarithmic: the slider holds log₁₀ H, from 10⁻⁴ (effectively none) to 0.5
    const hubbleSlider = document.getElementById('hubbleInput');
    const hubbleLabel = document.getElementById('hubbleValue');
    _forms.bindSlider(hubbleSlider, hubbleLabel, v => {
        sim.settings.hubbleParam = 10 ** v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, v => (10 ** v).toPrecision(2));

    // The expansion history; the slider is H₀ for the imposed schedules, the vacuum H_Λ for
    // the Friedmann closure
    const scheduleSelect = document.getElementById('cosmo-schedule');
    const hubbleName = document.getElementById('hubbleLabel');
    const syncSchedule = () => {
        sim.settings.cosmoSchedule = parseInt(scheduleSelect.value, 10) || 0;
        const key = sim.settings.cosmoSchedule === 0 ? 'sim.hubbleVacuum' : 'sim.hubble';
        hubbleName.setAttribute('data-i18n', key);
        hubbleName.textContent = _T(key);
    };
    scheduleSelect.addEventListener('change', () => {
        syncSchedule();
        _syncSlidersToGPU();
        sim._dirty = true;
    });
    syncSchedule();
    _forms.bindToggle(document.getElementById('comovingToggle'), (v) => {
        sim.setComovingView(v);
    });
    // The fields' ether damping (Higgs 2m_H, axion g·m_a); Hubble friction applies regardless
    _forms.bindToggle(document.getElementById('fieldDampingToggle'), (v) => {
        sim.settings.fieldDamping = v ? 1 : 0;
        _syncSlidersToGPU();
    });

    const higgsMassSlider = document.getElementById('higgsMassInput');
    const higgsMassLabel = document.getElementById('higgsMassValue');
    if (higgsMassSlider) {
        _forms.bindSlider(higgsMassSlider, higgsMassLabel, v => {
            sim.settings.higgsMass = v;
            _syncSlidersToGPU();
            _haptics.trigger('selection');
        }, _fmt2);
    }

    // ─── External field sliders ───
    const _fmtDeg = deg => deg + '°';
    const _extSlider = (prop, slider, label, angleGroup, angleSlider, angleLabel, angleProp) => {
        _forms.bindSlider(slider, label, v => {
            sim.settings[prop] = v;
            if (angleGroup) angleGroup.style.display = v !== 0 ? '' : 'none';
            _syncSlidersToGPU();
            _haptics.trigger('selection');
        }, _fmt2);
        if (angleSlider) {
            _forms.bindSlider(angleSlider, angleLabel, deg => {
                sim.settings[angleProp] = deg * Math.PI / 180;
                _syncSlidersToGPU();
                _haptics.trigger('selection');
            }, _fmtDeg);
        }
    };
    _extSlider('extGravity',
        document.getElementById('extGravityInput'), document.getElementById('extGravityValue'),
        document.getElementById('extGravityAngleGroup'),
        document.getElementById('extGravityAngleInput'), document.getElementById('extGravityAngleValue'),
        'extGravityAngle');
    _extSlider('extElectric',
        document.getElementById('extElectricInput'), document.getElementById('extElectricValue'),
        document.getElementById('extElectricAngleGroup'),
        document.getElementById('extElectricAngleInput'), document.getElementById('extElectricAngleValue'),
        'extElectricAngle');
    _forms.bindSlider(document.getElementById('extBzInput'), document.getElementById('extBzValue'), v => {
        sim.settings.extBz = v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, _fmt2);

    // Speed is now controlled by the toolbar speed button (cycleSpeed/decycleSpeed above)

    // ─── Step button ───
    const stepSim = () => {
        if (!sim.running && sim.gpu) {
            sim.gpu.stepOnce(sim);
            sim._statsDirty = true;
            sim._dirty = true;
        }
    };

    // ─── Theme, and the colophon ───
    const syncRendererTheme = () => {
        const isLight = document.documentElement.dataset.theme !== 'dark';
        sim.overlay.setTheme(isLight);
        if (sim._gpuRenderer) sim._gpuRenderer.setTheme(isLight);
        sim._dirty = true;
    };
    let _aboutHandle = null;
    colophon = _colophon.mount({
        themeKey: 'geon-theme',
        onTheme: syncRendererTheme,
        playing: sim.running,
        onPlay: togglePause,
        onStep: stepSim,
        onHelp: () => _aboutHandle && _aboutHandle.show(),
        labels: () => ({
            play: _T('topbar.play'), pause: _T('topbar.pause'), step: _T('topbar.step'),
            theme: _T('topbar.theme'), help: _T('topbar.about'),
        }),
    });
    syncRendererTheme();
    const toggleTheme = () => document.getElementById('themeToggleBtn').click();

    // ─── The view: plane or spacetime (src/spacetime.js) ───
    const viewPlane = document.getElementById('view-plane');
    const viewSpacetime = document.getElementById('view-spacetime');
    const syncView = (tilted) => {
        viewPlane.setAttribute('aria-pressed', String(!tilted));
        viewSpacetime.setAttribute('aria-pressed', String(tilted));
        sim.caption?.refresh();
    };
    sim.spacetime.onChange = syncView;
    const toPlane = () => { sim.spacetime.toPlane(); syncView(false); };
    const toSpacetime = () => { sim.spacetime.toSpacetime(); syncView(true); };
    viewPlane.addEventListener('click', toPlane);
    viewSpacetime.addEventListener('click', toSpacetime);
    const toggleView = () => (sim.spacetime.tilted ? toPlane() : toSpacetime());

    // ─── Coordinates and boost: the observer moving along x at v (frames.js) ───
    const boostInput = document.getElementById('boost-input');
    const boostOut = document.getElementById('boost-out');
    const coordsLab = document.getElementById('coords-lab');
    const coordsObserver = document.getElementById('coords-observer');
    const syncCoords = () => {
        const obs = sim.frames.active;
        coordsLab.setAttribute('aria-pressed', String(!obs));
        coordsObserver.setAttribute('aria-pressed', String(obs));
        sim.caption?.refresh();
    };
    const setBoost = (v) => {
        sim.frames.rapidity = Math.atanh(Math.min(Math.abs(v), 0.99));
        sim.frames.direction = v < 0 ? Math.PI : 0;
        boostOut.textContent = (v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + 'c';
        sim.boost = v;
        sim.framePanel?.update();
        sim._dirty = true;
        sim.caption?.refresh();
    };
    boostInput.addEventListener('input', () => setBoost(+boostInput.value));
    coordsLab.addEventListener('click', () => { sim.framePanel?.choose('lab'); syncCoords(); });
    coordsObserver.addEventListener('click', () => { sim.framePanel?.choose('boost'); syncCoords(); });
    sim.syncCoords = syncCoords;
    setBoost(+boostInput.value);

    // ─── Tab cycling helper ───

    // ─── Zoom helpers ───
    const canvas = sim.canvas || document.getElementById('simCanvas');
    const zoomIn  = () => sim.camera.zoomBy(1.25, canvas.width / 2, canvas.height / 2);
    const zoomOut = () => sim.camera.zoomBy(0.8,  canvas.width / 2, canvas.height / 2);
    const zoomReset = () => sim.fitCamera();

    // ─── Keyboard shortcuts ───
    // Built as a function so labels/groups can be re-resolved through _i18n
    // each time the language changes (initShortcuts captures by value).
    const G_SIM   = () => _T('shortcut.group.simulation', 'Simulation');
    const G_VIEW  = () => _T('shortcut.group.view',       'View');
    const G_SL    = () => _T('shortcut.group.saveload',   'Save / load');
    const G_PRES  = () => _T('preset.group.gravity',      'Presets'); // not perfect; see note below
    // Note: presets shown in shortcut help reuse the preset-name strings
    // directly. The "Presets" header is intentionally rendered as the gravity
    // group label so that it shows "重力" in JA — close enough for v1, since
    // the shortcut help groups by preset category.
    const _buildShortcuts = () => [
        { key: 'Space', label: _T('shortcut.pausePlay',     'Pause / play'),     group: G_SIM(), action: togglePause },
        { key: 'R',     label: _T('shortcut.resetSim',      'Reset simulation'), group: G_SIM(), action: () => document.getElementById('clearBtn').click() },
        { key: '.',     label: _T('shortcut.speedUp',       'Speed up'),         group: G_SIM(), action: cycleSpeed },
        { key: ',',     label: _T('shortcut.slowDown',      'Slow down'),        group: G_SIM(), action: decycleSpeed },
        { key: '/',     label: _T('shortcut.stepForward',   'Step forward'),     group: G_SIM(), action: stepSim },
        ...PRESET_ORDER.slice(0, 9).map((key, i) => ({
            key: String(i + 1),
            label: _T('preset.' + key + '.name', PRESETS[key].name),
            group: G_PRES(),
            // Through the dropdown's own change handler, so its label redraws too
            action: () => { presetSelect.value = key; presetSelect.dispatchEvent(new Event('change')); },
        })),
        { key: 'V',          label: _T('shortcut.toggleVel',         'Toggle velocity vectors'),       group: G_VIEW(), action: () => {
            const el = document.getElementById('velocityToggle');
            el.checked = !el.checked;
            sim.view.showVelocity = el.checked;
            sim._dirty = true;
        }},
        { key: 'F',          label: _T('shortcut.toggleAccel',       'Toggle acceleration vectors'),   group: G_VIEW(), action: () => {
            const el = document.getElementById('forceToggle');
            el.checked = !el.checked;
            sim.view.showForce = el.checked;
            sim._dirty = true;
        }},
        { key: 'C',          label: _T('shortcut.toggleAccelComp',   'Toggle acceleration components'), group: G_VIEW(), action: () => {
            const el = document.getElementById('forceComponentsToggle');
            el.checked = !el.checked;
            sim.view.showForceComponents = el.checked;
            sim._dirty = true;
        }},
        { key: 'K',          label: _T('shortcut.toggleClocks',      'Toggle clocks'),                 group: G_VIEW(), action: () => {
            const el = document.getElementById('clocksToggle');
            el.checked = !el.checked;
            sim.view.showClocks = el.checked;
            sim._dirty = true;
        }},
        { key: 'G',          label: _T('shortcut.toggleGrid',        'Toggle grid'),                   group: G_VIEW(), action: () => {
            const el = document.getElementById('gridToggle');
            el.checked = !el.checked;
            sim.view.grid = el.checked;
            sim._dirty = true;
        }},
        { key: 'B',          label: _T('shortcut.cycleFrame',        'Next frame'),                    group: G_VIEW(), action: () => sim.framePanel?.cycle() },
        { key: 'L',          label: _T('shortcut.labFrame',          'Back to the lab frame'),         group: G_VIEW(), action: () => sim.framePanel?.choose('lab') },
        { key: 'T',          label: _T('shortcut.toggleTheme',       'Toggle theme'),                  group: G_VIEW(), action: toggleTheme },
        { key: 'W',          label: _T('shortcut.toggleSpacetime',   'Plane or spacetime'),            group: G_VIEW(), action: toggleView },
        { key: 'O',          label: _T('shortcut.toggleCoords',      'Lab or observer coordinates'),   group: G_VIEW(), action: () => (sim.frames.active ? coordsLab : coordsObserver).click() },
        { key: 'S',          label: _T('shortcut.toggleSidebar',     'Toggle sidebar'),                group: G_VIEW(), action: toggleMargin },
        { key: 'Escape',     label: _T('shortcut.closePanel',        'Close panel'),                   group: G_VIEW(), action: () => setMargin(false) },
        { key: '[',          label: _T('shortcut.prevTab',           'Previous tab'),                  group: G_VIEW(), action: () => cycleTab(-1) },
        { key: ']',          label: _T('shortcut.nextTab',           'Next tab'),                      group: G_VIEW(), action: () => cycleTab(1) },
        { key: '=',          label: _T('shortcut.zoomIn',            'Zoom in'),                       group: G_VIEW(), action: zoomIn },
        { key: '-',          label: _T('shortcut.zoomOut',           'Zoom out'),                      group: G_VIEW(), action: zoomOut },
        { key: '0',          label: _T('shortcut.zoomReset',         'Reset zoom'),                    group: G_VIEW(), action: zoomReset },
        { key: 'X',          label: _T('shortcut.toggleAntimatter',  'Toggle antimatter mode'),        group: G_SIM(),  action: () => document.getElementById('mode-btn').click() },
        { key: 'Ctrl+S',     label: _T('shortcut.quickSave',         'Quick save'),                    group: G_SL(),   action: () => quickSave(sim) },
        { key: 'Ctrl+L',     label: _T('shortcut.quickLoad',         'Quick load'),                    group: G_SL(),   action: () => { quickLoad(sim); sim._dirty = true; } },
        { key: 'Ctrl+Shift+S', label: _T('shortcut.downloadState',   'Download state'),                group: G_SL(),   action: () => downloadState(sim) },
        { key: 'Ctrl+Shift+L', label: _T('shortcut.uploadState',     'Upload state'),                  group: G_SL(),   action: () => { uploadState(sim); sim._dirty = true; } },
    ];
    let shortcuts = _buildShortcuts();

    let _shortcutHandle = null;
    if (typeof initShortcuts === 'function') {
        _shortcutHandle = initShortcuts(shortcuts, { helpTitle: _T('shortcut.help.title', 'Keyboard shortcuts') });
    }

    // ─── About panel ───
    const _buildAboutConfig = () => ({
        title: _T('about.title', 'Worldline'),
        lastUpdated: '2026-10-23',
        description: _T('about.description'),
        controls: [
            { label: _T('about.controls.addParticle'),        value: _T('about.controls.addParticleVal') },
            { label: _T('about.controls.fling'),              value: _T('about.controls.flingVal') },
            { label: _T('about.controls.spawnAntimatter'),    value: _T('about.controls.spawnAntimatterVal') },
            { label: _T('about.controls.pan'),                value: _T('about.controls.panVal') },
            { label: _T('about.controls.zoom'),               value: _T('about.controls.zoomVal') },
            { label: _T('about.controls.select'),             value: _T('about.controls.selectVal') },
        ],
        shortcuts: shortcuts,
        repo: 'https://github.com/a9lim/worldline',
    });
    if (typeof initAboutPanel === 'function') {
        _aboutHandle = initAboutPanel(_buildAboutConfig());
    }

    // ─── Info tips ───


    const INFO_KEYS = [
        'energy', 'conserved', 'spin', 'gravity', 'coulomb', 'magnetic',
        'gravitomag', 'relativity', 'radiation', 'disintegration', 'spinorbit',
        'barneshut', 'collision', 'boundary', 'topology', 'charge', 'blackhole',
        'onepn', 'yukawa', 'axion', 'expansion', 'higgs', 'external', 'pion',
        'fieldExcitation', 'bosoninter', 'frames', 'lensing',
    ];
    const _buildInfoData = () => {
        const data = {};
        for (const k of INFO_KEYS) {
            data[k] = {
                title: _T('info.' + k + '.title'),
                body:  _T('info.' + k + '.body'),
            };
        }
        return data;
    };

    // We bypass registerInfoTips and call createInfoTip directly so we can
    // track per-trigger cleanup functions and rebuild popovers on lang change
    // without piling up duplicate event listeners.
    let _infoCleanups = [];
    const _registerInfoTipsLocal = () => {
        for (const c of _infoCleanups) { try { c(); } catch (e) { /* ignore */ } }
        _infoCleanups = [];
        const data = _buildInfoData();
        const triggers = document.querySelectorAll('.info-trigger[data-info]');
        for (let i = 0; i < triggers.length; i++) {
            const k = triggers[i].dataset.info;
            if (!data[k]) continue;
            const cleanup = createInfoTip(triggers[i], data[k]);
            if (typeof cleanup === 'function') _infoCleanups.push(cleanup);
        }
    };
    _registerInfoTipsLocal();

    // ─── Reference overlay (Shift+click / long-press on info buttons) ───
    const openReference = initReferenceOverlay(
        document.getElementById('reference-overlay'),
        document.getElementById('reference-title'),
        document.getElementById('reference-body'),
        document.getElementById('reference-close'),
        REFERENCE
    );
    bindReferenceTriggers(openReference);

    // ─── Language change handler ───
    // Re-translate dynamic content not covered by data-i18n attributes.
    if (window._i18n) {
        window._i18n.onChange(() => {
            _registerInfoTipsLocal();
            if (typeof openReference.clearCache === 'function') openReference.clearCache();
            // Rebuild shortcuts (labels reread through _T on rebuild) and
            // re-register the keydown handler so the keyMap is fresh too.
            shortcuts = _buildShortcuts();
            if (_shortcutHandle && typeof _shortcutHandle.destroy === 'function' && typeof initShortcuts === 'function') {
                _shortcutHandle.destroy();
                _shortcutHandle = initShortcuts(shortcuts, { helpTitle: _T('shortcut.help.title', 'Keyboard shortcuts') });
            }
            colophon.relabel();
            syncSpeed();
            _syncModeBtnLabels();
            // About panel: destroy + recreate. _buildAboutConfig closes over
            // `shortcuts` (let-binding), so the new array is picked up here.
            if (_aboutHandle && typeof _aboutHandle.destroy === 'function' && typeof initAboutPanel === 'function') {
                _aboutHandle.destroy();
                _aboutHandle = initAboutPanel(_buildAboutConfig());
            }
        });
    }
}
