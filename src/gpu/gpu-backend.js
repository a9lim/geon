/**
 * GPU runtime: owns GPUPhysics and GPURenderer for one device, and connects them
 * to the Simulation — stepping, event readbacks, rendering, stats, auto-save.
 */
import {
    TWO_PI, PHYSICS_DT, SPAWN_COUNT, spawnOffset,
    GPU_HEATMAP_GRID, STATS_THROTTLE_MASK, INERTIA_K, EPSILON, BOUND_LOOP,
} from '../config.js';
import GPUPhysics, { LENS_RES } from './gpu-physics.js';
import GPURenderer from './gpu-renderer.js';
import { t } from '../i18n.js';

// Expansion: the most the scale factor may grow per update (ln a), and the most updates a frame
const EXPANSION_STEP = 0.02;
const MAX_EXPANSION_CHUNKS = 16;
const AUTO_SAVE_INTERVAL = 300;

export default class GPUBackend {
    static async create(sim, device) {
        const gpuCanvas = document.createElement('canvas');
        gpuCanvas.id = 'gpuCanvas';
        gpuCanvas.width = sim.width;
        gpuCanvas.height = sim.height;
        gpuCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:-1;';
        sim.canvas.parentElement.appendChild(gpuCanvas);

        const physics = new GPUPhysics(device, sim.domainW, sim.domainH);
        const renderer = new GPURenderer(gpuCanvas, device, physics.buffers);
        await physics.init();
        renderer.frameBuffers = physics.frameBuffers;
        renderer.lensBuffers = physics.lensBuffers;
        await renderer.init();
        // The theme was synced before this async backend existed; adopt it now
        // (after init, which creates the light/dark pipeline pairs setTheme swaps).
        renderer.setTheme(sim.overlay.isLight);

        const backend = new GPUBackend(device, gpuCanvas, physics, renderer);
        backend.applySettings(sim);
        return backend;
    }

    constructor(device, canvas, physics, renderer) {
        this.kind = 'gpu';
        this.device = device;
        this.canvas = canvas;
        this.physics = physics;
        this.renderer = renderer;
        this.autoSave = null;
        this._autoSaveCounter = 0;
    }

    canAddParticle() {
        return this.physics.aliveCount < this.physics.buffers.maxParticles;
    }

    /** @param {{x, y, vx, vy, mass, charge, angw, antimatter}} spec — vx, vy are proper velocity. */
    addParticle(spec) {
        return this.physics.addParticle(spec);
    }

    reset() {
        this.physics.reset();
    }

    resize(sim) {
        this.canvas.width = sim.width;
        this.canvas.height = sim.height;
        this.renderer.resize(sim.width, sim.height);
    }

    /** The comoving domain (sim.domainW/H); the physical one is a × it. */
    setDomain(w, h) {
        this.physics.setComovingDomain(w, h);
        this.renderer.setDomain(this.physics.domainW, this.physics.domainH);
    }

    setTheme(isLight) {
        this.renderer.setTheme(isLight);
    }

    /** Push the settings store and the modes into GPUPhysics. */
    applySettings(sim) {
        const toggles = Object.create(sim.settings);
        toggles.heatmapEnabled = sim.heatmap.enabled;
        toggles.heatmapMode = sim.heatmap.mode;
        toggles.collisionMode = sim.collisionMode;
        this.physics.setToggles(toggles);
        this.syncModes(sim);
    }

    syncModes(sim) {
        this.physics.boundaryMode = sim.boundaryMode;
        this.physics.topologyMode = sim.topology;
        this.physics._collisionMode = sim.collisionMode;
    }

