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
| `http:<METHOD> /api/<name>` | requests per route group. For streaming routes `wallMs` is the connection time |

Each window also carries `cpu` (`userMs`, `systemMs` of this process from `process.cpuUsage()`) so the sum of sources can be compared with the process total, and `dropped` (see below).

## Where it goes

- `job-timing/<UTC date>.jsonl` in the state folder: one append-only line per window that had any run (`kind: "job-timing"`). 14 days kept.
- `GET /api/job-timing?hours=1` (read-only): the switch and the lines of the last hours summed per source.

## Switch and counter

- `jobTiming` (Settings → OPERATIONS → JOB TIMING, default `on`, SUPERVISOR only, no `atcctl` command). `off`: no timing, no file writes; every wrapped call runs exactly as before. Recorded as `policy / job-timing-mode`.
- `dropped`: a running count of timings that were not kept: a new source name past the limit of 96 names, or a window that could not be written. It is in every line and in the API.

## Cost

Two `performance.now()` calls and one map update per run; the file is written once per window. Nothing waits for the timing, and nothing reads it on the request path.

## Limits

- `ms` is the synchronous part only; work done in the thread pool, in child processes or by the kernel after an `await` is not in it. Compare it with `cpu` for the process total.
- Streaming routes (`/api/events` style) show the connection time in `wallMs`.
- It does not profile inside a source. For that, run a test server (port 7702-7799) with `NODE_OPTIONS="--cpu-prof"`.
