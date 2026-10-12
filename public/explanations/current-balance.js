/** An observation-driven explanation. This module never advances or edits a model. */
export const explanationSteps = Object.freeze([
  Object.freeze({
    title: "1 · Account for charge",
    principle: "Conservation law + constant-capacitance approximation",
    text: "Current supplied to a membrane either changes its stored charge or crosses it through ionic pathways. With constant capacitance, the voltage slope tells us how quickly that stored charge changes.",
    question: "At this moment, is the membrane voltage rising or falling?",
    focus: "voltageSlope",
  }),
  Object.freeze({
    title: "2 · Follow the currents",
    principle: "A balance with explicit direction conventions",
    text: "Applied and axial current are positive inward. Sodium, potassium and leak currents are positive outward, so they are subtracted in the balance. A negative sodium current is inward: subtracting it contributes positively to the voltage slope.",
    question:
      "Which current contributes most strongly to charging or discharging the membrane?",
    focus: "sodiumCurrent",
  }),
  Object.freeze({
    title: "3 · Open the sodium term",
    principle: "Effective conductance law + empirically fitted gating",
    text: "Sodium current combines maximum conductance, population gating m³h, and the driving force V − Eₙₐ. The voltage-dependent gate dynamics are fitted model relationships. They are not a microscopic derivation from the displayed protein structure.",
    question:
      "What would reducing sodium conductance change under the same stimulation?",
    focus: "sodiumOpenFraction",
  }),
]);

const quantities = Object.freeze({
  voltage: { label: "Membrane voltage", symbol: "V", unit: "mV" },
  sodiumCurrent: {
    label: "Sodium current",
    symbol: "Iₙₐ",
    unit: "µA/cm²",
    direction: "outward",
  },
  potassiumCurrent: {
    label: "Potassium current",
    symbol: "Iₖ",
    unit: "µA/cm²",
    direction: "outward",
  },
  leakCurrent: {
    label: "Leak current",
    symbol: "Iₗ",
    unit: "µA/cm²",
    direction: "outward",
  },
  appliedCurrent: {
    label: "Applied current",
    symbol: "Iₐₚₚ",
    unit: "µA/cm²",
    direction: "inward",
  },
  axialCurrent: {
    label: "Net axial current",
    symbol: "Iₐₓ",
    unit: "µA/cm²",
    direction: "inward",
  },
  voltageSlope: { label: "Voltage slope", symbol: "dV/dt", unit: "mV/ms" },
  capacitance: {
    label: "Membrane capacitance per area",
    symbol: "Cₘ",
    unit: "µF/cm²",
  },
  sodiumConductance: {
    label: "Maximum sodium conductance per area",
    symbol: "ḡₙₐ",
    unit: "mS/cm²",
  },
  sodiumReversal: {
    label: "Sodium reversal potential",
    symbol: "Eₙₐ",
    unit: "mV",
  },
  sodiumActivation: { label: "Sodium activation", symbol: "m", unit: "1" },
  sodiumAvailability: { label: "Sodium availability", symbol: "h", unit: "1" },
  potassiumActivation: {
    label: "Potassium activation",
    symbol: "n",
    unit: "1",
  },
  sodiumOpenFraction: {
    label: "Sodium population gating factor",
    symbol: "m³h",
    unit: "1",
  },
});

export function formatQuantity(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  if (value === 0) return "0";
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 100000)
    return value.toExponential(2);
  return Number(value.toFixed(3)).toString();
}

/** Keep values from different observation instants or scopes out of one equation.
 * Missing quantities remain missing. In particular, absent axial current is not
 * a measured zero. The supplied slope is a readout, not recalculated here.
 */
