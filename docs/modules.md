# Server modules with boundaries (design draft)

**English** · [한국어](modules.ko.md)

atc's server is one flat folder of 272 modules whose only boundary is a file-name prefix. This document gives it **domain folders with a public surface**, **one state store**, **a mount registry next to the existing job registry**, and **config that is built once at the entry point**, and it fixes the order in which teams move code so that file moves cause few GO AROUNDs. It is the design for the M21 WAYPOINT ("Server modules with boundaries", ATC-336). No behavior changes anywhere in this plan.

> Status (2026-10-03): **design draft.** Nothing in this document is built except what section 1 lists as already done (ATC-335, 337, 338, 339, 346, 393). The "Implementation order" table (section 8) holds proposals for DUTY to file in Linear; this PR files none. Facts audited at `origin/main` `b4c44c9`.

Related:
- [switches.md](switches.md): the switch and job registry (ATC-393). This design builds on it and does not replace it.
- [dispatch.md](dispatch.md): what DISPATCH does. Section 9 here only covers where its code lives.
- [mcc.md](mcc.md): LANDING CLEARANCE and `deploy/landing-tier.mjs`.
- [server/README.md](../server/README.md): the module table that section 4.3 splits up.

## 1. Current facts

Re-checked on 2026-10-03 against `origin/main` `b4c44c9`. The work order's facts (2026-10-02) are updated where ATC-335..339, 346 and 393 changed them.

**Done since the work order was written**

| Item | State |
|---|---|
| Boundary test (ATC-335) | `server/boundaries.test.ts` and `server/web-api-boundary.test.ts` run in `npm test`. Both allowlists (`ALLOWED_CYCLES`, `ALLOWED_WEB_NODE_CHAINS`) are **empty**: no value-import cycle in `server/`, no web value import reaches `node:*` or `@hono/*` |
| Cycles (ATC-337, 338, 339) | The 12-module ring and the three small cycles are gone |
| Web API client (ATC-346) | `web/src/api.ts`; `fetch(` does not appear in `web/src` outside it (tested) |
| Switch and job registry (ATC-393) | `server/switches/` (26 files), `server/jobs/` (19 files), `server/job-registry.ts`, `server/declarations.ts` (folder scan). `index.ts` has **no `setInterval`** and lists no job. `provideService(name, value)` hands a job what it cannot import |

**Still true**

| Item | Today |
|---|---|
| Layout | 272 non-test `.ts` files in `server/` (plus `sources/`, `judges/`, `jobs/`, `switches/`). Prefix families: fuel 14 files / 3616 lines, duty 20 / 2740, fleet 5 / 2422, control 9 / 1768, schedule 3 / 1521, dispatch 2 / 1532, `proposals.ts` 1630 |
| Pure / I/O split | Pairs `x.ts` + `x-run.ts` exist, but `-run` is a habit, not a rule: 34 files call `renameSync`, 32 call `appendFileSync`/`appendFile`, 60 files define `mountX` (and `index.ts` makes 60 `mountX(app, …)` calls). `proposals.ts` (78 exports) still holds constants, fold, gates, FLIGHT PLAN text, JSONL read and append, `runDispatch` and `mountDispatch` together |
| Hubs (non-test importers) | `model.ts` (172 importers incl. tests), `config.ts` (99; 88 non-test files import it), `dispatch.ts` (60 non-test), `proposals.ts` (42), `dispatch-launch.ts` (8). The `server/README*.md` module table is the most-edited doc |
| `model.ts` | Type-imports 13 feature modules (`restarting`, `release`, `dispatch-launch`, `landing`, `atfm`, `autoland`, `health`, `activity`, `fuel-remaining`, `human-check`, `session-origin`, `job-state`, `judges/store`) to describe `Snapshot` |
| Config | `config.ts` calls `process.loadEnvFile(.env.local)` and reads `process.env` when first imported. 12 other non-test files read `process.env` themselves. `test-hermetic.ts` redirects `HOME` and `ATC_STATE_DIR` as the first import of a test file, so a test that forgets it reads the real state folder (the 2026-09-30 OOM) |
| State | About 40 JSON/JSONL files under `ATC_STATE_DIR`, each with its own reader and writer |
| Mounts | `index.ts` imports about 60 `mountX` functions and calls each with feature-specific callbacks (`mountDispatch(app, getSnapshot, watchFuel, standFree, launcher, briefExtras, routesOf)`). Order of mounts is the order of lines |
| Web → server | `web/src` has 188 `from "…/server/…"` import lines, about half `import type`. The rest are pure functions (`globe.ts`, `fleet.ts`, `fuel-remaining.ts` …) that the boundary test keeps free of Node built-ins |
| Process boundaries | Control sessions (`controller/`, `occ/`, `mcc/`, `duty/`) reach the server only through `atcctl` HTTP; their few cross-folder imports are pure. Nothing in this plan touches that |

**What the facts mean for the design**

