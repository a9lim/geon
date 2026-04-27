// ─── UI Setup ───
// Wires all panel controls, toggles, presets, shortcuts, and info tips to the sim.
import { loadPreset, PRESETS, PRESET_ORDER } from './presets.js';
import { PHYSICS_DT, WORLD_SCALE, SCALAR_GRID, GPU_SCALAR_GRID, COL_MERGE, COL_BOUNCE, BOUND_DESPAWN, BOUND_BOUNCE, BOUND_LOOP, SPEED_OPTIONS, colFromString, boundFromString, topoFromString } from './config.js';
import { REFERENCE } from './reference.js';
import { BACKEND_CPU, BACKEND_GPU } from './backend-interface.js';
import Particle from './particle.js';
import { quickSave, quickLoad, downloadState, uploadState } from './save-load.js';

const HINT_FADE_DELAY = 5000;

let antimatterMode = false;
export function getAntimatterMode() { return antimatterMode; }

// C3: Persistent GPU toggle proxy — avoids Object.create() allocation on every slider drag.
// Object.assign copies all own enumerable properties from sim.physics, then we add extras.
const _gpuToggleProxy = {};
function _buildGPUToggles(sim) {
    Object.assign(_gpuToggleProxy, sim.physics);
    _gpuToggleProxy.heatmapEnabled = sim.heatmap ? sim.heatmap.enabled : false;
    _gpuToggleProxy.heatmapMode    = sim.heatmap ? sim.heatmap.mode    : 'all';
    return _gpuToggleProxy;
}

