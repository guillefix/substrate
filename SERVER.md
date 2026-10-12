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
