// ─── Pion ───
// Massive force carrier for the Yukawa potential.
// Unlike Photon (massless, |v|=c), pions travel at v<c with proper velocity w.

import Vec2 from './vec2.js';
import { BH_THETA, BOSON_SOFTENING_SQ, EPSILON } from './config.js';

let _piStack = new Int32Array(256);

export default class Pion {
    constructor(x, y, wx, wy, mass, charge, energy, emitterId = -1) {
        this.pos = new Vec2(x, y);
        this.w = new Vec2(wx, wy);
        this.vel = new Vec2(0, 0);
        this.mass = mass;
        this.charge = charge;   // +1, -1, or 0
        this.energy = energy;
        this.lifetime = 0;
        this.alive = true;
        this.emitterId = emitterId;
        this.age = 0;
        this._syncVel();
    }

    _syncVel() {
        const wSq = this.w.x * this.w.x + this.w.y * this.w.y;
        const invG = 1 / Math.sqrt(1 + wSq);
        this.vel.x = this.w.x * invG;
        this.vel.y = this.w.y * invG;
    }

    update(dt, particles, pool, root) {
        // Gravitational deflection: massive particle gets (1+v²) factor, not 2
        const vSq = this.vel.x * this.vel.x + this.vel.y * this.vel.y;
        const grFactor = 1 + vSq;
        if (pool && root >= 0) {
            this._treeDeflect(dt, pool, root, grFactor);
        } else if (particles) {
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                const dx = p.pos.x - this.pos.x;
                const dy = p.pos.y - this.pos.y;
                const rSq = dx * dx + dy * dy + BOSON_SOFTENING_SQ;
                const invR3 = 1 / (rSq * Math.sqrt(rSq));
                this.w.x += grFactor * p.mass * dx * invR3 * dt;
                this.w.y += grFactor * p.mass * dy * invR3 * dt;
            }
        }

        this._syncVel();
        this.pos.x += this.vel.x * dt;
        this.pos.y += this.vel.y * dt;
        this.lifetime += dt;
        this.age++;
    }

    /** Emit decay products into sim. pi0 -> 2 photons, pi+/- -> 1 photon. */
    decay(sim) {
        if (!sim || this.energy <= 0) return;
        const Photon = sim._PhotonClass;
        if (!Photon) return;
        const n = this.charge === 0 ? 2 : 1;
        const ePerPh = this.energy / n;
        for (let i = 0; i < n; i++) {
            const angle = this.charge === 0
                ? Math.atan2(this.vel.y, this.vel.x) + (i === 0 ? Math.PI / 2 : -Math.PI / 2)
                : Math.atan2(this.vel.y, this.vel.x);
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            const ph = new Photon(
                this.pos.x + cosA * 2, this.pos.y + sinA * 2,
                cosA, sinA, ePerPh, -1
            );
            sim.photons.push(ph);
            sim.totalRadiated += ePerPh;
            sim.totalRadiatedPx += ePerPh * cosA;
            sim.totalRadiatedPy += ePerPh * sinA;
        }
        this.alive = false;
    }

    _treeDeflect(dt, pool, rootIdx, grFactor) {
        const thetaSq = BH_THETA * BH_THETA;
        const px = this.pos.x, py = this.pos.y;
        let stackTop = 0;
        if (_piStack.length < pool.maxNodes) _piStack = new Int32Array(pool.maxNodes);
        _piStack[stackTop++] = rootIdx;

        while (stackTop > 0) {
            const nodeIdx = _piStack[--stackTop];
            if (pool.totalMass[nodeIdx] === 0) continue;

            const dx = pool.comX[nodeIdx] - px;
            const dy = pool.comY[nodeIdx] - py;
            const dSq = dx * dx + dy * dy;
            const size = pool.bw[nodeIdx] * 2;

            if (!pool.divided[nodeIdx] && pool.pointCount[nodeIdx] > 0) {
                const base = nodeIdx * pool.nodeCapacity;
                for (let i = 0; i < pool.pointCount[nodeIdx]; i++) {
                    const p = pool.points[base + i];
                    const pdx = p.pos.x - px;
                    const pdy = p.pos.y - py;
                    const rSq = pdx * pdx + pdy * pdy + BOSON_SOFTENING_SQ;
                    const invR3 = 1 / (rSq * Math.sqrt(rSq));
                    this.w.x += grFactor * p.mass * pdx * invR3 * dt;
                    this.w.y += grFactor * p.mass * pdy * invR3 * dt;
                }
            } else if (pool.divided[nodeIdx] && (size * size < thetaSq * dSq)) {
                const rSq = dSq + BOSON_SOFTENING_SQ;
                const invR3 = 1 / (rSq * Math.sqrt(rSq));
                this.w.x += grFactor * pool.totalMass[nodeIdx] * dx * invR3 * dt;
                this.w.y += grFactor * pool.totalMass[nodeIdx] * dy * invR3 * dt;
            } else if (pool.divided[nodeIdx]) {
                _piStack[stackTop++] = pool.nw[nodeIdx];
                _piStack[stackTop++] = pool.ne[nodeIdx];
                _piStack[stackTop++] = pool.sw[nodeIdx];
                _piStack[stackTop++] = pool.se[nodeIdx];
            }
        }
    }
}
