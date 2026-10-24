/**
 * @fileoverview GPURenderer — WebGPU instanced rendering for particles + bosons.
 *
 * Phase 1: particles. Phase 4: photon/pion boson rendering.
 * Also: clock rings, trails, field overlays, heatmap, force arrows.
 *
 * Dual-pipeline per renderer type: light mode uses standard alpha blending,
 * dark mode uses additive blending ('lighter' equivalent, matching CPU Canvas 2D).
 * On theme change setTheme() swaps _pipeline / _photonPipeline / _pionPipeline.
 */
import { fetchShader, getSharedPrefix, createBosonRenderPipelines, createFieldRenderPipeline, createHeatmapRenderPipeline, createArrowRenderPipeline, createClockRenderPipeline, createTorqueRenderPipeline, createRingRenderPipeline, createTrailRenderPipeline, createGridRenderPipeline, createSpacetimeRenderPipelines } from './gpu-pipelines.js';
import { TRAIL_LEN } from './gpu-buffers.js';
import { buildWGSLConstants, paletteRGB } from './gpu-constants.js';
import { HEATMAP_SENSITIVITY, HEATMAP_MAX_ALPHA, GPU_MAX_PHOTONS, GPU_MAX_PIONS, GPU_MAX_LEPTONS, WORLDLINE_LEN } from '../config.js';

// Pre-allocated typed arrays for per-frame writeBuffer calls (eliminate GC pressure)
const _cameraData = new ArrayBuffer(256);
const _cameraF32 = new Float32Array(_cameraData);
const _gridData = new ArrayBuffer(64);   // GridParams (grid-render.wgsl)
const _gridF32 = new Float32Array(_gridData);
const _gridU32 = new Uint32Array(_gridData);
const _trailData = new ArrayBuffer(16);
const _trailU32 = new Uint32Array(_trailData);
const _trailF32 = new Float32Array(_trailData);
const _arrowData = new ArrayBuffer(32);
const _arrowU32 = new Uint32Array(_arrowData);
const _arrowF32 = new Float32Array(_arrowData);
const _torqueData = new ArrayBuffer(32);
const _torqueU32 = new Uint32Array(_torqueData);
const _torqueF32 = new Float32Array(_torqueData);
const _ringData = new ArrayBuffer(48); // RingParams: vec4f color, dashPx, gapPx, halfWidthPx, ringType, selected, 3 pad
const _ringF32 = new Float32Array(_ringData);
const _ringU32 = new Uint32Array(_ringData);
const _fieldRenderData = new ArrayBuffer(128);
const _fieldRenderF32 = new Float32Array(_fieldRenderData);
const _fieldRenderU32 = new Uint32Array(_fieldRenderData);
const _heatmapRenderData = new ArrayBuffer(80);
const _heatmapRenderF32 = new Float32Array(_heatmapRenderData);
const _heatmapRenderU32 = new Uint32Array(_heatmapRenderData);
const _spacetimeData = new ArrayBuffer(112);  // SpacetimeParams (spacetime-render.wgsl)
const _spacetimeF32 = new Float32Array(_spacetimeData);
const _spacetimeU32 = new Uint32Array(_spacetimeData);
const _spacetimeI32 = new Int32Array(_spacetimeData);

// Palette-derived colors (computed once at module load from _PALETTE)
const _PAL = window._PALETTE;
const _bgLight = (() => { const [r,g,b] = paletteRGB(_PAL.light.canvas); return {r,g,b,a:1}; })();
const _bgDark = (() => { const [r,g,b] = paletteRGB(_PAL.dark.canvas); return {r,g,b,a:1}; })();
const _lightAccent = paletteRGB(_PAL.light.accent);
const _darkAccent = paletteRGB(_PAL.dark.accent);
const _textLight = paletteRGB(_PAL.light.text);
const _textDark = paletteRGB(_PAL.dark.text);
// Ink colors per theme: inks(isLight).name → [r, g, b]
const _inkRGB = (T) => Object.fromEntries(Object.entries(T.inks).map(([k, v]) => [k, paletteRGB(v)]));
const _inksLight = { ..._inkRGB(_PAL.light), graphite: paletteRGB(_PAL.light.textMuted) };
const _inksDark = { ..._inkRGB(_PAL.dark), graphite: paletteRGB(_PAL.dark.textMuted) };
const inks = (isLight) => isLight ? _inksLight : _inksDark;
const _fieldColors = (which, isLight) => {
    const k = inks(isLight);
    return which === 'higgs' ? [k.violet, k.sap] : [k.indigo, k.ochre];
};
let _forceLight, _forceDark, _torqueLight, _torqueDark;  // filled after the class

/** Standard premultiplied alpha-over blend (light mode). */
const BLEND_ALPHA = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

/** The dark theme's blend: the same alpha-over as light. (It was additive, a glow that read no
 *  quantity; inside a scene an effect ships only if it depicts one, AGENTS.md.) */