1. The cycle problem is solved and tested. The design only has to keep it solved while 272 files move.
2. The tick half of the registry exists (`server/jobs/`). Only the HTTP mount half is missing (exit criterion 4).
3. A "public surface" has to serve two readers: server modules and the browser. A surface that re-exports `proposals.ts`'s I/O would put `node:fs` into the web bundle. The surface therefore comes in two files (section 2).
4. `deploy/landing-tier.mjs` decides the tier of a PR by **exact file path** (the `SIDE_EFFECT` and `READ_ONLY` lists and `landing-tier.test.mjs`). A move of a listed file edits `deploy/`, which is tier `user`. Moves have to be planned around that (section 7).

## 2. Principles

1. **One rule per boundary, enforced by the existing test.** A boundary that is only in this document does not exist. Every rule in section 3 is added to `server/boundaries.test.ts` (ATC-335) with an allowlist that **only shrinks**, the same way the cycle rule works.
2. **A domain is a folder; a folder has two doors.** `index.ts` is the server-side public surface. `view.ts` is the web-safe surface: types and pure functions only, no Node built-in, no `store/`, no `sources/`. Other domains and `web/` import a domain only through its door.
3. **Pure code stays pure.** Calculation lives in files that import no I/O. I/O lives in `-run.ts` files and in `store/` and `sources/`. HTTP lives in `mount.ts`. This is CLAUDE.md's "계산은 순수 함수로 두고 입출력과 나눈다", made checkable.
4. **Registries read folders; nothing lists files.** The pattern of ATC-393: adding a feature is adding a file, and no shared line changes. The mount registry (section 4) and the state registry (section 5) follow it.
5. **Moves are cheap and edits are separate.** A PR is either a pure `git mv` plus mechanical import rewrites, or an edit. Never both (section 7).
6. **Formats and behavior do not change.** Same routes in the same order, same tick order, same state files byte for byte, same env names and defaults. A change that would alter any of them is out of scope and is filed on its own.
7. **Ownership follows blast radius.** Anything that can affect landing or launch (guards, `deploy/`, `server/jobs/`, `server/switches/`, and from this plan `server/mounts/` and `server/store/registry.ts`) keeps a tier that a person reviews.

## 3. Target layout and import rules

### 3.1 Folders

```
server/
  index.ts            entry: boot, build config, load registries, serve
  boot.ts             the only module that reads the environment (section 6)
  shared/             types and small pure helpers many domains use (model.ts, callsign, registration, linear-keys …)
  store/              json.ts, jsonl.ts, registry.ts (section 5)
  sources/            existing: Claude, Codex, git, Linear, GitHub readers (I/O)
  jobs/  switches/    existing registries (ATC-393), unchanged
  mounts/             transitional one-file-per-mount folder (section 4); empties as domains take their mounts
  dispatch/           DISPATCH (section 9)
  schedule/           schedule, routes, network, milestones, waypoint-*
  fuel/               fuel*, plus the cost parts of logbook
  duty/               duty-*
  landing/            landing, autoland, mcc, pr-merge, human-check, codex-*, migration-*, auto-revert
  fleet/              fleet, control, crew, session-control, fresh-start, accounts, launch-*, health, relay
  radio/              radio, globe, voice, tts, squelch, follow, notices, supervisor-alerts
  core/               snapshot, tick, events, activity, occupancy, status, home, metrics (the loop in README "The loop")
```

The assignment above is by prefix family and is a **starting point**, not a file list. The first PR of each domain move (a "survey" commit, section 7) produces the exact file list from the real import graph, and the domain's `README.md` records it. A file with importers in three or more domains goes to `shared/`; a file used by exactly one domain moves into it.

Inside a domain:

```
server/<domain>/
  index.ts         server surface: explicit named re-exports (no `export *`) of what other domains use
  view.ts          web surface: types and pure functions the browser imports; value graph has no Node built-in
  <name>.ts        pure code (calculation, fold, gates, text)
  <name>-run.ts    I/O (files via store/, processes, network via sources/)
  mount.ts         HTTP: default export defineMount({...}) (section 4)
  <name>.test.ts   tests live next to the code
  README.md, README.ko.md   the domain's module table (section 4.3)
```

`jobs/` and `switches/` stay top-level folders. A job file imports its domain's `index.ts`. Keeping them in one place keeps their tier rules in `deploy/landing-tier.mjs` unchanged.

### 3.2 Import rules (extend `server/boundaries.test.ts`, do not replace it)

Each rule is a test over the same import graph the file already builds (`buildGraph`, `findCycles`), reading only tracked sources, with a `*_ALLOWED` list in the test file that is written down on the day the rule lands and never grows.

