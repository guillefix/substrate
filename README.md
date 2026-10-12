# Substrate

An early scientific and artistic experience engine. Its first application is a
neuron workbench: inspect one experiment through cell, membrane, channel, and
signal views while preserving the same underlying state.

The project is intentionally local. It is not published or connected to GitHub.
The engine is an initial working foundation, not a general-purpose game engine
or a validated digital twin of a real neuron.

## Start the workbench

Requires Python 3.11+ and a current Node.js/npm installation. The numerical
model and local service use Python's standard library. Babylon.js is pinned.

```sh
npm install --ignore-scripts
npm run vendor
npm start
```

Open <http://127.0.0.1:8765>. Stop the local service with Ctrl-C.
The service exposes one shared, in-memory experiment to local tabs.

Switch **Anatomy view / Model view** to compare sourced anatomical references
with the current model’s single electrical compartment. The active model stays
Hodgkin–Huxley; switching representation preserves the state and remembered
anatomical scale. The model view shows one shared voltage and its four state
variables, not a spatial simulation.

Start a current pulse with **Stimulate**, pause the experiment to inspect it,
and switch between the cell, membrane, and channel views. Conductance edits
change the ongoing model. Export a recording before resetting if you want to
keep an experiment. The first workbench stops at 200 milliseconds of simulated
time; display time is deliberately slower.

## Project boundaries

| Path | Responsibility |
| --- | --- |
| `public/engine/core.js` | Systems, snapshots, experiments, observables, sensors, optional inputs |
| `public/experiments/neuron.js` | Neuron-specific observable definitions and model adapter |
| `public/app.js` | First workbench application, plots and controls |
| `public/renderers/neuron.js` | Babylon scene and independent anatomy/model representation selection |
| `public/renderers/compartment.js` | Single-compartment model diagram |
| `public/models/hh.js` | Immutable model description, assumptions and representation identity |
| `public/engine/readouts.js` | Named readouts bound to selected observations |
| `public/adapters/local-model.js` | Serialized local model connection |
| `public/assets/biology/` | Sourced structural references and attribution |
| `public/index.html`, `public/style.css` | Accessible application shell and layout |
| `substrate_model/` | Independent, deterministic single-compartment HH model |
| `server.py` | Local HTTP transport and experiment owner |
| `tests/` | Numerical, transport, and conceptual contract checks |
| `examples/` | Reproducible recorded neuron experiment |
| `probes/` | Isolated renderer feasibility tests, including ManimGX |
| `docs/architecture.md` | Design decisions, interfaces, and extension points |

The model never imports graphics. The generic engine never imports the neuron
model, browser APIs, or Babylon. Readouts consume observations; changing a
camera does not advance or change the experiment.

## Verification

```sh
npm test
```

The model tests cover passive RC behavior, firing, sodium blockade, numerical
convergence and replay. Service tests cover state transitions and input/access
bounds. Engine tests exercise a passive non-biological experiment, sensor
associations, immutable snapshots, and linked neuron representations.

See [MODEL.md](MODEL.md) for scientific conventions and numerical evidence,
[SERVER.md](SERVER.md) for the local API, and
[docs/architecture.md](docs/architecture.md) for the engine design.

## Scope of the first experiment

Classical squid-axon Hodgkin–Huxley at 6.3°C, with one electrical compartment.
The scene uses a reconstructed mouse neuron and human/rat channel structures as
explicitly separate anatomical references. The lipid bilayer is illustrative.
These visuals do not change the squid model or derive its kinetics.
The comparison cable adds spatial propagation along an idealized cylinder.
There is no branched electrical morphology, synapse, molecular dynamics,
stochastic single-channel process, or diffusion yet. The channel
readouts describe mean-field population gating. VR and GPU simulation are
future integration tests, not current features.

## Dependencies

Babylon.js supplies the interactive graphics layer. Its license and notice are
in `public/vendor/`. The model runs without Babylon or ManimGX. ManimGX is an
optional feasibility probe, pinned separately in `probes/requirements.txt`;
it requires Python 3.13+. There is no need to install it to run the workbench.

## Model comparison and explanation

- **Run matched comparison** creates independent uniform HH and 21-compartment cable recordings. Adjust total pulse current and duration, choose a run, and compare near/far voltage traces.
- Scrub **Inspect a moment** and choose a cable probe (or click a segment) to update geometry, currents and equation values together. Returning to live preserves its state.
- **Why does the voltage change?** explains current balance, current direction and sodium gating. Select a term to emphasize its related trace.
- **Export comparison** saves both runs, protocol, units, geometry and metrics.
- [Model comparison](docs/model-comparison.md): implemented boundary and future directions.
- [Model exposition](docs/model-exposition.md): connect equations and physical principles to observations.
- [Visual sources](docs/visual-assets.md): provenance, transformations and asset-specific terms.

This first comparison uses an idealized cable, not the reconstructed branching morphology. The 21-segment grid is exploratory; numerical convergence evidence and resolution limits are in MODEL.md. Equations use the selected sampled observation, without interpolation.

The interactive live solver remains one shared local experiment. Completed comparison runs are independent, immutable browser-side records; export them before reloading to keep them.