    /**
     * Advance by dt; under expansion the camera follows the universe's growth. The universe
     * grows once per update(), so a frame with H·dt above EXPANSION_STEP is split: the split
     * between the stretch and the dynamics, and Hubble friction, stay accurate to that.
     */
    _advance(sim, dt) {
        const a0 = this.physics.scaleA;
        const H = this.physics.expanding ? this.physics.cosmology.H : 0;
        const chunks = H > 0 ? Math.min(MAX_EXPANSION_CHUNKS, Math.ceil(H * dt / EXPANSION_STEP)) : 1;
        for (let i = 0; i < chunks; i++) this.physics.update(dt / chunks);
        const a1 = this.physics.scaleA;
        if (a1 !== a0) {
            this.renderer.setDomain(this.physics.domainW, this.physics.domainH);
            if (sim) sim.followExpansion(a1 / a0);
        }
        // Past A_MAX the universe stops growing (cosmology.js); say so once
        const capped = this.physics.cosmology.capped;
        if (capped && !this._cappedShown && typeof showToast === 'function') showToast(t('cosmo.capped'));
        this._cappedShown = capped;
    }

    stepOnce(sim) {
        this._advance(sim, PHYSICS_DT);
    }

    step(sim) {
        this.physics.setCamera(sim.camera);
        const substeps = Math.floor(sim.accumulator / PHYSICS_DT);
        if (substeps > 0) {
            this._advance(sim, PHYSICS_DT * substeps);
            sim.accumulator -= substeps * PHYSICS_DT;
        }

        this._processDisintegrationEvents(sim);
        this._processKugelblitzEvents(sim);

        if (++this._autoSaveCounter >= AUTO_SAVE_INTERVAL) {
            this._autoSaveCounter = 0;
            this.physics.serialize(sim).then(state => { this.autoSave = state; });
        }
    }

    pollInput(sim) {
        sim.input.pollGPUHitResult();
    }