| # | Rule | Starts as |
|---|---|---|
| R1 | No value-import cycle in `server/` (exists) | allowlist empty (exists) |
| R2 | `web/src` has no value import path to `node:*` or `@hono/*` (exists) | allowlist empty (exists) |
| R3 | Web (`web/src`) imports a domain only through `<domain>/view.ts`, and top-level modules not yet in a domain only until the domain takes them | allowlist = today's `web → server/<file>` imports of files that have moved |
| R4 | A file in domain A imports domain B only through `B/index.ts` (type-only imports included; the one exception is R6). `shared/`, `store/` and `sources/` are layers: they import no domain, and `shared/` imports no `store/` or `sources/` | allowlist = cross-domain deep imports on the day the domain's move lands, drained by each later domain's move |
| R5 | **Pure files import no I/O.** A file that is not `*-run.ts`, `mount.ts`, `index.ts`, under `store/`, `sources/`, `jobs/` or `switches/` must not value-import `node:fs`, `node:child_process`, `node:net`, `node:http(s)`, `store/` or `sources/`, and must not import a `-run.ts` file (`node:path`, `node:url`, `node:os` for pure path math are allowed) | allowlist = the 55 non-`-run` files that do I/O today (count from 2026-10-02, not re-measured; N0 recomputes it), shrinking as each domain splits |
| R6 | `shared/model.ts` may `import type` from `<domain>/view.ts` only (section 6, decision D4) | rule starts with the 13 current type imports |
| R7 | State writes: `renameSync`, `appendFileSync`, `writeFileSync` and `mkdirSync` appear only under `store/` and in a short, named allowlist of non-state writers (caches, WAV files, git worktrees) | allowlist = the 34 + 32 files that write today, shrinking with S1 and S2 |
| R8 | No `process.env` or `.env.local` read outside `boot.ts`, `config.ts` (pure `configOf(env)`) and the allowlisted entry scripts | allowlist = the 12 files that read it today |

R1–R2 exist. R3–R6 land with the first domain move (section 9). R7 lands with the store (section 5). R8 lands with config injection (section 6). A rule is added **in the PR that makes it true for at least one file**, with the allowlist holding the rest, so it is never red.

An unwritten rule does not exist: the test file carries a one-paragraph comment per rule saying what to do when it fails (move the code, or split the file; never add to the allowlist).

## 4. Registry: mounts and ticks

### 4.1 Ticks are done

`server/jobs/` and `createJobRunner` (ATC-393) already do the tick half of the original "feature registry": a job is one file `defineJob({ name, every | tick | start, order, run })`, `index.ts` lists none, and failures are logged per job. This design adds **nothing** to ticks. Open items for ticks, listed in section 8: jobs that still call a function by domain-internal import should import the domain's `index.ts` once a domain exists (a mechanical edit in that domain's move PR).

### 4.2 Mounts

A mount is one file with a default export, discovered by folder scan like jobs and switches:

```ts
// server/mounts/dispatch.ts  (later: server/dispatch/mount.ts)
import { defineMount } from "../mount-def.ts";
export default defineMount({
  name: "dispatch",
  order: 200,                       // route registration order; default 1000, then name
  mount: (app, deps) => mountDispatch(app, deps.getSnapshot, deps.service("fuelWatch"), …),
});
```

- `defineMount`, `MountDecl` and `MountDeps` (`getSnapshot()`, `service<T>(name)`, `config`) live in `server/mount-def.ts` (types only, importable by every domain). `server/mount-registry.ts` loads declarations with the existing `loadDeclarations(dir, isDecl, what)` and refuses a duplicate `name`, exactly as `job-registry.ts` does.
- **Where it scans.** `server/mounts/*.ts` (step N2) and `server/*/mount.ts` (from the first domain move). Both scans stay until `server/mounts/` is empty, then the folder goes.
- **Services replace feature callbacks.** `mountDispatch` takes five callbacks today. Those are objects `index.ts` builds (watchFuel, standFree hooks, launcher, brief extras, routes loader). `index.ts` calls `provideService(name, value)` for each (the mechanism jobs already use), and the mount file reads them with `deps.service(name)`. `index.ts` then lists **no feature**: it builds the services, loads both registries, mounts the static server last (it is a catch-all), and serves.
- **Order is explicit, not accidental.** Two routes that can match the same path are the only place registration order matters (a `/api/x/:id` before a literal `/api/x/summary`). The registry sorts by `order` then `name`; the first mount PR records today's order as `order` numbers in steps of 10. The safety net is a test that dumps `app.routes` (method, path) from the real registry and compares it with a committed list (`server/mounts/routes.golden.txt`). A feature PR that adds a route edits that golden list: one added line, which merges cleanly unless two PRs add a route at the same spot, and is the explicit "routes changed" signal to the reviewer.
- **Tier.** A mount file can reach side effects through a service name that the import scan cannot see, the same reason `server/jobs/` is flagged. The N2 PR adds `[/^server\/mounts\//, …]` to `FLAGGED` in `deploy/landing-tier.mjs` (so N2 itself is tier `user`), and domain `mount.ts` files get the pattern `^server\/[a-z-]+\/mount\.ts$`.

### 4.3 The README module table

`server/README.md` and `README.ko.md` keep the loop, the sources table and **one line per domain** linking to `server/<domain>/README.md`. The module table moves to those per-folder files, so a PR that adds a file edits only its own domain's README. The root list changes only when a domain is added. Generating the table from code was considered and rejected: a generator is one more thing to break, and the table's text is the explanation, not a listing. Each domain README has the same four headings: Surface (`index.ts` names), Web surface (`view.ts`), Modules (one row per file), State files (names from the registry).

## 5. State store

Goal (exit criterion 3): every state file under `ATC_STATE_DIR` is written through one module and listed in one registry, formats unchanged.