export function prepareEquationSnapshot(observations = {}) {
  const entries = Object.entries(quantities).flatMap(([key, descriptor]) => {
    const observation = observations[key];
    return observation == null || observation.value == null
      ? []
      : [{ key, descriptor, observation }];
  });
  let error = null;
  let time = null;
  const scope = {};
  for (const { observation, descriptor } of entries) {
    if (
      !Number.isFinite(observation.value) ||
      !Number.isFinite(observation.time)
    ) {
      error = "An observation has no finite value or simulation time.";
      break;
    }
    if (
      observation.unit !== descriptor.unit ||
      (observation.timeUnit != null && observation.timeUnit !== "ms")
    ) {
      error = "Observation units do not match this equation.";
      break;
    }
    if (time !== null && observation.time !== time) {
      error = "These observations belong to different simulation times.";
      break;
    }
    time = observation.time;
    for (const identity of ["runId", "systemId", "modelId", "probeId"]) {
      const value = observation[identity];
      if (value == null) continue;
      if (scope[identity] != null && scope[identity] !== value) {
        error =
          "These observations belong to different runs, systems or probes.";
        break;
      }
      scope[identity] = value;
    }
    if (error) break;
  }
  const values = {};
  if (!error) {
    for (const { key, descriptor, observation } of entries) {
      let direction = null;
      if (descriptor.direction) {
        direction =
          observation.value === 0
            ? "No net current"
            : observation.value > 0
              ? descriptor.direction
              : descriptor.direction === "inward"
                ? "outward"
                : "inward";
      }
      values[key] = Object.freeze({
        value: observation.value,
        formatted: formatQuantity(observation.value),
        unit: observation.unit,
        direction,
      });
    }
  }
  return Object.freeze({
    valid: !error,
    error,
    time: error ? null : time,
    values: Object.freeze(values),
    scope: Object.freeze(scope),
    hasAxial:
      Object.hasOwn(observations, "axialCurrent") &&
      observations.axialCurrent != null,
  });
}

