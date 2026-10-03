# HOME flow board: is anything stuck, who holds it, what do I do

Status (2026-10-03): **design draft, nothing built.** The SUPERVISOR and an ENGINEERING session grilled and prototyped this on 2026-10-03; every decision in section 3 is settled. Written by DUTY from that brief. Work orders: parent [ATC-498](https://linear.app/vocado/issue/ATC-498) with children ATC-499 to ATC-504 (section 5), all in Backlog. DUTY updates the status after they land.

Related: [layout.md](layout.md) (HOME is one of the five screens), [follow.md](follow.md) 3.2–3.3 (the stages and the stuck limits this reuses), [design-language.md](design-language.md) (principles 1, 4, 6, 12), [mcc.md](mcc.md) (landing owner, ESCALATE), [naming.md](naming.md).

## 1. Current facts

- **HOME is a to-do list.** `layout.md` gives it one job: "is there anything for me to do now?". It shows a separate SINCE LAST LOOK row at the top (since ATC-383) and the SUPERVISOR QUEUE, where ALERTs and stuck FLIGHTs are kinds of their own. BRAKES moved to the bottom panel (ATC-455).
- **Two bottlenecks were invisible on HOME.** On 10-02, 8 escalated PRs sat as "MCC INSPECTION 대기" while the real wait was the SUPERVISOR's merge. On 10-03, vocado's Codex review was silent and the REVIEW diff truncation (~80k) held 15 FLIGHTs. Both were found only through `atcctl mcc queue` and the dispatch brief.
- **The stages and stuck limits already exist.** `followRowOf` (`server/follow.ts`) gives every FLIGHT a stage (`todo` … `deployed`, follow.md 3.2) and a `stuck` mark with limits (3.3): Todo without a proposal 30 min, approved-not-sent 10 min, no READBACK 10 min, `no-pr`, `pr-not-cleared`, CLEARED-not-landed 60 min, landed-not-deployed 15 min.
- **Landing owner already exists for PRs.** `mcc.md` classifies an ATCC PR as `mcc` or `supervisor` (tier `user`, ESCALATE, hold, shadow mode), and `pulls[].blocks` carries the block codes (checks pending or failed, behind, dirty, review).
- **OOOI is in `follow.md` only.** `GET /api/milestones` has OUT, OFF, ON, IN (follow.md section 1). `naming.md` has none of them, and QUEUE is not a code anywhere.
- **Landing gaps, 7 days to 2026-10-03 07Z** (GitHub `mergedAt` cross-checked with the logbook):

| AIRPORT | Landings | Gap median | Gap p90 |
|---|---|---|---|
| ATCC (atc) | 479 | 7 min | 35 min |
| VCDO (vocado) | 108 | — | 158 min |
| ATCA (atc-app) | 28 | — | 218 min |

  A flat 30-minute "no landing" rule would have fired 52 times in the week on atc alone. vocado always had at least 4 open PRs, so "an open PR is queued work" filtered nothing.
- **The prototype** is local only: branch `worktree-atc-home-flow-proto`, head `a16fbab` (reachable from any worktree of this repository: `git show a16fbab:web/src/proto/FlowProtoA.tsx`). `web/src/proto/flow-fixtures.ts` is the draft `/api/flow` shape; four scenarios (normal, SUPERVISOR merge congestion, external stop, quiet). Reference only, not for merge. Variants A, A1, B, C stay in it for comparison; **A3 is the choice**.

## 2. Principles

1. **One answer first.** Two questions at a glance: is anything stuck, and who holds it? and what do I need to do? The screen answers them in that order.
2. **The server decides** (design-language 4). One pure function computes the verdicts, the cells, the holders, the verdict text, and the to-do grouping and order. The web draws; ANNUNCIATOR can later read the same verdict.
3. **Never show the same item twice** (design-language 6). A cell never lists a FLIGHT that is already on the to-do list; it points to it.
4. **Colour means stuck, nothing else.** Normal is achromatic. On the board, red means "stopped" only.
5. **No batch action** (design-language 12). Grouping is for reading; every merge and approval stays one by one.
6. **A control that judges has an off switch and a misfire counter** (work-order rule). The landing-gap threshold is such a control.

## 3. Decisions (settled)

### 3.1 The screen

One screen, top to bottom: **focal verdict block → flow board → to-do list.** The name stays HOME, it stays the default tab, and the 880 px reading column stays.

### 3.2 Focal verdict block

One block per HOME; the worst AIRPORT wins (stopped over congested over normal; the longest wait breaks a tie).

| Verdict | Level, token, glyph | Text |
|---|---|---|
| Normal | none, neutral | large `흐름 정상`, one muted line of numbers (`지난 6h 착륙 32 · 비행 중 9`) |
| Congested `정체` | CAUTION, `--amber`, ▲ | stage, count, longest wait, holder: `ATCC 착륙 대기 8건 · 최장 6h · SUPERVISOR 머지 대기` |
| Stopped `막힘` | WARNING, `--alert`, ■ | `VCDO 착륙 없음 5h (기준 158m) · 외부: Codex 응답 없음` |

The block also carries a `할 일 n ↓` link to the to-do list and the SINCE LAST LOOK line (`마지막으로 본 뒤 7h · 발권 5 · 착륙(ON) 9 · 배포(IN) 3 · [읽음]`). It uses the same server marker and `/api/since-look` as today and **replaces the separate SinceLook row.**

**Verdict rules**

- **Normal:** no FLIGHT is past a follow.md 3.3 stuck limit.
- **Congested:** at least one FLIGHT is past its limit.
- **Stopped:** any of
  - a ground stop (ATFM GROUND STOP),
  - main CI red,
  - no landing at that AIRPORT for longer than its **rolling 7-day p90 landing gap (floor 30 min)** while there is work the system should move.
- **Work the system should move** excludes everything the SUPERVISOR holds (section 3.4 and 4.2). Those FLIGHTs show as congested with the SUPERVISOR as holder, never as stopped.
- **The p90 threshold is a setting with an off switch and a misfire counter** (4.3).

### 3.3 Flow board (prototype A3, "focal and aligned")

One row per AIRPORT, five stage columns that group the follow.md 3.2 stages:

| Column | Gloss | follow.md stages |
|---|---|---|
| `QUEUE` | 대기 | `todo` · `proposed` · `approved` |
| `OUT` | 출발 | `sent` · `readback` |
| `OFF` | 비행 | `pr` |
| `CLEARED` | 착륙 대기 | `ci` |
| `ON·IN` | 배포 | `landed` · `deployed` |

- The header is one line of the five codes with their Korean gloss and arrows between them.
- **Cell:** the count (large, right-aligned, tabular) and the oldest age. An empty cell is blank. A stuck cell has an amber or alert top bar, the glyph, `최장 …` and the holder tag.
- **Right column:** the last 12 hours of landings per hour as bars, and `n · 마지막 4m`.
- An AIRPORT with no FLIGHT collapses to one line, `비행 없음`, plus the bars.
- **Cell click** opens that cell's FLIGHT list directly under the AIRPORT row (not under the table). If every FLIGHT in the cell is already on the to-do list, it shows only `n건 모두 아래 할 일에 있다 ↓`, which opens that to-do group (principle 3).
- **Width:** rows use `@container`. At 432 px (the FLIGHT drawer open) the row stacks name and bars over the five cells, each cell labelled. Checked: no horizontal scroll at 1000, 1280 and 432.
- **Colour:** the design-language principle 1 gets a written HOME exception. The flow board is shown in the normal state, but stays achromatic (no `--radar`, `--amber`, `--alert` or `--cyan`); colour appears only for congested and stopped.

### 3.4 Holders

Four holders:

| Holder | What it means |
|---|---|
| `SUPERVISOR` | merge of a `user`-tier or escalated PR, K approval, HUMAN CHECK |
| `AIRCRAFT` | no READBACK, no PR, NORDO |
| `ATC` | DISPATCH, MCC or RTS automation lagging |
| `EXTERNAL` | Codex, GitHub CI, LIMIT, account mismatch |

- Several holders in one cell: the holder of the **oldest stuck** FLIGHT.
- A FLIGHT blocked by another FLIGHT **inherits the blocker's holder**, and the cell names the blocker (`VOC-239에 막힘 15`).
- The holder tag is a neutral border with bold text (SUPERVISOR included). Red is not used for it: the web `.needs-you` red is not reused on the board.

### 3.5 To-do list (grouped)

- Items with the **same kind and the same needed action** collapse into one group row: `LANDING · 8건 · user 등급 PR · SUPERVISOR 머지 필요 · 최장 6h · [펼치기 8]`. Expanding shows one row per item, each with its own button.
- **No batch action on a group row.** Merges stay one by one.
- After grouping, at most **5 lines**; the rest folds into `나머지 n건 BACKLOG 3 …`.
- **Server order:** WARNING → SUPERVISOR-held stuck items → CAUTION → the rest, oldest first within a level.
- It is a **HOME-only component first.** Moving grouping into `kit/TodoRow` (RELEASE and the DUTY drawer use it too) is a later, separate work order.

### 3.6 Server

`GET /api/flow` (read-only) returns the draft shape of `flow-fixtures.ts`: `FlowView { at, verdict, line, holder, worst, sinceLook, airports[ { code, verdict, reason, thresholdMin, sinceOnMin, landings12h, cells[ { stage, count, oldestMin, stuck, tone, holder, note, flights[] } ] } ], todo[ { …, group, groupNeed } ] }`. The 24-hour per-hour verdict history of variant A1 is **not** part of it (A1 was not chosen), so no new record is needed. The verdict, texts, holders, grouping and order all come from one pure function with `node:test` tests. No new GitHub or Linear call: landings come from milestones and the logbook, stages and stuck marks from `followRowOf`.

## 4. Open items answered

### 4.1 `OUT` as a stage code

Not new as a milestone (follow.md section 1 has OUT, OFF, ON, IN), but **new as a name on a screen**: `naming.md` has none of the OOOI codes, and `QUEUE` is a code nowhere. The docs work order adds one table to `naming.md` and `naming.ko.md`: `QUEUE`, `OUT`, `OFF`, `CLEARED`, `ON`, `IN`, with what each groups.

### 4.2 Can "work the system should move" be computed exactly?

Yes. Every FLIGHT from QUEUE to CLEARED already has a stage and, past a limit, a stuck reason (follow.md 3.2–3.3). PRs add one total table.

- **A stopped verdict needs at least one FLIGHT at that AIRPORT, in any stage from QUEUE to CLEARED, whose holder is `ATC`, `AIRCRAFT` or `EXTERNAL`.**
  - Only SUPERVISOR-held work is excluded: tier `user`, ESCALATE, hold, HUMAN CHECK and K approval.
  - Work that inherits a SUPERVISOR holder through a blocker is excluded too.
  - This is the rule settled on 2026-10-03.
- **AIRCRAFT-held work counts.** Suppose every AIRCRAFT goes NORDO or idle before opening a PR. Work then waits in QUEUE or OUT, nothing lands past the threshold, and the board must say stopped. That is the silent stall this board exists to show.
- **Before a PR, the holder comes from the follow.md 3.3 stuck reason.** It works like the PR table below: a reason nobody classified is `ATC` and counts as a classification miss.
- The holder of each PR comes from fields that already exist: landing owner (`mcc` / `supervisor`), MCC ESCALATE and hold, the `pulls[].blocks` codes, and review state. The classification is **one table from block code to holder, and a test fails if a code is unmapped.** A code nobody classified defaults to `ATC` and counts as a classification miss, so it can never hide a stop behind the SUPERVISOR.
- Known weak spot: a vocado PR whose reviewer (Codex or DeepSeek) never answers is `EXTERNAL`. That is the intended case (the 10-03 stop), but the "silent" judgement is an age limit on the review wait, which the table needs as a number.

### 4.3 Threshold, off switch, misfire counter

- **Threshold per AIRPORT** = rolling 7-day p90 of the gap between consecutive landings (ON), floor 30 min. With fewer than 8 gaps in the window the AIRPORT has no gap rule (too little data); ground stop and main CI red still apply.
- **Off switch:** in settings, SUPERVISOR only, default **on** (live first). Off removes the gap rule only; a ground stop and a red main CI are facts and still show.
- **Misfire counter:** a stopped verdict from the gap rule that ends on its own within one threshold with no ground stop, CI or SUPERVISOR change counts as a probable misfire. The count and the number of episodes sit in METRICS beside the other automation counters.
- The exact setting key and the counter's file are the work order's call, using the same state folder pattern as the existing switches.

### 4.4 432 px holder tag

Recommendation: **shorten, do not truncate.** `SUPER…` is a cut word. The server sends a short form with the holder (`SUP`, `AC`, `ATC`, `EXT`), the narrow `@container` rule shows it, and the full name stays in the accessible name and the tooltip (principle 11 allows this because the cell's `note` already states the cause in text).

## 5. Implementation order

| Step | Work | Needs |
|---|---|---|
| H1 [ATC-499](https://linear.app/vocado/issue/ATC-499) | **`/api/flow` pure function and route.** Verdict, cells, holders, inheritance, the block-code table, to-do grouping and order, with `node:test`. The threshold is an input (default floor 30) | — |
| H2 [ATC-501](https://linear.app/vocado/issue/ATC-501) | **Threshold setting, off switch, misfire counter.** Rolling p90 from the logbook, wired into H1 | H1 |
| H3 [ATC-502](https://linear.app/vocado/issue/ATC-502) | **HOME board and focal verdict block** (web, absorbs the SinceLook row) | H1 |
| H4 [ATC-503](https://linear.app/vocado/issue/ATC-503) | **Grouped to-do on HOME** (web, 5-line fold, no batch action) | H1 |
| H5 [ATC-500](https://linear.app/vocado/issue/ATC-500) | **Docs first:** design-language principle 1 exception, `naming` codes. `layout.md` HOME text, `guide/screens.md` and the changelog fragments travel with H3 and H4 | — |
| H6 [ATC-504](https://linear.app/vocado/issue/ATC-504) | Later: grouping into `kit/TodoRow` for RELEASE and the DUTY drawer | H4 |
| H7 | Later, in the atc-app project: ANNUNCIATOR reads `/api/flow` | H1 |

## 6. Risks

- **The block-code table drifts.** A new block code with no entry is classified `ATC` and counted. The test that fails on an unmapped code is the guard.
- **The p90 follows the habit it measures.** If landings slow down for a week, the threshold rises with them. The 30 min floor and the misfire counter are the only brakes; a fixed ceiling is not proposed.
- **Quiet AIRPORTs.** ATCA lands 4 times a week; its p90 (218 min) is a long stop to wait for. The verdict stays normal unless the system holds work there.
- **The prototype is local only.** `a16fbab` lives in a worktree branch that can be deleted; keep it until H3 lands.

## 7. Decisions

Settled 2026-10-03 (section 3). Decided by DUTY from the open items: 4.1, 4.2 and 4.4 above (SUPERVISOR may overrule 4.4).
