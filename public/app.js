import { createExperiment } from "./experiments/neuron.js";
import { createLocalModelConnection } from "./adapters/local-model.js";
import { Readouts } from "./engine/readouts.js";
import { RecordedRun } from "./engine/recorded-run.js";
import { hhModel } from "./models/hh.js";
import { cableModel } from "./models/cable.js";
import { createNeuronRenderer } from "./renderers/neuron.js";
import { mountCurrentBalance } from "./explanations/current-balance.js";

const $ = (id) => document.getElementById(id);
const experiment = createExperiment();
const connection = createLocalModelConnection();
const readouts = new Readouts();
let latest = null,
  history = [],
  observations = null,
  running = false,
  advancing = false;
let renderer,
  representation = "anatomy",
  view = "neuron",
  selectedChannel = "na";
let comparison = null,
  runs = new Map(),
  activeRunId = null,
  inspectionIndex = null,
  probeIndex = 0;
let focusedObservable = null,
  spatial = {},
  displayedSample = null,
  currentModel = hhModel;
const visualFocus = (key) =>
  ["voltageSlope", "capacitance", "voltage"].includes(key)
    ? "voltage"
    : [
          "sodiumOpenFraction",
          "sodiumActivation",
          "sodiumAvailability",
          "sodiumConductance",
          "sodiumReversal",
        ].includes(key)
      ? "sodiumCurrent"
      : key === "potassiumActivation"
        ? "potassiumCurrent"
        : key;
const colors = {
  voltage: "#b8dfac",
  na: "#e9ae7f",
  k: "#86bbd5",
  applied: "#d6ca8b",
  axial: "#c9a5d5",
  leak: "#a9ada9",
};
const request = (path, body) => connection.request(path, body);
function errorMessage(error) {
  $("error").textContent =
    error.message || "The local model service is unavailable.";
  $("error").hidden = false;
}
async function perform(action) {
  try {
    $("error").hidden = true;
    await action();
  } catch (error) {
    errorMessage(error);
  }
}
const activeRun = () => (activeRunId ? runs.get(activeRunId) : null);
const samples = () => activeRun()?.data.samples || history;
const isCable = () => currentModel.id === "hh-cable";
function addSample(point, parameters) {
  const copy = { ...point, _parameters: { ...parameters } };
  if (history.length && history.at(-1).time === point.time)
    history[history.length - 1] = copy;
  else if (!history.length || point.time > history.at(-1).time)
    history.push(copy);
}
function accept(payload) {
  latest = payload;
  for (const point of payload.samples || [])
    addSample(point, payload.parameters);
  addSample(payload.sample, payload.parameters);
  if (payload.done) running = false;
  $("connection").textContent = "Local model connected";
  if (!activeRunId) present();
  updateTransport();
}
const explanation = mountCurrentBalance($("equation-explanation"), {
  onFocus: (key) => {
    focusedObservable = visualFocus(key);
    renderer?.setFocus(focusedObservable);
    $("plot-focus").textContent = key
      ? `Highlighted: ${experiment.observables[key]?.label || key}`
      : "";
    present();
  },
});
readouts.bind({
  id: "numeric-panel",
  observables: [
    "voltage",
    "sodiumActivation",
    "sodiumAvailability",
    "potassiumActivation",
  ],
  present: (o) => {
    const voltage = o.voltage.value.toFixed(2).replace("-", "−");
    $("voltage").textContent = voltage;
    $("model-voltage").textContent = `${voltage} mV`;
    $("time").textContent = o.voltage.time.toFixed(2);
    $("gate-m").textContent = o.sodiumActivation.value.toFixed(3);
    $("gate-h").textContent = o.sodiumAvailability.value.toFixed(3);
    $("gate-n").textContent = o.potassiumActivation.value.toFixed(3);
  },
});
readouts.bind({
  id: "spatial-view",
  observables: Object.keys(experiment.observables),
  present: (o) => renderer?.update(o, spatial),
});

