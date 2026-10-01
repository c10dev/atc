# FOLLOW: a live board for the work the SUPERVISOR handed out

Status (2026-10-01): design draft. Nothing is built. The SUPERVISOR asked for it on 2026-10-01 after spending much of a session asking "현재 상황" and "배정됐나" about one bundle of work (GLOBE, ATC-253). They chose a new tab and asked for the design and work orders (section 8). Work orders follow section 6: parent [ATC-275](https://linear.app/vocado/issue/ATC-275), F1 [ATC-276](https://linear.app/vocado/issue/ATC-276), F2 [ATC-277](https://linear.app/vocado/issue/ATC-277), F3 [ATC-278](https://linear.app/vocado/issue/ATC-278).

**LANDING tier of every step: `auto`.** FOLLOW is a read-only route, one small settings file the screen writes through an Origin-checked route, a screen, and alert keys. Its only Linear write is the existing FLIGHT state button route (`POST /api/flight/:key/state`, DUTY G3); FOLLOW adds no new write path to Linear, GitHub or sessions.

Related: [occ.md](occ.md) section 8 (FLIGHT FOLLOWING), [dispatch.md](dispatch.md) (proposals, OOOI milestones, STRIPS progress), [alerting.md](alerting.md) (SUPERVISOR alerts, QUEUE), [mcc.md](mcc.md) (landing and RTS), [globe.md](globe.md) (the ambient picture; FOLLOW is the task view).

## 1. Current facts

Verified in the code on `origin/main` and in the session of 2026-10-01.

- **What the SUPERVISOR kept asking.** For the GLOBE bundle (ATC-253 and its sub-issues, plus ATC-267), the questions were: was it proposed, approved, sent, read back; is there a PR; did CI pass or is there a conflict (GO AROUND); did it land; is it deployed; and which issue can be released next. Each answer needed `proposals.jsonl`, `clearances.jsonl`, `gh pr view`, `rts.jsonl`, `GET /api/dispatch/brief` and Linear, read by hand.
- **Two gaps were invisible on every screen:** an approved proposal not yet sent (D-0272 for ATC-260: approved 03:23:39, sent 03:30:57), and a merged PR not yet deployed (ATC-254: merged 03:20:21, `/api/globe` 404 until the RTS at 03:22).
- **FLIGHT FOLLOWING** (`server/following.ts`, `GET /api/following`, folded inside the DISPATCH tab and `#dispatch` "FLIGHT FOLLOWING") follows FLIGHTs that already have a proposal or a `tail:` label, through `readback → departed → prOpened → cleared → arrived`, with delay and mismatch issues (`FollowIssue` codes such as `no-pr`, `pr-not-cleared`, `landing-wait`, `undelivered`, `unable`). It starts after a proposal exists and ends at ARRIVED. It does not group by parent and does not say what the SUPERVISOR should do next.
- **Proposal timeline.** Each DISPATCH proposal carries `timeline` stamps per `ProposalStatus` (`proposed`, `approved`, `sent`, `accepted`, `departed`, `declined`, `recalled`, `superseded`, `expired` …; `server/proposals.ts`).
- **Why a FLIGHT is not assigned** is already computed: `GET /api/dispatch/brief` → `plan.excluded[]` (for example `진행 중인 제안 D-0272`, `우선순위 없음`), `plan.unserved[]`, `plan.hold[]`.
- **OOOI** (`GET /api/milestones`): OUT, OFF (PR opened), ON (merged), IN (RTS put it in service, MCC AIRPORT only), `reverted`; plus `FlightProgress` (`server/progress.ts`) with the typical range of the current segment.
- **Landing state** is in the snapshot: `pulls[]` with `landing` CLEARED/APPROACH and `blocks` (checks pending/failed, behind, dirty …), and TOWER CLEARANCEs (`GO AROUND`, `LAND`) with READBACK times.
- **Parents and blockers.** The snapshot's `tickets[]` covers the configured Linear teams for issues updated in the last 45 days, with `parent`, `children`, `blockedBy`, `blocks`, `related` and `priority`.
- **READY and the state button.** `isReady(stateType, blockerTypes)` (`server/detail.ts`) is true for a Backlog issue whose blockers are all Done or Canceled. The FLIGHT drawer shows `READY` and a state button that calls `POST /api/flight/:key/state {from, to}` (`server/flight-state-run.ts`): `fromThisApp` only, `to` limited to the team's Backlog, Todo and Canceled, 409 if the state moved meanwhile, one FLIGHT RECORDER line per attempt.
- **SUPERVISOR alerts** (`server/supervisor-alerts.ts`, ATC-87, ATC-197): stable keys in groups (`health`, `alert`, `following`, `pending`, `land`, `rts`, `recycle`, `reposition`) with a destination (`alerts`, `queue`, `log`). The server sends `alert` SSE events; the browser notifies per group setting; atc-app reads them through the ALERTING steps A6/A7 (ATC-201/202, Backlog).
- **Tabs** are lazy (`web/src/lazyTab.tsx`); the order is in `TABS` in `web/src/App.tsx`.

## 2. Principles

1. **One row per issue, one board per bundle.** The unit the SUPERVISOR thinks in is a parent issue and its sub-issues (and issues linked as related). Every row is a fixed sequence of stages, so "where is it" is answered by looking, not by asking.
2. **No new facts.** Every stage comes from a record atc already keeps (section 3.2). FOLLOW joins them per issue in one pure server function. The browser only draws.
3. **Show the gaps between systems.** The stages that matter most are the hand-overs nobody owns on another screen: approved → sent, merged → deployed, Done blocker → released.
4. **Say what the SUPERVISOR should do, and only that.** A row has at most one next action. Only one of them writes (`release`, through the existing state route); the others are links to where the action already lives.
5. **Push the important changes, quietly.** A small set of transitions becomes SUPERVISOR alerts (section 3.5), so the SUPERVISOR does not have to come and look. Nothing else notifies.
6. **Read-only towards teams and control sessions.** FOLLOW never assigns, sends, recalls or messages. DISPATCH and OCC keep that job.
7. **Same honesty as STRIPS and GLOBE.** Elapsed time against the typical range; no percentage, no ETA.

## 3. The model

### 3.1 Bundles

- A **followed bundle** is a parent issue key. Its rows are the parent's `children` plus issues that are `related` to the parent (ATC-267 for ATC-253), in the order of their blocker chain and then by key.
- The SUPERVISOR follows a bundle from the FOLLOW tab (type a key) or from the FLIGHT drawer of a parent ("FOLLOW" button). The list is stored by the server in `follow.json` in the state folder (`{ "parents": ["ATC-253"] }`, written atomically by rename), through `POST /api/follow {parent, on}` with `fromThisApp`. It is a setting, not a record: no JSONL.
- When every row is Done or Canceled and deployed (or has no deploy step), the bundle folds into "완료" for a day and then stays folded until unfollowed.
- A single issue without a parent can be followed the same way; it is a bundle of one.

### 3.2 Stages of a row

| Stage | Done when | Source |
|---|---|---|
| `todo` | Linear state is Todo or later | snapshot `tickets[]` |
| `proposed` | a DISPATCH ASSIGN proposal exists for the FLIGHT | `proposals.jsonl` `timeline.proposed` |
| `approved` | approved (by the SUPERVISOR or by the mode) | `timeline.approved` |
| `sent` | FLIGHT PLAN sent | `timeline.sent` (`undelivered` shows as a problem) |
| `readback` | the CAPTAIN read it back | `timeline.accepted` |
| `pr` | PR opened (OFF) | milestones, `pulls[]` |
| `ci` | the PR is CLEARED to land | `pulls[].landing`, `readyAt` |
| `landed` | merged (ON) | milestones |
| `deployed` | in service (IN) | milestones; only for the MCC AIRPORT, else the column shows `—` and `landed` ends the row |

- STAND-free FLIGHTs (SURVEY, CHECK) skip `pr`, `ci`, `landed`, `deployed` and end with ARRIVED (the arrival report), as FLIGHT FOLLOWING does.
- A `tail:` FLIGHT has no proposal; `proposed` to `readback` show `tail` and the row starts at `pr`.
- RECALL, `declined` and `superseded` reset the row to `todo` with the event in the row's history.

### 3.3 "Now" and stuck

Each row has a **now** text and, if it is past a limit, an amber **stuck** mark. The limits reuse existing rules where they exist; three are new.

| Where it sits | Now text (example) | Stuck when |
|---|---|---|
| Backlog with open blockers | `G2 대기` (the blocker keys) | never |
| Backlog, READY | `풀 수 있음` | never (it is a next action, 3.4) |
| Todo, no proposal | the DISPATCH reason: `우선순위 없음`, `PREFLIGHT HOLD`, `AIRCRAFT 없음` | **new:** Todo with a priority and no proposal for 30 min |
| proposed | `승인 대기` (approval mode) | never in approval mode (it is a next action) |
| approved, not sent | `승인 7분 · 발송 없음` | **new:** 10 min |
| sent, no READBACK | existing FLIGHT PLAN overdue | 10 min (existing) |
| readback → PR | `TEAM_K 작업 42분 · 보통 30–90분` | existing `no-pr` delay |
| PR, not CLEARED | block codes, `GO AROUND C-0255 READBACK 03:15` | existing `pr-not-cleared` |
| CLEARED, not landed | `착륙 대기` | existing `landing-wait` (60 min) |
| landed, not deployed | `RTS 대기` | **new:** 15 min (RTS batches every 5 min) |
| deployed / Done | `03:22 배포` | — |

Stuck rows sort to the top of their bundle. The row's history (hover or expand) lists the stamps of every stage.

### 3.4 Next actions

At most one per row, in this order:

| Next action | When | What the chip does |
|---|---|---|
| `release` · "Todo로" | Backlog and `isReady` | calls `POST /api/flight/:key/state {from: "Backlog", to: "Todo"}` (existing, SUPERVISOR click only, 409 if moved) |
| `priority` · "우선순위 정하기" | Todo excluded for no priority | opens the FLIGHT drawer (Linear link) |
| `approve` · "승인하러" | proposal waiting for the SUPERVISOR | link to `#dispatch` at that proposal |
| `human-check` / `merge` | HUMAN CHECK pending, or a CLEARED `user`-tier PR | link to the PR drawer (`#pr/...`) |
| `look` · "살펴보기" | stuck at `sent`/`readback`/`landed` | link to RADIO or STRIPS for that FLIGHT |

The header shows the count of rows with a next action (`NEXT 2`), linking to `#follow`.

### 3.5 Alerts

A new group `follow` in `ALERT_GROUPS`, only for followed bundles:

| Key | Destination | When |
|---|---|---|
| `follow|ready|<KEY>` | queue (cue `call`) | a row becomes READY to release |
| `follow|approve|<D-id>` | queue | a proposal of a followed row waits for approval (instead of the generic `pending` line for that proposal, not in addition) |
| `follow|stuck|<KEY>|<stage>` | alerts | a row goes stuck (3.3) |
| `follow|landed|<KEY>` / `follow|deployed|<KEY>` | log | ON / IN |
| `follow|failed|<KEY>` | alerts | GO AROUND, ROLLBACK or a reverted ON |

Quiet hours and per-group switches apply as for every other group. atc-app gets them through ALERTING A6/A7; FOLLOW adds nothing app-side.

## 4. Screens

**FOLLOW tab** (`#follow`, lazy):

- One block per followed bundle: title, `n / m 완료 · k 비행 중 · 다음 할 일 j`, then the rows.
- A row: key and short title, the stage dots (done, current, stuck in amber, not yet), the now text, the next-action chip. Clicking the key opens the FLIGHT drawer.
- An input to follow a key, and per bundle an unfollow button.
- Narrow screens: the dots collapse into `pr ●──○` style "stage 6/9" text plus the now text and chip.
- Theme tokens only; no animation beyond the existing blink for open calls (respects `settings.motion`).

**FLIGHT drawer:** a `FOLLOW` / `FOLLOWING ✓` toggle on any issue with children.

**Header:** `NEXT n` when n > 0.

## 5. Server

- `server/follow.ts` (pure): `followBoardOf({ parents, tickets, proposals, pulls, clearances, milestones, following, plan, now })` → bundles and rows as in section 3, with `node:test` tests for every row of 3.2, 3.3 and 3.4.
- `server/follow-run.ts`: `GET /api/follow` (read-only, from the snapshot and the existing readers) and `POST /api/follow {parent, on}` (`fromThisApp`, writes `follow.json` only, refuses keys that are not issue keys). Clients refetch on the existing snapshot SSE event, at most every 10 s.
- `server/supervisor-alerts.ts`: the `follow` group (F3).

### F1 as built (ATC-276)

- **Files.** `server/follow.ts` (pure: `followBoardOf`, `followRowOf`, `bundleKeysOf`, `chainOrder`, `follow.json` parse/toggle), `server/follow-run.ts` (`GET /api/follow`, `GET /api/follow/list`, `POST /api/follow`), `web/src/views/Follow.tsx` + `Follow.css`, the `FOLLOW` toggle in `web/src/Drawer.tsx`.
- **Row.** Nine stage cells `{done, at, na}`, `current` (last reached), `finished`, `now`, FLIGHT FOLLOWING `issues` (same codes and words), `history` (stage stamps plus resets, oldest first). `na` marks stages a FLIGHT does not have: STAND-free FLIGHTs skip `pr`..`deployed` and finish at ARRIVED; a `tail:` FLIGHT skips `proposed`..`readback`; `deployed` is `na` for FLIGHTs known to belong to a non-MCC AIRPORT (LOGBOOK line or open PR), and applies when the AIRPORT is unknown.
- **Reset.** The row follows the latest ASSIGN proposal that is not `declined`, `recalled`, `superseded`, `rejected` or `expired`; those stay in `history` and, with no live proposal, give the `now` text when DISPATCH has no reason of its own.
- **Bundle.** `children` plus `parent` back-links plus `related` (both directions); a parent with none is a bundle of one. `n / m 완료 · k 비행 중` where in flight means sent or later and not finished. A bundle whose rows are all finished is `done`; one day after its last stamp it is `folded` (rendered collapsed).
- **Plan.** `GET /api/follow` builds the DISPATCH plan the same way `GET /api/dispatch/brief` does (pure `planDispatch`, no writes) only to explain Todo rows without a proposal; if that fails the board still draws.
- **Not in F1.** Next-action chips, the three new stuck limits, `NEXT n` (F2); alerts (F3). Rows are therefore not re-sorted by stuck yet.

### F3 as built (ATC-278)

- **Where.** The `follow` group in `ALERT_GROUPS` (`server/supervisor-alerts.ts`), fed by `follow` on `AlertsInput`: the rows of every followed bundle that is not `folded`, read from `followNow` (`server/supervisor-alerts-run.ts`). Stages are not computed again. When `follow.json` is empty the board is not computed.
- **Row fields added (additive).** `ready` (Backlog and `isReady`, same test as the `풀 수 있음` text), `goAround` (a live GO AROUND clearance: id, READBACK time) and `reverted` (the revert PR of the ON).
- **Keys.** `follow|ready|<KEY>` (queue, `advisory`, cue `call`: the row is READY and not finished); `follow|approve|<D-id>` (queue, `advisory`, cue `call`: the row's proposal waits for the SUPERVISOR; it **replaces** `pending|proposal|<D-id>`, so there is no second line); `follow|stuck|<KEY>|<stage>` (alerts, `caution`); `follow|failed|<KEY>` (alerts, `warning`); `follow|landed|<KEY>` and `follow|deployed|<KEY>` (log, no level, no cue). `destOf` has a `follow` case and `DEST_PREFIXES` lists it, so the existing test that reads the key shapes covers it.
- **Stuck without F2.** F2 is not on main, so `stuck` is the FLIGHT FOLLOWING issues already on the row: severity `warn` and not `await-supervisor` (that one is a decision wait and stays with the `following` group, going to the queue). One line per row and stage (`<stage>` is the row's `current`, `todo` when none); the text is the first issue and `(외 n건)`. The `following|…` items for those same issues are not emitted for a followed FLIGHT (no double line); the `info` issues and `await-supervisor` stay `following`. When F2 adds its limits to the row, `stuckIssuesOf` is the one place to extend.
- **Failed.** One key per row, reasons joined with ` · `: a live GO AROUND (not for a finished row), the latest RTS is `rollback` or `failed` and the row landed before it and is not deployed (`RTS ROLLBACK`), the ON was reverted (`PR #n로 되돌려짐`).
- **Landed and deployed.** While the stage stamp is under 24 hours old (no stamp: until the bundle folds). Stages that are `na` give nothing.
- **Consumers.** The SUPERVISOR SUMMARY counts `follow|approve|` with `pending|proposal|` in `pending.dispatch`, and the DISPATCH tab's refetch key (`web/src/dispatch-alerts.ts`) includes `follow|approve|`. The settings switch is the existing per-group list (`ALERT_GROUPS`), default on.

## 6. Implementation order

Each step is one issue. Each PR adds a changelog fragment pair and describes the tab in `docs/guide/screens.md` (Korean) and, for F1, a short page in `docs/guide/` on following work (added to `DOC_NAV`).

| # | Step | Output | Tier |
|---|---|---|---|
| F1 | **Board.** `follow.json` and `POST /api/follow`, pure `followBoardOf` with stages and now text (3.1–3.3), `GET /api/follow`, the `#follow` tab, the FLIGHT drawer toggle | The SUPERVISOR sees where every issue of a bundle is, including approved-not-sent and landed-not-deployed | auto |
| F2 | **Next actions and stuck.** The chips of 3.4 (`release` through the existing state route), the three new stuck limits, the header `NEXT n` | The board tells the SUPERVISOR what to do and flags what is stuck | auto |
| F3 | **Alerts.** The `follow` group of 3.5 with its settings switch | The SUPERVISOR is told about READY, stuck, landed, deployed and failures without looking | auto |

- F1 has no dependencies. F2 and F3 need F1 and can go in either order.
- Checks for every step: `npm test`, `npx tsc --noEmit -p .`, `npx vite build`; a 7702 test server (`ATC_GITHUB=off`, temp state folder with copied `airports.json` and `fleet.json` and sample `proposals.jsonl`/`clearances.jsonl` lines, never the real state folder) with Playwright, described in the PR in words; no screenshots.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A second FLIGHT FOLLOWING that disagrees with the first | FOLLOW reads `followingOf` items for `readback`…`arrived` and adds only the stages before and after. The same issue codes are shown with the same words |
| The `release` chip moves an issue the SUPERVISOR did not mean to | Explicit click, the existing route with its `from` check (409 if moved), and the FLIGHT RECORDER line. No bulk release |
| Alert noise | Only followed bundles, five keys, destinations chosen so READY and approvals land in the QUEUE and landed/deployed only in the LOG. The `approve` key replaces the generic `pending` line, it does not add one |
| Stale Linear data (45-day window, fetch interval) | The row shows when Linear was last read; issues outside the window show `Linear에서 못 읽음` instead of a guessed state |
| `follow.json` written by a team session | `POST /api/follow` needs `fromThisApp`; the file holds issue keys only and grants nothing |

## 8. Decisions

**Made (SUPERVISOR, 2026-10-01):**

- Build a live board for work handed out, so the SUPERVISOR does not have to keep asking for the status. GLOBE stays the ambient picture; FOLLOW is the task view.
- It is a **new tab**.
- Design and work orders now, built through DISPATCH.

**Proposed here, for the SUPERVISOR to accept or change:**

- Tab name `FOLLOW`, `#follow`, placed right after RADAR (before GLOBE).
- The unit is a parent issue plus its related issues; the followed list is a server setting (`follow.json`) so alerts can use it.
- New stuck limits: Todo without a proposal 30 min, approved-not-sent 10 min, landed-not-deployed 15 min.
- The only write is `release` through the existing state route; every other next action is a link.
- Priority of the work orders: Medium (it removes repeated status questions).

## Not built yet

Everything in section 6 (F1–F3).
