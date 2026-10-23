// ─── Overlay ───
// The 2D canvas above the WebGPU canvas: the spawn-drag line, and in an expanding universe
// the Hubble radius and event horizon around the observer. (The domain's edge is part of
// the background grid, grid-render.wgsl, so it follows frames.)
const _PAL = window._PALETTE;
const _r = window._r;

export default class Overlay {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;
        this.isLight = true;
        this.setTheme(true);
    }

    resize(width, height) {
        this.width = width;
        this.height = height;
    }

    setTheme(isLight) {
        this.isLight = isLight;
        this._dragColor = isLight ? _r(_PAL.light.text, 0.4) : _r(_PAL.dark.text, 0.5);
        this._removeDragColor = isLight ? _r(_PAL.light.textMuted, 0.6) : _r(_PAL.dark.textMuted, 0.7);
        this._horizonColor = isLight ? _r(_PAL.light.accent, 0.5) : _r(_PAL.dark.accent, 0.55);
        this._labelColor = isLight ? _PAL.light.textMuted : _PAL.dark.textMuted;
    }

    /**
     * Clear the canvas, then draw the horizons (`horizons`: { center, hubble, event, labels },
     * physical lengths) and the drag line, if one is in progress.
     */
    draw(camera, input, horizons = null) {
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        if (horizons) this._drawHorizons(camera, horizons);
        if (!input || !input.isDragging) return;
        const z = camera.zoom;
        ctx.setTransform(z, 0, 0, z, this.width / 2 - camera.x * z, this.height / 2 - camera.y * z);
        ctx.beginPath();
        ctx.moveTo(input.dragStart.x, input.dragStart.y);
        ctx.lineTo(input.currentPos.x, input.currentPos.y);
        ctx.strokeStyle = input._rightButton ? this._removeDragColor : this._dragColor;
        ctx.lineWidth = 1 / z;
        ctx.stroke();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /** Dashed circles in screen space: c/H, and the event horizon when it is finite. */
    _drawHorizons(camera, hz) {
        const ctx = this.ctx;
        const z = camera.zoom;
        const cx = this.width / 2 + (hz.center[0] - camera.x) * z;
        const cy = this.height / 2 + (hz.center[1] - camera.y) * z;
        const maxR = 4 * Math.hypot(this.width, this.height);
        ctx.lineWidth = 1;
        ctx.font = `italic 11px ${_FONT.text}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const circle = (r, dash, label) => {
            const rs = r * z;
            if (!isFinite(rs) || rs < 4 || rs > maxR) return;
            ctx.strokeStyle = this._horizonColor;
            ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.arc(cx, cy, rs, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = this._labelColor;
            ctx.fillText(label, cx, cy - rs - 3);
        };
        circle(hz.hubble, [4, 4], hz.hubbleLabel);
        if (Math.abs(hz.event - hz.hubble) > 0.02 * hz.hubble) circle(hz.event, [1, 3], hz.eventLabel);
    }
}
