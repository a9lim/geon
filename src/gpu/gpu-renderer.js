/**
 * @fileoverview GPURenderer — WebGPU instanced rendering for particles.
 *
 * Phase 1: particles only. Trails, fields, bosons, arrows added later.
 */

export default class GPURenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {GPUDevice} device
     * @param {Object} particleBuffers - from gpu-buffers.js
     */
    constructor(canvas, device, particleBuffers) {
        this.canvas = canvas;
        this.device = device;
        this.buffers = particleBuffers;

        this.context = canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device,
            format: this.format,
            alphaMode: 'premultiplied',
        });

        // Camera state (updated from shared-camera.js)
        this.cameraX = 0;
        this.cameraY = 0;
        this.zoom = 16; // WORLD_SCALE default
        this.canvasWidth = canvas.width;
        this.canvasHeight = canvas.height;
        this.isLight = true;

        // Uniform buffer for camera
        this.cameraBuffer = device.createBuffer({
            label: 'cameraUniforms',
            size: 256, // 2 * mat4x4 + 4 floats
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this._pipeline = null;
        this._bindGroup = null;
        this._ready = false;
    }

    /** Create render pipeline. Must be called after GPUPhysics.init(). */
    async init() {
        const shaderCode = await fetchShader('particle.wgsl');

        const module = this.device.createShaderModule({
            label: 'particle render',
            code: shaderCode,
        });

        const bindGroupLayout = this.device.createBindGroupLayout({
            label: 'particle render',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            ],
        });

        this._pipeline = this.device.createRenderPipeline({
            label: 'particle render',
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            vertex: {
                module,
                entryPoint: 'vs_main',
            },
            fragment: {
                module,
                entryPoint: 'fs_main',
                targets: [{
                    format: this.format,
                    blend: this.isLight
                        ? {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        }
                        : {
                            // Additive blending for dark mode
                            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                        },
                }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        this._bindGroup = this.device.createBindGroup({
            label: 'particle render',
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.cameraBuffer } },
                { binding: 1, resource: { buffer: this.buffers.posX } },
                { binding: 2, resource: { buffer: this.buffers.posY } },
                { binding: 3, resource: { buffer: this.buffers.radius } },
                { binding: 4, resource: { buffer: this.buffers.color } },
                { binding: 5, resource: { buffer: this.buffers.flags } },
            ],
        });

        this._ready = true;
    }

    /** Update camera uniform buffer. Call before render(). */
    updateCamera(camera) {
        this.cameraX = camera.x;
        this.cameraY = camera.y;
        this.zoom = camera.zoom;
        this.canvasWidth = this.canvas.width;
        this.canvasHeight = this.canvas.height;

        // Build 2D view matrix (world -> clip)
        // clip.x = (worldX - cameraX) * zoom * 2 / canvasWidth
        // clip.y = -(worldY - cameraY) * zoom * 2 / canvasHeight  (y-flip for clip space)
        const sx = this.zoom * 2 / this.canvasWidth;
        const sy = -this.zoom * 2 / this.canvasHeight;
        const tx = -this.cameraX * sx;
        const ty = -this.cameraY * sy;

        // mat4x4 column-major
        const view = new Float32Array([
            sx, 0,  0, 0,
            0,  sy, 0, 0,
            0,  0,  1, 0,
            tx, ty, 0, 1,
        ]);

        // Inverse: world = (clip - translate) / scale
        const isx = 1 / sx;
        const isy = 1 / sy;
        const inv = new Float32Array([
            isx, 0,   0, 0,
            0,   isy, 0, 0,
            0,   0,   1, 0,
            -tx * isx, -ty * isy, 0, 1,
        ]);

        const data = new ArrayBuffer(256);
        const f = new Float32Array(data);
        f.set(view, 0);        // viewMatrix at offset 0 (64 bytes)
        f.set(inv, 16);        // invViewMatrix at offset 64 (64 bytes)
        f[32] = this.zoom;     // offset 128
        f[33] = this.canvasWidth;
        f[34] = this.canvasHeight;
        f[35] = 0; // pad

        this.device.queue.writeBuffer(this.cameraBuffer, 0, data);
    }

    /** Render one frame. */
    render(aliveCount) {
        if (!this._ready || aliveCount === 0) return;

        const textureView = this.context.getCurrentTexture().createView();

        const encoder = this.device.createCommandEncoder({ label: 'render' });

        const pass = encoder.beginRenderPass({
            label: 'particle render',
            colorAttachments: [{
                view: textureView,
                clearValue: this.isLight
                    ? { r: 0.941, g: 0.922, b: 0.894, a: 1 }  // --bg-canvas light: #F0EBE4
                    : { r: 0.047, g: 0.043, b: 0.035, a: 1 },  // --bg-canvas dark: #0C0B09
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });

        pass.setPipeline(this._pipeline);
        pass.setBindGroup(0, this._bindGroup);
        // 6 vertices per quad (2 triangles), aliveCount instances
        pass.draw(6, aliveCount);
        pass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    setTheme(isLight) {
        this.isLight = isLight;
        // KNOWN LIMITATION (Phase 1): Blend mode baked at init time — only clear color changes.
        // Spec requires two pre-built pipelines (additive dark / alpha light) swapped on theme change.
        // Will be implemented in Phase 2 when the render pipeline is expanded.
    }

    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvasWidth = width;
        this.canvasHeight = height;
    }

    destroy() {
        this.cameraBuffer.destroy();
    }
}

async function fetchShader(filename) {
    const resp = await fetch(`src/gpu/shaders/${filename}`);
    if (!resp.ok) throw new Error(`Failed to load shader: ${filename}`);
    return resp.text();
}
