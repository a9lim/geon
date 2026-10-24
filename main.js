import InputHandler from './src/input.js';
import Overlay from './src/overlay.js';
import FieldAtlas from './src/field-atlas.js';
import PhasePlot from './src/phase-plot.js';
import EffectivePotentialPlot from './src/effective-potential.js';
import StatsDisplay from './src/stats-display.js';
import { setupUI } from './src/ui.js';
import { init as initI18n, setLang as setI18nLang, getLang as getI18nLang, t as tI18n, onChange as onI18nChange } from './src/i18n.js';
import { WORLD_SCALE, DEFAULT_DOMAIN, ZOOM_MIN, ZOOM_MAX, WHEEL_ZOOM_IN, DEFAULT_SPEED_SCALE, DEFAULT_SPEED_INDEX, PHYSICS_DT, MAX_SUBSTEPS, MAX_FRAME_DT, ACCUMULATOR_CAP, COL_PASS, BOUND_DESPAWN, TORUS, STATS_THROTTLE_MASK, BOSON_CHARGE, MAX_SPEED_RATIO } from './src/config.js';
import { createPhysicsSettings } from './src/physics-settings.js';
import { loadState, quickSave, quickLoad, downloadState, uploadState } from './src/save-load.js';
import GPUBackend from './src/gpu/gpu-backend.js';
import Frames from './src/frames.js';
import FramePanel from './src/frame-panel.js';
import CosmologyPanel from './src/cosmology-panel.js';
import LensPanel from './src/lens-panel.js';
import SpacetimeView, { EL_SPACETIME, AZ_SPACETIME } from './src/spacetime.js';
import Caption from './src/caption.js';
import SceneKey, { decorateMargin } from './src/scene-key.js';

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
        console.warn('[worldline] WebGPU device request failed:', e);
        return null;
    }
}

