import Vec2 from './vec2.js';
import { PINCH_DEBOUNCE, DRAG_THRESHOLD, SHOOT_VELOCITY_SCALE } from './config.js';
import { getAntimatterMode } from './ui.js';

export default class InputHandler {
    constructor(canvas, sim) {
        this.canvas = canvas;
        this.sim = sim;

        this.isDragging = false;
        this.dragStart = new Vec2(0, 0);
        this.currentPos = new Vec2(0, 0);
        this.canvasRect = canvas.getBoundingClientRect();

        this.massInput = document.getElementById('massInput');
        this.chargeInput = document.getElementById('chargeInput');
        this.spinInput = document.getElementById('spinInput');

        this.tooltip = createSimTooltip();
        this._screenX = 0;
        this._screenY = 0;

        this._posOut = new Vec2(0, 0);
        this._pinching = false;
        this._wasPinching = false;
        this._lastPinchDist = 0;
        this._lastPinchCenterX = 0;
        this._lastPinchCenterY = 0;
        this._rightButton = false;
        // A8: Throttle findParticleAt — resolve in rAF instead of per-mousemove
        this._hoverPending = false;
        this._hoverE = null;

        // Deferred click: GPU hit tests resolve a frame or two later
        this._pendingClick = null; // { pos: Vec2, rightButton: bool }

        sim.camera.bindWheel(canvas);
        sim.camera.bindMousePan(canvas);
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    }

