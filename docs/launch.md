# LAUNCH survey and feedback design (how atc starts sessions, and what the screen says about it)

Status (2026-10-01): design draft, not adopted. Written for [ATC-265](https://linear.app/vocado/issue/ATC-265/launch-survey-map-every-way-atc-starts-a-session-and-audit) from a SUPERVISOR report ("The UI does not seem to apply things when I click; it feels hidden."). Nothing here is built. Part 1 and Part 2 were read from the code at `origin/main` (head `8c30e40`, 2026-10-01); a few behaviours were also run against a 7702 test server with a fake `claude` (marked **run** below). Everything not marked **run** is from reading the code and is marked **inferred** where the reading was not enough to be sure.

Related: [fleet.md](fleet.md) (AIRCRAFT, LAUNCH, CONTROL SESSIONS), [accounts.md](accounts.md) (ACCOUNT, LAUNCH ACCOUNT), [dispatch.md](dispatch.md) (ABSENT cards, LAUNCH on approve), [control-recycle.md](control-recycle.md), [ui-visibility.md](ui-visibility.md) (the same problem for the whole screen), [guide/fleet.md](guide/fleet.md).

Open issues that overlap and are **not duplicated** here: [ATC-251](https://linear.app/vocado/issue/ATC-251/cross-account-delivery-occ-cannot-reach-aircraft-on-another-account-so) (OCC reaches only same-ACCOUNT sessions; APPLY NOW comment), [ATC-252](https://linear.app/vocado/issue/ATC-252/background-aircraft-at-non-atc-airports-stall-on-approve-entering) (STAND prompt stall), [ATC-255](https://linear.app/vocado/issue/ATC-255/control-sessions-bulk-actions-launch-all-restart-all-stop-all-account) (CONTROL bulk actions), [ATC-257](https://linear.app/vocado/issue/ATC-257/fleet-show-the-account-an-aircraft-will-launch-on-when-launch-account) (next LAUNCH ACCOUNT on screen), ATC-258 (lost comms research; not read here).

## 1. Current facts: how atc starts a session

Paths below cite `file:line`. `sc` = `server/session-control.ts`, `fp` = `server/fleet-plan-run.ts`, `prop` = `server/proposals.ts`.

### 1.1 Two launch primitives

Every `claude --bg` start goes through one of two functions. The only other session start is DUTY (`claude -p`, 1.7).

- `launchAircraft` (sc:470): FLEET LAUNCH, DISPATCH approve, FLEET PLAN steps, APPLY NOW for AIRCRAFT.
- `launchControl` (sc:521): the CONTROL SESSIONS button, RECYCLE, APPLY NOW for control, CONTROL BULK.

The command is built the same way for both (`claude()` sc:331, `launchCommandOf` sc:326):

- `systemd-run --user --scope --collect --quiet -p OOMPolicy=continue --unit=atc-claude-<ms> -- <claudeBin> <args>`. The scope is skipped when `ATC_BG_SCOPE=off` or `/usr/bin/systemd-run` is missing (sc:329); it keeps the claude daemon out of `atc.service`'s cgroup (sc:320-324).
- `execFile` with `cwd`, `env: cleanEnv(configDir)`, `timeout: 60_000`, `maxBuffer: 4<<20` (sc:334). `cleanEnv` (`server/clean-env.ts:8-15`) passes only HOME, USER, LOGNAME, LANG, LC_ALL, SHELL, TERM, XDG_RUNTIME_DIR, XDG_CONFIG_HOME and DBUS_SESSION_BUS_ADDRESS, rebuilds PATH, and sets `CLAUDE_CONFIG_DIR` only when the chosen folder is not `config.claudeDir`.
- AIRCRAFT args (sc:120): `--bg -n <TEAM_X> --permission-mode <mode> [--model <m>] <CREW BRIEFING>`; cwd is the base AIRPORT's `repo`. Control args (sc:208): `--bg -n <NAME> --permission-mode auto <flags> <prompt>`; cwd is the control folder.
- Success means exit 0 and a `backgrounded · <hex> · NAME` line (`jobIdOf` sc:309, sc:491). **run**: with a fake `claude` the launch request returned `200` in about 50 ms; the call is synchronous, so the HTTP answer already carries the result.

| Control session | Folder | Flags | First message | Source |
|---|---|---|---|---|
| TOWER | `controller/` | none | `/loop 3m /tick` | sc:167 |
| OCC | `occ/` | none | `/loop 10m /tick` | sc:168 |
| MCC | `mcc/` | `--strict-mcp-config` | `/loop 5m /tick` | sc:169 |
| CROSSCHECK | `crosscheck/` | `--strict-mcp-config` | `/loop 10m /tick` | sc:170 |
| REVIEW | `review/` | `--strict-mcp-config` | `/loop 10m /tick` | sc:171 |
| ENGINEERING | none | none | none (badge only, `launch:null`) | sc:172, sc:211 |

Every POST that starts or stops a session requires `fromThisApp` (JSON content type and a localhost Origin, `server/origin.ts:5`). **run**: a launch without Origin got `403 "이 화면에서 보낸 요청만 받습니다"`. So control sessions and `atcctl` cannot launch anything (grep finds no launch, stop or control command in `controller/atcctl.mjs`).

### 1.2 Precedence: ACCOUNT, base AIRPORT, permission mode, model, CREW BRIEFING

**ACCOUNT** is chosen by `launchAccountOf` (sc:132-151). With no registered folders the result is `null` (the default `~/.claude`, no env change). Otherwise the order is: **requested (named) > LAUNCH ACCOUNT of that kind (`fleet.json` `launchAccount.aircraft|control`) > fallback (DISPATCH only) > the AIRCRAFT's home (`fleet.json` `aircraft.<reg>.account`, or `control.<NAME>.account`) > the default folder.** A label that is no longer registered silently falls through (`??` chain sc:145; `effectiveLaunchAccount` `server/launch-account.ts:22`).

| Path | requested | LAUNCH ACCOUNT | fallback | Source |
|---|---|---|---|---|
| FLEET LAUNCH | `body.account`, sent only if the SUPERVISOR changed the picker | yes (aircraft) | none | sc:486, sc:743; `LaunchPanel.tsx:59,92` |
| DISPATCH approve, ordinary ABSENT card | none | yes (aircraft) | the last successful LAUNCH's account | `server/index.ts:181` |
| DISPATCH approve, RESUME card | the cut session's account (named, so it **beats** LAUNCH ACCOUNT) | n/a | n/a | `server/index.ts:181` |
| FLEET PLAN LAUNCH, ENTRY, RESTART, REFRESH, REPOSITION | none (steps carry no account) | yes (aircraft) | none | fp:377; `server/fleet-plan.ts:906-931` |
| FLEET PLAN ACCOUNT CHANGE | `p.account` | n/a | n/a | `fleet-plan.ts:943` |
| APPLY NOW, AIRCRAFT / control | `to` = the LAUNCH ACCOUNT | n/a | n/a | fp:572; `control-recycle-run.ts:336` |
| CONTROL RECYCLE | the session's current account | n/a | n/a | `control-recycle-run.ts:152` |
| CONTROL button | `body.account`; the screen posts `{}` | yes (control) | none | sc:531; `ControlSessions.tsx:126` |

Two consequences (**inferred** from the steps carrying no account): a RESTART or REPOSITION relaunch does not reuse the account the session was on, it takes LAUNCH ACCOUNT then home; RECYCLE does reuse the current account.

**Base AIRPORT and cwd.** `a.base = profile.base ?? codeOf(live session's repo)` (`server/fleet.ts:370`); the cwd is that AIRPORT's `repo` (sc:475). REPOSITION writes `base` between STOP and LAUNCH (fp:381-390). **run**: removing `base` from a profile did not refuse the launch while the snapshot still held a live session of that AIRCRAFT in its repo (the fallback). The no-base refusal (1.4) therefore only fires for an AIRCRAFT with no profile base **and** no live session; this is the SUPERVISOR's TEAM_A-D case, read from code, not re-run.

**Permission mode and model.**

| Path | Source | Default | Source |
|---|---|---|---|
| FLEET LAUNCH | the form | `auto`, no `--model` | `LaunchPanel.tsx:42-43`; sc:116-118 |
| DISPATCH approve | the last successful LAUNCH in FLIGHT RECORDER (14 days) | `auto`, none | `absent-run.ts:17,38`; `index.ts:181` |
| FLEET PLAN LAUNCH, ENTRY | the approve form | `auto`, none | `fleet-plan.ts:869-877` |
| FLEET PLAN RESTART, REFRESH, ACCOUNT CHANGE, REPOSITION | form, then last launch (30 days), then default | `auto`, none | `fleet-plan.ts:869-877`; fp:482 |
| APPLY NOW, AIRCRAFT | last launch (30 days) | `auto`, none | fp:569-575 |
| Control sessions | fixed | `auto`, none | sc:208 |

Allowed modes are `auto`, `acceptEdits`, `default` (sc:31); `bypassPermissions` is deliberately absent. Model must match `/^[\w.:[\]-]+$/` (sc:119).

**CREW BRIEFING.** AIRCRAFT launches always use `crewBriefing(a, repo, cfg.mode, true)` (sc:488, `fleet.ts:467`); the `true` adds the STAND paragraph (`fleet.ts:459`, ATC-252). There is no per-launch override. The DISPATCH FLIGHT PLAN is not part of the launch prompt: OCC sends it after the session appears (`dispatch-launch.ts:12`). The comment at prop:505-507 ("LAUNCH가 FLIGHT PLAN을 첫 프롬프트로 가져가므로") says otherwise and looks stale.

### 1.3 The paths

| # | Path | Trigger and screen | Route | Calls | Source |
|---|---|---|---|---|---|
| 1 | FLEET LAUNCH | AIRCRAFT row expanded → card **LAUNCH** → LaunchPanel (mode, model, ACCOUNT) → submit | `POST /api/fleet/:reg/launch` (sc:739) | `launchAircraft(…, "SUPERVISOR")` | `Card.tsx:336-340`; `LaunchPanel.tsx:7-120` |
| 2 | DISPATCH approve with LAUNCH | DISPATCH card with `launch:true`; approval mode and screen Origin required | `POST /api/dispatch/proposals/:id/approve` (prop:1266) | `approveLaunch` → `launchAircraft(…, proposalId)` | `dispatch-launch.ts:238-262`; `index.ts:171-182` |
| 3 | RESUME after LIMIT | same as 2, on a RESUME card | same | same, with the cut account named | `dispatch-launch.ts:280-318` |
| 4 | APPLY NOW | Settings → ACCOUNTS (and a compact button in the FLEET header) | `GET/POST /api/fleet/apply-now`, `DELETE …/pending` | `moveAircraftAccount`, `applyNowControl` (STOP then LAUNCH) | `apply-now-run.ts:141-182` |
| 5 | FLEET PLAN approval | FLEET tab, FLEET PLAN card with ApproveForm | `POST /api/fleet/plan/:id/approve` (fp:453) | `runApproval` → `runStep` | fp:339-410, 460-557 |
| 6 | REPOSITION | a FLEET PLAN card; also automatic when `reposition=auto` | same, or in-process `autoRun` (`who:"auto"`) | stop, base, launch | `fleet-plan.ts:945-953`; fp:232, 271, 417 |
| 7 | CONTROL LAUNCH / STOP | FLEET → CONTROL SESSIONS row (expanded) | `POST /api/control/:name/launch\|stop` (sc:662, 669) | `launchControl`, `stopControl` | `ControlSessions.tsx:126` |
| 8 | CONTROL RECYCLE | automatic, 60 s tick; default mode `off` | none | `performRecycle`: STOP, wait up to 15 s, LAUNCH | `index.ts:238-243`; `control-recycle-run.ts:152-181` |
| 9 | CONTROL BULK | CONTROL group bulk panel | `GET/POST /api/control/bulk` | `launchControl`; restart and align call `applyNowControl` | `control-bulk-run.ts:132-156` |
| 10 | DUTY | Settings DUTY switch, then the DUTY drawer message box | `POST /api/duty/message\|stop\|new-shift` | `claude -p` (stream-json), not `--bg` | `duty-run.ts:241-254, 366-398` |
| 11 | ENTRY INTO SERVICE | FLEET EntryForm | `POST /api/fleet` (`fleet.ts:536`) | **never launches**: writes the profile, then shows the CREW BRIEFING to paste by hand | `EntryForm.tsx:24`; `Fleet.tsx:120-130` |
| 12 | `atcctl` | CLI | n/a | no launch, stop or control command | `controller/atcctl.mjs` |

Notes.

- **2:** if the AIRCRAFT already has a live session only the approve op is written (`dispatch-launch.ts:247`). A launch failure writes a `launch` op (ok:false) and a `supersede` op `LAUNCH 실패 — <error>` and returns 502.
- **4:** a move is STOP then LAUNCH, one session at a time, re-planned each time, stopping at the first failure (`apply-now-run.ts:111-127`). Rows that are `after-flight` or `wait-safe` wait in `apply-now.json` for up to 24 h and are retried by the 60 s tick (`apply-now.ts:123`, `apply-now-run.ts:184-209`). The pending ends silently after 24 h or when the LAUNCH ACCOUNT changes (a FLIGHT RECORDER note only, `apply-now-run.ts:190-193`). There is no force option for AIRCRAFT; for control sessions only CONTROL BULK's "안전 조건을 알고도 진행" passes safety blocks (`control-bulk.ts:115-120`).
- **5:** the planner runs on the DISPATCH cycle and only when the snapshot is warm and Linear and GitHub are fetched (fp:253). Approval re-checks that the latest cycle still emits the card and is under `STALE_MS = 10 min` old (`fleet-plan.ts:839, 853`). After a successful STOP, a failing LAUNCH leaves the AIRCRAFT stopped (steps stop at the first failure); ACCOUNT CHANGE and REPOSITION check the target ACCOUNT **before** STOP (fp:477-500).
- **6:** the only path that can launch without a SUPERVISOR click, under `repositionDailyMax` (default 4) and a flapping guard that falls back to `approval`.
- **8:** one session per cycle (`control-recycle-run.ts:290`).
- **10:** `claude -p` is invisible to `claude agents` and does not count against the cap (from code; not run). Its ACCOUNT is `duty.json` `account` via `effectiveDutyFolder`; `--resume` only on the same account (`duty-account.ts:22`).

### 1.4 Refusals (exact text)

`launchAircraft` (sc:470-): checks run in this order; login and FUEL hold come first, inside `launchAccountOf`.

| Condition | Status | Text | Source |
|---|---|---|---|
| ACCOUNT label syntax | 400 | `ACCOUNT는 등록부의 라벨(소문자·숫자·-)` | sc:140 |
| ACCOUNT not registered | 404 | `등록되지 않은 ACCOUNT: <l> (등록: …)` (**run**) | sc:146 |
| Registry empty, ACCOUNT named | 409 | `ACCOUNT 등록부가 비어 있음 — 설정 창 AGENTS 탭의 ACCOUNTS에서 먼저 등록한다` (stale tab name, see 2.4) | sc:136 |
| ACCOUNT not logged in (`loggedIn === false`; `null` = unknown is not blocked) | 409 | `ACCOUNT <l>는 로그인되어 있지 않음 — SUPERVISOR가 그 폴더에서 claude auth login을 한다` | sc:148 |
| ACCOUNT at FUEL hold | 409 | `ACCOUNT <l>는 FUEL hold 수준: FUEL 사용 <pct>% until <HH:MM>Z` | sc:149, 436 |
| Not in FLEET | 404 | `FLEET에 없음: <reg>` (**run**) | sc:474 |
| RETIRED | 409 | `<reg>는 RETIRED — 먼저 복귀시킨다` | sc:105 |
| No base repo | 409 | `<reg>의 base AIRPORT 저장소를 모름 — 프로필에서 base를 정한다` (there is no screen for that, 2.1 obs 1) | sc:106 |
| Name already live | 409 | `<reg> 세션이 이미 떠 있음(bg <id> \| interactive)` | sc:107-108 |
| Global cap | 409 | `백그라운드 세션 <n>개 — 상한 <max>(ATC_MAX_LAUNCHED) · <holders>` | sc:109-110 |
| Per-ACCOUNT cap (`maxLaunched`) | 409 | `ACCOUNT <l>의 백그라운드 세션 <n>개 — 상한 <max>(등록부 maxLaunched)` | sc:112-115 |
| Bad mode / bad model | 400 | `permission mode는 auto \| acceptEdits \| default` / `모델 이름이 이상함: <m>` | sc:117, 119 |
| Folder not trusted | 502 | `<cwd>를 신뢰하지 않음 — 그 폴더에서 claude를 한 번 열어 trust를 수락한다` (**run**: only after `claude --bg` itself failed with "not trusted") | sc:492 |
| ACCOUNT's session list unreadable | 502 | `ACCOUNT <l>의 세션 목록을 읽지 못함 — 이미 떠 있는지 몰라 띄우지 않는다` | sc:487 |

- The global cap counts live non-control `background` rows including "그 밖" sessions of any name, and excludes STALE rows (`liveRowsOf` sc:104). The default is `Number(process.env.ATC_MAX_LAUNCHED) || 6`, read once at module load (sc:36). **run**: the test server (same `.env.local`) reported `max: 20`, so the real value comes from the env file.
- `launchAircraft` has **no AOG check**; AOG only stops DISPATCH from making a card (`dispatch.ts:608-611`), APPLY NOW and REPOSITION.
- A pre-launch refusal is written to FLIGHT RECORDER only when the launch came from a DISPATCH card (sc:498).
- `launchControl` (sc:521) has the ACCOUNT refusals and "already live" (matched by name **or** working folder, sc:201), `관제 세션이 아님`, and `ENGINEERING: 배지만`. It does **not** check the global cap.
- DISPATCH approve adds: 409 `승인·거절은 approval 모드(2b)에서만`; 403 `LAUNCH 카드는 SUPERVISOR가 화면에서 승인한다`; 409 cap `LAUNCH 대기 — 백그라운드 <n> + 승인된 LAUNCH <p> / 상한 <max>(ATC_MAX_LAUNCHED) …` (nothing is written, `dispatch-launch.ts:245`).
- A card exists only if none of these hold (`dispatch.ts:602-648`): AOG, limit cut before reset (`HOLD · LIMIT`), a recent "already live" rejection whose job still exists (`LAUNCH 막힘 — bg <id>가 아직 목록에 남아 있음`, ATC-213), a RESUME card pending, account hold, FUEL hold, an unfinished In-Progress FLIGHT, or no AIRPORT.
- RESUME rules: a RESUME card exists only for an **absent** background AIRCRAFT whose last turn was cut by a usage limit with no new turn since (`dispatch-launch.ts:83-95`), reset passed (`:292`; unknown reset counts as passed after `LIMIT_WINDOW_MS`, `absent-run.ts:141`), an open FLIGHT, one card per cut (`:321`). It launches on the same ACCOUNT that was cut.
- FLEET PLAN texts (`fleet-plan.ts:862-973`): `그림자 운용 중 — 승인 운용을 켜야 실행한다`, `조건이 바뀜 — 최근 주기가 이 제안을 더는 내지 않는다. 다음 주기를 기다린다`, `<reg>가 FLIGHT 중(…) — 살아 있는 FLIGHT는 옮기지 않는다`, `<reg>는 멈추지 않았다` on a pre-STOP refusal.
- APPLY NOW skip reasons (`apply-now.ts:62-117`): desktop/terminal session (cannot be moved), AOG, `FLIGHT 중(…)`, `열린 PR이 있음`, `이번 계획에서 FLIGHT를 받음`, `방금 LAUNCH함(minDwell 안)`, `한도로 잘린 턴`, target-ACCOUNT refusals, `안전한 순간이 아님: …` for control sessions.

### 1.5 What is written

| Writer | Store | Content | Source |
|---|---|---|---|
| `launchAircraft` / `launchControl` / stop | FLIGHT RECORDER `flight-recorder/YYYY-MM-DD.jsonl` | `{kind:"fleet"\|"control", op:"launch"\|"stop", aircraft\|session, by, ok, jobId, cwd, permissionMode, model, account, error?, proposal?}` (**run**: one `fleet launch` line per launch) | sc:493, 513, 538, 567 |
| DISPATCH approve | `proposals.jsonl` | ops `approve`, `launch`, and on failure `supersede` | prop:100; `dispatch-launch.ts:246-260` |
| FLEET PLAN | `fleet-plan.jsonl`, `fleet-plan.json`, recorder `account-change`, `reposition` (with `stage`) | | fp:56, 85-126, 535-545 |
| ENTRY, REPOSITION base, LAUNCH ACCOUNT | `fleet.json` (atomic) | profile, `launchAccount` | `fleet.ts:87, 128`; fp:381 |
| APPLY NOW | `apply-now.json`; recorder `apply-now`, `pending-end` | counts | `apply-now-run.ts:33, 138, 179` |
| RECYCLE, BULK | recorder `{kind:"control", op:"recycle"\|"bulk"}` | result `recycled`, `stop-failed`, `launch-failed`, `stop-unconfirmed` | `control-recycle-run.ts:152-181` |

atc never writes Claude Code's own job or session files; it only reads them.

### 1.6 When the screen shows the new state

| Cache or poll | Value | Source |
|---|---|---|
| Snapshot tick; SSE `snapshot` only when it changed | `TICK_MS` 2 s | `index.ts:69, 152-156` |
| Session list inside the snapshot | read from `sessions/*.json` of each registered folder plus a pid-alive check; **not** `claude agents`, so a launched session appears when Claude writes its session file | `sources/claude.ts:68-100` |
| `refreshKey` for FLEET, FLEET PLAN, DISPATCH brief, APPLY NOW, launch-accounts | `snapshot.at.slice(0,16)`: changes once a minute (this is the "FLEET poll") | `App.tsx:293`; `Fleet.tsx:96-98`; `Dispatch.tsx:296-321` |
| `claude agents --json` cache | `AGENTS_TTL_MS` 30 s, used **only** by `GET /api/control/sessions`; `?fresh=1` bypasses | `agents-cache.ts:3-23`; sc:426, 618 |
| LAUNCH, STOP and plan decisions | always a fresh `agentRows()` | sc:481, 510, 685-693 |
| CONTROL group and header strip poll | `CONTROL_POLL_MS` 60 s, visible tab only; `fresh` after a button press | `control-view.ts:17`; `ControlSessions.tsx:101-105, 132` |
| DISPATCH planner and FLEET PLAN cycle | `DISPATCH_MS` 5 min, when warm | prop:109; `index.ts:127-131` |
| Absent set | rebuilt per snapshot; the FLIGHT RECORDER launch scan is cached 60 s (`LAUNCH_TTL_MS`); misses of the transcript path cache 10 min | `absent-run.ts:18-19, 50`; `snapshot.ts:187` |
| ACCOUNT login status; registry file | 60 s; 5 s | `account-health.ts:64`; `accounts.ts:76` |
| RECYCLE and pending APPLY NOW | 60 s tick | `index.ts:238-244` |
| OCC delivery of an approved FLIGHT PLAN | OCC's own `/loop 10m /tick` (inferred from the loop line; the OCC side was not traced) | sc:168 |
| Approved launch card closes as `LAUNCH 실패 — LAUNCH 뒤 <n>분 동안 새 세션이 뜨지 않음` | after the restart grace (`DEFAULT_RESTART_GRACE_MIN` 30 in `restarting.ts:9`, if `dispatch.json` does not override) | prop:661 |

**run** (fake `claude agents`, 2 registered folders): `GET /api/control/sessions` called `claude agents` once per folder on a cold cache, 0 times on the second call within 30 s, and again with `?fresh=1`; `GET /api/fleet/sessions` called it 4 times (twice per folder, uncached, sc:688 and 693); a launch called it twice and **did not invalidate the control cache**: the next `GET /api/control/sessions` right after the launch still returned the cached list. The screen avoids this only because its own button handlers pass `fresh=1`.

Worst case from click to a new AIRCRAFT showing as running in the list: the HTTP answer is immediate (about 50 ms with a fake `claude`; a real `claude --bg` takes the daemon's start time inside the same request, timeout 60 s), the LaunchPanel closes and refetches at once, but the AIRCRAFT row's status comes from the snapshot, which needs Claude to write the session file plus up to one 2 s tick; any panel keyed on `refreshKey` (FLEET PLAN, DISPATCH brief, APPLY NOW state) can lag up to 60 s; a DISPATCH card moves from approved to sent only after OCC's next tick (up to about 10 min, inferred); a new planner decision (a card appearing or disappearing) can take 5 min.

### 1.7 Absent versus never launched; why an approved card stays approved

**Absent** (`absentOf` `dispatch-launch.ts:120-142`, built by `readAbsent` `absent-run.ts:119`) comes only from FLIGHT RECORDER: the last **successful** atc `fleet launch` per REGISTRATION within **14 days** (`LAUNCH_DAYS`, `absent-run.ts:17, 31-39`), for an AIRCRAFT with no live session, not RESTARTING, registered and not RETIRED. Therefore an AIRCRAFT that atc never launched (or last launched more than 14 days ago, or that was started by hand on desktop or terminal) is **never** absent and gets no LAUNCH card; a FLIGHT tailed to it sits as `no-tail`. This is the SUPERVISOR's observation 2.

**Why an approved card whose session ended stays `approved`** (read from the code, not run):

- `launch` is written once at card creation from the plan AIRCRAFT at that moment (prop:707, 712, 721) and no later op sets it.
- The approved-card handling in `syncOps` (prop:656-668) re-checks absence only through `launchTimedOut` and `launchMissing`, and both require `p.launch` (`dispatch-launch.ts:223-231`). A card created while the AIRCRAFT was live has `launch` unset, so neither check fires.
- Such a card then falls to `stillValid`, which holds while `canTakeNow` holds, and an absent AIRCRAFT is `available: true` (`dispatch.ts:600-648`). The card stays approved.
- OCC's release refuses with `AIRCRAFT 세션 없음 — 보내지 않음 (LAUNCH 필요)` (prop:148, 506-511, 1305-1306). That text goes to the OCC caller; **no string in `web/` renders it** (grep).
- Approve on a card with `launch` unset never launches (`if (name === "approve" && p.launch)`, prop:1266).
- The card closes after 24 h (`승인 뒤 24시간 동안 전달되지 않음`, prop:658) or when `canTakeNow` becomes false (AOG, cut, hold).
- Unsure: a `launch:true` card that launched, whose new session died again before OCC sent the plan, would be superseded with the misleading `LAUNCH 뒤 N분 동안 새 세션이 뜨지 않음` once the grace passes (not traced).

## 2. Current facts: SUPERVISOR actions and what the screen says

Not audited: FleetCrew, Checkride, Fuel blocks, BriefingPanel, the Alerts/Landing/Server settings beyond their row mechanics, and DISPATCH's BriefsPanel, ATFM and Following.

"Where an error shows" is the part the SUPERVISOR feels: errors from FLEET and DISPATCH actions mostly land in one `fl-error` / `dp-error` line **at the top of the tab**, not at the click spot, and on a long page or inside an expanded row they are out of sight. The exceptions that show the error locally are LaunchPanel, FLEET PLAN, the settings EditRow, LOGIN and APPLY NOW.

### 2.1 FLEET

| Control | Route | Takes effect | During the wait and after | Error shows |
|---|---|---|---|---|
| Row click | none | UI only | `aria-expanded` (`StatusList.tsx:32`). **Every card button is inside the expanded row** (`StatusList.tsx:38-42, 101`). | n/a |
| Card **LAUNCH** (opens panel) | none until submit | UI only | Shown only when `session === null`; if `/api/fleet/sessions` failed, `session` is `undefined` and the button disappears (`Card.tsx:336-340`; `Fleet.tsx:88-94, 207, 264`). | n/a |
| LaunchPanel submit | `POST /api/fleet/:reg/launch` | immediate and synchronous | button `띄우는 중…`; success closes the panel and `load()` (`LaunchPanel.tsx:114-116`, `Fleet.tsx:148-150`). The AIRCRAFT's STATUS lags (1.6). | in the panel (`fl-error` role=alert, `LaunchPanel.tsx:105-109`); refused ACCOUNTs are greyed with the reason and submit is disabled (`:94, 102, 116`) |
| LaunchPanel ACCOUNT picker | `GET /api/fleet/launch-accounts` | per launch | marks `(home)` and `(LAUNCH ACCOUNT)` (`:96-97`); hidden if the registry is empty (`:89`) | a failed fetch is swallowed (`.catch(()=>{})`, `:37`): the picker silently disappears |
| Card STOP | `POST /api/fleet/:reg/stop` | immediate | `confirm()`; **no busy or disabled state**, double click possible (`Fleet.tsx:157-166`) | page-top only |
| ATTACH 복사 | clipboard | n/a | `복사됨` for 1.5 s | clipboard failure swallowed (`Card.tsx:372-374`) |
| CREW BRIEFING | `GET /api/fleet/:reg/briefing` | immediate | panel under the card | page-top |
| AOG / AOG 해제 | `PATCH /api/fleet/:reg` | file write now; DISPATCH sees it at the next planner run (`dispatch.ts:609`) | two native `prompt()` dialogs, no pending text | page-top |
| 퇴역 / 복귀 | `PATCH {retired}` + optional STOP | now | `prompt()` then `confirm()` | page-top |
| 고치기 → Editor 저장 | `PATCH /api/fleet/:reg` | file write now | **no busy state**; `onSave` is not awaited (`Editor.tsx:41, 162`); does **not** edit base AIRPORT | page-top; the Editor stays open and the message is above the list |
| ENTRY INTO SERVICE | `POST /api/fleet` | now; **does not launch** | collapsed toggle; no busy state (`EntryForm.tsx:16, 22-25`) | page-top |
| FLEET PLAN mode switch | `POST /api/fleet/plan/mode` | now; cards appear at the next 5 min run | `confirm()`, disabled while busy (`FleetPlan.tsx:151-156, 189-200`) | section-local |
| FLEET PLAN 동의/반대 | `POST …/verdict` | recorded now; an agree is refused 409 in approval mode (fp:446) | row buttons disabled while busy | section-local |
| FLEET PLAN 승인 | `POST …/approve` | immediate, synchronous; disabled when `p.stale` (`FleetPlan.tsx:271`) | `실행하는 중…`, row note `실행 중…` (`:398, 246`) | section-local, form closes only on success |
| ABSENT chip | none | display | `absent · LAUNCH on approve` or `RESUME after LIMIT · reset hh:mmZ` (`Absent.tsx:15-31`) | n/a |
| CONTROL row LAUNCH / STOP | `POST /api/control/:name/launch\|stop` | immediate; tmux STOP asks `confirm()` (`ControlSessions.tsx:122`) | all row buttons disabled while **any** action is busy, no text change (`:220, 224`); `load(true)` after | **group-level** line at the top of the CONTROL group (`:127, 294`), not on the row; the row's `launchOff` reason is inline (`:230`) |
| CONTROL ACCOUNT label (EditRow) | `PUT /api/control/:name/account` | written now; counts for FUEL now; used by the next LAUNCH only when no control LAUNCH ACCOUNT is set (sc:145) | `저장 중`, then closes (`SettingsServer.tsx:233-242`) | inline under the row |
| OTHER BACKGROUND STOP | `POST /api/control/others/:id/stop` | immediate | `confirm()`, disabled while busy | group-level |
| CONTROL BULK | `GET/POST /api/control/bulk` | immediate, one session at a time | preview, then `실행 중…`; result table; held rows need the "force" box (`ControlBulk.tsx:75-126`) | panel-local |

### 2.2 DISPATCH (`web/src/views/Dispatch.tsx`)

| Control | Route | Takes effect | During the wait and after | Error shows |
|---|---|---|---|---|
| 승인 (approval mode) | `POST /api/dispatch/proposals/:id/approve` | decision recorded now; OCC sends the FLIGHT PLAN on its next tick (about 10 min, inferred) | `confirm()` for ASSIGN; the card's buttons are disabled while `busy` with **no text change** (`:332-337, 1518`); then refetch moves the card to the in-flight table | top of the tab (`dp-error`, `:436-440`) |
| 승인 on a launch card | same; `approveLaunch` | synchronous: approve is written, then `launchAircraft`; cap full is 409 with the reason | same confirm and busy; card text `absent · LAUNCH on approve · next LAUNCH <acct>` | top of the tab; on failure the card closes and reloads into RECENT, its `LAUNCH 실패` line is on the card (`:343-346, 919-922`) |
| 승인했을 것 / 거절했을 것 (shadow) | `POST …/verdict` | record only; nothing is sent | same busy | top |
| 거절… | `…/reject` or `…/verdict` | now | inline RejectForm; "폼을 그대로 둔다(오류는 위에)" (`:1427`) | top; the form stays open and the message can be out of sight |
| CROSSCHECK 동의, 동의 묶음 | same | same | same | top |
| HELD: 대기열로 / FLIGHT 보류 확정 | `…/requeue\|confirm-hold` | now | busy disables | top |
| RECALL… | `…/recall` | recorded now; in approval mode OCC sends the RECALL, in shadow atc sends nothing and the SUPERVISOR tells the CAPTAIN (`:357-358`) | inline form + `confirm()` | top |
| 2b 켜기 / 2a로 | `POST /api/dispatch/mode` | now | `confirm()`; **no busy state** (`:387-401, 432`) | top |
| LAUNCH slot chip | none | display | rendered only when `pending>0` or `full` (`:457-464`) | n/a |

### 2.3 Settings window and NEEDS YOU

Tabs: 화면, LINEAR, AGENTS, ACCOUNTS, 알림, LANDING, OPERATIONS (`SettingsPanel.tsx:12-19`).

| Control | Route | Takes effect | Feedback |
|---|---|---|---|
| ACCOUNTS registry rows, 저장 (incl. per-ACCOUNT `maxLaunched`) | `PUT /api/accounts` | now; next LAUNCH | disabled until dirty or saving; error inline (`SettingsAccounts.tsx:77, 136, 149`) |
| ADD ACCOUNT, LOGIN, SHARE MEMORY | `/api/accounts/*` | now; after LOGIN the server marks onboarding and AIRPORT trust (`account-login.ts:183-192`) | `만드는 중…`, `시작하는 중…`; errors inline. LOGIN shows only for registered folders with `loggedIn === false` (`:110`). |
| LAUNCH ACCOUNT selects | `PUT /api/fleet/launch-account` | saved now; **next** LAUNCH that names no ACCOUNT; also DISPATCH launch cards, FLEET PLAN ACCOUNT CHANGE and ENTRY | select disabled while saving; refused ACCOUNTs disabled; the whole block is hidden when the registry is empty (`:464`); error at the block bottom. After ATC-257: FLEET shows `next LAUNCH` per AIRCRAFT. |
| APPLY NOW | `GET/POST/DELETE /api/fleet/apply-now` | see observation 5 | `읽는 중…`, confirm `옮기는 중…(세션마다 한 번에 하나)` (`ApplyNow.tsx:110-166`) |
| AUTOMATION switches (LANDING, OPERATIONS) | `PUT /api/settings` | written to `.env.local` and live **without a restart** (`SettingsServer.tsx:8, 468`); each consumer then acts on its own cycle (RECYCLE and pending APPLY 60 s, planner 5 min) | `저장 중`; ⚠ modes need a confirm step; error under the row |
| DUTY ACCOUNT | `PUT /api/settings {dutyAccount}` | next DUTY message | select disabled while busy; hint says "AGENTS 탭의 LAUNCH ACCOUNT" (`SettingsAutomation.tsx:367`) |
| AGENTS tab | `PUT /api/settings` | now | the CONTROL block is **only a link** to `#fleet/control` plus a hint (`SettingsServer.tsx:134-138`); STAND TTL, HANDOFF and AIRPORT folder are real settings |

**NEEDS YOU** renders text only (`ui.tsx:77-86`): `NEEDS YOU · <needs>`, a tooltip that says to `claude attach <id>`, no server route. On an AIRCRAFT card (expanded row only) it adds the job detail, a copy-only `SuggestedReply` (`ui.tsx:116-129`) and `ATTACH 복사` (`Card.tsx:341, 365-380`). In the collapsed row (`StatusList.tsx:138`) and in CONTROL rows (`ControlSessions.tsx:330`) there is only the chip. No server route sends an answer into a session (grep).

### 2.4 The ten observations, verified or corrected

| # | SUPERVISOR observation | Verdict | Evidence |
|---|---|---|---|
| 1 | No base AIRPORT on the card | **Confirmed.** | `Editor.tsx:19-29, 34-49` has crew, rating, route, targets, ACCOUNT, note; base is set only in EntryForm (`:49-58`), or through an approved REPOSITION (`FleetPlan.tsx:51`; the card then shows `← from`, `Card.tsx:51-59`). `PATCH /api/fleet/:reg` accepts `base` (`fleet.ts:210-213`) — **run**: it worked and no screen sends it. Without a profile base the fallback is the live session's repo (`fleet.ts:370`), so the refusal appears only for an AIRCRAFT with no base and no session. |
| 2 | Never-launched AIRCRAFT are not DISPATCH candidates | **Confirmed**, exactly as 1.7. The card says only `세션이 없음 — LAUNCH로 띄우거나…` (`Card.tsx:230`). | `dispatch-launch.ts:15, 120-142`; `dispatch.ts:600-607` |
| 3 | Trust error after the click, no precheck, no fix | **Confirmed.** | The `/not trusted/i` match runs only after `claude --bg` fails (sc:492, 537) — **run**. The precheck `launchAccountRefusal` covers login, FUEL hold and the ACCOUNT cap only (sc:445-453, 718). The only trust marking is `markOnboarded` after a settings LOGIN of a registered folder (`account-login.ts:189-192`); the default `~/.claude` gets none. There is no trust button. Where it shows: LaunchPanel (local), DISPATCH top line then the card's `LAUNCH 실패`, CONTROL group line. |
| 4 | LAUNCH ACCOUNT does not show in FLEET; TOWER keeps its own override | **Part wrong, part confirmed.** | FLEET already shows chips `LAUNCH ACCOUNT x` and `관제 세션 LAUNCH ACCOUNT y` when set (`Fleet.tsx:247-254`); with ATC-257 rows and cards show `next LAUNCH` and DISPATCH launch cards too. CONTROL rows have **no** next-LAUNCH note, and a per-session `control.<NAME>.account` is overridden for the next LAUNCH when a control LAUNCH ACCOUNT is set (sc:145, 531; `control-bulk.ts:49`); the label editor speaks only of FUEL (`ControlSessions.tsx:200-206`). The bulk preview shows `intended` and `drift` (`ControlBulk.tsx:96, 112`). |
| 5 | APPLY NOW waits at `wait-safe`, no way through | **Mostly confirmed.** | Reasons are shown per row (`apply-now.ts:111-112`). It is not a dead end: waiting rows become a pending APPLY retried every 60 s for 24 h and cancelable (`ApplyNow.tsx:113-121`). But it ends silently after 24 h or on a setting change (recorder note only, `apply-now-run.ts:190-193`); a failure stops the run and is not auto-continued (`:200-204`); there is **no force path for AIRCRAFT** (`after-flight` resolves only when idle with no FLIGHT, PR, assignment or recent LAUNCH, `apply-now.ts:82-86`), and for control only BULK's force box; the pending-poll failure is swallowed (`ApplyNow.tsx:54-62`). |
| 6 | Approved card whose session ended stays approved, no "needs LAUNCH"; `launch:false` never re-checked | **Largely confirmed** (code reading). | 1.7. The only text is `AIRCRAFT 세션 없음 — 보내지 않음 (LAUNCH 필요)`, returned to OCC and never rendered in `web/`. `waitingOf` produces text only for RESTARTING, LAUNCHING and ACCOUNT mismatch (prop:526-539). There is no button to relaunch from such a card. |
| 7 | NEEDS YOU has no UI path | **Confirmed**, with additions. | 2.3: copy-only attach and copy-only reply, hidden inside the expanded AIRCRAFT card; CONTROL rows have neither. Control sessions run `--permission-mode auto` fixed (sc:208). |
| 8 | Launch cap in an env file | **Confirmed for the machine-wide cap; the per-ACCOUNT cap is already in settings.** | `MAX_LAUNCHED` is read once at load (sc:36) and appears in no settings UI. It shows in the LaunchPanel line `백그라운드 세션 n/max`, the DISPATCH chip (only when pending or full), refusals, and the OTHER BACKGROUND note. `maxLaunched` per ACCOUNT is editable (`SettingsAccounts.tsx:136`). **run**: the test server showed `max: 20` from the env file, not the code default 6. |
| 9 | Nothing visibly happens after a click | **Part wrong.** | Pending states exist for FLEET LAUNCH, FLEET PLAN approve and mode, BULK, APPLY NOW, EditRow, LOGIN, ADD ACCOUNT, DISPATCH per-card `busy` (buttons disabled, label unchanged). They are missing for FLEET STOP, Editor save, AOG, 퇴역, ENTRY, DISPATCH mode switch. There are no optimistic updates anywhere: every action refetches. The real gap is the one in 1.6: the action result is immediate but the **downstream** state (STATUS, DISPATCH card sent, planner decision) arrives on 2 s, 60 s, about 10 min or 5 min cycles with no "pending until …" text. |
| 10 | Actions are hidden | **Mostly confirmed.** | LAUNCH is row expand, LAUNCH, panel, submit; STOP, AOG, 퇴역, 고치기 and CREW BRIEFING are also inside the expanded card (`StatusList.tsx:38-42`; `Card.tsx:336-340`). The CONTROL group is below the AIRCRAFT list and FLEET PLAN (`Fleet.tsx:277-303`), with its actions in expanded rows (`ControlSessions.tsx:216-251`) and a `#fleet/control` deep link. The AGENTS tab's CONTROL block is only a link. Stale wording: sc:136 and `SettingsAutomation.tsx:367` say the ACCOUNTS block is in the AGENTS tab, but it is in ACCOUNTS (`SettingsPanel.tsx:15, 191`). STALE chips exist (`Card.tsx:183-187`; `ControlSessions.tsx:242-248`) plus a recovery banner when all control sessions are down (`:296`); how long non-STALE rows linger after a reboot was not verified. |

### 2.5 New findings (not in the ten)

- **A launch does not invalidate the 30 s `claude agents` cache** used by `GET /api/control/sessions` (**run**, 1.6). Only the screen's own handlers avoid it with `fresh=1`; any other reader sees the old list for up to 30 s.
- **`GET /api/fleet/sessions` runs `claude agents` twice per folder on each FLEET load** (sc:688 and 693, **run**: 4 calls with two folders), uncached. FLEET reloads on every minute tick and after each action.
- **A refused AIRCRAFT launch from a FLEET PLAN step or APPLY NOW can leave the AIRCRAFT stopped** (steps stop at the first failure; ACCOUNT CHANGE and REPOSITION pre-check the target to avoid it, a plain RESTART does not), and the failure text is shown only in the FLEET PLAN section.
- **`launchAircraft` has no AOG check.** DISPATCH (no card), APPLY NOW and REPOSITION skip an AOG AIRCRAFT, but FLEET LAUNCH launches it without any warning.
- **`launchControl` does not count against the global cap**, `launchAircraft` does; the cap text names an env variable the SUPERVISOR cannot see in any screen.
- **A pre-launch refusal (cap, no base, login, FUEL hold) shows only on the screen that clicked**: the recorder keeps it only for DISPATCH launches (sc:498). A `claude --bg` that itself fails (for example the trust error) is recorded with `ok:false`.
- Stale text: sc:136, `SettingsAutomation.tsx:367`, `SettingsAccounts.tsx:10` (AGENTS vs ACCOUNTS tab); prop:505-507 (FLIGHT PLAN as first prompt).

## 3. Principles (to argue for)

1. **Every click shows an immediate result or a visible "pending until …" with the reason.** For synchronous actions the result is in the answer; for downstream state (STATUS, DISPATCH card sent, planner decision) the card says what it waits for and roughly when (`waiting for OCC's next tick`, `next planner run in ~3 min`).
2. **A refusal is predicted before the click wherever atc already knows the reason.** Cap, ACCOUNT login or FUEL hold, no base, retired and already-live are all known before the POST; trust is knowable by reading the folder's Claude Code trust file (a read, not a launch).
3. **Errors appear where the click was**, not in a line at the top of a long tab.
4. **No setting that matters only in an env file.** The machine-wide launch cap is the case; settings that are already live without restart (AUTOMATION switches) are the model.
5. **No SUPERVISOR task that needs a terminal when atc can do it safely**: set a base, accept trust for a folder atc itself launches into, answer a permission prompt. (Pasting `claude attach` stays as the fallback.)
6. **Same words in one place:** the AIRCRAFT and the CONTROL group should say `next LAUNCH` the same way (ATC-257), and the ACCOUNT block lives in ACCOUNTS everywhere it is named.
7. **Do not widen what a click can do.** Each fix below changes what the screen says or predicts. A new action (accept trust, answer a prompt) is a separate, explicit button with its own confirm, and the guard and same-origin rules stay as they are.

## 4. Implementation order (the ranked fix list)

Tier follows the changed paths (`deploy/landing-tier.mjs`): screen-only changes are `auto`; server code with an external side effect (writes a trust file, sends keys to a session) is `flagged`. Sizes: S under a day, M a day or two, L more. Each item says what it overlaps.

| # | Fix | Tier | Size | Overlap |
|---|---|---|---|---|
| 1 | **Base AIRPORT editor on the card** (select from registered AIRPORTs, `PATCH /api/fleet/:reg`) and a card line when base is missing: `no base — LAUNCH is refused`. | auto | S | none |
| 2 | **Approved-card repair.** Re-evaluate approved non-launch cards whose AIRCRAFT went absent: set `launch` from the current plan (or supersede with `AIRCRAFT 세션 없음`), and **render** `needs LAUNCH` (and the `NO_SESSION_SEND_WHY` text) on the card with a LAUNCH-on-approve button. Fixes observation 6. | flagged (DISPATCH state machine) | M | D-0253 case; ATC-258 (lost comms) is wider and out of scope |
| 3 | **Predict refusals in the LaunchPanel and on DISPATCH launch cards** from one `launchRefusals(reg, account)` read (cap, login, FUEL, per-ACCOUNT cap, base, retired, already-live): the button is disabled with the reason, not refused after the click. Reuse `launchAccountRefusal` and `launchPlanOf`. | auto | M | ATC-257 (shared account display) |
| 4 | **Trust pre-check and `accept trust` action.** Read the folder's trust state per ACCOUNT before the click; show `<repo>: not trusted by acct-1` with a button that marks it the way `markOnboarded` does after LOGIN. | flagged (writes Claude Code's config) | M | none |
| 5 | **Pending states on the downstream steps**: DISPATCH card `sent in ≤ ~10 min (OCC tick)`; FLEET row `LAUNCHING…` from the click until the session file appears; planner age (`last run 3 min ago`). | auto | M | none |
| 6 | **Errors at the click spot** for FLEET (STOP, AOG, Editor, ENTRY, CONTROL rows) and DISPATCH (approve, reject, mode); busy text and a disabled state for STOP, Editor save, ENTRY and the DISPATCH mode switch. | auto | M | none |
| 7 | **Launch cap in settings** (OPERATIONS): a number field that writes the same store as the other AUTOMATION switches, applied live; the DISPATCH chip and the LaunchPanel line always show it, not only when full. | flagged (changes a server limit that bounds memory use) | S | the 2026-09-30 OOM and cap notes |
| 8 | **Immediate planner and FLEET refresh after an action** (optional): after approve, launch or an ACCOUNT change, ask the server to re-run the planner once and the screen to refetch; keep the 5 min cycle as the fallback. Invalidate the `claude agents` cache on LAUNCH and STOP so no reader sees a stale list. | flagged (planner trigger) | M | none |
| 9 | **CONTROL rows say which account the next LAUNCH uses**, including a per-session label that the LAUNCH ACCOUNT overrides. | auto | S | ATC-257 (same wording), ATC-255 (bulk) |
| 10 | **APPLY NOW end states**: say when a pending APPLY ends (24 h, setting changed) in the screen, not only in FLIGHT RECORDER; offer a "force this one after FLIGHT" for an idle-by-rule AIRCRAFT the SUPERVISOR chooses. | auto (screen) / flagged (force) | M | ATC-251 comment (the stuck `wait-safe` case) |
| 11 | **NEEDS YOU answer path** for permission prompts: first the copy-only reply and attach on the collapsed row and in CONTROL rows (auto, S); then, only if the SUPERVISOR decides so, a send-reply action. | auto, then flagged | S then L | ATC-252 (STAND prompt; the CREW BRIEFING fix is done) |
| 12 | **Tidy**: fix the stale AGENTS-vs-ACCOUNTS texts (sc:136, `SettingsAutomation.tsx:367`, `SettingsAccounts.tsx:10`) and the FLIGHT PLAN comment (prop:505-507); stop `GET /api/fleet/sessions` calling `claude agents` twice; record pre-launch refusals from FLEET LAUNCH in FLIGHT RECORDER too; decide on an AOG check in `launchAircraft`. | auto (texts) / flagged (server) | S | none |
| 13 | **Make LAUNCH one step from the row** (a LAUNCH button on collapsed rows of absent AIRCRAFT that opens the panel), and move the CONTROL group's LAUNCH/STOP to the row level. | auto | M | ATC-255 |

The top three (1, 2, 3) remove the three things the SUPERVISOR asked ENGINEERING about on one day (no base, never-going-out approved cards, refusal after the click). 4 and 7 remove the two items that need a terminal or an env file.

## 5. Risks

- **Prediction can be wrong.** A pre-check reads state that can change between the read and the click (a FUEL hold appears, another session takes the cap slot). The server refusal stays as the authority and the screen keeps showing it; the pre-check only moves the common case before the click.
- **Trust writes touch Claude Code's own config** (`~/.claude*/…`). Writing it wrongly could break an ACCOUNT's folder; step 4 is `flagged`, copies the pattern of `markOnboarded`, and reads before it writes. Whether `markOnboarded` is enough for a folder atc did not log in is not measured.
- **Re-evaluating approved cards (2)** changes the DISPATCH state machine; a wrong re-check could supersede a card OCC is about to send. It must only act on cards with no `sent` op and an AIRCRAFT that is absent for the whole grace window.
- **Immediate planner runs (8)** can double the load of a Linear or GitHub poll if clicks come in a burst; they need a minimum gap.
- **More pending text means more states to keep true.** Each pending label needs a test that it disappears when the condition ends.
- **This survey is partly inferred.** The OCC delivery time, the staleness of rows after a reboot, and observation 6's re-check were read from code and not run; a BUILD for 2, 5 and 10 should start by reproducing them on a 7702 server with a fake `claude` and seeded sessions.

## 6. Decisions (for the SUPERVISOR)

1. **Order.** Recommend 1, 2, 3 first (one PR each), then 6 and 9 together (screen-only), then 4, 7, 8. Alternative: 7 first if the cap is the next thing that bites.
2. **Trust action (4).** Recommend yes: atc launches into that folder itself and the SUPERVISOR has accepted the same prompt by hand each time. Alternative: show the pre-check only and keep acceptance by hand.
3. **Launch cap (7).** Recommend a number field in OPERATIONS with a hard ceiling in code (so a typo cannot start 200 sessions). Alternative: keep the env file and only show the value.
4. **Answering permission prompts (11).** Recommend copy-only on every row now and decide the send-reply action after seeing how often it is needed; sending keys into a session is a new power and wants its own design.
5. **Immediate planner run (8).** Recommend it, behind a minimum gap of 30 s. Alternative: only invalidate the `claude agents` cache and show the pending text (5) without changing the planner.
6. **AOG check in `launchAircraft` (12).** Recommend a refusal with `AOG — <reason>` plus a one-click "AOG 해제 and launch" in the panel; today the SUPERVISOR can launch an AOG AIRCRAFT without any warning.

## Not built yet

Everything in section 4. This document changes no code and no setting. The 7702 runs used a temporary state folder, `ATC_GITHUB=off` and a fake `claude`; no real session was launched or stopped.