/** The opening popup for browsers without WebGPU: Worldline has no other backend. */
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
        // The stage is the scene above its figure bar, beside the margin when that is open
        this.stage = this.canvas.parentElement;
        this.width = this.stage.clientWidth || window.innerWidth;
        this.height = this.stage.clientHeight || window.innerHeight;

        this.settings = createPhysicsSettings();
        this.overlay = new Overlay(this.canvas);
        this.view = { trails: true, showClocks: false, showVelocity: false, showForce: false, showForceComponents: false, grid: true };
        this.heatmap = { enabled: false, mode: 'all' };
        this.atlas = new FieldAtlas(this);   // the Fields overlay's contours and field lines
        // The grid as a lensed backdrop (lens-panel.js): on, distance D, the probe's star
        this.lens = { on: false, distance: 1, star: null, gen: 0 };
        // The domain is simulation state; the window is only a camera onto it
        this.domainW = DEFAULT_DOMAIN;
        this.domainH = DEFAULT_DOMAIN;

        this.frames = new Frames(this);
        this.phasePlot = new PhasePlot();
        this.effPotPlot = new EffectivePotentialPlot();

        const sim = this;
        this.camera = createCamera({
            width: this.width, height: this.height,
            x: this.domainW / 2, y: this.domainH / 2,
            zoom: this._fitZoom(),
            minZoom: ZOOM_MIN, maxZoom: ZOOM_MAX,
            wheelFactor: WHEEL_ZOOM_IN,
            onUpdate() { sim._dirty = true; },
            clamp(cam) {
                // A frame's camera is in the observer's coordinates, unbounded
                if (sim.frames && sim.frames.active) return;
                const halfW = cam.viewportW / (2 * cam.zoom);
                const halfH = cam.viewportH / (2 * cam.zoom);
                const dw = sim.physW, dh = sim.physH;
                if (halfW * 2 >= dw) cam.x = dw / 2;
                else cam.x = clamp(cam.x, halfW, dw - halfW);
                if (halfH * 2 >= dh) cam.y = dh / 2;
                else cam.y = clamp(cam.y, halfH, dh - halfH);
            },
        });

        // The canvas tilts from the plane into spacetime; the camera maps through the tilt
        this.spacetime = new SpacetimeView(this);
        this.spacetime.wrapCamera(this.camera);

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
        this._spawningPreset = false; // presets.js sets this around a preset's spawn()

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
            expansionWork: document.getElementById('expansionWork'),
            expansionWorkRow: document.getElementById('expansion-work-row'),
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
            tau: document.getElementById('sel-tau'),
            lapse: document.getElementById('sel-lapse'),
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
        if (this.gpu) this._openScene();
    }

    /**
     * Open on a living frame: the cyclotron preset, already running and seen from above;
     * a moment later the plane tilts into spacetime once, unless the visitor has taken over
     * by then. With reduced motion it opens tilted and still, on a history run up front.
     */
    _openScene() {
        const select = document.getElementById('preset-select');
        if (select.value !== 'none' || this.gpu.physics.aliveCount > 0) return;
        this._openingScene = true;
        select.value = 'cyclotron';
        select.dispatchEvent(new Event('change'));
        this._openingScene = false;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            for (let i = 0; i < 240; i++) {
                this.accumulator += this.speedScale / 60;
                this.gpu.step(this);
            }
            this.running = false;
            this.colophon?.setPlaying(false);
            this.spacetime.set(EL_SPACETIME, AZ_SPACETIME);
            return;
        }
        let touched = false;
        const take = () => { touched = true; };
        for (const ev of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(ev, take, { once: true, capture: true });
        setTimeout(() => {
            if (touched || this.spacetime.tilted) return;
            document.getElementById('view-spacetime').click();
        }, 2600);
    }

    /** Build the GPU backend on a device, optionally restoring a saved state into it. */
    async _attachDevice(device, restore = null) {
        let backend;
        try {
            backend = await GPUBackend.create(this, device);
        } catch (e) {
            console.error('[worldline] GPU init failed:', e);
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
        console.error('[worldline] GPU device lost:', info.message);
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
        new ResizeObserver(() => this.resize()).observe(this.stage);

        // Initialize i18n before UI setup so static labels are correct on first paint.
        initI18n();
        this._wireLangButton();

        setupUI(this);
        this.framePanel = new FramePanel(this);
        this.cosmologyPanel = new CosmologyPanel(this);
        this.lensPanel = new LensPanel(this);
        this.caption = new Caption(this);
        this.sceneKey = new SceneKey(this);
        decorateMargin();

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
        this.width = Math.max(1, this.stage.clientWidth);
        this.height = Math.max(1, this.stage.clientHeight);
        // Canvases draw at the device's pixel ratio (capped at 2) for crisp hairlines
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (this.width === oldW && this.height === oldH && dpr === this.dpr) return;
        this.dpr = dpr;
        this.canvas.width = Math.round(this.width * dpr);
        this.canvas.height = Math.round(this.height * dpr);
        this.overlay.resize(this.width, this.height, dpr);
        this.input.updateRect();
        if (this.gpu) this.gpu.resize(this);
        // Refresh cached layout dimensions for sidebar plots
        this.phasePlot.cacheSize();
        this.effPotPlot.cacheSize();
        // Preserve the top-left world position across resize (a frame keeps its observer centred)
        if (!this.frames.active) {
            this.camera.x += (this.width - oldW) / (2 * this.camera.zoom);
            this.camera.y += (this.height - oldH) / (2 * this.camera.zoom);
        }
        this.camera.viewportW = this.width;
        this.camera.viewportH = this.height;
        this._dirty = true;
    }

    /** Comoving view: the camera shrinks with the universe, so the domain holds still on screen. */
    setComovingView(on) {
        this.view.comoving = on;
        this._dirty = true;
    }

    /**
     * The universe grew by r this frame. The camera stays on the same comoving point, and in
     * the comoving view it zooms out with the growth.
     */
    followExpansion(r) {
        const cam = this.camera;
        cam.minZoom = ZOOM_MIN / this.scaleA;
        if (this.frames.active) return;
        cam.x *= r;
        cam.y *= r;
        if (this.view.comoving) cam.zoom = Math.max(cam.zoom / r, cam.minZoom);
        if (cam.clampFn) cam.clampFn(cam);
        this._dirty = true;
    }

    /** The cosmological scale factor: 1 unless the universe has expanded (cosmology.js). */
    get scaleA() { return this._gpuPhysics ? this._gpuPhysics.scaleA : 1; }

    /** The domain's physical size: the comoving domain (state) times the scale factor. */
    get physW() { return this.domainW * this.scaleA; }
    get physH() { return this.domainH * this.scaleA; }

    /** Zoom that fits the whole domain in the window, with a margin. */
    _fitZoom() {
        const z = 0.92 * Math.min(this.width / this.physW, this.height / this.physH);
        return Math.min(Math.max(z, ZOOM_MIN / this.scaleA), ZOOM_MAX);
    }

    /** Center the camera on the domain and zoom to fit it. */
    fitCamera() {
        this.camera.reset(this.physW / 2, this.physH / 2, this._fitZoom());
    }

    /** Resize the simulated domain (world units). Particles are not moved. */
    setDomain(w, h) {
        this.domainW = w;
        this.domainH = h;
        if (this.gpu) this.gpu.setDomain(w, h);
        this.fitCamera();
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

        // Preset bodies are initial conditions, moving uniformly forever as far as signal
        // delay is concerned; anything spawned later is born now, and its field spreads at c.
        const idx = gpu.addParticle({
            x, y, vx: vx * gamma, vy: vy * gamma, mass, charge, angw, antimatter,
            bornAt: this._spawningPreset ? -Infinity : null,
        });
        if (idx < 0) return -1;
        if (!options.skipBaseline) this.stats.resetBaseline();
        this._dirty = true;
        return idx;
    }

    /** Clear the simulation: particles, bosons, fields, selection. */
    reset() {
        this.presetTick = null;
        this.select(-1);
        if (this.gpu) this.gpu.reset(this);
        this.camera.minZoom = ZOOM_MIN;
        this.lensPanel?.setProbe(false);
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
      catch (e) { console.error('[worldline] loop error:', e); }
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
            if (this.presetTick) this.presetTick();
        }

        this.input.pollGPUHitResult();
        this.spacetime.step(rawDt);
        this.spacetime.stepCoords(rawDt);
        this.caption?.update();
        this.sceneKey?.update();

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
