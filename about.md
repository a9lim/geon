---
name: Geon
title: Geon — Interactive Particle Physics Simulator
description: Explore relativistic many-body dynamics, electromagnetism, compact objects, scalar fields, and nontrivial topologies across fifteen browser presets.
updated: 2026-07-17
---

# Geon — Interactive Particle Physics Simulator

Geon is a real-time N-body simulator that models how particles move under gravity, electromagnetism, and relativistic effects. It runs in the browser using WebGPU compute shaders for parallel force calculation.

## Forces

Geon exposes 11 force and correction families: Newtonian gravity, gravitomagnetism (frame-dragging), Coulomb electrostatics, magnetic (Lorentz) force, Yukawa interaction, Higgs field coupling, axion field coupling, cosmological expansion (Hubble flow), first post-Newtonian correction, spin-orbit coupling, and radiation reaction. Applicable particle and boson interactions can use Barnes-Hut tree acceleration; scalar fields evolve on grids, and external or correction terms run in their own passes.

## Integration

Particle trajectories are advanced with a phase-space-volume-preserving Boris rotation and adaptive substeps. Relativistic corrections use a first post-Newtonian approximation rather than a full general-relativistic geodesic solve.

## Presets

Fifteen curated presets cover Keplerian motion, relativistic precession, binary inspiral, Hawking evaporation, atomic and nuclear toy systems, bremsstrahlung, magnetic dipoles, pion exchange, Higgs and axion fields, Peccei-Quinn dynamics, and cosmological expansion. Each preset sets initial conditions and force parameters for one compact demonstration.

## Black Hole Physics

In black hole mode, particles use a Kerr-Newman-inspired effective radius determined by mass, charge, and spin. Sub-extremal parameters use the usual outer-horizon formula; super-extremal toy inputs are clamped to an effective radius rather than modeled as physical naked singularities. Gravity switches to a Paczynski-Wiita-style pseudo-potential, so the effective potential steepens near the horizon and infalling particles are swallowed once their centers cross it. Hawking radiation follows Stefan-Boltzmann scaling from the Kerr-Newman temperature — smaller black holes are hotter and evaporate faster, ending in a photon burst. Charged black holes also undergo Schwinger discharge: the electric field near the effective horizon exceeds the critical threshold and tears electron-positron pairs from the vacuum. The same-sign lepton escapes while the opposite-sign partner falls back in, reducing the black hole's charge by one quantized unit per event. If a toy input is over the Kerr-Newman charge bound, the black hole sheds same-sign leptons in quantized steps and clamps to the nearest allowed charge as a numerical backstop. Spinning black holes with the axion field enabled exhibit superradiance: when the horizon angular velocity exceeds the axion mass, the field extracts rotational energy and grows a scalar cloud around the black hole. The black hole spins down until the superradiance condition fails, providing a natural saturation mechanism.

## Charge Quantization

All charges are quantized in units of the boson charge (default 0.1). Particle charges are rounded to the nearest multiple on creation, and all transfer processes — pion emission, Schwinger discharge, extremal black hole charge shedding, disintegration — conserve charge in discrete steps. This ensures exact charge conservation and prevents continuous drift.

## Educational Use

Designed for undergraduate physics education. Students can toggle individual forces on and off, adjust coupling constants, and observe how changes affect particle trajectories in real time. The simulation makes abstract concepts like frame-dragging and scalar field coupling visible and interactive.

## Technical Details

WebGPU compute shaders handle simulation and instanced rendering when available. Devices without WebGPU switch to the CPU physics backend and Canvas 2D renderer. Simulation state and stepping remain client-side in either mode.

## Topology Modes

Boundary handling has three modes: open/despawn, reflective bounce, and loop. Loop mode can use three topologies: torus, Klein bottle, and RP2. Toroidal boundaries use minimum-image convention for force calculation to avoid double-counting.

## Signal Delay

Optional signal delay mode computes forces from delayed source positions rather than instantaneous positions, giving a toy finite-speed propagation effect. It uses a circular history buffer and a scalar aberration factor, so it is useful for visible near-c delays but is not a full moving-source field solution.

## Accessibility

Geon provides keyboard shortcuts, light and dark themes, labeled simulation controls, and numerical readouts for conserved quantities and selected particles. The canvas contains continuous motion and optional particle trails; users sensitive to motion can pause, single-step, or choose a lower-particle preset.

## GPU and CPU Backends

WebGPU compute shaders handle pairwise force summation with Barnes-Hut tree acceleration when available. The GPU backend supports up to 512 particles with 4096 photons, compared to 128 particles on CPU. Devices without WebGPU use the CPU integrator and Canvas 2D renderer. Backend selection is automatic but can be forced to CPU via a query parameter. Scalar field evolution (Higgs, axion) uses a 128x128 grid on GPU and 64x64 on CPU, with cubic B-spline interpolation for C2 continuity.