export function mountCurrentBalance(container, { onFocus = () => {} } = {}) {
  const document = container.ownerDocument;
  const root = document.createElement("section");
  root.className = "current-balance";
  root.setAttribute("aria-label", "Explain the membrane current balance");
  root.innerHTML = `
    <header class="cb-header"><div><p class="cb-eyebrow">Inside the model</p>
      <h2>Why does the voltage change?</h2></div><p class="cb-context"></p></header>
    <nav class="cb-steps" aria-label="Explanation steps"></nav>
    <div class="cb-story" aria-live="polite"><p class="cb-principle"></p>
      <p class="cb-text"></p><p class="cb-question"></p></div>
    <p class="cb-status" role="status"></p>
    <div class="cb-equation" role="group" aria-label="Membrane current balance">
      <div class="cb-capacitive" data-term="voltageSlope"></div>
      <span class="cb-operator" aria-hidden="true">=</span>
      <div data-term="appliedCurrent"></div>
      <span class="cb-axial cb-operator" aria-hidden="true">+</span>
      <div class="cb-axial" data-term="axialCurrent"></div>
      <span class="cb-operator" aria-hidden="true">−</span><div data-term="sodiumCurrent"></div>
      <span class="cb-operator" aria-hidden="true">−</span><div data-term="potassiumCurrent"></div>
      <span class="cb-operator" aria-hidden="true">−</span><div data-term="leakCurrent"></div>
    </div>
    <p class="cb-equation-reading"></p>
    <p class="cb-convention">All currents are densities per membrane area. Positive applied and axial current enter the compartment; positive ionic current leaves it.</p>
    <p class="cb-axial-note"></p>
    <details class="cb-sodium"><summary>Expand the sodium current</summary>
      <p class="cb-sodium-reading">Sodium current equals maximum sodium conductance × m³ × h × (voltage − sodium reversal potential).</p>
      <div class="cb-equation cb-expansion" role="group" aria-label="Sodium current factors">
        <div data-term="sodiumConductance"></div><span class="cb-operator" aria-hidden="true">×</span>
        <div data-term="sodiumActivation" data-power="3"></div><span class="cb-operator" aria-hidden="true">×</span>
        <div data-term="sodiumAvailability"></div><span class="cb-operator" aria-hidden="true">× (</span>
        <div data-term="voltage"></div><span class="cb-operator" aria-hidden="true">−</span>
        <div data-term="sodiumReversal"></div><span class="cb-operator" aria-hidden="true">)</span>
      </div>
      <div class="cb-gating"><div data-term="sodiumOpenFraction"></div>
        <p>m³h is the deterministic population gating factor in this model. It is not a measured count of open individual channels.</p></div>
    </details>
    <footer class="cb-footer">The selected observations supply these values; navigating this explanation does not change the simulation.
      <a href="https://physoc.onlinelibrary.wiley.com/doi/10.1113/jphysiol.1952.sp004764" target="_blank" rel="noopener noreferrer">HH model source</a>
    </footer>`;
  const select = (selector) => root.querySelector(selector);
  const buttons = [];
  const valueElements = [];
  let snapshot = prepareEquationSnapshot();
  let disposed = false;
  let activeStep = 0;

  function focusTerm(key) {
    buttons.forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.observable === key),
      ),
    );
    onFocus(key);
  }

  root.querySelectorAll("[data-term]").forEach((slot) => {
    const key = slot.dataset.term;
    const descriptor = quantities[key];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cb-term";
    button.dataset.observable = key;
    button.setAttribute("aria-pressed", "false");
    const symbol = document.createElement("span");
    symbol.className = "cb-symbol";
    symbol.textContent =
      key === "voltageSlope" ? "Cₘ · dV/dt" : descriptor.symbol;
    if (slot.dataset.power) {
      const exponent = document.createElement("sup");
      exponent.textContent = slot.dataset.power;
      symbol.append(exponent);
    }
    const name = document.createElement("span");
    name.className = "cb-name";
    name.textContent =
      key === "voltageSlope" ? "Capacitive contribution" : descriptor.label;
    const value = document.createElement("span");
    value.className = "cb-value";
    const direction = document.createElement("span");
    direction.className = "cb-direction";
    button.append(symbol, name, value, direction);
    button.addEventListener("click", () => focusTerm(key));
    slot.append(button);
    buttons.push(button);
    valueElements.push({
      key,
      value,
      direction,
      button,
      power: slot.dataset.power,
    });
  });

  const stepButtons = explanationSteps.map((step, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = step.title;
    button.addEventListener("click", () => showStep(index, true));
    select(".cb-steps").append(button);
    return button;
  });

  function showStep(index, focus = false) {
    activeStep = index;
    const step = explanationSteps[index];
    stepButtons.forEach((button, i) =>
      button.setAttribute("aria-pressed", String(i === index)),
    );
    select(".cb-principle").textContent = step.principle;
    select(".cb-text").textContent = step.text;
    select(".cb-question").textContent = step.question;
    if (index === 2) select(".cb-sodium").open = true;
    if (focus) focusTerm(step.focus);
  }

  function renderValues() {
    for (const { key, value, direction, button, power } of valueElements) {
      const quantity = snapshot.values[key];
      if (key === "voltageSlope") {
        const capacitance = snapshot.values.capacitance;
        value.textContent = `Cₘ: ${capacitance ? `${capacitance.formatted} ${capacitance.unit}` : "Unavailable"}; slope: ${quantity ? `${quantity.formatted} ${quantity.unit}` : "Unavailable"}`;
        direction.textContent = quantity
          ? quantity.value === 0
            ? "Voltage stationary"
            : quantity.value > 0
              ? "Voltage rising"
              : "Voltage falling"
          : "";
      } else if (power && quantity) {
        value.textContent = `m: ${quantity.formatted}; m³: ${formatQuantity(quantity.value ** Number(power))}`;
        direction.textContent = "Cube of the activation variable";
      } else {
        value.textContent = quantity
          ? `${quantity.formatted}${quantity.unit === "1" ? "" : ` ${quantity.unit}`}`
          : "Unavailable";
        direction.textContent = quantity?.direction || "";
      }
      button.dataset.available = String(Boolean(quantity));
    }
    root.querySelectorAll(".cb-axial").forEach((element) => {
      element.hidden = !snapshot.hasAxial;
    });
    select(".cb-equation-reading").textContent =
      `Capacitance times voltage slope equals applied current${snapshot.hasAxial ? " plus net axial current" : ""}, minus sodium, potassium and leak currents.`;
    select(".cb-axial-note").textContent = snapshot.hasAxial
      ? "Axial current enters from neighboring compartments per local membrane area. In a lumped model, a supplied zero denotes the absence of spatial coupling."
      : "No axial-current observation is supplied. The displayed balance assumes a spatially uniform membrane; no spatial current has been measured as zero.";
    select(".cb-status").textContent =
      snapshot.error ||
      (snapshot.time === null ? "Waiting for observations." : "");
  }

  container.append(root);
  showStep(activeStep);
  renderValues();

  return {
    update(observations, { modelLabel, probeLabel, inspectionLabel } = {}) {
      if (disposed) return;
      snapshot = prepareEquationSnapshot(observations);
      const timeLabel =
        snapshot.time === null
          ? null
          : `t = ${formatQuantity(snapshot.time)} ms`;
      select(".cb-context").textContent = [
        modelLabel,
        probeLabel,
        inspectionLabel,
        timeLabel,
      ]
        .filter(Boolean)
        .join(" · ");
      renderValues();
    },
    dispose() {
      disposed = true;
      root.remove();
    },
  };
}
