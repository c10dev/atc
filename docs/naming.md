# Naming rules

**English** · [한국어](naming.ko.md)

atc finds tickets from branch names and links sessions to worktrees through the claim records the hook leaves. Following the rules below lets everything link up without inference.

## Tickets

- Linear team `Vocado`, key `VOC-<n>`.

## Branches (existing convention)

```
claude/voc-<n>-<slug>     # Claude sessions
codex/voc-<n>-<slug>      # Codex sessions
```

- Claude Code's worktree tool names its branch `worktree-<name>` and puts the worktree in `/home/c10/projects/atc/.claude/worktrees/<name>`. atc reads it the same way: the key inside the name (`worktree-atc-115-slug` → `ATC-115`) finds the FLIGHT, and STAND detection, the DEPARTURE LOG, the LOGBOOK and the LANDING SEQUENCE match on the branch as it is, with no `claude/` assumed ([ATC-115](https://linear.app/vocado/issue/ATC-115)).
- Work without a ticket stays `claude/<slug>`. atc shows it as **AD HOC** (ticketless work, such as a fix of 5 lines or less handed to a team directly). Work that needs a ticket goes through the CHARTER DESK instead ([occ.md](occ.md)).

## Worktree directories

```
/home/c10/projects/worktrees/<repo>-voc-<n>-<slug>
```

- Take the branch name without the agent prefix and put the repository name in front.
  `claude/voc-191-close-anon-write-tables` → `vocado-voc-191-close-anon-write-tables`
- Don't create new ones without the hyphen (`voc185`) or without a slug (`vocado-voc-171`).
- atc doesn't depend on directory names, so existing worktrees don't need renaming.

## Sessions (teams)

- The session names `TEAM_A` … `TEAM_F` are long-lived lanes of work. Tickets change; team names stay.
- Subagent tool calls are recorded under the leader's session ID, so when a leader spreads work across several worktrees, all of them show as that team's claims. Teammates that run as separate processes can show up as their own sessions.

## Control sessions

| Session name | Folder | Role |
|---|---|---|
| `TOWER` | `controller/` | Traffic control: CLEARANCE, READBACK |
| `OCC` | `occ/` | Operations control: DISPATCH review, SCHEDULE drafts, flight following |
| `CROSSCHECK` | `crosscheck/` | A model from a different family than OCC leaves a provisional verdict before the SUPERVISOR decides |
| `MCC` | `mcc/` | Maintenance Control: INSPECTION of atc's own PRs, landing and RETURN TO SERVICE ([mcc.md](mcc.md)) |
| `DUTY` | `duty/` | Duty Manager: the SUPERVISOR's chat window in atc. L1: reads atc, drafts, and writes design docs (a docs PR from its own `duty-*` STAND) and Linear work orders. Decides, merges and deploys nothing ([duty.md](duty.md)) |

- **CROSSCHECK** is borrowed from the cockpit cross-check, where the second pilot independently checks the first one's setting. Here it is the provisional verdict (`agree`/`disagree` plus a one-line reason) on an open DISPATCH proposal (`D-xxxx`) or SCHEDULE draft (`S-xxxx`). It is also called a **mark**. It never changes a proposal's or draft's state and is never counted in a gate.
- **CROSSCHECK match** (`CROSSCHECK 일치`): among human decisions that had a mark before the decision, the share where the mark agreed (agree ↔ agreed/approved, disagree ↔ disagreed/rejected). It is shown overall and per model: each mark records the model id of the CROSSCHECK session (`unknown` for marks made before the field existed), shown in the screens by its short name (`muse-spark-1.3-contributor`, `gpt-5.6-terra`).

## Working sessions

| Session name | Where | Role |
|---|---|---|
| `TEAM_X`, then `TEAM_XX` | a worktree per task | AIRCRAFT: builds FLIGHTs and opens PRs. One letter (`TEAM_A` … `TEAM_Z`), then two (`TEAM_AA` … `TEAM_ZZ`); the callsign is one phonetic word per letter (`TEAM_RA` → ROMEO ALPHA). See [fleet.md](fleet.md) "Two-letter REGISTRATIONs as built" |
| `ENGINEERING` | this repository, opened when needed | Break-glass since DUTY L1: the same design and work-order work in a desktop session, under the same rules. Doesn't merge, deploy or message teams (root `CLAUDE.md` "계획·DUTY·Linear", `docs/rules.ko.md` "DUTY") |