const BLEND_ADDITIVE = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

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
        // Uniform sizes are CSS px; the backing store is that times dpr (resize())
        this.dpr = 1;
        this.canvasWidth = canvas.width;
        this.canvasHeight = canvas.height;
        this.isLight = true;
        // Domain dimensions (set via setDomain() before first render)
        this._domainW = 0;
        this._domainH = 0;

        // Uniform buffer for camera
        this.cameraBuffer = device.createBuffer({
            label: 'cameraUniforms',
            size: 256, // 2 * mat4x4 + 4 floats (zoom, canvasWidth, canvasHeight, isDarkMode)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Particle render: two pipelines (light=alpha, dark=additive); _pipeline is the active one.
        this._pipelineLight = null;
        this._pipelineDark = null;
        this._pipeline = null;
        this._bindGroup = null;
        this._ready = false;

        // Boson rendering (Phase 4): two pipeline pairs, active pointers swapped on theme change.
        this._photonPipelineLight = null;
        this._photonPipelineDark = null;
        this._pionPipelineLight = null;
        this._pionPipelineDark = null;
        this._photonPipeline = null;
        this._pionPipeline = null;
        this._bosonBindGroups = null;
        this._bosonReady = false;

        // Field overlay rendering (Phase 5)
        this._fieldRenderPipeline = null;
        this._fieldRenderBindGroups = {};
        this._fieldRenderUniformBuffers = null; // per-field: { higgs, axion }
        this._fieldRenderReady = false;

        // Heatmap overlay rendering (Phase 5)
        this._heatmapRenderPipeline = null;
        this._heatmapRenderBindGroup = null;
        this._heatmapRenderUniformBuffer = null;
        this._heatmapRenderReady = false;

        // Arrow rendering (force/velocity vectors)
        this._arrowPipeline = null;
        this._arrowBindGroup = null;
        this._arrowUniformBuffer = null;
        // Per-type pre-allocated uniform buffers + bind groups for batched draws (G4).
        // 13 slots: types 0-10 (force components), 11 (total force), 12 (velocity).
        this._arrowUniformBufs = null;   // Array<GPUBuffer>[13]
        this._arrowBindGroups = null;    // Array<GPUBindGroup>[13]
        this._arrowReady = false;

        // Clock ring rendering (track + elapsed-arc pipelines)
        this._clockTrackPipeline = null;
        this._clockArcPipeline = null;
        this._clockBindGroup = null;
        this._clockReady = false;

        // Torque arc rendering (arc + arrowhead pipelines)
        this._torqueArcPipeline = null;
        this._torqueArrowPipeline = null;
        this._torqueBindGroup = null;
        this._torqueUniformBuffer = null;
        // Per-type pre-allocated uniform buffers + bind groups for batched draws (G4).
        // 5 slots: types 0-3 (torque components), 11 (total torque).
        this._torqueUniformBufs = null;  // Array<GPUBuffer>[5]
        this._torqueBindGroups = null;   // Array<GPUBindGroup>[5]
        this._torqueReady = false;

        // Ring rendering (the ergosphere's dashed hairline, the selection's solid one)
        this._ringPipeline = null;
        this._ringBindGroup = null;
        this._ringUniformBuffer = null;
        // Per-type ring uniform buffers + bind groups for batched draws (G4).
        // Slot 0: ergosphere, slot 1: selection.
        this._ringUniformBufs = null;   // Array<GPUBuffer>[2]
        this._ringBindGroups = null;    // Array<GPUBindGroup>[2]
        this._ringReady = false;

        // Trail rendering
        this._trailPipeline = null;
        this._trailBindGroup = null;
        this._trailUniformBuffer = null;
        this._trailReady = false;

        // Visual toggle state (synced from sim.view and sim.settings by GPUBackend.render)
        this.showForce = false;
        this.showForceComponents = false;
        this.showVelocity = false;
        this.showTrails = true;
        this.showClocks = false;
        this.relativityOn = false;  // Lorentz-contracted bodies and bent spokes
        this.blackHoleOn = false;   // spokes turn at the horizon's Ω_H

        // Frames: GPUPhysics' frame buffers (set before init()). In a non-lab frame the
        // body passes draw the view buffers, frameImages copies per slot.
        this.frameBuffers = null;
        this.frameOn = false;
        this.scaleA = 1;          // the grid's rulers are comoving
        this.higgsVev = 1;        // the Higgs vacuum the overlay measures from (√ε in a quench)
        this.lensBuffers = null;  // GPUPhysics' lens map (set before init()); this.lens per frame
        this.lens = null;
        this.frameImages = 1;
        this.showGrid = true;
        this.periodic = false;
        this._gridReady = false;
    }

    /** Create render pipeline. Must be called after GPUPhysics.init(). */
    async init() {
        const wgslConstants = buildWGSLConstants();
        this._wgslConstants = wgslConstants; // cache for theme-change rebuilds
        // Fetch shared includes + particle shader
        const [sharedStructs, sharedTopo] = await Promise.all([
            fetchShader('shared-structs.wgsl'),
            fetchShader('shared-topology.wgsl'),
        ]);
        const prefix = wgslConstants + '\n' + sharedStructs + '\n' + sharedTopo;
        const shaderCode = await fetchShader('particle.wgsl', prefix);

        const module = this.device.createShaderModule({
            label: 'particle render',
            code: shaderCode,
        });

        // Single bind group layout shared by both pipeline variants.
        const bindGroupLayout = this.device.createBindGroupLayout({
            label: 'particle render',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // particleState
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // particleAux
                { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // color
                { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // derived
                { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // clocks
            ],
        });

        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

        const pipelineBase = {
            layout: pipelineLayout,
            vertex: { module, entryPoint: 'vs_main' },
            primitive: { topology: 'triangle-list' },
        };

        // Light mode: standard premultiplied alpha-over blend.
        this._pipelineLight = this.device.createRenderPipeline({
            ...pipelineBase,
            label: 'particle render light',
            fragment: {
                module,
                entryPoint: 'fs_main',
                targets: [{ format: this.format, blend: BLEND_ALPHA }],
            },
        });

        // Dark mode: additive blend (matches Canvas 2D 'lighter').
        this._pipelineDark = this.device.createRenderPipeline({
            ...pipelineBase,
            label: 'particle render dark',
            fragment: {
                module,
                entryPoint: 'fs_main',
                targets: [{ format: this.format, blend: BLEND_ADDITIVE }],
            },
        });

        // Select active pipeline based on current theme.
        this._pipeline = this.isLight ? this._pipelineLight : this._pipelineDark;

        this._bindGroup = this.device.createBindGroup({
            label: 'particle render',
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.cameraBuffer } },
                { binding: 1, resource: { buffer: this.buffers.particleState } },
                { binding: 2, resource: { buffer: this.buffers.particleAux } },
                { binding: 3, resource: { buffer: this.buffers.color } },
                { binding: 4, resource: { buffer: this.buffers.derived } },
                { binding: 5, resource: { buffer: this.buffers.clocks } },
            ],
        });
        const fb = this.frameBuffers;
        this._bindGroupView = fb && this.device.createBindGroup({
            label: 'particle render (frame view)',
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.cameraBuffer } },
                { binding: 1, resource: { buffer: fb.viewState } },
                { binding: 2, resource: { buffer: fb.viewAux } },
                { binding: 3, resource: { buffer: this.buffers.color } },
                { binding: 4, resource: { buffer: fb.viewDerived } },
                { binding: 5, resource: { buffer: fb.viewClocks } },
            ],
        });

        this._ready = true;

        // --- Background grid: lab rulers and the domain edge ---
        await this._initGridRendering();

        // --- Boson render pipelines (Phase 4) ---
        await this._initBosonRendering();

        // --- Arrow render pipeline (force/velocity vectors) ---
        await this._initArrowRendering();

        // --- Clock ring render pipelines ---
        await this._initClockRendering();

        // --- Torque arc render pipeline ---
        await this._initTorqueRendering();

        // --- Ring render pipeline (ergosphere and selection) ---
        await this._initRingRendering();

        // --- The spacetime view: world lines, light cone, boson world lines ---
        await this._initSpacetimeRendering();
    }

    /** The spacetime view's passes (spacetime-render.wgsl). */
    async _initSpacetimeRendering() {
        try {
            const p = await createSpacetimeRenderPipelines(this.device, this.format, this._wgslConstants || '');
            const b = this.buffers;
            this._spacetimeUniformBuffer = this.device.createBuffer({
                label: 'spacetimeParams', size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            const group = (pipeline, label, extra) => this.device.createBindGroup({
                label, layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.cameraBuffer } },
                    { binding: 1, resource: { buffer: this._spacetimeUniformBuffer } },
                    ...extra.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
                ],
            });
            const fs = this.frameBuffers.frameState;
            const line = [[2, b.wlData], [3, b.wlMeta], [4, b.particleState], [10, fs]];
            this._spacetime = {
                line: p.line, cone: p.cone, boson: p.boson, pierce: p.pierce,
                lineGroup: group(p.line, 'spacetimeLines', [...line, [5, b.color]]),
                coneGroup: group(p.cone, 'spacetimeCone', line),
                bosonGroup: group(p.boson, 'spacetimeBosons', [[6, b.photonPool], [7, b.phCount], [8, b.pionPool], [9, b.piCount], [10, fs]]),
                pierceGroup: group(p.pierce, 'spacetimePierce', [...line, [5, b.color], [11, b.particleAux]]),
            };
        } catch (e) {
            console.warn('[worldline] Spacetime render pipeline creation failed, skipping:', e.message);
            this._spacetime = null;
        }
    }

    /**
     * Draw the spacetime view's world lines under the present plane, and the bodies' slice
     * points on the observer's present. `st` carries the view's state: { tilt, depth,
     * beadStep, tNow, selected, topology, scaleA, obs, pierce } (src/spacetime.js observer()).
     */
    _renderSpacetime(textureView, st, slots) {
        const sp = this._spacetime;
        if (!sp || !st || (st.tilt < 0.002 && !st.pierce)) return;
        const o = st.obs;
        _spacetimeF32[0] = st.tNow;
        _spacetimeF32[1] = st.depth;
        _spacetimeF32[2] = st.tilt;
        _spacetimeF32[3] = st.beadStep;
        _spacetimeF32[4] = this._domainW || 1;
        _spacetimeF32[5] = this._domainH || 1;
        _spacetimeI32[6] = st.topology;
        _spacetimeU32[7] = st.selected >= 0 ? st.selected : 0xFFFFFFFF;
        _spacetimeF32[8] = st.scaleA || 1;
        // Slots in use: reset() leaves old slots' flags behind, so passes stop at the count
        _spacetimeU32[9] = slots;
        _spacetimeF32[10] = o.s;
        _spacetimeF32[11] = o.psi;
        _spacetimeF32[12] = o.n[0]; _spacetimeF32[13] = o.n[1];
        _spacetimeF32[14] = o.offset[0]; _spacetimeF32[15] = o.offset[1];
        _spacetimeF32[16] = o.tA;
        _spacetimeF32[17] = o.lag;
        _spacetimeF32[18] = o.xA[0]; _spacetimeF32[19] = o.xA[1];
        _spacetimeF32[20] = o.aNow[0]; _spacetimeF32[21] = o.aNow[1];
        _spacetimeU32[22] = o.active ? 1 : 0;
        _spacetimeU32[23] = o.frameOn ? 1 : 0;
        _spacetimeF32[24] = st.pierce;
        _spacetimeF32[25] = Math.atanh(Math.min(Math.hypot(o.u[0], o.u[1]), 0.999));
        this.device.queue.writeBuffer(this._spacetimeUniformBuffer, 0, _spacetimeData);
        const enc = this.device.createCommandEncoder({ label: 'spacetime-render' });
        const pass = enc.beginRenderPass({
            label: 'spacetime render',
            colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
        });
        pass.setPipeline(sp.cone);
        pass.setBindGroup(0, sp.coneGroup);
        pass.draw(2 * (72 + 1), 4);
        pass.setPipeline(sp.boson);
        pass.setBindGroup(0, sp.bosonGroup);
        pass.draw(4, GPU_MAX_PHOTONS + GPU_MAX_PIONS + GPU_MAX_LEPTONS);
        pass.setPipeline(sp.line);
        pass.setBindGroup(0, sp.lineGroup);
        if (slots > 0) pass.draw(4 * (WORLDLINE_LEN + 1), slots);
        if (st.pierce && slots > 0) {
            pass.setPipeline(sp.pierce);
            pass.setBindGroup(0, sp.pierceGroup);
            pass.draw(4, slots);
        }
        pass.end();
        this.device.queue.submit([enc.finish()]);
    }

    /** The background grid pass (grid-render.wgsl). */
    async _initGridRendering() {
        try {
            const { pipeline, bindGroupLayout } =
                await createGridRenderPipeline(this.device, this.format, this._wgslConstants || '');
            this._gridPipeline = pipeline;
            this._gridUniformBuffer = this.device.createBuffer({
                label: 'gridParams', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this._gridBindGroup = this.device.createBindGroup({
                label: 'gridRender',
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.cameraBuffer } },
                    { binding: 1, resource: { buffer: this._gridUniformBuffer } },
                    { binding: 2, resource: { buffer: this.frameBuffers.frameState } },
                    { binding: 3, resource: { buffer: this.lensBuffers.map } },
                ],
            });
            this._gridReady = true;
        } catch (e) {
            console.warn('[worldline] Grid render pipeline creation failed, skipping:', e.message);
        }
    }

    /** Create boson (photon + pion) render pipelines — both light and dark variants. */
    async _initBosonRendering() {
        let lightResult, darkResult;
        try {
            // Fetch shader + create module once; share it between the light and dark pipeline pairs
            // to avoid a redundant network fetch and GPU shader compilation.
            const wgslConstants = this._wgslConstants || '';
            const prefix = await getSharedPrefix(wgslConstants);
            const bosonCode = await fetchShader('boson-render.wgsl', prefix);
            const bosonModule = this.device.createShaderModule({ label: 'bosonRender', code: bosonCode });

            [lightResult, darkResult] = await Promise.all([
                createBosonRenderPipelines(this.device, this.format, true,  wgslConstants, bosonModule),
                createBosonRenderPipelines(this.device, this.format, false, wgslConstants, bosonModule),
            ]);
        } catch (e) {
            console.warn('[physsim] Boson render pipeline creation failed, skipping:', e.message);
            return;
        }

        if (!lightResult.photonPipeline || !lightResult.pionPipeline ||
            !darkResult.photonPipeline || !darkResult.pionPipeline) {
            console.warn('[physsim] Boson render pipelines invalid, skipping');
            return;
        }

        this._photonPipelineLight = lightResult.photonPipeline;
        this._pionPipelineLight   = lightResult.pionPipeline;
        this._photonPipelineDark  = darkResult.photonPipeline;
        this._pionPipelineDark    = darkResult.pionPipeline;

        // Active pointers for current theme.
        this._photonPipeline = this.isLight ? this._photonPipelineLight : this._photonPipelineDark;
        this._pionPipeline   = this.isLight ? this._pionPipelineLight   : this._pionPipelineDark;

        const b = this.buffers;

        // Check that boson buffers exist (allocated lazily)
        if (!b.photonPool || !b.pionPool) {
            console.warn('[physsim] Boson buffers not yet allocated, skipping boson render init');
            return;
        }

        // Bind groups are theme-independent (same layouts between light and dark).
        try {
            const bindGroupLayouts = lightResult.bindGroupLayouts;

            // Group 0: camera uniforms
            const g0 = this.device.createBindGroup({
                label: 'bosonRender_g0',
                layout: bindGroupLayouts[0],
                entries: [
                    { binding: 0, resource: { buffer: this.cameraBuffer } },
                    { binding: 1, resource: { buffer: this.frameBuffers.frameState } },
                ],
            });

            // Group 1: photon pool (packed) + phCount
            const g1 = this.device.createBindGroup({
                label: 'bosonRender_g1',
                layout: bindGroupLayouts[1],
                entries: [
                    { binding: 0, resource: { buffer: b.photonPool } },
                    { binding: 1, resource: { buffer: b.phCount } },
                ],
            });

            // Group 2: pion pool (packed) + piCount
            const g2 = this.device.createBindGroup({
                label: 'bosonRender_g2',
                layout: bindGroupLayouts[2],
                entries: [
                    { binding: 0, resource: { buffer: b.pionPool } },
                    { binding: 1, resource: { buffer: b.piCount } },
                ],
            });

            this._bosonBindGroups = [g0, g1, g2];
            this._bosonReady = true;
        } catch (e) {
            console.warn('[physsim] Boson bind group creation failed:', e.message);
        }
    }

    /** Create arrow render pipeline for force/velocity vectors. */
    async _initArrowRendering() {
        try {
            const { pipeline, bindGroupLayout } =
                await createArrowRenderPipeline(this.device, this.format, this.isLight, this._wgslConstants || '');
            this._arrowPipeline = pipeline;

            const b = this.buffers;

            // Pre-allocate per-type uniform buffers + bind groups (G4 batching).
            // 13 slots: types 0-10 (force components), 11 (total force), 12 (velocity).
            // This allows all arrow types to be drawn in one encoder with one submit.
            const ARROW_SLOT_COUNT = 13;
            this._arrowUniformBufs = [];
            this._arrowBindGroups = [];
            for (let i = 0; i < ARROW_SLOT_COUNT; i++) {
                const buf = this.device.createBuffer({
                    label: `arrowUniforms_${i}`,
                    size: 32, // ArrowUniforms: forceType(u32) + colorR/G/B + arrowScale + minMag + pad*2 = 32B
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });
                this._arrowUniformBufs.push(buf);
                this._arrowBindGroups.push(this.device.createBindGroup({
                    label: `arrowRender_${i}`,
                    layout: bindGroupLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.cameraBuffer } },
                        { binding: 1, resource: { buffer: buf } },
                        { binding: 2, resource: { buffer: b.particleState } },
                        { binding: 3, resource: { buffer: b.particleAux } },
                        { binding: 4, resource: { buffer: b.allForces } },
                        { binding: 5, resource: { buffer: b.derived } },
                    ],
                }));
            }

            // Keep legacy single buffer/bindGroup for backward compat with _submitArrowDraw
            // (now unused in the batched path, but retained in case of fallback).
            this._arrowUniformBuffer = this._arrowUniformBufs[0];
            this._arrowBindGroup = this._arrowBindGroups[0];

            this._arrowReady = true;
        } catch (e) {
            console.warn('[physsim] Arrow render pipeline creation failed, skipping:', e.message);
        }
    }

    /** Create clock ring render pipelines (full track + elapsed arc). */
    async _initClockRendering() {
        try {
            const { trackPipeline, arcPipeline, bindGroupLayout } =
                await createClockRenderPipeline(this.device, this.format, this.isLight, this._wgslConstants || '');
            this._clockTrackPipeline = trackPipeline;
            this._clockArcPipeline = arcPipeline;

            const b = this.buffers;
            this._clockBindGroup = this.device.createBindGroup({
                label: 'clockRender',
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.cameraBuffer } },
                    { binding: 1, resource: { buffer: b.particleState } },
                    { binding: 2, resource: { buffer: b.particleAux } },
                    { binding: 3, resource: { buffer: b.derived } },
                    { binding: 4, resource: { buffer: b.clocks } },
                ],
            });
            const fb = this.frameBuffers;
            this._clockBindGroupView = fb && this.device.createBindGroup({
                label: 'clockRender (frame view)',
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.cameraBuffer } },
                    { binding: 1, resource: { buffer: fb.viewState } },
                    { binding: 2, resource: { buffer: fb.viewAux } },
                    { binding: 3, resource: { buffer: fb.viewDerived } },
                    { binding: 4, resource: { buffer: fb.viewClocks } },
                ],
            });
            this._clockReady = true;
        } catch (e) {
            console.warn('[worldline] Clock render pipeline creation failed, skipping:', e.message);
        }
    }

    /** Create torque arc render pipelines (arc ribbon + arrowhead triangles). */
    async _initTorqueRendering() {
        try {
            const { arcPipeline, arrowPipeline, bindGroupLayout } =
                await createTorqueRenderPipeline(this.device, this.format, this.isLight, this._wgslConstants || '');
            this._torqueArcPipeline = arcPipeline;
            this._torqueArrowPipeline = arrowPipeline;

            const b = this.buffers;

            // Pre-allocate per-type uniform buffers + bind groups (G4 batching).
            // 5 slots: types 0-3 (torque components), slot 4 used for type 11 (total torque).
            const TORQUE_SLOT_COUNT = 6;
            this._torqueUniformBufs = [];
            this._torqueBindGroups = [];
            for (let i = 0; i < TORQUE_SLOT_COUNT; i++) {
                const buf = this.device.createBuffer({
                    label: `torqueUniforms_${i}`,
                    size: 32,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });
                this._torqueUniformBufs.push(buf);
                this._torqueBindGroups.push(this.device.createBindGroup({
                    label: `torqueRender_${i}`,
                    layout: bindGroupLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.cameraBuffer } },
                        { binding: 1, resource: { buffer: buf } },
                        { binding: 2, resource: { buffer: b.particleState } },
                        { binding: 3, resource: { buffer: b.particleAux } },
                        { binding: 4, resource: { buffer: b.allForces } },
                    ],
                }));
            }

            // Keep legacy single buffer/bindGroup for backward compat.
            this._torqueUniformBuffer = this._torqueUniformBufs[0];
            this._torqueBindGroup = this._torqueBindGroups[0];

            this._torqueReady = true;
        } catch (e) {
            console.warn('[physsim] Torque render pipeline creation failed, skipping:', e.message);
        }
    }

    /** Create ring render pipeline (ergosphere and selection). */
    async _initRingRendering() {
        try {
            const { pipeline, bindGroupLayout } =
                await createRingRenderPipeline(this.device, this.format, this.isLight, this._wgslConstants || '');
            this._ringPipeline = pipeline;

            const b = this.buffers;

            // Pre-allocate per-type ring uniform buffers + bind groups (G4 batching).
            // Slot 0: ergosphere, slot 1: selection.
            const RING_SLOT_COUNT = 2;
            this._ringUniformBufs = [];
            this._ringBindGroups = [];
            for (let i = 0; i < RING_SLOT_COUNT; i++) {
                const buf = this.device.createBuffer({
                    label: `ringUniforms_${i}`,
                    size: 48, // RingParams struct
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });
                this._ringUniformBufs.push(buf);
                this._ringBindGroups.push(this.device.createBindGroup({
                    label: `ringRender_${i}`,
                    layout: bindGroupLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.cameraBuffer } },
                        { binding: 1, resource: { buffer: b.particleState } },
                        { binding: 2, resource: { buffer: b.particleAux } },
                        { binding: 3, resource: { buffer: b.derived } },
                        { binding: 4, resource: { buffer: buf } },
                    ],
                }));
            }
            const fb = this.frameBuffers;
            this._ringBindGroupsView = fb && this._ringUniformBufs.map((buf, i) => this.device.createBindGroup({
                label: `ringRender_${i} (frame view)`,
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.cameraBuffer } },
                    { binding: 1, resource: { buffer: fb.viewState } },
                    { binding: 2, resource: { buffer: fb.viewAux } },
                    { binding: 3, resource: { buffer: fb.viewDerived } },
                    { binding: 4, resource: { buffer: buf } },
                ],
            }));

            // Keep legacy single buffer/bindGroup for backward compat.
            this._ringUniformBuffer = this._ringUniformBufs[0];
            this._ringBindGroup = this._ringBindGroups[0];

            this._ringReady = true;
        } catch (e) {
            console.warn('[physsim] Ring render pipeline creation failed, skipping:', e.message);
        }
    }

    /**
     * Initialize trail render pipeline. Call after trail buffers are allocated.
     * @param {Object} trailBuffers - from GPUPhysics.getTrailBuffers()
     */
    async initTrailRendering(trailBuffers) {
        if (this._trailReady || !trailBuffers) return;
        try {
            const { pipeline, bindGroupLayout } =
                await createTrailRenderPipeline(this.device, this.format, this.isLight, this._wgslConstants || '');
            this._trailPipeline = pipeline;

            // Store trail buffer reference for theme-change rebuild
            this._trailBuffersRef = trailBuffers;

            if (!this._trailUniformBuffer) {
                this._trailUniformBuffer = this.device.createBuffer({
                    label: 'trailUniforms', size: 16,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });
            }

            const b = this.buffers;
            this._trailBindGroup = this.device.createBindGroup({
                label: 'trailRender',
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.cameraBuffer } },
                    { binding: 1, resource: { buffer: this._trailUniformBuffer } },
                    { binding: 2, resource: { buffer: trailBuffers.trailX } },
                    { binding: 3, resource: { buffer: trailBuffers.trailY } },
                    { binding: 4, resource: { buffer: trailBuffers.trailWriteIdx } },
                    { binding: 5, resource: { buffer: trailBuffers.trailCount } },
                    { binding: 6, resource: { buffer: b.color } },
                    { binding: 7, resource: { buffer: b.particleState } },
                    { binding: 8, resource: { buffer: b.particleAux } },
                ],
            });
            this._trailReady = true;
        } catch (e) {
            console.warn('[physsim] Trail render pipeline creation failed, skipping:', e.message);
        }
    }

    /**
     * Update camera uniform buffer. Call before render(). With a spacetime view
     * (src/spacetime.js) the matrices come from it: the plane tilted into time.
     */
    updateCamera(camera, view = null) {
        this.cameraX = camera.x;
        this.cameraY = camera.y;
        this.zoom = camera.zoom;
        // Build 2D view matrix (world -> clip)
        // clip.x = (worldX - cameraX) * zoom * 2 / canvasWidth
        // clip.y = -(worldY - cameraY) * zoom * 2 / canvasHeight  (y-flip for clip space)
        const sx = this.zoom * 2 / this.canvasWidth;
        const sy = -this.zoom * 2 / this.canvasHeight;
        const tx = -this.cameraX * sx;
        const ty = -this.cameraY * sy;

        // mat4x4 column-major — write directly into pre-allocated buffer
        const f = _cameraF32;
        if (view) {
            view.writeMatrices(f);
        } else {
        // View matrix
        f[0] = sx; f[1] = 0;  f[2] = 0; f[3] = 0;
        f[4] = 0;  f[5] = sy; f[6] = 0; f[7] = 0;
        f[8] = 0;  f[9] = 0;  f[10] = 1; f[11] = 0;
        f[12] = tx; f[13] = ty; f[14] = 0; f[15] = 1;
        // Inverse view matrix
        const isx = 1 / sx;
        const isy = 1 / sy;
        f[16] = isx; f[17] = 0;   f[18] = 0; f[19] = 0;
        f[20] = 0;   f[21] = isy; f[22] = 0; f[23] = 0;
        f[24] = 0;   f[25] = 0;   f[26] = 1; f[27] = 0;
        f[28] = -tx * isx; f[29] = -ty * isy; f[30] = 0; f[31] = 1;
        }
        // Extra uniforms
        f[32] = this.zoom;
        f[33] = this.canvasWidth;
        f[34] = this.canvasHeight;
        f[35] = this.isLight ? 0.0 : 1.0;
        f[36] = this.relativityOn ? 1.0 : 0.0;
        f[37] = this.blackHoleOn ? 1.0 : 0.0;
        f[38] = this.showClocks ? 1.0 : 0.0;
        f[39] = this.frameOn ? 1.0 : 0.0;
        f[40] = this.frameImages;
        f[41] = this.dpr;

        this.device.queue.writeBuffer(this.cameraBuffer, 0, _cameraData);
    }

    /**
     * Render one frame.
     * The caller (main.js loop) only calls render() when _dirty is true,
     * so no additional dirty-flag gating is needed here.
     */
    render(aliveCount, opts = {}) {
        if (!this._ready) return;

        const textureView = this.context.getCurrentTexture().createView();

        // In a non-lab frame the body passes draw the view buffers, frameImages per slot;
        // trails, vectors, torques and the field and potential overlays are lab-only
        const frame = this.frameOn && !!this._bindGroupView;
        const instances = frame ? aliveCount * this.frameImages : aliveCount;

        // Pass 0: clear, then the background grid (lab rulers and the domain edge)
        {
            const gridEncoder = this.device.createCommandEncoder({ label: 'grid-render' });
            const gridPass = gridEncoder.beginRenderPass({
                label: 'grid render',
                colorAttachments: [{
                    view: textureView,
                    clearValue: this.isLight ? _bgLight : _bgDark,
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            });
            if (this._gridReady) {
                _gridF32[0] = this._domainW || 1;
                _gridF32[1] = this._domainH || 1;
                _gridU32[2] = this.periodic ? 1 : 0;
                _gridU32[3] = this.showGrid ? 1 : 0;
                _gridF32[4] = this.scaleA || 1;
                // The lens map's rectangle and the probe's star (GPUBackend sets this.lens)
                const lens = this.lens;
                _gridU32[5] = lens ? 1 : 0;
                _gridU32[6] = lens ? lens.res : 1;
                _gridU32[7] = lens && lens.star ? 1 : 0;
                _gridF32[8] = lens ? lens.left : 0;
                _gridF32[9] = lens ? lens.top : 0;
                _gridF32[10] = lens ? lens.width / lens.res : 1;
                _gridF32[11] = lens ? lens.height / lens.res : 1;
                _gridF32[12] = lens && lens.star ? lens.star.x : 0;
                _gridF32[13] = lens && lens.star ? lens.star.y : 0;
                _gridF32[14] = lens && lens.star ? lens.star.r : 1;
                _gridF32[15] = opts.spacetime ? opts.spacetime.tilt : 0;
                this.device.queue.writeBuffer(this._gridUniformBuffer, 0, _gridData);
                gridPass.setPipeline(this._gridPipeline);
                gridPass.setBindGroup(0, this._gridBindGroup);
                gridPass.draw(3);
            }
            gridPass.end();
            this.device.queue.submit([gridEncoder.finish()]);
        }

        // Pass 0a: the spacetime view's world lines, hanging below the present plane
        if (opts.spacetime) this._renderSpacetime(textureView, opts.spacetime, aliveCount);
        const tilt = opts.spacetime ? opts.spacetime.tilt : 0;

        // Pass 0b: Trail rendering (behind particles), lab frame only; trails are the plane
        // view's shadows of the world lines, so they give way as the view tilts
        const boosting = opts.spacetime && opts.spacetime.pierce === 2;
        const trailsDrawn = !frame && !boosting && this._trailReady && this.showTrails && aliveCount > 0 && tilt < 0.98;
        if (trailsDrawn) {
            try {
                // Write trail uniforms (pre-allocated buffer)
                _trailU32[0] = TRAIL_LEN;
                _trailF32[1] = this._domainW || 1;
                _trailF32[2] = this._domainH || 1;
                _trailF32[3] = 1 - tilt;   // opacity
                this.device.queue.writeBuffer(this._trailUniformBuffer, 0, _trailData);

                const trailEncoder = this.device.createCommandEncoder({ label: 'trail-render' });
                const trailPass = trailEncoder.beginRenderPass({
                    label: 'trail render',
                    colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
                });
                trailPass.setPipeline(this._trailPipeline);
                trailPass.setBindGroup(0, this._trailBindGroup);
                trailPass.draw(TRAIL_LEN * 2, aliveCount);
                trailPass.end();
                this.device.queue.submit([trailEncoder.finish()]);
            } catch (e) {
                console.warn('[physsim] Trail render failed, disabling:', e.message);
                this._trailReady = false;
            }
        }

        // Pass 1: Particle rendering
        const encoder = this.device.createCommandEncoder({ label: 'render' });
        const pass = encoder.beginRenderPass({
            label: 'particle render',
            colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
        });

        if (aliveCount > 0 && !boosting) {
            pass.setPipeline(this._pipeline);
            pass.setBindGroup(0, frame ? this._bindGroupView : this._bindGroup);
            // 6 vertices per quad (2 triangles), one instance per body (and image)
            pass.draw(6, instances);
        }
        pass.end();

        // Submit particle render immediately (isolate from optional passes that may fail)
        this.device.queue.submit([encoder.finish()]);

        // Pass 2: Field + heatmap overlays (load to preserve particles)
        const hasOverlays = !frame && ((this._fieldRenderReady && (opts.higgsField || opts.axionField)) ||
            (this._heatmapRenderReady && opts.heatmapBuffers));
        if (hasOverlays) {
            const overlayEncoder = this.device.createCommandEncoder({ label: 'overlay' });
            const overlayPass = overlayEncoder.beginRenderPass({
                label: 'overlay render',
                colorAttachments: [{
                    view: textureView,
                    loadOp: 'load',
                    storeOp: 'store',
                }],
            });

            if (this._fieldRenderReady) {
                if (opts.higgsField) {
                    this.drawFieldOverlay(overlayPass, 'higgs', opts.higgsField);
                }
                if (opts.axionField) {
                    this.drawFieldOverlay(overlayPass, 'axion', opts.axionField);
                }
            }

            if (this._heatmapRenderReady && opts.heatmapBuffers) {
                this.drawHeatmapOverlay(overlayPass, opts.heatmapBuffers, opts.heatmapOpts || {});
            }

            overlayPass.end();
            this.device.queue.submit([overlayEncoder.finish()]);
        }

        // Pass 3: Boson rendering — isolated encoder so failures don't affect particles
        if (this._bosonReady) {
            try {
                const bosonEncoder = this.device.createCommandEncoder({ label: 'boson-render' });
                const bosonPass = bosonEncoder.beginRenderPass({
                    label: 'boson render',
                    colorAttachments: [{
                        view: textureView,
                        loadOp: 'load',
                        storeOp: 'store',
                    }],
                });

                const bgs = this._bosonBindGroups;

                bosonPass.setPipeline(this._photonPipeline);
                bosonPass.setBindGroup(0, bgs[0]);
                bosonPass.setBindGroup(1, bgs[1]);
                bosonPass.setBindGroup(2, bgs[2]);
                bosonPass.draw(4, GPU_MAX_PHOTONS);

                bosonPass.setPipeline(this._pionPipeline);
                bosonPass.setBindGroup(0, bgs[0]);
                bosonPass.setBindGroup(1, bgs[1]);
                bosonPass.setBindGroup(2, bgs[2]);
                bosonPass.draw(4, GPU_MAX_PIONS + GPU_MAX_LEPTONS);

                bosonPass.end();
                this.device.queue.submit([bosonEncoder.finish()]);
            } catch (e) {
                console.warn('[physsim] Boson render failed, disabling:', e.message);
                this._bosonReady = false;
            }
        }

        // Pass 3b: Clock rings (the Clocks overlay)
        if (this._clockReady && this.showClocks && aliveCount > 0 && !boosting) {
            try {
                const clockEncoder = this.device.createCommandEncoder({ label: 'clock-render' });
                const clockPass = clockEncoder.beginRenderPass({
                    label: 'clock render',
                    colorAttachments: [{
                        view: textureView,
                        loadOp: 'load',
                        storeOp: 'store',
                    }],
                });
                // Triangle-strip ribbons: 48 segments × 2 vertices
                clockPass.setBindGroup(0, frame ? this._clockBindGroupView : this._clockBindGroup);
                clockPass.setPipeline(this._clockTrackPipeline);
                clockPass.draw(96, instances);
                clockPass.setPipeline(this._clockArcPipeline);
                clockPass.draw(96, instances);
                clockPass.end();
                this.device.queue.submit([clockEncoder.finish()]);
            } catch (e) {
                console.warn('[worldline] Clock render failed, disabling:', e.message);
                this._clockReady = false;
            }
        }

        // Pass 3c: Ring overlays (the ergosphere, the selection), batched into ONE encoder +
        // ONE submit with per-slot uniform buffers (slot 0 = ergosphere, slot 1 = selection)
        if (this._ringReady && aliveCount > 0 && !boosting) {
            try {
                const ringDrawSlots = [];
                // Ergosphere: a dashed hairline in the text ink, only in black-hole mode
                if (opts.blackHoleEnabled) {
                    const [er, eg, eb] = this.isLight ? _textLight : _textDark;
                    _ringF32[0] = er; _ringF32[1] = eg; _ringF32[2] = eb; _ringF32[3] = this.isLight ? 0.55 : 0.6;
                    _ringF32[4] = 3; _ringF32[5] = 3; _ringF32[6] = 0.5;
                    _ringU32[7] = 0; _ringU32[8] = 0xFFFFFFFF;
                    this.device.queue.writeBuffer(this._ringUniformBufs[0], 0, _ringData);
                    ringDrawSlots.push(0);
                }
                // Selection: a solid accent hairline, the one red the scene spends on a body
                if (opts.selected >= 0) {
                    const [ar, ag, ab] = this.isLight ? _lightAccent : _darkAccent;
                    _ringF32[0] = ar; _ringF32[1] = ag; _ringF32[2] = ab; _ringF32[3] = 1;
                    _ringF32[4] = 0; _ringF32[5] = 0; _ringF32[6] = 0.625;
                    _ringU32[7] = 1; _ringU32[8] = opts.selected;
                    this.device.queue.writeBuffer(this._ringUniformBufs[1], 0, _ringData);
                    ringDrawSlots.push(1);
                }

                // One encoder, one render pass per ring type, one submit
                if (ringDrawSlots.length > 0) {
                    const ringEnc = this.device.createCommandEncoder({ label: 'rings-batch' });
                    for (const slot of ringDrawSlots) {
                        const ringPass = ringEnc.beginRenderPass({
                            label: `ring-slot-${slot}`,
                            colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
                        });
                        ringPass.setPipeline(this._ringPipeline);
                        ringPass.setBindGroup(0, frame ? this._ringBindGroupsView[slot] : this._ringBindGroups[slot]);
                        ringPass.draw(130, instances); // (RING_SEGMENTS + 1) * 2 to close strip
                        ringPass.end();
                    }
                    this.device.queue.submit([ringEnc.finish()]);
                }
            } catch (e) {
                console.warn('[physsim] Ring render failed, disabling:', e.message);
                this._ringReady = false;
            }
        }

        // Pass 4: Force/velocity arrows — batched into ONE encoder + ONE submit.
        // Each arrow type uses its own pre-allocated uniform buffer (slot = draw index)
        // so all writeBuffers execute before the encoder, yet each render pass reads
        // from its own buffer. Reduces up to 12 submits down to 1.
        const wantsArrows = !frame && !boosting && this._arrowReady && aliveCount > 0 &&
            (this.showForce || this.showForceComponents || this.showVelocity);
        if (wantsArrows) {
            try {
                const enabledForces = opts.enabledForces || {};
                const zoom = this.zoom || 16;
                const invZoom = 1 / zoom;
                const arrowScale = 256.0;
                const minMag = 0.5 * invZoom;

                // Build list of (slot, forceType, color, scale, minMag) draws
                const arrowDraws = [];
                if (this.showForceComponents) {
                    const pairs = [
                        [0, enabledForces.gravity],
                        [1, enabledForces.coulomb],
                        [2, enabledForces.magnetic],
                        [3, enabledForces.gravitomag],
                        [4, enabledForces.onePN],
                        [5, enabledForces.spinOrbit],
                        [6, enabledForces.radiation],
                        [7, enabledForces.yukawa],
                        [8, enabledForces.external],
                        [9, enabledForces.higgs],
                        [10, enabledForces.axion],
                    ];
                    for (const [ft, enabled] of pairs) {
                        if (enabled) {
                            arrowDraws.push({ slot: arrowDraws.length, ft, color: GPURenderer.forceColors(this.isLight)[ft] || [1, 1, 1], scale: arrowScale, minMag });
                        }
                    }
                } else if (this.showForce) {
                    const accentColor = this.isLight ? _lightAccent : _darkAccent;
                    arrowDraws.push({ slot: 0, ft: 11, color: accentColor, scale: arrowScale, minMag });
                }
                if (this.showVelocity) {
                    const textColor = this.isLight ? _textLight : _textDark;
                    arrowDraws.push({ slot: arrowDraws.length, ft: 12, color: textColor, scale: 1.0, minMag: 1.0 * invZoom });
                }

                if (arrowDraws.length > 0) {
                    // Write all uniform buffers up front (queue-level, before encoder starts)
                    for (const { slot, ft, color, scale, minMag: mm } of arrowDraws) {
                        const buf = this._arrowUniformBufs[slot];
                        // Re-use the pre-allocated _arrowData ArrayBuffer for temp staging
                        _arrowU32[0] = ft;
                        _arrowF32[1] = color[0];
                        _arrowF32[2] = color[1];
                        _arrowF32[3] = color[2];
                        _arrowF32[4] = scale;
                        _arrowF32[5] = mm;
                        _arrowF32[6] = 0;
                        _arrowF32[7] = 0;
                        this.device.queue.writeBuffer(buf, 0, _arrowData);
                    }
                    // One encoder, one render pass per draw type, one submit
                    const arrowEnc = this.device.createCommandEncoder({ label: 'arrows-batch' });
                    for (const { slot } of arrowDraws) {
                        const pass = arrowEnc.beginRenderPass({
                            label: `arrow-slot-${slot}`,
                            colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
                        });
                        pass.setPipeline(this._arrowPipeline);
                        pass.setBindGroup(0, this._arrowBindGroups[slot]);
                        pass.draw(9, aliveCount);
                        pass.end();
                    }
                    this.device.queue.submit([arrowEnc.finish()]);
                }
            } catch (e) {
                console.warn('[physsim] Arrow render failed, disabling:', e.message);
                this._arrowReady = false;
            }
        }

        // Pass 5: Torque arcs — batched into ONE encoder + ONE submit.
        // Each torque type uses its own pre-allocated uniform buffer. Arc + arrowhead
        // for all types share the same encoder; reduces up to 8 submits to 1.
        const wantsTorques = !frame && !boosting && this._torqueReady && aliveCount > 0 &&
            (this.showForce || this.showForceComponents);
        if (wantsTorques) {
            try {
                const torqueScale = 640.0; // FORCE_VECTOR_SCALE / INERTIA_K = 256 / 0.4
                const enabledForces = opts.enabledForces || {};

                // Build list of (slot, torqueType, color) draws
                const torqueDraws = [];
                if (this.showForceComponents) {
                    // spinOrbit: type 0, slot 0, purple
                    if (enabledForces.spinOrbit) torqueDraws.push({ slot: 0, type: 0, color: GPURenderer.torqueColors(this.isLight)[0] });
                    // frameDrag: type 1, slot 1, rose
                    if (enabledForces.gravitomag) torqueDraws.push({ slot: 1, type: 1, color: GPURenderer.torqueColors(this.isLight)[1] });
                    // tidal: type 2, slot 2, red
                    if (enabledForces.gravity) torqueDraws.push({ slot: 2, type: 2, color: GPURenderer.torqueColors(this.isLight)[2] });
                    // contact: type 3, slot 3, brown (always active with bounce)
                    torqueDraws.push({ slot: 3, type: 3, color: GPURenderer.torqueColors(this.isLight)[3] });
                    // superradiance: type 4, slot 5, indigo (requires axion + BH)
                    if (enabledForces.axion && opts.blackHoleEnabled) torqueDraws.push({ slot: 5, type: 4, color: GPURenderer.torqueColors(this.isLight)[4] });
                } else if (this.showForce) {
                    const accentColor = this.isLight ? _lightAccent : _darkAccent;
                    torqueDraws.push({ slot: 4, type: 11, color: accentColor });
                }

                if (torqueDraws.length > 0) {
                    // Write all uniform buffers up front
                    for (const { slot, type, color } of torqueDraws) {
                        const buf = this._torqueUniformBufs[slot];
                        _torqueU32[0] = type;
                        _torqueF32[1] = color[0];
                        _torqueF32[2] = color[1];
                        _torqueF32[3] = color[2];
                        _torqueF32[4] = torqueScale;
                        _torqueF32[5] = 0;
                        _torqueF32[6] = 0;
                        _torqueF32[7] = 0;
                        this.device.queue.writeBuffer(buf, 0, _torqueData);
                    }
                    // One encoder: arc + arrowhead per type, one submit
                    const torqueEnc = this.device.createCommandEncoder({ label: 'torques-batch' });
                    for (const { slot } of torqueDraws) {
                        const bg = this._torqueBindGroups[slot];
                        // Arc ribbon (triangle-strip, ARC_SEGMENTS * 2 = 64 vertices)
                        const arcPass = torqueEnc.beginRenderPass({
                            label: `torque-arc-${slot}`,
                            colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
                        });
                        arcPass.setPipeline(this._torqueArcPipeline);
                        arcPass.setBindGroup(0, bg);
                        arcPass.draw(64, aliveCount);
                        arcPass.end();
                        // Arrowhead (triangle-list, 3 vertices)
                        const arrPass = torqueEnc.beginRenderPass({
                            label: `torque-arrow-${slot}`,
                            colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
                        });
                        arrPass.setPipeline(this._torqueArrowPipeline);
                        arrPass.setBindGroup(0, bg);
                        arrPass.draw(3, aliveCount);
                        arrPass.end();
                    }
                    this.device.queue.submit([torqueEnc.finish()]);
                }
            } catch (e) {
                console.warn('[physsim] Torque render failed, disabling:', e.message);
                this._torqueReady = false;
            }
        }
    }

    /**
     * Force type colors matching CPU renderer (from renderer.js).
     * Index matches getForceVector() in arrow-render.wgsl.
     */
    static forceColors(isLight) { return isLight ? _forceLight : _forceDark; }

    static _buildForceColors(isLight) {
        const k = inks(isLight);
        return [
            k.umber,       // 0: gravity
            k.prussian,    // 1: coulomb
            k.verdigris,   // 2: magnetic
            k.madder,      // 3: gravitomag
            k.sienna,      // 4: 1pn
            k.violet,      // 5: spinCurv
            k.ochre,       // 6: radiation
            k.viridian,    // 7: yukawa
            k.graphite,    // 8: external
            k.sap,         // 9: higgs
            k.indigo,      // 10: axion
        ];
    }

    /**
     * Submit a single arrow draw with its own encoder + render pass.
     * Each arrow type needs a separate submit so that the uniform writeBuffer
     * takes effect before the draw executes on the GPU.
     */
    _submitArrowDraw(textureView, aliveCount, forceType, color, arrowScale, minMag) {
        if (!this._arrowReady || aliveCount <= 0) return;

        _arrowU32[0] = forceType;
        _arrowF32[1] = color[0];
        _arrowF32[2] = color[1];
        _arrowF32[3] = color[2];
        _arrowF32[4] = arrowScale;
        _arrowF32[5] = minMag;
        _arrowF32[6] = 0;  // _pad0 (unused by shader)
        _arrowF32[7] = 0;
        this.device.queue.writeBuffer(this._arrowUniformBuffer, 0, _arrowData);

        const enc = this.device.createCommandEncoder({ label: `arrow-${forceType}` });
        const pass = enc.beginRenderPass({
            label: `arrow ${forceType}`,
            colorAttachments: [{
                view: textureView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        pass.setPipeline(this._arrowPipeline);
        pass.setBindGroup(0, this._arrowBindGroup);
        pass.draw(9, aliveCount);
        pass.end();
        this.device.queue.submit([enc.finish()]);
    }

    /**
     * Torque type colors matching CPU renderer.
     * 0: spinOrbit (violet), 1: frameDrag (madder), 2: tidal (umber), 3: contact (graphite).
     */
    static torqueColors(isLight) { return isLight ? _torqueLight : _torqueDark; }

    static _buildTorqueColors(isLight) {
        const k = inks(isLight);
        return [
            k.violet,      // 0: spinOrbit
            k.madder,      // 1: frameDrag
            k.umber,       // 2: tidal
            k.graphite,    // 3: contact
            k.indigo,      // 4: superradiance
        ];
    }

    /**
     * Submit a single torque arc + arrowhead draw.
     * Each torque type needs its own submit for correct uniforms.
     */
    _submitTorqueDraw(textureView, aliveCount, torqueType, color, torqueScale) {
        if (!this._torqueReady || aliveCount <= 0) return;

        _torqueU32[0] = torqueType;
        _torqueF32[1] = color[0];
        _torqueF32[2] = color[1];
        _torqueF32[3] = color[2];
        _torqueF32[4] = torqueScale;
        _torqueF32[5] = 0;
        _torqueF32[6] = 0;
        _torqueF32[7] = 0;
        this.device.queue.writeBuffer(this._torqueUniformBuffer, 0, _torqueData);

        // Arc ribbon
        const enc1 = this.device.createCommandEncoder({ label: `torque-arc-${torqueType}` });
        const pass1 = enc1.beginRenderPass({
            label: `torque arc ${torqueType}`,
            colorAttachments: [{
                view: textureView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        pass1.setPipeline(this._torqueArcPipeline);
        pass1.setBindGroup(0, this._torqueBindGroup);
        pass1.draw(64, aliveCount);  // ARC_SEGMENTS * 2 = 64 vertices
        pass1.end();
        this.device.queue.submit([enc1.finish()]);

        // Arrowhead triangles
        const enc2 = this.device.createCommandEncoder({ label: `torque-arrow-${torqueType}` });
        const pass2 = enc2.beginRenderPass({
            label: `torque arrow ${torqueType}`,
            colorAttachments: [{
                view: textureView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        pass2.setPipeline(this._torqueArrowPipeline);
        pass2.setBindGroup(0, this._torqueBindGroup);
        pass2.draw(3, aliveCount);
        pass2.end();
        this.device.queue.submit([enc2.finish()]);
    }

    /** Initialize field overlay render pipeline. Call after GPUPhysics has field buffers. */
    async initFieldOverlay() {
        if (this._fieldRenderReady) return;

        const { pipeline, bindGroupLayouts } =
            await createFieldRenderPipeline(this.device, this.format, this.isLight, this._wgslConstants || '');
        this._fieldRenderPipeline = pipeline;
        this._fieldRenderLayouts = bindGroupLayouts;

        // Separate uniform buffers per field to avoid writeBuffer race condition
        // when both Higgs and Axion draw in the same render pass
        this._fieldRenderUniformBuffers = {
            higgs: this.device.createBuffer({
                label: 'fieldRenderUniforms_higgs',
                size: 128,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }),
            axion: this.device.createBuffer({
                label: 'fieldRenderUniforms_axion',
                size: 128,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }),
        };

        this._fieldRenderReady = true;
    }

    /** Initialize heatmap overlay render pipeline. */
    async initHeatmapOverlay() {
        if (this._heatmapRenderReady) return;

        const { pipeline, bindGroupLayouts } =
            await createHeatmapRenderPipeline(this.device, this.format, this.isLight, this._wgslConstants || '');
        this._heatmapRenderPipeline = pipeline;
        this._heatmapRenderLayouts = bindGroupLayouts;

        this._heatmapRenderUniformBuffer = this.device.createBuffer({
            label: 'heatmapRenderUniforms',
            size: 80, // HeatmapRenderUniforms struct
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this._heatmapRenderReady = true;
    }

    /**
     * Ensure field render bind group exists for a given field.
     * @param {'higgs'|'axion'} which
     * @param {GPUBuffer} fieldBuffer - the field array buffer from GPUPhysics
     */
    _ensureFieldRenderBG(which, fieldBuffer) {
        if (this._fieldRenderBindGroups[which]) return;
        this._fieldRenderBindGroups[which] = this.device.createBindGroup({
            label: `fieldRender_${which}`,
            layout: this._fieldRenderLayouts[0],
            entries: [
                { binding: 0, resource: { buffer: fieldBuffer } },
                { binding: 1, resource: { buffer: this._fieldRenderUniformBuffers[which] } },
                { binding: 2, resource: { buffer: this.cameraBuffer } },
            ],
        });
    }

    /**
     * Draw field overlay for one field type.
     * @param {GPURenderPassEncoder} pass
     * @param {'higgs'|'axion'} which
     * @param {GPUBuffer} fieldBuffer
     */
    drawFieldOverlay(pass, which, fieldBuffer) {
        if (!this._fieldRenderReady || !fieldBuffer) return;
        this._ensureFieldRenderBG(which, fieldBuffer);

        // Write FieldRenderUniforms (pre-allocated buffer)
        const f = _fieldRenderF32;
        const u = _fieldRenderU32;
        f[0] = this.cameraX;
        f[1] = this.cameraY;
        f[2] = this.zoom;
        f[3] = this.canvasWidth;
        f[4] = this.canvasHeight;
        f[5] = this._domainW || 1;
        f[6] = this._domainH || 1;
        u[7] = this.isLight ? 1 : 0;
        u[8] = which === 'higgs' ? 0 : 1;
        f[9] = this.higgsVev ?? 1; f[10] = 0; f[11] = 0;
        const [c0, c1] = _fieldColors(which, this.isLight);
        f[12] = c0[0]; f[13] = c0[1]; f[14] = c0[2]; f[15] = 1.0;
        f[16] = c1[0]; f[17] = c1[1]; f[18] = c1[2]; f[19] = 1.0;
        this.device.queue.writeBuffer(this._fieldRenderUniformBuffers[which], 0, _fieldRenderData);

        pass.setPipeline(this._fieldRenderPipeline);
        pass.setBindGroup(0, this._fieldRenderBindGroups[which]);
        pass.draw(3); // fullscreen triangle
    }

    /**
     * Draw heatmap overlay.
     * @param {GPURenderPassEncoder} pass
     * @param {Object} heatmapBuffers - from GPUPhysics.getHeatmapBuffers()
     * @param {Object} opts - { viewLeft, viewTop, cellW, cellH, doGravity, doCoulomb, doYukawa }
     */
    drawHeatmapOverlay(pass, heatmapBuffers, opts) {
        if (!this._heatmapRenderReady || !heatmapBuffers) return;

        if (!this._heatmapRenderBindGroup) {
            this._heatmapRenderBindGroup = this.device.createBindGroup({
                label: 'heatmapRender_g0',
                layout: this._heatmapRenderLayouts[0],
                entries: [
                    { binding: 0, resource: { buffer: heatmapBuffers.gravPotential } },
                    { binding: 1, resource: { buffer: heatmapBuffers.elecPotential } },
                    { binding: 2, resource: { buffer: heatmapBuffers.yukawaPotential } },
                    { binding: 3, resource: { buffer: this._heatmapRenderUniformBuffer } },
                    { binding: 4, resource: { buffer: this.cameraBuffer } },
                    { binding: 5, resource: { buffer: heatmapBuffers.magField } },
                ],
            });
        }

        // Write HeatmapRenderUniforms (pre-allocated buffer)
        _heatmapRenderF32[0] = this.cameraX;
        _heatmapRenderF32[1] = this.cameraY;
        _heatmapRenderF32[2] = this.zoom;
        _heatmapRenderF32[3] = this.canvasWidth;
        _heatmapRenderF32[4] = this.canvasHeight;
        _heatmapRenderF32[5] = opts.viewLeft || 0;
        _heatmapRenderF32[6] = opts.viewTop || 0;
        _heatmapRenderF32[7] = opts.cellW || 1;
        _heatmapRenderF32[8] = opts.cellH || 1;
        _heatmapRenderF32[9] = HEATMAP_SENSITIVITY;
        _heatmapRenderF32[10] = HEATMAP_MAX_ALPHA / 255;
        _heatmapRenderU32[11] = this.isLight ? 1 : 0;
        _heatmapRenderU32[12] = opts.doGravity ? 1 : 0;
        _heatmapRenderU32[13] = opts.doCoulomb ? 1 : 0;
        _heatmapRenderU32[14] = opts.doYukawa ? 1 : 0;
        _heatmapRenderF32[15] = opts.tilt || 0;
        _heatmapRenderF32[16] = this._domainW || 1;
        _heatmapRenderF32[17] = this._domainH || 1;
        _heatmapRenderU32[18] = opts.doMagnetic ? 1 : 0;
        _heatmapRenderF32[19] = opts.glyphPx || this.zoom;
        this.device.queue.writeBuffer(this._heatmapRenderUniformBuffer, 0, _heatmapRenderData);

        pass.setPipeline(this._heatmapRenderPipeline);
        pass.setBindGroup(0, this._heatmapRenderBindGroup);
        pass.draw(3); // fullscreen triangle
    }

    /** Set domain dimensions for field rendering */
    setDomain(domainW, domainH) {
        this._domainW = domainW;
        this._domainH = domainH;
    }

    /**
     * Update theme. Swaps active pipeline pointers to additive (dark) or alpha (light).
     * The camera uniform buffer is NOT re-written here — the isDarkMode field is written
     * fresh each frame by updateCamera(), so the next frame will have the correct value.
     */
    setTheme(isLight) {
        this.isLight = isLight;

        // Swap particle pipeline.
        if (this._pipelineLight && this._pipelineDark) {
            this._pipeline = isLight ? this._pipelineLight : this._pipelineDark;
        }

        // Swap boson pipelines.
        if (this._photonPipelineLight && this._photonPipelineDark) {
            this._photonPipeline = isLight ? this._photonPipelineLight : this._photonPipelineDark;
            this._pionPipeline   = isLight ? this._pionPipelineLight   : this._pionPipelineDark;
        }

        // Rebuild clock pipelines (blend mode depends on theme).
        if (this._clockReady) {
            this._clockReady = false;
            this._initClockRendering();
        }

        // Rebuild trail pipeline (blend mode depends on theme).
        // Save trail bind group resources so initTrailRendering can rebind them.
        if (this._trailReady) {
            this._trailReady = false;
            this._rebuildTrailPipeline();
        }

        // Rebuild arrow pipeline (blend mode depends on theme).
        if (this._arrowReady) {
            this._arrowReady = false;
            this._initArrowRendering();
        }

        // Rebuild torque pipeline (blend mode depends on theme).
        if (this._torqueReady) {
            this._torqueReady = false;
            this._initTorqueRendering();
        }

        // Rebuild ring pipeline (blend mode depends on theme).
        if (this._ringReady) {
            this._ringReady = false;
            this._initRingRendering();
        }
    }

    /** Rebuild trail pipeline with current theme, preserving existing bind group bindings. */
    async _rebuildTrailPipeline() {
        try {
            const { pipeline, bindGroupLayout } =
                await createTrailRenderPipeline(this.device, this.format, this.isLight, this._wgslConstants || '');
            this._trailPipeline = pipeline;

            // Recreate bind group with same buffers using the new layout
            const oldBG = this._trailBindGroup;
            if (oldBG) {
                // Extract buffer references from existing bind group entries
                // We stored the buffers during initTrailRendering, reuse them
                const b = this.buffers;
                const trailBuffers = this._trailBuffersRef;
                if (trailBuffers) {
                    this._trailBindGroup = this.device.createBindGroup({
                        label: 'trailRender',
                        layout: bindGroupLayout,
                        entries: [
                            { binding: 0, resource: { buffer: this.cameraBuffer } },
                            { binding: 1, resource: { buffer: this._trailUniformBuffer } },
                            { binding: 2, resource: { buffer: trailBuffers.trailX } },
                            { binding: 3, resource: { buffer: trailBuffers.trailY } },
                            { binding: 4, resource: { buffer: trailBuffers.trailWriteIdx } },
                            { binding: 5, resource: { buffer: trailBuffers.trailCount } },
                            { binding: 6, resource: { buffer: b.color } },
                            { binding: 7, resource: { buffer: b.particleState } },
                            { binding: 8, resource: { buffer: b.particleAux } },
                        ],
                    });
                }
            }
            this._trailReady = true;
        } catch (e) {
            console.warn('[physsim] Trail pipeline rebuild failed:', e.message);
        }
    }

    /** Size in CSS px; the backing store is drawn at the device's pixel ratio (up to 2). */
    resize(width, height, dpr = 1) {
        this.dpr = dpr;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.canvasWidth = width;
        this.canvasHeight = height;
    }

    destroy() {
        const _d = b => { if (b) b.destroy(); };
        this.cameraBuffer.destroy();
        _d(this._arrowUniformBuffer);
        _d(this._trailUniformBuffer);
        _d(this._torqueUniformBuffer);
        _d(this._ringUniformBuffer);
        if (this._fieldRenderUniformBuffers) {
            this._fieldRenderUniformBuffers.higgs.destroy();
            this._fieldRenderUniformBuffers.axion.destroy();
        }
        _d(this._heatmapRenderUniformBuffer);
        this._arrowUniformBuffer = null;
        this._trailUniformBuffer = null;
        this._torqueUniformBuffer = null;
        this._ringUniformBuffer = null;
        this._heatmapRenderUniformBuffer = null;
    }
}

// fetchShader imported from gpu-pipelines.js (single source of truth)

_forceLight = GPURenderer._buildForceColors(true);
_forceDark = GPURenderer._buildForceColors(false);
_torqueLight = GPURenderer._buildTorqueColors(true);
_torqueDark = GPURenderer._buildTorqueColors(false);
