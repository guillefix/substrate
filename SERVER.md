# Local workbench service

Start from the project directory with `.venv/bin/python server.py`, then open
<http://127.0.0.1:8765>. Stop with Ctrl-C. The service uses Python's standard
library and serves only files inside `public/`. There is one in-memory
experiment shared by all tabs; restarting the process discards it. Export a
recording before reset/restart if it should be kept.

The model has a fixed 0.01 ms step, samples every 0.05 ms, and stops at 200 ms.
The client explicitly advances it; no background timer advances physics.
Concurrent requests are serialized under one model lock. The server binds
only to loopback, checks Host and same-origin requests, and accepts at most
4096 bytes of JSON per request. It is a local development service, not a
multiuser deployment server.

| Method | Path | JSON request |
|---|---|---|
| GET | `/api/state` | — |
| GET | `/api/recording` | — |
| POST | `/api/reset` | `{}` or optional `g_na`, `g_k` |
| POST | `/api/advance` | `{"steps": 100}`; integer 0–500 |
| POST | `/api/pulse` | `{"amplitude": 10, "duration": 1}` |
| POST | `/api/parameters` | optional `g_na`, `g_k` |

POST requests require `Content-Type: application/json`. Unknown fields and
invalid types/ranges fail with HTTP 400 and `{"error": "..."}`. Pulse amplitude
is limited to −20 through 50 µA/cm², duration to 0.1 through 10 ms, and duration
must align to a physics step. Overlapping pulses add, with the combined drive
also bounded to −20 through 50. Sodium conductance is limited to 0–240 and
potassium to 0–72 mS/cm². Experiments allow at most 1024 input events.

Reset initializes the normal resting state and then applies requested channel
changes without recomputing rest. Current pulses begin at the current model
time. Inputs and parameters retain the model's replayable event representation.

All state-changing responses and `/api/state` return:

```text
{sample, samples, parameters, dt_ms, duration_limit_ms, done}
```

`sample` is the current readout documented in MODEL.md. `samples` contains
new regular-grid readouts strictly after the beginning of an advance request;
reset returns the initial sample, and other calls return an empty array.
Advance requests near the limit clamp to 200 ms, return `done: true`, and
subsequent advances return no new samples. Pulses extending beyond the limit
are rejected. `/api/recording` returns the model recording object directly.

Run all model and service tests with:

```sh
.venv/bin/python -m unittest discover -s tests -v
```

## Independent matched-model comparison

`POST /api/comparison` creates independent lumped and spatial-cable runs. It
does not reset, advance, or change the live experiment. One comparison may
compute at a time; it uses a separate lock so the live model API is not locked
throughout its computation. The default 40 ms pair takes about 1.3 seconds in
the checked environment and returns approximately 2.6 MB of JSON.

An empty JSON object uses defaults. Optional fields:

| Field | Default | Bounds / units |
|---|---:|---|
| `current_nA` | 0.6 | 0–1 nA total injected current |
| `pulse_start_ms` | 5 | 1–10 ms |
| `pulse_duration_ms` | 1 | 0.1–3 ms |
| `duration_ms` | 40 | 15–60 ms, aligned to 0.1 ms |
| `g_na` | 120 | 0–240 mS/cm² |
| `g_k` | 36 | 0–72 mS/cm² |

Pulse times must align to 0.005 ms and finish inside the run. Geometry and
timestep are fixed in this endpoint to bound computation. There is no file
upload, arbitrary code execution, or user-supplied model script.

Response:

```text
{
  format: "substrate.comparison.v1",
  protocol: {id, request, current_nA, pulse_start_ms, pulse_duration_ms,
             duration_ms, dt_ms, sample_interval_ms, total_area_um2, ...},
  units: {...},
  runs: [
    {id: "hh-lumped", model: "classic-squid-hh", label, parameters, geometry,
     integrator, samples, metrics},
    {id: "hh-cable", model: "hh-cable", label, parameters, geometry,
     integrator, samples, metrics, compartment_metrics, resolution_note}
  ]
}
```

Send `protocol.request` as a new comparison body to repeat a recording.
Results remain client-owned records; the server does not store comparison
history or replace the live experiment. Within a comparison, samples have
matched time points. Run IDs are model labels; scope them by protocol/run
instance in the client, rather than treating them as globally unique IDs.

Every sample includes existing HH readout fields plus `i_axial` (inward-positive
µA/cm²) and `d_v_dt` (mV/ms). Lumped axial current is zero. Cable samples have
a `compartments` array of the same state/current fields; their top-level
readout is the middle segment. Geometry includes `centers_um`,
`compartments: [{index, x_um, area_um2}]`, and `probe_index`. The cable is a
straight uniform cylinder with sealed ends, independent of displayed
reference morphology.

Metrics include `peak_voltage_mV`, `peak_time_ms`, `first_spike_ms` (null if
absent), `spike_count`, `rest_voltage_mV`, `final_voltage_mV`,
`max_abs_axial_current_uA_cm2`, and `probe_index`. Cable metrics additionally
include `propagation_delay_ms`; `compartment_metrics` supplies the same basic
metrics for each position. See MODEL.md for matching conventions, numerical
validation, and spatial-resolution limits.