    render(sim) {
        const ph = sim.settings;
        this.renderer.updateCamera(sim.camera);
        this.renderer.showForce = sim.view.showForce;
        this.renderer.showForceComponents = sim.view.showForceComponents;
        this.renderer.showVelocity = sim.view.showVelocity;
        this.renderer.showTrails = sim.view.trails;
        this.renderer.showClocks = sim.view.showClocks;
        this.renderer.relativityOn = sim.settings.relativityEnabled;
        this.renderer.blackHoleOn = sim.settings.blackHoleEnabled;
        this.renderer.setDomain(this.physics.domainW, this.physics.domainH);
        this.renderer.periodic = sim.boundaryMode === BOUND_LOOP;
        this.renderer.showGrid = sim.view.grid;
        this.renderer.scaleA = this.physics.scaleA;
        this.renderer.higgsVev = Math.sqrt(Math.max(this.physics.higgsQuenchEpsilon, 0));

        // A non-lab frame: slice every world line on the observer's hyperplane first
        if (sim.frames.active && !sim.frames.allowed) sim.framePanel?.choose('lab');
        const frameParams = sim.frames.params();
        if (frameParams) {
            this.physics.sliceFrame(frameParams);
            const state = this.physics.readFrameState();
            if (state) {
                sim.frames.state = state;
                if (!state.valid && state.kind === 2) sim.framePanel?.observerLost();
            }
            sim.framePanel?.update();
        }
        sim.minkowski?.tick();
        this.renderer.frameOn = !!frameParams;
        this.renderer.frameImages = frameParams ? frameParams.images : 1;

        this.physics.setTrailsEnabled(sim.view.trails);
        const trailBufs = this.physics.getTrailBuffers();
        if (trailBufs && !this.renderer._trailReady) {
            this.renderer.initTrailRendering(trailBufs);
        }
        if ((ph.higgsEnabled || ph.axionEnabled) && !this.renderer._fieldRenderReady) {
            this.renderer.initFieldOverlay();
        }
        if (sim.heatmap.enabled && !this.renderer._heatmapRenderReady) {
            this.renderer.initHeatmapOverlay();
        }

        const ef = sim._enabledForces;
        ef.gravity    = ph.gravityEnabled;
        ef.coulomb    = ph.coulombEnabled;
        ef.magnetic   = ph.magneticEnabled;
        ef.gravitomag = ph.gravitomagEnabled;
        ef.onePN      = ph.onePNEnabled;
        ef.spinOrbit  = ph.spinOrbitEnabled;
        ef.radiation  = ph.radiationEnabled;
        ef.yukawa     = ph.yukawaEnabled;
        ef.external   = (ph.extGravity !== 0 || ph.extElectric !== 0 || ph.extBz !== 0);
        ef.higgs      = ph.higgsEnabled;
        ef.axion      = ph.axionEnabled;

        const renderOpts = sim._renderOpts;
        renderOpts.blackHoleEnabled = ph.blackHoleEnabled;
        renderOpts.higgsField = null;
        renderOpts.axionField = null;
        renderOpts.heatmapBuffers = null;

        if (ph.higgsEnabled) {
            const hb = this.physics.getFieldBuffers('higgs');
            if (hb) renderOpts.higgsField = hb.field;
        }
        if (ph.axionEnabled) {
            const ab = this.physics.getFieldBuffers('axion');
            if (ab) renderOpts.axionField = ab.field;
        }

        if (sim.heatmap.enabled) {
            const hmBufs = this.physics.getHeatmapBuffers();
            if (hmBufs) {
                renderOpts.heatmapBuffers = hmBufs;
                const cam = sim.camera;
                const viewW = sim.width / cam.zoom;
                const viewH = sim.height / cam.zoom;
                const hmMode = sim.heatmap.mode;
                const ho = sim._heatmapOpts;
                ho.viewLeft = cam.x - viewW / 2;
                ho.viewTop = cam.y - viewH / 2;
                ho.cellW = viewW / GPU_HEATMAP_GRID;
                ho.cellH = viewH / GPU_HEATMAP_GRID;
                ho.doGravity = ph.gravityEnabled && (hmMode === 'all' || hmMode === 'gravity');
                ho.doCoulomb = ph.coulombEnabled && (hmMode === 'all' || hmMode === 'electric');
                ho.doYukawa = ph.yukawaEnabled && (hmMode === 'all' || hmMode === 'yukawa');
            }
        }

        // The lensed backdrop: the deflection map over the view (lab frame only)
        if (sim.lens.on && !frameParams && this.physics.aliveCount > 0) {
            const cam = sim.camera;
            const w = 1.1 * sim.width / cam.zoom, h = 1.1 * sim.height / cam.zoom;
            const lens = { res: LENS_RES, left: cam.x - w / 2, top: cam.y - h / 2, width: w, height: h, star: sim.lens.star };
            this.physics.dispatchLens({ ...lens, distance: sim.lens.distance, generation: sim.lens.gen });
            this.renderer.lens = lens;
            sim.lensPanel?.update();
        } else {
            this.renderer.lens = null;
        }

        this.renderer.render(this.physics.aliveCount, renderOpts);
        // The horizons ring the selected body, or the middle of the view
        const horizons = sim.cosmologyPanel?.horizons();
        if (horizons) horizons.center = sim.selectedIdx >= 0 && sim._selPos ? sim._selPos : [sim.camera.x, sim.camera.y];
        sim.overlay.draw(sim.camera, sim.input, horizons);
        this._renderStats(sim);
    }

