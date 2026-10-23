// ─── Overlay ───
// The 2D canvas above the WebGPU canvas: the domain's edge as a hairline rule, and the
// spawn-drag line.
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
        this._edgeColor = isLight ? _r(_PAL.light.text, 0.12) : _r(_PAL.dark.text, 0.13);
        this._removeDragColor = isLight ? _r(_PAL.light.textMuted, 0.6) : _r(_PAL.dark.textMuted, 0.7);
    }

    /** Clear the canvas, then draw the domain edge and the drag line, if one is in progress. */
    draw(camera, input, domainW, domainH) {
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        const z = camera.zoom;
        ctx.setTransform(z, 0, 0, z, this.width / 2 - camera.x * z, this.height / 2 - camera.y * z);
        ctx.strokeStyle = this._edgeColor;
        ctx.lineWidth = 1 / z;
        ctx.strokeRect(0, 0, domainW, domainH);
        if (!input || !input.isDragging) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            return;
        }
        ctx.beginPath();
        ctx.moveTo(input.dragStart.x, input.dragStart.y);
        ctx.lineTo(input.currentPos.x, input.currentPos.y);
        ctx.strokeStyle = input._rightButton ? this._removeDragColor : this._dragColor;
        ctx.lineWidth = 1 / z;
        ctx.stroke();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
}
