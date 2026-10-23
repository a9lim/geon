// ─── Cosmology ───
// The scale factor a(t) behind Expansion. The universe is the periodic domain (Expansion
// requires loop topology): homogeneous FRW, a slab of comoving thickness SHEET_THICKNESS
// cut from flat 3D FRW. Geon keeps physical positions on a domain of physical size
// a × the comoving domain (sim.domainW/H). Once per frame GPUPhysics scales every position
// by r = a_new/a_old about the domain's corner and every peculiar momentum by 1/r
// (expansion.wgsl). On a torus, Klein bottle or RP² that map is homogeneous, so it is the
// comoving dynamics exactly: d̈ = (ä/a)d − ∇Φ_pec, with the mean density's own force
// cancelling by symmetry over each body's minimum-image cell.
//
// Schedules give H(a) and a frame's step integrates da/dt = a·H(a) by RK4:
//   friedmann  H² = (8π/3)ρ̄ + H_Λ², ρ̄ the matter, radiation and field energy in the slab
//   desitter   H = H₀ (exponential)
//   matter     H = H₀·(a/a₀)^(−3/2), a ∝ t^(2/3)
//   radiation  H = H₀·(a/a₀)^(−2),   a ∝ t^(1/2)
//   lcdm       H = H₀·√(Ω_m(a/a₀)^(−3) + Ω_Λ), Ω_m = 0.3
// a₀ is the scale factor when Expansion was switched on, and the slider sets H₀ (H_Λ for
// friedmann).
import { SHEET_THICKNESS } from './config.js';

export const SCHEDULE_KEYS = ['friedmann', 'desitter', 'matter', 'radiation', 'lcdm'];
export const LCDM_OMEGA_M = 0.3;
// Single precision: the physical domain is a × comoving, so positions lose a bit per
// doubling; past A_MAX a bound pair of size 1 would be resolved to worse than 1%
export const A_MAX = 1000;
const HISTORY_LEN = 256;
const EIGHT_PI_3 = 8 * Math.PI / 3;

export default class Cosmology {
    constructor() {
        this.schedule = 'friedmann';
        this.h0 = 0;
        this.reset();
    }

    reset() {
        this.a = 1;
        this.H = 0;
        this.aOn = 1;
        this.time = 0;         // lab time since reset
        this.rho = null;       // { m, r, f } physical densities at scale aRho (friedmann)
        this.aRho = 1;
        this.capped = false;
        this.history = [];     // [{ t, a, H }] for the plots, every HISTORY_DT
        this._nextSample = 0;
    }

    /** Expansion switched on: the imposed schedules start from the current a. */
    start() {
        this.aOn = this.a;
        this.capped = false;
        this.H = this.hubble(this.a);
    }

    /**
     * The densities the Friedmann closure sources from, physical, at the current a: matter
     * (rest plus kinetic energy of particles, pions and leptons), radiation (photons plus the
     * escaped background), and the scalar fields. Between readbacks they scale as a⁻³, a⁻⁴
     * and a⁻³ (the fields' true law depends on their state; the next readback corrects it).
     */
    setDensities(m, r, f, aAt = this.a) {
        this.rho = { m, r, f };
        this.aRho = aAt;
    }

    /** ρ̄(a) from the last densities. */
    density(a) {
        if (!this.rho) return 0;
        const s = this.aRho / a;
        const s3 = s * s * s;
        return (this.rho.m + this.rho.f) * s3 + this.rho.r * s3 * s;
    }

    hubble(a) {
        const x = a / this.aOn;
        switch (this.schedule) {
            case 'desitter': return this.h0;
            case 'matter': return this.h0 * Math.pow(x, -1.5);
            case 'radiation': return this.h0 / (x * x);
            case 'lcdm': return this.h0 * Math.sqrt(LCDM_OMEGA_M / (x * x * x) + 1 - LCDM_OMEGA_M);
            default: return Math.sqrt(EIGHT_PI_3 * this.density(a) + this.h0 * this.h0);
        }
    }

    /** Advance a over dt (RK4 on da/dt = aH); returns the frame's ratio a_new/a_old. */
    step(dt) {
        this.time += dt;
        if (this.capped) { this.H = 0; return 1; }
        const f = (a) => a * this.hubble(a);
        const a0 = this.a;
        const k1 = f(a0);
        const k2 = f(a0 + 0.5 * dt * k1);
        const k3 = f(a0 + 0.5 * dt * k2);
        const k4 = f(a0 + dt * k3);
        let a1 = a0 + dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
        if (!(a1 > 0)) a1 = a0;
        if (a1 >= A_MAX) { a1 = A_MAX; this.capped = true; }
        this.a = a1;
        this.H = this.capped ? 0 : this.hubble(a1);
        if (this.time >= this._nextSample) {
            this.history.push({ t: this.time, a: a1, H: this.H });
            if (this.history.length > HISTORY_LEN) this.history.shift();
            this._nextSample = this.time + Math.max(0.25, this.time / HISTORY_LEN);
        }
        return a1 / a0;
    }

    /** Stopped: H = 0 and a stays. */
    stop() { this.H = 0; }

    /** The Hubble radius c/H, physical (Infinity when static). */
    get hubbleRadius() { return this.H > 0 ? 1 / this.H : Infinity; }

    /**
     * The event horizon, physical: d_E = a∫_a^∞ da′/(a′²H(a′)), assuming the schedule (or
     * the closure's current contents) holds forever. Finite only if H stays bounded away
     * from 0, i.e. with Λ: de Sitter gives 1/H₀. Infinity for decelerating schedules.
     */
    eventHorizon() {
        if (this.H <= 0) return Infinity;
        const a = this.a;
        // The tail: H → H_∞ (the vacuum part) for large a
        let hInf;
        switch (this.schedule) {
            case 'desitter': hInf = this.h0; break;
            case 'lcdm': hInf = this.h0 * Math.sqrt(1 - LCDM_OMEGA_M); break;
            case 'friedmann': hInf = this.h0; break;
            default: hInf = 0;
        }
        if (!(hInf > 0)) return Infinity;
        // ∫_a^∞ da′/(a′²H) with u = ln a′: ∫ e^{−u}/H du, Simpson over a decade-span grid
        const n = 400, uMax = Math.log(a) + 30;
        const u0 = Math.log(a), du = (uMax - u0) / n;
        let sum = 0;
        for (let i = 0; i <= n; i++) {
            const u = u0 + i * du, ap = Math.exp(u);
            const g = 1 / (ap * this.hubble(ap));
            sum += g * (i === 0 || i === n ? 1 : (i % 2 ? 4 : 2));
        }
        return a * sum * du / 3;
    }
}

/** The slab's physical volume: a³ × comoving area × comoving thickness. */
export function slabVolume(a, comovingW, comovingH) {
    return a * a * a * comovingW * comovingH * SHEET_THICKNESS;
}
