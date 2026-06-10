// ─── Collision Detection & Resolution ───
// Quadtree-accelerated overlap detection with merge resolution.

import { INERTIA_K, COL_MERGE, EPSILON, TORUS, kerrNewmanRadius } from './config.js';
import { minImage } from './topology.js';

const _miOut = { x: 0, y: 0 };

// Pre-allocated return arrays — cleared each call, avoids GC
const _annihilations = [];
const _merges = [];
const _removed = [];
const _spawns = [];
const _collisionResult = { annihilations: _annihilations, merges: _merges, removed: _removed, spawns: _spawns };

/** Relativistic KE: wSq / (gamma + 1) * m. Avoids catastrophic cancellation at low v. */
function _particleKE(p) {
    const wSq = p.w.x * p.w.x + p.w.y * p.w.y;
    return wSq / (Math.sqrt(1 + wSq) + 1) * p.mass;
}

/** Detect overlaps via quadtree query and resolve as merge.
 *  Returns array of annihilation events [{x, y, energy, px, py}] for photon emission. */
export function handleCollisions(particles, pool, root, mode, periodic, domW, domH, topology = TORUS, blackHoleEnabled = false) {
    const halfDomW = domW * 0.5;
    const halfDomH = domH * 0.5;
    _annihilations.length = 0;
    _merges.length = 0;
    _removed.length = 0;
    _spawns.length = 0;
    const annihilations = _annihilations;
    const merges = _merges;
    const spawns = _spawns;
    let capturedAny = false;
    let maxRadius = 0;
    if (blackHoleEnabled) {
        for (let i = 0; i < particles.length; i++) {
            if (particles[i].radius > maxRadius) maxRadius = particles[i].radius;
        }
    }

    for (let ci = 0; ci < particles.length; ci++) {
        const p1 = particles[ci];
        if (p1.mass === 0) continue;

        const searchR = blackHoleEnabled ? p1.radius + maxRadius : p1.radius * 2;
        const candidates = pool.queryReuse(root, p1.pos.x, p1.pos.y, searchR, searchR);

        for (let ck = 0; ck < candidates.length; ck++) {
            const p2 = candidates[ck];
            // Ghosts are periodic images; resolve against the real particle
            const real2 = p2.isGhost ? p2.original : p2;
            if (p1 === real2 || real2.mass === 0 || p1.id >= real2.id) continue;

            let dx, dy;
            if (periodic) {
                minImage(p1.pos.x, p1.pos.y, p2.pos.x, p2.pos.y, topology, domW, domH, halfDomW, halfDomH, _miOut);
                dx = _miOut.x; dy = _miOut.y;
            } else {
                dx = p2.pos.x - p1.pos.x; dy = p2.pos.y - p1.pos.y;
            }
            const distSq = dx * dx + dy * dy;
            const minDist = p1.radius + real2.radius;

            if (blackHoleEnabled && mode === COL_MERGE) {
                const p1Captures = distSq < p1.radiusSq;
                const p2Captures = distSq < real2.radiusSq;
                if (p1Captures || p2Captures) {
                    let captor, victim, victimDx, victimDy;
                    if (p1Captures && (!p2Captures || p1.mass >= real2.mass)) {
                        captor = p1; victim = real2; victimDx = dx; victimDy = dy;
                    } else {
                        captor = real2; victim = p1; victimDx = -dx; victimDy = -dy;
                    }
                    resolveHorizonCapture(captor, victim, victimDx, victimDy);
                    capturedAny = true;
                    if (p1.mass === 0) break;
                    continue;
                }
            }

            if (distSq < minDist * minDist) {
                // Annihilation: matter + antimatter -> energy
                if (p1.antimatter !== real2.antimatter && mode === COL_MERGE) {
                    const annihilated = Math.min(p1.mass, real2.mass);
                    const cx = p1.pos.x + dx * 0.5;
                    const cy = p1.pos.y + dy * 0.5;
                    // Total momentum of annihilating mass
                    const apx = (p1.w.x + real2.w.x) * annihilated;
                    const apy = (p1.w.y + real2.w.y) * annihilated;
                    const fraction1 = annihilated / p1.mass;
                    const fraction2 = annihilated / real2.mass;
                    const keAnnihilated = fraction1 * _particleKE(p1) + fraction2 * _particleKE(real2);
                    annihilations.push({ x: cx, y: cy, energy: 2 * annihilated + keAnnihilated, px: apx, py: apy });
                    const origM1 = p1.mass, origM2 = real2.mass;
                    // Save pre-annihilation mass for signal delay retirement
                    p1._deathMass = origM1;
                    real2._deathMass = origM2;
                    p1.mass -= annihilated;
                    real2.mass -= annihilated;
                    if (origM1 > 0) p1.baseMass *= p1.mass / origM1;
                    if (origM2 > 0) real2.baseMass *= real2.mass / origM2;
                    p1.updateColor();
                    real2.updateColor();
                } else if (mode === COL_MERGE) {
                    // Compute KE before merge for field excitation energy (relativistic)
                    const keBefore = _particleKE(p1) + _particleKE(real2);
                    // Save pre-merge mass for signal delay retirement (both particles die)
                    p1._deathMass = p1.mass;
                    real2._deathMass = real2.mass;
                    const spawn = resolveMerge(p1, real2, dx, dy);
                    const keLost = Math.max(0, keBefore - spawn.ke);
                    if (keLost > 0) merges.push({ x: spawn.x, y: spawn.y, energy: keLost });
                    spawns.push(spawn);
                }
            }
        }
    }

    const removed = _removed;
    if (mode === COL_MERGE && (annihilations.length > 0 || spawns.length > 0 || capturedAny)) {
        let write = 0;
        for (let read = 0; read < particles.length; read++) {
            if (particles[read].mass !== 0) {
                particles[write++] = particles[read];
            } else {
                removed.push(particles[read]);
            }
        }
        particles.length = write;
    }

    return _collisionResult;
}

