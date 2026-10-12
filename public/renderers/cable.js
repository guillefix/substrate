/** Compartment geometry is model topology; it does not change on time inspection. */
export function createCable(B, scene) {
  const root = new B.TransformNode("spatial-cable-model", scene);
  let segments = [],
    count = 0;
  const cold = B.Color3.FromHexString("#759fa2"),
    hot = B.Color3.FromHexString("#f0b16c");
  const markerMaterial = new B.StandardMaterial("input-location", scene);
  markerMaterial.diffuseColor = hot;
  const input = B.MeshBuilder.CreateCylinder(
    "proximal-input-marker",
    { height: 0.6, diameterTop: 0, diameterBottom: 0.22, tessellation: 16 },
    scene,
  );
  input.parent = root;
  input.position.set(-3.7, 1.65, 0);
  input.rotation.z = Math.PI;
  input.material = markerMaterial;
  input.isPickable = false;
  function configure(geometry) {
    const next = geometry?.nseg || 21;
    if (next === count) return;
    for (const segment of segments) {
      segment.material.dispose();
      segment.dispose();
    }
    count = next;
    segments = [];
    for (let i = 0; i < count; i++) {
      const segment = B.MeshBuilder.CreateCylinder(
        `cable-compartment-${i}`,
        { height: (7.6 / count) * 0.95, diameter: 0.65, tessellation: 20 },
        scene,
      );
      segment.rotation.z = Math.PI / 2;
      segment.position.set(-3.8 + ((i + 0.5) * 7.6) / count, 0.8, 0);
      segment.parent = root;
      segment.material = new B.StandardMaterial(`local-voltage-${i}`, scene);
      segment.material.specularColor = new B.Color3(0.08, 0.08, 0.08);
      segment.metadata = { modelId: "hh-cable", compartmentIndex: i };
      segment.isPickable = true;
      segments.push(segment);
    }
  }
  return {
    root,
    configure,
    update(states = [], probeIndex = 0) {
      for (let i = 0; i < segments.length; i++) {
        const voltage = states[i]?.voltage;
        const value = Number.isFinite(voltage)
          ? Math.max(0, Math.min(1, (voltage + 70) / 110))
          : 0;
        const m = segments[i].material;
        m.diffuseColor = B.Color3.Lerp(cold, hot, value);
        m.emissiveColor = m.diffuseColor.scale(i === probeIndex ? 0.3 : 0.055);
        segments[i].scaling.x = segments[i].scaling.z =
          i === probeIndex ? 1.18 : 1;
      }
    },
  };
}
