# Architecture: systems and experiments

## Purpose

Substrate supports scientific and artistic experiences built around systems,
state, observation, and intervention. The neuron is the first demanding use
case, not a special case inside the generic engine. Prefer extracting an
abstraction from a working experiment to inventing a large framework ahead
of use.

## Concepts

- **System:** a stable identity, modeled state, parameters, and an evolution
  model. A simulation adapter owns its evolution. The browser's System is an
  immutable snapshot of the latest state, not a second solver.
- **State:** variables the chosen model uses to describe its current condition.
  It is not a claim to know every property of the real physical system.
- **Observable:** a named, unit-bearing property selected for an experiment;
  it can be a function of state, parameters, or an instrument's supplied data.
- **Experiment / experience:** a system plus chosen observables, sensors and
  optional inputs. Presentation can be scientific, artistic, or both.
- **Sensor:** associates an observable with a source and measurement model.
  The initial sensors are ideal simulated probes. Sampling, noise, calibration,
  bandwidth, and measurement back-action require explicit future models.
- **Observation:** a value with units, time, source, and system/sensor identity.
- **Readout:** a visual, numerical, audible, or other presentation of observations.
  A camera or color mapping changes presentation, not physical state.
- **Input:** an optional stimulus or parameter intervention. Input descriptors
  are separate from transport commands, which the application adapter validates
  and delivers to the model owner.

A physical instrument generally cannot expose complete system state. A future
hardware adapter should supply observations with real acquisition metadata;
it must not invent hidden state to fit a simulated-state interface. Supporting
this is an extension point, not a hardware integration implemented today.

## Current data path

```text
UI input -> local service -> Python model state
                            |
                            v
                  timestamped state/readout payload
                            |
                            v
                 neuron experiment adapter
                            |
                            v
            observables + ideal sensors -> observations
                            |
                            v
          Babylon scene / numerical readouts / plots
```

The numerical model advances by fixed 0.01 ms steps. Display refresh and
camera transitions never set its timestep. HTTP advance requests ask for a
bounded number of steps and receive batches of regular samples. The service
is the only simulation owner. The application serializes its requests.

The present history plots consume the model's timestamped sample records;
the latest 3D and numeric readouts use the experiment's observation interface.
A uniform streaming observation interface is a future extraction if needed.

## Multiscale representations

### System, model, and representation

The system is the subject being studied. A model is an explicit approximation
of that subject, with its own variables, geometry/topology, equations and
assumptions. Selecting a different model does not change the identity of the
subject. Each run owns a model-specific state; this is distinct from the
physical system's underlying state, which need not be fully known.

The immutable HH model description now has its own identity, assumptions, state
variable names and model-representation descriptor. The anatomy/model toggle
selects presentation without changing the model or its observations.

The `System` class represents the currently inspected local snapshot. Its model
identity updates with selection; immutable `RecordedRun` objects own completed
run histories independently. Observations carry model, run and probe identities.
The conceptual anatomical subject remains separate from these local snapshots.
This is a small initial contract, not a physical-device digital twin.

Representations can target the system (an anatomical reconstruction), a model
(a lumped compartment, cable or discretized tree), or observations (voltage
colors and plots). A model diagram is not inherently a sensor: it can expose
model structure without measuring a dynamic quantity. Sensors supply
observations that can be layered onto either representation.

The anatomy/model-view control is implemented; selection between live HH and independent recorded HH/cable runs is implemented. Toggling
representation never changes the active model. A single-compartment model can
be shown as one compartment or equivalent circuit; a cable model as connected
segments; a branched model as its compartment graph. The anatomy view remains
available across these choices. Equation views are another model representation.

Make the correspondence explicit: one compartment aggregates a declared region;
a cable is either an idealized surrogate or a selected branch, not silently
both. Displaying a lumped voltage over a detailed tree means one shared model
prediction, not spatially resolved measurements. Missing correspondences and
unsupported quantities remain visible. The present mixed-species structural
references do not constitute a measured digital twin of one specimen.

The cell, membrane and channel references display the selected local observation.
The single-compartment diagram or segmented cable exposes the selected model. Their scales express explanatory focus; they do not
create new physical resolution. Channel open fractions derive from m³h and
n⁴. They are population expectations, not sampled individual channel events.

Later physical subsystems need explicit identities and coupling contracts:
compartments exchange axial current; channel models supply membrane current;
reaction–diffusion models exchange concentrations and fluxes. Geometry belongs
to the biological model when it changes those equations, and to presentation
when it merely illustrates them. Preserve that distinction.

## Rendering decision

Babylon.js is the first interactive backend. Reuse its scene, camera, picking,
and material infrastructure. Own the scientific identities, bindings and
experimental behavior above it. Custom shaders and compute are possible through
Babylon APIs, but GPU compute and WebXR support must be verified on the intended
device. This prototype uses ordinary desktop graphics, not GPU simulation or VR.

Manim-style composition, transformations, and annotations inform authoring.
ManimGX remains an independent feasibility probe. Its native Film.picture
successfully rendered mutable scene state without rebuilding a timeline.
The measured small-scene result does not establish browser or VR capability.
Its current browser protocol is a recorded-film player, so live controls and
bounded frame history would require further engineering. Do not graft several
renderers together before an actual use case needs that complexity.

Godot remains a candidate if native desktop/VR becomes the main delivery target.
The independent Python model can connect through an adapter; renderer-specific
objects are not part of the model protocol. Existing scientific solvers such as
NEURON should be evaluated before rebuilding spatial electrophysiology or
reaction–diffusion infrastructure.

## Development conventions

Keep numerical and observation semantics testable without a browser. Put
neuron-specific behavior in the model or experiment adapter, not the engine
core. Keep visual code out of the solver. Record interventions with simulation
time. Declare units and model limits in exported data and visible readouts.
Prefer one small working experiment over a speculative plugin, ECS, or universal
rendering abstraction. Add another backend only when there is a concrete need.
