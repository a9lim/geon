// ─── Frames ───
// The observer the view is drawn for. The lab is the simulation's own frame; every other
// frame re-slices the world lines on its observer's hyperplane (frame-slice.wgsl) and draws
// the result in the observer's coordinates, with the observer at the origin. Frames are
// view-only: spawning, selection and deletion act in the lab.
//
// The lagged view (the default) puts the observer's now far enough in the lab's past that
// the whole visible slice has already been computed; `state.lag` is how far.
import { BOUND_LOOP, TORUS } from './config.js';

export const FRAME_LAB = 0;
export const FRAME_ZMF = 1;
export const FRAME_PARTICLE = 2;
export const FRAME_BOOST = 3;
export const FRAME_COROTATE = 4;
export const FRAME_KEYS = ['lab', 'zmf', 'particle', 'boost', 'corotate'];

export default class Frames {
    constructor(sim) {
        this.sim = sim;
        this.kind = FRAME_LAB;
        this.slot = -1;            // particle frame: the observer
        this.rapidity = 0.6;       // boost frame: speed tanh(rapidity) toward `direction`
        this.direction = 0;        // radians, lab
        this.omega = 0.05;         // co-rotating frame's rate
        this.origin = [0, 0];      // boost and co-rotating frames: reference point (lab)
        this.refT = 0;             // lab time at which `origin` was taken
        this.lookBack = 0;         // the scrubber's extra lag, while paused
        this.state = null;         // the observer as last read back (lag, u, γ, validity)
        this._labCamera = null;
    }

    get active() { return this.kind !== FRAME_LAB; }

    /** Speed of the boost frame. */
    get boostSpeed() { return Math.tanh(this.rapidity); }

    /**
     * Switch frame. Leaving the lab saves its camera and centres on the observer; returning
     * restores it. The particle frame needs a selected particle and returns false without one.
     */
    set(kind) {
        const sim = this.sim;
        if (kind === FRAME_PARTICLE) {
            if (sim.selectedIdx < 0) return false;
            this.slot = sim.selectedIdx;
        }
        if (kind === this.kind && kind !== FRAME_PARTICLE) return true;
        const cam = sim.camera;
        if (!this.active && kind !== FRAME_LAB) {
            this._labCamera = { x: cam.x, y: cam.y, zoom: cam.zoom };
        }
        if (kind === FRAME_BOOST || kind === FRAME_COROTATE) {
            const lab = this._labCamera || { x: cam.x, y: cam.y };
            this.origin = [lab.x, lab.y];
            this.refT = sim._gpuPhysics ? sim._gpuPhysics.simTime : 0;
        }
        const wasActive = this.active;
        this.kind = kind;
        this.state = null;
        this.lookBack = 0;
        if (kind === FRAME_LAB) {
            const lab = this._labCamera;
            if (lab) cam.reset(lab.x, lab.y, cam.zoom);
            this._labCamera = null;
        } else if (!wasActive || kind !== FRAME_PARTICLE) {
            cam.reset(0, 0, cam.zoom);
        }
        sim._dirty = true;
        return true;
    }

    /** Image copies drawn per body: the 3×3 nearest on a torus, else one. */
    get images() {
        const sim = this.sim;
        return sim.boundaryMode === BOUND_LOOP && sim.topology === TORUS ? 9 : 1;
    }

    /** GPUPhysics.sliceFrame() parameters for the current camera, or null in the lab. */
    params() {
        if (!this.active) return null;
        const sim = this.sim;
        const cam = sim.camera;
        const halfW = sim.width / (2 * cam.zoom);
        const halfH = sim.height / (2 * cam.zoom);
        const speed = this.boostSpeed;
        return {
            kind: this.kind,
            slot: this.slot,
            lorentz: sim.settings.relativityEnabled,
            images: this.images,
            boostX: speed * Math.cos(this.direction),
            boostY: speed * Math.sin(this.direction),
            originX: this.origin[0],
            originY: this.origin[1],
            refT: this.refT,
            lookBack: sim.running ? 0 : this.lookBack,
            viewX: cam.x, viewY: cam.y, viewHalfW: halfW, viewHalfH: halfH,
            omega: this.omega,
        };
    }
}
