# Planned: explain the model while exploring it

This is a next-phase design. Equation rendering, guided explanations and model
comparison are not implemented by the current workbench.

## Two independent directions

[Model comparison](model-comparison.md) asks what changes when mechanisms are
added or replaced. Exposition asks how a selected model works and why its
assumptions are appropriate. A simple model can support a deep explanation;
a complex model can initially have a short model card. Neither axis should
require finishing the other.

Treat an explanation as an authored experience around an experiment. It selects
observables, instruments and readouts, and may offer recorded or user-controlled
inputs. It does not own another solver. Equations are readouts with semantic
links, alongside plots, numerical gauges and the membrane view.

## First slice: why does the membrane voltage rise?

Build one short, manually authored sequence around the existing HH pulse:

1. **Observe:** run or inspect a saved pulse. Select a time on the voltage trace;
   show all equation values, current gauges and membrane colors at that time.
2. **Account for charge:** introduce the membrane capacitor, injected current
   and outward ionic currents. Reveal the current balance one contribution at
   a time. Explain the sign convention before animating arrows.
3. **Explain the sodium term:** expand its current into maximum conductance,
   population gating and electrochemical driving force. Selecting a term
   highlights its numerical value, relevant plot and illustrative structure.
4. **Test the explanation:** invite a prediction, then compare a baseline run
   with a run whose maximum sodium conductance is reduced, under an explicitly
   matched protocol. Preserve both results. Until independent runs exist, use
   separate saved recordings with visible preparation and parameter histories.
5. **Expose the limit:** distinguish what the experiment calculated from what
   its illustration depicts. Offer the next question: where do the gating
   dynamics come from?

The slice is complete when someone can follow an individual term from physical
meaning to equation to measured simulation output, change an input, and inspect
the resulting prediction. It need not explain all of electrophysiology.

## Equations and scientific boundaries

Use the conventions already implemented in [MODEL.md](../MODEL.md): voltage in
mV, time in ms, capacitance per area in µF/cm², conductance per area in mS/cm²,
and current density in µA/cm². The symbol `I` denotes density in this experience;
do not silently substitute total current.

The first transformations are authored mathematical steps:

```text
I_applied = I_capacitive + I_Na + I_K + I_leak
I_capacitive = C_m dV/dt
C_m dV/dt = I_applied - I_Na - I_K - I_leak
I_Na = gbar_Na m³h (V - E_Na)
```

Charge conservation supplies the balance. A constant-capacitance approximation
supplies the capacitive relation; an effective conductance law supplies each
ionic current. These are different kinds of statement, not one uninterrupted
derivation from microscopic physics. The original HH paper develops this
electrical model and its experimentally constrained kinetics.
[Hodgkin and Huxley, 1952](https://physoc.onlinelibrary.wiley.com/doi/10.1113/jphysiol.1952.sp004764)

The deeper follow-up explains a gate using:

```text
dx/dt = alpha_x(V)(1 - x) - beta_x(V)x
x_inf(V) = alpha_x(V) / (alpha_x(V) + beta_x(V))
tau_x(V) = 1 / (alpha_x(V) + beta_x(V))
dx/dt = (x_inf(V) - x) / tau_x(V)
```

This is an algebraic rewrite of the gate equation. The particular voltage-rate
functions and conductance exponents are model choices fitted to electrophysiology,
not consequences established by animating a protein. The current implementation
uses the classic squid convention represented in
[NEURON's reference mechanism](https://raw.githubusercontent.com/neuronsimulator/nrn/master/src/nrnoc/hh.mod),
with the leak reversal difference documented in MODEL.md.

Population gating factors `m³h` and `n⁴` must not become literal animations of
three or four identified protein components. Fixed reversal potentials also
do not imply that the model evolves ion concentrations. A later equilibrium
potential explanation can connect to concentration gradients while explicitly
marking those quantities as outside the current dynamic state. The distinction
between deterministic gating and individual stochastic events is discussed in
[Neuronal Dynamics, section 2.2](https://neuronaldynamics.epfl.ch/online/Ch2.S2.html).

## What to borrow from Manim

Borrow staged composition, semantic emphasis, consistent term identity and
readable transformations. Manim's `TransformMatchingTex` matches rendered parts
by their TeX strings; Substrate should use explicit term identities because two
identical symbols can refer to different models, runs, locations or roles.
[Manim's transformation documentation](https://docs.manim.community/en/stable/reference/manim.animation.transform_matching_parts.TransformMatchingTex.html)

Begin with accessible browser equations next to the Babylon view. First support
highlight, reveal and replacement with explicit correspondence; select an
equation renderer in a bounded implementation task. Do not require embedding
ManimGX or creating a symbolic algebra engine. Every transformation remains an
authored explanation with its reason and assumptions, not a claimed automatic
proof. Exported animation can later consume the same authored steps.

## Minimal contracts to extract during implementation

| Concept | Minimum information | Boundary |
|---|---|---|
| Equation | Stable identity, version, display expression, named terms, units, model applicability | An authored model description; not executable solver code |
| Term binding | Term identity; observable, parameter or derived quantity; source and unit; run/system/probe scope when available | No direct mesh or HTTP dependency |
| Explanation step | Question, explanation, equation/term focus, view focus, prerequisites, references; optional protocol action | Presentation commands cannot secretly change physical state |
| Transformation | Source and destination equations, explicit term correspondence, reason, assumptions | Distinguish rearrangement, substitution, approximation and empirical closure |
| Inspection context | Selected run, observation time and sampling policy; separate presentation progress | Reading history cannot rewind the live solver |

Parameters and observables are distinct bindings. Any displayed computed quantity
must name its computation and dependencies. If introducing leak current,
capacitance or voltage slope as explanatory readouts, add them through the
experiment adapter, with units and source, rather than calculating an untracked
second model inside an animation callback. A balance-derived slope is useful
for explanation but is not an independent numerical validation of the solver.

Keep simulation time, historical inspection time and explanatory animation
progress separate. A user may pause a run, inspect a saved sample, or advance a
derivation. These actions must not be interchangeable. If an explanation requests
a stimulus or reset, it uses the normal input path and records the intervention.

## Acceptance checks

- Every bound value is tied to the selected model, run, units and observation
  time. Missing quantities show as unavailable; switching models cannot leave
  stale numbers attached to a new equation.
- Equation terms and current gauges agree with exported observations at selected
  times, including either side of stimulus boundaries. The UI states which
  boundary/sample it displays; it does not smooth across an input discontinuity.
- Show the units of each balance term. Verify the algebraic gate rewrite against
  the implemented rate functions over a documented voltage range, including
  their removable singularities.
- Moving the camera, selecting a term, stepping a derivation or scrubbing history
  leaves simulation state and event history unchanged. Intentional stimuli and
  parameter edits appear in that history.
- A user can navigate the sequence and term links with a keyboard; plain text,
  labels and a reduced-motion presentation convey the same explanation as color
  and movement.
- Each explanation identifies assumptions, model version and references.
  Scientific assets retain their own provenance and do not imply that the squid
  equations were fitted to the displayed mammalian structure.

## Delivery boundary

Finish and checkpoint the current workbench first. Then implement this one
explanatory sequence as a small parallel workstream to the first spatial-model
comparison. Agree on model identity, observation bindings and inspection time
before either stream modifies shared engine interfaces. Keep episode content
outside the engine core. Defer automatic derivation, arbitrary equation editing,
microscopic kinetics, narration generation and a general-purpose lesson editor.