export function setupUI(sim) {
    const panel = document.getElementById('control-panel');
    const panelToggle = document.getElementById('panelToggle');

    const hint = document.getElementById('hint-bar');
    if (hint) setTimeout(() => hint.classList.add('fade-out'), HINT_FADE_DELAY);

    // ─── Panel toggle ───
    _toolbar.initSidebar(panelToggle, panel, document.getElementById('panelClose'));

    // i18n helper bound to global runtime; falls back to passed default.
    const _T = (k, fb) => (window._i18n ? window._i18n.t(k, fb) : (fb != null ? fb : k));

    // ─── Antimatter mode toggle ───
    const modeBtn = document.getElementById('mode-btn');
    const _syncModeBtnLabels = () => {
        modeBtn.setAttribute('aria-label', antimatterMode ? _T('topbar.modeAntimatter') : _T('topbar.modeNormal'));
        modeBtn.title = antimatterMode ? _T('topbar.modeAntimatterTitle') : _T('topbar.modeNormalTitle');
    };
    _syncModeBtnLabels();
    modeBtn.addEventListener('click', () => {
        antimatterMode = !antimatterMode;
        modeBtn.setAttribute('aria-pressed', String(antimatterMode));
        _syncModeBtnLabels();
        const svg = modeBtn.querySelector('svg');
        let vl = svg.querySelector('.vert-line');
        if (antimatterMode && !vl) {
            vl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            vl.setAttribute('x1', '12'); vl.setAttribute('y1', '8');
            vl.setAttribute('x2', '12'); vl.setAttribute('y2', '16');
            vl.setAttribute('stroke', 'currentColor'); vl.setAttribute('stroke-width', '2');
            vl.setAttribute('stroke-linecap', 'square');
            vl.classList.add('vert-line');
            svg.appendChild(vl);
        } else if (!antimatterMode && vl) {
            vl.remove();
        }
    });

    // ─── Mobile hint bar ───
    if (window.matchMedia('(pointer: coarse)').matches) {
        const hintEl = document.getElementById('hint-bar');
        const hintP = hintEl ? hintEl.querySelector('p') : null;
        if (hintP) {
            // Re-key the paragraph so applyDOM picks the mobile string up
            // on subsequent language switches as well.
            hintP.dataset.i18n = 'hint.mobile';
            hintP.textContent = _T('hint.mobile');
        } else if (hintEl) {
            hintEl.textContent = _T('hint.mobile');
        }
    }

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
        sim.camera.reset(sim.domainW / 2, sim.domainH / 2, WORLD_SCALE);
        sim.stats.resetBaseline();
        sim._dirty = true;
        showToast(_T('toast.cleared', 'Simulation cleared'));
        _haptics.trigger('warning');
    });

    // ─── Pause / Resume ───
    const playBtn = document.getElementById('playBtn');

    const togglePause = () => {
        sim.running = !sim.running;
        _haptics.trigger(sim.running ? 'medium' : 'light');
        _toolbar.updatePlayBtn(playBtn, sim.running);
    };
    playBtn.addEventListener('click', togglePause);
    _toolbar.updatePlayBtn(playBtn, sim.running);

    // ─── Speed Button ───
    const speedBtn = document.getElementById('speedBtn');

    const cycleSpeed = () => {
        sim.speedIndex = (sim.speedIndex + 1) % SPEED_OPTIONS.length;
        sim.speedScale = SPEED_OPTIONS[sim.speedIndex];
        _toolbar.updateSpeedBtn(speedBtn, sim.speedScale / 16);
        _haptics.trigger('selection');
    };
    const decycleSpeed = () => {
        sim.speedIndex = (sim.speedIndex - 1 + SPEED_OPTIONS.length) % SPEED_OPTIONS.length;
        sim.speedScale = SPEED_OPTIONS[sim.speedIndex];
        _toolbar.updateSpeedBtn(speedBtn, sim.speedScale / 16);
        _haptics.trigger('selection');
    };
    speedBtn.addEventListener('click', cycleSpeed);
    speedBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); decycleSpeed(); });

    // ─── Mode toggles ───
    const collisionToggles = document.getElementById('collision-toggles');
    const boundaryToggles = document.getElementById('boundary-toggles');

    const _syncModesToGPU = () => {
        if (sim._gpuPhysics) {
            sim._gpuPhysics.boundaryMode = sim.boundaryMode;
            sim._gpuPhysics.topologyMode = sim.topology;
            sim._gpuPhysics._collisionMode = sim.collisionMode;
        }
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


    // ─── Settings dropdown (GPU, Barnes-Hut, visual overlays) ───
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        _settings.create(settingsBtn, [
            { type: 'toggle', label: 'GPU Acceleration', id: 'gpu-toggle', checked: false, disabled: true },
            { type: 'toggle', label: 'Barnes-Hut', id: 'barneshut-toggle', checked: false },
            { type: 'toggle', label: 'Trails', id: 'trailsToggle', checked: true },
            { type: 'toggle', label: 'Velocity Vectors', id: 'velocityToggle', checked: false },
            { type: 'toggle', label: 'Accel. Vectors', id: 'forceToggle', checked: false },
            { type: 'toggle', label: 'Accel. Components', id: 'forceComponentsToggle', checked: false },
            { type: 'toggle', label: 'Potential Field', id: 'potentialToggle', checked: false },
            { type: 'mode', label: 'Potential Mode', id: 'potential-mode-toggles', dataAttr: 'potential',
              buttons: [
                  { value: 'all', label: 'All', active: true },
                  { value: 'gravity', label: 'Grav' },
                  { value: 'electric', label: 'Elec' },
                  { value: 'yukawa', label: 'Yukawa' }
              ]
            }
        ], { width: 280 });
        // Hide potential mode bar until potential field is enabled
        document.getElementById('potential-mode-toggles').closest('.settings-dd-row').style.display = 'none';
    }

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
        { target: 'higgs-sliders', show: () => tEl['higgs-toggle'].checked },
        // Mode-dependent visibility
        { target: 'friction-group', show: () => sim.collisionMode === COL_BOUNCE || sim.boundaryMode === BOUND_BOUNCE },
        { target: 'topology-group', show: () => sim.boundaryMode === BOUND_LOOP && !tEl['expansion-toggle'].checked },
    ], {
        onDisable: (el) => { sim.physics[propById[el.id]] = false; }
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
        // Expansion locks boundary to despawn
        if (tEl['expansion-toggle'].checked) {
            boundaryToggles.querySelector('[data-boundary="despawn"]').click();
            boundaryToggles.classList.add('ctrl-disabled');
        } else {
            boundaryToggles.classList.remove('ctrl-disabled');
        }

        // Sync toggle state to GPU backend
        if (sim._gpuPhysics && sim._gpuPhysics.setToggles) {
            sim._gpuPhysics.setToggles(_buildGPUToggles(sim));
            _syncModesToGPU();
        }
    };

    // Push slider-only changes to GPU (toggles call updateAllDeps which already syncs)
    const _syncSlidersToGPU = () => {
        if (sim._gpuPhysics && sim._gpuPhysics.setToggles) {
            // C3: Use persistent proxy object instead of Object.create per call
            sim._gpuPhysics.setToggles(_buildGPUToggles(sim));
            _syncModesToGPU();
        }
    };

    // Wire every toggle: sync physics prop + re-evaluate all deps
    toggleDefs.forEach(({ id, prop }) => {
        tEl[id].addEventListener('change', () => {
            sim.physics[prop] = tEl[id].checked;
            tEl[id].setAttribute('aria-checked', String(tEl[id].checked));
            // A11: Lazy field initialization on first toggle-on
            if (id === 'higgs-toggle' && tEl[id].checked) sim.ensureHiggsField();
            if (id === 'axion-toggle' && tEl[id].checked) sim.ensureAxionField();
            // Higgs: restore masses when toggled off
            if (id === 'higgs-toggle' && !tEl[id].checked) {
                for (const p of sim.particles) { p.mass = p.baseMass; p.updateColor(); }
            }
            // Axion: reset axMod/yukMod to 1 and clear field when toggled off
            if (id === 'axion-toggle' && !tEl[id].checked) {
                for (const p of sim.particles) { p.axMod = 1; p.yukMod = 1; }
                if (sim.axionField) sim.axionField.reset();
            }
            // BH toggle: Kerr-Newman radii; no hair — strip antimatter
            if (id === 'blackhole-toggle') {
                if (tEl[id].checked) {
                    for (const p of sim.particles) { p.antimatter = false; p.updateColor(); }
                } else {
                    for (const p of sim.particles) p.updateColor();
                }
            }
            updateAllDeps();
            sim._dirty = true;
            _haptics.trigger('light');
        });
    });

    updateAllDeps();

    // ─── GPU backend toggle ───
    const gpuToggle = document.getElementById('gpu-toggle');
    // Enable the toggle once GPU is ready (async init in main.js)
    sim._onGPUReady = () => {
        gpuToggle.disabled = false;
        gpuToggle.checked = true;
        gpuToggle.setAttribute('aria-checked', 'true');
        const row = gpuToggle.closest('.settings-dd-row') || gpuToggle.closest('.checkbox-label');
        if (row) row.classList.remove('ctrl-disabled');
    };
    sim._onGPULost = () => {
        gpuToggle.disabled = true;
        gpuToggle.checked = false;
        gpuToggle.setAttribute('aria-checked', 'false');
        const row = gpuToggle.closest('.settings-dd-row') || gpuToggle.closest('.checkbox-label');
        if (row) row.classList.add('ctrl-disabled');
    };
    gpuToggle.addEventListener('change', async () => {
        const on = gpuToggle.checked;
        gpuToggle.setAttribute('aria-checked', String(on));
        const gpuCanvas = document.getElementById('gpuCanvas');
        if (on && sim._gpuReady) {
            sim.backend = BACKEND_GPU;
            if (gpuCanvas) gpuCanvas.style.display = '';
            // Clear stale CPU canvas underneath
            sim.ctx.clearRect(0, 0, sim.width, sim.height);
            // Sync current state to GPU (C3: persistent proxy, no Object.create)
            sim._gpuPhysics.setToggles(_buildGPUToggles(sim));
            _syncModesToGPU();
            // Re-sync all particles to GPU
            sim._gpuPhysics.reset();
            for (const p of sim.particles) {
                p._gpuIdx = sim._gpuPhysics.addParticle({
                    x: p.pos.x, y: p.pos.y,
                    vx: p.w.x, vy: p.w.y,
                    mass: p.mass, charge: p.charge,
                    angw: p.angw, antimatter: p.antimatter,
                });
            }
        } else {
            // Read back current GPU particle state before switching to CPU
            if (sim._gpuReady && sim._gpuPhysics) {
                try {
                    const gpuState = await sim._gpuPhysics.serialize(sim);
                    // Rebuild CPU particle array from GPU readback
                    sim.particles.length = 0;
                    for (const pd of gpuState.particles) {
                        const p = new Particle(pd.x, pd.y, pd.mass, pd.charge);
                        p.baseMass = pd.baseMass;
                        p.antimatter = pd.antimatter;
                        p.w.set(pd.wx, pd.wy);
                        p.angw = pd.angw;
                        // Derive coordinate velocity from proper velocity
                        const wSq = pd.wx * pd.wx + pd.wy * pd.wy;
                        const gamma = Math.sqrt(1 + wSq);
                        p.vel.set(pd.wx / gamma, pd.wy / gamma);
                        p.angVel = sim.physics.relativityEnabled
                            ? pd.angw / Math.sqrt(1 + pd.angw * pd.angw * p.radius * p.radius)
                            : pd.angw;
                        p.creationTime = sim.physics.simTime;
                        p.updateColor();
                        sim.particles.push(p);
                    }
                    // Read back scalar field data (GPU 128×128 → CPU 64×64)
                    const fieldData = await sim._gpuPhysics.readbackFieldData();
                    const ratio = GPU_SCALAR_GRID / SCALAR_GRID; // 2
                    const cpuGrid = SCALAR_GRID;
                    const _downsample = (gpuArr) => {
                        const cpu = new Float64Array(cpuGrid * cpuGrid);
                        const invBlock = 1 / (ratio * ratio);
                        for (let cy = 0; cy < cpuGrid; cy++) {
                            for (let cx = 0; cx < cpuGrid; cx++) {
                                let sum = 0;
                                for (let dy = 0; dy < ratio; dy++) {
                                    for (let dx = 0; dx < ratio; dx++) {
                                        sum += gpuArr[(cy * ratio + dy) * GPU_SCALAR_GRID + (cx * ratio + dx)];
                                    }
                                }
                                cpu[cy * cpuGrid + cx] = sum * invBlock;
                            }
                        }
                        return cpu;
                    };
                    if (fieldData.higgsField && sim.physics.higgsEnabled) {
                        const hf = sim.ensureHiggsField();
                        hf.field.set(_downsample(fieldData.higgsField));
                        hf.fieldDot.set(_downsample(fieldData.higgsFieldDot));
                    }
                    if (fieldData.axionField && sim.physics.axionEnabled) {
                        const af = sim.ensureAxionField();
                        af.field.set(_downsample(fieldData.axionField));
                        af.fieldDot.set(_downsample(fieldData.axionFieldDot));
                    }

                    sim.clearBosons();
                    sim.stats.resetBaseline();
                } catch (e) {
                    console.warn('[physsim] GPU readback failed, CPU state may be stale:', e);
                }
            }
            sim.backend = BACKEND_CPU;
            if (gpuCanvas) gpuCanvas.style.display = 'none';
        }
        const gpuInd = document.getElementById('gpu-indicator');
        if (gpuInd) gpuInd.hidden = sim.backend !== BACKEND_GPU;
        sim._dirty = true;
        _haptics.trigger('light');
    });

    // ─── Visual toggles ───
    document.getElementById('trailsToggle').addEventListener('change', (e) => {
        sim.renderer.trails = e.target.checked;
        sim._dirty = true;
        _haptics.trigger('light');
    });
    document.getElementById('velocityToggle').addEventListener('change', (e) => {
        sim.renderer.showVelocity = e.target.checked;
        sim._dirty = true;
        _haptics.trigger('light');
    });
    document.getElementById('forceToggle').addEventListener('change', (e) => {
        sim.renderer.showForce = e.target.checked;
        sim._dirty = true;
        _haptics.trigger('light');
    });
    document.getElementById('forceComponentsToggle').addEventListener('change', (e) => {
        sim.renderer.showForceComponents = e.target.checked;
        sim._dirty = true;
        _haptics.trigger('light');
    });
    const potentialToggle = document.getElementById('potentialToggle');
    const potentialModeBar = document.getElementById('potential-mode-toggles');
    potentialToggle?.addEventListener('change', (e) => {
        sim.heatmap.enabled = e.target.checked;
        const modeRow = potentialModeBar?.closest('.settings-dd-row');
        if (modeRow) modeRow.style.display = e.target.checked ? '' : 'none';
        else if (potentialModeBar) potentialModeBar.style.display = e.target.checked ? '' : 'none';
        // Sync heatmap state to GPU (C3: persistent proxy, no Object.create)
        if (sim._gpuPhysics) {
            // heatmap.enabled already updated above; _buildGPUToggles reads it
            sim._gpuPhysics.setToggles(_buildGPUToggles(sim));
        }
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
        sim.physics.bounceFriction = v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, _fmt2);

    // ─── Physics parameter sliders ───
    const yukawaMuSlider = document.getElementById('yukawaMuInput');
    const yukawaMuLabel = document.getElementById('yukawaMuValue');
    _forms.bindSlider(yukawaMuSlider, yukawaMuLabel, v => {
        sim.physics.yukawaMu = v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, _fmt2);

    const axionMassSlider = document.getElementById('axionMassInput');
    const axionMassLabel = document.getElementById('axionMassValue');
    _forms.bindSlider(axionMassSlider, axionMassLabel, v => {
        sim.physics.axionMass = v;
        if (sim.axionField) sim.axionField.mass = v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, _fmt2);

    const hubbleSlider = document.getElementById('hubbleInput');
    const hubbleLabel = document.getElementById('hubbleValue');
    _forms.bindSlider(hubbleSlider, hubbleLabel, v => {
        sim.physics.hubbleParam = v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, v => v.toFixed(4));

    const higgsMassSlider = document.getElementById('higgsMassInput');
    const higgsMassLabel = document.getElementById('higgsMassValue');
    if (higgsMassSlider) {
        _forms.bindSlider(higgsMassSlider, higgsMassLabel, v => {
            sim.physics.higgsMass = v;
            if (sim.higgsField) sim.higgsField.mass = v;
            _syncSlidersToGPU();
            _haptics.trigger('selection');
        }, _fmt2);
    }

    // ─── External field sliders ───
    const _fmtDeg = deg => deg + '°';
    const _extSlider = (prop, slider, label, angleGroup, angleSlider, angleLabel, angleProp) => {
        _forms.bindSlider(slider, label, v => {
            sim.physics[prop] = v;
            if (angleGroup) angleGroup.style.display = v !== 0 ? '' : 'none';
            _syncSlidersToGPU();
            _haptics.trigger('selection');
        }, _fmt2);
        if (angleSlider) {
            _forms.bindSlider(angleSlider, angleLabel, deg => {
                sim.physics[angleProp] = deg * Math.PI / 180;
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
        sim.physics.extBz = v;
        _syncSlidersToGPU();
        _haptics.trigger('selection');
    }, _fmt2);

    // Speed is now controlled by the toolbar speed button (cycleSpeed/decycleSpeed above)

    // ─── Step button ───
    const stepSim = () => {
        if (!sim.running) {
            if (sim.backend === BACKEND_GPU && sim._gpuPhysics) {
                sim._gpuPhysics.update(PHYSICS_DT);
            } else {
                sim.physics.update(sim.particles, PHYSICS_DT, sim.collisionMode, sim.boundaryMode, sim.topology, sim.domainW, sim.domainH, 0, 0);
            }
            sim._dirty = true;
        }
    };
    document.getElementById('stepBtn').addEventListener('click', stepSim);

    // ─── Zoom controls ───
    sim.camera.bindZoomButtons({
        zoomIn: document.getElementById('zoom-in-btn'),
        zoomOut: document.getElementById('zoom-out-btn'),
        reset: document.getElementById('zoom-reset-btn'),
        display: document.getElementById('zoom-level'),
        onReset: () => sim.camera.reset(sim.domainW / 2, sim.domainH / 2, WORLD_SCALE),
        formatZoom: (z) => Math.round(z / WORLD_SCALE * 100) + '%',
    });

    // ─── Theme toggle ───
    const syncRendererTheme = () => {
        const isLight = document.documentElement.dataset.theme !== 'dark';
        sim.renderer.setTheme(isLight);
        if (sim._gpuRenderer) sim._gpuRenderer.setTheme(isLight);
        sim._dirty = true;
    };
    _toolbar.initTheme('geon-theme', syncRendererTheme);
    syncRendererTheme();
    const toggleTheme = () => {
        _toolbar.toggleTheme('geon-theme');
        syncRendererTheme();
    };
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // ─── Tab cycling helper ───

    // ─── Zoom helpers ───
    const canvas = sim.canvas || document.getElementById('simCanvas');
    const zoomIn  = () => sim.camera.zoomBy(1.25, canvas.width / 2, canvas.height / 2);
    const zoomOut = () => sim.camera.zoomBy(0.8,  canvas.width / 2, canvas.height / 2);
    const zoomReset = () => sim.camera.reset(sim.domainW / 2, sim.domainH / 2, WORLD_SCALE);

    // ─── Keyboard shortcuts ───
    // Built as a function so labels/groups can be re-resolved through _i18n
    // each time the language changes (initShortcuts captures by value).
    const G_SIM   = () => _T('shortcut.group.simulation', 'Simulation');
    const G_VIEW  = () => _T('shortcut.group.view',       'View');
    const G_SL    = () => _T('shortcut.group.saveload',   'Save / Load');
    const G_PRES  = () => _T('preset.group.gravity',      'Presets'); // not perfect; see note below
    // Note: presets shown in shortcut help reuse the preset-name strings
    // directly. The "Presets" header is intentionally rendered as the gravity
    // group label so that it shows "重力" in JA — close enough for v1, since
    // the shortcut help groups by preset category.
    const _buildShortcuts = () => [
        { key: 'Space', label: _T('shortcut.pausePlay',     'Pause / Play'),     group: G_SIM(), action: togglePause },
        { key: 'R',     label: _T('shortcut.resetSim',      'Reset simulation'), group: G_SIM(), action: () => document.getElementById('clearBtn').click() },
        { key: '.',     label: _T('shortcut.speedUp',       'Speed up'),         group: G_SIM(), action: cycleSpeed },
        { key: ',',     label: _T('shortcut.slowDown',      'Slow down'),        group: G_SIM(), action: decycleSpeed },
        { key: '/',     label: _T('shortcut.stepForward',   'Step forward'),     group: G_SIM(), action: stepSim },
        ...PRESET_ORDER.slice(0, 9).map((key, i) => ({
            key: String(i + 1),
            label: _T('preset.' + key + '.name', PRESETS[key].name),
            group: G_PRES(),
            action: () => { loadPreset(key, sim); document.getElementById('preset-select').value = key; sim._dirty = true; },
        })),
        { key: 'V',          label: _T('shortcut.toggleVel',         'Toggle velocity vectors'),       group: G_VIEW(), action: () => {
            const el = document.getElementById('velocityToggle');
            el.checked = !el.checked;
            sim.renderer.showVelocity = el.checked;
            sim._dirty = true;
        }},
        { key: 'F',          label: _T('shortcut.toggleAccel',       'Toggle acceleration vectors'),   group: G_VIEW(), action: () => {
            const el = document.getElementById('forceToggle');
            el.checked = !el.checked;
            sim.renderer.showForce = el.checked;
            sim._dirty = true;
        }},
        { key: 'C',          label: _T('shortcut.toggleAccelComp',   'Toggle acceleration components'), group: G_VIEW(), action: () => {
            const el = document.getElementById('forceComponentsToggle');
            el.checked = !el.checked;
            sim.renderer.showForceComponents = el.checked;
            sim._dirty = true;
        }},
        { key: 'T',          label: _T('shortcut.toggleTheme',       'Toggle theme'),                  group: G_VIEW(), action: toggleTheme },
        { key: 'S',          label: _T('shortcut.toggleSidebar',     'Toggle sidebar'),                group: G_VIEW(), action: () => _toolbar.toggleSidebar() },
        { key: 'Escape',     label: _T('shortcut.closePanel',        'Close panel'),                   group: G_VIEW(), action: () => _toolbar.closeSidebar() },
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
        _shortcutHandle = initShortcuts(shortcuts, { helpTitle: _T('shortcut.help.title', 'Keyboard Shortcuts') });
    }

    // ─── About panel ───
    let _aboutHandle = null;
    const _buildAboutConfig = () => ({
        title: _T('about.title', 'Geon'),
        lastUpdated: '2026-04-27',
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
        repo: 'https://github.com/a9lim/geon',
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
        'fieldExcitation', 'bosoninter',
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
                _shortcutHandle = initShortcuts(shortcuts, { helpTitle: _T('shortcut.help.title', 'Keyboard Shortcuts') });
            }
            // About panel: destroy + recreate. _buildAboutConfig closes over
            // `shortcuts` (let-binding), so the new array is picked up here.
            if (_aboutHandle && typeof _aboutHandle.destroy === 'function' && typeof initAboutPanel === 'function') {
                _aboutHandle.destroy();
                _aboutHandle = initAboutPanel(_buildAboutConfig());
            }
        });
    }
}
