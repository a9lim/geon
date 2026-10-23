/**
 * @fileoverview GPUPhysics — WebGPU compute pipeline orchestrator.
 *
 * Phase 2+3+4+5: Full force computation, Boris integrator, tree build, collisions,
 * dead GC, radiation, 1PN VV, boson lifecycle, boson gravity, signal delay history,
 * scalar fields, heatmap, expansion, disintegration.
 *
 * Dispatch sequence per substep:
 *   1. resetForces (DMA clear)
 *   2. cacheDerived
 *   3. generateGhosts        (Phase 3 — if periodic boundary)
 *   4a-d. treeBuild           (Phase 3 — if BH enabled)
 *   5. computeForces          (Phase 2 pairwise OR Phase 3 tree walk)
 *   5b. externalFields
 *   5c. scalarFieldForces      (Phase 5 — gradient forces + mass/axMod modulation, before Boris)
 *   6-8. borisFused            (halfKick + rotate + halfKick in one pass)
 *   9. spinOrbit
 *  10. applyTorques
 *  11. radiationReaction      (Phase 4 — Larmor, Hawking, pion emission)
 *  12. borisDrift
 *  13. cosmologicalExpansion  (Phase 5 — if expansionEnabled)
 *  14. compute1PN_VV          (Phase 4 — 1PN recompute + VV correction kick)
 *  15. scalarFieldEvolve      (Phase 5 — deposit → [self-grav] → KDK → gradients)
 *  17-18. collisions          (Phase 3 — detect + resolve)
 *  19. fieldExcitations       (Phase 5 — merge KE → wave packets)
 *  20. disintegrationCheck    (Phase 5 — tidal + Roche)
 *  21. bosonUpdate            (Phase 4 — photon/pion drift, absorption, decay)
 *  24. boundary
 *
 * Post-substep (once per frame):
 *  - heatmap compute + blur   (Phase 5 — every HEATMAP_INTERVAL frames)
 *  - bosonInteraction         (Phase 4 — build boson tree + particle/boson gravity + pion Coulomb)
 *  - deadParticleGC           (Phase 3)
 *  World lines record at the end of every substep: a sample for every particle when the
 *  substep crosses a WORLDLINE_DT mark, else only merge breaks and new death snapshots.
 *  GPU times are relative to a rolling epoch (gpuTime, _maybeRebaseEpoch).
 */
import { createParticleBuffers, createUniformBuffer, writeFrameUniforms, writeSubstepUniforms, createFieldBuffers, createGravityGridBuffers, createAtomicGridBuffer, createHeatmapBuffers, createExcitationBuffers, createDisintegrationBuffers, createKugelblitzBuffers, createTrailBuffers, createFrameBuffers, FRAME_PARAMS_SIZE, FRAME_STATE_SIZE, FIELD_GRID_RES, PARTICLE_STATE_SIZE, PARTICLE_AUX_SIZE, RADIATION_STATE_SIZE, PHOTON_SIZE, PION_SIZE, DERIVED_SIZE } from './gpu-buffers.js';
import { fetchShader, createPhase2Pipelines, createGhostGenPipeline, createTreeBuildPipelines, createTreeForcePipeline, createCollisionPipelines, createMergePhotonPipeline, createDeadGCPipeline, createPhase4Pipelines, createFieldDepositPipelines, createFieldEvolvePipelines, createFieldForcesPipelines, createFieldParticleGravPipeline, createFieldGravityPipelines, createFFTPipelines, createFieldExcitationPipeline, createHeatmapPipelines, createExpansionPipeline, createDisintegrationPipeline, createBosonDispatchArgsPipeline, createUpdateColorsPipeline, createTrailRecordPipeline, createHitTestPipeline, createComputeStatsPipeline, createFrameSlicePipelines } from './gpu-pipelines.js';
import { buildWGSLConstants, GRAVITY_BIT, COULOMB_BIT, MAGNETIC_BIT, GRAVITOMAG_BIT, ONE_PN_BIT, RELATIVITY_BIT, SPIN_ORBIT_BIT, RADIATION_BIT, BLACK_HOLE_BIT, DISINTEGRATION_BIT, EXPANSION_BIT, YUKAWA_BIT, HIGGS_BIT, AXION_BIT, BARNES_HUT_BIT, BOSON_INTER_BIT, FIELD_GRAV_BIT_T1, HERTZ_BOUNCE_BIT_T1, EM_PAIRWISE_BIT_T1, WL_STRIDE, WL_META_STRIDE } from './gpu-constants.js';
import { createGPUDispatchPlan, updateGPUDispatchPlan } from './pass-graph.js';
import {
    WORLDLINE_DT, WORLDLINE_LEN, GPU_MAX_PHOTONS, GPU_MAX_PIONS, GPU_MAX_LEPTONS,
    GPU_MAX_PARTICLES, GPU_HEATMAP_GRID, HEATMAP_INTERVAL_MASK,
    COL_MERGE, COL_BOUNCE, BOUND_LOOP,
    COL_NAMES, BOUND_NAMES, TOPO_NAMES,
    SOFTENING, BH_SOFTENING, SOFTENING_SQ, BH_SOFTENING_SQ, SHEET_THICKNESS_SQ, CLOCK_PERIOD,
    HIGGS_MASS_FLOOR, HIGGS_MASS_MAX_DELTA, HIGGS_COUPLING, AXION_COUPLING,
    TIDAL_STRENGTH, ROCHE_THRESHOLD, ROCHE_TRANSFER_RATE, MIN_MASS, SPAWN_COUNT, BOSON_CHARGE,
    EPOCH_SPAN, EPOCH_STEP,
} from '../config.js';
import { GPU_PARAMETER_SLOTS } from '../physics-contract.js';
import { fft2d } from '../fft.js';

const MAX_PARTICLES = GPU_MAX_PARTICLES;
const PION_POOL_CAP = GPU_MAX_PIONS + GPU_MAX_LEPTONS;
const BOSON_ARGS_PHOTON = 0;
const BOSON_ARGS_PION = 12;
const BOSON_ARGS_TOTAL = 24;
const BOSON_ARGS_NODES = 36;
const DISINT_FEATURE_BREAKUP = 1;
const DISINT_FEATURE_EXTREMAL = 2;

// Pack palette slate hex to ABGR u32 for WebGPU color buffers
const _sN = parseInt(window._PALETTE.extended.slate.slice(1), 16);
const _DEFAULT_SLATE_ABGR = 0xFF000000 | ((_sN & 0xFF) << 16) | (_sN & 0xFF00) | ((_sN >> 16) & 0xFF);

// Pre-allocated typed arrays for per-frame writeBuffer calls (avoid GC pressure)
const _qtNodeCounterData = new Uint32Array([1]);
const _qtBoundsResetData = new Int32Array([2147483647, 2147483647, -2147483647, -2147483647]);
const _postSubDt = new Float32Array(1); // scratch for writing total dt to uniforms post-substep
const _bosonRootData = new Uint32Array(20);
const _bosonRootF32 = new Float32Array(_bosonRootData.buffer);

// Pre-allocated field uniform data (avoids per-substep GC from _writeFieldUniforms)
const _fieldUniformData = new ArrayBuffer(256);
const _fieldUniformF32 = new Float32Array(_fieldUniformData);
const _fieldUniformU32 = new Uint32Array(_fieldUniformData);

// Pre-allocated dispatch uniform buffers (avoids per-frame GC from dispatch methods)
const _disintUniformData = new ArrayBuffer(64);
const _disintUniformF32 = new Float32Array(_disintUniformData);
const _disintUniformU32 = new Uint32Array(_disintUniformData);
const _heatmapUniformData = new ArrayBuffer(96);
const _heatmapUniformF32 = new Float32Array(_heatmapUniformData);
const _heatmapUniformU32 = new Uint32Array(_heatmapUniformData);
const _colorUniformData = new Uint32Array(4);
const _fgUniformData = new ArrayBuffer(32);  // FGUniforms: domainW, domainH, aliveCount, boundaryMode, topologyMode, _pad×3
const _fgUniformF32 = new Float32Array(_fgUniformData);
const _fgUniformU32 = new Uint32Array(_fgUniformData);

// Pre-allocated addParticle buffers (avoids per-call allocation)
const _addParticleStateData = new ArrayBuffer(36);  // PARTICLE_STATE_SIZE
const _addParticleStateF32 = new Float32Array(_addParticleStateData);
const _addParticleStateU32 = new Uint32Array(_addParticleStateData);
const _addParticleAuxData = new ArrayBuffer(20);     // PARTICLE_AUX_SIZE
const _addParticleAuxF32 = new Float32Array(_addParticleAuxData);
const _addParticleAuxU32 = new Uint32Array(_addParticleAuxData);
const _addParticleColorData = new Uint32Array(1);
const _addParticleModData = new Float32Array(4);
const _addParticleClockData = new Float32Array(4);   // τ, ring phase, θ, lapse
const _birthSampleData = new Float32Array(12);       // one world-line sample (WL_STRIDE)
const _addParticleRadData = new Float32Array(12);    // RADIATION_STATE_SIZE / 4
const _addParticleMetaBuf = new ArrayBuffer(32);       // 8 u32 for wlMeta (WL_META_STRIDE)
const _addParticleMetaU32 = new Uint32Array(_addParticleMetaBuf);
const _addParticleMetaF32 = new Float32Array(_addParticleMetaBuf);
const _zeroU32 = new Uint32Array([0]);                // reusable zero for counter resets
const _retiredFlagU32 = new Uint32Array([2]);         // FLAG_RETIRED for removeParticle
const _frameParamsData = new ArrayBuffer(FRAME_PARAMS_SIZE);
const _frameParamsF32 = new Float32Array(_frameParamsData);
const _frameParamsU32 = new Uint32Array(_frameParamsData);
const _rebaseUniformData = new ArrayBuffer(16);           // shift (f32), slots (u32), pad
const _rebaseUniformF32 = new Float32Array(_rebaseUniformData);
const _rebaseUniformU32 = new Uint32Array(_rebaseUniformData);
const _deathMetaData = new ArrayBuffer(12);           // deathTime(f32), deathMass(f32), deathAngVel(f32)
const _deathMetaF32 = new Float32Array(_deathMetaData);

// Pre-allocated hitTest uniform data (avoids per-call allocation)
const _hitUniformData = new ArrayBuffer(16);
const _hitUniformF32 = new Float32Array(_hitUniformData);
const _hitUniformU32 = new Uint32Array(_hitUniformData);

// Pre-allocated requestStats uniform data (avoids per-call allocation)
const _statsUniformData = new ArrayBuffer(48);
const _statsUniformF32 = new Float32Array(_statsUniformData);
const _statsUniformU32 = new Uint32Array(_statsUniformData);
const _statsUniformI32 = new Int32Array(_statsUniformData);

// FFT stage parameters: one 256-byte uniform record per butterfly stage, written once.
// Stage index = (inverse ? 2·logN : 0) + axis·logN + s.
const FFT_PARAM_STRIDE = 256;

// Pre-allocated field excitation event data (max 64 events × 4 floats)
const _excitationEventData = new Float32Array(64 * 4);
const _excitationCountData = new Uint32Array(1);

// Pre-allocated field vacuum data (reused across _initFieldToVacuum calls)
const _FIELD_GRID_SQ = 128 * 128; // GPU_SCALAR_GRID² (max supported)
const _vacuumFieldData = new Float32Array(_FIELD_GRID_SQ); // Higgs VEV=1 upload

// Pre-allocated Green's hat upload buffer
const _greenHatUploadData = new Float32Array(_FIELD_GRID_SQ * 2);

// G16: Pre-allocated batch deserialize buffers (GPU_MAX_PARTICLES = 512)
// Sized for the full GPU particle capacity so no reallocation is needed.
const _DS_MAX = GPU_MAX_PARTICLES; // 512
const _dsStateData  = new ArrayBuffer(_DS_MAX * 36);  // PARTICLE_STATE_SIZE = 36
const _dsStateF32   = new Float32Array(_dsStateData);
const _dsStateU32   = new Uint32Array(_dsStateData);
const _dsAuxData    = new ArrayBuffer(_DS_MAX * 20);  // PARTICLE_AUX_SIZE = 20
const _dsAuxF32     = new Float32Array(_dsAuxData);
const _dsAuxU32     = new Uint32Array(_dsAuxData);
const _dsColorData  = new Uint32Array(_DS_MAX);        // 4 bytes each
const _dsModData    = new Float32Array(_DS_MAX * 4);   // VEC4_SIZE = 16
const _dsRadData    = new Float32Array(_DS_MAX * 12);  // RADIATION_STATE_SIZE = 48 = 12 f32
const _dsMetaData   = new ArrayBuffer(_DS_MAX * 32);  // wlMeta: WL_META_STRIDE (8) u32 per particle
const _dsMetaF32    = new Float32Array(_dsMetaData);
const _dsMetaU32    = new Uint32Array(_dsMetaData);
const _dsClockData  = new Float32Array(_DS_MAX * 4);   // clocks: τ, phase, θ, lapse

