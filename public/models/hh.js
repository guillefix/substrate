/** Description of the approximation, separate from the anatomical subject and solver state. */
export const hhModel = Object.freeze({
  id: 'classic-squid-hh',
  label: 'Hodgkin–Huxley · single compartment',
  stateVariables: Object.freeze(['voltage', 'm', 'h', 'n']),
  assumptions: Object.freeze(['One spatially uniform voltage', 'Population channel gating', 'Fixed reversal potentials']),
  representation: Object.freeze({
    id: 'hh-compartment', kind: 'model', label: 'One electrical compartment',
    caption: 'The entire modeled membrane shares one voltage and three gating variables. This shape represents an electrical compartment, not a cell body or a measured cell shape. There is no distance, branching, or signal propagation in this model.',
  }),
});
