// ─── The spacetime view ───
// The canvas tilts from the plane into the world lines it shows. An orbit camera sits over
// the 2D camera (sim.camera): elevation el (π/2 looks straight down the time axis, which is
// the plane view) and azimuth az about the view's centre. A point (x, y) on the present
// plane, h before it in time (h ≤ 0), lands on screen at
//   X1 = (x − cx)·cos az − (y − cy)·sin az
//   Y1 = (x − cx)·sin az + (y − cy)·cos az
//   sx = W/2 + k·z·X1
//   sy = H/2 + k·z·(Y1·sin el − h·cos el) − lift
// with z the camera's zoom, k the fit that keeps the plane and its past on screen together,
// and lift the shift that centres that stack. Time and space share one scale, so light
// keeps to 45°. At el = π/2, az = 0 this is the 2D camera exactly, so the two views never
// disagree; the plane view is the spacetime view seen from straight above.
import { WORLDLINE_LEN, WORLDLINE_DT } from './config.js';

export const EL_PLANE = Math.PI / 2;
export const EL_SPACETIME = 0.52;      // about 30° above the plane
export const AZ_SPACETIME = -0.55;
const EL_MIN = 0.16;
const DEPTH_FRACTION = 1.2;            // time shown below the plane, per visible plane height
const HISTORY = WORLDLINE_LEN * WORLDLINE_DT - 1;  // the world lines' recorded reach
const EASE_RATE = 2.4;                 // per second, for the eased view changes

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export default class SpacetimeView {
    constructor(sim) {
        this.sim = sim;
        this.el = EL_PLANE;
        this.az = 0;
        this._to = null;          // { el, az } while easing
        this.onChange = null;     // called when the view switches between plane and spacetime
        this._wasTilted = false;
    }

    /** 0 in the plane view, 1 once tilted to the spacetime elevation or below. */
    get tilt() { return clamp(Math.cos(this.el) / Math.cos(EL_SPACETIME), 0, 1); }

    /** True while any part of the time axis shows. */
    get tilted() { return this.el < EL_PLANE - 1e-4; }

    /** Time shown below the plane, in time units (light runs one unit of space per unit). */
    depth() {
        const cam = this.sim.camera;
        return Math.min(DEPTH_FRACTION * cam.viewportH / cam.zoom, HISTORY);
    }

    /** The current projection: everything toScreen and the GPU matrix need. */
    frame() {
        const cam = this.sim.camera;
        const W = cam.viewportW, H = cam.viewportH;
        const se = Math.sin(this.el), ce = Math.cos(this.el);
        const D = this.depth();
        // The plane's visible height foreshortens to H·se (up to √2 more once turned, a square's
        // diagonal) and its past adds D·z·ce: fit both in H. Turning alone never rescales.
        const tilt = clamp(ce / Math.cos(EL_SPACETIME), 0, 1);
        const k = 1 / (se * (1 + (Math.SQRT2 - 1) * tilt) + ce * D * cam.zoom / H);
        const kz = k * cam.zoom;
        return {
            W, H, cx: cam.x, cy: cam.y, kz, se, ce,
            ca: Math.cos(this.az), sa: Math.sin(this.az),
            lift: kz * D * ce / 2, depth: D,
        };
    }

    /** Screen px of world (x, y) at time h before the present. */
    toScreen(x, y, h = 0, f = this.frame()) {
        const X = x - f.cx, Y = y - f.cy;
        const X1 = X * f.ca - Y * f.sa, Y1 = X * f.sa + Y * f.ca;
        return { x: f.W / 2 + f.kz * X1, y: f.H / 2 + f.kz * (Y1 * f.se - h * f.ce) - f.lift };
    }

    /** The point on the present plane under screen px (sx, sy). */
    fromScreen(sx, sy, f = this.frame()) {
        const X1 = (sx - f.W / 2) / f.kz;
        const Y1 = (sy - f.H / 2 + f.lift) / (f.kz * f.se);
        return { x: f.cx + X1 * f.ca + Y1 * f.sa, y: f.cy - X1 * f.sa + Y1 * f.ca };
    }

    /**
     * Write the view matrix (world (x, y, h) → clip, depth 0) and the plane's inverse
     * (clip → world on the plane) into a Float32Array at 0 and 16, column-major, as the
     * renderer's CameraUniforms expect.
     */
    writeMatrices(m, f = this.frame()) {
        const a00 = 2 * f.kz * f.ca / f.W, a01 = -2 * f.kz * f.sa / f.W;
        const a10 = -2 * f.kz * f.sa * f.se / f.H, a11 = -2 * f.kz * f.ca * f.se / f.H;
        const a12 = 2 * f.kz * f.ce / f.H;
        const tx = -(a00 * f.cx + a01 * f.cy);
        const ty = -(a10 * f.cx + a11 * f.cy) + 2 * f.lift / f.H;
        m[0] = a00; m[1] = a10; m[2] = 0; m[3] = 0;
        m[4] = a01; m[5] = a11; m[6] = 0; m[7] = 0;
        m[8] = 0;   m[9] = a12; m[10] = 0; m[11] = 0;
        m[12] = tx; m[13] = ty; m[14] = 0; m[15] = 1;
        const det = a00 * a11 - a01 * a10;
        const i00 = a11 / det, i01 = -a01 / det, i10 = -a10 / det, i11 = a00 / det;
        m[16] = i00; m[17] = i10; m[18] = 0; m[19] = 0;
        m[20] = i01; m[21] = i11; m[22] = 0; m[23] = 0;
        m[24] = 0;   m[25] = 0;   m[26] = 1; m[27] = 0;
        m[28] = -(i00 * tx + i01 * ty); m[29] = -(i10 * tx + i11 * ty); m[30] = 0; m[31] = 1;
    }

    /** Ease to the plane view (straight down the time axis). */
    toPlane() {
        const quarter = Math.PI / 2;
        this._to = { el: EL_PLANE, az: Math.round(this.az / quarter) * quarter };
        this._kick();
    }

    /** Ease to the spacetime view, keeping a turn the user already gave it. */
    toSpacetime() {
        this._to = { el: EL_SPACETIME, az: Math.abs(this.az) < 0.1 ? AZ_SPACETIME : this.az };
        this._kick();
    }

    /** Jump without easing (reduced motion, saves). */
    set(el, az) {
        this._to = null;
        this.el = clamp(el, EL_MIN, EL_PLANE);
        this.az = az;
        this._changed();
    }

    /** Turn and tilt by a pointer drag of (dx, dy) px. */
    orbitBy(dx, dy) {
        this._to = null;
        this.az += dx * 0.008;
        this.el = clamp(this.el - dy * 0.006, EL_MIN, EL_PLANE);
        this._changed();
    }

    /** Advance the easing by dt seconds; returns true while the view is still moving. */
    step(dt) {
        if (!this._to) return false;
        const k = 1 - Math.exp(-EASE_RATE * dt);
        this.el += (this._to.el - this.el) * k;
        this.az += (this._to.az - this.az) * k;
        if (Math.abs(this._to.el - this.el) < 1e-3 && Math.abs(this._to.az - this.az) < 1e-3) {
            this.el = this._to.el;
            this.az = this._to.az;
            this._to = null;
        }
        this._changed();
        return true;
    }

    get easing() { return !!this._to; }

    _kick() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.set(this._to.el, this._to.az);
        }
        this.sim._dirty = true;
    }

    _changed() {
        this.sim._dirty = true;
        const tilted = this.tilted;
        if (tilted !== this._wasTilted) {
            this._wasTilted = tilted;
            if (this.onChange) this.onChange(tilted);
        }
    }

    /**
     * Route the 2D camera's screen mapping through this view, so picking, spawning, panning
     * and zooming land on the plane as drawn. The plane view is unchanged.
     */
    wrapCamera(cam) {
        const view = this;
        const base = {
            screenToWorld: cam.screenToWorld,
            worldToScreen: cam.worldToScreen,
            panBy: cam.panBy,
            applyZoom: cam._applyZoom,
        };
        cam.screenToWorld = function (sx, sy) {
            return view.tilted || view.az !== 0 ? view.fromScreen(sx, sy) : base.screenToWorld.call(this, sx, sy);
        };
        cam.worldToScreen = function (wx, wy) {
            return view.tilted || view.az !== 0 ? view.toScreen(wx, wy, 0) : base.worldToScreen.call(this, wx, wy);
        };
        cam.panBy = function (dx, dy) {
            if (!view.tilted && view.az === 0) return base.panBy.call(this, dx, dy);
            const f = view.frame();
            const X1 = dx / f.kz, Y1 = dy / (f.kz * f.se);
            this.x -= X1 * f.ca + Y1 * f.sa;
            this.y -= -X1 * f.sa + Y1 * f.ca;
            if (this.clampFn) this.clampFn(this);
            this._notify();
        };
        cam._applyZoom = function (newZoom, cx, cy) {
            if (!view.tilted && view.az === 0) return base.applyZoom.call(this, newZoom, cx, cy);
            newZoom = clamp(newZoom, this.minZoom, this.maxZoom);
            if (newZoom === this.zoom) return;
            if (cx === undefined) cx = this.viewportW / 2;
            if (cy === undefined) cy = this.viewportH / 2;
            const before = view.fromScreen(cx, cy);
            this.zoom = newZoom;
            const after = view.fromScreen(cx, cy);
            this.x += before.x - after.x;
            this.y += before.y - after.y;
            if (this.clampFn) this.clampFn(this);
            this._notify();
        };
    }
}
