import { createExperiment } from './experiments/neuron.js';
import { createLocalModelConnection } from './adapters/local-model.js';
import { Readouts } from './engine/readouts.js';
import { createNeuronRenderer } from './renderers/neuron.js';

const $ = (id) => document.getElementById(id);
const experiment = createExperiment();
let latest = null, observations = null, history = [], running = false, advancing = false;
let view = 'neuron', selectedChannel = 'na', renderer;
const connection = createLocalModelConnection();
const readouts = new Readouts();
const colors = { voltage: '#b8dfac', na: '#e9ae7f', k: '#86bbd5', applied: '#d6ca8b' };

function errorMessage(error) {
  $('error').textContent = error.message || 'The local model service is unavailable. Start the service and retry.';
  $('error').hidden = false;
}
const request = (path, body) => connection.request(path, body);
async function perform(action) {
  try { $('error').hidden = true; await action(); }
  catch (error) { errorMessage(error); }
}
function addSample(point) {
  if (history.length && history.at(-1).time === point.time) history[history.length - 1] = point;
  else if (!history.length || point.time > history.at(-1).time) history.push(point);
}
function accept(payload) {
  latest = payload;
  observations = experiment.accept(payload);
  for (const point of payload.samples || []) addSample(point);
  if (!history.length || history.at(-1).time === payload.sample.time) addSample(payload.sample);
  const s = payload.sample;
  readouts.publish(observations);
  $('progress-fill').style.width = `${s.time / 2}%`;
  if (payload.done) running = false;
  $('connection').textContent = 'Local model connected';
  updateTransport();
  drawPlots();
}
readouts.bind({ id: 'numeric-panel', observables: ['voltage','sodiumActivation','sodiumAvailability','potassiumActivation'], present: observations => {
  $('voltage').textContent = observations.voltage.value.toFixed(2).replace('-', '−');
  $('time').textContent = observations.voltage.time.toFixed(2);
  $('gate-m').textContent = observations.sodiumActivation.value.toFixed(3);
  $('gate-h').textContent = observations.sodiumAvailability.value.toFixed(3);
  $('gate-n').textContent = observations.potassiumActivation.value.toFixed(3);
} });
readouts.bind({ id: 'spatial-view', observables: Object.keys(experiment.observables), present: observations => renderer?.update(observations) });

function updateTransport() {
  const done = latest?.done;
  $('run-status').textContent = done ? 'COMPLETE' : running ? 'RUNNING' : 'PAUSED';
  $('run').innerHTML = running ? 'Pause experiment <span>Ⅱ</span>' : `${done ? 'Experiment complete' : 'Run experiment'} <span>▶</span>`;
  $('run').disabled = !!done;
  $('stimulate').disabled = !!done;
}
function sliderLabels() {
  $('amplitude-value').textContent = `${$('amplitude').value} µA/cm²`;
  $('duration-value').textContent = `${Number($('duration').value).toFixed(1)} ms`;
  $('g-na-value').textContent = `${$('g-na').value} mS/cm²`;
  $('g-k-value').textContent = `${$('g-k').value} mS/cm²`;
}
for (const id of ['amplitude', 'duration', 'g-na', 'g-k']) $(id).addEventListener('input', sliderLabels);
for (const [id, key] of [['g-na', 'g_na'], ['g-k', 'g_k']]) {
  $(id).addEventListener('change', () => perform(async () => {
    accept(await request('parameters', { [key]: Number($(id).value) }));
  }));
}
$('run').addEventListener('click', () => { if (latest && !latest.done) { running = !running; updateTransport(); } });
$('reset').addEventListener('click', () => perform(async () => {
  running = false; updateTransport();
  const payload = await request('reset', { g_na: Number($('g-na').value), g_k: Number($('g-k').value) });
  history = []; accept(payload);
}));
$('stimulate').addEventListener('click', () => perform(async () => {
  accept(await request('pulse', { amplitude: Number($('amplitude').value), duration: Number($('duration').value) }));
  running = true; updateTransport();
}));
$('restore-channels').addEventListener('click', () => perform(async () => {
  accept(await request('parameters', { g_na: 120, g_k: 36 }));
  $('g-na').value = 120; $('g-k').value = 36; sliderLabels();
}));
$('export').addEventListener('click', () => perform(async () => {
  const record = await request('recording');
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'substrate-neuron-experiment.json';
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
setInterval(async () => {
  if (!running || advancing) return;
  advancing = true;
  try { accept(await request('advance', { steps: 50 })); }
  catch (error) { running = false; updateTransport(); errorMessage(error); }
  finally { advancing = false; }
}, 50);

function describeView() {
  const description = renderer?.description(view, selectedChannel);
  if (!description) return;
  $('scale-label').textContent = description.label;
  $('scene-title').textContent = description.title;
  $('scene-caption').textContent = description.caption;
  const source = $('structure-source');
  source.hidden = !description.sourceUrl;
  if (description.sourceUrl) { source.href = description.sourceUrl; source.textContent = description.sourceTitle || 'Structure source'; }
}
function setView(next) {
  view = next;
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === next);
    button.setAttribute('aria-pressed', String(button.dataset.view === next));
  });
  $('channel-switch').hidden = next !== 'channel';
  renderer?.setView(next, selectedChannel);
  describeView();
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-channel]').forEach(button => button.addEventListener('click', () => {
  selectedChannel = button.dataset.channel;
  document.querySelectorAll('[data-channel]').forEach(b => { b.classList.toggle('active', b.dataset.channel === selectedChannel); b.setAttribute('aria-pressed', String(b.dataset.channel === selectedChannel)); });
  renderer?.setView(view, selectedChannel); describeView();
}));