    _pinchDist(t0, t1) {
        const dx = t0.clientX - t1.clientX;
        const dy = t0.clientY - t1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    getPos(cx, cy) {
        const rect = this.canvasRect;
        const sx = cx - rect.left;
        const sy = cy - rect.top;
        const w = this.sim.camera.screenToWorld(sx, sy);
        this._posOut.set(w.x, w.y);
        return this._posOut;
    }

    _getPosNew(cx, cy) {
        const rect = this.canvasRect;
        const sx = cx - rect.left;
        const sy = cy - rect.top;
        const w = this.sim.camera.screenToWorld(sx, sy);
        return new Vec2(w.x, w.y);
    }

    updateRect() { this.canvasRect = this.canvas.getBoundingClientRect(); }

    // ─── Touch events ───

    onTouchStart(e) {
        e.preventDefault();

        if (e.touches.length === 2) {
            this.isDragging = false;
            this._pinching = true;
            const t0 = e.touches[0], t1 = e.touches[1];
            this._lastPinchDist = this._pinchDist(t0, t1);
            this._lastPinchCenterX = (t0.clientX + t1.clientX) / 2;
            this._lastPinchCenterY = (t0.clientY + t1.clientY) / 2;
            return;
        }

        // Frames are view-only: one finger does nothing there (two still pinch)
        if (e.touches.length === 1 && !this._wasPinching && !this.sim.frames.active) {
            const t = e.touches[0];
            this.isDragging = true;
            this.dragStart = this._getPosNew(t.clientX, t.clientY);
            this.currentPos = this.dragStart.clone();
            this.sim._dirty = true;
        }
    }

    onTouchMove(e) {
        e.preventDefault();

        if (e.touches.length === 2 && this._pinching) {
            const t0 = e.touches[0], t1 = e.touches[1];
            const dist = this._pinchDist(t0, t1);
            const cx = (t0.clientX + t1.clientX) / 2;
            const cy = (t0.clientY + t1.clientY) / 2;
            const sx = cx - this.canvasRect.left;
            const sy = cy - this.canvasRect.top;

            const factor = dist / this._lastPinchDist;
            this.sim.camera.zoomBy(factor, sx, sy);

            this.sim.camera.panBy(cx - this._lastPinchCenterX, cy - this._lastPinchCenterY);

            this._lastPinchDist = dist;
            this._lastPinchCenterX = cx;
            this._lastPinchCenterY = cy;
            return;
        }

        if (e.touches.length === 1 && this.isDragging && !this._pinching) {
            const t = e.touches[0];
            this.currentPos = this._getPosNew(t.clientX, t.clientY);
            this.sim._dirty = true;
        }
    }

    onTouchEnd(e) {
        e.preventDefault();

        if (e.touches.length === 0) {
            if (this._pinching) {
                this._pinching = false;
                this._wasPinching = true;
                // 300ms guard prevents accidental spawn after pinch
                setTimeout(() => { this._wasPinching = false; }, PINCH_DEBOUNCE);
                return;
            }

            if (this.isDragging && !this._wasPinching) {
                this.isDragging = false;
                const t = e.changedTouches[0];
                const endPos = this._getPosNew(t.clientX, t.clientY);
                const isShortTap = this.dragStart.dist(endPos) < DRAG_THRESHOLD;
                const amMode = getAntimatterMode();

                if (isShortTap && this.sim._gpuPhysics) {
                    // Defer the action until the GPU hit test resolves
                    this.sim._gpuPhysics.hitTest(endPos.x, endPos.y);
                    this._pendingClick = { pos: endPos, rightButton: amMode };
                    this.sim._dirty = true;
                    return;
                }

                // Long drag: spawn particle
                this.spawnParticle(endPos, amMode && !this.sim.settings.blackHoleEnabled);
                this.sim._dirty = true;
                return;
            }

            this.isDragging = false;
        } else if (e.touches.length === 1 && this._pinching) {
            // Still in pinch mode; don't start drag from remaining finger
        }
    }

    // ─── Particle deletion ───

    /** Retire a GPU particle; it keeps sourcing signal-delayed forces until its signal clears. */
    _deleteParticle(hit) {
        this.sim._gpuPhysics.removeParticle(hit.index, hit.mass, hit.angVel);
        if (this.sim.selectedIdx === hit.index) this.sim.select(-1);
        this.sim._dirty = true;
        _haptics.trigger('light');
    }

    // ─── Mouse events ───

    onMouseDown(e) {
        const isRight = e.button === 2;
        if (e.button !== 0 && !isRight) return;
        // Frames are view-only: spawning, selecting and deleting act in the lab
        if (this.sim.frames.active) return;

        const pos = this._getPosNew(e.clientX, e.clientY);

        // A right-click on a particle resolves through the deferred hit test in onMouseUp
        this.isDragging = true;
        this._rightButton = isRight;
        this.dragStart = pos;
        this.currentPos = pos.clone();
        this.sim._dirty = true;
    }

    onMouseMove(e) {
        const pos = this.getPos(e.clientX, e.clientY);
        this.currentPos.set(pos.x, pos.y);
        this._screenX = e.clientX;
        this._screenY = e.clientY;

        if (this.isDragging) this.sim._dirty = true;

        // A8: Defer hover search to rAF (120-240Hz mousemove → ~60Hz search)
        if (!this._hoverPending) {
            this._hoverPending = true;
            this._hoverE = e;
            requestAnimationFrame(() => {
                this._hoverPending = false;
                // The tooltip updates when pollGPUHitResult sees the answer; hide the stale one.
                // Hit tests search lab positions, so frames have no hover readout.
                if (this.sim._gpuPhysics && !this.sim.frames.active) {
                    this.sim._gpuPhysics.hitTest(this.currentPos.x, this.currentPos.y);
                }
                this.tooltip.hide();
            });
        } else {
            this._hoverE = e; // Update to latest event for pending rAF
        }
    }

    onMouseUp(e) {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.sim._dirty = true;

        const endPos = this._getPosNew(e.clientX, e.clientY);

        // Short click: select, delete, or spawn, once the GPU hit test resolves
        if (this.dragStart.dist(endPos) < DRAG_THRESHOLD && this.sim._gpuPhysics) {
            this.sim._gpuPhysics.hitTest(endPos.x, endPos.y);
            this._pendingClick = { pos: endPos, rightButton: this._rightButton };
            return;
        }

        // Long drag: spawn
        this.spawnParticle(endPos, this._rightButton && !this.sim.settings.blackHoleEnabled);
    }

    /**
     * Resolve a click that hit a particle. A click of the particle's own kind
     * selects it (left for matter, right for antimatter); the other kind deletes.
     * Black-hole mode has no antimatter: left selects, right deletes.
     */
    _resolveClickHit(hit, rightButton) {
        const bhOn = this.sim.settings.blackHoleEnabled;
        const selects = bhOn ? !rightButton : hit.antimatter === rightButton;
        if (selects) this.sim.select(hit.index);
        else this._deleteParticle(hit);
        this.sim._dirty = true;
    }

    /** Re-run the hover hit test at the cursor for fresh tooltip data. Called every 8th frame. */
    refreshTooltip() {
        if (!this.tooltip.el.classList.contains('visible') || !this.sim._gpuPhysics) return;
        this.sim._gpuPhysics.hitTest(this.currentPos.x, this.currentPos.y);
    }

    /**
     * Poll for a GPU hit test result once per frame. Completes a deferred click
     * (select, delete, or spawn on a miss) or updates the hover tooltip.
     */
    pollGPUHitResult() {
        if (!this.sim._gpuPhysics) return;
        const result = this.sim._gpuPhysics.readHitResult();
        if (result === null) return; // not ready yet

        const pending = this._pendingClick;
        this._pendingClick = null;

        if (result.index >= 0) {
            if (pending) {
                this._resolveClickHit(result, pending.rightButton);
            } else {
                const speed = Math.sqrt(result.velX * result.velX + result.velY * result.velY);
                const spin = (result.angVel * result.radius).toFixed(3);
                this.tooltip.show(this._screenX, this._screenY, `m=${result.mass.toFixed(2)}  q=${result.charge.toFixed(2)}  s=${spin}c  v=${speed.toFixed(3)}c`);
            }
        } else if (pending) {
            this.spawnParticle(pending.pos, pending.rightButton && !this.sim.settings.blackHoleEnabled);
        } else {
            this.tooltip.hide();
        }
    }

    spawnParticle(endPos, antimatter = false) {
        const mass = parseFloat(this.massInput.value);
        const charge = parseFloat(this.chargeInput.value) * (antimatter ? -1 : 1);
        const spin = parseFloat(this.spinInput.value) * (antimatter ? -1 : 1);

        const vx = (this.dragStart.x - endPos.x) * SHOOT_VELOCITY_SCALE;
        const vy = (this.dragStart.y - endPos.y) * SHOOT_VELOCITY_SCALE;
        this.sim.addParticle(this.dragStart.x, this.dragStart.y, vx, vy, { mass, charge, spin, antimatter });
        _haptics.trigger('light');
    }
}
