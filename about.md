---
name: Worldline
title: Worldline — Interactive Particle Physics Simulator
description: Explore relativistic many-body dynamics, electromagnetism, light and scalar fields in six curated presets, and tilt the plane into spacetime to see the world lines they trace.
updated: 2026-10-24
---

# Worldline — Interactive Particle Physics Simulator

Worldline is a real-time N-body simulator that models how particles move under gravity, electromagnetism, and relativistic effects. It runs in the browser on WebGPU compute shaders.

## Forces

Worldline exposes 11 force and correction families: Newtonian gravity, gravitomagnetism (frame-dragging), Coulomb electrostatics, magnetic (Lorentz) force, Yukawa interaction, Higgs field coupling, axion field coupling, cosmological expansion, first post-Newtonian correction, spin-orbit coupling, and radiation reaction. Applicable particle and boson interactions can use Barnes-Hut tree acceleration; scalar fields evolve on grids, and external or correction terms run in their own passes.

## Integration

Particle trajectories are advanced with a phase-space-volume-preserving Boris rotation and adaptive substeps. Relativistic corrections use the first post-Newtonian (Einstein–Infeld–Hoffmann) equations of motion rather than a full general-relativistic geodesic solve; a slightly eccentric orbit's perihelion advances by 6πM/p per revolution, Schwarzschild's value at this order.

## Proper Time

Internal processes run on each body's own clock rather than on lab time. Pion decay, Hawking evaporation, Schwinger discharge, superradiance, and Roche mass transfer advance by the body's proper time, so a neutral pion beam at Lorentz factor 5 travels five times farther before half of it decays, and a black hole moving at γ = 2 takes twice as long to evaporate. Emission happens in the emitter's rest frame and is boosted into the lab with the matching recoil. Photons and leptons are removed from their pools after a fixed age; that cull bounds memory and is not a physical lifetime.

Every body also carries a clock. Its proper time advances at dτ/dt = √(1 + 2Φ − v²), the weak-field rate that is exact for a free particle, for a clock held at rest near a Schwarzschild mass, and on a circular Schwarzschild orbit, where it runs at √(1 − 3M/r). The particle panel shows τ and dτ/dt, and the Clocks overlay (K) draws a ring around each body that fills once per 16 units of its proper time, so a moving body or one deep in a well visibly lags.

## The Spoke

Each body is drawn as its rest-frame disk pushed through the Lorentz transformation of its velocity, with one spoke marking its orientation. A moving body contracts by 1/γ along its motion, and a spinning, moving body's spoke bends: points across the disk are seen at different moments of the body's own time (relativity of simultaneity), so the spoke twists by 2·v·v_rim radians across the diameter, about 93° for a wheel spinning at 0.9c and moving at 0.9c. The spoke turns at the body's rest-frame rate on its proper time, so the moving wheel also turns slower in the lab. Black holes turn at their horizon angular velocity Ω_H.

The spoke's orientation is a transported axis, and it precesses even when the body does not spin. Thomas precession turns it backward by 2π(γ − 1) per circular orbit under non-gravitational forces; geodetic precession turns it forward by 3πM/r per orbit around a mass, as measured by Gravity Probe B; and with gravitomagnetism on, a spinning mass drags it (Lense–Thirring). Gravity enters only through the geodetic and Lense–Thirring terms, never through Thomas precession.

## Frames

The view can be drawn for observers other than the lab: the zero-momentum frame, the selected particle's rest frame, a boost at a chosen speed and direction, or a frame rotating at a chosen rate. Worldline records every body's world line and redraws the scene on the observer's surface of simultaneity, so in a boosted frame moving rulers contract, clocks synchronized in the lab disagree across the view, and a fast wheel can be followed in its own rest frame, where it is round. The observer's present is set far enough into the lab's past that everything shown has already been computed, and the Frame tab reports how far behind the lab it is. A background grid of rulers at rest in the lab contracts and shears with the observer, and a spacetime diagram plots nearby world lines in the observer's coordinates with its light cone and proper-time ticks.

On a torus the lab is a preferred frame: opposite edges are identified at equal lab time, so a traveller circling a torus of length L at speed v sees its own images, in its own frame, spaced γL apart with clocks γvL apart. A twin who circles the torus at 0.8c meets the stay-at-home twin every lap, younger each time, without ever turning around (Barrow and Levin, 2001). In the twin-paradox preset the traveller bounces off a wall instead, and at the turn the home clock's reading on the traveller's slice jumps ahead by 2vd.

## Expansion

With expansion on, the periodic domain becomes a slice of an expanding Friedmann–Robertson–Walker universe. Bodies at rest keep their comoving positions while the space between them grows; peculiar momenta and photon energies fall as 1/a; scalar fields feel Hubble friction; and bound systems keep their size. The history can be imposed (de Sitter, matter, radiation, ΛCDM) or follow from the universe's own contents through the Friedmann equation, with matter, radiation and field energy each diluting at its own rate. Signals travel on light cones that are straight in comoving coordinates and conformal time, and because Maxwell's equations are conformally invariant a charge's Liénard–Wiechert field stays exact, its radiation dimmed by the redshift. The Stats tab shows the scale factor, the Hubble rate, the Hubble radius and the event horizon, and books the energy the expansion takes or gives as its own line, so the energy drift still measures numerical error. An axion field frozen by Hubble friction starts oscillating once the Hubble rate falls below its mass and then dilutes like cold matter (misalignment), and a Higgs field quenched through its symmetry-breaking transition freezes into domains, and a slower quench leaves fewer walls between them: the Kibble–Zurek mechanism (Kibble, 1976; Zurek, 1985).

