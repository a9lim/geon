/**
 * CPU backend adapter.
 *
 * Owns the CPU-only simulation step and Canvas renderer path so main.js can
 * delegate through the same backend surface used by the GPU runtime.
 */
import {
    TWO_PI, PHOTON_LIFETIME, LEPTON_LIFETIME,
    PION_DECAY_PROB, CHARGED_PION_DECAY_PROB,
    PHYSICS_DT, MIN_MASS,
    SOFTENING_SQ, BH_SOFTENING_SQ, MAX_SPEED_RATIO, SPAWN_COUNT,
    spawnOffset, HEATMAP_INTERVAL_MASK, SIDEBAR_THROTTLE_MASK,
    MAX_PARTICLES, BOSON_CHARGE, ELECTRON_MASS, MAX_LEPTONS,
} from './config.js';
import MasslessBoson from './massless-boson.js';
import Pion from './pion.js';
import Lepton from './lepton.js';

export default class CPUPhysics {
    constructor(engine = null) {
        this.engine = engine;
        this.kind = 'cpu';
    }

    canAddParticle(sim) {
        return sim.particles.length < MAX_PARTICLES;
    }

    addParticle() {
        return true;
    }

    reset() {}

    resize() {}

    stepOnce(sim) {
        sim.physics.update(
            sim.particles, PHYSICS_DT, sim.collisionMode, sim.boundaryMode,
            sim.topology, sim.domainW, sim.domainH, 0, 0,
        );
    }

    step(sim) {
        sim.physics._collisionCount = 0;
        while (sim.accumulator >= PHYSICS_DT) {
            this.stepOnce(sim);
            this._updateBosons(sim);
            this._handleDisintegration(sim);
            this._handleEvaporation(sim);
            sim.accumulator -= PHYSICS_DT;
        }
        if (sim.physics._collisionCount > 0) _haptics.trigger('buzz');
        this._collectDeadParticles(sim);
    }

    pollInput() {}

    render(sim) {
        if (sim.running && (++sim._hmFrame & HEATMAP_INTERVAL_MASK) === 0) {
            sim.heatmap.update(
                sim.particles, sim.camera, sim.width, sim.height,
                sim.physics.pool, sim.physics._lastRoot,
                sim.physics.barnesHutEnabled, sim.physics.relativityEnabled,
                sim.physics.simTime, sim.physics.periodic, sim.domainW, sim.domainH,
                sim.topology, sim.physics.blackHoleEnabled ? BH_SOFTENING_SQ : SOFTENING_SQ,
                sim.physics.yukawaEnabled, sim.physics.yukawaMu, sim.deadParticles,
                sim.physics.gravityEnabled, sim.physics.coulombEnabled,
            );
        }
        sim.renderer.render(sim.particles, PHYSICS_DT, sim.camera, sim.photons, sim.pions, sim.leptons);

        const sidebarFrame = !(++sim._sbFrame & SIDEBAR_THROTTLE_MASK);
        if (!sim._particleTabEl) {
            sim._particleTabEl = document.getElementById('tab-particle');
            sim._controlPanelEl = document.getElementById('control-panel');
        }
        const particleTabActive = sim._particleTabEl &&
            sim._particleTabEl.classList.contains('active') &&
            sim._controlPanelEl && sim._controlPanelEl.classList.contains('open');
        if (sidebarFrame && particleTabActive) {
            sim.phasePlot.update(sim.particles, sim.selectedParticle, sim.physics);
            sim.effPotPlot.update(sim.particles, sim.selectedParticle, sim.physics);
            sim.phasePlot.draw(sim.renderer.isLight);
            sim.effPotPlot.draw(sim.renderer.isLight);
        }
        if (sim.running) sim.stats.updateEnergy(sim.particles, sim.physics, sim);
        if (sidebarFrame) {
            const sel = sim.stats.updateSelected(sim.selectedParticle, sim.particles, sim.physics);
            if (!sel && sim.selectedParticle) sim.selectedParticle = null;
        }
    }

    _updateBosons(sim) {
        const bosonInter = sim.physics.bosonInterEnabled;
        const coulomb = sim.physics.coulombEnabled;
        const pool = sim.physics.barnesHutEnabled ? sim.physics.pool : null;
        const root = sim.physics._lastRoot;
        const lensParticles = (bosonInter || coulomb) ? sim.particles : null;
        const periodic = sim.physics.periodic;
        const topo = sim.physics._topologyConst;
        const dw = sim.domainW, dh = sim.domainH;
        const hdw = dw * 0.5, hdh = dh * 0.5;

        let pLen = sim.photons.length;
        for (let i = pLen - 1; i >= 0; i--) {
            const ph = sim.photons[i];
            ph.update(PHYSICS_DT, bosonInter ? lensParticles : null, pool, root, periodic, topo, dw, dh, hdw, hdh);
            if (!ph.alive || ph.lifetime > PHOTON_LIFETIME) {
                ph.alive = false;
                MasslessBoson.release(ph);
                sim.photons[i] = sim.photons[--pLen];
            }
        }
        sim.photons.length = pLen;

        let piLen = sim.pions.length;
        for (let i = piLen - 1; i >= 0; i--) {
            const pn = sim.pions[i];
            pn.update(PHYSICS_DT, lensParticles, pool, root, bosonInter, coulomb, periodic, topo, dw, dh, hdw, hdh);
            if (!pn.alive) {
                Pion.release(pn);
                sim.pions[i] = sim.pions[--piLen];
            } else if (Math.random() < (pn.charge === 0 ? PION_DECAY_PROB : CHARGED_PION_DECAY_PROB)) {
                pn.decay(sim);
                Pion.release(pn);
                sim.pions[i] = sim.pions[--piLen];
            }
        }
        sim.pions.length = piLen;

        let lLen = sim.leptons.length;
        for (let i = lLen - 1; i >= 0; i--) {
            const lp = sim.leptons[i];
            lp.update(PHYSICS_DT, lensParticles, pool, root, bosonInter, coulomb, periodic, topo, dw, dh, hdw, hdh);
            if (!lp.alive || lp.lifetime > LEPTON_LIFETIME) {
                lp.alive = false;
                Lepton.release(lp);
                sim.leptons[i] = sim.leptons[--lLen];
            }
        }
        sim.leptons.length = lLen;
    }

