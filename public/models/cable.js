export const cableModel = Object.freeze({
  id: "hh-cable",
  label: "Hodgkin–Huxley · spatial cable",
  stateVariables: Object.freeze(["voltage", "m", "h", "n"]),
  assumptions: Object.freeze([
    "Idealized unbranched cable",
    "HH kinetics in each compartment",
    "Sealed ends; fixed reversal potentials",
  ]),
  representation: Object.freeze({
    id: "hh-cable-diagram",
    kind: "model",
    label: "Connected electrical compartments",
    caption:
      "Each segment has its own voltage and gating state. Axial current couples its neighbors. This idealized cable is a surrogate, not a reduction fitted to the reconstructed neuron. Width is exaggerated; colors show each segment at the selected time.",
  }),
});