## Lensing

With lensing on, the grid becomes a backdrop far behind the plane, seen through the bodies' masses as a thin gravitational lens. Each pixel shows the backdrop where its ray came from, β = θ − α(θ), with the deflection α summed from every body's two-dimensional logarithmic potential; a lone mass bends the rulers into an Einstein ring of radius √(4MD), where D sets how far behind the plane the backdrop lies. A backdrop star can be placed in the sheet: its images appear as arcs and rings, and its magnification, measured by shooting a ray through every cell of the view, traces a microlensing light curve as a mass drifts past it, (u² + 2)/(u√(u² + 4)) for a single lens (Paczyński, 1986). The thin-lens approximation has no black-hole shadow, so the photon-capture disk around a black hole is drawn as an imposed overlay.

## Scalar Fields

The Higgs and axion fields evolve on a 128 × 128 grid. With gravity on, they evolve in the metric ds² = −e^{2Φ}dt² + e^{−2Φ}dx², whose Klein–Gordon equation reduces to the weak-field form at small Φ and stays well behaved in deep wells. The potential Φ comes from the fields' own energy and the particles' mass, solved by FFT convolution over a sheet of thickness 8, so field oscillations near a massive body slow by the gravitational redshift factor e^Φ.

## Presets

Six curated presets each make one figure: cyclotron drift, where charges of both signs trace helices in spacetime; the twin paradox; a relativistic wheel; bremsstrahlung, where a deflected charge radiates; Kibble–Zurek walls in a quenched Higgs field; and microlensing of a backdrop star. Each sets its initial conditions and forces and opens on its own frame; everything else Worldline models stays a toggle away.

## Black Hole Physics

In black hole mode, particles use a Kerr-Newman-inspired effective radius determined by mass, charge, and spin. Sub-extremal parameters use the usual outer-horizon formula; super-extremal toy inputs are clamped to an effective radius rather than modeled as physical naked singularities. Gravity switches to a Paczynski-Wiita-style pseudo-potential, so the effective potential steepens near the horizon and infalling particles are swallowed once their centers cross it. Hawking radiation follows Stefan-Boltzmann scaling from the Kerr-Newman temperature — smaller black holes are hotter and evaporate faster, ending in a burst of two photons that carries off the hole's remaining energy and momentum. Charged black holes also undergo Schwinger discharge: the electric field near the effective horizon exceeds the critical threshold and tears electron-positron pairs from the vacuum. The same-sign lepton escapes while the opposite-sign partner falls back in, reducing the black hole's charge by one quantized unit per event. If a toy input is over the Kerr-Newman charge bound, the black hole sheds same-sign leptons in quantized steps and clamps to the nearest allowed charge as a numerical backstop. Spinning black holes with the axion field enabled exhibit superradiance: when the horizon angular velocity exceeds the axion mass, the field extracts rotational energy and grows a scalar cloud around the black hole. The black hole spins down until the superradiance condition fails, providing a natural saturation mechanism.

## Charge Quantization

All charges are quantized in units of the boson charge (default 0.1). Particle charges are rounded to the nearest multiple on creation, and all transfer processes — pion emission, Schwinger discharge, extremal black hole charge shedding — conserve charge in discrete steps. This ensures exact charge conservation and prevents continuous drift.

## Educational Use

Designed for undergraduate physics education. Students can toggle individual forces on and off, adjust coupling constants, and observe how changes affect particle trajectories in real time. The simulation makes abstract concepts like frame-dragging and scalar field coupling visible and interactive.

## Technical Details

WebGPU compute shaders run the whole simulation and WebGPU instanced rendering draws it; there is no CPU fallback, and browsers without WebGPU see a notice instead. The simulation domain has a fixed size, 64 × 64 units unless a preset sets its own, and the window is a camera onto it; a background grid of lab rulers fills it, and a hairline marks its edge. Saves record the domain and every body's proper time and spoke angle. If the GPU device is lost, Worldline recreates it and restores the latest auto-save. Simulation state and stepping stay client-side.

## Topology Modes

Boundary handling has three modes: open/despawn, reflective bounce, and loop. Loop mode can use three topologies: torus, Klein bottle, and RP2. Cosmological expansion requires a torus: the periodic domain is the whole universe, and only the torus is homogeneous. Toroidal boundaries use minimum-image convention for force calculation to avoid double-counting.

## Signal Delay

With relativity on, every force acts from where its source was when the signal left it, found on each body's recorded world line. Charges interact through their full Liénard–Wiechert fields, the exact electromagnetic field of a moving point charge: a fast charge's field flattens into a pancake around its present position, and an accelerating charge radiates a field that falls off only as 1/r. Gravity, the nuclear force, and the magnetic dipole interactions use their static laws at the delayed position with a scalar aberration factor, a toy model of finite-speed propagation rather than a field solution. Fields are softened at short range and capped for sources moving almost straight at an observer.

## Accessibility

Worldline provides keyboard shortcuts, light and dark themes, labeled simulation controls, and numerical readouts for conserved quantities and selected particles. The canvas contains continuous motion and optional particle trails; users sensitive to motion can pause, single-step, or choose a lower-particle preset.

## GPU Compute

Forces are summed pairwise or with a lock-free Barnes-Hut tree built on the GPU. The simulation holds up to 512 particles, 4096 photons, and 2048 pions and leptons. Scalar field evolution (Higgs, axion) uses a 128 × 128 grid with cubic B-spline interpolation for C2 continuity.