```
server/store/
  json.ts       readJson<T>(file, fallback), writeJson(file, value)   atomic: write <file>.<pid>.tmp, rename
  jsonl.ts      appendLine(file, obj), readLines<T>(file, opts), foldLines(file, reducer, init)
  registry.ts   STATE_FILES: { name, kind, owner, format }[]  and  stateFile(name) -> handle
```

- **Handles, not paths.** `json.ts` and `jsonl.ts` take the handle from `stateFile("proposals.jsonl")`, which throws for a name that is not in the registry. A new state file therefore cannot be written without a registry entry, and the registry cannot drift from the code. Reading a file the module does not own (`readJson` of another domain's file) is allowed only through that domain's `index.ts`, by R4.
- **Entry fields.** `name` (file name under the state folder; directories end in `/`), `kind` (`json` | `jsonl` | `dir` | `text`), `owner` (the domain), `format` (one line: the shape, the key fields, how it is folded). `jsonl` entries also say whether a bad line is skipped or fatal, because today's readers differ and the store must keep each reader's behavior (`readLines(file, { onBad: "skip" | "throw" })`).
- **Same bytes.** The store functions take the indentation (`JSON.stringify(v, null, 2)` or compact) and trailing newline as parameters because today's writers differ. S1 and S2 move a writer only when a test shows the output bytes for the same input are identical (a golden string per file kind in `server/store/*.test.ts`).
- **A format change is flagged by the registry.** `server/store/registry.ts` is added to the `user` list in `deploy/landing-tier.mjs` (in S1). Adding a state file, changing `kind`, or editing `format` text is an edit to that file, so the PR is tier `user` and, by CLAUDE.md, carries a "Behavior change" section. A writer that changes the shape of a file without touching the registry is caught in review by the golden-bytes test failing.
- **Other writers.** Caches (`cacheDir`), WAV output, git worktrees and `claude` config folders are not state under `ATC_STATE_DIR`. R7's allowlist names them one by one.
- **Order.** JSONL first (S1: 18 modules per ATC-340 (2026-10-02; the survey recomputes against the 32 files measured in section 1) with their own `append`/`record`, where the rule "append only" matters most), JSON second (S2: the 27 files per ATC-341 with the tmp + rename pattern). The registry is created in S1 with every file already known, so S2 only moves writers.

## 6. Config injection and `model.ts`

### 6.1 Config

- `server/config.ts` exports a **pure** `configOf(env, home): Config` and the `Config` type. It reads nothing. Every env name and default stays as it is today.
- `server/boot.ts` is the only reader: it loads `.env.local` (never printed or copied), builds the config with `configOf(process.env, homedir())` and calls `setConfig(config)`. `index.ts` imports `./boot.ts` **first**, the same trick `test-hermetic.ts` uses, because ES modules evaluate imports before the body.
- `getConfig()` throws `config not set` when `setConfig` has not run. During migration, `export const config` becomes a getter-backed object that calls `getConfig()` on access, so the 88 files that write `config.stateDir` compile unchanged. A module that reads `config.*` at import time (top-level `const FILE = join(config.stateDir, …)`) would throw at load; step C1 finds each of these (a grep-able pattern) and turns them into a function call, before the getter lands.
- **Tests.** `test-hermetic.ts` becomes a thin helper that builds `testConfigOf(tmp)` and calls `setConfig`. A test that forgets it gets an exception, not the production state folder. A test proves it: import a sample of server modules in a child process without `setConfig` and assert that touching `config.stateDir` throws (so the 2026-09-30 failure cannot recur silently). R8 forbids new `process.env` reads outside `boot.ts`; the 12 existing ones get migrated by domain.
- **Migration in batches by domain** (C2..): one PR per domain moves its `process.env` reads into `configOf` and passes config as a parameter to its pure functions. Batches do not move files; a domain's move PR and its config batch are separate PRs.

### 6.2 `model.ts` direction

Two options were weighed: (a) feature slices that `Snapshot` composes (each domain augments the interface, `declare module`), (b) keep type-only imports. **Decision D4: keep type-only imports**, moved to `shared/model.ts`, restricted by R6 to `<domain>/view.ts`.

Why: type imports are erased, so they are not edges in the value graph that R1 checks and cost nothing at run time. Module augmentation makes the shape of `Snapshot` depend on which files the compiler happens to include, and it hides the whole shape from a reader of `model.ts`. R6 keeps the dependency pointing at a web-safe file, so `shared` never learns a domain's internals. `shared/model.ts` stays the single place that lists what a snapshot contains. If a domain's slice type grows enough to need its own file, it moves into that domain's `view.ts`.

The consequence: `shared → domain` type edges exist, and a domain imports `shared/model.ts` types back. That is a type-level cycle that TypeScript allows and R1 does not count. It is acceptable because R6 limits it to `view.ts`, which by principle 2 imports no I/O and (by R5) no `-run` file.

## 7. Move order that keeps GO AROUNDs low

A move conflicts with every FLIGHT that edits a moved file or an import line of one. The GO AROUNDs of September sat on a few hubs (11 of 15 on the settings and `index.ts` hotspots, see [switches.md](switches.md)); a naive move of `proposals.ts` (42 non-test importers) would hit every FLIGHT at once. The plan:

1. **One domain per PR group, hubs first and small domains early.** The first move is DISPATCH (section 9) because it proves the layout on the busiest code. After it the order is by size of importer fan-in, smallest first, so a hub is never moved together with its callers: `radio`, `fuel`, `schedule`, `duty`, `landing`, `fleet`, `core`, with `shared/` and `store/` extraction done by their own steps (S1, S2, C1) rather than as part of a domain.
2. **Every domain move is three kinds of commit, in this order, in one PR:**
   1. *survey* (docs only, `server/<domain>/README.md` + the exact file list);
   2. *pure `git mv`* of the files, with tests, **no content change** (git then records renames at 100% similarity, so in-flight edits to those files merge through the rename);
   3. *import rewrite*: a mechanical edit of specifiers in importers (`./proposals.ts` → `./dispatch/index.ts`, or `../dispatch/index.ts` from a subfolder), plus the new `index.ts`/`view.ts`, the boundary rule and the golden checks. Reviewable with `git diff --word-diff` and a script, no logic.

   Edits to the moved code (splitting pure from I/O, renames, `mount.ts`) are **later PRs**, never in the move PR.
3. **No re-export shims at the old paths.** A shim keeps the old path alive as a new small file, so git sees `proposals.ts` as *modified*, not *renamed*, and an in-flight edit to the old path conflicts instead of following the rename. The cost of no shim is import-line conflicts in importers, which are one-line, mechanical, and covered by the GO AROUND rule below. (Alternative considered: a `package.json` `imports` alias or shims for a few weeks. Rejected for the reason above; recorded as decision D2 so the SUPERVISOR can overrule it.)
4. **Land when the board is quiet.** Before starting and before opening the PR, the team checks that no other FLIGHT has the domain's files open (OVERLAP / FLEET shows files in flight, [dispatch.md](dispatch.md) "file overlap"); if one does, the move waits for it to land, or the move is rebased by `merge origin/main`. DISPATCH holds a move FLIGHT until the domain's files are free (`overlap` already gives DISPATCH this signal; naming a "MOVE" FLIGHT type is a follow-up, section 8 N10, not needed for the first move).
5. **GO AROUND on a move conflict (ATC-128 rule, unchanged).** `READBACK C-xxxx`, `git merge origin/main` (no rebase). A conflict between the move and an in-flight FLIGHT is resolved on the **FLIGHT's side**, because the FLIGHT is the smaller change: take the move's path, re-apply the FLIGHT's edit to the file at its new path (`git mv`'s rename detection usually does this for content edits), and for import-line conflicts take the moved specifier. If a FLIGHT and the move edited the same lines of logic, the FLIGHT's team replies `UNABLE C-xxxx — …` per ATC-128 and the move PR waits; the move is never rewritten to fit.
6. **Tier of a move PR.** `deploy/landing-tier.mjs` matches exact paths, so a move PR is as high as its highest path: a moved file that is in `SIDE_EFFECT` or `READ_ONLY` needs its entry renamed (a `deploy/` edit, tier `user`), and a file that runs commands but is not listed fails `landing-tier.test.mjs`. The survey commit lists the domain's listed files; a domain with listed files is a `user` PR with the "Behavior change" section (BEFORE/AFTER: same behavior, new path). The tier also counts **importers**: the rewrite commit edits every file that imports a moved file, and `server/switches/*` is `user` and `server/jobs/*` is `flagged` by folder. DISPATCH core (`dispatch.ts`, `dispatch-launch.ts`, `proposals.ts` are not listed) is imported by 7 switch files and 2 job files, so P1 is `user` (9.5).
7. **What conflicts anyway.** `docs/*.md` and `server/README*.md` link to old paths (`docs/dispatch.md`, `docs/radio.md`, `docs/follow.md`, …). The move PR fixes the links in the same PR (grep `server/<oldname>`); a stale link is a docs bug, not a test failure, so the survey commit lists every file that names the old path.

