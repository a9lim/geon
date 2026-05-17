/**
 * GPU runtime adapter.
 *
 * Keeps WebGPU-specific stepping, event readback handling, rendering, and
 * particle upload behind the same coarse backend surface used by CPUPhysics.
 */
import {
    TWO_PI, PHYSICS_DT, MAX_SPEED_RATIO, SPAWN_COUNT, spawnOffset,
    GPU_HEATMAP_GRID, STATS_THROTTLE_MASK, INERTIA_K, EPSILON,
} from '../config.js';
import { angwToAngVel } from '../relativity.js';
import GPUPhysics from './gpu-physics.js';
import GPURenderer from './gpu-renderer.js';

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
        await renderer.init();

        const backend = new GPUBackend(device, gpuCanvas, physics, renderer);
        backend.syncFromCPU(sim);
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

    addParticle(sim, p, spawn) {
        const idx = this.physics.addParticle({
            x: spawn.x, y: spawn.y, vx: spawn.vx, vy: spawn.vy,
            mass: p.mass, charge: p.charge, angw: p.angw,
            antimatter: p.antimatter,
        });
        if (idx < 0) return false;
        p._gpuIdx = idx;
        return true;
    }

    reset() {
        this.physics.reset();
    }

    resize(sim) {
        this.canvas.width = sim.width;
        this.canvas.height = sim.height;
        this.renderer.resize(sim.width, sim.height);
        this.renderer.setDomain(sim.domainW, sim.domainH);
        this.physics.domainW = sim.domainW;
        this.physics.domainH = sim.domainH;
    }

    setTheme(isLight) {
        this.renderer.setTheme(isLight);
    }

    syncFromCPU(sim) {
        const gpuToggles = Object.create(sim.physics);
        gpuToggles.heatmapEnabled = sim.heatmap && sim.heatmap.enabled;
        gpuToggles.heatmapMode = sim.heatmap ? sim.heatmap.mode : 'all';
        this.physics.setToggles(gpuToggles);
        this.syncModes(sim);
        if (sim.particles.length > 0 && this.physics.aliveCount === 0) {
            for (const p of sim.particles) {
                p._gpuIdx = this.physics.addParticle({
                    x: p.pos.x, y: p.pos.y,
                    vx: p.w.x, vy: p.w.y,
                    mass: p.mass, charge: p.charge,
                    angw: p.angw,
                    antimatter: p.antimatter,
                });
            }
        }
    }

    syncModes(sim) {
        this.physics.boundaryMode = sim.boundaryMode;
        this.physics.topologyMode = sim.topology;
        this.physics._collisionMode = sim.collisionMode;
    }

    activateFromCPU(sim) {
        this.canvas.style.display = '';
        sim.ctx.clearRect(0, 0, sim.width, sim.height);
        this.physics.setToggles(Object.assign(Object.create(sim.physics), {
            heatmapEnabled: sim.heatmap && sim.heatmap.enabled,
            heatmapMode: sim.heatmap ? sim.heatmap.mode : 'all',
        }));
        this.syncModes(sim);
        this.physics.reset();
        for (const p of sim.particles) {
            p._gpuIdx = this.physics.addParticle({
                x: p.pos.x, y: p.pos.y,
                vx: p.w.x, vy: p.w.y,
                mass: p.mass, charge: p.charge,
                angw: p.angw, antimatter: p.antimatter,
            });
        }
    }

    async snapshotToCPU(sim) {
        const gpuState = await this.physics.serialize(sim);
        sim.particles.length = 0;
        for (const pd of gpuState.particles) {
            sim._restoreParticleFromSaveData(pd);
        }
        return gpuState;
    }

    stepOnce() {
        this.physics.update(PHYSICS_DT);
    }

    step(sim) {
        this.physics.setCamera(sim.camera);
        const substeps = Math.floor(sim.accumulator / PHYSICS_DT);
        if (substeps > 0) {
            this.physics.update(PHYSICS_DT * substeps);
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
        const ph = sim.physics;
        this.renderer.updateCamera(sim.camera);
        this.renderer.showForce = sim.renderer.showForce;
        this.renderer.showForceComponents = sim.renderer.showForceComponents;
        this.renderer.showVelocity = sim.renderer.showVelocity;
        this.renderer.showTrails = sim.renderer.trails;
        this.renderer.setDomain(sim.domainW, sim.domainH);

        this.physics.setTrailsEnabled(sim.renderer.trails);
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

        this.renderer.render(this.physics.aliveCount, renderOpts);
        sim.renderer.drawDragOverlay(sim.camera);
        this._renderStats(sim);
    }

    _renderStats(sim) {
        if (sim.running && !(sim._sbFrame & STATS_THROTTLE_MASK)) {
            const selIdx = sim.selectedParticle ? (sim.selectedParticle._gpuIdx ?? -1) : -1;
            this.physics.requestStats(selIdx);
        }
        sim._sbFrame++;
        const gpuStats = this.physics.readStats();
        if (gpuStats) {
            sim.stats.updateEnergyGPU(gpuStats, sim);
            if (gpuStats.selected) {
                sim.stats.updateSelectedGPU(gpuStats.selected, sim.physics);
            } else if (sim.selectedParticle) {
                sim.stats.updateSelectedGPU(null, sim.physics);
            }
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
                    });
                }
            } else {
                const newMass = evt.mass - evt.transferMass;
                this.physics.patchMassCharge(evt.particleIdx, newMass, newMass, evt.sourceCharge);
                this.physics.addParticle({
                    x: evt.spawnX, y: evt.spawnY,
                    vx: evt.spawnVX, vy: evt.spawnVY,
                    mass: evt.transferMass, charge: evt.charge,
                });
            }
        }
    }

    _processKugelblitzEvents(sim) {
        const kbEvents = this.physics.consumeKugelblitzEvents();
        for (let i = 0; i < kbEvents.length; i++) {
            const evt = kbEvents[i];
            if (evt.energy < EPSILON) continue;
            const mass = evt.energy;
            const pMag = Math.sqrt(evt.px * evt.px + evt.py * evt.py);
            let vx = 0, vy = 0;
            if (pMag > EPSILON) {
                const speed = Math.min(pMag / mass, MAX_SPEED_RATIO);
                vx = evt.px / pMag * speed;
                vy = evt.py / pMag * speed;
            }
            const radius = Math.cbrt(mass);
            const inertia = INERTIA_K * mass * radius * radius;
            const angw = inertia > EPSILON ? evt.angL / inertia : 0;
            sim.addParticle(evt.x, evt.y, vx, vy, {
                mass, baseMass: mass, charge: evt.charge, spin: 0, skipBaseline: true,
            });
            const spawned = sim.particles[sim.particles.length - 1];
            if (spawned) {
                spawned.angw = angw;
                spawned.angVel = sim.physics.relativityEnabled
                    ? angwToAngVel(angw, spawned.radius)
                    : angw;
            }
            sim.totalRadiated -= mass;
            if (sim.totalRadiated < 0) sim.totalRadiated = 0;
        }
    }
}
