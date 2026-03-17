/**
 * @fileoverview Backend interface contracts for physics and rendering.
 *
 * Both CPU and GPU backends implement these interfaces.
 * The UI layer (ui.js, input.js, save-load.js) interacts only through these methods.
 */

/**
 * @typedef {Object} ParticleState
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} mass
 * @property {number} charge
 * @property {number} angVel
 * @property {number} radius
 * @property {boolean} antimatter
 */

/**
 * @typedef {Object} SimStats
 * @property {number} ke - Kinetic energy
 * @property {number} pe - Potential energy
 * @property {number} px - Momentum x
 * @property {number} py - Momentum y
 * @property {number} angL - Angular momentum
 * @property {number} drift - Energy drift from initial
 * @property {number} particleCount
 */

/**
 * @typedef {Object} PhysicsBackend
 * @property {function(number): void} update - Advance simulation by dt
 * @property {function(): number} getParticleCount
 * @property {function(): SimStats} getStats
 * @property {function(Object): number} addParticle - Returns slot index
 * @property {function(number): void} removeParticle
 * @property {function(number): Array<{label: string, x: number, y: number}>} getSelectedForceBreakdown - 11 force vectors
 * @property {function(string): Float32Array} getFieldData - Field overlay data
 * @property {function(Object): void} setUniforms - Update toggles/sliders
 * @property {function(): Object} serialize
 * @property {function(Object): void} deserialize
 * @property {function(): void} reset
 * @property {function(string): void} loadPreset
 */

/**
 * @typedef {Object} RenderBackend
 * @property {function(): void} render
 * @property {function(number, number): void} resize
 * @property {function(boolean): void} setTheme
 */

export const BACKEND_CPU = 'cpu';
export const BACKEND_GPU = 'gpu';
