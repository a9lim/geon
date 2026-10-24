# Worldline

Worldline is a browser sandbox for relativistic many-body physics. You spawn charged,
spinning particles, switch forces and corrections on and off, and watch orbits precess,
charges radiate, black holes evaporate, and scalar fields ripple, with live conservation
readouts to check the numbers.

**[Open it](https://a9l.im/worldline)** · part of [a9l.im](https://a9l.im)

## What's in it

The simulation is two-dimensional, in natural units (c = G = ħ = 1). Particles carry
proper velocity, so nothing outruns light, and a Boris integrator with adaptive
substepping advances them.

- **Forces.** Newtonian gravity, Coulomb, magnetic dipole and Lorentz forces,
  gravitomagnetism (frame dragging), tidal locking, Yukawa (a screened nuclear force
  with a massive pion mediator), spin-curvature coupling, and uniform external
  gravitational, electric, and magnetic fields. Forces can be summed pairwise or with a
  Barnes–Hut tree.
- **Relativity.** Signal delay: forces come from where sources were when their signal
  left, read off each body's recorded world line. Charges interact through their exact
  Liénard–Wiechert fields; gravity and the other forces use their static laws at the
  delayed position with a scalar aberration factor, a toy model of finite-speed
  propagation. First post-Newtonian corrections (Einstein–Infeld–Hoffmann for gravity,
  Bažański cross terms, scalar Breit for Yukawa) give the relativistic perihelion
  advance.
- **Frames.** The view can be redrawn for the zero-momentum frame, the selected
  particle's rest frame, a custom boost, or a rotating frame, by slicing every body's
  recorded world line on the observer's surface of simultaneity. A background grid of
  lab rulers contracts with the observer, and a spacetime diagram shows nearby world
  lines with the light cone. Two twin-paradox presets, one on a torus, where the lab is
  a preferred frame.
- **Black holes.** Kerr–Newman horizons set by mass, spin, and charge (super-extremal
  inputs are clamped to an effective radius), a Paczyński–Wiita gravity well that
  swallows bodies crossing the horizon, ergosphere rendering, Hawking evaporation,
  Schwinger discharge that sheds charge one lepton at a time, extremal charge shedding,
  and axion superradiance that spins a hole down until it saturates.
- **Radiation and bosons.** Larmor radiation with Landau–Lifshitz reaction,
  electromagnetic and gravitational-wave quadrupole losses, and pion emission. Photons,
  pions, and leptons are real particles: they carry energy and momentum, other bodies
  absorb them, and pions decay. With boson interaction on they are lensed by masses,
  gravitate and repel among themselves, annihilate in opposite-charge pairs, and
  collapse into a new particle when enough energy gathers in one place (a kugelblitz).
  Matter meeting antimatter annihilates into photon pairs.
- **Scalar fields.** A Higgs field with a Mexican-hat potential that sets particle
  masses, and an axion field that modulates the electromagnetic coupling and, with
  Yukawa on, couples with opposite sign to matter and antimatter (a Peccei–Quinn toy).
  Both evolve on a grid and are excited by collisions. With gravity on they evolve in a
  curved metric sourced by their own energy and the particles' mass, so field
  oscillations slow near heavy bodies.
- **Proper time.** Every body carries a clock, slowed by speed and by gravity, and
  pion decay, Hawking evaporation, Schwinger discharge, superradiance, and mass
  transfer run on it: a fast pion beam lives longer in the lab, and a moving black hole
  takes longer to evaporate. The Clocks overlay shows each body's proper time as a
  ring that fills once per period.
- **The spoke.** Each body is drawn through the Lorentz transformation of its motion,
  with one spoke marking its orientation: moving bodies contract, a spinning, moving
  wheel's spoke bends (relativity of simultaneity), and the spoke precesses on orbits
  (Thomas, geodetic, and Lense–Thirring precession).
- **Charge quantization.** Every charge is a multiple of 0.1, and emission, absorption,
  decay, and discharge move charge in whole units.
- **Space.** Despawn, bounce, or periodic boundaries; periodic space can be a torus, a
  Klein bottle, or the real projective plane.
- **Lensing.** The grid can become a backdrop seen through the bodies as a thin
  gravitational lens, with Einstein rings, and a backdrop star whose magnification
  traces a microlensing light curve.
- **Cosmology.** With expansion on, the periodic domain is a slice of an expanding FRW
  universe: an imposed history or one set by the contents through the Friedmann
  equation, redshift, Hubble friction on the fields, the Hubble radius and event
  horizon, and an energy ledger for what the expansion takes. Presets for axion
  misalignment and Kibble–Zurek domain walls.
- **Analysis.** Energy, momentum, and angular-momentum totals with drift percentages; a
  per-force breakdown for the selected particle; a potential heatmap (gravity,
  electric, Yukawa, or all); and a phase-space plot and an effective-potential curve
  for the selected particle against the heaviest other body.
- **Presets.** Twenty-four scenarios, from Kepler orbits and binary inspiral through
  Hawking evaporation, a relativistic wheel, Thomas and geodetic precession, the twin
  paradox on a line and on a torus, atoms,
  nuclei, and pion exchange to the Higgs boson, axion bursts, an expanding universe,
  axion misalignment, Kibble–Zurek walls, and microlensing.
- **Save and load.** Quick save to the browser, or download and upload the state as
  JSON (domain, particles with their clocks, toggles, settings, and camera). Each
  preset sets its own domain size; the window is a camera onto it.
- **Reference.** The `?` buttons beside controls open short explanations;
  Shift+click opens a longer reference page with the equations. The interface is in
  English and Japanese.

## Controls

- **Mouse.** Click to spawn a particle; drag to launch it. Right-click spawns
  antimatter. Clicking a particle of the button's kind (left for matter, right for
  antimatter) selects it; clicking one of the other kind deletes it. Scroll to zoom,
  middle-drag to pan, hover for a readout.
- **Touch.** Tap to spawn, drag to launch, pinch with two fingers to zoom and pan. The
  antimatter button switches taps to antimatter.
- **Keyboard.** Space pauses, `/` steps, `R` resets, `,` and `.` change speed, `1`–`9`
  load presets, `X` toggles antimatter mode, `K` the clocks, `T` the theme, `S` the
  sidebar. `Ctrl+S` /
  `Ctrl+L` quick save and load. `B` cycles frames, `L` returns to the lab, and `G`
  toggles the grid. `?` opens the about panel with the full list.

## Running locally

The project has no build step of its own; it loads the shared design system from
the parent site by absolute path. From a checkout of
[a9lim.github.io](https://github.com/a9lim/a9lim.github.io) with submodules:

    npm install && npm run build
    python3 -m http.server --directory dist 8000   # http://localhost:8000/worldline/

Worldline needs WebGPU. `tests/physics-validation.html` checks the physics against analytic
results in the browser.

## How it's built

Vanilla JavaScript modules on WebGPU. The physics runs as WGSL compute shaders (up to
512 particles, with a lock-free GPU tree and 128 × 128 field grids) and draws with
instanced rendering. Shared controls, theme, and typography come from the parent site,
and KaTeX renders the reference pages. [AGENTS.md](AGENTS.md) maps the code.

## License

[AGPL-3.0](LICENSE)
