/** A model diagram. Its shape conveys an approximation, not measured anatomy. */
export function createCompartment(B, scene, model) {
  const root = new B.TransformNode('single-compartment-model', scene);
  const material = new B.StandardMaterial('uniform-compartment-voltage', scene);
  material.diffuseColor = B.Color3.FromHexString('#9cbd94');
  material.specularColor = new B.Color3(.08, .09, .07);
  material.specularPower = 48;
  const body = B.MeshBuilder.CreateSphere('one-electrical-compartment', { diameter: 3.6, segments: 48 }, scene);
  body.scaling.set(1.15, .86, .85);
  body.position.y = .8;
  body.material = material;
  body.parent = root;
  body.isPickable = false;
  body.metadata = { modelId: model.id, representationId: model.representation.id };
  // A single boundary: no spatial subdivisions or individual channel particles.
  const rimMaterial = new B.StandardMaterial('compartment-outline', scene);
  rimMaterial.emissiveColor = B.Color3.FromHexString('#c4deb4');
  const ring = B.MeshBuilder.CreateTorus('one-membrane-boundary', { diameter: 4.25, thickness: .025, tessellation: 96 }, scene);
  ring.parent = root; ring.position.y = .8; ring.rotation.x = Math.PI / 2;
  ring.material = rimMaterial; ring.isPickable = false;
  return { root, setFocus(key) {
    const colors = {sodiumCurrent:'#e9ae7f',potassiumCurrent:'#86bbd5',appliedCurrent:'#d6ca8b',axialCurrent:'#c9a5d5'};
    rimMaterial.emissiveColor = B.Color3.FromHexString(colors[key] || '#c4deb4');
  }, update(observations) {
    const voltage = observations?.voltage?.value ?? -65;
    const excitation = Math.max(0, Math.min(1, (voltage + 65) / 105));
    material.emissiveColor = material.diffuseColor.scale(.035 + excitation * .35);
  } };
}
