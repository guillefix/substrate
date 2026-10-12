import { test } from 'node:test';
import assert from 'node:assert/strict';
import { System, Experiment } from '../public/engine/core.js';
import { createExperiment } from '../public/experiments/neuron.js';

test('a passive non-biological experiment derives observations without changing state', () => {
  const system = new System({ id:'oscillator', label:'Oscillator' });
  const experiment = new Experiment({id:'passive-observation',system,
    observables:{ energy:{unit:'J',read:s => s.speed**2/2} },
    sensors:[{id:'energy-probe',systemId:system.id,observable:'energy',source:'simulation',measurementModel:'ideal',timeUnit:'s'}]});
  const state={speed:4, position:{x:2}};
  system.acceptSnapshot({state,parameters:{mass:1},time:3});
  state.position.x=100;
  assert.equal(system.state.position.x,2);
  assert.equal(experiment.observe().energy.value,8);
  assert.equal(experiment.inputs.length,0);
  assert.equal(system.time,3);
  assert.throws(()=>{system.state.position.x=5;},TypeError);
});

test('invalid sensor associations fail at construction', () => {
  const system = new System({id:'s'});
  assert.throws(()=>new Experiment({id:'e',system,observables:{},sensors:[{id:'p',systemId:'s',observable:'missing'}]}),/unknown observable/);
});

test('neuron representations share identity and observe mean-field fractions', () => {
  const e=createExperiment();
  const payload={sample:{time:2,voltage:-20,m:.5,h:.6,n:.25,i_na:-3,i_k:2,i_applied:10},parameters:{g_na:120,g_k:36}};
  const o=e.accept(payload);
  assert.ok(Math.abs(o.sodiumOpenFraction.value-.075)<1e-12);
  assert.equal(o.potassiumOpenFraction.value,.25**4);
  assert.equal(o.voltage.source,'simulation');
  assert.equal(o.voltage.unit,'mV');
  payload.sample.voltage=999;
  assert.equal(e.system.state.voltage,-20);
  assert.ok(e.system.representations.every(r=>r.systemId===e.system.id));
});

import { Readouts } from '../public/engine/readouts.js';
test('several readouts receive one observation and can detach independently', () => {
  const readouts = new Readouts();
  const observation=Object.freeze({value:-65,unit:'mV',time:0});
  const received=[];
  const detach=readouts.bind({id:'plot',observables:['voltage'],present:o=>received.push(o.voltage)});
  readouts.bind({id:'color',observables:['voltage'],present:o=>received.push(o.voltage)});
  readouts.publish({voltage:observation});
  assert.deepEqual(received,[observation,observation]);
  detach(); readouts.publish({voltage:observation});
  assert.equal(received.length,3);
  assert.throws(()=>readouts.publish({}),/missing observable/);
});

import { RecordedRun } from '../public/engine/recorded-run.js';
test('recorded run inspection owns snapshots and cannot mutate another run', () => {
  const source={id:'a',model:'model-a',parameters:{c:1},samples:[{time:0,voltage:-65},{time:1,voltage:20}]};
  const first=new RecordedRun(source), second=new RecordedRun({...source,id:'b'});
  source.samples[1].voltage=99;
  assert.equal(first.at(1).voltage,20);
  assert.equal(second.at(1).voltage,20);
  assert.throws(()=>{first.at(1).voltage=100;},TypeError);
  assert.throws(()=>first.at(2),/outside/);
  assert.throws(()=>new RecordedRun({...source,samples:[{time:1},{time:0}]}),/increasing/);
});

test('equation observations preserve probe scope, signs and selected parameter history', () => {
  const e=createExperiment();
  const r={time:5,voltage:-30,m:.5,h:.5,n:.25,i_na:-12,i_k:3,i_leak:1,i_applied:2,i_axial:-4};
  const parameters={capacitance:2,g_na:80,e_na:50};
  const o=e.accept({sample:r,parameters,scope:{modelId:'hh-cable',runId:'run-a',probeId:'compartment-4'}});
  assert.equal(o.voltageSlope.value,3);
  assert.equal(e.system.model,'hh-cable');
  assert.equal(o.axialCurrent.value,-4);
  assert.equal(o.capacitance.value,2);
  assert.equal(o.sodiumConductance.value,80);
  assert.ok(Object.values(o).every(v=>v.time===5&&v.runId==='run-a'&&v.probeId==='compartment-4'&&v.modelId==='hh-cable'));
  const missing=e.accept({sample:{...r,i_axial:undefined},parameters,scope:{modelId:'hh-cable'}});
  assert.equal(missing.axialCurrent.value,null);
  assert.equal(missing.voltageSlope.value,null);
});
