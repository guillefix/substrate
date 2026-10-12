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