function selected() {
  const list = samples();
  if (!list.length) return null;
  const index =
    inspectionIndex === null
      ? list.length - 1
      : Math.min(inspectionIndex, list.length - 1);
  const frame = list[index],
    run = activeRun()?.data;
  const local =
    run?.model === "hh-cable" ? frame.compartments[probeIndex] : frame;
  return {
    index,
    frame,
    sample: { ...local, time: frame.time },
    parameters: run?.parameters || frame._parameters || latest.parameters,
  };
}
function probeLabel() {
  if (!isCable()) return "Uniform model prediction";
  const x = activeRun()?.data.geometry.centers_um?.[probeIndex];
  return `Compartment ${probeIndex + 1}${Number.isFinite(x) ? ` · ${x.toFixed(1)} µm from proximal end` : ""}`;
}
function present() {
  const selection = selected();
  if (!selection) return;
  const run = activeRun()?.data;
  currentModel = run?.model === "hh-cable" ? cableModel : hhModel;
  displayedSample = selection.sample;
  spatial = { compartments: selection.frame.compartments, probeIndex };
  observations = experiment.accept({
    sample: selection.sample,
    parameters: selection.parameters,
    modelDefinition: currentModel,
    scope: {
      modelId: run?.model || hhModel.id,
      runId: run ? `${comparison.protocol.id}:${run.id}` : "live",
      probeId: isCable() ? `compartment-${probeIndex}` : "uniform",
    },
  });
  readouts.publish(observations);
  const limit = run ? run.samples.at(-1).time : 200;
  $("time-limit").textContent = limit;
  $("progress-fill").style.width = `${(selection.sample.time / limit) * 100}%`;
  $("active-model").textContent = currentModel.label;
  $("model-summary-label").textContent = isCable()
    ? "LOCAL VOLTAGE · SELECTED COMPARTMENT"
    : "ONE SHARED VOLTAGE";
  $("model-state-label").textContent = isCable()
    ? `${run.geometry.nseg} compartments · V, m, h, n in each`
    : "4 state variables: V · m · h · n";
  $("probe-caption").textContent = probeLabel();
  $("inspect-time").max = Math.max(0, samples().length - 1);
  $("inspect-time").value = selection.index;
  $("inspect-time").disabled = samples().length < 2;
  $("inspection-status").textContent =
    `${run ? "Recorded comparison" : inspectionIndex === null ? "Live experiment" : "Live recording"} · ${selection.sample.time.toFixed(2)} ms · ${probeLabel()}`;
  $("follow-live").hidden = !!run || inspectionIndex === null;
  $("probe-select-wrap").hidden = !isCable();
  explanation.update(observations, {
    modelLabel: currentModel.label,
    probeLabel: probeLabel(),
    inspectionLabel: run
      ? "Recorded sample · no interpolation"
      : inspectionIndex === null
        ? "Live sample"
        : "Historical sample",
  });
  describeView();
  drawPlots();
  updateTransport();
}
function updateTransport() {
  const recorded = !!activeRunId;
  $("live-controls").hidden = recorded;
  $("recorded-controls").hidden = !recorded;
  $("run-status").textContent = recorded
    ? "RECORDED"
    : inspectionIndex !== null
      ? "INSPECTING"
      : latest?.done
        ? "COMPLETE"
        : running
          ? "RUNNING"
          : "PAUSED";
  $("run").innerHTML = running
    ? "Pause experiment <span>Ⅱ</span>"
    : `${latest?.done ? "Experiment complete" : "Run experiment"} <span>▶</span>`;
  $("run").disabled = !!latest?.done;
  $("stimulate").disabled = !!latest?.done;
}
function setActiveRun(id) {
  const previousTime = displayedSample?.time || 0;
  running = false;
  activeRunId = id || null;
  const run = activeRun()?.data;
  currentModel = run?.model === "hh-cable" ? cableModel : hhModel;
  renderer?.setModel(currentModel, run?.geometry);
  if (run) {
    let nearest = 0;
    for (let i = 1; i < run.samples.length; i++)
      if (
        Math.abs(run.samples[i].time - previousTime) <
        Math.abs(run.samples[nearest].time - previousTime)
      )
        nearest = i;
    inspectionIndex = nearest;
    const count = run.geometry?.nseg || 1;
    if (run.model === "hh-cable") probeIndex = Math.min(probeIndex, count - 1);
    $("probe-select").replaceChildren(
      ...Array.from({ length: count }, (_, i) => {
        const o = document.createElement("option");
        o.value = i;
        o.textContent = `${i === 0 ? "Near" : i === count - 1 ? "Far" : `Segment ${i + 1}`} · ${(run.geometry.centers_um?.[i] || 0).toFixed(1)} µm`;
        return o;
      }),
    );
    $("probe-select").value = probeIndex;
  } else inspectionIndex = null;
  for (const button of document.querySelectorAll("[data-run]"))
    button.setAttribute(
      "aria-pressed",
      String((button.dataset.run || null) === activeRunId),
    );
  present();
}
$("inspect-time").addEventListener("input", () => {
  running = false;
  inspectionIndex = Number($("inspect-time").value);
  present();
});
$("follow-live").addEventListener("click", () => {
  inspectionIndex = null;
  present();
});
$("probe-select").addEventListener("change", () => {
  probeIndex = Number($("probe-select").value);
  present();
});
$("return-live").addEventListener("click", () => setActiveRun(null));
$("select-live").addEventListener("click", () => setActiveRun(null));

