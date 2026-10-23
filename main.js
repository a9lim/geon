import InputHandler from './src/input.js';
import Overlay from './src/overlay.js';
import PhasePlot from './src/phase-plot.js';
import EffectivePotentialPlot from './src/effective-potential.js';
import StatsDisplay from './src/stats-display.js';
import { setupUI } from './src/ui.js';
import { init as initI18n, setLang as setI18nLang, getLang as getI18nLang, t as tI18n, onChange as onI18nChange } from './src/i18n.js';
import { WORLD_SCALE, ZOOM_MIN, ZOOM_MAX, WHEEL_ZOOM_IN, DEFAULT_SPEED_SCALE, DEFAULT_SPEED_INDEX, PHYSICS_DT, MAX_SUBSTEPS, MAX_FRAME_DT, ACCUMULATOR_CAP, COL_PASS, BOUND_DESPAWN, TORUS, STATS_THROTTLE_MASK, BOSON_CHARGE, MAX_SPEED_RATIO } from './src/config.js';
import { createPhysicsSettings } from './src/physics-settings.js';
import { loadState, quickSave, quickLoad, downloadState, uploadState } from './src/save-load.js';
import GPUBackend from './src/gpu/gpu-backend.js';

/**
 * Request a WebGPU device with the limits the simulation needs.
 * @returns {Promise<GPUDevice|null>} null when WebGPU is unavailable.
 */
async function requestDevice() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return null;
        return await adapter.requestDevice({
            requiredLimits: {
                maxStorageBufferBindingSize: 256 * 1024 * 1024,
                maxBufferSize: 256 * 1024 * 1024,
                maxComputeWorkgroupsPerDimension: 65535,
                maxStorageBuffersPerShaderStage: Math.min(
                    adapter.limits.maxStorageBuffersPerShaderStage, 10),
                maxBindingsPerBindGroup: adapter.limits.maxBindingsPerBindGroup,
            },
        });
    } catch (e) {
        console.warn('[geon] WebGPU device request failed:', e);
        return null;
    }
}

/** The opening popup for browsers without WebGPU: Geon has no other backend. */
function showWebGPURequired() {
    if (document.getElementById('webgpu-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'webgpu-overlay';
    overlay.className = 'sim-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'webgpu-title');
    overlay.innerHTML = `
        <div class="sim-overlay-panel glass">
            <div class="stats-header">
                <h2 id="webgpu-title" class="stats-title"></h2>
                <button class="tool-btn"></button>
            </div>
            <div class="sim-overlay-body"><p class="webgpu-body"></p><p class="webgpu-browsers"></p></div>
        </div>`;
    const fill = () => {
        overlay.querySelector('#webgpu-title').textContent = tI18n('webgpu.title');
        overlay.querySelector('.webgpu-body').textContent = tI18n('webgpu.body');
        overlay.querySelector('.webgpu-browsers').textContent = tI18n('webgpu.browsers');
        const close = overlay.querySelector('button');
        close.setAttribute('aria-label', tI18n('webgpu.close'));
        close.title = tI18n('webgpu.close');
    };
    fill();
    onI18nChange(fill);
    if (typeof _ICON !== 'undefined') overlay.querySelector('button').innerHTML = _ICON.at('close', 16);
    const dismiss = () => overlay.remove();
    overlay.querySelector('button').addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onKey); }
    });
    document.body.appendChild(overlay);
    overlay.querySelector('button').focus();
}

class Simulation {
    constructor() {
        this.canvas = document.getElementById('simCanvas');
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        this.settings = createPhysicsSettings();
        this.overlay = new Overlay(this.canvas);
        this.view = { trails: true, showVelocity: false, showForce: false, showForceComponents: false };
        this.heatmap = { enabled: false, mode: 'all' };
        this.domainW = this.width / WORLD_SCALE;
        this.domainH = this.height / WORLD_SCALE;

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

        this.lastTime = 0;
        this.running = true;
        this.accumulator = 0;
        this._hidden = false;
        this._loopScheduled = false; // prevent duplicate rAF chains
        this._sbFrame = 0;
        this._ttFrame = 0; // tooltip refresh throttle counter
        this._dirty = true; // render dirty flag — skip frames when nothing changed
        this._statsDirty = false; // request stats on the next frame even while paused

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
        this.selectedIdx = -1; // GPU slot of the selected particle, -1 for none
        this.totalRadiated = 0;
        this.totalRadiatedPx = 0;
        this.totalRadiatedPy = 0;

        this.gpu = null;          // GPUBackend once WebGPU is up
        this._gpuPhysics = null;
        this._gpuRenderer = null;

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

        // Pre-allocated render options objects (avoid per-frame allocation)
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

        // Lazily resolved sidebar visibility elements
        this._particleTabEl = null;
        this._controlPanelEl = null;

        this.init();
        this.startGPU();
    }

    async startGPU() {
        const device = await requestDevice();
        if (!device) { showWebGPURequired(); return; }
        await this._attachDevice(device);
    }

    /** Build the GPU backend on a device, optionally restoring a saved state into it. */
    async _attachDevice(device, restore = null) {
        let backend;
        try {
            backend = await GPUBackend.create(this, device);
        } catch (e) {
            console.error('[geon] GPU init failed:', e);
            showWebGPURequired();
            return;
        }
        this.gpu = backend;
        this._gpuPhysics = backend.physics;
        this._gpuRenderer = backend.renderer;
        if (restore) loadState(restore, this);
        device.lost.then((info) => this._onDeviceLost(backend, info));
        this._dirty = true;
    }