- **ENGINEERING** is an airline's Technical Services, which designs modifications and issues Engineering Orders (EO). It replaces the ad hoc name `structure` for this role (GitHub #121, 2026-09-28). `structure`'s other role, landing and deploying atc PRs, goes to the user until MCC is in `land` mode, then to MCC.
- Old records keep the name they were written with, e.g. `by: "structure"` in LOGBOOK `measured` lines.
- **DUTY** (the Duty Manager) is a control session with **L1** ([duty.md](duty.md) 3.5, D7a): it does the ENGINEERING work itself. It writes `.md` docs only in its own STAND (`.claude/worktrees/duty-*`, branch `claude/duty-*`), opens PRs, and writes issues to the Linear ATC team through the server. It has no code or test servers (L2), no merge or deploy (L3), no messages to team sessions (L4), and it cannot write the files that set its own powers (the guard, `duty/settings.json`, `.claude/`, `.github/`, `package*.json`, `deploy/`, `hooks/`, the root `CLAUDE.md`). The `l1` switch in `duty.json` is off by default.

## Flow stage codes and holders (HOME flow board)

The HOME flow board ([home-flow.md](home-flow.md) 3.3–3.4) groups the FLIGHT stages of [follow.md](follow.md) 3.2 into six codes. `OUT`, `OFF`, `ON` and `IN` are the OOOI milestones (`GET /api/milestones`); `QUEUE` and `CLEARED` are stage groups with no milestone of their own.

| Code | Korean gloss | Groups (follow.md 3.2 stages) |
|---|---|---|
| `QUEUE` | 대기 | `todo` · `proposed` · `approved`: the FLIGHT exists and is not yet sent |
| `OUT` | 출발 | `sent` · `readback`: FLIGHT PLAN sent, waiting for or past the CAPTAIN's READBACK (milestone OUT) |
| `OFF` | 비행 | `pr`: the PR is open (milestone OFF) |
| `CLEARED` | 착륙 대기 | `ci`: the PR is CLEARED to land and not merged |
| `ON` | 착륙 | `landed`: merged (milestone ON) |
| `IN` | 배포 | `deployed`: in service (milestone IN, MCC AIRPORT only) |

- The board has five columns: `ON` and `IN` share one column, `ON·IN`.
- A code names a place in the flow, not a state of health. Whether a cell is stuck comes from the follow.md 3.3 limits.

Four **holders** say who has to move next. A cell shows the holder of its oldest stuck FLIGHT.

| Holder | Meaning |
|---|---|
| `SUPERVISOR` | merge of a `user`-tier or escalated PR, K approval, HUMAN CHECK |
| `AIRCRAFT` | no READBACK, no PR, NORDO |
| `ATC` | DISPATCH, MCC or RTS automation lagging |
| `EXTERNAL` | Codex, GitHub CI, LIMIT, account mismatch |

## FUEL words on screen

- **FOB (FUEL ON BOARD)** is an AIRCRAFT's own fuel: the context window still free (`FOB 50% · 504k/1M`). It is a share **left**.
- An ACCOUNT's plan limit is always a share **used** (`사용 87% · resets 21:00Z`). It is shared by every AIRCRAFT of the ACCOUNT and is not called FOB. Definitions: [fuel.md](fuel.md) section 3.

## Claim records

- Claims are recorded automatically by the Claude Code hook ([README "Claim hook"](../README.md#claim-hook)). Leaders and teammates don't need to write anything.
- A team that is done with a worktree just stops touching it. The claim is released after 3 hours.
- A claim is recorded only when a file is edited or Bash enters the worktree with `cd` or `git -C`. Commands that only read a path are not recorded.
- When two teams are recorded on the same worktree, it shows as a conflict (LOSS OF SEPARATION).
