import Physics from './src/integrator.js';
import Renderer from './src/renderer.js';
import InputHandler from './src/input.js';
import Particle from './src/particle.js';
import Heatmap from './src/heatmap.js';
import HiggsField from './src/higgs-field.js';
import AxionField from './src/axion-field.js';
import PhasePlot from './src/phase-plot.js';
import EffectivePotentialPlot from './src/effective-potential.js';
import StatsDisplay from './src/stats-display.js';
import { setupUI } from './src/ui.js';
import { init as initI18n, setLang as setI18nLang, getLang as getI18nLang, t as tI18n, onChange as onI18nChange } from './src/i18n.js';
import { TWO_PI, WORLD_SCALE, ZOOM_MIN, ZOOM_MAX, WHEEL_ZOOM_IN, DEFAULT_SPEED_SCALE, DEFAULT_SPEED_INDEX, SPAWN_MIN_ENERGY, PHYSICS_DT, MAX_SUBSTEPS, MAX_PHOTONS, MAX_FRAME_DT, ACCUMULATOR_CAP, COL_PASS, BOUND_DESPAWN, TORUS, STATS_THROTTLE_MASK, MAX_PARTICLES, BOSON_CHARGE, MAX_SPEED_RATIO, spawnOffset } from './src/config.js';
import MasslessBoson from './src/massless-boson.js';
import Pion from './src/pion.js';
import Lepton from './src/lepton.js';

import { setVelocity, angwToAngVel } from './src/relativity.js';
import { loadState, quickSave, quickLoad, downloadState, uploadState } from './src/save-load.js';

import { BACKEND_CPU, BACKEND_GPU } from './src/backend-interface.js';
import CPUPhysics from './src/cpu-physics.js';
import GPUBackend from './src/gpu/gpu-backend.js';

/**
 * Detect WebGPU support and return the best available backend.
 * @returns {Promise<{backend: string, device?: GPUDevice}>}
 */
async function selectBackend() {
    // Allow ?cpu=1 URL param to force CPU backend
    const params = new URLSearchParams(window.location.search);
    if (params.get('cpu') === '1') {
        console.log('[physsim] CPU backend forced via ?cpu=1');
        return { backend: BACKEND_CPU };
    }

    if (typeof navigator === 'undefined' || !navigator.gpu) {
        return { backend: BACKEND_CPU };
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { backend: BACKEND_CPU };

        const device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBufferBindingSize: 256 * 1024 * 1024,
                maxBufferSize: 256 * 1024 * 1024,
                maxComputeWorkgroupsPerDimension: 65535,
                maxStorageBuffersPerShaderStage: Math.min(
                    adapter.limits.maxStorageBuffersPerShaderStage, 10),
                maxBindingsPerBindGroup: adapter.limits.maxBindingsPerBindGroup,
            },
        });
        if (!device) return { backend: BACKEND_CPU };

        return { backend: BACKEND_GPU, device };
    } catch (e) {
        console.warn('WebGPU detection failed:', e);
        return { backend: BACKEND_CPU };
    }
}

/**
 * Attempt to re-acquire GPU device after a loss.
 * Does not auto-switch — just logs availability.
 */
async function _attemptGPURecovery() {
    await new Promise(r => setTimeout(r, 5000));
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return;
        const newDevice = await adapter.requestDevice();
        if (!newDevice) return;
        console.log('[physsim] WebGPU device recovered — GPU backend available again');
    } catch (e) {
        console.warn('[physsim] GPU recovery failed:', e);
    }
}

function updateBackendBadge(backend) {
    const ind = document.getElementById('gpu-indicator');
    if (ind) ind.hidden = backend !== 'gpu';
}