/** Swallow a particle whose center crossed another particle's horizon. */
function resolveHorizonCapture(captor, victim, victimDx, victimDy) {
    if (captor === victim || captor.mass <= EPSILON || victim.mass <= EPSILON) return;

    const eCaptor = captor.mass * Math.sqrt(1 + captor.w.x * captor.w.x + captor.w.y * captor.w.y);
    const eVictim = victim.mass * Math.sqrt(1 + victim.w.x * victim.w.x + victim.w.y * victim.w.y);
    const px = captor.mass * captor.w.x + victim.mass * victim.w.x;
    const py = captor.mass * captor.w.y + victim.mass * victim.w.y;
    const energy = eCaptor + eVictim;
    const massSq = energy * energy - px * px - py * py;
    if (!(massSq > EPSILON)) return;

    const newMass = Math.sqrt(massSq);
    const newWx = px / newMass;
    const newWy = py / newMass;
    const lOrb = victimDx * (victim.mass * victim.w.y) - victimDy * (victim.mass * victim.w.x);
    const lSpin = INERTIA_K * captor.mass * captor.bodyRadiusSq * captor.angw
        + INERTIA_K * victim.mass * victim.bodyRadiusSq * victim.angw;
    const newBodyR = Math.cbrt(newMass);
    const newBodyRSq = newBodyR * newBodyR;
    const newI = INERTIA_K * newMass * newBodyRSq;
    const newAngw = newI > EPSILON ? (lOrb + lSpin) / newI : 0;

    victim._deathMass = victim.mass;
    captor.mass = newMass;
    captor.baseMass += victim.baseMass;
    captor.charge += victim.charge;
    captor.antimatter = false;
    captor.w.x = newWx;
    captor.w.y = newWy;
    const invGamma = 1 / Math.sqrt(1 + newWx * newWx + newWy * newWy);
    captor.vel.x = newWx * invGamma;
    captor.vel.y = newWy * invGamma;
    captor.angw = newAngw;
    captor.angVel = newAngw / Math.sqrt(1 + newAngw * newAngw * newBodyRSq);
    captor.bodyRadiusSq = newBodyRSq;
    captor.radius = kerrNewmanRadius(newMass, newBodyRSq, captor.angVel, captor.charge);
    captor.radiusSq = captor.radius * captor.radius;
    captor.invMass = 1 / newMass;
    captor.updateColor();

    victim.mass = 0;
    victim.baseMass = 0;
}

/** Compute merged state from p1+p2, kill both, return spawn data for new particle. */
function resolveMerge(p1, p2, miDx, miDy) {
    const totalMass = p1.mass + p2.mass;
    const newWx = (p1.mass * p1.w.x + p2.mass * p2.w.x) / totalMass;
    const newWy = (p1.mass * p1.w.y + p2.mass * p2.w.y) / totalMass;
    // Use minimum-image offset so periodic p2 position is relative to p1
    const p2miX = p1.pos.x + miDx;
    const p2miY = p1.pos.y + miDy;
    const newX = (p1.pos.x * p1.mass + p2miX * p2.mass) / totalMass;
    const newY = (p1.pos.y * p1.mass + p2miY * p2.mass) / totalMass;

    // Orbital L about merged COM + spin L -> new spin
    const dx1 = p1.pos.x - newX, dy1 = p1.pos.y - newY;
    const dx2 = p2miX - newX, dy2 = p2miY - newY;
    const Lorb = dx1 * (p1.mass * p1.w.y) - dy1 * (p1.mass * p1.w.x)
        + dx2 * (p2.mass * p2.w.y) - dy2 * (p2.mass * p2.w.x);
    const Lspin = INERTIA_K * p1.mass * p1.bodyRadiusSq * p1.angw
        + INERTIA_K * p2.mass * p2.bodyRadiusSq * p2.angw;

    const newRadius = Math.cbrt(totalMass);
    const newI = INERTIA_K * totalMass * newRadius * newRadius;
    const newAngw = newI > EPSILON ? (Lorb + Lspin) / newI : 0;
    const newBaseMass = p1.baseMass + p2.baseMass;
    const newCharge = p1.charge + p2.charge;
    const newAntimatter = p1.antimatter;

    // Compute KE of merged particle for excitation energy accounting
    const wSq = newWx * newWx + newWy * newWy;
    const ke = wSq / (Math.sqrt(1 + wSq) + 1) * totalMass;

    // Kill both originals
    p1.mass = 0;
    p2.mass = 0;
    p1.baseMass = 0;
    p2.baseMass = 0;

    return {
        x: newX, y: newY,
        wx: newWx, wy: newWy,
        mass: totalMass,
        baseMass: newBaseMass,
        charge: newCharge,
        antimatter: newAntimatter,
        angw: newAngw,
        ke,
    };
}
