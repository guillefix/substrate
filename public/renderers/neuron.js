import { createCable } from './cable.js';
import { createCompartment } from './compartment.js';
import { hhModel } from '../models/hh.js';

/** Biology reference renderer. Geometry is static; HH observations affect color only.
 * Source coordinates and processing are documented in docs/visual-assets.md.
 */
export function createNeuronRenderer(canvas, { onSelect = () => {}, onProbe = () => {} } = {}) {
  const B = window.BABYLON;
  if (!B) throw new Error('The local Babylon renderer could not be loaded.');
  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  engine.setHardwareScalingLevel(Math.max(1, (window.devicePixelRatio || 1) / 1.5));
  const scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(.065, .102, .085, 1);
  const V = (x, y, z) => new B.Vector3(x, y, z);
  const camera = new B.ArcRotateCamera('scientific-perspective', -Math.PI / 2, 1.39, 12, V(0, .2, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 2.5; camera.upperRadiusLimit = 20;
  camera.lowerBetaLimit = .12; camera.upperBetaLimit = Math.PI - .12;
  camera.panningSensibility = 0; camera.wheelPrecision = 35; camera.minZ = .03;
  const ambient = new B.HemisphericLight('soft-environment', V(.1, 1, -.4), scene);
  ambient.intensity = .87; ambient.groundColor = B.Color3.FromHexString('#314c3b');
  const key = new B.DirectionalLight('key', V(-.5, -.8, .5), scene); key.intensity = 1.1;
  const rim = new B.DirectionalLight('rim', V(.8, -.2, -.7), scene);
  rim.diffuse = B.Color3.FromHexString('#d9e1be'); rim.intensity = .5;

  const roots = Object.fromEntries(['neuron', 'membrane', 'channel'].map(name => [name, new B.TransformNode(name, scene)]));
  const compartment = createCompartment(B, scene, hhModel);
  const cable = createCable(B, scene);
  roots.cable = cable.root; roots.cable.setEnabled(false);
  let modelDefinition = hhModel, focusedObservable = null;
  roots.model = compartment.root;
  roots.model.setEnabled(false);
  let representation = 'anatomy';
  roots.membrane.setEnabled(false); roots.channel.setEnabled(false);
  const channels = { na: new B.TransformNode('nav1.7', scene), k: new B.TransformNode('kv1.2', scene) };
  channels.na.parent = roots.channel; channels.k.parent = roots.channel; channels.k.setEnabled(false);
  const activityMaterials = { na: [], k: [] };
  let view = 'neuron', selectedChannel = 'na', transition = null, disposed = false;
  let loaded = false, loadError = null, observations = null, lastSpatial = {};
  const neuronMaterials = [];

  function material(name, color, alpha = 1) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = B.Color3.FromHexString(color);
    m.specularColor = new B.Color3(.22, .24, .2); m.specularPower = 36;
    m.emissiveColor = m.diffuseColor.scale(.035); m.alpha = alpha;
    m.backFaceCulling = false;
    return m;
  }
  const tissue = material('reconstructed-neurite', '#b2c58e'); neuronMaterials.push(tissue);
  const axon = material('axon-stub', '#809f7d'); neuronMaterials.push(axon);
  const somaMat = material('soma', '#c7d9a0'); neuronMaterials.push(somaMat);
  const headMat = material('phospholipid-heads', '#b0bd98');
  const tailMat = material('acyl-tails', '#6f865f');
  const leafletMat = material('membrane-boundary', '#88a782', .1);
  const palettes = { na: ['#eeb384', '#b28268', '#d4c69d'], k: ['#83bfce', '#a8d0d5', '#699aa7', '#b6dcde'] };

  function identity(mesh, scale, kind = null) {
    mesh.metadata = { systemId: 'membrane-1', representation: scale, channel: kind };
  }
  function merge(meshes, name, parent, mat, scale, kind = null) {
    if (!meshes.length) return null;
    const mesh = B.Mesh.MergeMeshes(meshes, true, true);
    mesh.name = name; mesh.material = mat; mesh.parent = parent;
    identity(mesh, scale, kind); return mesh;
  }
  function tube(name, points, radius, mat, parent = null, radii = null, tessellation = 7) {
    if (points.length < 2) return null;
    const mesh = B.MeshBuilder.CreateTube(name, { path: points, radius,
      radiusFunction: radii ? i => radii[Math.min(i, radii.length - 1)] : undefined,
      tessellation, cap: B.Mesh.CAP_ALL }, scene);
    mesh.material = mat; mesh.parent = parent; return mesh;
  }
  function drawMorphology(data) {
    const rows = data.nodes, byId = new Map(rows.map(row => [row[0], row]));
    const children = new Map(rows.map(row => [row[0], []]));
    for (const row of rows) children.get(row[6])?.push(row[0]);
    const bounds = [2, 3, 4].map(axis => [Math.min(...rows.map(r => r[axis])), Math.max(...rows.map(r => r[axis]))]);
    const center = bounds.map(([low, high]) => (low + high) / 2);
    const scale = 8.8 / Math.max(...bounds.map(([low, high]) => high - low));
    const point = row => V((row[2] - center[0]) * scale, -(row[3] - center[1]) * scale + .4, (row[4] - center[2]) * scale);
    const grouped = { dendrite: [], axon: [] };
    for (const row of rows) {
      const offspring = children.get(row[0]);
      if (row[1] !== 1 && offspring.length === 1) continue;
      for (const firstId of offspring) {
        const branch = [row]; let next = byId.get(firstId);
        while (next) {
          branch.push(next);
          const descendants = children.get(next[0]);
          if (descendants.length !== 1) break;
          next = byId.get(descendants[0]);
        }
        const isAxon = branch[1][1] === 2;
        const path = branch.map(point);
        const radii = branch.map((r, index) => index === 0 && r[1] === 1 ? .055 : Math.max(.019, r[5] * scale * 2.4));
        const branchMesh = tube('traced-neurite', path, .025, isAxon ? axon : tissue, null, radii);
        grouped[isAxon ? 'axon' : 'dendrite'].push(branchMesh);
      }
    }
    merge(grouped.dendrite, 'allen-dendrites', roots.neuron, tissue, 'neuron');
    merge(grouped.axon, 'allen-axon-stub', roots.neuron, axon, 'neuron');
    for (const row of rows.filter(r => r[1] === 1)) {
      const soma = B.MeshBuilder.CreateSphere('reconstructed-soma', { diameter: Math.max(.3, row[5] * scale * 2), segments: 24 }, scene);
      soma.position = point(row); soma.material = somaMat; soma.parent = roots.neuron; identity(soma, 'neuron');
      const marker = B.MeshBuilder.CreateTorus('selected-membrane-region', { diameter: .57, thickness: .012, tessellation: 48 }, scene);
      marker.rotation.x = Math.PI / 2; marker.position = point(row).add(V(0, 0, -.18));
      marker.material = material('selection-ring', '#d7eac0'); marker.parent = roots.neuron; identity(marker, 'neuron');
    }
  }

  function drawBilayer() {
    // Two explicit hydrocarbon tails per illustrated phospholipid. Instanced geometry.
    const head = B.MeshBuilder.CreateSphere('lipid-head-template', { diameter: .17, segments: 8 }, scene);
    head.material = headMat; head.parent = roots.membrane; head.isPickable = false;
    const tailParts = [];
    for (const side of [-1, 1]) {
      const path = [V(side * .04, -.05, 0), V(side * .07, -.17, .025), V(side * .045, -.28, -.018), V(side * .08, -.4, .017), V(side * .07, -.49, 0)];
      tailParts.push(tube('acyl-tail', path, .021, tailMat));
    }
    const tails = merge(tailParts, 'paired-acyl-tails', roots.membrane, tailMat, 'patch'); tails.isPickable = false;
    const matrices = [];
    for (let ix = -14; ix <= 14; ix++) for (let iz = -9; iz <= 9; iz++) {
      const x = ix * .25 + (iz % 2) * .12, z = iz * .245;
      if ((x + 1.7) ** 2 + z ** 2 < 1.3 ** 2 || (x - 1.65) ** 2 + z ** 2 < 1.05 ** 2) continue;
      for (const sign of [-1, 1]) {
        const wiggle = Math.sin(ix * 2.1 + iz * .7) * .025;
        const rotation = B.Quaternion.RotationYawPitchRoll(ix * .7 + iz * .5, sign < 0 ? Math.PI : 0, Math.sin(ix + iz) * .045);
        matrices.push(B.Matrix.Compose(V(1, 1, 1), rotation, V(x, sign * (.58 + wiggle), z)));
      }
    }
    const buffer = new Float32Array(matrices.length * 16);
    matrices.forEach((matrix, index) => matrix.copyToArray(buffer, index * 16));
    head.thinInstanceSetBuffer('matrix', buffer, 16, true);
    tails.thinInstanceSetBuffer('matrix', buffer, 16, true);
  }

  function drawProtein(data, kind) {
    const points = Object.values(data.chains).flat();
    const bounds = [0, 1, 2].map(axis => [Math.min(...points.map(p => p[axis])), Math.max(...points.map(p => p[axis]))]);
    const center = bounds.map(([low, high]) => (low + high) / 2);
    const scale = .037;
    const verticalSign = kind === 'na' ? 1 : -1;
    const membraneZ = kind === 'na' ? 145 : -95;
    const membraneY = (membraneZ - center[2]) * scale * verticalSign;
    const transform = p => V((p[0] - center[0]) * scale, (p[2] - center[2]) * scale * verticalSign + .3, (p[1] - center[1]) * scale);
    const sourceRoot = channels[kind];
    const embedded = new B.TransformNode(`${kind}-embedded`, scene); embedded.parent = roots.membrane;
    const embedScale = kind === 'na' ? .58 : .53;
    embedded.scaling = V(embedScale, embedScale, embedScale);
    embedded.position = V(kind === 'na' ? -1.7 : 1.65, -(membraneY + .3) * embedScale, 0);
    let chainIndex = 0;
    for (const [chainId, residues] of Object.entries(data.chains)) {
      const [copy, chain] = chainId.split(':');
      const isAuxiliary = kind === 'na' ? chain !== 'A' : chain === 'A';
      const color = kind === 'na' ? palettes.na[chain === 'A' ? 0 : chain === 'B' ? 1 : 2] : palettes.k[(Number(copy) - 1) % 4];
      const mat = material(`${data.pdb}-${chainId}`, color);
      if (isAuxiliary) mat.diffuseColor = mat.diffuseColor.scale(.68);
      activityMaterials[kind].push({ mat, base: mat.diffuseColor.clone() });
      const pieces = []; let segment = [];
      function finish() {
        if (segment.length >= 2) {
          const path = segment.map(transform);
          const radii = segment.map(residue => residue[4] === 'H' ? .046 : residue[4] === 'E' ? .038 : .027);
          pieces.push(tube('resolved-backbone', path, .035, mat, null, radii, 8));
        }
        segment = [];
      }
      for (const residue of residues) {
        const previous = segment.at(-1);
        if (previous && (residue[3] - previous[3] > 1 || Math.hypot(...residue.slice(0, 3).map((v, i) => v - previous[i])) > 4.7)) finish();
        segment.push(residue);
      }
      finish();
      const backbone = merge(pieces, `${data.pdb}-chain-${chainId}`, sourceRoot, mat, 'channel', kind);
      if (backbone) {
        const clone = backbone.clone(`${data.pdb}-membrane-${chainIndex}`, embedded, true);
        identity(clone, 'patch', kind);
      }
      chainIndex++;
    }
    // Membrane position is an illustrative placement, not an OPM orientation fit.
    for (const sign of [-1, 1]) {
      const ring = B.MeshBuilder.CreateTorus(`${kind}-membrane-reference`, { diameter: 5.4, thickness: .017, tessellation: 72 }, scene);
      ring.position.y = membraneY + .3 + sign * .55; ring.material = leafletMat; ring.parent = sourceRoot; ring.isPickable = false;
    }
  }

  scene.onPointerObservable.add(info => {
    if (info.type !== B.PointerEventTypes.POINTERPICK) return;
    if (representation === 'model') {
      const index = info.pickInfo?.pickedMesh?.metadata?.compartmentIndex;
      if (Number.isInteger(index)) onProbe(index);
      return;
    }
    const selected = info.pickInfo?.pickedMesh?.metadata;
    if (selected?.representation === 'neuron') onSelect({ view: 'membrane', channel: selectedChannel });
    if (selected?.representation === 'patch') onSelect({ view: 'channel', channel: selected.channel || 'na' });
  });
  const perspectives = { cable: { radius: 12, alpha: -Math.PI / 2, beta: 1.39 }, model: { radius: 10, alpha: -Math.PI / 2, beta: 1.39 }, neuron: { radius: 12, alpha: -Math.PI / 2, beta: 1.39 }, membrane: { radius: 11.6, alpha: -1.16, beta: 1.06 }, channel: { radius: 10.3, alpha: -1.06, beta: 1.18 } };
  const description = (scale = view, kind = selectedChannel) => {
    if (representation === 'model') return { label: modelDefinition.id === 'hh-cable' ? 'MODEL · SPATIAL CABLE' : 'MODEL · SINGLE COMPARTMENT', title: modelDefinition.representation.label, caption: modelDefinition.representation.caption };
    if (loadError) return { label: 'REFERENCE UNAVAILABLE', title: 'Geometry could not be loaded', caption: loadError.message };
    if (!loaded) return { label: 'BIOLOGICAL REFERENCES', title: 'Loading local structure data', caption: 'Reconstructed morphology and experimental channel coordinates.' };
    if (scale === 'neuron') return { label: 'RECONSTRUCTED MOUSE NEURON', title: 'A traced dendritic arbor',
      caption: 'Allen specimen 464212183. Branch topology is measured; fine radii are enlarged for visibility. ' + (modelDefinition.id === 'hh-cable' ? 'The idealized cable is a separate model of spatial coupling.' : 'Squid HH supplies one shared electrical state, with no spatial propagation.'),
      sourceTitle: 'Allen Cell Types · morphology reference', sourceUrl: 'https://celltypes.brain-map.org/experiment/morphology/464212183' };
    if (scale === 'membrane') return { label: 'ILLUSTRATED BILAYER + STRUCTURE DATA', title: 'Proteins in a membrane landscape',
      caption: 'Paired lipid tails surround experimental human Naᵥ1.7 and rat Kᵥ1.2 backbone references. Placement is illustrative; color reports the separate squid HH population state.',
      sourceTitle: 'Channel sources and visual methods', sourceUrl: '/assets/biology/provenance.html' };
    return kind === 'na' ? { label: 'HUMAN Naᵥ1.7 · PDB 6J8J', title: 'A resolved sodium-channel fold',
      caption: 'Cryo-EM, 3.2 Å; blocker-bound reference with auxiliary subunits. Cα backbone is static; no molecular motion is inferred from HH gating. Nonprotein ligands are omitted.',
      sourceTitle: 'Shen et al. · RCSB PDB 6J8J', sourceUrl: 'https://www.rcsb.org/structure/6J8J' } :
      { label: 'RAT Kᵥ1.2 · PDB 3LUT', title: 'Four subunits around a pore',
        caption: 'X-ray re-refinement, 2.9 Å; biological assembly has four α and four β subunits. Static Cα backbone reference, separate from squid HH dynamics. Ligands omitted.',
        sourceTitle: 'Chen et al. · RCSB PDB 3LUT', sourceUrl: 'https://www.rcsb.org/structure/3LUT' };
  };

  function setView(next, channel = 'na') {
    if (!['neuron', 'membrane', 'channel'].includes(next)) throw new Error('Unknown biological view');
    view = next; selectedChannel = channel === 'k' ? 'k' : 'na';
    const visible = representation === 'model' ? (modelDefinition.id === 'hh-cable' ? 'cable' : 'model') : next;
    Object.entries(roots).forEach(([name, root]) => root.setEnabled(name === visible));
    channels.na.setEnabled(selectedChannel === 'na'); channels.k.setEnabled(selectedChannel === 'k');
    transition = { started: performance.now(), radius: camera.radius, alpha: camera.alpha, beta: camera.beta, destination: perspectives[visible] };
  }
  function update(next, spatial = lastSpatial) {
    lastSpatial = spatial;
    observations = next;
    compartment.update(next);
    cable.update(spatial.compartments, spatial.probeIndex);
    const voltage = next?.voltage?.value ?? -65;
    const excitation = Math.max(0, Math.min(1, (voltage + 65) / 105));
    for (const mat of neuronMaterials) mat.emissiveColor = mat.diffuseColor.scale(.025 + excitation * .22);
    for (const kind of ['na', 'k']) {
      const activity = Math.max(0, Math.min(1, next?.[kind === 'na' ? 'sodiumOpenFraction' : 'potassiumOpenFraction']?.value ?? 0));
      for (const { mat, base } of activityMaterials[kind]) mat.emissiveColor = base.scale(.035 + Math.sqrt(activity) * .45 + (focusedObservable === (kind === 'na' ? 'sodiumCurrent' : 'potassiumCurrent') ? .2 : 0));
    }
  }
  scene.onBeforeRenderObservable.add(() => {
    if (!transition) return;
    const t = Math.min(1, (performance.now() - transition.started) / 550), ease = t * t * (3 - 2 * t), d = transition.destination;
    camera.radius = transition.radius + (d.radius - transition.radius) * ease;
    camera.alpha = transition.alpha + (d.alpha - transition.alpha) * ease;
    camera.beta = transition.beta + (d.beta - transition.beta) * ease;
    if (t === 1) transition = null;
  });
  engine.runRenderLoop(() => scene.render());
  const ready = Promise.all(['allen-464212183', '6j8j', '3lut'].map(async name => {
    const response = await fetch(`/assets/biology/${name}.json`);
    if (!response.ok) throw new Error(`Local structure data ${name} could not be loaded.`);
    return response.json();
  })).then(([morphology, sodium, potassium]) => {
    if (disposed) return;
    drawMorphology(morphology); drawBilayer(); drawProtein(sodium, 'na'); drawProtein(potassium, 'k');
    loaded = true; update(observations); setView(view, selectedChannel);
  }).catch(error => { loadError = error; throw error; });
  function setRepresentation(next) {
    if (!['anatomy', 'model'].includes(next)) throw new Error('Unknown representation');
    representation = next; setView(view, selectedChannel);
  }
  return { setView, setRepresentation, update, description, ready,
    setModel(model, geometry) { modelDefinition = model; if (model.id === 'hh-cable') cable.configure(geometry); setView(view, selectedChannel); },
    setFocus(observable) { focusedObservable = observable; },
    resize: () => engine.resize(),
    dispose: () => { disposed = true; engine.stopRenderLoop(); scene.dispose(); engine.dispose(); } };
}