class Simulation {
    constructor() {
        this.canvas = document.getElementById('simCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        // Pre-allocate particle array to MAX_PARTICLES to avoid reallocation
        this.particles = [];
        this.particles.length = MAX_PARTICLES;
        this.particles.length = 0;
        this.deadParticles = [];
        this.physics = new Physics();
        this.renderer = new Renderer(this.ctx, this.width, this.height);
        this.domainW = this.width / WORLD_SCALE;
        this.domainH = this.height / WORLD_SCALE;
        this._domainDiagonal = 2 * Math.sqrt(this.domainW * this.domainW + this.domainH * this.domainH);
        this.renderer.domainW = this.domainW;
        this.renderer.domainH = this.domainH;
        this.renderer.setTheme(true);

        this.heatmap = new Heatmap();
        this.renderer.heatmap = this.heatmap;

        // A11: Lazy field initialization — defer grid allocations until first toggle-on
        this.higgsField = null;
        this.axionField = null;

        this.phasePlot = new PhasePlot();
        this.effPotPlot = new EffectivePotentialPlot();

        const sim = this;
        this.camera = createCamera({
            width: this.width, height: this.height,
            x: this.domainW / 2, y: this.domainH / 2,
            zoom: WORLD_SCALE,
            minZoom: ZOOM_MIN, maxZoom: ZOOM_MAX,
            wheelFactor: WHEEL_ZOOM_IN,
            onUpdate() { sim._dirty = true; },
            clamp(cam) {
                const halfW = cam.viewportW / (2 * cam.zoom);
                const halfH = cam.viewportH / (2 * cam.zoom);
                const dw = sim.domainW, dh = sim.domainH;
                if (halfW * 2 >= dw) cam.x = dw / 2;
                else cam.x = clamp(cam.x, halfW, dw - halfW);
                if (halfH * 2 >= dh) cam.y = dh / 2;
                else cam.y = clamp(cam.y, halfH, dh - halfH);
            },
        });

        this.input = new InputHandler(this.canvas, this);
        this.renderer.input = this.input;

        this.lastTime = 0;
        this.running = true;
        this.accumulator = 0;
        this._hidden = false;
        this._loopScheduled = false; // prevent duplicate rAF chains
        this._hmFrame = 0; // heatmap throttle counter
        this._sbFrame = 0;
        this._ttFrame = 0; // tooltip refresh throttle counter
        this._dirty = true; // render dirty flag — skip frames when nothing changed

        this.speedIndex = DEFAULT_SPEED_INDEX;
        this.dom = {
            linearKE: document.getElementById('linearKE'),
            spinKE: document.getElementById('spinKE'),
            massE: document.getElementById('massE'),
            potentialE: document.getElementById('potentialE'),
            totalE: document.getElementById('totalE'),
            energyDrift: document.getElementById('energyDrift'),
            fieldE: document.getElementById('fieldE'),
            radiatedE: document.getElementById('radiatedE'),
            momentum: document.getElementById('momentum'),
            particleMom: document.getElementById('particleMom'),
            fieldMom: document.getElementById('fieldMom'),
            radiatedMom: document.getElementById('radiatedMom'),
            momentumDrift: document.getElementById('momentumDrift'),
            angularMomentum: document.getElementById('angularMomentum'),
            orbitalAngMom: document.getElementById('orbitalAngMom'),
            spinAngMom: document.getElementById('spinAngMom'),
            angMomDrift: document.getElementById('angMomDrift'),
        };

        this.collisionMode = COL_PASS;
        this.boundaryMode = BOUND_DESPAWN;
        this.topology = TORUS;
        this.speedScale = DEFAULT_SPEED_SCALE;
        this.selectedParticle = null;
        this.photons = [];
        this.pions = [];
        this.leptons = [];
        this._MasslessBosonClass = MasslessBoson;  // expose for Pion.decay()
        this.totalRadiated = 0;
        this.totalRadiatedPx = 0;
        this.totalRadiatedPy = 0;
        this.physics.sim = this;

        // Backend detection (async, completes after first frame)
        this.backend = BACKEND_CPU;
        this._cpuPhysics = new CPUPhysics(this.physics);
        this._gpuReady = false;
        this._gpuBackend = null;

        // Selected particle DOM refs
        this.selDom = {
            details: document.getElementById('particle-details'),
            hint: document.getElementById('particle-hint'),
            phaseSection: document.getElementById('phase-plot-section'),
            effPotSection: document.getElementById('eff-pot-section'),
            mass: document.getElementById('sel-mass'),
            charge: document.getElementById('sel-charge'),
            spin: document.getElementById('sel-spin'),
            speed: document.getElementById('sel-speed'),
            gamma: document.getElementById('sel-gamma'),
            force: document.getElementById('sel-force'),
            fbGravity: document.getElementById('fb-gravity'),
            fbGravityVal: document.getElementById('fb-gravity-val'),
            fbCoulomb: document.getElementById('fb-coulomb'),
            fbCoulombVal: document.getElementById('fb-coulomb-val'),
            fbMagnetic: document.getElementById('fb-magnetic'),
            fbMagneticVal: document.getElementById('fb-magnetic-val'),
            fbGravitomag: document.getElementById('fb-gravitomag'),
            fbGravitomagVal: document.getElementById('fb-gravitomag-val'),
            fb1pn: document.getElementById('fb-1pn'),
            fb1pnVal: document.getElementById('fb-1pn-val'),
            fbSpincurv: document.getElementById('fb-spincurv'),
            fbSpincurvVal: document.getElementById('fb-spincurv-val'),
            fbRadiation: document.getElementById('fb-radiation'),
            fbRadiationVal: document.getElementById('fb-radiation-val'),
            fbYukawa: document.getElementById('fb-yukawa'),
            fbYukawaVal: document.getElementById('fb-yukawa-val'),
            fbExternal: document.getElementById('fb-external'),
            fbExternalVal: document.getElementById('fb-external-val'),
            fbHiggs: document.getElementById('fb-higgs'),
            fbHiggsVal: document.getElementById('fb-higgs-val'),
            fbAxion: document.getElementById('fb-axion'),
            fbAxionVal: document.getElementById('fb-axion-val'),
        };

        // Mount sidebar canvases
        document.getElementById('phase-plot-container').appendChild(this.phasePlot.canvas);
        document.getElementById('eff-pot-container').appendChild(this.effPotPlot.canvas);

        this.stats = new StatsDisplay(this.dom, this.selDom);

        // C2: Pre-allocate render options objects to avoid per-frame allocation
        this._enabledForces = {
            gravity: false, coulomb: false, magnetic: false, gravitomag: false,
            onePN: false, spinOrbit: false, radiation: false, yukawa: false,
            external: false, higgs: false, axion: false,
        };
        this._renderOpts = {
            blackHoleEnabled: false,
            enabledForces: this._enabledForces,
            higgsField: null,
            axionField: null,
            heatmapBuffers: null,
            heatmapOpts: null,
        };
        this._heatmapOpts = {
            viewLeft: 0, viewTop: 0, cellW: 0, cellH: 0,
            doGravity: false, doCoulomb: false, doYukawa: false,
        };
        this._renderOpts.heatmapOpts = this._heatmapOpts;

        // C13: Cache sidebar plot visibility check elements (lazily resolved after DOM is ready)
        this._particleTabEl = null;
        this._controlPanelEl = null;

        selectBackend().then(async ({ backend, device }) => {
            this.backend = backend;
            this._gpuDevice = device || null;
            updateBackendBadge(backend);
            console.log(`[physsim] Backend: ${backend}${device ? ' (WebGPU available)' : ''}`);

            if (backend === BACKEND_GPU && device) {
                try {
                    const gpuBackend = await GPUBackend.create(this, device);
                    this._gpuBackend = gpuBackend;
                    this._gpuPhysics = gpuBackend.physics;
                    this._gpuRenderer = gpuBackend.renderer;
                    this._gpuReady = true;

                    console.log('[physsim] GPU backend initialized');
                    if (this._onGPUReady) this._onGPUReady();

                    // Register device.lost handler for error recovery
                    device.lost.then((info) => {
                        console.error('[physsim] GPU device lost:', info.message);
                        this._gpuReady = false;
                        this.backend = BACKEND_CPU;
                        updateBackendBadge(BACKEND_CPU);
                        gpuBackend.canvas.remove();

                        // Restore from auto-save if available
                        if (gpuBackend.autoSave) {
                            loadState(gpuBackend.autoSave, this);
                            showToast(tI18n('gpu.lostRestored', 'GPU lost \u2014 restored from auto-save (CPU mode)'));
                        } else {
                            showToast(tI18n('gpu.lostSwitched', 'GPU lost \u2014 switched to CPU mode'));
                        }

                        this._dirty = true;
                        if (this._onGPULost) this._onGPULost();
                        _attemptGPURecovery();
                    });

                } catch (e) {
                    console.error('[physsim] GPU init failed, falling back to CPU:', e);
                    this._gpuReady = false;
                    this.backend = BACKEND_CPU;
                    updateBackendBadge(BACKEND_CPU);
                }
            }
        });

        this.init();
    }

    get runtimeBackend() {
        return (this.backend === BACKEND_GPU && this._gpuReady && this._gpuBackend)
            ? this._gpuBackend
            : this._cpuPhysics;
    }

    useGPUBackend() {
        if (!this._gpuReady || !this._gpuBackend) return false;
        this.backend = BACKEND_GPU;
        this._gpuBackend.activateFromCPU(this);
        updateBackendBadge(BACKEND_GPU);
        this._dirty = true;
        return true;
    }

    useCPUBackend() {
        this.backend = BACKEND_CPU;
        const gpuCanvas = document.getElementById('gpuCanvas');
        if (gpuCanvas) gpuCanvas.style.display = 'none';
        updateBackendBadge(BACKEND_CPU);
        this._dirty = true;
    }

    _restoreParticleFromSaveData(pd) {
        const p = new Particle(pd.x, pd.y, pd.mass, pd.charge);
        p.baseMass = pd.baseMass ?? pd.mass;
        p.antimatter = pd.antimatter || false;
        p.w.set(pd.wx, pd.wy);
        p.angw = pd.angw;
        const wSq = pd.wx * pd.wx + pd.wy * pd.wy;
        const gamma = Math.sqrt(1 + wSq);
        p.vel.set(pd.wx / gamma, pd.wy / gamma);
        p.angVel = this.physics.relativityEnabled
            ? pd.angw / Math.sqrt(1 + pd.angw * pd.angw * p.radius * p.radius)
            : pd.angw;
        p.creationTime = this.physics.simTime;
        p.updateColor();
        this.particles.push(p);
        return p;
    }

    // A11: Lazy field initialization — create on first use
    ensureHiggsField() {
        if (!this.higgsField) {
            this.higgsField = new HiggsField();
            this.renderer.higgsField = this.higgsField;
        }
        return this.higgsField;
    }
    ensureAxionField() {
        if (!this.axionField) {
            this.axionField = new AxionField();
            this.renderer.axionField = this.axionField;
        }
        return this.axionField;
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Initialize i18n before UI setup so static labels are correct on first paint.
        initI18n();
        this._wireLangButton();
        this._wrapSharedToolbar();

        setupUI(this);

        // Re-apply DOM translations after UI setup in case any modules
        // mutated text content during their wiring (e.g. mode-btn label).
        // Also re-translate on language change so dynamic content updates.
        if (window._i18n) window._i18n.applyDOM();

        // Save/Load buttons
        document.getElementById('saveBtn').addEventListener('click', () => quickSave(this));
        document.getElementById('loadBtn').addEventListener('click', () => { quickLoad(this); this._dirty = true; });

        // Ctrl+S / Ctrl+L keyboard shortcuts for save/load
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                quickSave(this);
            } else if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                quickLoad(this);
                this._dirty = true;
            } else if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                e.preventDefault();
                downloadState(this);
            } else if (e.ctrlKey && e.shiftKey && e.key === 'L') {
                e.preventDefault();
                uploadState(this);
                this._dirty = true;
            }
        });

        this._scheduleLoop();
    }

    /**
     * Wrap shared-toolbar APIs that bake English strings into aria/title.
     * The shared module is consumed by every sim, so we don't fork it —
     * instead we run our translation pass over the affected button after
     * each call. Idempotent and safe.
     */
    _wrapSharedToolbar() {
        if (typeof _toolbar === 'undefined') return;
        const origPlay = _toolbar.updatePlayBtn;
        const origSpeed = _toolbar.updateSpeedBtn;
        const _retranslatePlay = (btn, playing) => {
            btn.setAttribute('aria-label', tI18n(playing ? 'topbar.pauseAria' : 'topbar.playAria'));
            btn.title = tI18n(playing ? 'topbar.pause' : 'topbar.play');
        };
        const _retranslateSpeed = (btn, speed) => {
            btn.title = tI18n('topbar.speedTitle', 'Speed') + ': ' + speed + 'x';
            btn.setAttribute('aria-label', tI18n('topbar.speed'));
        };
        _toolbar.updatePlayBtn = function(btn, playing) {
            origPlay.call(_toolbar, btn, playing);
            _retranslatePlay(btn, playing);
            // Stash state so we can re-translate on language change.
            btn.dataset._playing = playing ? '1' : '0';
        };
        _toolbar.updateSpeedBtn = function(btn, speed) {
            origSpeed.call(_toolbar, btn, speed);
            _retranslateSpeed(btn, speed);
            btn.dataset._speed = String(speed);
        };
        // On language change, re-apply current state to play/speed buttons.
        onI18nChange(() => {
            const playBtn = document.getElementById('playBtn');
            if (playBtn && playBtn.dataset._playing != null) {
                _retranslatePlay(playBtn, playBtn.dataset._playing === '1');
            }
            const speedBtn = document.getElementById('speedBtn');
            if (speedBtn && speedBtn.dataset._speed != null) {
                _retranslateSpeed(speedBtn, Number(speedBtn.dataset._speed));
            }
        });
    }

    /**
     * Wire the EN/JA toggle button. Label shows the *destination* language in
     * its own script — "日本語" while in EN (click to swap to JA), "EN" while
     * in JA. Mirrors the root-site pattern. Persistence and DOM re-translation
     * are handled inside _i18n.setLang.
     */
    _wireLangButton() {
        const btn = document.getElementById('lang-btn');
        if (!btn) return;
        const label = btn.querySelector('.lang-label');
        const sync = () => {
            const cur = getI18nLang();
            if (label) label.textContent = cur === 'ja' ? 'EN' : '日本語';
            // Single dynamic title key: each language's dict describes the
            // destination from its own perspective. Falls back to per-direction
            // keys for back-compat if topbar.langToggle isn't defined yet.
            const dynTitle = tI18n('topbar.langToggle', null);
            btn.title = dynTitle != null && dynTitle !== 'topbar.langToggle'
                ? dynTitle
                : tI18n(cur === 'ja' ? 'topbar.langTitleJA' : 'topbar.langTitleEN');
            btn.setAttribute('aria-label', btn.title);
        };
        btn.addEventListener('click', () => {
            const cur = getI18nLang();
            const next = cur === 'ja' ? 'en' : 'ja';
            setI18nLang(next);
            // User-initiated swap to JA → disclose that this text is a
            // Claude-drafted translation. Toast only fires here (not on
            // initial-load detection), matching root-site behaviour.
            if (next === 'ja' && typeof showToast === 'function') {
                showToast(tI18n('toast.translated.ja'), 3500);
            }
            if (typeof _haptics !== 'undefined') _haptics.trigger('light');
        });
        onI18nChange(sync);
        sync();
    }

    resize() {
        const oldW = this.width, oldH = this.height;
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.domainW = this.width / WORLD_SCALE;
        this.domainH = this.height / WORLD_SCALE;
        this._domainDiagonal = 2 * Math.sqrt(this.domainW * this.domainW + this.domainH * this.domainH);
        this.renderer.resize(this.width, this.height);
        this.renderer.domainW = this.domainW;
        this.renderer.domainH = this.domainH;
        this.input.updateRect();
        if (this._gpuBackend) this._gpuBackend.resize(this);
        // R11: Refresh cached layout dimensions for sidebar plots
        this.phasePlot.cacheSize();
        this.effPotPlot.cacheSize();
        // Preserve top-left world position across resize
        this.camera.x += (this.width - oldW) / (2 * this.camera.zoom);
        this.camera.y += (this.height - oldH) / (2 * this.camera.zoom);
        this.camera.viewportW = this.width;
        this.camera.viewportH = this.height;
        this._dirty = true;
    }

    addParticle(x, y, vx, vy, options = {}) {
        const backend = this.runtimeBackend;
        if (!backend.canAddParticle(this)) return;
        // Always maintain CPU-side particle array (needed for presets, sidebar, etc.)
        const p = new Particle(x, y);
        p.mass = options.mass ?? 10;
        p.baseMass = options.baseMass ?? p.mass;
        p.charge = Math.round((options.charge ?? 0) / BOSON_CHARGE) * BOSON_CHARGE;
        p.antimatter = this.physics.blackHoleEnabled ? false : (options.antimatter ?? false);

        p.creationTime = this.physics.simTime;
        p.updateColor();

        // Spin is surface velocity as fraction of c; convert to angular celerity
        let sv = options.spin ?? 0;
        sv = Math.max(-MAX_SPEED_RATIO, Math.min(MAX_SPEED_RATIO, sv));
        const absSV = Math.abs(sv);
        p.angw = absSV > 0 ? Math.sign(sv) * absSV / (p.radius * Math.sqrt(1 - absSV * absSV)) : 0;
        setVelocity(p, vx, vy);
        p.angVel = this.physics.relativityEnabled ? angwToAngVel(p.angw, p.radius) : p.angw;

        if (!backend.addParticle(this, p, { x, y, vx, vy })) return;

        this.particles.push(p);
        if (!options.skipBaseline) this.stats.resetBaseline();
        this._dirty = true;
    }

    /** Backend-agnostic reset: clears all simulation state. */
    reset() {
        // CPU state — pre-allocate backing store to avoid reallocation
        this.particles = [];
        this.particles.length = MAX_PARTICLES;
        this.particles.length = 0;
        this.deadParticles = [];
        this.clearBosons();
        this.totalRadiated = 0;
        this.totalRadiatedPx = 0;
        this.totalRadiatedPy = 0;
        this.selectedParticle = null;
        this.physics._forcesInit = false;
        if (this.higgsField) this.higgsField.reset();
        if (this.axionField) this.axionField.reset();
        // GPU state (if active)
        if (this._gpuBackend) this._gpuBackend.reset(this);
    }

    /** Release all active photons/pions/leptons to their pools and clear the arrays. */
    clearBosons() {
        for (let i = 0; i < this.photons.length; i++) MasslessBoson.release(this.photons[i]);
        for (let i = 0; i < this.pions.length; i++) Pion.release(this.pions[i]);
        for (let i = 0; i < this.leptons.length; i++) Lepton.release(this.leptons[i]);
        this.photons.length = 0;
        this.pions.length = 0;
        this.leptons.length = 0;
    }

    emitPhotonBurst(x, y, energy, radius, emitterId) {
        const n = Math.min(Math.max(1, Math.floor(energy / SPAWN_MIN_ENERGY)), MAX_PHOTONS - this.photons.length);
        if (n <= 0) return;
        const offset = spawnOffset(radius);
        const ePerPh = energy / n;
        for (let j = 0; j < n; j++) {
            const angle = Math.random() * TWO_PI;
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            this.photons.push(MasslessBoson.acquire(
                x + cosA * offset, y + sinA * offset,
                cosA, sinA, ePerPh, emitterId
            ));
            this.totalRadiatedPx += ePerPh * cosA;
            this.totalRadiatedPy += ePerPh * sinA;
        }
        this.totalRadiated += energy;
    }

    markDirty() { this._dirty = true; }

    loop(timestamp) {
      this._loopScheduled = false;
      try { this._loopBody(timestamp); }
      catch (e) { console.error('[physsim] loop error:', e); }
      if (!this._hidden) this._scheduleLoop();
    }

    _scheduleLoop() {
        if (this._loopScheduled) return; // prevent duplicate rAF chains
        this._loopScheduled = true;
        requestAnimationFrame((t) => this.loop(t));
    }

    _loopBody(timestamp) {
        const rawDt = Math.min((timestamp - this.lastTime) / 1000, MAX_FRAME_DT);
        this.lastTime = timestamp;

        const backend = this.runtimeBackend;
        if (this.running) {
            this._dirty = true;
            this.accumulator += rawDt * this.speedScale;
            const maxAccum = PHYSICS_DT * MAX_SUBSTEPS * ACCUMULATOR_CAP;
            if (this.accumulator > maxAccum) this.accumulator = maxAccum;
            backend.step(this);
        }

        backend.pollInput(this);

        // Refresh hover tooltip periodically (every 8th frame, matching stats rate)
        if (this.running && !(++this._ttFrame & STATS_THROTTLE_MASK)) {
            this.input.refreshTooltip();
        }

        // Skip render entirely when nothing has changed (paused, no interaction)
        if (this._dirty) {
            this._dirty = false;
            backend.render(this);
        }

    }

}

const sim = new Simulation();
window.sim = sim;

// A5: Halt rAF loop when tab is hidden, resume with reset lastTime on visible
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        sim._hidden = true;
    } else {
        sim._hidden = false;
        sim.lastTime = performance.now();
        sim._scheduleLoop(); // safe: prevents duplicate rAF chains
    }
});