## 8. Implementation order

Work orders for DUTY to file. **None is filed by this PR.** Tier is the tier expected from `deploy/landing-tier.mjs`; wake is the size label (S/M/L/H as in Linear). "Exists" means an issue already in M21.

| Step | Work order | Scope | Tier | Wake | M21 exit criterion |
|---|---|---|---|---|---|
| N0 | Boundary rules R3–R8 skeleton: tests for R3, R4, R5, R7, R8 with allowlists computed from today's graph, all green; comment per rule | `server/boundaries.test.ts` only | auto | M | 1 (extends), supports 2, 5, 6 |
| N1 | `server/mount-def.ts`, `mount-registry.ts`, `declarations` reuse; `index.ts` iterates the registry; every `mountX` call becomes `server/mounts/<name>.ts`, `app.routes` golden file; route list before/after in the PR | `server/index.ts`, new files, `deploy/landing-tier.mjs` (FLAGGED `server/mounts/`) | user | L | 4 |
| ATC-345 (P1) | First domain move: DISPATCH (section 9): survey, `git mv`, import rewrite, `index.ts`/`view.ts`, R3/R4 turned on for `dispatch/` | `server/dispatch/` + importers (incl. 7 files in `server/switches/`, 2 in `server/jobs/`) + 3 web type imports + tests | user (see section 9.5) | H | 6 |
| P2 | DISPATCH split: `proposals.ts` into pure `proposals.ts`, `proposals-run.ts` (read/append/`runDispatch`), `mount.ts` (`mountDispatch` moves from `mounts/`); `dispatch/README.md` module table | `server/dispatch/` only | flagged (mount) | H | 4, 6 |
| ATC-340 (S1) | Store: `store/jsonl.ts`, `store/registry.ts` with every state file, R7 for JSONL; move the JSONL writers (18 per ATC-340, 2026-10-02; recomputed by its survey), golden bytes per file | `server/store/`, writers | user (registry in `deploy/`) | H | 3 |
| ATC-341 (S2) | Store: `store/json.ts`, move the atomic JSON writers (27 per ATC-341, 2026-10-02; recomputed by its survey) | `server/store/`, writers | auto | M | 3 |
| C1 | Config: `configOf`, `boot.ts`, getter-backed `config`, `getConfig` throws; fix import-time reads; hermetic test helper builds `testConfigOf`; test proving a forgotten config cannot reach production | `server/config.ts`, `boot.ts`, `index.ts`, `test-hermetic.ts` | auto | H | 5 |
| ATC-343 (C2..) | Config batches per domain: move the 12 direct `process.env` reads, pass config to pure functions; R8 allowlist to empty | per domain | auto | M each | 5 |
| ATC-342 (reshaped) | Subsumed by N1 for mounts. What is left of ATC-342 (README table per folder) is done in each domain move (section 4.3). Close it when N1 and P1 land | — | — | — | 4 |
| P3..P8 | One domain move each in the order of section 7.1: radio, fuel, schedule, duty, landing, fleet, then `core/`. Each = survey + `git mv` + import rewrite + R3/R4 for that domain; then the split PR for its `-run` and `mount.ts` | per domain | auto, or user if the survey lists `deploy/` paths | H each | 6 (first domain) and the layout |
| X1 | `shared/` extraction: `model.ts` → `shared/model.ts` with R6; callsign, registration, linear-keys, address, origin … by importer count | `server/shared/` + importers | auto | H | 6 supports |
| N9 | Drain R5 (pure files without I/O): per domain, as part of each split PR | per domain | auto | — | R5 empty |
| N10 | Optional: a MOVE FLIGHT kind in DISPATCH that holds a move until the domain's files are free | `server/dispatch/` + docs | flagged | M | — |

