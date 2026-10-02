# Switch and job registry (ATC-393)

Status: built 2026-10-02. Adding a SUPERVISOR switch or a periodic server job adds **one file** and edits no shared line, so switch PRs stop conflicting with each other.

## Why

Since 2026-09-29, 11 of the 15 PRs that needed a GO AROUND touched the same hotspot: `server/settings.ts`, `server/settings-policy.ts`, `server/index.ts` and `web/src/SettingsAutomation.tsx`. Every hunk was "both sides added a different switch on the same line": the one-line destructuring in the settings PUT handler, the one-line log message, the `PolicyKey` union and policy map, and the `setInterval` blocks in `index.ts`. "Live first, with an off switch" means almost every new control adds one more.

## What it is

- **A switch is one file** in `server/switches/` (`export default defineSwitch({...})`, `server/switch-def.ts`). It declares, once: `key` (the `PUT /api/settings` field), `label` (mode line), `group` (`landing` or `operations`, the settings tab), `block` (the settings-window block and its search words), `values`, `default`, `risky` (⚠ modes), `error` (the 400 text), `warn` (one line per value), `row` (label, env name and note of the window row), the three orders, and the functions `read`, `save` and `record` (the line in `[atc] settings updated:`). A switch that is not a plain choice (per-session caps) gives `validate` instead of `values`.
- **A job is one file** in `server/jobs/` (`export default defineJob({...})`, `server/job-def.ts`): `name`, exactly one of `every` (ms, `setInterval`, unref), `tick` (runs after the snapshot is built and warm, optionally only every `everyMs`) or `start` (once at boot), an `order` for tick jobs, and `run(ctx, snapshot)`.
- **Registries read the folders.** `server/switch-registry.ts` and `server/job-registry.ts` import every `.ts` file in their folder (not `*.test.ts`) at startup, check the shape and refuse a duplicate `key` or `name`, naming the file. Nothing lists the files.

## Who reads the declarations

| Reader | What it takes |
|---|---|
| `PUT /api/settings` (`mountSettings`) | validates declared keys in `applyOrder` (the first bad value gives `400 {errors: {key: text}}`), saves them in the same order, builds the `[atc] settings updated:` line from `record`. Keys no switch declares go through the old `.env.local` validation unchanged |
| `GET /api/settings` | `switches[]`: current value, values, ⚠ modes, per-value warnings, window row, orders. The old nested fields stay for the data that is not a switch (airports, GROUND STOPs, caps, last JEV run) |
| `settings-policy.ts` | the mode line (`modeSegments`, by `lineOrder`), ⚠ confirmation (`needsConfirm` from `risky`), the settings search (`settingsIndexOf` merges the `block` of each switch with the static entries) |
| `web/src/SettingsAutomation.tsx` | one window block per `block.code`, one row per switch, the per-value lines and the confirm step. A switch with no entry in `EXTRAS` renders just its rows; `EXTRAS` and `BLOCK_EXTRAS` attach the screens that carry their own data (GROUND STOP rows, per-session caps, the DUTY ACCOUNT row, the MCC SHADOW GATE) |
| `server/index.ts` | `createJobRunner(jobs, ...)`: `runner.tick` in the snapshot tick and `runner.startTimers()` at boot. It lists no job. `provideService` hands the few objects a job cannot import (the `update` object, `applyNow`, the recycle deps, the event log) by name |

## Adding a switch

```ts
// server/switches/my-thing.ts
import { defineSwitch } from "../switch-def.ts";
export default defineSwitch({
  key: "myThing", label: "MY THING", group: "operations",
  block: { code: "MY THING", label: "…", words: "search words" },
  values: ["off", "on"], default: "off", risky: ["on"], error: "off 또는 on",
  warn: { off: "…", on: "⚠ …" },
  row: () => ({ label: "MY THING", env: "myThing", note: "…" }),
  order: 900,
  read: () => /* current value */, save: (v) => /* write the file */, record: (v) => `myThing=${v}`,
});
```

Nothing else needs editing: the PUT route, the mode line, the ⚠ confirmation, the search and the window all pick it up. `server/switch-registry.test.ts` proves it by adding a dummy switch (and `server/job-registry.test.ts` a dummy job) as one temporary file.

## What did not change

- **Guards.** The write path is the same code: `fromThisApp` (this screen's Origin) is checked once, before any switch; nothing about who may write moved. Every switch's values, defaults, confirm steps, warning text, error text and record line are the ones it had; a before/after dump of the settings window HTML and of `GET`/`PUT /api/settings` (defaults, every switch at a ⚠ value, every bad value, the log lines) differs only by the new `switches` field and the `CODEX LANE` switch below.
- **Jobs.** Same functions, same cadence and the same order inside the tick (a tick job that throws still stops the rest of that tick, as before). The four `setInterval` jobs keep their 30 s and 60 s periods.

## CODEX LANE switch (added with this change)

`codexLane` (`server/switches/codex-lane.ts`, `codex-lane.json` `auto`, default `on`, SUPERVISOR only) turns the silent review lane of [ATC-386](occ.md) off: no new silent decisions, no records, no use of an earlier silent state, so only the per-PR 6 h rule remains. It is shown as ⚠ when `on` (it lets a PR land on one review lane), so turning it back on asks for confirmation. Two review fixes ride with it: the lane runs only for repositories that use Codex (not the MCC AIRPORT's, where INSPECTION is the review), and the single-lane count keys a landing by AIRPORT as well as number and head, so the same PR number in another repository is not counted.

## Not built

- The old nested `ServerSettings` fields (`review`, `fuel`, `dispatchAuto`, `autonomyAuto`, `mcc`, `fleetPlan`) are still sent for older readers; nothing in the screen needs them.
- No hot reload of the folders: a new file is read at the next server start.
