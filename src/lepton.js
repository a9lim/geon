// ─── Lepton ───
// Massive charged lepton (electron/positron) for the particle physics simulation.
// Like Pion: proper velocity w, mass, charge, participates in boson tree.
// Unlike Pion: stable (no decay), rendered as blue circle.

import Vec2 from './vec2.js';
import { BOSON_SOFTENING_SQ, ELECTRON_MASS, MAX_SPEED_RATIO, EPSILON, MAX_LEPTONS } from './config.js';
import { treeDeflectBoson, treeDeflectBosonCoulomb } from './boson-utils.js';

// ─── Object Pool ───
const _pool = [];
let _poolSize = 0;

export default class Lepton {
    constructor(x, y, wx, wy, charge, emitterId = -1) {
        this.pos = new Vec2(x, y);
        this.w = new Vec2(wx, wy);
        this.vel = new Vec2(0, 0);
        this.mass = ELECTRON_MASS;
        this.charge = charge;       // -1 (electron) or +1 (positron)
        this.vSq = 0;
        this.gravMass = 0;
        this._srcMass = 0;
        this._srcCharge = charge;
        this._kind = 2;             // 0=photon, 1=pion, 2=lepton
        this.lifetime = 0;
        this.alive = true;
        this.emitterId = emitterId;
        this.age = 0;
        this._syncVel();
    }

    _reset(x, y, wx, wy, charge, emitterId) {
        this.pos.x = x; this.pos.y = y;
        this.w.x = wx; this.w.y = wy;
        this.mass = ELECTRON_MASS;
        this.charge = charge;
        this._srcCharge = charge;
        this._kind = 2;
        this.lifetime = 0;
        this.alive = true;
        this.emitterId = emitterId;
        this.age = 0;
        this._syncVel();
    }

    static acquire(x, y, wx, wy, charge, emitterId = -1) {
        if (_poolSize > 0) {
            const l = _pool[--_poolSize];
            l._reset(x, y, wx, wy, charge, emitterId);
            return l;
        }
        return new Lepton(x, y, wx, wy, charge, emitterId);
    }

    static release(l) {
        if (_poolSize < MAX_LEPTONS) _pool[_poolSize++] = l;
    }

    _syncVel() {
        const wSq = this.w.x * this.w.x + this.w.y * this.w.y;
        const gamma = Math.sqrt(1 + wSq);
        const invG = 1 / gamma;
        this.vel.x = this.w.x * invG;
        this.vel.y = this.w.y * invG;
        this.vSq = this.vel.x * this.vel.x + this.vel.y * this.vel.y;
        this.gravMass = this.mass * gamma;
        this._srcMass = this.gravMass;
    }

    update(dt, particles, pool, root, gravLensing, coulombEnabled, periodic, topology, domW, domH, halfDomW, halfDomH) {
        // Gravitational deflection: massive particle gets (1+v²) factor
        if (gravLensing) {
            const grFactor = 1 + this.vSq;
            if (pool && root >= 0) {
                treeDeflectBoson(this.pos, this.w, grFactor * dt, pool, root, periodic, topology, domW, domH, halfDomW, halfDomH);
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
        }

        // Coulomb deflection: F = -q_lepton * q_particle / r²
        if (coulombEnabled && this.charge !== 0 && particles) {
            const scale = -this.charge * dt;
            if (pool && root >= 0) {
                treeDeflectBosonCoulomb(this.pos, this.w, scale, pool, root, periodic, topology, domW, domH, halfDomW, halfDomH);
            } else {
                for (let i = 0; i < particles.length; i++) {
                    const p = particles[i];
                    if (p.charge === 0) continue;
                    const dx = p.pos.x - this.pos.x;
                    const dy = p.pos.y - this.pos.y;
                    const rSq = dx * dx + dy * dy + BOSON_SOFTENING_SQ;
                    const invR3 = 1 / (rSq * Math.sqrt(rSq));
                    this.w.x += scale * p.charge * dx * invR3;
                    this.w.y += scale * p.charge * dy * invR3;
                }
            }
        }

        this._syncVel();
        this.pos.x += this.vel.x * dt;
        this.pos.y += this.vel.y * dt;
        this.lifetime += dt;
        this.age++;
    }
}