**Every M21 exit criterion maps to a step**

| M21 exit criterion | Step(s) | State |
|---|---|---|
| 1. Boundary check fails on a new cycle and on web → Node I/O; allowlist only shrinks | ATC-335 (done); N0 adds R3–R8 on the same pattern | done / N0 |
| 2. `server/` has no value-import cycles (allowlist empty) | ATC-337, 338, 339 (done); R1 holds through every move, because every move PR runs `npm test` | done; guarded by R1 |
| 3. Every state file through one store module, listed in one registry, formats unchanged | ATC-340 (S1), ATC-341 (S2), R7 | S1, S2 |
| 4. Features register their own mount and tick; adding one edits neither `index.ts` nor the README table | ticks: ATC-393 (done); mounts: N1, P2; README table: per-folder in every domain move | N1, P1, P2 |
| 5. `config.ts` does not read the environment at import time; modules receive config; tests cannot reach the production state folder | C1, ATC-343 (C2..), R8 | C1, C2.. |
| 6. `docs/modules.md` merged; DISPATCH in its own folder with a public `index.ts` that other modules import | this document (ATC-336), ATC-345 (P1) | this PR, P1 |
| 7. Web calls the API through one typed client module | ATC-346 (done, `web/src/api.ts`, `web-api-boundary.test.ts`) | done |

**Dependencies.** N0 first (it only adds tests). N1 and P1 are independent and may fly in parallel, and P2 (which moves `mountDispatch` out of `proposals.ts`) waits for both: P1 moves the DISPATCH code, N1 gives the mount a file to live in. S1 before S2. C1 before C2... Domain moves P3.. each wait for P1 (proof of layout) and N0 (rules). X1 waits for at least two domain moves, so `shared/` is cut by real importer counts. ATC-345 is blocked by this PR only: it turns R3 and R4 on for the one literal prefix `server/dispatch/`, and N0 generalises that to every domain.

## 9. The first domain move: DISPATCH (ATC-345, fly-ready)

### 9.1 What moves

| Today | In `server/dispatch/` | Lines | Non-test importers |
|---|---|---|---|
| `server/dispatch.ts` (+ `dispatch.test.ts`, `dispatch-alerts-key.test.ts`) | `dispatch.ts` | 1184 | 60 |
| `server/dispatch-launch.ts` (+ `dispatch-launch.test.ts`) | `dispatch-launch.ts` | 348 | 8 |
| `server/proposals.ts` (+ `proposals.test.ts`, `proposals-close.test.ts`) | `proposals.ts` | 1630 | 42 |