    _handleDisintegration(sim) {
        const { fragments: toFragment, transfers: rocheTransfers } =
            sim.physics.checkDisintegration(sim.particles, sim.physics._lastRoot);

        for (let ti = 0; ti < rocheTransfers.length; ti++) {
            const t = rocheTransfers[ti];
            const origM = t.source.mass;
            t.source.mass -= t.mass;
            if (origM > 0) t.source.baseMass *= t.source.mass / origM;
            t.source.charge -= t.charge;
            t.source.updateColor();
            sim.addParticle(t.spawnX, t.spawnY, t.vx, t.vy, {
                mass: t.mass, charge: t.charge, spin: 0, skipBaseline: true,
            });
        }

        if (toFragment.length === 0) return;
        if (!sim._fragSet) sim._fragSet = new Set();
        const fragSet = sim._fragSet;
        fragSet.clear();
        for (let fi = 0; fi < toFragment.length; fi++) fragSet.add(toFragment[fi]);
        for (const p of toFragment) {
            const nf = SPAWN_COUNT;
            const fragMass = p.mass / nf;
            const fragBaseMass = p.baseMass / nf;
            const fragCharge = p.charge / nf;
            for (let fi = 0; fi < nf; fi++) {
                const angle = (TWO_PI * fi) / nf;
                const offset = spawnOffset(p.radius);
                const fx = p.pos.x + Math.cos(angle) * offset;
                const fy = p.pos.y + Math.sin(angle) * offset;
                const tangVx = -Math.sin(angle) * p.angVel * offset;
                const tangVy = Math.cos(angle) * p.angVel * offset;
                sim.addParticle(fx, fy, p.vel.x + tangVx, p.vel.y + tangVy, {
                    mass: fragMass, baseMass: fragBaseMass, charge: fragCharge,
                    spin: p.angw, skipBaseline: true,
                });
            }
        }

        let write = 0;
        for (let ri = 0; ri < sim.particles.length; ri++) {
            if (!fragSet.has(sim.particles[ri])) {
                sim.particles[write++] = sim.particles[ri];
            } else {
                sim.physics._retireParticle(sim.particles[ri]);
            }
        }
        sim.particles.length = write;
    }

    _handleEvaporation(sim) {
        if (!sim.physics.blackHoleEnabled) return;
        let writeIdx = 0;
        for (let i = 0; i < sim.particles.length; i++) {
            const p = sim.particles[i];
            if (p.mass > MIN_MASS) {
                sim.particles[writeIdx++] = p;
                continue;
            }
            if (sim.physics.coulombEnabled && Math.abs(p.charge) >= BOSON_CHARGE - 1e-6) {
                const sign = p.charge > 0 ? 1 : -1;
                const off = spawnOffset(p.radius);
                while (Math.abs(p.charge) >= BOSON_CHARGE - 1e-6 && sim.leptons.length < MAX_LEPTONS) {
                    const angle = Math.random() * TWO_PI;
                    const cosA = Math.cos(angle), sinA = Math.sin(angle);
                    const speed = Math.min(Math.sqrt(ELECTRON_MASS * 3 * ELECTRON_MASS) / (3 * ELECTRON_MASS), MAX_SPEED_RATIO);
                    const gamma = 1 / Math.sqrt(1 - speed * speed);
                    sim.leptons.push(Lepton.acquire(
                        p.pos.x + cosA * off, p.pos.y + sinA * off,
                        gamma * speed * cosA, gamma * speed * sinA,
                        sign * BOSON_CHARGE, p.id,
                    ));
                    p.charge -= sign * BOSON_CHARGE;
                    p.mass -= ELECTRON_MASS;
                }
            }
            const finalE = p._hawkAccum + Math.max(p.mass, 0);
            if (finalE > 0) sim.emitPhotonBurst(p.pos.x, p.pos.y, finalE, p.radius, p.id);
            sim.physics._retireParticle(p);
            if (sim.selectedParticle === p) sim.selectedParticle = null;
        }
        sim.particles.length = writeIdx;
    }

    _collectDeadParticles(sim) {
        if (sim.deadParticles.length === 0) return;
        const maxDist = sim._domainDiagonal;
        let dw = 0;
        for (let i = 0; i < sim.deadParticles.length; i++) {
            const dp = sim.deadParticles[i];
            if (sim.physics.simTime - dp.deathTime < maxDist) {
                sim.deadParticles[dw++] = dp;
            }
        }
        sim.deadParticles.length = dw;
    }
}