function sliderLabels() {
  $("amplitude-value").textContent = `${$("amplitude").value} µA/cm²`;
  $("duration-value").textContent =
    `${Number($("duration").value).toFixed(1)} ms`;
  $("g-na-value").textContent = `${$("g-na").value} mS/cm²`;
  $("g-k-value").textContent = `${$("g-k").value} mS/cm²`;
}
for (const id of ["amplitude", "duration", "g-na", "g-k"])
  $(id).addEventListener("input", sliderLabels);
for (const [id, key] of [
  ["g-na", "g_na"],
  ["g-k", "g_k"],
])
  $(id).addEventListener("change", () =>
    perform(async () => {
      inspectionIndex = null;
      accept(await request("parameters", { [key]: Number($(id).value) }));
    }),
  );
$("run").addEventListener("click", () => {
  if (latest && !latest.done) {
    inspectionIndex = null;
    running = !running;
    present();
  }
});
$("reset").addEventListener("click", () =>
  perform(async () => {
    running = false;
    inspectionIndex = null;
    updateTransport();
    const payload = await request("reset", {
      g_na: Number($("g-na").value),
      g_k: Number($("g-k").value),
    });
    history = [];
    accept(payload);
  }),
);
$("stimulate").addEventListener("click", () =>
  perform(async () => {
    inspectionIndex = null;
    accept(
      await request("pulse", {
        amplitude: Number($("amplitude").value),
        duration: Number($("duration").value),
      }),
    );
    running = true;
    updateTransport();
  }),
);
$("restore-channels").addEventListener("click", () =>
  perform(async () => {
    inspectionIndex = null;
    accept(await request("parameters", { g_na: 120, g_k: 36 }));
    $("g-na").value = 120;
    $("g-k").value = 36;
    sliderLabels();
  }),
);
function download(data, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export").addEventListener("click", () =>
  perform(async () => {
    if (activeRunId) download(comparison, "substrate-model-comparison.json");
    else
      download(await request("recording"), "substrate-neuron-experiment.json");
  }),
);
$("export-comparison").addEventListener("click", () =>
  download(comparison, "substrate-model-comparison.json"),
);
setInterval(async () => {
  if (!running || advancing || activeRunId) return;
  advancing = true;
  try {
    accept(await request("advance", { steps: 50 }));
  } catch (e) {
    running = false;
    updateTransport();
    errorMessage(e);
  } finally {
    advancing = false;
  }
}, 50);

