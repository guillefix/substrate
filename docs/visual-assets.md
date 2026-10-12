# Biological reference geometry

The renderer combines independently sourced structural references with a
separate classical squid Hodgkin–Huxley experiment. These references do not
establish that the model is fitted to the displayed cell or proteins. Geometry
is static. Simulated voltage and open fractions alter illumination only;
HH gating does not predict molecular conformational movement.

## Sources and separate asset terms

| Asset | Source and selection | Terms |
|---|---|---|
| Mouse neuron | [Allen Cell Types specimen 464212183](https://celltypes.brain-map.org/experiment/morphology/464212183), SWC reconstruction file 491119539 | [Allen Institute terms](https://alleninstitute.org/legal/terms-of-use) and [citation policy](https://alleninstitute.org/legal/citation-policy); research or other noncommercial use, with attribution |
| Human Naᵥ1.7 | [RCSB PDB 6J8J](https://www.rcsb.org/structure/6J8J), biological assembly 1, protein Cα coordinates | PDB data are CC0 under the [RCSB usage policy](https://www.rcsb.org/pages/usage-policy) |
| Rat Kᵥ1.2 | [RCSB PDB 3LUT](https://www.rcsb.org/structure/3LUT), biological assembly 1, protein Cα coordinates | Same PDB CC0 policy |

The Allen-derived asset is isolated in
`public/assets/biology/allen-464212183.json`. Its source-specific conditions
are not the license of the independent engine code or the PDB data. This
prototype is used locally for research. Review the Allen terms separately
before commercial incorporation or redistribution; do not assume CC0 or an
engine license applies to it. No source artwork, screenshots, or logos are
included.

Attribution: Allen Institute for Brain Science, Allen Cell Types Database,
specimen 464212183, accessed October 11, 2026. The original SWC is a
dendrite-focused mouse reconstruction (Sst-IRES-Cre source label), with 2,605
dendritic nodes, 14 axonal-stub nodes, and one soma node. It is not a complete
axon reconstruction. The source API's 2,605 node summary describes the
dendritic component; the downloaded file contains 2,620 total rows.

## Channel structures

**6J8J** is a human Naᵥ1.7 complex determined by cryo-EM at 3.2 Å resolution,
with auxiliary β subunits and a blocker/toxin-bound experimental context.
The original authors discuss a likely inactivated conformation. Our reduced
geometry contains 1,433 resolved protein Cα positions across α and two β
chains; unresolved regions are not invented. Nonprotein ligands, glycans,
sidechains, and other atoms are omitted. This display is a backbone reference,
not a complete atomic model or an unblocked open-channel simulation.

Reference: Shen H. et al., *Structures of human Nav1.7 channel in complex with
auxiliary subunits and animal toxins*, Science (2019),
[doi:10.1126/science.aaw2493](https://doi.org/10.1126/science.aaw2493).

**3LUT** is a rat Kᵥ1.2 X-ray model at 2.9 Å resolution, an alternative
re-refinement of the original 2A79 diffraction data. We use the supplied
biological assembly rather than only the asymmetric unit: four α and four β
subunits, totaling 2,864 Cα positions. The four MODEL blocks in the legacy
assembly file represent symmetry-related assembly copies, not time frames.
Ligands including potassium ions and NADP are omitted. This is a structural
reference from a particular construct and refinement, not squid potassium
channel identity or a time-resolved trajectory.

Reference: Chen X. et al., *Structure of the full-length Shaker potassium
channel Kv1.2 by normal-mode-based X-ray crystallographic refinement*, PNAS
(2010), [doi:10.1073/pnas.1000142107](https://doi.org/10.1073/pnas.1000142107).

## Reproducible preprocessing

Run `python scripts/import_biology.py`. The script downloads the assembly
files and original SWC, checks expected node/chain counts, and writes compact
JSON. It uses only Python's standard library. Source download URLs, retrieval
date, SHA-256 digests, assembly identity, and usage-policy links are recorded
in `public/assets/biology/manifest.json`. The browser loads the generated
assets locally; it makes no live requests to Allen or RCSB.

PDB processing keeps Cα atoms, selects blank/A alternate locations, retains
assembly MODEL and author chain identifiers, and carries HELIX/SHEET labels
into each residue record. Coordinates remain in Å in the files. The renderer
breaks backbone tubes at residue gaps or Cα separations above 4.7 Å, avoiding
fabricated connecting loops. Thickness varies by deposited secondary
structure assignment for legibility; it is not a molecular solvent surface.

SWC processing keeps positions, parent topology, types, and radii in µm.
Rendering centers and scales the arbor to the viewport, flips its display
vertical direction, multiplies thin radii by 2.4, and imposes a visible minimum
radius. The soma is shown as a sphere using its SWC radius with a small
visibility minimum. These display changes are not new morphology data.

## Illustration and model boundaries

The bilayer is original procedural illustration: staggered lipid head groups
with two kinked hydrocarbon-tail strokes per lipid, rendered as instances.
It is not an atomistic lipid composition, an equilibrated membrane, or a
molecular dynamics result. Protein placement and leaflet spacing are
approximate illustration choices, not OPM membrane orientation fits. The
channel view keeps complete protein assembly coordinates and shows only faint
illustrative membrane boundary rings.

Mouse morphology, human sodium structure, rat potassium structure, and squid
electrophysiology are deliberately identified separately. The same HH state
is visible at each scale, but changing scale does not add spatial resolution,
stochastic channels, or molecular mechanics to the solver.

## Useful specialist tooling

[Mol*](https://molstar.org/) provides molecular structure visualization,
representations, experimental-data display, and immersive-view functionality.
It is a strong candidate for a future inspectable molecular layer or specialist
viewer alongside the general Babylon scene. This prototype uses a compact
Babylon backbone representation and does not bundle Mol*.

For polished offline molecular illustration, a Blender-based workflow such
as MolecularNodes is worth evaluating separately. No Blender or molecular
simulation packages were installed for this local asset import.