    /** Recreate the device and restore the latest auto-save. */
    async _onDeviceLost(backend, info) {
        if (this.gpu !== backend) return;
        console.error('[geon] GPU device lost:', info.message);
        const restore = backend.autoSave;
        this.gpu = null;
        this._gpuPhysics = null;
        this._gpuRenderer = null;
        backend.canvas.remove();
        if (info.reason === 'destroyed') return;
        const device = await requestDevice();
        if (!device) { showWebGPURequired(); return; }
        await this._attachDevice(device, restore);
        showToast(tI18n(restore ? 'gpu.lostRestored' : 'gpu.lostReset'));
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
        this.overlay.resize(this.width, this.height);
        this.input.updateRect();
        if (this.gpu) this.gpu.resize(this);
        // Refresh cached layout dimensions for sidebar plots
        this.phasePlot.cacheSize();
        this.effPotPlot.cacheSize();
        // Preserve top-left world position across resize
        this.camera.x += (this.width - oldW) / (2 * this.camera.zoom);
        this.camera.y += (this.height - oldH) / (2 * this.camera.zoom);
        this.camera.viewportW = this.width;
        this.camera.viewportH = this.height;
        this._dirty = true;
    }

    /**
     * Spawn a particle at (x, y) with coordinate velocity (vx, vy).
     * options: mass, charge (rounded to BOSON_CHARGE quanta), spin (surface speed)
     * or angw (proper angular velocity), antimatter, skipBaseline.
     * @returns {number} GPU slot, or -1 if the pool is full or WebGPU is not up.
     */
    addParticle(x, y, vx, vy, options = {}) {
        const gpu = this.gpu;
        if (!gpu || !gpu.canAddParticle()) return -1;
        const mass = options.mass ?? 10;
        const charge = Math.round((options.charge ?? 0) / BOSON_CHARGE) * BOSON_CHARGE;
        const antimatter = this.settings.blackHoleEnabled ? false : (options.antimatter ?? false);

        // Spin is surface velocity by default; internal callers can pass angw directly.
        let angw;
        if (options.angw !== undefined) {
            angw = options.angw;
        } else {
            const sv = clamp(options.spin ?? 0, -MAX_SPEED_RATIO, MAX_SPEED_RATIO);
            const absSV = Math.abs(sv);
            angw = absSV > 0 ? Math.sign(sv) * absSV / (Math.cbrt(mass) * Math.sqrt(1 - absSV * absSV)) : 0;
        }

        // Proper velocity w = γv, with |v| clamped below c
        const speedSq = vx * vx + vy * vy;
        if (speedSq >= 1) {
            const s = MAX_SPEED_RATIO / Math.sqrt(speedSq);
            vx *= s;
            vy *= s;
        }
        const gamma = 1 / Math.sqrt(Math.max(1 - MAX_SPEED_RATIO * MAX_SPEED_RATIO, 1 - vx * vx - vy * vy));

        const idx = gpu.addParticle({ x, y, vx: vx * gamma, vy: vy * gamma, mass, charge, angw, antimatter });
        if (idx < 0) return -1;
        if (!options.skipBaseline) this.stats.resetBaseline();
        this._dirty = true;
        return idx;
    }

    /** Clear the simulation: particles, bosons, fields, selection. */
    reset() {
        this.totalRadiated = 0;
        this.totalRadiatedPx = 0;
        this.totalRadiatedPy = 0;
        this.select(-1);
        if (this.gpu) this.gpu.reset(this);
    }

    /** Select a particle by GPU slot (-1 clears); the sidebar fills on the next stats readback. */
    select(idx) {
        if (idx !== this.selectedIdx) {
            this.phasePlot.reset();
            this.effPotPlot.reset();
        }
        this.selectedIdx = idx;
        if (idx < 0) this.stats.updateSelectedGPU(null, this.settings);
        this._statsDirty = true;
        this._dirty = true;
    }

    markDirty() { this._dirty = true; }

    loop(timestamp) {
      this._loopScheduled = false;
      try { this._loopBody(timestamp); }
      catch (e) { console.error('[geon] loop error:', e); }
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

        const gpu = this.gpu;
        if (!gpu) {
            this.overlay.draw(this.camera, this.input);
            return;
        }
        if (this.running) {
            this._dirty = true;
            this.accumulator += rawDt * this.speedScale;
            const maxAccum = PHYSICS_DT * MAX_SUBSTEPS * ACCUMULATOR_CAP;
            if (this.accumulator > maxAccum) this.accumulator = maxAccum;
            gpu.step(this);
        }

        this.input.pollGPUHitResult();

        // Refresh hover tooltip periodically (every 8th frame, matching stats rate)
        if (this.running && !(++this._ttFrame & STATS_THROTTLE_MASK)) {
            this.input.refreshTooltip();
        }

        // Skip render entirely when nothing has changed (paused, no interaction)
        if (this._dirty) {
            this._dirty = false;
            gpu.render(this);
        }
    }
}

const sim = new Simulation();
window.sim = sim;

// Halt rAF loop when tab is hidden, resume with reset lastTime on visible
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        sim._hidden = true;
    } else {
        sim._hidden = false;
        sim.lastTime = performance.now();
        sim._scheduleLoop(); // safe: prevents duplicate rAF chains
    }
});