export default class GPUPhysics {
    /**
     * @param {GPUDevice} device
     * @param {number} domainW
     * @param {number} domainH
     */
    constructor(device, domainW, domainH) {
        this.device = device;
        this.domainW = domainW;
        this.domainH = domainH;
        this.simTime = 0;
        this.timeEpoch = 0;   // GPU times are simTime − timeEpoch (gpuTime)
        this.aliveCount = 0;
        // Per-slot generation, bumped whenever addParticle() fills the slot: (slot, generation)
        // names one body across slot reuse (world-line meta word 3)
        this._slotGeneration = new Uint32Array(GPU_MAX_PARTICLES);

        // Defaults matching CPU path
        this.boundaryMode = 0;  // despawn
        this.topologyMode = 0;  // torus

        this.buffers = createParticleBuffers(device, MAX_PARTICLES);
        this.uniformBuffer = createUniformBuffer(device);

        // Phase 1 pipelines
        this._boundaryPipeline = null;
        this._boundaryBindGroup = null;

        // Encoder-side staging buffers for tree build resets.
        // queue.writeBuffer() happens at queue time (before encoder start), so it
        // can't reset state between two tree builds in the same command buffer.
        // These COPY_SRC buffers let us use encoder.copyBufferToBuffer() instead,
        // which executes in-order within the command buffer.
        this._qtCounterSrc = device.createBuffer({
            label: 'qt-counter-src',
            size: 4,
            usage: GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Uint32Array(this._qtCounterSrc.getMappedRange()).set([1]);
        this._qtCounterSrc.unmap();

        this._qtBoundsSrc = device.createBuffer({
            label: 'qt-bounds-src',
            size: 16,
            usage: GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Int32Array(this._qtBoundsSrc.getMappedRange()).set([2147483647, 2147483647, -2147483647, -2147483647]);
        this._qtBoundsSrc.unmap();

        // Encoder-side staging buffer for boson tree root node reset.
        // 20 u32s = 80 bytes — written each frame with current domain dims,
        // then copied to bosonTreeNodes via encoder.copyBufferToBuffer.
        this._bosonRootSrc = device.createBuffer({
            label: 'boson-root-src',
            size: 80,
            usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });

        // Phase 2 pipelines + bind groups
        this._phase2 = null;

        // Phase 3: Ghost generation
        this._ghostGenPipeline = null;
        this._ghostGenBindGroups = null;
        this._ghostCount = 0;
        this._ghostCountPending = false;

        // Phase 3: Tree build (GPU Barnes-Hut)
        this._treeBuild = null;
        this._treeBuildBindGroups = null;
        this._barnesHutEnabled = false;

        // Phase 3: Tree force (BH tree walk)
        this._treeForcePipeline = null;
        this._treeForceBindGroups = null;

        // Phase 3: Collision detection/resolution
        this._collisionPipelines = null;
        this._collisionBindGroups = null;
        this._mergePhotonPipeline = null;
        this._mergePhotonBindGroup = null;
        this._mergeResultsPending = false;
        this._pendingMergeEvents = [];
        this._disintResultsPending = false;
        this._pendingDisintEvents = [];
        this._kbResultsPending = false;
        this._pendingKugelblitzEvents = [];

        // Phase 3: Dead particle GC
        this._deadGCPipeline = null;
        this._deadGCBindGroup = null;

        // Phase 4: Advanced physics pipelines
        this._phase4 = null;
        this._phase4BindGroups = {};

        // World lines: the next lab time at which a sample is due
        this._nextWorldLineTime = 0;
        this._frameCount = 0;

        // Phase 4: Toggle state for advanced passes
        this._relativityEnabled = false;
        this._onePNEnabled = false;
        this._radiationEnabled = false;
        this._yukawaEnabled = false;
        this._bosonInterEnabled = false;

        // Toggle state
        this._toggles0 = 0;
        this._toggles1 = 0;
        this._isDarkTheme = document.documentElement.dataset.theme === 'dark';
        this._gravityEnabled = false;
        this._coulombEnabled = false;
        this._magneticEnabled = false;
        this._gravitomagEnabled = false;
        this._spinOrbitEnabled = false;
        this._blackHoleEnabled = false;
        this._yukawaCoupling = 14;
        this._yukawaMu = 0.15;
        this._higgsMass = 0.5;
        this._axionMass = 0.05;
        this._extGravity = 0;
        this._extGravityAngle = 0;
        this._extElectric = 0;
        this._extElectricAngle = 0;
        this._extBz = 0;
        this._cachedExtGx = 0;
        this._cachedExtGy = 0;
        this._cachedExtEx = 0;
        this._cachedExtEy = 0;
        this._bounceFriction = 0.4;
        this._collisionMode = 0;
        this._axionCoupling = AXION_COUPLING;
        this._higgsCoupling = HIGGS_COUPLING;
        this._dispatchPlan = createGPUDispatchPlan();

        // Phase 5: Scalar field buffers (lazy-allocated on first toggle-on)
        this._higgsBuffers = null;
        this._axionBuffers = null;
        this._atomicGrid = null;
        this._heatmapBuffers = null;
        this._excitationBuffers = null;
        this._disintBuffers = null;
        this._bosonDispatchArgs = null;
        this._higgsEnabled = false;
        this._axionEnabled = false;
        this._expansionEnabled = false;
        this._disintegrationEnabled = false;
        this._hubbleParam = 0.001;
        this._heatmapEnabled = false;
        this._heatmapMode = 'all';
        this._heatmapFrame = 0;

        // Phase 5: Pipelines (lazy-initialized)
        this._phase5Ready = false;
        this._fieldDeposit = null;
        this._fieldEvolve = null;
        this._fieldForces = null;
        this._fieldParticleGrav = null;
        this._fieldGravity = null;
        this._fftPipelines = null;
        this._fftParamsBuffer = null;
        this._fftBGs = null;
        this._greenHatKey = null;
        this._gravGrid = null;      // shared gravity grid (lazy, with the first field)
        this._gravBGs = null;
        this._metricPrimed = false; // metricPhiPrev holds a valid previous potential
        this._fieldExcitation = null;
        this._heatmapPipelines = null;
        this._expansionPipeline = null;
        this._disintPipeline = null;
        this._bosonDispatchArgsPipeline = null;

        // Phase 5: Bind groups (lazy-created per field)
        this._fieldDepositBGs = {};
        this._fieldEvolveBGs = {};
        this._fieldGradBGs = {};
        this._fieldForcesBGs = null;
        this._fieldParticleGravBGs = null;
        this._fieldParticleGravUniform = null;
        this._fieldExcitationBGs = {};
        this._heatmapBGs = null;
        this._heatmapBlurBGs = {};
        this._expansionBG = null;
        this._disintBGs = null;
        this._bosonDispatchArgsBG = null;

        // Phase 5: FieldUniforms buffer (shared)
        this._fieldUniformBuffer = null;
        this._heatmapUniformBuffer = null;
        this._expansionUniformBuffer = null;
        this._disintUniformBuffer = null;

        // Update colors pipeline
        this._updateColorsPipeline = null;
        this._updateColorsBindGroup = null;
        this._colorUniformBuffer = null;

        // Trail recording pipeline + buffers (lazy-allocated)
        this._trailRecordPipeline = null;
        this._trailRecordBindGroup = null;
        this._trailBuffers = null;
        this._trailsEnabled = true; // default on (matches CPU)

        // Hit test pipeline + buffers
        this._hitTestPipeline = null;
        this._hitTestBindGroup = null;
        this._hitUniformBuffer = null;
        this._hitResultBuffer = null;
        this._hitResultStaging = null;
        this._hitPending = false;
        this._hitResultReady = false;
        this._hitStagingI32 = null;
        this._hitStagingF32 = null;

        // Stats readback (compute-stats.wgsl — 4 entry points)
        this._statsPipelines = null;
        this._statsBindGroup0 = null;
        this._statsBindGroup1 = null;
        this._statsGroup0Layout = null;
        this._statsGroup1Layout = null;
        this._statsUniformBuffer = null;
        this._statsDummyBuffer = null;
        this._statsPending = false;
        this._statsResultReady = false;
        this._statsData = null; // Float32Array(128) from readback
        this._statsDataSel = -1; // the selection _statsData was computed for
        this._statsStagingFlip = false; // double-buffer flip
        this._statsFieldHasHiggs = false;
        this._statsFieldHasAxion = false;

        // Free slot management: CPU-side mirror of GPU free stack
        this._cpuFreeSlots = [];
        this._freeTopPending = false;

        // Adaptive substepping state
        this._maxAccel = 0;
        this._maxAccelPending = false;

        this._ready = false;
    }

    /** Load WGSL shaders and create compute pipelines. Must be called before update(). */
    async init() {
        const wgslConstants = buildWGSLConstants();
        // Fetch shared includes + common.wgsl
        const [sharedStructs, sharedTopo, sharedRng, commonSrc, boundaryWGSL] = await Promise.all([
            fetchShader('shared-structs.wgsl'),
            fetchShader('shared-topology.wgsl'),
            fetchShader('shared-rng.wgsl'),
            fetchShader('common.wgsl'),
            fetchShader('boundary.wgsl'),
        ]);
        const commonWGSL = wgslConstants + '\n' + sharedStructs + '\n' + sharedTopo + '\n' + sharedRng + '\n' + commonSrc;

        // --- Boundary pipeline ---
        const boundaryModule = this.device.createShaderModule({
            label: 'boundary',
            code: commonWGSL + '\n' + boundaryWGSL,
        });

        const boundaryBindGroupLayout = this.device.createBindGroupLayout({
            label: 'boundary',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // particleAux
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // allForces
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // clocks
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // wlMeta (decks)
            ],
        });

        this._boundaryPipeline = this.device.createComputePipeline({
            label: 'boundary',
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [boundaryBindGroupLayout] }),
            compute: { module: boundaryModule, entryPoint: 'main' },
        });

        this._boundaryBindGroup = this.device.createBindGroup({
            label: 'boundary',
            layout: boundaryBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.buffers.particleState } },
                { binding: 2, resource: { buffer: this.buffers.particleAux } },
                { binding: 3, resource: { buffer: this.buffers.allForces } },
                { binding: 4, resource: { buffer: this.buffers.clocks } },
                { binding: 5, resource: { buffer: this.buffers.wlMeta } },
            ],
        });

        // --- All pipelines: fetch shaders in parallel ---
        const [phase2, ghostGen, treeBuild, treeForce, collisionPipelines, mergePhotons, deadGC, phase4, updateColors, trailRecord, hitTest, computeStats] =
            await Promise.all([
                createPhase2Pipelines(this.device, wgslConstants),
                createGhostGenPipeline(this.device, wgslConstants),
                createTreeBuildPipelines(this.device, wgslConstants),
                createTreeForcePipeline(this.device, wgslConstants),
                createCollisionPipelines(this.device, wgslConstants),
                createMergePhotonPipeline(this.device, wgslConstants),
                createDeadGCPipeline(this.device, wgslConstants),
                createPhase4Pipelines(this.device, wgslConstants),
                createUpdateColorsPipeline(this.device, wgslConstants),
                createTrailRecordPipeline(this.device, wgslConstants),
                createHitTestPipeline(this.device, wgslConstants),
                createComputeStatsPipeline(this.device, wgslConstants),
            ]);

        // --- Phase 2 ---
        this._phase2 = phase2;
        this._createPhase2BindGroups();

        // --- Ghost gen ---
        this._ghostGenPipeline = ghostGen.pipeline;
        this._createGhostGenBindGroups(ghostGen.bindGroupLayouts);

        // --- Tree build ---
        this._treeBuild = treeBuild;
        this._createTreeBuildBindGroups(this._treeBuild.bindGroupLayouts);

        // --- Tree force ---
        this._treeForcePipeline = treeForce.pipeline;
        this._createTreeForceBindGroups(treeForce.bindGroupLayouts);

        // --- Collision ---
        this._collisionPipelines = collisionPipelines;
        this._createCollisionBindGroups(this._collisionPipelines.bindGroupLayouts);
        this._mergePhotonPipeline = mergePhotons.pipeline;
        this._createMergePhotonBindGroup(mergePhotons.bindGroupLayout);

        // --- Dead GC ---
        this._deadGCPipeline = deadGC.pipeline;
        this._createDeadGCBindGroup(deadGC.bindGroupLayouts);

        // --- Phase 4 ---
        this._phase4 = phase4;
        this._createPhase4BindGroups();

        // --- Update colors ---
        {
            this._updateColorsPipeline = updateColors.pipeline;
            this._colorUniformBuffer = this.device.createBuffer({
                label: 'colorUniforms', size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this._updateColorsBindGroup = this.device.createBindGroup({
                label: 'updateColors',
                layout: updateColors.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this._colorUniformBuffer } },
                    { binding: 1, resource: { buffer: this.buffers.particleState } },
                    { binding: 2, resource: { buffer: this.buffers.color } },
                ],
            });
        }

        // --- Trail record ---
        {
            this._trailRecordPipeline = trailRecord.pipeline;
            this._trailRecordLayout = trailRecord.bindGroupLayout;
        }

        // --- Hit test ---
        {
            this._hitTestPipeline = hitTest.pipeline;
            this._hitUniformBuffer = this.device.createBuffer({
                label: 'hitUniforms', size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            // 12 u32s = 48 bytes: index + mass/charge/radius/vel/angVel/pos + reserved
            this._hitResultBuffer = this.device.createBuffer({
                label: 'hitResult', size: 48,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            });
            this._hitResultStaging = this.device.createBuffer({
                label: 'hitResultStaging', size: 48,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
            this._hitTestBindGroup = this.device.createBindGroup({
                label: 'hitTest',
                layout: hitTest.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this._hitUniformBuffer } },
                    { binding: 1, resource: { buffer: this.buffers.qtNodeBuffer } },
                    { binding: 2, resource: { buffer: this.buffers.particleState } },
                    { binding: 3, resource: { buffer: this.buffers.particleAux } },
                    { binding: 4, resource: { buffer: this._hitResultBuffer } },
                    { binding: 5, resource: { buffer: this.buffers.derived } },
                ],
            });
        }

        // --- Compute stats ---
        {
            this._statsPipelines = computeStats.pipelines;
            this._statsGroup0Layout = computeStats.group0Layout;
            this._statsGroup1Layout = computeStats.group1Layout;
            this._statsUniformBuffer = this.device.createBuffer({
                label: 'statsUniforms', size: 48,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this._statsDummyBuffer = this.device.createBuffer({
                label: 'statsDummy', size: 4,
                usage: GPUBufferUsage.STORAGE,
            });
            this._statsBindGroup0 = this.device.createBindGroup({
                label: 'computeStats_g0',
                layout: computeStats.group0Layout,
                entries: [
                    { binding: 0, resource: { buffer: this._statsUniformBuffer } },
                    { binding: 1, resource: { buffer: this.buffers.particleState } },
                    { binding: 2, resource: { buffer: this.buffers.derived } },
                    { binding: 3, resource: { buffer: this.buffers.allForces } },
                    { binding: 4, resource: { buffer: this.buffers.statsBuffer } },
                    { binding: 5, resource: { buffer: this.buffers.axYukMod } },
                    { binding: 6, resource: { buffer: this.buffers.clocks } },
                ],
            });
            this._statsBindGroup1 = null;
            this._rebuildStatsFieldBindGroup();
        }

        await this._initFrames(wgslConstants);

        this._ready = true;
    }

    // ─── Frames (frame-slice.wgsl) ───

    async _initFrames(wgslConstants) {
        this.frameBuffers = createFrameBuffers(this.device, this.buffers.maxParticles);
        const pl = await createFrameSlicePipelines(this.device, wgslConstants);
        const fb = this.frameBuffers;
        const b = this.buffers;
        this._framePipelines = pl;
        this._frameBG0 = this.device.createBindGroup({
            label: 'frameSlice_g0', layout: pl.bindGroupLayouts[0],
            entries: [fb.frameParams, fb.frameState, b.particleState, b.particleAux, b.wlData, b.wlMeta]
                .map((buffer, i) => ({ binding: i, resource: { buffer } })),
        });
        this._frameBG1 = this.device.createBindGroup({
            label: 'frameSlice_g1', layout: pl.bindGroupLayouts[1],
            entries: [fb.viewState, fb.viewAux, fb.viewDerived, fb.viewClocks]
                .map((buffer, i) => ({ binding: i, resource: { buffer } })),
        });
        this._frameStatePending = false;
        this._frameStateLatest = null;
    }

    /**
     * Slice every world line on the observer's hyperplane (frames.js builds `p`), writing the
     * view buffers the renderer draws in a non-lab frame. Times in `p` are lab times.
     */
    sliceFrame(p) {
        if (!this._framePipelines || this.aliveCount === 0) return;
        const f = _frameParamsF32, u = _frameParamsU32;
        u[0] = p.kind; u[1] = Math.max(0, p.slot | 0); u[2] = p.lorentz ? 1 : 0; u[3] = p.images;
        f[4] = p.boostX; f[5] = p.boostY; f[6] = p.originX; f[7] = p.originY;
        f[8] = p.refT - this.timeEpoch; f[9] = this.gpuTime; f[10] = p.lookBack; f[11] = p.omega;
        f[12] = p.viewX; f[13] = p.viewY; f[14] = p.viewHalfW; f[15] = p.viewHalfH;
        u[16] = this.aliveCount; f[17] = this.domainW; f[18] = this.domainH;
        u[19] = this.boundaryMode === BOUND_LOOP ? 1 : 0; u[20] = this.topologyMode;
        f[21] = WORLDLINE_LEN * WORLDLINE_DT - 1;   // lag cap: the recorded history
        f[22] = 0; f[23] = 0;
        this.device.queue.writeBuffer(this.frameBuffers.frameParams, 0, _frameParamsData);

        const encoder = this.device.createCommandEncoder({ label: 'frameSlice' });
        const pass = encoder.beginComputePass({ label: 'frameSlice' });
        pass.setBindGroup(0, this._frameBG0);
        pass.setBindGroup(1, this._frameBG1);
        pass.setPipeline(this._framePipelines.frameAnchor);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(this._framePipelines.sliceWorldLines);
        pass.dispatchWorkgroups(Math.ceil(this.aliveCount * p.images / 64));
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        this._readbackFrameState();
    }

    /** The observer's state (lag, u, γ, validity) for the HUD, a frame late. */
    _readbackFrameState() {
        if (this._frameStatePending) return;
        this._frameStatePending = true;
        if (!this._frameStateStaging) {
            this._frameStateStaging = this.device.createBuffer({
                label: 'frameStateStaging', size: FRAME_STATE_SIZE,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        }
        const staging = this._frameStateStaging;
        const enc = this.device.createCommandEncoder({ label: 'frameStateReadback' });
        enc.copyBufferToBuffer(this.frameBuffers.frameState, 0, staging, 0, FRAME_STATE_SIZE);
        this.device.queue.submit([enc.finish()]);
        staging.mapAsync(GPUMapMode.READ).then(() => {
            const f = new Float32Array(staging.getMappedRange().slice(0));
            staging.unmap();
            this._frameStateLatest = {
                ux: f[0], uy: f[1], gamma: f[2], tA: f[3] + this.timeEpoch,
                xA: [f[4], f[5]], aNow: [f[6], f[7]], phi: f[8], lag: f[9],
                lorentz: f[10] > 0.5, valid: f[11] > 0.5, omega: f[12], images: f[13], kind: f[17],
            };
        }).catch(() => {}).finally(() => { this._frameStatePending = false; });
    }

    readFrameState() { return this._frameStateLatest; }

    /** Map `copies` ([buffer, offset, bytes]) into one staging buffer; resolves to an ArrayBuffer. */
    async _readRanges(copies, label) {
        const total = copies.reduce((n, c) => n + c[2], 0);
        if (total === 0) return new ArrayBuffer(0);
        const staging = this.device.createBuffer({ label, size: total, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const enc = this.device.createCommandEncoder({ label });
        let at = 0;
        for (const [buf, offset, bytes] of copies) { enc.copyBufferToBuffer(buf, offset, staging, at, bytes); at += bytes; }
        this.device.queue.submit([enc.finish()]);
        try {
            await staging.mapAsync(GPUMapMode.READ);
            return staging.getMappedRange().slice(0);
        } finally {
            if (staging.mapState === 'mapped') staging.unmap();
            staging.destroy();
        }
    }

    /** Every slot's ParticleState and world-line meta: { n, state (ArrayBuffer), meta (Uint32Array) }. */
    async readSlotsSnapshot() {
        const n = this.aliveCount;
        const raw = await this._readRanges([
            [this.buffers.particleState, 0, n * PARTICLE_STATE_SIZE],
            [this.buffers.wlMeta, 0, n * WL_META_STRIDE * 4],
        ], 'slotsSnapshot');
        return { n, state: raw.slice(0, n * PARTICLE_STATE_SIZE), meta: new Uint32Array(raw, n * PARTICLE_STATE_SIZE) };
    }

    /**
     * The world-line rings and meta of `slots`, with the epoch they were read at:
     * { epoch, meta: Uint32Array[slot meta], rings: Float32Array[WL_LEN·WL_STRIDE] per slot }.
     */
    async readWorldLines(slots) {
        const ringBytes = WORLDLINE_LEN * WL_STRIDE * 4;
        const metaBytes = WL_META_STRIDE * 4;
        const copies = [];
        for (const s of slots) copies.push([this.buffers.wlMeta, s * metaBytes, metaBytes]);
        for (const s of slots) copies.push([this.buffers.wlData, s * ringBytes, ringBytes]);
        const epoch = this.timeEpoch;
        const raw = await this._readRanges(copies, 'worldLines');
        const k = slots.length;
        return {
            epoch,
            meta: slots.map((_, i) => new Uint32Array(raw, i * metaBytes, WL_META_STRIDE)),
            rings: slots.map((_, i) => new Float32Array(raw, k * metaBytes + i * ringBytes, WORLDLINE_LEN * WL_STRIDE)),
        };
    }

    _createPhase2BindGroups() {
        const b = this.buffers;
        const p2 = this._phase2;

        // Helper to create a bind group from layout + buffer list
        const bg = (label, layout, buffers) =>
            this.device.createBindGroup({
                label,
                layout,
                entries: buffers.map((buf, i) => ({ binding: i, resource: { buffer: buf } })),
            });

        // cacheDerived: uniforms + particleState (packed) + derived + particleAux + axYukMod
        this._bg_cacheDerived = bg('cacheDerived', p2.cacheDerived.bindGroupLayouts[0],
            [this.uniformBuffer, b.particleState, b.derived, b.particleAux, b.axYukMod]);

        // pairForce: 4 bind groups (packed structs)
        this._bg_pairForce0 = bg('pairForce_g0', p2.pairForce.bindGroupLayouts[0],
            [this.uniformBuffer]);
        this._bg_pairForce1 = bg('pairForce_g1', p2.pairForce.bindGroupLayouts[1],
            [b.particleState, b.derived, b.axYukMod, b.particleAux]);
        this._bg_pairForce2 = bg('pairForce_g2', p2.pairForce.bindGroupLayouts[2],
            [b.allForces, b.maxAccelBuffer]);
        // Group 3: world lines (signal delay)
        this._bg_pairForce3 = bg('pairForce_g3', p2.pairForce.bindGroupLayouts[3],
            [b.wlData, b.wlMeta]);

        // externalFields (packed particleState + allForces)
        this._bg_extFields = bg('extFields', p2.externalFields.bindGroupLayouts[0],
            [this.uniformBuffer, b.particleState, b.allForces]);

        // borisFused (halfKick + rotate + halfKick in one pass)
        this._bg_borisFused = bg('borisFused', p2.borisFused.bindGroupLayouts[0],
            [this.uniformBuffer, b.particleState, b.allForces]);

        // borisDrift (writes vel to derived, reads/writes particleState + allForces for display force reconstruction)
        this._bg_drift = bg('drift', p2.borisDrift.bindGroupLayouts[0],
            [this.uniformBuffer, b.particleState, b.derived, b.allForces]);

        // spinOrbit (packed particleState, derived, allForces)
        this._bg_spinOrbit = bg('spinOrbit', p2.spinOrbit.bindGroupLayouts[0],
            [this.uniformBuffer, b.particleState, b.derived, b.allForces]);

        // applyTorques (reads from particleState, allForces, writes derived)
        this._bg_torques = bg('torques', p2.applyTorques.bindGroupLayouts[0],
            [this.uniformBuffer, b.particleState, b.allForces, b.derived]);

        // saveF1pn (save 1PN forces before Boris kick for VV correction)
        this._bg_saveF1pn = bg('saveF1pn', p2.saveF1pn.bindGroupLayouts[0],
            [this.uniformBuffer, b.allForces, b.f1pnOld, b.particleState]);
    }

    /**
     * Create bind groups for ghost generation pipeline.
     * Ghost output arrays are views into the same SoA buffers at offset = aliveCount.
     * Since ghost writes use atomicAdd for slot allocation, the output buffers are the
     * SAME buffers as input but the shader writes starting at the ghost slot offset.
     */
    _createGhostGenBindGroups(layouts) {
        const b = this.buffers;
        const bg = (label, layout, entries) =>
            this.device.createBindGroup({
                label,
                layout,
                entries: entries.map((buf, i) => ({ binding: i, resource: { buffer: buf } })),
            });

        // Group 0: read-only particle state (packed struct)
        const group0 = bg('ghostGen_g0', layouts[0],
            [b.particleState]);

        // Group 1: ghost output + derived inputs/outputs + aux
        const group1 = bg('ghostGen_g1', layouts[1],
            [b.ghostState, b.ghostAux, b.derived, b.ghostDerived, b.particleAux]);

        // Group 2: ghostCounter + uniforms + ghostOriginalIdx
        const group2 = bg('ghostGen_g2', layouts[2],
            [b.ghostCounter, this.uniformBuffer, b.ghostOriginalIdx]);

        this._ghostGenBindGroups = [group0, group1, group2];
    }

    /**
     * Dispatch ghost generation before tree build (Phase 3).
     * Only runs when boundary is LOOP (periodic).
     * Resets ghost counter, dispatches shader, then copies ghost data into main SoA arrays.
     */
    _dispatchGhostGen(encoder) {
        if (this.boundaryMode !== BOUND_LOOP) {
            this._ghostCount = 0;
            return;
        }

        // Reset ghost counter to 0
        encoder.clearBuffer(this.buffers.ghostCounter, 0, 4);

        const pass = encoder.beginComputePass({ label: 'ghostGen' });
        pass.setPipeline(this._ghostGenPipeline);
        pass.setBindGroup(0, this._ghostGenBindGroups[0]);
        pass.setBindGroup(1, this._ghostGenBindGroups[1]);
        pass.setBindGroup(2, this._ghostGenBindGroups[2]);
        pass.dispatchWorkgroups(Math.ceil(this.aliveCount / 64));
        pass.end();

        // Copy ghost data from dedicated buffers into main arrays at offset aliveCount.
        // Uses previous frame's ghost count for copy size (1-frame latency, safe for tree build).
        const ghostCount = this._ghostCount;
        if (ghostCount > 0) {
            const b = this.buffers;
            // Copy packed ParticleState structs (36 bytes per element)
            const stateOffset = this.aliveCount * PARTICLE_STATE_SIZE;
            const stateBytes = ghostCount * PARTICLE_STATE_SIZE;
            encoder.copyBufferToBuffer(b.ghostState, 0, b.particleState, stateOffset, stateBytes);
            // Copy packed ParticleAux structs (20 bytes per element)
            const auxOffset = this.aliveCount * PARTICLE_AUX_SIZE;
            const auxBytes = ghostCount * PARTICLE_AUX_SIZE;
            encoder.copyBufferToBuffer(b.ghostAux, 0, b.particleAux, auxOffset, auxBytes);
            // Copy ParticleDerived structs (32 bytes per element)
            const derivedOffset = this.aliveCount * DERIVED_SIZE;
            const derivedBytes = ghostCount * DERIVED_SIZE;
            encoder.copyBufferToBuffer(b.ghostDerived, 0, b.derived, derivedOffset, derivedBytes);
        }
    }

    /**
     * Create bind groups for tree build pipelines.
     * All 4 entry points share the same bind group layouts.
     */
    _createTreeBuildBindGroups(layouts) {
        const b = this.buffers;

        // Group 0: tree state buffers
        this._treeBuildBG0 = this.device.createBindGroup({
            label: 'treeBuild_g0',
            layout: layouts[0],
            entries: [
                { binding: 0, resource: { buffer: b.qtNodeBuffer } },
                { binding: 1, resource: { buffer: b.qtNodeCounter } },
                { binding: 2, resource: { buffer: b.qtBoundsBuffer } },
                { binding: 3, resource: { buffer: b.qtVisitorFlags } },
            ],
        });

        // Group 1: particle state (packed struct) + derived + aux
        this._treeBuildBG1 = this.device.createBindGroup({
            label: 'treeBuild_g1',
            layout: layouts[1],
            entries: [
                { binding: 0, resource: { buffer: b.particleState } },
                { binding: 1, resource: { buffer: b.derived } },
                { binding: 2, resource: { buffer: b.particleAux } },
            ],
        });

        // Group 2: uniforms
        this._treeBuildBG2 = this.device.createBindGroup({
            label: 'treeBuild_g2',
            layout: layouts[2],
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
            ],
        });
    }

    /**
     * Create bind groups for tree force (BH walk) pipeline.
     * Group 0: nodes (read-only) + uniforms
     * Group 1: particle SoA (15 read-only) + ghostOriginalIdx
     * Group 2: force accumulators (5 read-write)
     */
    _createTreeForceBindGroups(layouts) {
        const b = this.buffers;

        // Group 0: tree nodes + uniforms
        this._treeForceGroup0 = this.device.createBindGroup({
            label: 'treeForce_g0',
            layout: layouts[0],
            entries: [
                { binding: 0, resource: { buffer: b.qtNodeBuffer } },
                { binding: 1, resource: { buffer: this.uniformBuffer } },
            ],
        });

        // Group 1: packed particle structs + derived + axYukMod
        this._treeForceGroup1 = this.device.createBindGroup({
            label: 'treeForce_g1',
            layout: layouts[1],
            entries: [
                { binding: 0, resource: { buffer: b.particleState } },
                { binding: 1, resource: { buffer: b.particleAux } },
                { binding: 2, resource: { buffer: b.derived } },
                { binding: 3, resource: { buffer: b.axYukMod } },
                { binding: 4, resource: { buffer: b.ghostOriginalIdx } },
            ],
        });

        // Group 2: allForces + maxAccel (radiationState removed — jerk now in AllForces)
        this._treeForceGroup2 = this.device.createBindGroup({
            label: 'treeForce_g2',
            layout: layouts[2],
            entries: [
                { binding: 0, resource: { buffer: b.allForces } },
                { binding: 1, resource: { buffer: b.maxAccelBuffer } },
            ],
        });

        // Group 3: world lines (signal delay)
        this._treeForceGroup3 = this.device.createBindGroup({
            label: 'treeForce_g3',
            layout: layouts[3],
            entries: [
                { binding: 0, resource: { buffer: b.wlData } },
                { binding: 1, resource: { buffer: b.wlMeta } },
            ],
        });
    }

    /**
     * Create bind groups for collision detection/resolution pipelines.
     * Both detectCollisions and resolveCollisions share the same layout.
     */
    _createCollisionBindGroups(layouts) {
        const b = this.buffers;

        // Group 0: tree nodes (read-only) + uniforms
        this._collisionBG0 = this.device.createBindGroup({
            label: 'collision_g0',
            layout: layouts[0],
            entries: [
                { binding: 0, resource: { buffer: b.qtNodeBuffer } },
                { binding: 1, resource: { buffer: this.uniformBuffer } },
            ],
        });

        // Group 1: packed particle structs + ghost mapping + allForces (contact torque)
        this._collisionBG1 = this.device.createBindGroup({
            label: 'collision_g1',
            layout: layouts[1],
            entries: [
                { binding: 0, resource: { buffer: b.particleState } },
                { binding: 1, resource: { buffer: b.particleAux } },
                { binding: 2, resource: { buffer: b.ghostOriginalIdx } },
                { binding: 3, resource: { buffer: b.allForces } },
                { binding: 4, resource: { buffer: b.collisionClaims } },
            ],
        });

        // Group 2: collision pairs + counters + merge results
        this._collisionBG2 = this.device.createBindGroup({
            label: 'collision_g2',
            layout: layouts[2],
            entries: [
                { binding: 0, resource: { buffer: b.collisionPairBuffer } },
                { binding: 1, resource: { buffer: b.collisionPairCounter } },
                { binding: 2, resource: { buffer: b.mergeResultBuffer } },
                { binding: 3, resource: { buffer: b.mergeResultCounter } },
            ],
        });
    }

    _createMergePhotonBindGroup(layout) {
        const b = this.buffers;
        this._mergePhotonBindGroup = this.device.createBindGroup({
            label: 'mergePhotons_g0',
            layout,
            entries: [
                { binding: 0, resource: { buffer: b.mergeResultBuffer } },
                { binding: 1, resource: { buffer: b.mergeResultCounter } },
                { binding: 2, resource: { buffer: b.photonPool } },
                { binding: 3, resource: { buffer: b.phCount } },
            ],
        });
    }

    /**
     * Create bind group for dead particle GC pipeline.
     */
    _createDeadGCBindGroup(layouts) {
        const b = this.buffers;
        this._deadGCBindGroup = this.device.createBindGroup({
            label: 'deadGC_g0',
            layout: layouts[0],
            entries: [
                { binding: 0, resource: { buffer: b.particleState } },
                { binding: 1, resource: { buffer: b.particleAux } },
                { binding: 2, resource: { buffer: this.uniformBuffer } },
                { binding: 3, resource: { buffer: b.freeStack } },
                { binding: 4, resource: { buffer: b.freeTop } },
            ],
        });
    }

    /**
     * Create bind groups for all Phase 4 pipelines.
     */
    _createPhase4BindGroups() {
        const b = this.buffers;
        const p4 = this._phase4;
        const bg = (label, layout, buffers) =>
            this.device.createBindGroup({
                label,
                layout,
                entries: buffers.map((buf, i) => ({ binding: i, resource: { buffer: buf } })),
            });

        // ── World lines and clocks ──
        this._phase4BindGroups.worldLineG0 = bg('worldline_g0', p4.recordWorldLines.bindGroupLayouts[0],
            [this.uniformBuffer, b.particleState, b.allForces, b.clocks, b.particleAux]);
        this._rebaseUniformBuffer = this.device.createBuffer({
            label: 'worldlineRebaseUniforms', size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._phase4BindGroups.rebaseG0 = bg('worldlineRebase_g0', p4.rebaseWorldLines.bindGroupLayouts[0],
            [this._rebaseUniformBuffer, b.wlData, b.wlMeta, b.particleAux]);
        this._phase4BindGroups.worldLineG1 = bg('worldline_g1', p4.recordWorldLines.bindGroupLayouts[1],
            [b.wlData, b.wlMeta]);
        this._phase4BindGroups.clocksG0 = bg('clocks_g0', p4.advanceClocks.bindGroupLayouts[0],
            [this.uniformBuffer, b.particleState, b.derived, b.allForces, b.clocks]);

        // ── 1PN (compute1PN + vvKick1PN share bind groups) ──
        this._phase4BindGroups.onePNG0 = bg('onePN_g0', p4.compute1PN.bindGroupLayouts[0],
            [this.uniformBuffer]);
        this._phase4BindGroups.onePNG1 = bg('onePN_g1', p4.compute1PN.bindGroupLayouts[1],
            [b.particleState, b.derived, b.axYukMod]);
        this._phase4BindGroups.onePNG2 = bg('onePN_g2', p4.compute1PN.bindGroupLayouts[2],
            [b.allForces, b.f1pnOld]);
        this._phase4BindGroups.onePNG3 = bg('onePN_g3', p4.compute1PN.bindGroupLayouts[3],
            [b.wlData, b.wlMeta]);

        // ── 1PN Tree Walk (compute1PNTree — shares G0, G2 with pairwise) ──
        this._phase4BindGroups.onePNTreeG1 = bg('onePNTree_g1', p4.compute1PNTree.bindGroupLayouts[1],
            [b.particleState, b.derived, b.axYukMod, b.ghostOriginalIdx]);
        this._phase4BindGroups.onePNTreeG3 = bg('onePNTree_g3', p4.compute1PNTree.bindGroupLayouts[3],
            [b.wlData, b.wlMeta, b.qtNodeBuffer]);

        // ── Radiation (larmorRadiation, hawkingRadiation, pionEmission share bind groups) ──
        this._phase4BindGroups.radG0 = bg('radiation_g0', p4.larmorRadiation.bindGroupLayouts[0],
            [this.uniformBuffer]);
        // Group 1: packed particle state + aux + derived + allForces + radiationState + axYukMod
        this._phase4BindGroups.radG1 = bg('radiation_g1', p4.larmorRadiation.bindGroupLayouts[1],
            [b.particleState, b.particleAux, b.derived, b.allForces, b.radiationState, b.axYukMod]);
        // Group 2: photon pool (packed) + phCount
        this._phase4BindGroups.radG2 = bg('radiation_g2', p4.larmorRadiation.bindGroupLayouts[2],
            [b.photonPool, b.phCount]);
        // Group 3: pion pool (packed) + piCount
        this._phase4BindGroups.radG3 = bg('radiation_g3', p4.larmorRadiation.bindGroupLayouts[3],
            [b.pionPool, b.piCount]);

        // ── Quadrupole radiation (quadrupoleCoM, quadrupoleContrib, quadrupoleApply share bind groups) ──
        this._phase4BindGroups.quadG0 = bg('quadrupole_g0', p4.quadrupoleCoM.bindGroupLayouts[0],
            [this.uniformBuffer]);
        this._phase4BindGroups.quadG1 = bg('quadrupole_g1', p4.quadrupoleCoM.bindGroupLayouts[1],
            [b.particleState, b.particleAux, b.derived, b.allForces, b.radiationState]);
        this._phase4BindGroups.quadG2 = bg('quadrupole_g2', p4.quadrupoleCoM.bindGroupLayouts[2],
            [b.photonPool, b.phCount]);
        this._phase4BindGroups.quadG3 = bg('quadrupole_g3', p4.quadrupoleCoM.bindGroupLayouts[3],
            [b.quadReductionBuf]);

        // ── Bosons (updatePhotons, updatePions, absorbPhotons, absorbPions, decayPions) ──
        this._phase4BindGroups.bosG0 = bg('bosons_g0', p4.updatePhotons.bindGroupLayouts[0],
            [this.uniformBuffer, b.poolMgmt]);
        this._phase4BindGroups.bosG1 = bg('bosons_g1', p4.updatePhotons.bindGroupLayouts[1],
            [b.particleState, b.particleAux]);
        this._phase4BindGroups.bosG2 = bg('bosons_g2', p4.updatePhotons.bindGroupLayouts[2],
            [b.photonPool, b.phCount]);
        this._phase4BindGroups.bosG3 = bg('bosons_g3', p4.updatePhotons.bindGroupLayouts[3],
            [b.pionPool, b.piCount]);

        // ── Boson Tree Walk (updatePhotonsTree, updatePionsTree, absorbPhotonsTree, absorbPionsTree) ──
        // Group 1 adds tree nodes buffer at binding 2; groups 0,2,3 shared with non-tree variants.
        this._phase4BindGroups.bosTreeG1 = bg('bosonsTree_g1', p4.updatePhotonsTree.bindGroupLayouts[1],
            [b.particleState, b.particleAux, b.qtNodeBuffer]);

        // ── Boson Tree (insertBosonsIntoTree, computeBosonAggregates, computeBosonGravity, applyBosonBosonGravity) ──
        // Group 0: uniforms + tree nodes (atomic) + counter + visitor flags
        this._phase4BindGroups.btG0 = bg('bosonTree_g0', p4.insertBosonsIntoTree.bindGroupLayouts[0],
            [this.uniformBuffer, b.bosonTreeNodes, b.bosonTreeCounter, b.bosonVisitorFlags]);
        this._phase4BindGroups.btG1 = bg('bosonTree_g1', p4.insertBosonsIntoTree.bindGroupLayouts[1],
            [b.photonPool, b.phCount]);
        this._phase4BindGroups.btG2 = bg('bosonTree_g2', p4.insertBosonsIntoTree.bindGroupLayouts[2],
            [b.pionPool, b.piCount, b.pionClaims]);
        this._phase4BindGroups.btG3 = bg('bosonTree_g3', p4.insertBosonsIntoTree.bindGroupLayouts[3],
            [b.particleState, b.allForces]);

        // ── Kugelblitz Collapse ──
        // Groups 0-2 reuse boson tree bind groups; group 3 is kugelblitz event output
        if (p4.checkKugelblitz) {
            if (!this._kbBuffers) {
                this._kbBuffers = createKugelblitzBuffers(this.device);
            }
            this._phase4BindGroups.kbG3 = bg('kugelblitz_g3', p4.checkKugelblitz.bindGroupLayouts[3],
                [this._kbBuffers.events, this._kbBuffers.counter]);
        }
    }

    /**
     * Dispatch radiation reaction passes (Phase 4, Pass 11).
     * Runs after Boris half-kick 2 and torques, before drift.
     */
    _dispatchRadiation(encoder, plan = updateGPUDispatchPlan(this, this._dispatchPlan)) {
        if (!plan.radiation) return;

        const workgroups = Math.ceil(this.aliveCount / 64);
        const bgs = this._phase4BindGroups;
        const p4 = this._phase4;

        // Larmor radiation (requires Coulomb + Radiation)
        if (plan.larmorRadiation) {
            const passLarmor = encoder.beginComputePass({ label: 'larmorRadiation' });
            passLarmor.setPipeline(p4.larmorRadiation.pipeline);
            passLarmor.setBindGroup(0, bgs.radG0);
            passLarmor.setBindGroup(1, bgs.radG1);
            passLarmor.setBindGroup(2, bgs.radG2);
            passLarmor.setBindGroup(3, bgs.radG3);
            passLarmor.dispatchWorkgroups(workgroups);
            passLarmor.end();
        }

        // Hawking radiation (requires Black Hole + Radiation)
        if (plan.hawkingRadiation) {
            const passHawking = encoder.beginComputePass({ label: 'hawkingRadiation' });
            passHawking.setPipeline(p4.hawkingRadiation.pipeline);
            passHawking.setBindGroup(0, bgs.radG0);
            passHawking.setBindGroup(1, bgs.radG1);
            passHawking.setBindGroup(2, bgs.radG2);
            passHawking.setBindGroup(3, bgs.radG3);
            passHawking.dispatchWorkgroups(workgroups);
            passHawking.end();
        }

        // Pion emission (requires Yukawa + Radiation)
        if (plan.pionEmission) {
            const passPion = encoder.beginComputePass({ label: 'pionEmission' });
            passPion.setPipeline(p4.pionEmission.pipeline);
            passPion.setBindGroup(0, bgs.radG0);
            passPion.setBindGroup(1, bgs.radG1);
            passPion.setBindGroup(2, bgs.radG2);
            passPion.setBindGroup(3, bgs.radG3);
            passPion.dispatchWorkgroups(workgroups);
            passPion.end();
        }

        // Schwinger discharge (requires Black Hole + Coulomb)
        if (plan.schwingerDischarge) {
            const passSchwinger = encoder.beginComputePass({ label: 'schwingerDischarge' });
            passSchwinger.setPipeline(p4.schwingerDischarge.pipeline);
            passSchwinger.setBindGroup(0, bgs.radG0);
            passSchwinger.setBindGroup(1, bgs.radG1);
            passSchwinger.setBindGroup(2, bgs.radG2);
            passSchwinger.setBindGroup(3, bgs.radG3);
            passSchwinger.dispatchWorkgroups(workgroups);
            passSchwinger.end();
        }
    }

    /**
     * Dispatch quadrupole radiation passes (once per frame, after all substeps).
     * Requires Radiation + (Gravity or Coulomb) + at least 2 particles.
     * Three dispatches: CoM reduction → d³ contribution reduction → apply + emit.
     */
    _dispatchQuadrupole(encoder) {
        if (!this._radiationEnabled) return;
        if (this.aliveCount < 2) return;
        // Requires gravity or coulomb (same guard as CPU)
        const t0 = this._toggles0;
        if (!(t0 & GRAVITY_BIT) && !(t0 & COULOMB_BIT)) return; // neither gravity nor coulomb

        const workgroups = Math.ceil(this.aliveCount / 64);
        const bgs = this._phase4BindGroups;
        const p4 = this._phase4;

        function setBindGroups(pass) {
            pass.setBindGroup(0, bgs.quadG0);
            pass.setBindGroup(1, bgs.quadG1);
            pass.setBindGroup(2, bgs.quadG2);
            pass.setBindGroup(3, bgs.quadG3);
        }

        // Pass 1: Reduce CoM + totalKE
        const p1 = encoder.beginComputePass({ label: 'quadrupoleCoM' });
        p1.setPipeline(p4.quadrupoleCoM.pipeline);
        setBindGroups(p1);
        p1.dispatchWorkgroups(workgroups);
        p1.end();

        // Pass 2: Compute d³I/d³Q contributions + reduce
        const p2 = encoder.beginComputePass({ label: 'quadrupoleContrib' });
        p2.setPipeline(p4.quadrupoleContrib.pipeline);
        setBindGroups(p2);
        p2.dispatchWorkgroups(workgroups);
        p2.end();

        // Pass 3: Apply drag + accumulate + emit photons/gravitons
        const p3 = encoder.beginComputePass({ label: 'quadrupoleApply' });
        p3.setPipeline(p4.quadrupoleApply.pipeline);
        setBindGroups(p3);
        p3.dispatchWorkgroups(workgroups);
        p3.end();
    }

    /**
     * Dispatch 1PN velocity-Verlet correction (Phase 4, Pass 14).
     * After drift: rebuild tree if BH on, recompute 1PN via tree walk, apply VV kick.
     * Falls back to O(N²) pairwise when Barnes-Hut is off.
     */
    _dispatch1PNVV(encoder) {
        if (!this._onePNEnabled) return;

        const workgroups = Math.ceil(this.aliveCount / 64);
        const bgs = this._phase4BindGroups;
        const p4 = this._phase4;

        // Step 1: Recompute 1PN forces at post-drift positions
        if (this._barnesHutEnabled) {
            // Rebuild tree at post-drift positions for VV correction
            this._dispatchGhostGen(encoder);
            this._dispatchTreeBuild(encoder);

            const passCompute = encoder.beginComputePass({ label: 'compute1PNTree' });
            passCompute.setPipeline(p4.compute1PNTree.pipeline);
            passCompute.setBindGroup(0, bgs.onePNG0);
            passCompute.setBindGroup(1, bgs.onePNTreeG1);
            passCompute.setBindGroup(2, bgs.onePNG2);
            passCompute.setBindGroup(3, bgs.onePNTreeG3);
            passCompute.dispatchWorkgroups(workgroups);
            passCompute.end();
        } else {
            const passCompute = encoder.beginComputePass({ label: 'compute1PN' });
            passCompute.setPipeline(p4.compute1PN.pipeline);
            passCompute.setBindGroup(0, bgs.onePNG0);
            passCompute.setBindGroup(1, bgs.onePNG1);
            passCompute.setBindGroup(2, bgs.onePNG2);
            passCompute.setBindGroup(3, bgs.onePNG3);
            passCompute.dispatchWorkgroups(workgroups);
            passCompute.end();
        }

        // Step 2: Apply VV correction kick
        const passKick = encoder.beginComputePass({ label: 'vvKick1PN' });
        passKick.setPipeline(p4.vvKick1PN.pipeline);
        passKick.setBindGroup(0, bgs.onePNG0);
        passKick.setBindGroup(1, bgs.onePNG1);
        passKick.setBindGroup(2, bgs.onePNG2);
        passKick.setBindGroup(3, bgs.onePNG3);
        passKick.dispatchWorkgroups(workgroups);
        passKick.end();
    }

    /**
     * Dispatch boson update passes (Phase 4, Pass 21).
     * Photon/pion drift, absorption, pion decay.
     * Skipped entirely when radiation and Yukawa are both off (no bosons can exist).
     */
    _dispatchBosonUpdate(encoder, plan = updateGPUDispatchPlan(this, this._dispatchPlan)) {
        // Pions exist from Yukawa emission; leptons exist from Yukawa (pion decay) or Schwinger (BH+Coulomb)
        if (!plan.bosonUpdate) return;
        const p4 = this._phase4;
        const bgs = this._phase4BindGroups;
        const useBHTree = this._barnesHutEnabled;

        // Select tree or pairwise pipelines for lensing + absorption
        const phUpdatePipeline = useBHTree ? p4.updatePhotonsTree.pipeline : p4.updatePhotons.pipeline;
        const piUpdatePipeline = useBHTree ? p4.updatePionsTree.pipeline : p4.updatePions.pipeline;
        const phAbsorbPipeline = useBHTree ? p4.absorbPhotonsTree.pipeline : p4.absorbPhotons.pipeline;
        const piAbsorbPipeline = useBHTree ? p4.absorbPionsTree.pipeline : p4.absorbPions.pipeline;
        const g1 = useBHTree ? bgs.bosTreeG1 : bgs.bosG1;

        // G12: Skip photon passes when radiation is off (no photons can exist).
        // Pion/lepton passes needed for Yukawa pions OR Schwinger leptons.
        const hasPhotons = plan.photonUpdate;
        const hasPions   = plan.pionUpdate;
        const useIndirect = this._writeBosonDispatchArgs(encoder);

        if (hasPhotons) {
            // updatePhotons: drift + lensing
            const passPhotons = encoder.beginComputePass({ label: 'updatePhotons' });
            passPhotons.setPipeline(phUpdatePipeline);
            passPhotons.setBindGroup(0, bgs.bosG0);
            passPhotons.setBindGroup(1, g1);
            passPhotons.setBindGroup(2, bgs.bosG2);
            passPhotons.setBindGroup(3, bgs.bosG3);
            if (useIndirect) passPhotons.dispatchWorkgroupsIndirect(this._bosonDispatchArgs, BOSON_ARGS_PHOTON);
            else passPhotons.dispatchWorkgroups(Math.ceil(GPU_MAX_PHOTONS / 64));
            passPhotons.end();
        }

        if (hasPions) {
            // updatePions: drift with proper velocity
            const passPions = encoder.beginComputePass({ label: 'updatePions' });
            passPions.setPipeline(piUpdatePipeline);
            passPions.setBindGroup(0, bgs.bosG0);
            passPions.setBindGroup(1, g1);
            passPions.setBindGroup(2, bgs.bosG2);
            passPions.setBindGroup(3, bgs.bosG3);
            if (useIndirect) passPions.dispatchWorkgroupsIndirect(this._bosonDispatchArgs, BOSON_ARGS_PION);
            else passPions.dispatchWorkgroups(Math.ceil(PION_POOL_CAP / 64));
            passPions.end();
        }

        if (hasPhotons) {
            // absorbPhotons (single-threaded: serialized to avoid f32 data races)
            const passAbsorbPh = encoder.beginComputePass({ label: 'absorbPhotons' });
            passAbsorbPh.setPipeline(phAbsorbPipeline);
            passAbsorbPh.setBindGroup(0, bgs.bosG0);
            passAbsorbPh.setBindGroup(1, g1);
            passAbsorbPh.setBindGroup(2, bgs.bosG2);
            passAbsorbPh.setBindGroup(3, bgs.bosG3);
            passAbsorbPh.dispatchWorkgroups(1);
            passAbsorbPh.end();
        }

        if (hasPions) {
            // absorbPions (single-threaded: serialized to avoid f32 data races)
            const passAbsorbPi = encoder.beginComputePass({ label: 'absorbPions' });
            passAbsorbPi.setPipeline(piAbsorbPipeline);
            passAbsorbPi.setBindGroup(0, bgs.bosG0);
            passAbsorbPi.setBindGroup(1, g1);
            passAbsorbPi.setBindGroup(2, bgs.bosG2);
            passAbsorbPi.setBindGroup(3, bgs.bosG3);
            passAbsorbPi.dispatchWorkgroups(1);
            passAbsorbPi.end();
        }
    }

    /**
     * Dispatch pion decay (once per frame, NOT per substep), on each pion's proper time
     * over the frame's whole lab interval.
     */
    _dispatchPionDecay(encoder) {
        // G12: Pions only exist when Yukawa is on; skip entirely otherwise.
        if (!this._yukawaEnabled) return;
        const p4 = this._phase4;
        const bgs = this._phase4BindGroups;
        const useIndirect = this._writeBosonDispatchArgs(encoder);
        const passDecay = encoder.beginComputePass({ label: 'decayPions' });
        passDecay.setPipeline(p4.decayPions.pipeline);
        passDecay.setBindGroup(0, bgs.bosG0);
        passDecay.setBindGroup(1, bgs.bosG1);
        passDecay.setBindGroup(2, bgs.bosG2);
        passDecay.setBindGroup(3, bgs.bosG3);
        if (useIndirect) passDecay.dispatchWorkgroupsIndirect(this._bosonDispatchArgs, BOSON_ARGS_PION);
        else passDecay.dispatchWorkgroups(Math.ceil(PION_POOL_CAP / 64));
        passDecay.end();
    }

    /**
     * Dispatch boson interaction passes (Phase 4).
     * Runs once per frame after all substeps: build boson tree, gravity, Coulomb, annihilation.
     */
    _dispatchBosonInteraction(encoder, plan = updateGPUDispatchPlan(this, this._dispatchPlan)) {
        if (!plan.bosonInteraction) return;

        const p4 = this._phase4;
        const bgs = this._phase4BindGroups;
        const b = this.buffers;

        // Reset boson tree node counter to 1 (root = node 0).
        // Uses encoder.copyBufferToBuffer (not queue.writeBuffer) so the reset
        // executes in-order within the command buffer. Reuses _qtCounterSrc
        // (same static [1] data as the particle tree counter reset).
        encoder.copyBufferToBuffer(this._qtCounterSrc, 0, b.bosonTreeCounter, 0, 4);

        // Clear visitor flags before insertion
        encoder.clearBuffer(b.bosonVisitorFlags);

        // Initialize root node (reuse pre-allocated arrays to avoid GC)
        // Child pointers (words 14-17) = 0xFFFFFFFF (NONE), particleIdx (18) = 0xFFFFFFFF, parent (19) = 0xFFFFFFFF
        _bosonRootData.fill(0);
        _bosonRootF32[0] = 0;              // minX
        _bosonRootF32[1] = 0;              // minY
        _bosonRootF32[2] = this.domainW;   // maxX
        _bosonRootF32[3] = this.domainH;   // maxY
        _bosonRootData[14] = 0xFFFFFFFF;   // NW = NONE
        _bosonRootData[15] = 0xFFFFFFFF;   // NE = NONE
        _bosonRootData[16] = 0xFFFFFFFF;   // SW = NONE
        _bosonRootData[17] = 0xFFFFFFFF;   // SE = NONE
        _bosonRootData[18] = 0xFFFFFFFF;   // particleIdx = NONE
        _bosonRootData[19] = 0xFFFFFFFF;   // parent = NONE (-1)
        // Write root data to staging buffer (queue time), then copy to tree nodes
        // (encoder time) so the reset is ordered correctly within the command buffer.
        this.device.queue.writeBuffer(this._bosonRootSrc, 0, _bosonRootData);
        encoder.copyBufferToBuffer(this._bosonRootSrc, 0, b.bosonTreeNodes, 0, 80);

        const totalBosons = GPU_MAX_PHOTONS + PION_POOL_CAP;
        const useIndirect = this._writeBosonDispatchArgs(encoder);
        const bosonWG = Math.ceil(totalBosons / 64);

        // insertBosonsIntoTree
        const passInsert = encoder.beginComputePass({ label: 'insertBosonsIntoTree' });
        passInsert.setPipeline(p4.insertBosonsIntoTree.pipeline);
        passInsert.setBindGroup(0, bgs.btG0);
        passInsert.setBindGroup(1, bgs.btG1);
        passInsert.setBindGroup(2, bgs.btG2);
        passInsert.setBindGroup(3, bgs.btG3);
        if (useIndirect) passInsert.dispatchWorkgroupsIndirect(this._bosonDispatchArgs, BOSON_ARGS_TOTAL);
        else passInsert.dispatchWorkgroups(bosonWG);
        passInsert.end();

        // computeBosonAggregates (one thread per boson, bottom-up leaf->root walk)
        const passAgg = encoder.beginComputePass({ label: 'computeBosonAggregates' });
        passAgg.setPipeline(p4.computeBosonAggregates.pipeline);
        passAgg.setBindGroup(0, bgs.btG0);
        passAgg.setBindGroup(1, bgs.btG1);
        passAgg.setBindGroup(2, bgs.btG2);
        passAgg.setBindGroup(3, bgs.btG3);
        if (useIndirect) passAgg.dispatchWorkgroupsIndirect(this._bosonDispatchArgs, BOSON_ARGS_TOTAL);
        else passAgg.dispatchWorkgroups(bosonWG);
        passAgg.end();

        // computeBosonGravity: particle <- boson gravity (only when gravity enabled)
        if (this._gravityEnabled) {
            const particleWG = Math.ceil(this.aliveCount / 64);
            if (particleWG > 0) {
                const passGrav = encoder.beginComputePass({ label: 'computeBosonGravity' });
                passGrav.setPipeline(p4.computeBosonGravity.pipeline);
                passGrav.setBindGroup(0, bgs.btG0);
                passGrav.setBindGroup(1, bgs.btG1);
                passGrav.setBindGroup(2, bgs.btG2);
                passGrav.setBindGroup(3, bgs.btG3);
                passGrav.dispatchWorkgroups(particleWG);
                passGrav.end();
            }

            // applyBosonBosonGravity: boson <-> boson mutual gravity
            const passBosonBoson = encoder.beginComputePass({ label: 'applyBosonBosonGravity' });
            passBosonBoson.setPipeline(p4.applyBosonBosonGravity.pipeline);
            passBosonBoson.setBindGroup(0, bgs.btG0);
            passBosonBoson.setBindGroup(1, bgs.btG1);
            passBosonBoson.setBindGroup(2, bgs.btG2);
            passBosonBoson.setBindGroup(3, bgs.btG3);
            if (useIndirect) passBosonBoson.dispatchWorkgroupsIndirect(this._bosonDispatchArgs, BOSON_ARGS_TOTAL);
            else passBosonBoson.dispatchWorkgroups(bosonWG);
            passBosonBoson.end();
        }

        // applyPionPionCoulomb: pion <-> pion Coulomb via boson tree (only when Coulomb enabled)
        if (this._coulombEnabled) {
            const passPiCoulomb = encoder.beginComputePass({ label: 'applyPionPionCoulomb' });
            passPiCoulomb.setPipeline(p4.applyPionPionCoulomb.pipeline);
            passPiCoulomb.setBindGroup(0, bgs.btG0);
            passPiCoulomb.setBindGroup(1, bgs.btG1);
            passPiCoulomb.setBindGroup(2, bgs.btG2);
            passPiCoulomb.setBindGroup(3, bgs.btG3);
            if (useIndirect) passPiCoulomb.dispatchWorkgroupsIndirect(this._bosonDispatchArgs, BOSON_ARGS_PION);
            else passPiCoulomb.dispatchWorkgroups(Math.ceil(PION_POOL_CAP / 64));
            passPiCoulomb.end();
        }

        // annihilatePions: π⁺π⁻ → 2 photons
        {
            // Reset pion claim buffer (must use copyBufferToBuffer within encoder, not queue.writeBuffer)
            encoder.clearBuffer(b.pionClaims);
            const passAnnihilate = encoder.beginComputePass({ label: 'annihilatePions' });
            passAnnihilate.setPipeline(p4.annihilatePions.pipeline);
            passAnnihilate.setBindGroup(0, bgs.btG0);
            passAnnihilate.setBindGroup(1, bgs.btG1);
            passAnnihilate.setBindGroup(2, bgs.btG2);
            passAnnihilate.setBindGroup(3, bgs.btG3);
            if (useIndirect) passAnnihilate.dispatchWorkgroupsIndirect(this._bosonDispatchArgs, BOSON_ARGS_PION);
            else passAnnihilate.dispatchWorkgroups(Math.ceil(PION_POOL_CAP / 64));
            passAnnihilate.end();
        }

        // Kugelblitz: boson energy density exceeds hoop conjecture → massive particle
        if (this._gravityEnabled && p4.checkKugelblitz && this._kbBuffers && bgs.kbG3) {
            encoder.clearBuffer(this._kbBuffers.counter, 0, 4);
            const passKB = encoder.beginComputePass({ label: 'checkKugelblitz' });
            passKB.setPipeline(p4.checkKugelblitz.pipeline);
            passKB.setBindGroup(0, bgs.btG0);
            passKB.setBindGroup(1, bgs.btG1);
            passKB.setBindGroup(2, bgs.btG2);
            passKB.setBindGroup(3, bgs.kbG3);
            if (useIndirect) passKB.dispatchWorkgroupsIndirect(this._bosonDispatchArgs, BOSON_ARGS_NODES);
            else passKB.dispatchWorkgroups(Math.ceil(totalBosons * 6 / 64));
            passKB.end();
        }
    }

    /** Advance every particle's proper-time clock and spoke angle (clocks.wgsl). */
    _dispatchClocks(encoder) {
        const pass = encoder.beginComputePass({ label: 'advanceClocks' });
        pass.setPipeline(this._phase4.advanceClocks.pipeline);
        pass.setBindGroup(0, this._phase4BindGroups.clocksG0);
        pass.dispatchWorkgroups(Math.ceil(this.aliveCount / 64));
        pass.end();
    }

    /**
     * World lines (worldline.wgsl), every substep: a sample for every particle when one is
     * due, else only the breaks that merges left and the snapshots of new deaths.
     */
    _dispatchRecordWorldLines(encoder, due) {
        const bgs = this._phase4BindGroups;
        const pass = encoder.beginComputePass({ label: due ? 'recordWorldLines' : 'recordBreaks' });
        pass.setPipeline(due ? this._phase4.recordWorldLines.pipeline : this._phase4.recordBreaks.pipeline);
        pass.setBindGroup(0, bgs.worldLineG0);
        pass.setBindGroup(1, bgs.worldLineG1);
        pass.dispatchWorkgroups(Math.ceil(this.aliveCount / 64));
        pass.end();
    }

    /** GPU time: lab time relative to the rolling epoch (config.js EPOCH_SPAN). */
    get gpuTime() { return this.simTime - this.timeEpoch; }

    /**
     * Advance the epoch by EPOCH_STEP once GPU time passes EPOCH_SPAN: every stored GPU time
     * shifts back, and each world line is recentred on its tile (worldline-rebase.wgsl).
     */
    _maybeRebaseEpoch() {
        if (this.gpuTime < EPOCH_SPAN) return;
        _rebaseUniformF32[0] = EPOCH_STEP;
        _rebaseUniformU32[1] = this.buffers.maxParticles;
        this.device.queue.writeBuffer(this._rebaseUniformBuffer, 0, _rebaseUniformData);
        const encoder = this.device.createCommandEncoder({ label: 'worldlineRebase' });
        const pass = encoder.beginComputePass({ label: 'rebaseWorldLines' });
        pass.setPipeline(this._phase4.rebaseWorldLines.pipeline);
        pass.setBindGroup(0, this._phase4BindGroups.rebaseG0);
        pass.dispatchWorkgroups(Math.ceil(this.buffers.maxParticles / 64));
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        this.timeEpoch += EPOCH_STEP;
    }

    /**
     * Dispatch dead particle garbage collection (Phase 3).
     * Runs once per frame (not per substep), after all substeps complete.
     */
    _dispatchDeadGC(encoder) {
        if (this.aliveCount === 0) return;

        const pass = encoder.beginComputePass({ label: 'deadGC' });
        pass.setPipeline(this._deadGCPipeline);
        pass.setBindGroup(0, this._deadGCBindGroup);
        pass.dispatchWorkgroups(Math.ceil(this.buffers.maxParticles / 64));
        pass.end();
    }

    /**
     * Dispatch collision detection and resolution (Phase 3).
     * Always uses tree-accelerated broadphase (tree built every substep).
     *
     * COL_PASS (0):   skip entirely.
     * COL_MERGE (1):  tree detect → resolveCollisions (merge/annihilation).
     * COL_BOUNCE (2): tree detect → resolveBouncePairwise (Hertz impulse).
     */
    _dispatchCollisions(encoder) {
        if (this._collisionMode === 0) return; // COL_PASS — nothing to do
        if (this.aliveCount === 0) return;

        const b = this.buffers;
        const isMerge  = this._collisionMode === COL_MERGE;
        const isBounce = this._collisionMode === COL_BOUNCE;

        // Reset pair counter (and merge counter for merge mode)
        encoder.clearBuffer(b.collisionPairCounter, 0, 4);
        if (isMerge) encoder.clearBuffer(b.mergeResultCounter, 0, 4);
        encoder.clearBuffer(b.collisionClaims, 0, this.aliveCount * 4);

        // ── Detection phase (always tree-accelerated) ──
        const detectWG = Math.ceil(this.aliveCount / 64);
        const passDetect = encoder.beginComputePass({ label: 'detectCollisions' });
        passDetect.setPipeline(this._collisionPipelines.detectCollisions);
        passDetect.setBindGroup(0, this._collisionBG0);
        passDetect.setBindGroup(1, this._collisionBG1);
        passDetect.setBindGroup(2, this._collisionBG2);
        passDetect.dispatchWorkgroups(detectWG);
        passDetect.end();

        // ── Resolution phase ──
        // Conservatively dispatch enough workgroups to cover worst-case pair count.
        // Each shader reads pairCounter atomically and exits early for out-of-range threads.
        const resolveWG = Math.ceil(b.maxParticles / 64);
        if (isMerge) {
            const passResolve = encoder.beginComputePass({ label: 'resolveCollisions' });
            passResolve.setPipeline(this._collisionPipelines.resolveCollisions);
            passResolve.setBindGroup(0, this._collisionBG0);
            passResolve.setBindGroup(1, this._collisionBG1);
            passResolve.setBindGroup(2, this._collisionBG2);
            passResolve.dispatchWorkgroups(resolveWG);
            passResolve.end();

            if (this._mergePhotonPipeline && this._mergePhotonBindGroup) {
                const passPhotons = encoder.beginComputePass({ label: 'mergePhotons' });
                passPhotons.setPipeline(this._mergePhotonPipeline);
                passPhotons.setBindGroup(0, this._mergePhotonBindGroup);
                passPhotons.dispatchWorkgroups(resolveWG);
                passPhotons.end();
            }
        } else if (isBounce) {
            const passResolve = encoder.beginComputePass({ label: 'resolveBouncePairwise' });
            passResolve.setPipeline(this._collisionPipelines.resolveBouncePairwise);
            passResolve.setBindGroup(0, this._collisionBG0);
            passResolve.setBindGroup(1, this._collisionBG1);
            passResolve.setBindGroup(2, this._collisionBG2);
            passResolve.dispatchWorkgroups(resolveWG);
            passResolve.end();
        }
    }

    /**
     * Non-blocking readback of merge results for post-processing by JS.
     * Returns pending merge events for field excitations and debugging.
     * Uses 1-frame latency like other readbacks.
     */
    async _readbackMergeResults() {
        if (this._mergeResultsPending) return;
        if (this._collisionMode !== COL_MERGE) return;
        this._mergeResultsPending = true;

        try {
            const b = this.buffers;
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(b.mergeResultCounter, 0, b.mergeCountStaging, 0, 4);
            this.device.queue.submit([encoder.finish()]);

            await b.mergeCountStaging.mapAsync(GPUMapMode.READ);
            const countData = new Uint32Array(b.mergeCountStaging.getMappedRange().slice(0));
            b.mergeCountStaging.unmap();

            const mergeCount = countData[0];
            if (mergeCount > 0) {
                const eventStride = 8;
                const readCount = Math.min(mergeCount, this.buffers.maxParticles);
                const readBytes = readCount * eventStride * 4;
                const encoder2 = this.device.createCommandEncoder();
                encoder2.copyBufferToBuffer(b.mergeResultBuffer, 0, b.mergeResultStaging, 0, readBytes);
                this.device.queue.submit([encoder2.finish()]);

                await b.mergeResultStaging.mapAsync(GPUMapMode.READ);
                const resultData = new Float32Array(b.mergeResultStaging.getMappedRange(0, readBytes).slice(0));
                b.mergeResultStaging.unmap();

                // Parse merge events: two vec4s, {x,y,energy,type} + {px,py,pad,pad}
                const events = [];
                for (let i = 0; i < readCount; i++) {
                    const base = i * eventStride;
                    events.push({
                        x: resultData[base],
                        y: resultData[base + 1],
                        energy: resultData[base + 2],
                        type: resultData[base + 3] < 0.5 ? 'annihilation' : 'merge',
                        px: resultData[base + 4],
                        py: resultData[base + 5],
                    });
                }
                this._pendingMergeEvents = events;
            } else {
                this._pendingMergeEvents = [];
            }
        } catch (e) {
            // Device lost or other error — don't block future readbacks
        } finally {
            this._mergeResultsPending = false;
        }
    }

    /**
     * Consume pending merge events.
     * @returns {Array} Array of { x, y, energy, px, py, type } events
     */
    consumeMergeEvents() {
        const events = this._pendingMergeEvents;
        this._pendingMergeEvents = [];
        return events;
    }

    /**
     * Non-blocking readback of disintegration events (fragment + Roche transfer).
     * Uses 1-frame latency like other readbacks.
     */
    async _readbackDisintegrationResults() {
        if (this._disintResultsPending) return;
        if (!this._disintegrationEnabled || !this._disintBuffers) return;
        this._disintResultsPending = true;

        try {
            const db = this._disintBuffers;
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(db.counter, 0, db.counterStaging, 0, 4);
            this.device.queue.submit([encoder.finish()]);

            await db.counterStaging.mapAsync(GPUMapMode.READ);
            const countData = new Uint32Array(db.counterStaging.getMappedRange().slice(0));
            db.counterStaging.unmap();

            const eventCount = countData[0];
            if (eventCount > 0) {
                const readBytes = Math.min(eventCount, 64) * 48; // DisintEvent = 48 bytes
                const encoder2 = this.device.createCommandEncoder();
                encoder2.copyBufferToBuffer(db.events, 0, db.staging, 0, readBytes);
                this.device.queue.submit([encoder2.finish()]);

                await db.staging.mapAsync(GPUMapMode.READ);
                const raw = db.staging.getMappedRange(0, readBytes);
                const f32 = new Float32Array(raw.slice(0));
                const u32 = new Uint32Array(raw.slice(0));
                db.staging.unmap();

                // Parse DisintEvent structs (12 fields × 4 bytes = 48 bytes each)
                const events = [];
                const count = Math.min(eventCount, 64);
                for (let i = 0; i < count; i++) {
                    const base = i * 12;
                    events.push({
                        particleIdx: u32[base],
                        eventType: u32[base + 1],    // 0=fragment, 1=transfer
                        targetIdx: u32[base + 2],
                        transferMass: f32[base + 3],
                        spawnX: f32[base + 4],
                        spawnY: f32[base + 5],
                        spawnVX: f32[base + 6],
                        spawnVY: f32[base + 7],
                        mass: f32[base + 8],
                        charge: f32[base + 9],
                        angW: f32[base + 10],
                        radius: f32[base + 11],
                    });
                }
                this._pendingDisintEvents = events;
            } else {
                this._pendingDisintEvents = [];
            }
        } catch (e) {
            // Device lost or other error — don't block future readbacks
        } finally {
            this._disintResultsPending = false;
        }
    }

    /**
     * Consume pending disintegration events.
     * @returns {Array} Array of DisintEvent objects
     */
    consumeDisintegrationEvents() {
        const events = this._pendingDisintEvents;
        this._pendingDisintEvents = [];
        return events;
    }

    /**
     * Non-blocking readback of kugelblitz collapse events.
     * Max 1 event per substep (32 bytes = 8 × f32).
     */
    async _readbackKugelblitzResults() {
        if (this._kbResultsPending) return;
        if (!this._kbBuffers) return;
        this._kbResultsPending = true;

        try {
            const kb = this._kbBuffers;

            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(kb.counter, 0, kb.counterStaging, 0, 4);
            this.device.queue.submit([encoder.finish()]);

            await kb.counterStaging.mapAsync(GPUMapMode.READ);
            const countData = new Uint32Array(kb.counterStaging.getMappedRange().slice(0));
            kb.counterStaging.unmap();

            const eventCount = countData[0];
            if (eventCount > 0) {
                const encoder2 = this.device.createCommandEncoder();
                encoder2.copyBufferToBuffer(kb.events, 0, kb.staging, 0, 48);
                this.device.queue.submit([encoder2.finish()]);

                await kb.staging.mapAsync(GPUMapMode.READ);
                const f32 = new Float32Array(kb.staging.getMappedRange(0, 48).slice(0));
                kb.staging.unmap();

                this._pendingKugelblitzEvents = [{
                    x: f32[0], y: f32[1],
                    px: f32[2], py: f32[3],
                    energy: f32[4], charge: f32[5],
                    angL: f32[6], count: f32[7],
                    radiatedEnergy: f32[8], radiatedPx: f32[9], radiatedPy: f32[10],
                }];
            } else {
                this._pendingKugelblitzEvents = [];
            }
        } catch (e) {
            // Device lost or other error
        } finally {
            this._kbResultsPending = false;
        }
    }

    consumeKugelblitzEvents() {
        const events = this._pendingKugelblitzEvents;
        this._pendingKugelblitzEvents = [];
        return events;
    }

    /**
     * Dispatch tree build sequence (always runs — used by collisions, hit test,
     * and optionally by BH tree-walk force computation).
     * Runs after ghost generation, before force computation.
     *
     * Sequence:
     *   1. Reset nodeCounter to 1 (root = node 0, pre-allocated)
     *   2. Reset bounds to (INT_MAX, INT_MAX, INT_MIN, INT_MIN)
     *   3. Clear visitor flags to 0
     *   4. computeBounds: ceil(totalCount / 256) workgroups
     *   5. initRoot: 1 workgroup (single thread)
     *   6. insertParticles: ceil(totalCount / 64) workgroups
     *   7. computeAggregates: ceil(totalCount / 64) workgroups
     */
    _dispatchTreeBuild(encoder) {

        const totalCount = this.aliveCount + this._ghostCount;
        if (totalCount === 0) return;

        const b = this.buffers;

        // 1-2. Reset nodeCounter and bounds via encoder.copyBufferToBuffer.
        // MUST be encoder ops (not queue.writeBuffer) because _dispatchTreeBuild
        // may be called twice per substep (before forces + after drift for 1PN VV).
        // queue.writeBuffer executes at queue time (before encoder starts), so a
        // second call can't reset state between two tree builds in the same encoder.
        encoder.copyBufferToBuffer(this._qtCounterSrc, 0, b.qtNodeCounter, 0, 4);
        encoder.copyBufferToBuffer(this._qtBoundsSrc, 0, b.qtBoundsBuffer, 0, 16);

        // 3. Clear ALL visitor flags (not just totalCount*6 — a second tree build
        // in the same substep allocates nodes beyond that range).
        const clearSize = Math.min(b.QT_MAX_NODES * 4, b.qtVisitorFlags.size);
        encoder.clearBuffer(b.qtVisitorFlags, 0, clearSize);

        // 4. computeBounds dispatch
        const boundsWG = Math.ceil(totalCount / 256);
        const pass1 = encoder.beginComputePass({ label: 'computeBounds' });
        pass1.setPipeline(this._treeBuild.computeBounds);
        pass1.setBindGroup(0, this._treeBuildBG0);
        pass1.setBindGroup(1, this._treeBuildBG1);
        pass1.setBindGroup(2, this._treeBuildBG2);
        pass1.dispatchWorkgroups(boundsWG);
        pass1.end();

        // 5. initRoot dispatch (single thread reads bounds, writes root node)
        const pass2 = encoder.beginComputePass({ label: 'initRoot' });
        pass2.setPipeline(this._treeBuild.initRoot);
        pass2.setBindGroup(0, this._treeBuildBG0);
        pass2.setBindGroup(1, this._treeBuildBG1);
        pass2.setBindGroup(2, this._treeBuildBG2);
        pass2.dispatchWorkgroups(1);
        pass2.end();

        // 6. insertParticles dispatch
        const insertWG = Math.ceil(totalCount / 64);
        const pass3 = encoder.beginComputePass({ label: 'insertParticles' });
        pass3.setPipeline(this._treeBuild.insertParticles);
        pass3.setBindGroup(0, this._treeBuildBG0);
        pass3.setBindGroup(1, this._treeBuildBG1);
        pass3.setBindGroup(2, this._treeBuildBG2);
        pass3.dispatchWorkgroups(insertWG);
        pass3.end();

        // 7. computeAggregates dispatch
        const aggWG = Math.ceil(totalCount / 64);
        const pass4 = encoder.beginComputePass({ label: 'computeAggregates' });
        pass4.setPipeline(this._treeBuild.computeAggregates);
        pass4.setBindGroup(0, this._treeBuildBG0);
        pass4.setBindGroup(1, this._treeBuildBG1);
        pass4.setBindGroup(2, this._treeBuildBG2);
        pass4.dispatchWorkgroups(aggWG);
        pass4.end();
    }

    /**
     * Non-blocking readback of ghost count for tree build sizing.
     * Uses 1-frame latency like maxAccel readback.
     */
    async _readbackGhostCount() {
        if (this._ghostCountPending) return;
        if (this.boundaryMode !== BOUND_LOOP) {
            this._ghostCount = 0;
            return;
        }
        this._ghostCountPending = true;

        try {
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(this.buffers.ghostCounter, 0,
                this.buffers.ghostCountStaging, 0, 4);
            this.device.queue.submit([encoder.finish()]);

            await this.buffers.ghostCountStaging.mapAsync(GPUMapMode.READ);
            const data = new Uint32Array(this.buffers.ghostCountStaging.getMappedRange().slice(0));
            this.buffers.ghostCountStaging.unmap();

            this._ghostCount = data[0];
        } catch (e) {
            // Device lost or other error — don't block future readbacks
        } finally {
            this._ghostCountPending = false;
        }
    }

    /**
     * Add a particle to the GPU buffers.
     * Reuses free slots from dead GC when available, otherwise appends.
     */
    /**
     * Write a new particle into a free slot. vx, vy are proper velocity. The clock starts
     * at τ = tau, θ = theta, unless inheritClockFrom names a slot whose clock to copy
     * (a fragment or a transferred mass carries its parent's age and orientation).
     * bornAt is the lab time signal delay treats as the particle's birth: now by default,
     * so its field spreads out at c; −Infinity for initial conditions, which are taken
     * to have moved uniformly forever.
     * @returns {number} slot index, or -1 when the pool is full
     */
    addParticle({ x, y, vx = 0, vy = 0, mass: m = 1, charge: q = 0, angw = 0, antimatter = false,
                  tau = 0, theta = 0, inheritClockFrom = -1, bornAt = null }) {
        let idx;
        if (this._cpuFreeSlots.length > 0) {
            // Reuse a slot freed by dead GC
            idx = this._cpuFreeSlots.pop();
        } else {
            idx = this.aliveCount;
            if (idx >= MAX_PARTICLES) return -1;
            this.aliveCount++;
        }

        // Write packed ParticleState struct (36 bytes = 9 × f32/u32) using pre-allocated buffers
        _addParticleStateF32[0] = x;          // posX
        _addParticleStateF32[1] = y;          // posY
        _addParticleStateF32[2] = vx;         // velWX
        _addParticleStateF32[3] = vy;         // velWY
        _addParticleStateF32[4] = m;          // mass
        _addParticleStateF32[5] = Math.round(q / BOSON_CHARGE) * BOSON_CHARGE; // charge (quantized)
        _addParticleStateF32[6] = angw;       // angW
        _addParticleStateF32[7] = m;          // baseMass
        let flags = FLAG_ALIVE;
        if (antimatter && !this._blackHoleEnabled) flags |= FLAG_ANTIMATTER;
        _addParticleStateU32[8] = flags;
        this.device.queue.writeBuffer(this.buffers.particleState, idx * PARTICLE_STATE_SIZE, _addParticleStateData);

        // Write packed ParticleAux struct (20 bytes = 5 × f32/u32)
        _addParticleAuxF32[0] = Math.cbrt(m); // radius
        _addParticleAuxU32[1] = idx;          // particleId
        _addParticleAuxF32[2] = 3.4028235e38;     // deathTime (not dead)
        _addParticleAuxF32[3] = 0;            // deathMass
        _addParticleAuxF32[4] = 0;            // deathAngVel
        this.device.queue.writeBuffer(this.buffers.particleAux, idx * PARTICLE_AUX_SIZE, _addParticleAuxData);

        // Pack color: neutral slate -> ABGR (update-colors shader will refresh)
        _addParticleColorData[0] = _DEFAULT_SLATE_ABGR;
        this.device.queue.writeBuffer(this.buffers.color, idx * 4, _addParticleColorData);

        // cacheDerived shader computes derived state before forces each substep.
        // No need to initialize derived here — but axYukMod must be set to (1, 1).
        _addParticleModData[0] = 1.0; // axMod
        _addParticleModData[1] = 1.0; // yukMod
        _addParticleModData[2] = 1.0; // higgsMod
        _addParticleModData[3] = 0.0; // pad
        this.device.queue.writeBuffer(this.buffers.axYukMod, idx * 16, _addParticleModData);

        // Initialize radiationState to zero (jerk, accumulators, display force)
        _addParticleRadData.fill(0);
        this.device.queue.writeBuffer(this.buffers.radiationState, idx * RADIATION_STATE_SIZE, _addParticleRadData);

        // Clock: fresh, or copied from the parent's slot (still intact while retired)
        if (inheritClockFrom >= 0) {
            // A buffer can't be copied onto itself, so go through a 16-byte scratch
            if (!this._clockScratch) {
                this._clockScratch = this.device.createBuffer({
                    label: 'clockScratch', size: 16, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
                });
            }
            const enc = this.device.createCommandEncoder({ label: 'inheritClock' });
            enc.copyBufferToBuffer(this.buffers.clocks, inheritClockFrom * 16, this._clockScratch, 0, 16);
            enc.copyBufferToBuffer(this._clockScratch, 0, this.buffers.clocks, idx * 16, 16);
            this.device.queue.submit([enc.finish()]);
        } else {
            _addParticleClockData[0] = tau;
            _addParticleClockData[1] = tau - CLOCK_PERIOD * Math.floor(tau / CLOCK_PERIOD);
            _addParticleClockData[2] = theta;
            _addParticleClockData[3] = 1;
            this.device.queue.writeBuffer(this.buffers.clocks, idx * 16, _addParticleClockData);
        }

        // Reset trail ring buffer for this slot (clear writeIdx + count)
        if (this._trailBuffers) {
            const tb = this._trailBuffers;
            this.device.queue.writeBuffer(tb.trailWriteIdx, idx * 4, _zeroU32);
            this.device.queue.writeBuffer(tb.trailCount, idx * 4, _zeroU32);
        }

        // World line: one sample at birth, so signal delay has a state to extrapolate
        // from before the first recorded one. Meta (shared-worldline.wgsl): writeIdx, count,
        // creation time, generation, and an identity deck (the cover starts on the domain).
        this._writeBirthSample(idx, x, y, vx, vy, m, q, angw, tau, theta);
        this._slotGeneration[idx]++;
        _addParticleMetaU32.fill(0);
        _addParticleMetaU32[0] = 1;
        _addParticleMetaU32[1] = 1;
        _addParticleMetaF32[2] = bornAt == null ? this.gpuTime : bornAt - this.timeEpoch;
        _addParticleMetaU32[3] = this._slotGeneration[idx];
        this.device.queue.writeBuffer(this.buffers.wlMeta, idx * WL_META_STRIDE * 4, _addParticleMetaBuf);
        return idx;
    }

    /**
     * Remove a particle from the GPU by marking it dead (clearing ALIVE, setting RETIRED).
     * Writes death metadata for signal delay fade-out matching collision/boundary shaders.
     * The dead GC shader will reclaim the slot after the signal delay expiry window.
     * @param {number} idx - GPU buffer index of the particle to remove
     * @param {number} deathMass - particle mass at time of death
     * @param {number} deathAngVel - particle angular velocity at time of death
     */
    removeParticle(idx, deathMass = 0, deathAngVel = 0) {
        if (idx < 0 || idx >= this.aliveCount) return;
        // Clear ALIVE bit, set RETIRED bit in flags (byte offset 8 in ParticleState = 32 bytes in)
        // ParticleState: posX(0), posY(4), velWX(8), velWY(12), mass(16), charge(20), angW(24), baseMass(28), flags(32)
        this.device.queue.writeBuffer(this.buffers.particleState, idx * PARTICLE_STATE_SIZE + 32, _retiredFlagU32);
        // Write death metadata to ParticleAux: deathTime(offset 8), deathMass(12), deathAngVel(16)
        _deathMetaF32[0] = this.gpuTime;
        _deathMetaF32[1] = deathMass;
        _deathMetaF32[2] = deathAngVel;
        this.device.queue.writeBuffer(this.buffers.particleAux, idx * PARTICLE_AUX_SIZE + 8, _deathMetaData);
    }

    /** Write a particle's first world-line sample (ring slot 0) at the current time. */
    _writeBirthSample(idx, x, y, wx, wy, m, q, angw, tau, theta) {
        const f = _birthSampleData;
        f[0] = this.gpuTime; f[1] = x; f[2] = y; f[3] = wx; f[4] = wy;
        f[5] = 0; f[6] = 0; f[7] = tau; f[8] = theta; f[9] = angw; f[10] = m; f[11] = q;
        this.device.queue.writeBuffer(this.buffers.wlData, idx * WORLDLINE_LEN * WL_STRIDE * 4, f);
    }

    /**
     * Pack toggle booleans into u32 bitfields for GPU uniforms.
     * Must be called whenever a toggle changes.
     */
    setToggles(physics) {
        let t0 = 0;
        if (physics.gravityEnabled) t0 |= GRAVITY_BIT;
        if (physics.coulombEnabled) t0 |= COULOMB_BIT;
        if (physics.magneticEnabled) t0 |= MAGNETIC_BIT;
        if (physics.gravitomagEnabled) t0 |= GRAVITOMAG_BIT;
        if (physics.onePNEnabled) t0 |= ONE_PN_BIT;
        if (physics.relativityEnabled) t0 |= RELATIVITY_BIT;
        if (physics.spinOrbitEnabled) t0 |= SPIN_ORBIT_BIT;
        if (physics.radiationEnabled) t0 |= RADIATION_BIT;
        if (physics.blackHoleEnabled) t0 |= BLACK_HOLE_BIT;
        if (physics.disintegrationEnabled) t0 |= DISINTEGRATION_BIT;
        if (physics.expansionEnabled) t0 |= EXPANSION_BIT;
        if (physics.yukawaEnabled) t0 |= YUKAWA_BIT;
        if (physics.higgsEnabled) t0 |= HIGGS_BIT;
        if (physics.axionEnabled) t0 |= AXION_BIT;
        if (physics.barnesHutEnabled) t0 |= BARNES_HUT_BIT;
        if (physics.bosonInterEnabled) t0 |= BOSON_INTER_BIT;
        this._toggles0 = t0;

        let t1 = 0;
        if (physics.gravityEnabled) t1 |= FIELD_GRAV_BIT_T1; // field gravity follows gravity
        if (physics.collisionMode === COL_BOUNCE) t1 |= HERTZ_BOUNCE_BIT_T1;
        this._emPairwise = physics.barnesHutEnabled && physics.relativityEnabled
            && (physics.coulombEnabled || physics.magneticEnabled);
        if (this._emPairwise) t1 |= EM_PAIRWISE_BIT_T1;
        this._toggles1 = t1;

        this._isDarkTheme = document.documentElement.dataset.theme === 'dark';
        this._gravityEnabled = physics.gravityEnabled;
        this._coulombEnabled = physics.coulombEnabled;
        this._magneticEnabled = physics.magneticEnabled;
        this._gravitomagEnabled = physics.gravitomagEnabled;
        this._spinOrbitEnabled = physics.spinOrbitEnabled;
        this._blackHoleEnabled = physics.blackHoleEnabled;
        this._barnesHutEnabled = physics.barnesHutEnabled;
        this._relativityEnabled = physics.relativityEnabled;
        this._onePNEnabled = physics.onePNEnabled;
        this._radiationEnabled = physics.radiationEnabled;
        this._yukawaEnabled = physics.yukawaEnabled;
        this._bosonInterEnabled = physics.bosonInterEnabled;
        this._yukawaCoupling = physics.yukawaCoupling ?? 14;

        this._yukawaMu = physics.yukawaMu;
        this._higgsMass = physics.higgsMass ?? 0.5;
        this._axionMass = physics.axionMass ?? 0.05;
        this._extGravity = physics.extGravity;
        this._extGravityAngle = physics.extGravityAngle;
        this._extElectric = physics.extElectric;
        this._extElectricAngle = physics.extElectricAngle;
        this._extBz = physics.extBz;
        // Cache precomputed external field direction components (avoid per-frame trig)
        const gravAngle = physics.extGravityAngle || 0;
        const elecAngle = physics.extElectricAngle || 0;
        this._cachedExtGx = (physics.extGravity || 0) * Math.cos(gravAngle);
        this._cachedExtGy = (physics.extGravity || 0) * Math.sin(gravAngle);
        this._cachedExtEx = (physics.extElectric || 0) * Math.cos(elecAngle);
        this._cachedExtEy = (physics.extElectric || 0) * Math.sin(elecAngle);
        this._bounceFriction = physics.bounceFriction;
        this._collisionMode = physics.collisionMode || 0;
        this._axionCoupling = AXION_COUPLING;
        this._higgsCoupling = HIGGS_COUPLING;

        // Phase 5 toggle state
        this._higgsEnabled = physics.higgsEnabled;
        this._axionEnabled = physics.axionEnabled;
        this._expansionEnabled = physics.expansionEnabled;
        this._disintegrationEnabled = physics.disintegrationEnabled;
        this._hubbleParam = physics.hubbleParam || 0.001;
        this._heatmapEnabled = physics.heatmapEnabled || false;
        this._heatmapMode = physics.heatmapMode || 'all';

        // Lazily allocate scalar field buffers on first toggle-on (matching CPU pattern)
        if (physics.higgsEnabled && !this._higgsBuffers) {
            this._ensureFieldBuffers('higgs');
        }
        if (physics.axionEnabled && !this._axionBuffers) {
            this._ensureFieldBuffers('axion');
        }

        // Lazily initialize Phase 5 pipelines when any Phase 5 feature is enabled
        const needsPhase5 = physics.higgsEnabled || physics.axionEnabled ||
            physics.expansionEnabled || physics.disintegrationEnabled || physics.blackHoleEnabled || this._heatmapEnabled;
        if (needsPhase5 && !this._fieldDeposit) {
            this._ensurePhase5Pipelines();
        }
    }

    /**
     * Lazily allocate GPU buffers for a scalar field.
     * Also ensures shared atomic deposit grid buffer is allocated.
     * Initializes field values: Higgs=1.0 (VEV), Axion=0.0.
     * @param {'higgs'|'axion'} which
     */
    _ensureFieldBuffers(which) {
        if (!this._atomicGrid) {
            this._atomicGrid = createAtomicGridBuffer(this.device);
        }
        if (!this._fieldUniformBuffer) {
            this._fieldUniformBuffer = this.device.createBuffer({
                label: 'fieldUniforms',
                size: 256,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            // Per-field uniform buffers: eliminate encoder split when both Higgs + Axion enabled
            this._higgsUniformBuffer = this.device.createBuffer({
                label: 'higgsFieldUniforms',
                size: 256,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this._axionUniformBuffer = this.device.createBuffer({
                label: 'axionFieldUniforms',
                size: 256,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            // Dummy zero buffer for portal coupling when other field not yet allocated
            this._dummyFieldBuffer = this.device.createBuffer({
                label: 'dummyField',
                size: FIELD_GRID_RES * FIELD_GRID_RES * 4,
                usage: GPUBufferUsage.STORAGE,
            });
        }
        if (!this._gravGrid) {
            this._gravGrid = createGravityGridBuffers(this.device);
            this._metricPrimed = false;
        }
        if (which === 'higgs' && !this._higgsBuffers) {
            this._higgsBuffers = createFieldBuffers(this.device, 'higgs', MAX_PARTICLES);
            this._initFieldToVacuum('higgs');
            this._gravBGs = null; // its field group references this field's buffers
            // Invalidate other field's evolve bind groups (portal coupling references this buffer)
            this._fieldEvolveBGs['axion'] = null;
            this._fieldGradBGs['axion'] = null;
        }
        if (which === 'axion' && !this._axionBuffers) {
            this._axionBuffers = createFieldBuffers(this.device, 'axion', MAX_PARTICLES);
            this._initFieldToVacuum('axion');
            this._gravBGs = null;
            this._fieldEvolveBGs['higgs'] = null;
            this._fieldGradBGs['higgs'] = null;
        }
    }

    /**
     * Initialize field buffers to vacuum values.
     * Higgs VEV = 1.0, Axion vacuum = 0.0. All other arrays zeroed.
     */
    _initFieldToVacuum(which) {
        const gridSq = FIELD_GRID_RES * FIELD_GRID_RES;
        const fb = which === 'higgs' ? this._higgsBuffers : this._axionBuffers;
        if (!fb) return;

        // G15: Use encoder.clearBuffer() for zero-fills (8 writeBuffer calls → 1 encoder submit).
        // clearBuffer() executes within the command buffer timeline (no queue-time ordering issues).
        const enc = this.device.createCommandEncoder({ label: `${which}-field-reset` });
        enc.clearBuffer(fb.fieldDot);
        enc.clearBuffer(fb.gradX);
        enc.clearBuffer(fb.gradY);
        enc.clearBuffer(fb.source);
        enc.clearBuffer(fb.thermal);
        this.device.queue.submit([enc.finish()]);
        this._resetGravityGrid();

        // Write non-zero vacuum value for the main field array (Higgs VEV=1, Axion=0).
        // Axion vacuum is zero — covered by clearBuffer above, so skip the writeBuffer.
        if (which === 'higgs') {
            _vacuumFieldData.fill(1.0, 0, gridSq);
            this.device.queue.writeBuffer(fb.field, 0, _vacuumFieldData, 0, gridSq);
        } else {
            // Axion field vacuum = 0 — use a second encoder clearBuffer to stay consistent
            const enc2 = this.device.createCommandEncoder({ label: 'axion-field-clear' });
            enc2.clearBuffer(fb.field);
            this.device.queue.submit([enc2.finish()]);
        }
    }

    /** Zero the gravity grid and forget the previous metric potential. */
    _resetGravityGrid() {
        const g = this._gravGrid;
        if (!g) return;
        const enc = this.device.createCommandEncoder({ label: 'grav-grid-reset' });
        for (const key of ['phiF', 'phiFGradX', 'phiFGradY', 'phiP', 'metricPhi', 'metricPhiPrev', 'metricPhiDot', 'massGrid']) {
            enc.clearBuffer(g[key]);
        }
        this.device.queue.submit([enc.finish()]);
        this._metricPrimed = false;
    }

    /**
     * Lazily initialize Phase 5 pipelines on first use.
     * Called when any Phase 5 feature is first enabled.
     */
    async _ensurePhase5Pipelines() {
        if (this._fieldDeposit) return; // already initialized
        this._phase5Ready = false;

        const wgslConstants = buildWGSLConstants();

        // Initialize all Phase 5 pipelines in parallel
        const [deposit, evolve, forces, particleGrav, selfGrav, fft, excitation, heatmap, expansion, disint, bosonDispatchArgs] =
            await Promise.all([
                createFieldDepositPipelines(this.device, wgslConstants),
                createFieldEvolvePipelines(this.device, wgslConstants),
                createFieldForcesPipelines(this.device, wgslConstants),
                createFieldParticleGravPipeline(this.device, wgslConstants),
                createFieldGravityPipelines(this.device, wgslConstants),
                createFFTPipelines(this.device, wgslConstants),
                createFieldExcitationPipeline(this.device, wgslConstants),
                createHeatmapPipelines(this.device, wgslConstants),
                createExpansionPipeline(this.device, wgslConstants),
                createDisintegrationPipeline(this.device, wgslConstants),
                createBosonDispatchArgsPipeline(this.device, wgslConstants),
            ]);

        this._fieldDeposit = deposit;
        this._fieldEvolve = evolve;
        this._fieldForces = forces;
        this._fieldParticleGrav = particleGrav;
        this._fieldGravity = selfGrav;
        this._fftPipelines = fft;
        this._fieldExcitation = excitation;
        this._heatmapPipelines = heatmap;
        this._expansionPipeline = expansion;
        this._disintPipeline = disint;
        this._bosonDispatchArgsPipeline = bosonDispatchArgs;
        this._phase5Ready = true;
    }

    /**
     * Write FieldUniforms to a target buffer.
     * When fieldType >= 0, writes to per-field buffer (higgs=0, axion=1).
     * When fieldType < 0, writes to shared field uniform buffer (fieldType defaults to 0).
     * @param {number} dt
     * @param {number} [fieldType=-1] - -1=shared buffer, 0=higgs, 1=axion
     */
    _writeFieldUniforms(dt, fieldType = -1) {
        const buf = fieldType < 0
            ? this._fieldUniformBuffer
            : (fieldType === 0 ? this._higgsUniformBuffer : this._axionUniformBuffer);
        if (!buf) return;
        const f = _fieldUniformF32;
        const u = _fieldUniformU32;
        // Must match FieldUniforms struct in field-common.wgsl exactly:
        f[0] = dt;
        f[1] = this.domainW;
        f[2] = this.domainH;
        u[3] = this.boundaryMode;
        u[4] = this.topologyMode;
        f[5] = this._higgsMass;
        f[6] = this._higgsCoupling;
        f[7] = HIGGS_MASS_FLOOR;
        f[8] = HIGGS_MASS_MAX_DELTA;
        f[9] = this._axionMass;
        f[10] = this._axionCoupling;
        u[11] = this._higgsEnabled ? 1 : 0;
        u[12] = this._axionEnabled ? 1 : 0;
        u[13] = this._coulombEnabled ? 1 : 0;
        u[14] = this._yukawaEnabled ? 1 : 0;
        u[15] = this._gravityEnabled ? 1 : 0;
        u[16] = this._relativityEnabled ? 1 : 0;
        u[17] = this._blackHoleEnabled ? 1 : 0;
        u[18] = this.aliveCount;
        // gravAccumulate: the axion's energy adds to the Higgs's in the gravity FFT input
        u[19] = fieldType === 1 && this._higgsEnabled ? 1 : 0;
        u[20] = fieldType < 0 ? 0 : fieldType;
        // Precomputed cell dimensions (G17: avoids per-thread division in shaders)
        const cellW = this.domainW / FIELD_GRID_RES;
        const cellH = this.domainH / FIELD_GRID_RES;
        f[21] = cellW;
        f[22] = cellH;
        f[23] = 1 / (cellW * cellW);
        f[24] = 1 / (cellH * cellH);
        this.device.queue.writeBuffer(buf, 0, _fieldUniformData);
    }

    /**
     * Ensure deposit bind groups exist for a given field.
     */
    _ensureDepositBindGroups(which) {
        if (this._fieldDepositBGs[which]) return;
        const fb = which === 'higgs' ? this._higgsBuffers : this._axionBuffers;
        if (!fb || !this._fieldDeposit) return;
        const b = this.buffers;
        const dep = this._fieldDeposit;

        // Group 0: packed particle state + aux metadata
        const g0 = this.device.createBindGroup({
            label: `fieldDeposit_g0_${which}`,
            layout: dep.bindGroupLayouts[0],
            entries: [
                { binding: 0, resource: { buffer: b.particleState } },
                { binding: 1, resource: { buffer: b.particleAux } },
            ],
        });

        // Use per-field uniform buffer
        const uBuf = which === 'higgs' ? this._higgsUniformBuffer : this._axionUniformBuffer;

        // Group 1: atomicGrid + target grid + uniforms (for source deposition)
        const g1Source = this.device.createBindGroup({
            label: `fieldDeposit_g1_source_${which}`,
            layout: dep.bindGroupLayouts[1],
            entries: [
                { binding: 0, resource: { buffer: this._atomicGrid } },
                { binding: 1, resource: { buffer: fb.source } },
                { binding: 2, resource: { buffer: uBuf } },
            ],
        });

        // Group 1 for thermal (Higgs only, but create for both for simplicity)
        const g1Thermal = this.device.createBindGroup({
            label: `fieldDeposit_g1_thermal_${which}`,
            layout: dep.bindGroupLayouts[1],
            entries: [
                { binding: 0, resource: { buffer: this._atomicGrid } },
                { binding: 1, resource: { buffer: fb.thermal } },
                { binding: 2, resource: { buffer: uBuf } },
            ],
        });

        // Group 1 for superradiance fieldDot impulse (axion only)
        const g1FieldDot = this.device.createBindGroup({
            label: `fieldDeposit_g1_fieldDot_${which}`,
            layout: dep.bindGroupLayouts[1],
            entries: [
                { binding: 0, resource: { buffer: this._atomicGrid } },
                { binding: 1, resource: { buffer: fb.fieldDot } },
                { binding: 2, resource: { buffer: uBuf } },
            ],
        });

        // Group 2: axYukMod (read-only, for superradiance stimulated amplification)
        const g2 = this.device.createBindGroup({
            label: `fieldDeposit_g2_${which}`,
            layout: dep.bindGroupLayouts[2],
            entries: [
                { binding: 0, resource: { buffer: b.axYukMod } },
            ],
        });

        this._fieldDepositBGs[which] = { g0, g1Source, g1Thermal, g1FieldDot, g2 };
    }

    /**
     * Ensure evolve bind groups exist for a given field.
     */
    _ensureEvolveBindGroups(which) {
        if (this._fieldEvolveBGs[which]) return;
        const fb = which === 'higgs' ? this._higgsBuffers : this._axionBuffers;
        if (!fb || !this._fieldEvolve) return;

        // Use per-field uniform buffer to avoid encoder split when both fields active
        const uBuf = which === 'higgs' ? this._higgsUniformBuffer : this._axionUniformBuffer;

        // Other field's buffer for portal coupling (or dummy zeros if not allocated)
        const otherFb = which === 'higgs' ? this._axionBuffers : this._higgsBuffers;
        const otherFieldBuf = otherFb ? otherFb.field : this._dummyFieldBuffer;

        const g = this._gravGrid;
        const entries = [
            fb.field, fb.fieldDot, otherFieldBuf, fb.source, fb.thermal,
            g.metricPhi, g.metricPhiDot, fb.gradX, fb.gradY, uBuf,
        ].map((buffer, binding) => ({ binding, resource: { buffer } }));
        this._fieldEvolveBGs[which] = this.device.createBindGroup({
            label: `fieldEvolve_${which}`,
            layout: this._fieldEvolve.evolveBindGroupLayouts[0],
            entries,
        });
        this._fieldGradBGs[which] = this.device.createBindGroup({
            label: `fieldGrad_${which}`,
            layout: this._fieldEvolve.gradBindGroupLayouts[0],
            entries,
        });
    }

    /** Gravity-grid bind groups: the full grid group, the per-field pack groups, and FFT. */
    _ensureGravityBindGroups() {
        if (this._gravBGs) return;
        const g = this._gravGrid;
        const grav = this._fieldGravity;
        const fft = this._fftPipelines;
        if (!g || !grav || !fft) return;
        const bg = (label, layout, buffers) => this.device.createBindGroup({
            label, layout,
            entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
        });

        const fieldBG = (fb) => fb ? bg('grav_field', grav.fieldLayout, [fb.field, fb.fieldDot, fb.gradX, fb.gradY]) : null;
        this._gravBGs = {
            grid: bg('grav_grid', grav.gridLayout, [
                this._fieldUniformBuffer, g.fftA, g.phiF, g.phiFGradX, g.phiFGradY,
                g.phiP, g.metricPhi, g.metricPhiPrev, g.metricPhiDot, g.massGrid,
            ]),
            packHiggs: bg('grav_pack_higgs', grav.packLayout, [this._higgsUniformBuffer, g.fftA]),
            packAxion: bg('grav_pack_axion', grav.packLayout, [this._axionUniformBuffer, g.fftA]),
            higgs: fieldBG(this._higgsBuffers),
            axion: fieldBG(this._axionBuffers),
            massDeposit: bg('grav_mass_deposit', this._fieldDeposit.bindGroupLayouts[1],
                [this._atomicGrid, g.massGrid, this._fieldUniformBuffer]),
        };

        if (!this._fftParamsBuffer) {
            // Every butterfly stage's parameters, written once. Selected per pass by
            // dynamic offset, so all stages in one encoder see their own values.
            const N = FIELD_GRID_RES;
            const logN = Math.log2(N);
            const data = new ArrayBuffer(4 * logN * FFT_PARAM_STRIDE);
            for (let inv = 0; inv < 2; inv++) {
                for (let axis = 0; axis < 2; axis++) {
                    for (let st = 0; st < logN; st++) {
                        const base = ((inv * 2 + axis) * logN + st) * FFT_PARAM_STRIDE;
                        const u32 = new Uint32Array(data, base, 8);
                        const i32 = new Int32Array(data, base, 8);
                        const f32 = new Float32Array(data, base, 8);
                        u32[0] = 1 << st;                  // stageLen
                        i32[1] = inv ? 1 : -1;             // direction
                        u32[2] = axis;
                        u32[3] = N;
                        f32[4] = 1 / N;                    // invN
                        u32[5] = inv && st === logN - 1 ? 1 : 0; // normalize on each axis's last stage
                    }
                }
            }
            this._fftParamsBuffer = this.device.createBuffer({
                label: 'fftParams', size: data.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(this._fftParamsBuffer, 0, data);
        }
        const paramsBinding = { buffer: this._fftParamsBuffer, size: 32 };
        this._fftBGs = {
            g0_AB: this.device.createBindGroup({
                label: 'fft_g0_AB', layout: fft.bindGroupLayouts[0],
                entries: [
                    { binding: 0, resource: { buffer: g.fftA } },
                    { binding: 1, resource: { buffer: g.fftB } },
                    { binding: 2, resource: paramsBinding },
                ],
            }),
            g0_BA: this.device.createBindGroup({
                label: 'fft_g0_BA', layout: fft.bindGroupLayouts[0],
                entries: [
                    { binding: 0, resource: { buffer: g.fftB } },
                    { binding: 1, resource: { buffer: g.fftA } },
                    { binding: 2, resource: paramsBinding },
                ],
            }),
            g1Green: this.device.createBindGroup({
                label: 'fft_g1_green', layout: fft.bindGroupLayouts[1],
                entries: [{ binding: 0, resource: { buffer: g.greenHat } }],
            }),
        };
    }

    /** Upload the sheet Green's function Ĝ for G(r) = -1/√(r² + ℓ²), once per domain. */
    _uploadGreenHat() {
        const key = `${this.domainW},${this.domainH}`;
        if (this._greenHatKey === key) return;
        this._greenHatKey = key;
        this._metricPrimed = false; // the potential's scale just changed

        const N = FIELD_GRID_RES;
        const N2 = N * N;
        const re = new Float64Array(N2);
        const im = new Float64Array(N2);
        const cellW = this.domainW / N;
        const cellH = this.domainH / N;

        // Wrapped indices: the circular convolution treats the grid as periodic
        for (let iy = 0; iy < N; iy++) {
            for (let ix = 0; ix < N; ix++) {
                const dx = (ix <= N / 2 ? ix : ix - N) * cellW;
                const dy = (iy <= N / 2 ? iy : iy - N) * cellH;
                re[iy * N + ix] = -1 / Math.sqrt(dx * dx + dy * dy + SHEET_THICKNESS_SQ);
            }
        }
        fft2d(re, im, N, false);
        for (let i = 0; i < N2; i++) {
            _greenHatUploadData[i * 2] = re[i];
            _greenHatUploadData[i * 2 + 1] = im[i];
        }
        this.device.queue.writeBuffer(this._gravGrid.greenHat, 0, _greenHatUploadData, 0, N2 * 2);
    }

    /** FFT convolution of gravGrid.fftA with Ĝ, in place (result back in fftA). */
    _dispatchFFTConvolve(encoder) {
        const fft = this._fftPipelines;
        const bgs = this._fftBGs;
        const N = FIELD_GRID_RES;
        const logN = Math.log2(N);
        const elemWG = Math.ceil(N * N / 256);
        let inA = true;
        const butterfly = (inv, axis, st) => {
            const p = encoder.beginComputePass({ label: `fft_${inv ? 'inv' : 'fwd'}_${axis}_${st}` });
            p.setPipeline(fft.fftButterfly);
            p.setBindGroup(0, inA ? bgs.g0_AB : bgs.g0_BA, [((inv * 2 + axis) * logN + st) * FFT_PARAM_STRIDE]);
            p.dispatchWorkgroups(elemWG);
            p.end();
            inA = !inA;
        };
        for (let axis = 0; axis < 2; axis++) for (let st = 0; st < logN; st++) butterfly(0, axis, st);
        {
            // 2·logN stages is even, so the spectrum is back in fftA
            const p = encoder.beginComputePass({ label: 'fft_complexMul' });
            p.setPipeline(fft.complexMultiply);
            p.setBindGroup(0, bgs.g0_AB, [0]);
            p.setBindGroup(1, bgs.g1Green);
            p.dispatchWorkgroups(elemWG);
            p.end();
        }
        for (let axis = 0; axis < 2; axis++) for (let st = 0; st < logN; st++) butterfly(1, axis, st);
    }

    _gravPass(encoder, label, pipeline, groups) {
        const gridWG = Math.ceil(FIELD_GRID_RES / 8);
        const p = encoder.beginComputePass({ label });
        p.setPipeline(pipeline);
        groups.forEach((g, i) => p.setBindGroup(i, g));
        p.dispatchWorkgroups(gridWG, gridWG);
        p.end();
    }

    /**
     * Solve the metric potential the fields evolve in.
     * 'pre' (before the first half-kick): Φ_F from the current fields, Φ_P from the
     * particles, metricPhi = Φ_F + Φ_P. 'mid' (after the field drift): Φ_F again,
     * then metricPhi and Φ̇ (backward difference against the previous 'mid').
     */
    _dispatchGridPotential(encoder, stage) {
        const grav = this._fieldGravity;
        const bgs = this._gravBGs;
        this._uploadGreenHat();

        // Φ_F: field energy of every active field
        if (this._higgsEnabled) this._gravPass(encoder, `packHiggs_${stage}`, grav.packFieldEnergy, [bgs.packHiggs, bgs.higgs]);
        if (this._axionEnabled) this._gravPass(encoder, `packAxion_${stage}`, grav.packFieldEnergy, [bgs.packAxion, bgs.axion]);
        this._dispatchFFTConvolve(encoder);
        this._gravPass(encoder, `unpackPhiF_${stage}`, grav.unpackPhiF, [bgs.grid]);

        if (stage === 'pre') {
            // Φ_P: particles don't move during the field step, so once per substep
            if (this.aliveCount > 0) {
                const p = encoder.beginComputePass({ label: 'depositMass' });
                p.setPipeline(this._fieldDeposit.depositMass);
                p.setBindGroup(0, this._fieldDepositBGs[this._higgsEnabled ? 'higgs' : 'axion'].g0);
                p.setBindGroup(1, bgs.massDeposit);
                p.dispatchWorkgroups(Math.ceil(this.aliveCount / 256));
                p.end();
            }
            {
                const gridWG = Math.ceil(FIELD_GRID_RES / 8);
                const p = encoder.beginComputePass({ label: 'finalizeMass' });
                p.setPipeline(this._fieldDeposit.finalizeDeposit);
                p.setBindGroup(0, this._fieldDepositBGs[this._higgsEnabled ? 'higgs' : 'axion'].g0);
                p.setBindGroup(1, bgs.massDeposit);
                p.dispatchWorkgroups(gridWG, gridWG);
                p.end();
            }
            this._gravPass(encoder, 'packMass', grav.packMass, [bgs.grid]);
            this._dispatchFFTConvolve(encoder);
            this._gravPass(encoder, 'unpackPhiP', grav.unpackPhiP, [bgs.grid]);
            this._gravPass(encoder, 'combineMetric', grav.combineMetric, [bgs.grid]);
            if (!this._metricPrimed) {
                // No previous potential yet: start from this one with Φ̇ = 0.
                const g = this._gravGrid;
                encoder.copyBufferToBuffer(g.metricPhi, 0, g.metricPhiPrev, 0, g.metricPhi.size);
                encoder.clearBuffer(g.metricPhiDot);
                this._metricPrimed = true;
            }
        } else {
            this._gravPass(encoder, 'combineMetricDot', grav.combineMetricDot, [bgs.grid]);
        }
    }

    /**
     * Ensure field forces bind groups exist (shared for both Higgs and Axion).
     */
    _ensureFieldForcesBGs() {
        if (this._fieldForcesBGs) return;
        if (!this._fieldForces || !this._higgsBuffers || !this._axionBuffers) return;
        // Need both field buffers — use dummy if one missing
        const hb = this._higgsBuffers;
        const ab = this._axionBuffers;
        // If one field is missing, we can't create force BGs yet
        // They'll be created when both are available, or on first use with dummies
        if (!hb || !ab) return;
        const b = this.buffers;
        const ff = this._fieldForces;

        const g0 = this.device.createBindGroup({
            label: 'fieldForces_g0',
            layout: ff.bindGroupLayouts[0],
            entries: [
                { binding: 0, resource: { buffer: b.particleState } },
                { binding: 1, resource: { buffer: b.derived } },
            ],
        });

        const g1 = this.device.createBindGroup({
            label: 'fieldForces_g1',
            layout: ff.bindGroupLayouts[1],
            entries: [
                { binding: 0, resource: { buffer: hb.field } },
                { binding: 1, resource: { buffer: hb.gradX } },
                { binding: 2, resource: { buffer: hb.gradY } },
                { binding: 3, resource: { buffer: ab.field } },
                { binding: 4, resource: { buffer: ab.gradX } },
                { binding: 5, resource: { buffer: ab.gradY } },
            ],
        });

        const g2 = this.device.createBindGroup({
            label: 'fieldForces_g2',
            layout: ff.bindGroupLayouts[2],
            entries: [
                { binding: 0, resource: { buffer: b.allForces } },
                { binding: 1, resource: { buffer: b.axYukMod } },
            ],
        });

        const g3 = this.device.createBindGroup({
            label: 'fieldForces_g3',
            layout: ff.bindGroupLayouts[3],
            entries: [
                { binding: 0, resource: { buffer: this._fieldUniformBuffer } },
            ],
        });

        this._fieldForcesBGs = { g0, g1, g2, g3 };
    }

    /**
     * Dispatch one substep of scalar-field evolution for every active field, as a
     * joint Störmer–Verlet KDK so the Higgs–axion portal and the shared metric are
     * evaluated at matching times:
     * sources → [metric 'pre'] → half-kick → drift → [gradients, metric 'mid'] →
     * half-kick → gradients.
     */
    _dispatchFieldStep(encoder, dt) {
        if (!this._phase5Ready || !this._fieldDeposit || !this._fieldEvolve) return;
        const active = [];
        if (this._higgsEnabled && this._higgsBuffers) active.push('higgs');
        if (this._axionEnabled && this._axionBuffers) active.push('axion');
        if (active.length === 0) return;

        const dep = this._fieldDeposit;
        const evo = this._fieldEvolve;
        const gridWG = Math.ceil(FIELD_GRID_RES / 8); // 8x8 workgroup
        const particleWG = Math.ceil(this.aliveCount / 256);
        const pass = (label, pipeline, groups, x, y = 1) => {
            const p = encoder.beginComputePass({ label });
            p.setPipeline(pipeline);
            groups.forEach((g, i) => p.setBindGroup(i, g));
            p.dispatchWorkgroups(x, y);
            p.end();
        };

        for (const which of active) {
            this._ensureDepositBindGroups(which);
            this._ensureEvolveBindGroups(which);
            const depBGs = this._fieldDepositBGs[which];

            // Atomic source deposit, then finalize (atomic i32 → f32, clears the atomic grid)
            if (this.aliveCount > 0) {
                pass(`deposit_${which}`, which === 'axion' ? dep.depositAxionSource : dep.depositHiggsSource,
                    [depBGs.g0, depBGs.g1Source], particleWG);
            }
            pass(`finalizeSource_${which}`, dep.finalizeDeposit, [depBGs.g0, depBGs.g1Source], gridWG, gridWG);

            // Superradiance: spinning BH deposits an energy-normalized axion fieldDot impulse
            if (which === 'axion' && this._blackHoleEnabled && this.aliveCount > 0) {
                pass('depositSuperradiance', dep.depositSuperradiance, [depBGs.g0, depBGs.g1FieldDot, depBGs.g2], particleWG);
                pass('finalizeSuperradiance', dep.finalizeDepositAdd, [depBGs.g0, depBGs.g1FieldDot], gridWG, gridWG);
            }

            // Higgs thermal deposition
            if (which === 'higgs') {
                if (this.aliveCount > 0) pass('depositThermal', dep.depositThermal, [depBGs.g0, depBGs.g1Thermal], particleWG);
                pass('finalizeThermal', dep.finalizeDeposit, [depBGs.g0, depBGs.g1Thermal], gridWG, gridWG);
            }
        }

        const gravity = this._gravityEnabled;
        if (gravity) {
            this._ensureGravityBindGroups();
            this._dispatchGridPotential(encoder, 'pre');
        }
        const kick = (which, tag) => pass(`halfKick${tag}_${which}`,
            which === 'higgs' ? evo.higgsHalfKick : evo.axionHalfKick, [this._fieldEvolveBGs[which]], gridWG, gridWG);
        const gradients = (which, tag) => pass(`gridGradients${tag}_${which}`,
            evo.computeGridGradients, [this._fieldGradBGs[which]], gridWG, gridWG);

        for (const which of active) kick(which, 1);
        for (const which of active) pass(`fieldDrift_${which}`, evo.fieldDrift, [this._fieldEvolveBGs[which]], gridWG, gridWG);
        if (gravity) {
            // The drifted fields' energy needs their gradients first
            for (const which of active) gradients(which, 'Mid');
            this._dispatchGridPotential(encoder, 'mid');
        }
        for (const which of active) kick(which, 2);
        for (const which of active) gradients(which, '');
    }

    /**
     * Dispatch scalar field force application (Pass 16).
     * Applies Higgs mass modulation + gradient force, Axion axMod/yukMod + gradient force.
     */
    _dispatchFieldForces(encoder) {
        if (!this._fieldForces || this.aliveCount === 0) return;
        if (!this._higgsEnabled && !this._axionEnabled) return;

        // Ensure both field buffers exist for the shared bind group
        // If only one is enabled, the other's arrays are at vacuum (zero/VEV) — safe.
        if (this._higgsEnabled && !this._axionBuffers) {
            this._ensureFieldBuffers('axion');
        }
        if (this._axionEnabled && !this._higgsBuffers) {
            this._ensureFieldBuffers('higgs');
        }
        this._ensureFieldForcesBGs();
        if (!this._fieldForcesBGs) return;

        const workgroups = Math.ceil(this.aliveCount / 256);
        const fg = this._fieldForcesBGs;
        const ff = this._fieldForces;

        if (this._higgsEnabled) {
            const p = encoder.beginComputePass({ label: 'applyHiggsForces' });
            p.setPipeline(ff.applyHiggsForces);
            p.setBindGroup(0, fg.g0);
            p.setBindGroup(1, fg.g1);
            p.setBindGroup(2, fg.g2);
            p.setBindGroup(3, fg.g3);
            p.dispatchWorkgroups(workgroups);
            p.end();
        }

        if (this._axionEnabled) {
            const p = encoder.beginComputePass({ label: 'applyAxionForces' });
            p.setPipeline(ff.applyAxionForces);
            p.setBindGroup(0, fg.g0);
            p.setBindGroup(1, fg.g1);
            p.setBindGroup(2, fg.g2);
            p.setBindGroup(3, fg.g3);
            p.dispatchWorkgroups(workgroups);
            p.end();
        }
    }

    /**
     * Dispatch particle-field gravity: F = -m∇Φ_F from the fields' energy (O(N × 16)).
     * Uses Φ_F from the previous substep's field step.
     */
    _dispatchFieldParticleGrav(encoder) {
        if (!this._fieldParticleGrav || !this._gravityEnabled || this.aliveCount === 0) return;
        if (!this._higgsEnabled && !this._axionEnabled) return;

        // Create uniform buffer once
        if (!this._fieldParticleGravUniform) {
            this._fieldParticleGravUniform = this.device.createBuffer({
                label: 'fieldParticleGrav_uniform',
                size: 32, // FGUniforms: domainW, domainH, aliveCount, boundaryMode, topologyMode, _pad×3
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }

        // Write uniforms (FGUniforms struct)
        _fgUniformF32[0] = this.domainW;
        _fgUniformF32[1] = this.domainH;
        _fgUniformU32[2] = this.aliveCount;
        _fgUniformU32[3] = this.boundaryMode;
        _fgUniformU32[4] = this.topologyMode;
        _fgUniformU32[5] = 0;
        _fgUniformU32[6] = 0;
        _fgUniformU32[7] = 0;
        this.device.queue.writeBuffer(this._fieldParticleGravUniform, 0, _fgUniformData, 0, 32);

        const pg = this._fieldParticleGrav;
        const g = this._gravGrid;
        if (!g) return;
        const b = this.buffers;
        if (!this._fieldParticleGravBGs) {
            this._fieldParticleGravBGs = {
                g0: this.device.createBindGroup({
                    label: 'fieldParticleGrav_g0',
                    layout: pg.bindGroupLayouts[0],
                    entries: [
                        { binding: 0, resource: { buffer: this._fieldParticleGravUniform } },
                        { binding: 1, resource: { buffer: b.particleState } },
                        { binding: 2, resource: { buffer: b.allForces } },
                    ],
                }),
                g1: this.device.createBindGroup({
                    label: 'fieldParticleGrav_g1',
                    layout: pg.bindGroupLayouts[1],
                    entries: [
                        { binding: 0, resource: { buffer: g.phiFGradX } },
                        { binding: 1, resource: { buffer: g.phiFGradY } },
                    ],
                }),
            };
        }

        const p = encoder.beginComputePass({ label: 'fieldParticleGrav' });
        p.setPipeline(pg.pipeline);
        p.setBindGroup(0, this._fieldParticleGravBGs.g0);
        p.setBindGroup(1, this._fieldParticleGravBGs.g1);
        p.dispatchWorkgroups(Math.ceil(this.aliveCount / 256));
        p.end();
    }

    /**
     * Dispatch field excitation deposits (Pass 19).
     * Deposits Gaussian wave packets from merge events into active field(s).
     */
    _dispatchFieldExcitations(encoder) {
        if (!this._fieldExcitation) return;
        if (!this._higgsEnabled && !this._axionEnabled) return;

        // Excitation events come from merge results (already on GPU in mergeResultBuffer)
        const mergeCount = this._pendingMergeEvents.length;
        if (mergeCount === 0) return;

        if (!this._excitationBuffers) {
            this._excitationBuffers = createExcitationBuffers(this.device);
        }

        // Upload compacted excitation events from pending merge/annihilation events.
        const maxEvents = 64;
        let eventCount = 0;
        for (let i = 0; i < mergeCount && eventCount < maxEvents; i++) {
            const me = this._pendingMergeEvents[i];
            if (me.energy <= 0) continue;
            const base = eventCount * 4;
            _excitationEventData[base] = me.x;
            _excitationEventData[base + 1] = me.y;
            _excitationEventData[base + 2] = me.energy;
            _excitationEventData[base + 3] = 0; // padding
            eventCount++;
        }
        if (eventCount === 0) return;
        this.device.queue.writeBuffer(this._excitationBuffers.events, 0, _excitationEventData, 0, eventCount * 4);
        _excitationCountData[0] = eventCount;
        this.device.queue.writeBuffer(this._excitationBuffers.counter, 0, _excitationCountData);

        const exc = this._fieldExcitation;

        const dispatchForField = (which) => {
            const fb = which === 'higgs' ? this._higgsBuffers : this._axionBuffers;
            if (!fb) return;

            if (!this._fieldExcitationBGs[which]) {
                const uBuf = which === 'higgs' ? this._higgsUniformBuffer : this._axionUniformBuffer;
                this._fieldExcitationBGs[which] = this.device.createBindGroup({
                    label: `fieldExcitation_${which}`,
                    layout: exc.bindGroupLayouts[0],
                    entries: [
                        { binding: 0, resource: { buffer: fb.fieldDot } },
                        { binding: 1, resource: { buffer: this._excitationBuffers.events } },
                        { binding: 2, resource: { buffer: uBuf } },
                        { binding: 3, resource: { buffer: this._excitationBuffers.counter } },
                    ],
                });
            }

            const p = encoder.beginComputePass({ label: `depositExcitations_${which}` });
            p.setPipeline(exc.pipeline);
            p.setBindGroup(0, this._fieldExcitationBGs[which]);
            p.dispatchWorkgroups(1);
            p.end();
        };

        if (this._higgsEnabled) dispatchForField('higgs');
        if (this._axionEnabled) dispatchForField('axion');
    }

    /**
     * Dispatch cosmological expansion (Pass 13).
     */
    _dispatchExpansion(encoder, dt) {
        if (!this._expansionEnabled || !this._expansionPipeline) return;
        if (this.aliveCount === 0) return;

        if (!this._expansionUniformBuffer) {
            this._expansionUniformBuffer = this.device.createBuffer({
                label: 'expansionUniforms',
                size: 32, // 8 floats
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }

        // Write ExpansionUniforms (reuse pre-allocated field uniform buffer)
        _fieldUniformF32[0] = this._hubbleParam;
        _fieldUniformF32[1] = dt;
        _fieldUniformF32[2] = this.domainW * 0.5;
        _fieldUniformF32[3] = this.domainH * 0.5;
        _fieldUniformU32[4] = this.aliveCount;
        this.device.queue.writeBuffer(this._expansionUniformBuffer, 0, _fieldUniformData, 0, 32);

        if (!this._expansionBG) {
            const b = this.buffers;
            this._expansionBG = this.device.createBindGroup({
                label: 'expansion_g0',
                layout: this._expansionPipeline.bindGroupLayouts[0],
                entries: [
                    { binding: 0, resource: { buffer: b.particleState } },
                    { binding: 1, resource: { buffer: this._expansionUniformBuffer } },
                ],
            });
        }

        const workgroups = Math.ceil(this.aliveCount / 256);
        const p = encoder.beginComputePass({ label: 'expansion' });
        p.setPipeline(this._expansionPipeline.pipeline);
        p.setBindGroup(0, this._expansionBG);
        p.dispatchWorkgroups(workgroups);
        p.end();
    }

    /**
     * Dispatch disintegration check (Pass 20).
     */
    _dispatchDisintegration(encoder, dtSub) {
        if (!(this._disintegrationEnabled || this._blackHoleEnabled) || !this._disintPipeline) return;
        if (this.aliveCount === 0) return;

        if (!this._disintBuffers) {
            this._disintBuffers = createDisintegrationBuffers(this.device);
        }

        if (!this._disintUniformBuffer) {
            this._disintUniformBuffer = this.device.createBuffer({
                label: 'disintUniforms',
                size: 64, // 16 floats/u32
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }

        // Write DisintUniforms (pre-allocated buffers, no per-frame GC)
        _disintUniformF32[0] = this._blackHoleEnabled ? BH_SOFTENING_SQ : SOFTENING_SQ; // softeningSq
        _disintUniformF32[1] = this.domainW;
        _disintUniformF32[2] = this.domainH;
        _disintUniformF32[3] = TIDAL_STRENGTH;
        _disintUniformF32[4] = ROCHE_THRESHOLD;
        _disintUniformF32[5] = ROCHE_TRANSFER_RATE;
        _disintUniformF32[6] = MIN_MASS;
        _disintUniformU32[7] = SPAWN_COUNT;
        _disintUniformU32[8] = this.aliveCount;
        _disintUniformU32[9] = this.boundaryMode === BOUND_LOOP ? 1 : 0;
        _disintUniformU32[10] = this.topologyMode;
        _disintUniformU32[11] =
            (this._disintegrationEnabled ? DISINT_FEATURE_BREAKUP : 0) |
            (this._blackHoleEnabled ? DISINT_FEATURE_EXTREMAL : 0);
        _disintUniformF32[12] = dtSub;
        _disintUniformU32[13] = this._relativityEnabled ? 1 : 0;
        this.device.queue.writeBuffer(this._disintUniformBuffer, 0, _disintUniformData);

        // Reset event counter
        encoder.clearBuffer(this._disintBuffers.counter, 0, 4);

        if (!this._disintBGs) {
            const b = this.buffers;
            const g0 = this.device.createBindGroup({
                label: 'disint_g0',
                layout: this._disintPipeline.bindGroupLayouts[0],
                entries: [
                    { binding: 0, resource: { buffer: b.particleState } },
                    { binding: 1, resource: { buffer: b.particleAux } },
                    { binding: 2, resource: { buffer: b.derived } },
                ],
            });
            const g1 = this.device.createBindGroup({
                label: 'disint_g1',
                layout: this._disintPipeline.bindGroupLayouts[1],
                entries: [
                    { binding: 0, resource: { buffer: this._disintBuffers.events } },
                    { binding: 1, resource: { buffer: this._disintBuffers.counter } },
                    { binding: 2, resource: { buffer: this._disintUniformBuffer } },
                ],
            });
            const g2 = this.device.createBindGroup({
                label: 'disint_g2',
                layout: this._disintPipeline.bindGroupLayouts[2],
                entries: [
                    { binding: 0, resource: { buffer: b.pionPool } },
                    { binding: 1, resource: { buffer: b.piCount } },
                    { binding: 2, resource: { buffer: b.radiationState } },
                ],
            });
            this._disintBGs = [g0, g1, g2];
        }

        const workgroups = Math.ceil(this.aliveCount / 256);
        const p = encoder.beginComputePass({ label: 'disintegration' });
        p.setPipeline(this._disintPipeline.pipeline);
        p.setBindGroup(0, this._disintBGs[0]);
        p.setBindGroup(1, this._disintBGs[1]);
        p.setBindGroup(2, this._disintBGs[2]);
        p.dispatchWorkgroups(workgroups);
        p.end();
    }

    _ensureBosonDispatchArgs() {
        if (!this._bosonDispatchArgs) {
            this._bosonDispatchArgs = this.device.createBuffer({
                label: 'boson-dispatch-args',
                size: 48, // four indirect dispatch records, 3 × u32 each
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
            });
        }
        if (!this._bosonDispatchArgsBG && this._bosonDispatchArgsPipeline) {
            const b = this.buffers;
            this._bosonDispatchArgsBG = this.device.createBindGroup({
                label: 'bosonDispatchArgs_g0',
                layout: this._bosonDispatchArgsPipeline.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: b.phCount } },
                    { binding: 1, resource: { buffer: b.piCount } },
                    { binding: 2, resource: { buffer: this._bosonDispatchArgs } },
                ],
            });
        }
        return this._bosonDispatchArgs && this._bosonDispatchArgsBG;
    }

    _writeBosonDispatchArgs(encoder) {
        if (!this._bosonDispatchArgsPipeline || !this._ensureBosonDispatchArgs()) return false;
        const pass = encoder.beginComputePass({ label: 'buildBosonDispatchArgs' });
        pass.setPipeline(this._bosonDispatchArgsPipeline.pipeline);
        pass.setBindGroup(0, this._bosonDispatchArgsBG);
        pass.dispatchWorkgroups(1);
        pass.end();
        return true;
    }

    /**
     * Dispatch heatmap compute pass (runs once every HEATMAP_INTERVAL frames).
     * @param {Object} camera - camera state for viewport bounds
     */
    dispatchHeatmap(encoder, camera) {
        if (!this._heatmapEnabled || !this._heatmapPipelines) return;
        if (this.aliveCount === 0) return;

        if (!this._heatmapBuffers) {
            this._heatmapBuffers = createHeatmapBuffers(this.device, GPU_HEATMAP_GRID);
        }

        if (!this._heatmapUniformBuffer) {
            this._heatmapUniformBuffer = this.device.createBuffer({
                label: 'heatmapUniforms',
                size: 96, // HeatmapUniforms struct size (22 fields, padded)
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }

        // Compute viewport bounds from camera — use logical pixels to match
        // render shader (canvasW/canvasH = canvas.width = window.innerWidth, no DPR)
        const canvasW = camera?.viewportW || 800;
        const canvasH = camera?.viewportH || 600;
        const halfW = canvasW / (2 * (camera?.zoom || 16));
        const halfH = canvasH / (2 * (camera?.zoom || 16));
        const viewLeft = (camera?.x || 0) - halfW;
        const viewTop = (camera?.y || 0) - halfH;
        const cellW = (2 * halfW) / GPU_HEATMAP_GRID;
        const cellH = (2 * halfH) / GPU_HEATMAP_GRID;

        // Write HeatmapUniforms
        // Write HeatmapUniforms (pre-allocated buffers, no per-frame GC)
        _heatmapUniformF32[0] = viewLeft;
        _heatmapUniformF32[1] = viewTop;
        _heatmapUniformF32[2] = cellW;
        _heatmapUniformF32[3] = cellH;
        _heatmapUniformF32[4] = this._blackHoleEnabled ? BH_SOFTENING_SQ : SOFTENING_SQ; // softeningSq
        _heatmapUniformF32[5] = this._yukawaCoupling;
        _heatmapUniformF32[6] = this._yukawaMu;
        _heatmapUniformF32[7] = this.gpuTime;
        _heatmapUniformF32[8] = this.domainW;
        _heatmapUniformF32[9] = this.domainH;
        const hm = this._heatmapMode;
        _heatmapUniformU32[10] = (this._gravityEnabled && (hm === 'all' || hm === 'gravity')) ? 1 : 0;
        _heatmapUniformU32[11] = (this._coulombEnabled && (hm === 'all' || hm === 'electric')) ? 1 : 0;
        _heatmapUniformU32[12] = (this._yukawaEnabled && (hm === 'all' || hm === 'yukawa')) ? 1 : 0;
        _heatmapUniformU32[13] = this._relativityEnabled ? 1 : 0; // useDelay
        _heatmapUniformU32[14] = this.boundaryMode === BOUND_LOOP ? 1 : 0;
        _heatmapUniformU32[15] = this.topologyMode;
        _heatmapUniformU32[16] = this.aliveCount;
        _heatmapUniformU32[17] = this._barnesHutEnabled ? 1 : 0; // useTree
        _heatmapUniformU32[18] = this._blackHoleEnabled ? 1 : 0;
        this.device.queue.writeBuffer(this._heatmapUniformBuffer, 0, _heatmapUniformData);

        if (!this._heatmapBGs) {
            const b = this.buffers;
            const hm = this._heatmapPipelines;
            const hmBuf = this._heatmapBuffers;
            this._heatmapBGs = {
                g0: this.device.createBindGroup({
                    label: 'heatmap_g0',
                    layout: hm.heatmapLayouts[0],
                    entries: [
                        { binding: 0, resource: { buffer: b.particleState } },
                        { binding: 1, resource: { buffer: b.particleAux } },
                        { binding: 2, resource: { buffer: b.qtNodeBuffer } },
                    ],
                }),
                g1: this.device.createBindGroup({
                    label: 'heatmap_g1',
                    layout: hm.heatmapLayouts[1],
                    entries: [
                        { binding: 0, resource: { buffer: hmBuf.gravPotential } },
                        { binding: 1, resource: { buffer: hmBuf.elecPotential } },
                        { binding: 2, resource: { buffer: hmBuf.yukawaPotential } },
                        { binding: 3, resource: { buffer: this._heatmapUniformBuffer } },
                    ],
                }),
                g2: this.device.createBindGroup({
                    label: 'heatmap_g2_worldlines',
                    layout: hm.heatmapLayouts[2],
                    entries: [
                        { binding: 0, resource: { buffer: this.buffers.wlData } },
                        { binding: 1, resource: { buffer: this.buffers.wlMeta } },
                    ],
                }),
            };
        }

        const gridWG = Math.ceil(GPU_HEATMAP_GRID / 8);

        // Compute heatmap — use BH tree walk when BH on, signal delay off, non-periodic
        // (periodic boundaries require minImage wrapping which the tree walk doesn't handle)
        {
            const useDelay = this._relativityEnabled;
            const isPeriodic = this.boundaryMode === BOUND_LOOP;
            const useTree = this._barnesHutEnabled && !useDelay && !isPeriodic;
            const pipeline = useTree
                ? this._heatmapPipelines.computeHeatmapTree
                : this._heatmapPipelines.computeHeatmap;
            const p = encoder.beginComputePass({ label: useTree ? 'computeHeatmapTree' : 'computeHeatmap' });
            p.setPipeline(pipeline);
            p.setBindGroup(0, this._heatmapBGs.g0);
            p.setBindGroup(1, this._heatmapBGs.g1);
            p.setBindGroup(2, this._heatmapBGs.g2);
            p.dispatchWorkgroups(gridWG, gridWG);
            p.end();
        }

        // Blur each active channel
        const channels = ['gravPotential', 'elecPotential', 'yukawaPotential'];
        const channelToggles = [this._gravityEnabled, this._coulombEnabled, this._yukawaEnabled];
        const hmBuf = this._heatmapBuffers;

        for (let c = 0; c < 3; c++) {
            if (!channelToggles[c]) continue;
            const chName = channels[c];
            if (!this._heatmapBlurBGs[chName]) {
                this._heatmapBlurBGs[chName] = this.device.createBindGroup({
                    label: `heatmapBlur_${chName}`,
                    layout: this._heatmapPipelines.blurLayouts[0],
                    entries: [
                        { binding: 0, resource: { buffer: hmBuf[chName] } },
                        { binding: 1, resource: { buffer: hmBuf.blurTemp } },
                    ],
                });
            }
            // Horizontal blur
            {
                const p = encoder.beginComputePass({ label: `blurH_${chName}` });
                p.setPipeline(this._heatmapPipelines.blurHorizontal);
                p.setBindGroup(0, this._heatmapBlurBGs[chName]);
                p.dispatchWorkgroups(gridWG, gridWG);
                p.end();
            }
            // Vertical blur
            {
                const p = encoder.beginComputePass({ label: `blurV_${chName}` });
                p.setPipeline(this._heatmapPipelines.blurVertical);
                p.setBindGroup(0, this._heatmapBlurBGs[chName]);
                p.dispatchWorkgroups(gridWG, gridWG);
                p.end();
            }
        }
    }

    /** Expose field buffers for renderer overlay drawing */
    getFieldBuffers(which) {
        return which === 'higgs' ? this._higgsBuffers : this._axionBuffers;
    }

    /** Expose heatmap buffers for renderer overlay drawing */
    getHeatmapBuffers() { return this._heatmapBuffers; }

    /** Expose trail buffers for renderer trail drawing */
    getTrailBuffers() { return this._trailBuffers; }

    /** Set trails enabled state and lazily allocate trail buffers */
    setTrailsEnabled(enabled) {
        this._trailsEnabled = enabled;
        if (enabled && !this._trailBuffers) {
            this._trailBuffers = createTrailBuffers(this.device, this.buffers.maxParticles);
            // Create bind group for trail recording
            if (this._trailRecordPipeline) {
                const tb = this._trailBuffers;
                this._trailRecordBindGroup = this.device.createBindGroup({
                    label: 'trailRecord',
                    layout: this._trailRecordLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.buffers.particleState } },
                        { binding: 1, resource: { buffer: tb.trailX } },
                        { binding: 2, resource: { buffer: tb.trailY } },
                        { binding: 3, resource: { buffer: tb.trailWriteIdx } },
                        { binding: 4, resource: { buffer: tb.trailCount } },
                    ],
                });
            }
        }
    }

    /**
     * Run one frame: adaptive substepping with full Phase 2 force computation + Boris integrator.
     * When paused, the caller does not call update() — no compute dispatches are issued.
     * @param {number} dt - Total simulation time to advance this frame
     */
    update(dt) {
        if (!this._ready || this.aliveCount === 0 || dt <= 0) return;

        // Adaptive substepping: use maxAccel from previous frame
        const softening = this._blackHoleEnabled ? BH_SOFTENING : SOFTENING;
        let dtSafe = this._maxAccel > 1e-9
            ? Math.sqrt(softening / this._maxAccel)
            : dt;
        // Cyclotron limit would need Bz readback — for Phase 2, use conservative estimate
        const maxSubsteps = 32;
        const numSubsteps = Math.min(Math.ceil(dt / dtSafe), maxSubsteps);
        const dtSub = dt / numSubsteps;

        // Write slow-changing uniforms once per frame (toggles, domain, sliders, etc.)
        this._maybeRebaseEpoch();
        writeFrameUniforms(this.device, this.uniformBuffer, {
            dt: dtSub,
            simTime: this.gpuTime,
            domainW: this.domainW,
            domainH: this.domainH,
            speedScale: 1,
            softening: this._blackHoleEnabled ? BH_SOFTENING : SOFTENING,
            softeningSq: this._blackHoleEnabled ? BH_SOFTENING_SQ : SOFTENING_SQ,
            toggles0: this._toggles0,
            toggles1: this._toggles1,
            yukawaCoupling: this._yukawaCoupling,
            yukawaMu: this._yukawaMu,
            higgsMass: this._higgsMass,
            axionMass: this._axionMass,
            boundaryMode: this.boundaryMode,
            topologyMode: this.topologyMode,
            collisionMode: this._collisionMode,
            maxParticles: this.buffers.maxParticles,
            aliveCount: this.aliveCount,
            extGravity: this._extGravity,
            extGravityAngle: this._extGravityAngle,
            extElectric: this._extElectric,
            extElectricAngle: this._extElectricAngle,
            extBz: this._extBz,
            bounceFriction: this._bounceFriction,
            extGx: this._cachedExtGx,
            extGy: this._cachedExtGy,
            extEx: this._cachedExtEx,
            extEy: this._cachedExtEy,
            axionCoupling: this._axionCoupling,
            higgsCoupling: this._higgsCoupling,
            particleCount: this.aliveCount + this._ghostCount,
            bhTheta: 0.5,
            frameCount: this._frameCount,
        });
        updateGPUDispatchPlan(this, this._dispatchPlan);

        // One submit per substep: each substep's queue.writeBuffer() calls (simTime above
        // all) must land before that substep's passes, not before the whole frame's.
        for (let step = 0; step < numSubsteps; step++) {
            this.simTime += dtSub;
            this.device.queue.submit([this._dispatchSubstep(dtSub)]);
        }

        this._frameCount++;

        // Post-substep passes (once per frame)
        {
            const encoder = this.device.createCommandEncoder({ label: 'post-substep' });

            // Heatmap compute (every HEATMAP_INTERVAL=4 frames)
            this._heatmapFrame++;
            if (this._heatmapEnabled && (this._heatmapFrame & HEATMAP_INTERVAL_MASK) === 0) {
                this.dispatchHeatmap(encoder, this._lastCamera);
            }

            // Pion decay: once per frame, so the shader gets the frame's whole dt.
            // FRAGILE: assumes dt is at byte offset 0 in SimUniforms — do not reorder struct
            _postSubDt[0] = dt;
            this.device.queue.writeBuffer(this.uniformBuffer, 0, _postSubDt);
            this._dispatchPionDecay(encoder);

            // Boson interaction (if enabled): build boson tree + particle<-boson + boson<->boson + pion Coulomb + annihilation
            this._dispatchBosonInteraction(encoder, this._dispatchPlan);

            // Dead particle garbage collection
            this._dispatchDeadGC(encoder);

            // Quadrupole radiation (once per frame)
            // Uses PHYSICS_DT constant in shader (not u.dt which holds dtSub from last substep)
            this._dispatchQuadrupole(encoder);

            // Update particle colors from charge/mass/antimatter state
            if (this._updateColorsPipeline && this.aliveCount > 0) {
                _colorUniformData[0] = this._blackHoleEnabled ? 1 : 0;
                _colorUniformData[1] = this._isDarkTheme ? 1 : 0;
                this.device.queue.writeBuffer(this._colorUniformBuffer, 0, _colorUniformData);
                const p = encoder.beginComputePass({ label: 'updateColors' });
                p.setPipeline(this._updateColorsPipeline);
                p.setBindGroup(0, this._updateColorsBindGroup);
                p.dispatchWorkgroups(Math.ceil(this.aliveCount / 64));
                p.end();
            }

            // Record trail positions (every frame when trails enabled)
            if (this._trailRecordPipeline && this._trailBuffers && this._trailsEnabled && this.aliveCount > 0) {
                const p = encoder.beginComputePass({ label: 'trailRecord' });
                p.setPipeline(this._trailRecordPipeline);
                p.setBindGroup(0, this._trailRecordBindGroup);
                p.dispatchWorkgroups(Math.ceil(this.aliveCount / 64));
                p.end();
            }

            this.device.queue.submit([encoder.finish()]);
        }

        // Readback maxAccel for next frame (non-blocking)
        this._readbackMaxAccel();

        // Readback ghost count for next frame (non-blocking)
        this._readbackGhostCount();

        // Readback merge results for field excitations/debugging (non-blocking)
        this._readbackMergeResults();

        // Readback disintegration events for fragment spawning (non-blocking)
        this._readbackDisintegrationResults();

        // Readback kugelblitz collapse events (non-blocking)
        if (this._dispatchPlan.kugelblitzReadback) {
            this._readbackKugelblitzResults();
        }

        // Readback free stack for slot reuse (non-blocking)
        this._readbackFreeStack();
    }

    /**
     * Dispatch a single substep: all compute passes in sequence.
     * @param {number} dtSub - Substep timestep
     */
    _dispatchSubstep(dtSub) {
        // Write only the 5 substep-varying fields (dt, simTime, aliveCount, particleCount, frameCount)
        writeSubstepUniforms(this.device, this.uniformBuffer,
            dtSub, this.gpuTime, this.aliveCount,
            this.aliveCount + this._ghostCount, this._frameCount);

        const workgroups = Math.ceil(this.aliveCount / 64);
        if (workgroups === 0) return; // no particles, skip dispatch
        const p2 = this._phase2;
        const plan = this._dispatchPlan;

        let encoder = this.device.createCommandEncoder({ label: 'physics-substep' });

        // Pass 0: ghost generation (Phase 3 — before tree build)
        this._dispatchGhostGen(encoder);

        // Pass 0b: tree build (Phase 3 — after ghost gen, before force computation)
        this._dispatchTreeBuild(encoder);

        // Clear maxAccel for adaptive substepping (reset before force computation)
        encoder.clearBuffer(this.buffers.maxAccelBuffer, 0, 4);

        // Pass 1: resetForces (DMA clear is faster than compute dispatch for zeroing)
        encoder.clearBuffer(this.buffers.allForces, 0, this.aliveCount * 160);

        // Pass 2: cacheDerived
        const pass2 = encoder.beginComputePass({ label: 'cacheDerived' });
        pass2.setPipeline(p2.cacheDerived.pipeline);
        pass2.setBindGroup(0, this._bg_cacheDerived);
        pass2.dispatchWorkgroups(workgroups);
        pass2.end();

        // Pass 5: force computation — BH tree walk or O(N^2) pairwise. With Barnes–Hut and
        // Relativity, EM runs pairwise first (Liénard–Wiechert needs each source's world line)
        // and the tree walk adds everything else on top.
        const pairwise = !this._barnesHutEnabled || this._emPairwise;
        if (pairwise) {
            const pass5 = encoder.beginComputePass({ label: 'pairForce' });
            pass5.setPipeline(p2.pairForce.pipeline);
            pass5.setBindGroup(0, this._bg_pairForce0);
            pass5.setBindGroup(1, this._bg_pairForce1);
            pass5.setBindGroup(2, this._bg_pairForce2);
            pass5.setBindGroup(3, this._bg_pairForce3);
            pass5.dispatchWorkgroups(workgroups);
            pass5.end();
        }
        if (this._barnesHutEnabled) {
            // Tree walk force computation (O(N log N))
            const passTree = encoder.beginComputePass({ label: 'treeForce' });
            passTree.setPipeline(this._treeForcePipeline);
            passTree.setBindGroup(0, this._treeForceGroup0);
            passTree.setBindGroup(1, this._treeForceGroup1);
            passTree.setBindGroup(2, this._treeForceGroup2);
            passTree.setBindGroup(3, this._treeForceGroup3);
            passTree.dispatchWorkgroups(workgroups);
            passTree.end();
        }

        // Pass 5b: externalFields (skip when all external fields are zero)
        if (this._extGravity !== 0 || this._extElectric !== 0 || this._extBz !== 0) {
            const pass5b = encoder.beginComputePass({ label: 'externalFields' });
            pass5b.setPipeline(p2.externalFields.pipeline);
            pass5b.setBindGroup(0, this._bg_extFields);
            pass5b.dispatchWorkgroups(workgroups);
            pass5b.end();
        }

        // Pass 5c: scalar field forces (Higgs gradient + mass mod, Axion gradient + axMod/yukMod)
        // Must run BEFORE Boris so gradient forces are included in totalForce for half-kicks.
        // Uses previous substep's field gradients (computed at end of field evolve).
        if (this._fieldDeposit && (this._higgsEnabled || this._axionEnabled)) {
            this._writeFieldUniforms(dtSub);
        }
        this._dispatchFieldForces(encoder);

        // Pass 5c2: particle-field gravity, F = -m∇Φ_F (if gravity enabled)
        // Uses Φ_F from the previous substep's field step.
        this._dispatchFieldParticleGrav(encoder);

        // Pass 5d: save 1PN forces for velocity-Verlet correction (before Boris)
        if (this._onePNEnabled) {
            const passSave = encoder.beginComputePass({ label: 'saveF1pn' });
            passSave.setPipeline(p2.saveF1pn.pipeline);
            passSave.setBindGroup(0, this._bg_saveF1pn);
            passSave.dispatchWorkgroups(workgroups);
            passSave.end();
        }

        // Pass 6-8 fused: halfKick1 + borisRotate + halfKick2 in one dispatch.
        // Eliminates 2 barrier syncs + 4 redundant global memory loads/stores per particle.
        const passFused = encoder.beginComputePass({ label: 'borisFused' });
        passFused.setPipeline(p2.borisFused.pipeline);
        passFused.setBindGroup(0, this._bg_borisFused);
        passFused.dispatchWorkgroups(workgroups);
        passFused.end();

        // Pass 9: spinOrbit
        if (plan.spinOrbit) {
            const pass9 = encoder.beginComputePass({ label: 'spinOrbit' });
            pass9.setPipeline(p2.spinOrbit.pipeline);
            pass9.setBindGroup(0, this._bg_spinOrbit);
            pass9.dispatchWorkgroups(workgroups);
            pass9.end();
        }

        // Pass 10: applyTorques
        if (plan.applyTorques) {
            const pass10 = encoder.beginComputePass({ label: 'applyTorques' });
            pass10.setPipeline(p2.applyTorques.pipeline);
            pass10.setBindGroup(0, this._bg_torques);
            pass10.dispatchWorkgroups(workgroups);
            pass10.end();
        }

        // ── Radiation + drift + advanced passes (same encoder) ──

        // Pass 11: radiation reaction (Larmor, Hawking, pion emission) — BEFORE drift
        this._dispatchRadiation(encoder, plan);

        // Pass 12: borisDrift
        const pass12 = encoder.beginComputePass({ label: 'borisDrift' });
        pass12.setPipeline(p2.borisDrift.pipeline);
        pass12.setBindGroup(0, this._bg_drift);
        pass12.dispatchWorkgroups(workgroups);
        pass12.end();

        // Pass 12b: proper-time clocks and spoke angles (after the drift: new velocities)
        this._dispatchClocks(encoder);

        // Pass 13: cosmological expansion
        this._dispatchExpansion(encoder, dtSub);

        // Pass 14: 1PN velocity-Verlet correction
        this._dispatch1PNVV(encoder);

        // Pass 15: scalar field evolution (Higgs, Axion), one joint KDK.
        // Per-field uniform buffers carry each field's currentFieldType, so both
        // fields share one encoder.
        if (this._fieldDeposit) {
            if (this._higgsEnabled) this._writeFieldUniforms(dtSub, 0);
            if (this._axionEnabled) this._writeFieldUniforms(dtSub, 1);
            this._dispatchFieldStep(encoder, dtSub);
        }

        // (Field forces already dispatched at Pass 5c, before Boris)

        // Pass 17-18: collision detection + resolution
        this._dispatchCollisions(encoder);

        // Pass 19: field excitations from merge events
        this._dispatchFieldExcitations(encoder);

        // Pass 20: disintegration check
        this._dispatchDisintegration(encoder, dtSub);

        // Pass 21: boson update (photon/pion drift, absorption, decay)
        this._dispatchBosonUpdate(encoder, plan);

        // Pass 24: boundary
        const passBoundary = encoder.beginComputePass({ label: 'boundary' });
        passBoundary.setPipeline(this._boundaryPipeline);
        passBoundary.setBindGroup(0, this._boundaryBindGroup);
        passBoundary.dispatchWorkgroups(workgroups);
        passBoundary.end();

        // Pass 25: world lines — a sample when this substep crosses a WORLDLINE_DT mark,
        // otherwise merge breaks and death snapshots only
        const due = this.simTime >= this._nextWorldLineTime;
        this._dispatchRecordWorldLines(encoder, due);
        if (due) this._nextWorldLineTime = (Math.floor(this.simTime / WORLDLINE_DT) + 1) * WORLDLINE_DT;

        return encoder.finish();
    }

    /**
     * Non-blocking readback of maxAccel from GPU for adaptive substepping.
     * Uses 1-frame latency: reads previous frame's max acceleration.
     */
    async _readbackMaxAccel() {
        if (this._maxAccelPending) return;
        this._maxAccelPending = true;

        try {
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(this.buffers.maxAccelBuffer, 0,
                this.buffers.maxAccelStaging, 0, 4);
            this.device.queue.submit([encoder.finish()]);

            await this.buffers.maxAccelStaging.mapAsync(GPUMapMode.READ);
            const data = new Float32Array(this.buffers.maxAccelStaging.getMappedRange().slice(0));
            this.buffers.maxAccelStaging.unmap();

            // NaN/Inf guard: corrupted GPU readback would break adaptive substepping
            const val = data[0];
            this._maxAccel = (val === val && val < 1e20) ? val : 0;
        } catch (e) {
            // Device lost or other error — don't block future readbacks
        } finally {
            this._maxAccelPending = false;
        }
    }

    /**
     * Non-blocking readback of free stack from GPU for slot reuse.
     * Reads freeTop count first, then copies free indices to CPU pool.
     * Uses 1-frame latency.
     */
    async _readbackFreeStack() {
        if (this._freeTopPending) return;
        this._freeTopPending = true;
        const b = this.buffers;

        try {
            // Copy freeTop counter to staging
            const enc = this.device.createCommandEncoder();
            enc.copyBufferToBuffer(b.freeTop, 0, b.freeTopStaging, 0, 4);
            this.device.queue.submit([enc.finish()]);

            await b.freeTopStaging.mapAsync(GPUMapMode.READ);
            const topData = new Uint32Array(b.freeTopStaging.getMappedRange().slice(0));
            b.freeTopStaging.unmap();

            const count = topData[0];
            if (count > 0 && count <= MAX_PARTICLES) {
                // Copy free stack indices to staging
                const readBytes = count * 4;
                const enc2 = this.device.createCommandEncoder();
                enc2.copyBufferToBuffer(b.freeStack, 0, b.freeStackStaging, 0, readBytes);
                this.device.queue.submit([enc2.finish()]);

                await b.freeStackStaging.mapAsync(GPUMapMode.READ);
                const stackData = new Uint32Array(b.freeStackStaging.getMappedRange(0, readBytes).slice(0));
                b.freeStackStaging.unmap();

                // Transfer to CPU free pool (deduplicate against existing)
                for (let i = 0; i < stackData.length; i++) {
                    const slot = stackData[i];
                    if (slot < MAX_PARTICLES) this._cpuFreeSlots.push(slot);
                }

                // Reset GPU free stack (we've consumed all entries)
                this.device.queue.writeBuffer(b.freeTop, 0, _zeroU32);
            }
        } catch (e) {
            // Device lost or other error — don't block future readbacks
        } finally {
            this._freeTopPending = false;
        }
    }

    /** Store camera state for heatmap viewport calculation */
    setCamera(camera) {
        this._lastCamera = camera;
    }

    /**
     * Read all particle state from GPU and return a save-compatible JSON object.
     * This triggers an async readback. Only called on user action (save/download).
     * @param {Object} sim - The Simulation instance for camera/mode state
     * @returns {Promise<Object>} Save-compatible state object
     */
    async serialize(sim) {
        const count = this.aliveCount;
        const stateByteLen = count * PARTICLE_STATE_SIZE;

        // Create staging buffer for packed ParticleState readback
        const stagingState = this.device.createBuffer({
            size: stateByteLen,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const clockByteLen = count * 16;
        const stagingClock = this.device.createBuffer({
            size: Math.max(clockByteLen, 16),
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const encoder = this.device.createCommandEncoder({ label: 'serialize-readback' });
        encoder.copyBufferToBuffer(this.buffers.particleState, 0, stagingState, 0, stateByteLen);
        if (clockByteLen > 0) encoder.copyBufferToBuffer(this.buffers.clocks, 0, stagingClock, 0, clockByteLen);
        this.device.queue.submit([encoder.finish()]);

        await Promise.all([stagingState.mapAsync(GPUMapMode.READ), stagingClock.mapAsync(GPUMapMode.READ)]);
        const stateRaw = new ArrayBuffer(stateByteLen);
        new Uint8Array(stateRaw).set(new Uint8Array(stagingState.getMappedRange()));
        const clockF32 = new Float32Array(stagingClock.getMappedRange().slice(0));
        stagingState.unmap();
        stagingState.destroy();
        stagingClock.unmap();
        stagingClock.destroy();

        // Parse packed ParticleState structs (9 × 4 bytes each)
        const stateF32 = new Float32Array(stateRaw);
        const stateU32 = new Uint32Array(stateRaw);
        const STRIDE = PARTICLE_STATE_SIZE / 4; // 9 u32/f32 per particle

        const state = {
            version: 2,
            domain: { w: this.domainW, h: this.domainH },
            particles: [],
            toggles: {},
            settings: {
                collision: COL_NAMES[sim.collisionMode],
                boundary: BOUND_NAMES[sim.boundaryMode],
                topology: TOPO_NAMES[sim.topology],
                speed: sim.speedScale,
                friction: this._bounceFriction,
            },
            camera: {
                x: sim.camera.x,
                y: sim.camera.y,
                zoom: sim.camera.zoom,
            },
        };

        for (let i = 0; i < count; i++) {
            const base = i * STRIDE;
            const flags = stateU32[base + 8];
            if (!(flags & FLAG_ALIVE)) continue;
            state.particles.push({
                x: stateF32[base + 0],      // posX
                y: stateF32[base + 1],      // posY
                wx: stateF32[base + 2],     // velWX
                wy: stateF32[base + 3],     // velWY
                mass: stateF32[base + 4],   // mass
                charge: stateF32[base + 5], // charge
                angw: stateF32[base + 6],   // angW
                baseMass: stateF32[base + 7], // baseMass
                antimatter: !!(flags & FLAG_ANTIMATTER),
                tau: clockF32[i * 4],         // proper time
                theta: clockF32[i * 4 + 2],   // spoke angle
            });
        }

        // Map internal toggle bits back to boolean flags
        const t0 = this._toggles0;
        const t1 = this._toggles1;
        state.toggles.gravityEnabled = !!(t0 & GRAVITY_BIT);
        state.toggles.coulombEnabled = !!(t0 & COULOMB_BIT);
        state.toggles.magneticEnabled = !!(t0 & MAGNETIC_BIT);
        state.toggles.gravitomagEnabled = !!(t0 & GRAVITOMAG_BIT);
        state.toggles.onePNEnabled = !!(t0 & ONE_PN_BIT);
        state.toggles.relativityEnabled = !!(t0 & RELATIVITY_BIT);
        state.toggles.spinOrbitEnabled = !!(t0 & SPIN_ORBIT_BIT);
        state.toggles.radiationEnabled = !!(t0 & RADIATION_BIT);
        state.toggles.blackHoleEnabled = !!(t0 & BLACK_HOLE_BIT);
        state.toggles.disintegrationEnabled = !!(t0 & DISINTEGRATION_BIT);
        state.toggles.expansionEnabled = !!(t0 & EXPANSION_BIT);
        state.toggles.yukawaEnabled = !!(t0 & YUKAWA_BIT);
        state.toggles.higgsEnabled = !!(t0 & HIGGS_BIT);
        state.toggles.axionEnabled = !!(t0 & AXION_BIT);
        state.toggles.barnesHutEnabled = !!(t0 & BARNES_HUT_BIT);
        state.toggles.bosonInterEnabled = !!(t0 & BOSON_INTER_BIT);
        // field gravity follows gravity (no separate toggle)

        for (const [key, slot] of Object.entries(GPU_PARAMETER_SLOTS)) {
            state[key] = this[slot];
        }

        return state;
    }

    /**
     * Read back scalar field data from GPU for CPU fallback on backend switch.
     * Returns Float32Arrays at GPU resolution (FIELD_GRID_RES × FIELD_GRID_RES).
     * Caller must downsample from GPU grid (128×128) to CPU grid (64×64).
     * @returns {Promise<{higgsField, higgsFieldDot, axionField, axionFieldDot}>}
     */
    async readbackFieldData() {
        const gridBytes = FIELD_GRID_RES * FIELD_GRID_RES * 4;
        const result = { higgsField: null, higgsFieldDot: null, axionField: null, axionFieldDot: null };

        const readBuffer = async (gpuBuffer) => {
            const staging = this.device.createBuffer({
                size: gridBytes,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            const encoder = this.device.createCommandEncoder({ label: 'field-readback' });
            encoder.copyBufferToBuffer(gpuBuffer, 0, staging, 0, gridBytes);
            this.device.queue.submit([encoder.finish()]);
            await staging.mapAsync(GPUMapMode.READ);
            const data = new Float32Array(FIELD_GRID_RES * FIELD_GRID_RES);
            data.set(new Float32Array(staging.getMappedRange()));
            staging.unmap();
            staging.destroy();
            return data;
        };

        try {
            if (this._higgsBuffers) {
                result.higgsField = await readBuffer(this._higgsBuffers.field);
                result.higgsFieldDot = await readBuffer(this._higgsBuffers.fieldDot);
            }
            if (this._axionBuffers) {
                result.axionField = await readBuffer(this._axionBuffers.field);
                result.axionFieldDot = await readBuffer(this._axionBuffers.fieldDot);
            }
        } catch (e) {
            console.warn('[physsim] Field readback failed:', e);
        }

        return result;
    }

    /**
     * Load a save state into GPU buffers.
     * @param {Object} state - JSON state from serialize() or CPU saveState()
     * @param {Object} sim - The Simulation instance
     * @returns {boolean} Success
     */
    deserialize(state, sim) {
        if (!state || state.version !== 2) return false;

        this.reset();

        // G16: Build full packed arrays CPU-side, then issue one writeBuffer per buffer type.
        // This replaces N×6 individual writeBuffer calls with 6 batched uploads.
        const particles = state.particles;
        const count = Math.min(particles.length, MAX_PARTICLES);

        for (let idx = 0; idx < count; idx++) {
            const pd = particles[idx];
            const m = pd.mass || 1;
            const bm = pd.baseMass ?? m;
            const q = pd.charge || 0;
            const angw = pd.angw || 0;
            const flagBits = FLAG_ALIVE | (pd.antimatter ? FLAG_ANTIMATTER : 0);

            // Pack ParticleState (9 × 4 bytes = 36)
            const sBase = idx * 9; // 9 f32/u32 per particle
            _dsStateF32[sBase + 0] = pd.x;
            _dsStateF32[sBase + 1] = pd.y;
            _dsStateF32[sBase + 2] = pd.wx || 0;
            _dsStateF32[sBase + 3] = pd.wy || 0;
            _dsStateF32[sBase + 4] = m;
            _dsStateF32[sBase + 5] = q;
            _dsStateF32[sBase + 6] = angw;
            _dsStateF32[sBase + 7] = bm;
            _dsStateU32[sBase + 8] = flagBits;

            // Pack ParticleAux (5 × 4 bytes = 20)
            const aBase = idx * 5;
            _dsAuxF32[aBase + 0] = Math.cbrt(m);  // radius
            _dsAuxU32[aBase + 1] = idx;            // particleId
            _dsAuxF32[aBase + 2] = 3.4028235e38;  // deathTime = FLT_MAX (alive)
            _dsAuxF32[aBase + 3] = 0;              // deathMass
            _dsAuxF32[aBase + 4] = 0;              // deathAngVel

            // Pack color (1 u32)
            _dsColorData[idx] = _DEFAULT_SLATE_ABGR; // default slate (update-colors will refresh)

            // Pack axYukMod (4 f32 = 16 bytes): axMod, yukMod, higgsMod, _pad
            const mBase = idx * 4;
            _dsModData[mBase + 0] = 1.0;
            _dsModData[mBase + 1] = 1.0;
            _dsModData[mBase + 2] = 1.0;
            _dsModData[mBase + 3] = 0.0;

            // RadiationState (12 f32 = 48 bytes) — all zero (accumulator reset)
            const rBase = idx * 12;
            for (let k = 0; k < 12; k++) _dsRadData[rBase + k] = 0;

            // Clock: τ, ring phase, θ, lapse
            const tau = pd.tau || 0;
            _dsClockData[idx * 4 + 0] = tau;
            _dsClockData[idx * 4 + 1] = tau - CLOCK_PERIOD * Math.floor(tau / CLOCK_PERIOD);
            _dsClockData[idx * 4 + 2] = pd.theta || 0;
            _dsClockData[idx * 4 + 3] = 1;

            // World-line meta (shared-worldline.wgsl): writeIdx, count, creation time,
            // generation, identity deck
            const hBase = idx * WL_META_STRIDE;
            _dsMetaU32.fill(0, hBase, hBase + WL_META_STRIDE);
            _dsMetaU32[hBase + 0] = 1;          // writeIdx (the birth sample is written below)
            _dsMetaU32[hBase + 1] = 1;          // count
            _dsMetaF32[hBase + 2] = -Infinity;  // creationTime — always existing particle
            _dsMetaU32[hBase + 3] = ++this._slotGeneration[idx];
        }

        if (count > 0) {
            const b = this.buffers;
            // Issue one writeBuffer per buffer type (6 calls total instead of N×6).
            // ArrayBuffer args: (buffer, bufferByteOffset, arrayBuffer, byteOffset, byteLength)
            // TypedArray args:  (buffer, bufferByteOffset, typedArray, elementOffset, elementCount)
            this.device.queue.writeBuffer(b.particleState,  0, _dsStateData,  0, count * PARTICLE_STATE_SIZE);   // ArrayBuffer, bytes
            this.device.queue.writeBuffer(b.particleAux,    0, _dsAuxData,    0, count * PARTICLE_AUX_SIZE);      // ArrayBuffer, bytes
            this.device.queue.writeBuffer(b.color,          0, _dsColorData,  0, count);                          // Uint32Array, elements (1 u32 per particle)
            this.device.queue.writeBuffer(b.axYukMod,       0, _dsModData,    0, count * 4);                      // Float32Array, elements (4 f32 per particle)
            this.device.queue.writeBuffer(b.radiationState, 0, _dsRadData,    0, count * 12);                     // Float32Array, elements (12 f32 per particle)
            this.device.queue.writeBuffer(b.wlMeta, 0, _dsMetaData, 0, count * WL_META_STRIDE * 4);          // ArrayBuffer, bytes
            this.device.queue.writeBuffer(b.clocks, 0, _dsClockData, 0, count * 4);                            // Float32Array, elements
        }
        for (let idx = 0; idx < count; idx++) {
            const pd = particles[idx];
            this._writeBirthSample(idx, pd.x, pd.y, pd.wx || 0, pd.wy || 0, pd.mass || 1, pd.charge || 0,
                pd.angw || 0, pd.tau || 0, pd.theta || 0);
        }

        this.aliveCount = count;

        // Restore slider parameters from save state
        for (const [key, slot] of Object.entries(GPU_PARAMETER_SLOTS)) {
            if (state[key] !== undefined && state[key] !== null) this[slot] = state[key];
        }
        this._cachedExtGx = (this._extGravity || 0) * Math.cos(this._extGravityAngle || 0);
        this._cachedExtGy = (this._extGravity || 0) * Math.sin(this._extGravityAngle || 0);
        this._cachedExtEx = (this._extElectric || 0) * Math.cos(this._extElectricAngle || 0);
        this._cachedExtEy = (this._extElectric || 0) * Math.sin(this._extElectricAngle || 0);

        this.syncUniforms();
        return true;
    }

    reset() {
        this.aliveCount = 0;
        this.simTime = 0;
        this.timeEpoch = 0;
        this._nextWorldLineTime = 0;
        this._frameCount = 0;
        this._heatmapFrame = 0;
        this._pendingMergeEvents = [];
        this._pendingDisintEvents = [];
        this._pendingKugelblitzEvents = [];
        this._cpuFreeSlots = [];
        // Reset GPU free stack (reuse pre-allocated zero buffer)
        if (this.buffers.freeTop) {
            this.device.queue.writeBuffer(this.buffers.freeTop, 0, _zeroU32);
        }
        this.resetFields();
        // Clear boson pools (reuse pre-allocated zero buffer)
        if (this.buffers.phCount) {
            this.device.queue.writeBuffer(this.buffers.phCount, 0, _zeroU32);
        }
        if (this.buffers.piCount) {
            this.device.queue.writeBuffer(this.buffers.piCount, 0, _zeroU32);
        }
        // Clear heatmap + trail buffers (batch into one encoder/submit)
        if (this._heatmapBuffers || this._trailBuffers) {
            const enc = this.device.createCommandEncoder({ label: 'clearReset' });
            if (this._heatmapBuffers) {
                enc.clearBuffer(this._heatmapBuffers.gravPotential);
                enc.clearBuffer(this._heatmapBuffers.elecPotential);
                enc.clearBuffer(this._heatmapBuffers.yukawaPotential);
                enc.clearBuffer(this._heatmapBuffers.output);
            }
            if (this._trailBuffers) {
                enc.clearBuffer(this._trailBuffers.trailWriteIdx);
                enc.clearBuffer(this._trailBuffers.trailCount);
            }
            this.device.queue.submit([enc.finish()]);
        }
    }

    /**
     * Sync all toggle/slider state to the GPU uniforms buffer.
     * Called once per frame before compute dispatch.
     */
    syncUniforms() {
        writeFrameUniforms(this.device, this.uniformBuffer, {
            dt: 0,
            simTime: this.gpuTime,
            domainW: this.domainW,
            domainH: this.domainH,
            aliveCount: this.aliveCount,
            toggles0: this._toggles0,
            toggles1: this._toggles1,
            boundaryMode: this.boundaryMode,
            topologyMode: this.topologyMode,
            collisionMode: this._collisionMode,
            bounceFriction: this._bounceFriction,
            yukawaCoupling: this._yukawaCoupling,
            yukawaMu: this._yukawaMu,
            higgsMass: this._higgsMass,
            axionMass: this._axionMass,
            higgsCoupling: this._higgsCoupling,
            axionCoupling: this._axionCoupling,
            extGravity: this._extGravity,
            extGravityAngle: this._extGravityAngle,
            extElectric: this._extElectric,
            extElectricAngle: this._extElectricAngle,
            extBz: this._extBz,
            extGx: this._cachedExtGx,
            extGy: this._cachedExtGy,
            extEx: this._cachedExtEx,
            extEy: this._cachedExtEy,
            maxParticles: this.buffers.maxParticles,
            particleCount: this.aliveCount + this._ghostCount,
            bhTheta: 0.5,
            frameCount: this._frameCount,
        });
    }

    /** Reset field buffers to vacuum on preset load */
    resetFields() {
        if (this._higgsBuffers) this._initFieldToVacuum('higgs');
        if (this._axionBuffers) this._initFieldToVacuum('axion');
    }

    /**
     * Queue a GPU hit test. Dispatches the hit test compute shader and starts
     * async readback. Result available via readHitResult() once ready.
     * Uses BH tree when available, falls back to O(N) linear scan.
     */
    hitTest(worldX, worldY) {
        if (!this._hitTestPipeline || !this._hitUniformBuffer) return;
        if (this._hitPending) return; // don't queue while readback is in flight

        // Write click coordinates + aliveCount to uniform
        _hitUniformF32[0] = worldX;
        _hitUniformF32[1] = worldY;
        _hitUniformU32[2] = this.aliveCount;
        _hitUniformU32[3] = 0;
        this.device.queue.writeBuffer(this._hitUniformBuffer, 0, _hitUniformData);

        // Dispatch single-thread compute
        const encoder = this.device.createCommandEncoder({ label: 'hitTest' });
        const pass = encoder.beginComputePass({ label: 'hitTest' });
        pass.setPipeline(this._hitTestPipeline);
        pass.setBindGroup(0, this._hitTestBindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();

        // Copy result to staging for readback
        encoder.copyBufferToBuffer(this._hitResultBuffer, 0, this._hitResultStaging, 0, 48);
        this.device.queue.submit([encoder.finish()]);

        // Async readback
        this._hitPending = true;
        this._hitResultStaging.mapAsync(GPUMapMode.READ).then(() => {
            const buf = this._hitResultStaging.getMappedRange().slice(0);
            this._hitResultStaging.unmap();
            this._hitStagingI32 = new Int32Array(buf);
            this._hitStagingF32 = new Float32Array(buf);
            this._hitResultReady = true;
            this._hitPending = false;
        }).catch(() => {
            this._hitPending = false;
        });
    }

    /**
     * Read the result of a previously queued GPU hit test.
     * Returns null if not ready yet, or an object:
     *   { index, mass, charge, radius, velX, velY, angVel, posX, posY, antimatter }
     * index is -1 if no particle was hit.
     */
    readHitResult() {
        if (!this._hitResultReady || !this._hitStagingI32) return null;
        this._hitResultReady = false;
        const idx = this._hitStagingI32[0];
        if (idx < 0) return { index: -1 };
        const f = this._hitStagingF32;
        return {
            index: idx,
            antimatter: (this._hitStagingI32[9] & FLAG_ANTIMATTER) !== 0,
            mass: f[1],
            charge: f[2],
            radius: f[3],
            velX: f[4],
            velY: f[5],
            angVel: f[6],
            posX: f[7],
            posY: f[8],
        };
    }

    /** Rebuild group 1 bind group for stats shader (field buffers). Call when fields toggle. */
    _rebuildStatsFieldBindGroup() {
        if (!this._statsGroup1Layout) return;
        const dummy = this._statsDummyBuffer;
        const hb = this._higgsBuffers;
        const ab = this._axionBuffers;
        this._statsBindGroup1 = this.device.createBindGroup({
            label: 'computeStats_g1',
            layout: this._statsGroup1Layout,
            entries: [
                { binding: 0, resource: { buffer: hb ? hb.field : dummy } },
                { binding: 1, resource: { buffer: hb ? hb.fieldDot : dummy } },
                { binding: 2, resource: { buffer: ab ? ab.field : dummy } },
                { binding: 3, resource: { buffer: ab ? ab.fieldDot : dummy } },
            ],
        });
    }

    /**
     * Dispatch the stats compute shader and start async readback.
     * @param {number} selectedGpuIdx  GPU buffer index of selected particle, or -1
     * @returns {boolean} false if skipped (not ready, or a readback still in flight)
     */
    requestStats(selectedGpuIdx = -1) {
        if (!this._statsPipelines || !this._statsUniformBuffer) return false;
        if (this._statsPending) return false; // readback still in flight

        // Write uniforms (StatsUniforms: 48 bytes = 12 u32/f32)
        _statsUniformU32[0] = this.aliveCount;
        _statsUniformI32[1] = selectedGpuIdx;
        _statsUniformU32[2] = this._toggles0;
        _statsUniformF32[3] = this.domainW;
        _statsUniformF32[4] = this.domainH;
        _statsUniformF32[5] = this._yukawaMu;
        _statsUniformF32[6] = this._higgsMass;
        _statsUniformF32[7] = this._axionMass || 0.05;
        _statsUniformU32[8] = FIELD_GRID_RES; // fieldGridRes (GPU_SCALAR_GRID)
        _statsUniformU32[9] = this.boundaryMode;
        _statsUniformU32[10] = this.topologyMode;
        _statsUniformU32[11] = 0;
        this.device.queue.writeBuffer(this._statsUniformBuffer, 0, _statsUniformData);

        // Rebuild field bind group if needed (field buffers may have been lazily allocated)
        if (!this._statsBindGroup1 ||
            (this._higgsBuffers && !this._statsFieldHasHiggs) ||
            (this._axionBuffers && !this._statsFieldHasAxion)) {
            this._rebuildStatsFieldBindGroup();
            this._statsFieldHasHiggs = !!this._higgsBuffers;
            this._statsFieldHasAxion = !!this._axionBuffers;
        }

        // Dispatch 4 entry points sequentially in one encoder
        const encoder = this.device.createCommandEncoder({ label: 'computeStats' });
        const sp = this._statsPipelines;

        // Pass 1+2: KE, momentum, COM, angular momentum (parallel, 64 threads)
        const p1 = encoder.beginComputePass({ label: 'statsKEMom' });
        p1.setPipeline(sp.statsKEMom);
        p1.setBindGroup(0, this._statsBindGroup0);
        p1.setBindGroup(1, this._statsBindGroup1);
        p1.dispatchWorkgroups(1);
        p1.end();

        // Pass 3: PE + Darwin (serial O(N²))
        const p2 = encoder.beginComputePass({ label: 'statsPE' });
        p2.setPipeline(sp.statsPE);
        p2.setBindGroup(0, this._statsBindGroup0);
        p2.setBindGroup(1, this._statsBindGroup1);
        p2.dispatchWorkgroups(1);
        p2.end();

        // Pass 4: Scalar field energy + momentum (parallel, 64 threads)
        const p3 = encoder.beginComputePass({ label: 'statsField' });
        p3.setPipeline(sp.statsField);
        p3.setBindGroup(0, this._statsBindGroup0);
        p3.setBindGroup(1, this._statsBindGroup1);
        p3.dispatchWorkgroups(1);
        p3.end();

        // Pass 5+6: PFI + selected particle (serial)
        const p4 = encoder.beginComputePass({ label: 'statsPFISel' });
        p4.setPipeline(sp.statsPFISel);
        p4.setBindGroup(0, this._statsBindGroup0);
        p4.setBindGroup(1, this._statsBindGroup1);
        p4.dispatchWorkgroups(1);
        p4.end();

        // Copy to staging (double-buffered)
        const staging = this._statsStagingFlip
            ? this.buffers.statsStagingB
            : this.buffers.statsStagingA;
        this._statsStagingFlip = !this._statsStagingFlip;
        encoder.copyBufferToBuffer(this.buffers.statsBuffer, 0, staging, 0, 512);
        this.device.queue.submit([encoder.finish()]);

        // Async readback
        this._statsPending = true;
        staging.mapAsync(GPUMapMode.READ).then(() => {
            this._statsData = new Float32Array(staging.getMappedRange().slice(0));
            this._statsDataSel = selectedGpuIdx;
            staging.unmap();
            this._statsResultReady = true;
            this._statsPending = false;
        }).catch(() => {
            this._statsPending = false;
        });
        return true;
    }

    /**
     * Read the result of a previously requested stats computation.
     * Returns null if not ready, or an object with aggregate stats + selected particle data.
     */
    readStats() {
        if (!this._statsResultReady || !this._statsData) return null;
        this._statsResultReady = false;
        const d = this._statsData;
        const result = {
            linearKE: d[0], spinKE: d[1],
            px: d[2], py: d[3],
            orbitalAngMom: d[4], spinAngMom: d[5],
            comX: d[6], comY: d[7],
            totalMass: d[8], aliveCount: d[9],
            pe: d[10],
            fieldEnergy: d[11], // Darwin
            fieldPx: d[12], fieldPy: d[13], // Darwin momentum
            higgsFieldEnergy: d[14], axionFieldEnergy: d[15],
            pfiEnergy: d[16] + d[17], // higgs + axion particle-field interaction
            scalarFieldMomX: d[18], scalarFieldMomY: d[19],
            selectedIdx: this._statsDataSel, // the selection this readback describes
            selected: null,
            reference: null,
        };

        // Selected particle data at offset 32 (mass = -1 signals no selection)
        if (d[36] > 0) {
            const flags = new Uint32Array(d.buffer, 40 * 4, 1)[0];
            result.selected = {
                posX: d[32], posY: d[33],
                velWX: d[34], velWY: d[35],
                mass: d[36], charge: d[37],
                angW: d[38], baseMass: d[39],
                flags,
                radius: d[41],
                velX: d[42], velY: d[43],
                angVel: d[44],
                magMoment: d[45], angMomentum: d[46],
                antimatter: d[47] > 0.5,
                forceGravity:    { x: d[48], y: d[49] },
                forceCoulomb:    { x: d[50], y: d[51] },
                forceMagnetic:   { x: d[52], y: d[53] },
                forceGravitomag: { x: d[54], y: d[55] },
                force1PN:        { x: d[56], y: d[57] },
                forceSpinCurv:   { x: d[58], y: d[59] },
                forceRadiation:  { x: d[60], y: d[61] },
                forceYukawa:     { x: d[62], y: d[63] },
                forceExternal:   { x: d[64], y: d[65] },
                forceHiggs:      { x: d[66], y: d[67] },
                forceAxion:      { x: d[68], y: d[69] },
                axMod: d[70], yukMod: d[71], higgsMod: d[72],
                tau: d[73], lapse: d[74], theta: d[75],
            };
        }
        if (d[84] > 0) {
            result.reference = {
                index: new Uint32Array(d.buffer, 91 * 4, 1)[0],
                posX: d[80], posY: d[81],
                velX: d[82], velY: d[83],
                mass: d[84], charge: d[85],
                angVel: d[86], magMoment: d[87], angMomentum: d[88],
                radius: d[89], higgsMod: d[90],
            };
        }
        return result;
    }

    /**
     * Get the count of alive particles.
     * @returns {number}
     */
    getParticleCount() {
        return this.aliveCount;
    }

    destroy() {
        const _d = b => { if (b) b.destroy(); };
        const _dObj = o => { if (o) Object.values(o).forEach(_d); };

        // Core buffers
        this.buffers.destroy();
        _d(this._clockScratch);
        this.uniformBuffer.destroy();
        _d(this._qtCounterSrc);
        _d(this._qtBoundsSrc);
        _d(this._bosonRootSrc);

        // Scalar field buffers
        _dObj(this._higgsBuffers);
        _dObj(this._axionBuffers);
        _dObj(this._gravGrid);
        _d(this._atomicGrid);
        _d(this._fieldUniformBuffer);
        _d(this._higgsUniformBuffer);
        _d(this._axionUniformBuffer);
        _d(this._dummyFieldBuffer);
        _d(this._fieldParticleGravUniform);

        // Heatmap
        _dObj(this._heatmapBuffers);
        _d(this._heatmapUniformBuffer);

        // Excitation and disintegration
        _dObj(this._excitationBuffers);
        _dObj(this._disintBuffers);
        _d(this._disintUniformBuffer);
        _d(this._bosonDispatchArgs);

        // Trails
        _dObj(this._trailBuffers);

        // Expansion
        _d(this._expansionUniformBuffer);

        // FFT
        _d(this._fftParamsBuffer);

        // Update colors
        _d(this._colorUniformBuffer);

        // Hit test
        _d(this._hitUniformBuffer);
        _d(this._hitResultBuffer);
        _d(this._hitResultStaging);

        // Stats
        _d(this._statsUniformBuffer);
        _d(this._statsDummyBuffer);

        // Null out references
        this._higgsBuffers = null;
        this._axionBuffers = null;
        this._gravGrid = null;
        this._gravBGs = null;
        this._atomicGrid = null;
        this._heatmapBuffers = null;
        this._excitationBuffers = null;
        this._disintBuffers = null;
        this._disintBGs = null;
        this._bosonDispatchArgs = null;
        this._bosonDispatchArgsBG = null;
        this._trailBuffers = null;
        this._fieldUniformBuffer = null;
        this._higgsUniformBuffer = null;
        this._axionUniformBuffer = null;
        this._dummyFieldBuffer = null;
        this._fieldParticleGravUniform = null;
        this._heatmapUniformBuffer = null;
        this._expansionUniformBuffer = null;
        this._disintUniformBuffer = null;
        this._fftParamsBuffer = null;
        this._colorUniformBuffer = null;
        this._hitUniformBuffer = null;
        this._hitResultBuffer = null;
        this._hitResultStaging = null;
        this._statsUniformBuffer = null;
        this._statsDummyBuffer = null;
        this._qtCounterSrc = null;
        this._qtBoundsSrc = null;
        this._bosonRootSrc = null;
    }
}

// Flag constants (must match common.wgsl)
const FLAG_ALIVE = 1;
const FLAG_RETIRED = 2;
const FLAG_ANTIMATTER = 4;

// fetchShader imported from gpu-pipelines.js (single source of truth)