File names stay (the move is `git mv` at 100% similarity; renaming to drop the repeated word is a separate later PR). Not moved in P1: `release*`, `briefs`, `briefing`, `crosscheck`, `reasons`, `response`, `preflight`, `readiness`, `standfree*`, `overlap-run`, `departures`, `issue-notes`, `atfm*`, `pr-holder*`, `k-approval`, `k3-*`, `judges/dispatch.ts`. They are DISPATCH satellites that the survey commit classifies as `dispatch/` or `shared/` for P3-style follow-up PRs: moving 40 files with the core would make P1 an every-FLIGHT conflict. P1 is the three core files and their tests.

### 9.2 Public surface

`server/dispatch/index.ts` is an explicit list of named re-exports (no `export *`). The list is computed, not guessed: a script (run in the survey commit, kept in the PR description) collects every name that a **non-test file outside the three moved files** imports from them. Measured now at `b4c44c9`: 21 value names and 2 types from `proposals.ts`, 46 and 12 from `dispatch.ts`, 27 and 6 from `dispatch-launch.ts` (counts include the three files importing one another; some names repeat), against 195 exports in total. Names outside the list stay module-internal and may then be un-exported by a later PR. Tests inside the domain import files directly; tests elsewhere import `index.ts`.

`server/dispatch/view.ts` is the web-safe subset. Web imports three names today, all `import type`: `Proposal` (`web/src/FlightDispatch.tsx`) and `AbsentAircraft` (`web/src/views/fleet/Absent.tsx`, `Fleet.tsx`). `view.ts` re-exports exactly those types, and the three web files change their specifier to `…/server/dispatch/view.ts`. `proposals.ts` imports `node:fs`, so no web **value** import of it is possible (R2 would fail); a name the web later needs as a value and that lives in a file with I/O is the signal to split that file in D2, not to widen `view.ts`.

### 9.3 Steps for the team

1. **Check the board** (OVERLAP, FLEET): no other FLIGHT has `dispatch.ts`, `dispatch-launch.ts`, `proposals.ts` or their tests in its diff. If one does, send STANDBY to OCC and wait. Re-check before opening the PR.
2. **Survey commit** (docs + script output only): `server/dispatch/README.md` and `.ko.md` with the file list, the surface list (script output), the web-import list, the `deploy/landing-tier.mjs` paths that name moved files (expected: none), the importers in `server/switches/` and `server/jobs/` (they set the tier), and the docs and README links to fix (`grep -rn "server/\(proposals\|dispatch\|dispatch-launch\)" docs server/README*.md README*.md`).
3. **`git mv` commit**: the three files and their five tests into `server/dispatch/`. No content change. `git diff -M --stat origin/main` must show every moved file as a rename with 100% similarity; if not, stop.
4. **Rewrite commit**: change every importer's specifier. Inside `server/dispatch/` the moved files import each other as before (`./dispatch.ts`); their imports of other modules get one more `../`. Everyone else imports `…/dispatch/index.ts`; `web/` imports `…/server/dispatch/view.ts`. Add `index.ts` and `view.ts`. Use a throwaway script and show it in the PR; no hand edits to logic.
5. **Rules commit**: in `server/boundaries.test.ts`, add R3 and R4 for `dispatch/` (the other domains do not exist yet, so the rule is one literal prefix; N0 generalises it) with the allowlist of deep imports that remain (expected: empty for `dispatch/`).
6. **Docs commit**: fix links found in step 2; `docs/dispatch.md` and `.ko.md` get a one-line "Code: `server/dispatch/`" note; `server/README.md` and `.ko.md` get the one-line domain pointer and the DISPATCH rows move to `server/dispatch/README.md`; `changelog.d/ATC-345.md` and `.ko.md` (section `Changed`, "no behavior change").
7. **Verify** (all three, plus the two diffs below).
   - `npm test`, `npx tsc --noEmit -p .`, `npx vite build`, `node --test deploy/` (landing tier).
   - Test server (Skill `test-server`, 7702, a copied state folder): `GET /api/dispatch/brief` and the DISPATCH panel's endpoints return the same JSON before and after, field for field (take the "before" on a checkout of `origin/main` with the same state folder copy; use the proposals file, not live GitHub: `ATC_GITHUB=off`). Dump `app.routes` before and after and attach both as text in the PR.
8. **PR**: title `DISPATCH moves into server/dispatch/ with a public index.ts and view.ts (ATC-345)`; body: tier `user`, the verification above, a "Behavior change" section (BEFORE/AFTER: same behavior, new paths), and **what was learned for the next moves** (the ATC-345 done-when): surface size, shims not needed, number of conflicts, anything surprising about the tier.

### 9.4 Done when

- `npm test`, `tsc`, `vite build` and `node --test deploy/` pass; R3 and R4 are on for `dispatch/` and pass with an empty allowlist for it.
- No file outside `server/dispatch/` imports `dispatch/dispatch.ts`, `dispatch/proposals.ts` or `dispatch/dispatch-launch.ts` directly (the test proves it).
- 7702: the DISPATCH tab and `/api/dispatch/brief` behave the same on a copied state folder; the route list is unchanged.
- The PR lists follow-up work orders (for DUTY, not Linear): P2 and which satellites go next.

### 9.5 Expected tier

