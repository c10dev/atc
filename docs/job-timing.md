# JOB TIMING (ATC-525)

**English** · [한국어](job-timing.ko.md)

The atc server spends CPU on a steady stream of periodic work: the 2-second snapshot tick, the jobs in `server/jobs/`, the `*-run` ticks, the transcript `fs.watch`, and the `claude agents --json` child processes. JOB TIMING counts how often each source runs and how long it holds the event loop, so a cut can be chosen from numbers instead of guesses. It measures only. It changes no value, no order and no freshness of any screen.

## What is measured

Each source has a name. Per 5-minute window the server keeps, for every name: `runs`, `ms` (sum of the synchronous part, the best in-process stand-in for server CPU), `maxMs` (worst single synchronous part), and for async work `wallRuns`, `wallMs`, `wallMaxMs` (start to settle, wall clock; time spent waiting for a child process is in it, so it is **not** CPU).

| Name | Source |
|---|---|
| `tick:buildSnapshot`, `tick:signature`, `tick:events`, `tick:jobs`, `tick:alerts`, `tick:queue`, `tick:summary`, `tick:radio` | the stages of the 2-second snapshot tick (`server/index.ts`) |
| `job:<name>` | every job in `server/jobs/` (`every`, `tick`, `start`), timed by the job runner (`server/job-registry.ts`) |
| `tick:leaks`, `tick:effect-check`, `tick:duty-review`, `tick:duty-run`, `tick:readability`, `tick:skill-calls` | the `*-run` timers that are not registry jobs |
| `fuel:watch-event`, `fuel:fullWalk`, `fuel:applyDirty`, `fuel:scan` | transcript `fs.watch` events, the full tree walk, the dirty re-stat, and the FUEL scan (`server/fuel-tree.ts`, `server/fuel-run.ts`) |
| `agents-json` | one `claude agents --json` run (`server/agents-cache.ts`): `runs` is the spawn count, `wallMs` its wall time. The child's own CPU is not the server's and is not in this number |
| `http:<METHOD> <route pattern>` | requests per matched route pattern (for example `http:GET /api/dispatch/flight/:key`); an unknown path falls into `/api/*`, so stray requests cannot use up names. For streaming routes `wallMs` is the connection time |

Each window also carries `cpu` (`userMs`, `systemMs` of this process from `process.cpuUsage()`) so the sum of sources can be compared with the process total, and `dropped` (see below).

## Where it goes

- `job-timing/<UTC date>.jsonl` in the state folder: one append-only line per window that had any run (`kind: "job-timing"`). 14 days kept.
- `GET /api/job-timing?hours=1` (read-only): the switch and the lines of the last hours summed per source.

## Switch and counter

- `jobTiming` (Settings → OPERATIONS → JOB TIMING, default `on`, SUPERVISOR only, no `atcctl` command). `off`: no timing, no file writes; every wrapped call runs exactly as before. Recorded as `policy / job-timing-mode`.
- `dropped`: a running count of timings that were not kept: a new source name past the limit of 96 names, or a window that could not be written. It is in every line and in the API.

## Event loop lag (ATC-538)

JOB TIMING counts what each source costs; EVENT LOOP LAG tells the SUPERVISOR that the server as a whole is slow, so it is learned from atc and not from a slow screen.

- **Measured.** `perf_hooks.monitorEventLoopDelay` (10 ms resolution, the resolution itself is subtracted). Each window line carries `loop: { p99Ms, maxMs }`, the delay of the same 5-minute window. `null` when it could not be measured. `GET /api/job-timing` shows the worst `p99Ms` and `maxMs` of the lines it sums. Lines written before this change have no `loop` and are skipped.
- **Alert.** When `p99Ms` is above the threshold for N consecutive windows, one CAUTION alert `alert|event-loop-lag` is raised ("server event loop is slow …"). A window at or under the threshold clears it. Defaults: 250 ms and 3 windows (15 minutes); both are in Settings → server (`ATC_EVENT_LOOP_LAG_MS`, `ATC_EVENT_LOOP_LAG_WINDOWS`). The run of windows is counted in memory; after a restart an open episode continues and a new run starts from zero.
- **Switch.** `eventLoopLag` (Settings → OPERATIONS → EVENT LOOP LAG, default `on`, SUPERVISOR only, no `atcctl` command), same pattern as `jobTiming`. `off`: no alert, and an alert that is up comes down at once. The `p99Ms`/`maxMs` recording stays (it belongs to JOB TIMING). Recorded as `policy / event-loop-lag-mode`.
- **Episodes** are appended to `event-loop-lag-episodes.jsonl`: `open` when the alert is raised, `close` when it clears (`endedBy`: `cleared`, `switch`, or `no-data` when JOB TIMING is off and the window could not be measured). A **MISFIRE** is a closed episode that was `cleared` within 10 minutes of being raised, a short blip the SUPERVISOR did not need to hear about. Closes by `switch` or `no-data` are not counted: they do not say the alert was wrong. `GET /api/event-loop-lag?days=7` returns the switch, the thresholds, `episodes`, `closed`, `misfires`, `share` and the recent closes; METRICS → MISFIRE shows it as one lane row next to the others.
- **EFFECT CHECK.** `metric: timing:event-loop-p99` in a work order's `## Measure`: the median of the per-window `p99Ms` before and after the deploy (a single spiky window does not move a median). Like the flow medians it needs at least 3 windows on both sides, and the lines must cover the whole before window. JOB TIMING keeps 14 days, so use `window: 7d` or less.
- It changes no value, order or freshness of any screen: the delay is read from a histogram once per window.

## Cost

Two `performance.now()` calls and one map update per run; the file is written once per window. Nothing waits for the timing, and nothing reads it on the request path.

## Limits

- `ms` is the synchronous part only; work done in the thread pool, in child processes or by the kernel after an `await` is not in it. Compare it with `cpu` for the process total.
- Streaming routes (`/api/events` style) show the connection time in `wallMs`.
- It does not profile inside a source. For that, run a test server (port 7702-7799) with `NODE_OPTIONS="--cpu-prof"`.
