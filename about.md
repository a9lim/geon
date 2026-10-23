---
name: Geon
title: Geon — Interactive Particle Physics Simulator
description: Explore relativistic many-body dynamics, electromagnetism, compact objects, scalar fields, and nontrivial topologies across fifteen browser presets.
updated: 2026-10-23
---

# Geon — Interactive Particle Physics Simulator

Geon is a real-time N-body simulator that models how particles move under gravity, electromagnetism, and relativistic effects. It runs in the browser on WebGPU compute shaders.

## Forces

Geon exposes 11 force and correction families: Newtonian gravity, gravitomagnetism (frame-dragging), Coulomb electrostatics, magnetic (Lorentz) force, Yukawa interaction, Higgs field coupling, axion field coupling, cosmological expansion (Hubble flow), first post-Newtonian correction, spin-orbit coupling, and radiation reaction. Applicable particle and boson interactions can use Barnes-Hut tree acceleration; scalar fields evolve on grids, and external or correction terms run in their own passes.

## Integration

Particle trajectories are advanced with a phase-space-volume-preserving Boris rotation and adaptive substeps. Relativistic corrections use a first post-Newtonian approximation rather than a full general-relativistic geodesic solve.

## Proper Time

Internal processes run on each body's own clock rather than on lab time. Pion decay, Hawking evaporation, Schwinger discharge, superradiance, and Roche mass transfer advance by the body's proper time, so a neutral pion beam at Lorentz factor 5 travels five times farther before half of it decays, and a black hole moving at γ = 2 takes twice as long to evaporate. Emission happens in the emitter's rest frame and is boosted into the lab with the matching recoil. Photons and leptons are removed from their pools after a fixed age; that cull bounds memory and is not a physical lifetime.

## Scalar Fields

The Higgs and axion fields evolve on a 128 × 128 grid. With gravity on, they evolve in the metric ds² = −e^{2Φ}dt² + e^{−2Φ}dx², whose Klein–Gordon equation reduces to the weak-field form at small Φ and stays well behaved in deep wells. The potential Φ comes from the fields' own energy and the particles' mass, solved by FFT convolution over a sheet of thickness 8, so field oscillations near a massive body slow by the gravitational redshift factor e^Φ.

## Presets

Fifteen curated presets cover Keplerian motion, relativistic precession, binary inspiral, Hawking evaporation, atomic and nuclear toy systems, bremsstrahlung, magnetic dipoles, pion exchange, Higgs and axion fields, Peccei-Quinn dynamics, and cosmological expansion. Each preset sets initial conditions and force parameters for one compact demonstration.

## Black Hole Physics

In black hole mode, particles use a Kerr-Newman-inspired effective radius determined by mass, charge, and spin. Sub-extremal parameters use the usual outer-horizon formula; super-extremal toy inputs are clamped to an effective radius rather than modeled as physical naked singularities. Gravity switches to a Paczynski-Wiita-style pseudo-potential, so the effective potential steepens near the horizon and infalling particles are swallowed once their centers cross it. Hawking radiation follows Stefan-Boltzmann scaling from the Kerr-Newman temperature — smaller black holes are hotter and evaporate faster, ending in a burst of two photons that carries off the hole's remaining energy and momentum. Charged black holes also undergo Schwinger discharge: the electric field near the effective horizon exceeds the critical threshold and tears electron-positron pairs from the vacuum. The same-sign lepton escapes while the opposite-sign partner falls back in, reducing the black hole's charge by one quantized unit per event. If a toy input is over the Kerr-Newman charge bound, the black hole sheds same-sign leptons in quantized steps and clamps to the nearest allowed charge as a numerical backstop. Spinning black holes with the axion field enabled exhibit superradiance: when the horizon angular velocity exceeds the axion mass, the field extracts rotational energy and grows a scalar cloud around the black hole. The black hole spins down until the superradiance condition fails, providing a natural saturation mechanism.

## Charge Quantization

All charges are quantized in units of the boson charge (default 0.1). Particle charges are rounded to the nearest multiple on creation, and all transfer processes — pion emission, Schwinger discharge, extremal black hole charge shedding — conserve charge in discrete steps. This ensures exact charge conservation and prevents continuous drift.

## Educational Use

Designed for undergraduate physics education. Students can toggle individual forces on and off, adjust coupling constants, and observe how changes affect particle trajectories in real time. The simulation makes abstract concepts like frame-dragging and scalar field coupling visible and interactive.

## Technical Details

WebGPU compute shaders run the whole simulation and WebGPU instanced rendering draws it; there is no CPU fallback, and browsers without WebGPU see a notice instead. If the GPU device is lost, Geon recreates it and restores the latest auto-save. Simulation state and stepping stay client-side.

## Topology Modes

Boundary handling has three modes: open/despawn, reflective bounce, and loop. Loop mode can use three topologies: torus, Klein bottle, and RP2. Toroidal boundaries use minimum-image convention for force calculation to avoid double-counting.

## Signal Delay

Optional signal delay mode computes forces from delayed source positions rather than instantaneous positions, giving a toy finite-speed propagation effect. It uses a circular history buffer and a scalar aberration factor, so it is useful for visible near-c delays but is not a full moving-source field solution.

## Accessibility

Geon provides keyboard shortcuts, light and dark themes, labeled simulation controls, and numerical readouts for conserved quantities and selected particles. The canvas contains continuous motion and optional particle trails; users sensitive to motion can pause, single-step, or choose a lower-particle preset.

## GPU Compute

Forces are summed pairwise or with a lock-free Barnes-Hut tree built on the GPU. The simulation holds up to 512 particles, 4096 photons, and 2048 pions and leptons. Scalar field evolution (Higgs, axion) uses a 128 × 128 grid with cubic B-spline interpolation for C2 continuity.