`user`, by importers and not by the moved files. No moved path is in `SIDE_EFFECT`, `READ_ONLY` or the guard lists, but the rewrite commit edits `server/switches/auto-approve-launch.ts`, `auto-approve.ts`, `auto-dispatch.ts`, `fuel-hold.ts`, `k3-hold.ts`, `review-security.ts` and `stale-stop.ts` (tier `user` by folder, although only an import line changes, not a default, a ⚠ mode or a save path), `server/jobs/dispatch.ts` and `server/jobs/fleet-plan.ts` (flagged by folder), and `server/judges/run.ts`. So the PR body carries a "Behavior change" section (BEFORE: the same behavior at `server/proposals.ts` …; AFTER: the same behavior at `server/dispatch/…`; the switch files differ by one import path each) and the SUPERVISOR merges it.

This is a general lesson for section 7.6: a domain's tier is the highest tier among its importers' folders, and the survey commit must list them. Splitting the switch-file import edits into a separate PR does not help, because the old path would have to stay alive, which is the shim that section 7.3 rejects. If the SUPERVISOR wants P1 to land as `auto`, the alternative is decision D2 (shims), at the cost of the rename-following described there.

## 10. Risks

| Risk | Mitigation |
|---|---|
| A move PR conflicts with many in-flight FLIGHTs | Hubs are moved only when the board is quiet (7.4); pure `git mv` keeps renames followable; no shims (7.3); mechanical rewrite commit; GO AROUND resolves on the FLIGHT's side (7.5) |
| Public surface grows into "everything" (`export *`) | Explicit named list computed from real importers (9.2); un-exporting is a later cheap PR; review checks the list against the script |
| `view.ts` ends up importing I/O | R2 and R5 already fail the build; P2 splits the file instead of widening `view.ts` |
| Mount order silently changes route matching | `order` numbers from today's order; `routes.golden.txt` compares `app.routes` from the real registry; static server stays last |
| Services by string name (`service("fuelWatch")`) are untyped and hide side effects | Same trade-off the job registry accepted; tier for `server/mounts/` and `*/mount.ts` is flagged; a service-name list is part of N1 (`MountServices` type that `index.ts` fills), so a misspelled name is a type error |
| State store changes bytes or error handling | Golden-bytes test per writer kind; `onBad` keeps each reader's behavior; a writer is moved only when its output is identical |
| Config getter throws in a place that read config at import | C1 finds import-time reads first; the getter lands only after they are gone |
| Landing tier rules go stale after moves | The survey lists paths in `deploy/landing-tier.mjs`; `landing-tier.test.mjs` fails on an unlisted command-running file; a domain with listed files is tier `user` |
| Docs and READMEs point at old paths | Survey lists them; the move PR fixes them; a link-check is not added here (a possible follow-up) |
| Many small steps stall (the plan has 15) | Only N0, N1 and P1 are needed for the visible win (guarded layout, one domain, no `index.ts` edits for mounts). The rest can wait without leaving the repo worse |

## 11. Decisions

Proposed by the author (TEAM_E, 2026-10-03). A SUPERVISOR reply of "no" or a different choice on any row changes the Implementation order.

| # | Decision | Alternatives | Reason |
|---|---|---|---|
| D1 | Domain folders with a **two-door** public surface: `index.ts` (server) and `view.ts` (web-safe) | one `index.ts` only | One door would put `node:fs` in the web bundle; the web already needs pure functions from DISPATCH |
| D2 | **No re-export shims** at old paths | shims for a few weeks | A shim makes git see a modification, not a rename; in-flight edits to the old path then conflict |
| D3 | Mounts as one-file-per-mount, scanned like jobs, with `order` and a golden route list; ticks stay in `server/jobs/` | a hand-written `features.ts` list | A list is a shared line again (the hotspot ATC-393 removed); the scan pattern already exists |
| D4 | `shared/model.ts` keeps **type-only imports**, restricted to `<domain>/view.ts` (R6) | domain slices via module augmentation | Erased at run time; augmentation hides `Snapshot`'s shape and depends on the compiler's file set |
| D5 | State files through **handles** from one registry; the registry file is tier `user` | a free-form `writeJson(path)` and a documentation table | A handle makes an unregistered file a runtime error; the tier flags every format change |
| D6 | Config: pure `configOf(env, home)`, `boot.ts` as the only reader, `getConfig()` that throws | pass config to every function from day one | The getter keeps 88 importers compiling while batches migrate; throwing replaces the production fallback |
| D7 | Per-folder README module table, no generator | generate the table from code | The text is the explanation; a generator adds a failure mode |
| D8 | Domains in the order in section 7.1 (smallest fan-in first after DISPATCH) | biggest hub first | Smaller moves teach the cost before the large ones |
| D9 | `jobs/` and `switches/` stay top-level | move each job into its domain | Their tier rules and registries are folder-based; moving them changes nothing for conflicts |
| D10 | Rules are added with the PR that makes them true for one file, with the allowlist holding the rest | add all rules red at once | A red `main` blocks every team |

## 12. Not built yet

Everything in sections 3–9. Follow-ups that are not part of M21's exit criteria: a link check for docs paths (section 10), a MOVE FLIGHT kind in DISPATCH (N10), renaming files to drop the repeated word (`dispatch/dispatch.ts`), and un-exporting names that fall off the public surface.