function plot(canvas, series, min, max) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  const left = 35, right = width - 12, top = 10, bottom = height - 25;
  const horizon = Math.min(200, Math.max(30, Math.ceil((latest?.sample.time || 0) / 25) * 25));
  const x = time => left + time / horizon * (right - left), y = value => bottom - (value - min) / (max - min) * (bottom - top);
  ctx.font = '9px -apple-system, sans-serif'; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const value = min + i / 3 * (max - min), yy = y(value);
    ctx.strokeStyle = '#29392d'; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
    ctx.fillStyle = '#7e957e'; ctx.textAlign = 'right'; ctx.fillText(Math.round(value), left - 7, yy + 3);
  }
  for (let i = 0; i <= 3; i++) {
    const time = horizon * i / 3;
    ctx.fillStyle = '#7e957e'; ctx.textAlign = i === 3 ? 'right' : 'center';
    ctx.fillText(`${Math.round(time)}${i === 3 ? ' ms' : ''}`, x(time), height - 6);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(left, top - 2, right - left, bottom - top + 4); ctx.clip();
  for (const [field, color] of series) {
    ctx.strokeStyle = color; ctx.lineWidth = field === 'voltage' ? 1.8 : 1.3; ctx.beginPath();
    history.forEach((point, index) => { if (index === 0) ctx.moveTo(x(point.time), y(point[field])); else ctx.lineTo(x(point.time), y(point[field])); });
    ctx.stroke();
    if (history.length === 1) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(history[0].time), y(history[0][field]), 2, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}
function drawPlots() {
  plot($('voltage-plot'), [['voltage', colors.voltage]], -90, 60);
  let extent = 30;
  for (const point of history) extent = Math.max(extent, Math.abs(point.i_na), Math.abs(point.i_k), Math.abs(point.i_applied));
  extent = Math.ceil(extent / 50) * 50;
  plot($('current-plot'), [['i_na', colors.na], ['i_k', colors.k], ['i_applied', colors.applied]], -extent, extent);
}

try {
  renderer = createNeuronRenderer($('scene'), { onSelect: selection => {
    if (selection.channel) selectedChannel = selection.channel;
    document.querySelectorAll('[data-channel]').forEach(b => { b.classList.toggle('active', b.dataset.channel === selectedChannel); b.setAttribute('aria-pressed', String(b.dataset.channel === selectedChannel)); });
    setView(selection.view);
  } });
  Promise.resolve(renderer.ready).then(() => { describeView(); if (observations) renderer.update(observations); }).catch(errorMessage);
} catch (error) { errorMessage(error); }
window.addEventListener('resize', drawPlots);
sliderLabels();
perform(async () => {
  const payload = await request('state');
  $('g-na').value = payload.parameters.g_na; $('g-k').value = payload.parameters.g_k;
  const recording = await request('recording');
  history = recording.samples || [];
  sliderLabels(); accept(payload);
});