    _renderStats(sim) {
        // A request skipped while a readback is in flight stays dirty for the next frame
        if ((sim.running && !(sim._sbFrame & STATS_THROTTLE_MASK)) || sim._statsDirty) {
            if (this.physics.requestStats(sim.selectedIdx)) sim._statsDirty = false;
        }
        sim._sbFrame++;
        const gpuStats = this.physics.readStats();
        if (!gpuStats) return;
        sim.stats.updateEnergyGPU(gpuStats, sim);
        sim.cosmologyPanel?.update();

        // A readback requested before the selection changed says nothing about the new one
        if (gpuStats.selectedIdx !== sim.selectedIdx) return;

        // A selected particle that died (merged, evaporated, removed) drops the selection.
        const sel = gpuStats.selected;
        const alive = sel && (sel.flags & 1) !== 0;
        if (sim.selectedIdx >= 0 && !alive) sim.select(-1);
        sim.stats.updateSelectedGPU(sim.selectedIdx >= 0 ? sel : null, sim.settings);
        if (sim.selectedIdx < 0) return;
        sim._selPos = [sel.posX, sel.posY];

        if (!sim._particleTabEl) {
            sim._particleTabEl = document.getElementById('tab-particle');
            sim._controlPanelEl = document.getElementById('control-panel');
        }
        const particleTabActive = sim._particleTabEl && sim._particleTabEl.classList.contains('active') &&
            sim._controlPanelEl && sim._controlPanelEl.classList.contains('open');
        if (particleTabActive) {
            const sel2 = { ...sel, index: sim.selectedIdx };
            const geom = { domainW: sim.physW, domainH: sim.physH, boundaryMode: sim.boundaryMode, topology: sim.topology };
            sim.phasePlot.update(sel2, gpuStats.reference, geom);
            sim.effPotPlot.update(sel2, gpuStats.reference, sim.settings, geom);
            sim.phasePlot.draw(sim.overlay.isLight);
            sim.effPotPlot.draw(sim.overlay.isLight);
        }
    }

    _processDisintegrationEvents(sim) {
        const disintEvents = this.physics.consumeDisintegrationEvents();
        for (let i = 0; i < disintEvents.length; i++) {
            const evt = disintEvents[i];
            if (evt.eventType === 0) {
                this.physics.removeParticle(evt.particleIdx, evt.mass, evt.angW);
                const nf = SPAWN_COUNT;
                const fragMass = evt.mass / nf;
                const fragCharge = evt.charge / nf;
                for (let fi = 0; fi < nf; fi++) {
                    const angle = (TWO_PI * fi) / nf;
                    const offset = spawnOffset(evt.radius);
                    const cos = Math.cos(angle), sin = Math.sin(angle);
                    const angVel = evt.angW;
                    this.physics.addParticle({
                        x: evt.spawnX + cos * offset,
                        y: evt.spawnY + sin * offset,
                        vx: evt.spawnVX + (-sin) * angVel * offset,
                        vy: evt.spawnVY + cos * angVel * offset,
                        mass: fragMass, charge: fragCharge, angw: evt.angW,
                        inheritClockFrom: evt.particleIdx,
                    });
                }
            } else {
                // The shader already took the transferred mass and charge from the donor.
                this.physics.addParticle({
                    x: evt.spawnX, y: evt.spawnY,
                    vx: evt.spawnVX, vy: evt.spawnVY,
                    mass: evt.transferMass, charge: evt.charge,
                    inheritClockFrom: evt.particleIdx,
                });
            }
        }
    }

    _processKugelblitzEvents(sim) {
        const kbEvents = this.physics.consumeKugelblitzEvents();
        for (let i = 0; i < kbEvents.length; i++) {
            const evt = kbEvents[i];
            if (evt.energy < EPSILON) continue;
            const pMag = Math.sqrt(evt.px * evt.px + evt.py * evt.py);
            const mSq = evt.energy * evt.energy - pMag * pMag;
            if (mSq <= EPSILON * EPSILON) continue;
            const mass = Math.sqrt(mSq);
            const bodyRadius = Math.cbrt(mass);
            const inertia = INERTIA_K * mass * bodyRadius * bodyRadius;
            const angw = inertia > EPSILON ? evt.angL / inertia : 0;
            // Proper velocity of the collapsed body: w = P/m
            this.physics.addParticle({
                x: evt.x, y: evt.y, vx: evt.px / mass, vy: evt.py / mass,
                mass, charge: evt.charge, angw,
            });
        }
    }
}
