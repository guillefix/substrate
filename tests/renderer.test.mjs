import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import B from 'babylonjs';
import { createNeuronRenderer } from '../public/renderers/neuron.js';
import { createExperiment } from '../public/experiments/neuron.js';

test('anatomy/model switching preserves observations, model and remembered anatomy scale', async () => {
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
  let engine, renderer;
  globalThis.window = { BABYLON: { ...B, Engine: class extends B.NullEngine {
    constructor() { super(); engine = this; }
  } }, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  globalThis.fetch = async url => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../public${url}`, import.meta.url), 'utf8')) });
  try {
    renderer = createNeuronRenderer({}); await renderer.ready;
    const experiment = createExperiment();
    const observations = experiment.accept({sample:{time:7,voltage:25,m:.8,h:.4,n:.6,i_na:-3,i_k:2,i_applied:0},parameters:{g_na:120,g_k:36}});
    const before = JSON.stringify(observations);
    renderer.update(observations);
    const scene = engine.scenes[0];
    renderer.setView('channel', 'k');
    renderer.setRepresentation('model');
    assert.equal(scene.getTransformNodeByName('single-compartment-model').isEnabled(),true);
    assert.equal(scene.getTransformNodeByName('channel').isEnabled(),false);
    assert.match(renderer.description().title,/One electrical compartment/);
    const body = scene.getMeshByName('one-electrical-compartment');
    assert.equal(body.metadata.modelId,experiment.model.id);
    assert.ok(body.material.emissiveColor.r > .1);
    renderer.setRepresentation('anatomy');
    assert.equal(scene.getTransformNodeByName('channel').isEnabled(),true);
    assert.equal(scene.getTransformNodeByName('kv1.2').isEnabled(),true);
    assert.equal(scene.getTransformNodeByName('single-compartment-model').isEnabled(),false);
    assert.match(renderer.description().label,/Kᵥ1.2/);
    assert.equal(JSON.stringify(experiment.observe()),before);
    assert.equal(experiment.system.time,7);
    assert.throws(()=>renderer.setRepresentation('unavailable'),/Unknown representation/);
  } finally {
    renderer?.dispose(); engine?.dispose(); globalThis.window=oldWindow; globalThis.fetch=oldFetch;
  }
});

test('cable geometry presents local voltages and keeps model topology when inspecting time', async () => {
  const oldWindow=globalThis.window,oldFetch=globalThis.fetch;
  let engine,renderer;
  globalThis.window={BABYLON:{...B,Engine:class extends B.NullEngine{constructor(){super();engine=this;}}},devicePixelRatio:1,addEventListener(){},removeEventListener(){}};
  globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL(`../public${url}`,import.meta.url),'utf8'))});
  try {
    const {cableModel}=await import('../public/models/cable.js');
    renderer=createNeuronRenderer({});await renderer.ready;
    renderer.setModel(cableModel,{nseg:3});renderer.setRepresentation('model');
    const scene=engine.scenes[0],first=scene.getMeshByName('cable-compartment-0'),last=scene.getMeshByName('cable-compartment-2');
    renderer.update({voltage:{value:10}},{probeIndex:2,compartments:[{voltage:-65},{voltage:0},{voltage:40}]});
    assert.notDeepEqual(first.material.diffuseColor.asArray(),last.material.diffuseColor.asArray());
    assert.equal(last.scaling.x,1.18);
    const before=scene.meshes.length;
    renderer.update({voltage:{value:-65}},{probeIndex:0,compartments:[{voltage:-65},{voltage:-65},{voltage:-65}]});
    assert.equal(scene.meshes.length,before);
    assert.equal(first,scene.getMeshByName('cable-compartment-0'));
    assert.equal(scene.getTransformNodeByName('spatial-cable-model').isEnabled(),true);
    renderer.setRepresentation('anatomy');
    assert.doesNotMatch(renderer.description().caption,/no spatial propagation/);
  } finally {renderer?.dispose();engine?.dispose();globalThis.window=oldWindow;globalThis.fetch=oldFetch;}
});