$("compare-models").addEventListener("click", () =>
  perform(async () => {
    running = false;
    updateTransport();
    $("compare-models").disabled = true;
    $("compare-models").textContent = "Calculating both models…";
    try {
      const result = await request("comparison", {
        current_nA: Number($("comparison-current").value),
        pulse_duration_ms: Number($("comparison-duration").value),
      });
      const nextRuns = new Map(
        result.runs.map((record) => [record.id, new RecordedRun(record)]),
      );
      comparison = result;
      runs = nextRuns;
      $("comparison-results").hidden = false;
      $("export-comparison").hidden = false;
      $("run-choices").replaceChildren(
        ...result.runs.map((run) => {
          const b = document.createElement("button");
          b.dataset.run = run.id;
          b.textContent =
            run.model === "hh-cable" ? "Spatial cable" : "Single compartment";
          b.setAttribute("aria-pressed", "false");
          b.addEventListener("click", () => setActiveRun(run.id));
          return b;
        }),
      );
      $("protocol-summary").textContent =
        `${result.protocol.current_nA} nA for ${result.protocol.pulse_duration_ms} ms, starting at ${result.protocol.pulse_start_ms} ms. Same total membrane area and total current. Lumped input spreads over the whole membrane; cable input enters the proximal end. Cable is idealized, not fitted to the displayed anatomy.`;
      $("resolution-note").textContent =
        result.runs.find((r) => r.model === "hh-cable").resolution_note ||
        "21-segment exploratory cable: refine spatial resolution before quantitative conclusions.";
      renderMetrics();
      probeIndex = 0;
      setActiveRun(result.runs.find((r) => r.model === "hh-cable").id);
      setRepresentation("model");
      // Inspect a fixed point just after stimulus onset; no solver state transfer.
      inspectionIndex = Math.min(
        samples().length - 1,
        Math.round(
          (result.protocol.pulse_start_ms + 2) /
            (samples()[1].time - samples()[0].time),
        ),
      );
      present();
    } finally {
      $("compare-models").disabled = false;
      $("compare-models").textContent = "Run matched comparison";
    }
  }),
);
function renderMetrics() {
  const rows = [];
  for (const { data: run } of runs.values()) {
    const metrics =
      run.model === "hh-cable"
        ? [
            ["Cable · near", run.compartment_metrics?.[0]],
            ["Cable · far", run.compartment_metrics?.at(-1)],
          ]
        : [["Uniform compartment", run.metrics]];
    for (const [label, m] of metrics) {
      if (!m) continue;
      const row = document.createElement("tr");
      for (const value of [
        label,
        `${m.peak_voltage_mV.toFixed(2)} mV`,
        m.first_spike_ms === null
          ? "No crossing"
          : `${m.first_spike_ms.toFixed(2)} ms`,
        String(m.spike_count),
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        row.append(td);
      }
      rows.push(row);
    }
  }
  $("comparison-metrics").replaceChildren(...rows);
}
function describeView() {
  const description = renderer?.description(view, selectedChannel);
  if (!description) return;
  $("scale-label").textContent = description.label;
  $("scene-title").textContent = description.title;
  $("scene-caption").textContent =
    description.caption +
    (isCable() && representation === "anatomy"
      ? " Anatomy colors show the selected cable probe only; there is no branch-to-cable mapping."
      : "");
  const source = $("structure-source");
  source.hidden = !description.sourceUrl;
  if (description.sourceUrl) {
    source.href = description.sourceUrl;
    source.textContent = description.sourceTitle || "Structure source";
  }
}
function setView(next) {
  view = next;
  for (const b of document.querySelectorAll("[data-channel]")) {
    b.classList.toggle("active", b.dataset.channel === selectedChannel);
    b.setAttribute(
      "aria-pressed",
      String(b.dataset.channel === selectedChannel),
    );
  }
  for (const button of document.querySelectorAll("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === next);
    button.setAttribute("aria-pressed", String(button.dataset.view === next));
  }
  $("channel-switch").hidden =
    representation !== "anatomy" || next !== "channel";
  renderer?.setView(next, selectedChannel);
  describeView();
}
function setRepresentation(next) {
  representation = next;
  for (const b of document.querySelectorAll("[data-representation]")) {
    b.classList.toggle("active", b.dataset.representation === next);
    b.setAttribute("aria-pressed", String(b.dataset.representation === next));
  }
  $("anatomy-scales").hidden = next !== "anatomy";
  $("model-summary").hidden = next !== "model";
  $("scene-kind").textContent =
    next === "model" ? "MODEL DIAGRAM · 3D" : "BIOLOGICAL REFERENCES · 3D";
  $("channel-switch").hidden = next !== "anatomy" || view !== "channel";
  renderer?.setRepresentation(next);
  describeView();
}
for (const b of document.querySelectorAll("[data-view]"))
  b.addEventListener("click", () => setView(b.dataset.view));
for (const b of document.querySelectorAll("[data-representation]"))
  b.addEventListener("click", () =>
    setRepresentation(b.dataset.representation),
  );
for (const b of document.querySelectorAll("[data-channel]"))
  b.addEventListener("click", () => {
    selectedChannel = b.dataset.channel;
    for (const other of document.querySelectorAll("[data-channel]")) {
      other.classList.toggle(
        "active",
        other.dataset.channel === selectedChannel,
      );
      other.setAttribute(
        "aria-pressed",
        String(other.dataset.channel === selectedChannel),
      );
    }
    renderer?.setView(view, selectedChannel);
    describeView();
  });

function plot(canvas, series, min, max, horizon) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2),
    width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (!width || !height) return;
  if (
    canvas.width !== Math.round(width * ratio) ||
    canvas.height !== Math.round(height * ratio)
  ) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const left = 38,
    right = width - 12,
    top = 10,
    bottom = height - 25,
    x = (t) => left + (t / horizon) * (right - left),
    y = (v) => bottom - ((v - min) / (max - min)) * (bottom - top);
  ctx.font = "9px -apple-system,sans-serif";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const value = min + (i / 3) * (max - min),
      yy = y(value);
    ctx.strokeStyle = "#29392d";
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    ctx.fillStyle = "#7e957e";
    ctx.textAlign = "right";
    ctx.fillText(Math.round(value), left - 7, yy + 3);
  }
  for (let i = 0; i <= 4; i++) {
    const t = (horizon * i) / 4;
    ctx.fillStyle = "#7e957e";
    ctx.textAlign = i === 4 ? "right" : "center";
    ctx.fillText(`${Math.round(t)}${i === 4 ? " ms" : ""}`, x(t), height - 6);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top - 2, right - left, bottom - top + 4);
  ctx.clip();
  for (const line of series) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.selected
      ? 3
      : focusedObservable === line.observable
        ? 2.5
        : 1.6;
    ctx.globalAlpha =
      focusedObservable && focusedObservable !== line.observable ? 0.55 : 1;
    ctx.setLineDash(line.dash || []);
    ctx.beginPath();
    let started = false;
    for (const point of line.points) {
      const value = point[line.field];
      if (!Number.isFinite(value)) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(x(point.time), y(value));
        started = true;
      } else ctx.lineTo(x(point.time), y(value));
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "#d5dfc0";
  if (displayedSample) {
    ctx.beginPath();
    ctx.moveTo(x(displayedSample.time), top);
    ctx.lineTo(x(displayedSample.time), bottom);
    ctx.stroke();
  }
  ctx.restore();
}
function currentHistory() {
  const run = activeRun()?.data;
  if (run?.model === "hh-cable")
    return run.samples.map((frame) => ({
      ...frame.compartments[probeIndex],
      time: frame.time,
    }));
  return samples();
}
function drawPlots() {
  const points = currentHistory(),
    horizon = activeRunId
      ? samples().at(-1).time
      : Math.min(
          200,
          Math.max(30, Math.ceil((history.at(-1)?.time || 0) / 25) * 25),
        );
  let voltageLines = [
    { points, field: "voltage", color: colors.voltage, observable: "voltage" },
  ];
  $("voltage-legend").textContent = activeRunId
    ? "Uniform · mint / near · orange / far · blue"
    : "Selected membrane voltage";
  if (activeRunId) {
    voltageLines = [];
    for (const { data: r } of runs.values()) {
      if (r.model === "hh-cable") {
        for (const [i, color] of [
          [0, colors.na],
          [r.geometry.nseg - 1, colors.k],
        ])
          voltageLines.push({
            points: r.samples.map((f) => ({
              time: f.time,
              voltage: f.compartments[i].voltage,
            })),
            field: "voltage",
            color,
            observable: "voltage",
            dash: i === 0 ? [] : [4, 3],
          });
      } else
        voltageLines.push({
          points: r.samples,
          field: "voltage",
          color: colors.voltage,
          observable: "voltage",
        });
    }
  }
  if (
    isCable() &&
    probeIndex !== 0 &&
    probeIndex !== activeRun().data.geometry.nseg - 1
  ) {
    voltageLines.push({
      points,
      field: "voltage",
      color: colors.axial,
      observable: "voltage",
      selected: true,
    });
    $("voltage-legend").textContent += " / selected probe · purple";
  }
  plot($("voltage-plot"), voltageLines, -90, 60, horizon);
  let extent = 30;
  for (const p of points)
    for (const field of ["i_na", "i_k", "i_applied", "i_axial", "i_leak"])
      extent = Math.max(extent, Math.abs(p[field] || 0));
  extent = Math.ceil(extent / 50) * 50;
  plot(
    $("current-plot"),
    [
      ["i_na", "na", "sodiumCurrent"],
      ["i_k", "k", "potassiumCurrent"],
      ["i_applied", "applied", "appliedCurrent"],
      ["i_leak", "leak", "leakCurrent"],
      ["i_axial", "axial", "axialCurrent"],
    ].map(([field, color, observable]) => ({
      points,
      field,
      color: colors[color],
      observable,
    })),
    -extent,
    extent,
    horizon,
  );
}
try {
  renderer = createNeuronRenderer($("scene"), {
    onSelect: (selection) => {
      if (selection.channel) selectedChannel = selection.channel;
      setView(selection.view);
    },
    onProbe: (index) => {
      if (isCable()) {
        probeIndex = index;
        $("probe-select").value = index;
        present();
      }
    },
  });
  Promise.resolve(renderer.ready)
    .then(() => {
      describeView();
      if (observations) renderer.update(observations, spatial);
    })
    .catch(errorMessage);
} catch (error) {
  errorMessage(error);
}
window.addEventListener("resize", () => {
  renderer?.resize();
  drawPlots();
});
sliderLabels();
perform(async () => {
  const payload = await request("state");
  const recording = await request("recording");
  const params = { ...recording.initial_parameters };
  let event = 0;
  const changes = recording.events.filter((e) => e.kind === "parameters");
  history = recording.samples.map((sample) => {
    while (
      event < changes.length &&
      changes[event].step * recording.dt_ms <= sample.time + 1e-9
    )
      Object.assign(params, changes[event++].changes);
    return { ...sample, _parameters: { ...params } };
  });
  $("g-na").value = payload.parameters.g_na;
  $("g-k").value = payload.parameters.g_k;
  sliderLabels();
  accept(payload);
});
