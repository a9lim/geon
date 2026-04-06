# Geon — Interactive Particle Physics Simulator

Geon is a real-time N-body simulator that models how particles move under gravity, electromagnetism, and relativistic effects. It runs in the browser using WebGPU compute shaders for parallel force calculation.

## Forces

Geon simulates 11 force types: Newtonian gravity, gravitomagnetism (frame-dragging), Coulomb electrostatics, magnetic (Lorentz) force, Yukawa interaction, Higgs field coupling, axion field coupling, cosmological expansion (Hubble flow), first post-Newtonian correction, spin-orbit coupling, and radiation reaction. Forces are computed pairwise using Barnes-Hut tree acceleration for O(N log N) scaling.

## Integration

Particle trajectories are advanced with a Boris integrator, which preserves phase-space volume and handles strong magnetic fields without drift. Relativistic corrections use the 1PN approximation from general relativity.

## Presets

Nineteen curated presets demonstrate specific physical phenomena: Keplerian orbits, electromagnetic confinement, Rutherford scattering, Higgs potential wells, axion halos, Hubble expansion, gravitational wave inspiral, and more. Each preset sets initial conditions and force parameters to illustrate one concept clearly.

## Educational Use

Designed for undergraduate physics education. Students can toggle individual forces on and off, adjust coupling constants, and observe how changes affect particle trajectories in real time. The simulation makes abstract concepts like frame-dragging and scalar field coupling visible and interactive.

## Technical Details

WebGPU compute shaders handle force summation in parallel. Falls back to Canvas 2D on devices without WebGPU support. All computation runs client-side with no server dependency.
