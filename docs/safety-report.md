# SAFETY REPORT: control sessions report friction from their own manuals

An airline's crews file safety reports when a procedure made them spin. A safety office groups the reports, and the procedure changes through the normal approval chain, not because one crew improvised. This document proposes the same loop for atc's control sessions (TOWER, OCC, MCC, CROSSCHECK, REVIEW): a session files a short structured report when its own manual caused friction, atc groups the reports, and a fix goes through the normal PR path.

> Status (2026-09-30): adopted as a design draft (ATC-180; idea [#246](https://github.com/chaehy5665/atc/issues/246)). Nothing is built. The build issues follow section 5.

Related: [readability.md](readability.md) (ATC-176, the automatic side of the same question), [radio.md](radio.md) (RADIO), [control-recycle.md](control-recycle.md) (CONTROL RECYCLE, ATC-166), [fleet.md](fleet.md) (NEEDS YOU as built, ATC-99), [occ.md](occ.md) (SCHEDULE `NEW`, CHARTER DESK), [mcc.md](mcc.md), `hooks/rules-drift.mjs`, `controller/guard.mjs`.

## 1. Current facts

Read on 2026-09-30 from the manuals, `controller/guard.mjs`, `server/` and the docs above. Nothing was written or run.

- **Friction from a manual surfaces only by chance.** On 2026-09-30 three cases were noticed by the SUPERVISOR, each from a badge or a mismatch, none from the session that lived it:
  - TOWER marked itself BLOCKED (kind: needless BLOCKED) when only orphan claims on merged STANDs were left and no CLEARANCE was needed.
  - MCC sat BLOCKED for 183 minutes, then again, waiting for a STOP and LAUNCH because of its context cap (ATC-135). ATC-165 and ATC-166 now cover the restart itself.
  - On PR #244 MCC's computed tier and the PR body's tier disagreed (kind: ambiguous rule).
- **Today the only fix path is the SUPERVISOR noticing and asking ENGINEERING.** No record says how often a rule caused trouble, so a rule is fixed after the third bad afternoon or never.
- **A running session keeps the manual it started with.** `node ../controller/atcctl.mjs manual check` (each tick) tells it the manual changed and it re-reads. `hooks/rules-drift.mjs` also leaves a per-session ack hash in `rules-ack/`, which `server/rules-state.ts` shows on the FLEET card (RULES line). So atc can already tell, per session, whether and since when it runs the current manual.
- **What control sessions may run is a per-role allowlist.** `controller/guard.mjs` lists the `atcctl` subcommands each role may use (TOWER, CROSSCHECK, REVIEW, MCC) and is fail-closed. OCC has its own guards (`occ/send-guard.mjs`, `occ/mcp-guard.mjs`). A new `atcctl` command is unusable until each role's list gains it, and a guard file is tier `user`.
- **Pieces that already exist and are reused** (section 6): change markers of manual merges and the transcript reader (READABILITY), the RULES ack hashes, BLOCKED health alerts from job state (NEEDS YOU), stable alert keys (SUPERVISOR alerts, ATC-87), SCHEDULE `NEW` with duplicate search, the 5-open-drafts limit, 3-day expiry and a SUPERVISOR verdict (OCC), CROSSCHECK marks on drafts, CONTROL RECYCLE (a relaunch loads the new manual).

## 2. Principles

1. **Control sessions never edit code or manuals.** They report. A change is a PR by a team and lands the usual way.
2. **MCC never lands a PR that changes `mcc/` or a guard.** It escalates, so it never inspects its own rules.
3. **Guards stay fail-closed and tier `user`.** Weakening a guard is asked of the SUPERVISOR first (root `CLAUDE.md`). Adding one allowed command is a guard change and is asked the same way (Decision D5).
4. **A report is one line and never transcript content.** It names the rule and the kind, not the situation's text. The server rejects anything else.
5. **Group first, with no model.** Counting is deterministic and cheap. Any model step comes only after a group passes a threshold, and never decides alone.
6. **One manual change per session at a time**, then a measurement window before the next.
7. **atc is public.** Cases are cited by kind and PR number in documents and PRs, never by quoting session text.

## 3. The model

### 3.1 The report (S0)

`node ../controller/atcctl.mjs safety-report --kind <kind> --rule <file:section> [--ref <id>] -- <one line>` appends to `safety-reports.jsonl` in the state directory (append only, like the other records).

```
{ id: "SR-0001", at, session, kind, rule: "occ/CLAUDE.md:Flight following", ref?: "C-0170" | "D-0165" | "PR#244", manual: "<hash>", text }
```

- `session` is set by the server from the caller's role (TOWER, OCC, MCC, CROSSCHECK, REVIEW), not typed. The role is what `atcctl` already knows for the allowlist.
- `rule` is a file (one of the control manuals and skills) and a section title. The server checks that the file exists and that the section string is at most 80 characters. It does not check that the section exists (manuals move).
- `manual` is the hash of the rule file when filed (the same hash `rules-drift` uses), so a report is tied to the manual version it complained about.
- `text` is one line, at most 160 characters, no newline, no code fence. Longer or multi-line text is refused with a message, not shortened.
- `ref` is an optional id of the record it is about, so RADIO and READABILITY can link it. It is an id, never content.
- A rate limit protects the file: at most 10 reports per hour per session. Identical `session + kind + rule` within 10 minutes is one report.

**Kinds** (from the idea; one addition considered and left out):

| Kind | A session files it when |
|---|---|
| `false-block` | It raised BLOCKED, a HOLD, or a report to the SUPERVISOR because its manual said to, and nothing needed the SUPERVISOR. |
| `guard-block` | A guard refused a command that its manual told it to run, or the reverse. |
| `ambiguous-rule` | Two readings of a rule, or a rule and server data disagreeing (for example a tier computed one way and written another). |
| `repeat-ask` | It asked the SUPERVISOR or another session the same question it had already been answered. |

`no-rule` (a situation no rule covers) was considered and left out of S0: it is the hardest to tell from a one-off event, and `ambiguous-rule` with the nearest rule covers most cases. It can be added when S2 shows a need.

### 3.2 The group (S1)

`safetyGroupsOf(reports, window, now)`, pure, no model. Key: **session, kind and rule** (the file and section). Output per group: `{ key, session, kind, rule, count, distinctDays, firstAt, lastAt, ids, manualChanged, route }`.

- `manualChanged`: the rule file's hash differs from the one in the earliest report of the window. A group with a change starts a new window from that change (section 5, Measure).
- `route`: `engineering` when the rule is in `occ/` (OCC's own manual) or the report is `guard-block` or the file is a guard; otherwise `draftable` once it passes the threshold (S3), else `watch`.
- `GET /api/safety-reports?days=N&session=&kind=` returns `{ at, window, reports, groups }`, read only. Reports are newest first and hold the one-line text; groups are by count.

## 4. Options for who drafts the fix

| | For | Against |
|---|---|---|
| **A. Server grouping only** | No model, deterministic, cheap, no new permissions | No issue text; the SUPERVISOR still writes the fix |
| **B. ENGINEERING** | Fits today's rules (it already writes Linear); independent of the reporters | Not a standing session, so reports wait until someone opens it |
| **C. OCC via SCHEDULE `NEW`** | Reuses a built path: duplicate search, body checks, 5-open-drafts limit, 3-day expiry, SUPERVISOR verdict | Needs a new exception to "OCC never drafts `NEW` on its own initiative"; conflict of interest for OCC's own manual; SCHEDULE is still shadow (S1), so an approved draft does not reach Linear until S2 |
| **D. A new standing SAFETY session** | Independent of the reporters; may use another model, like CROSSCHECK | More FUEL; still cannot write Linear, so it ends up drafting like C |

**Recommendation.**

1. **A first and always.** The SAFETY view (or the API) lists the groups, and the server builds a deterministic fix-draft **template** for a group over the threshold (the rule, the counts, the report ids, the kind's usual question). No model writes it.
2. **C only after SCHEDULE S2 is on**, with an explicit, narrow exception to the `NEW` rule: OCC may draft one `NEW` from a group the server marks `draftable`, with label `safety`, at most one open SAFETY draft at a time, never for `route: engineering`. The draft cites the report ids. The rest of the path is unchanged.
3. **B for reports about OCC's own manual and for every guard report** (conflict of interest, and guard changes stay with a human). The group is marked `route: engineering`; a SUPERVISOR alert says so.
4. **D is revisited only if report volume starts to crowd OCC's context.** CONTROL RECYCLE comes first.

## 5. Implementation order

| Step | What | Tier | Depends on |
|---|---|---|---|
| **S0 report** | `atcctl safety-report` (section 3.1), the server route that validates and appends, the record file, and adding `safety-report` to the allowed `atcctl` list of the roles in `controller/guard.mjs` (D5). No manual text yet. | `user` (guard) | D5 answered |
| **S1 group** | `safetyGroupsOf` (pure, tested) and read-only `GET /api/safety-reports`. One stable SUPERVISOR-alert key `safety:<key>` per group that passes the threshold (INFO). No screen required. | `auto` or `flagged` | S0 |
| **S2 manuals** | Each control manual gets a short "Reporting" section: a list of report-worthy cases so a session can tell manual friction from a one-off event, and the command. Report when (a) you can name the sentence that misled you, or (b) the same thing happened twice in a week. Do not report an outage, a network error or an unavailable SUPERVISOR. | `flagged` (manuals) | S0, S1 |
| **S3 drafts** | The template for a group over the threshold (recommendation 1), then the narrow OCC exception (recommendation 2) after SCHEDULE S2. | `flagged` | S1, S2, D1, D2 |
| **Measure** | Before and after per fixed rule (below). | `auto` | S1, READABILITY |

**Threshold (proposed, D1):** a group passes at **3 reports on at least 2 different days within 7 days**. Fewer is watched, not drafted.

**Measure.** For each rule that a PR fixed, atc compares the same window before and after:

- **Report rate** for the key (reports per day), from `safety-reports.jsonl`.
- **BLOCKED minutes** of the session, from the BLOCKED health alerts that NEEDS YOU already raises (job state, ATC-99).
- **SUPERVISOR interventions**: prompts the SUPERVISOR typed into the session, counted from its transcript the way READABILITY counts messages (numbers only, never the text).

The "after" window starts when the session **runs the fixed manual**: the later of the PR's merge marker (READABILITY) and the session's ack hash for the new version (`rules-drift`), or its CONTROL RECYCLE relaunch. A CONTROL RECYCLE in either window is marked, because a relaunch alone can lower BLOCKED time and confounds the comparison. The result is `better`, `worse` or `unclear` (too few reports to say). `worse` suggests a revert; the SUPERVISOR decides.

**One manual change per session at a time.** While a session's "after" window is open (default 7 days or 5 reports, whichever comes later), a new group for the same session is `held`: it is listed and counted but gets no draft.

## 6. Relation to existing work

| Existing | Reused | New |
|---|---|---|
| **READABILITY** (ATC-176) | The change markers (merges that touched a manual or skill, with time, PR and ATC key) mark where a rule changed. The transcript reader pattern (read only, keep only counts and one line) counts SUPERVISOR interventions. The daily-record habit. | READABILITY measures the radio traffic automatically. SAFETY is what a session says about its own manual. The two answer different questions and are compared only in Measure. |
| **RADIO** (ATC-170 to 173) | A report's `ref` (C-xxxx, D-xxxx) links to the transmission the friction happened on. | Reports are not radio traffic (no call, no reply), so they get no frequency. Whether SAFETY lives in the RADIO tab is D4. |
| **CONTROL RECYCLE** (ATC-166) | A relaunch makes a session read the manual it was fixed to. | Measure marks a recycle inside a window as a confound. |
| **NEEDS YOU** (ATC-99) | BLOCKED minutes per session. | A session's own verdict that a BLOCKED was needless (`false-block`), which the job state cannot know. |
| **SUPERVISOR alerts** (ATC-87) | Stable keys and the `alert` event; no new detector. | One INFO key per group over the threshold; not one per report. |
| **SCHEDULE `NEW`, CROSSCHECK** (OCC) | The draft path with its limits and verdict; CROSSCHECK's marks on drafts. | The narrow exception for `safety` drafts (section 4); D3 asks whether CROSSCHECK marks them. |
| **Manual reload** (`manual check`, `rules-drift`) | Which manual version a session runs. | The report carries the manual hash. |

## 7. Risks

- **Noise.** A session files a report for every hiccup. Mitigations: the S2 case list, the rate limit, the 10-minute duplicate rule, the threshold on distinct days, and `route: watch` for anything under it.
- **Gaming or feedback loops.** A session could file reports to change its own manual. It cannot: it only reports, a human approves, and OCC's own manual and all guards go to ENGINEERING. MCC never lands a PR changing `mcc/`.
- **A weaker guard by the back door.** The S0 command widens an allowlist. It is one write command that appends one validated line and reads nothing; it is still a guard change, so it is asked of the SUPERVISOR (D5) and stays tier `user`.
- **Transcript content in a report.** The one-line and 160-character limits are a blunt tool. The manual says "name the rule, not the situation", and the server refuses newlines and code fences. A determined session can still paste text, so reports are shown only to the SUPERVISOR and are never copied into a public PR body by an automated step.
- **Overfitting to a small number.** Three reports can be one bad day. The distinct-days rule and the measurement window (`unclear` is a valid answer) guard against acting on noise.
- **The measurement confounds.** Recycles, model changes and changed workloads move BLOCKED minutes. Measure records these next to the numbers instead of hiding them.
- **A stale report stream.** Reports filed against a manual version that no longer exists are kept, but grouped under `manualChanged` so they do not count toward the new version.

## 8. Decisions

Questions the SUPERVISOR answers before S3. Each has a recommendation.

| # | Question | Recommendation |
|---|---|---|
| **D1** | The threshold and the grouping key. | Key: session, kind and rule (file and section). Threshold: 3 reports on at least 2 different days within 7 days. Under it, watch only. |
| **D2** | Who drafts. | A always; C after SCHEDULE S2 with the narrow exception in section 4; B for OCC's own manual and every guard report; D only if OCC's context is crowded. |
| **D3** | Does CROSSCHECK mark SAFETY drafts? | Yes, advisory, as it does for DISPATCH and SCHEDULE, because it is a different model family. Not for a draft about CROSSCHECK's own manual (that goes to B). |
| **D4** | Does SAFETY live in the RADIO tab or in its own view? | Its own small view. RADIO is a live 6-hour log; SAFETY is weekly groups with an action per group. RADIO lines link to a report by `ref`. It can sit next to a READABILITY view later. |
| **D5** | May S0 add `safety-report` to the allowed `atcctl` list of the control roles? | Yes, for TOWER, OCC and MCC first, as a separate `user`-tier PR with the guard tests extended (the command is refused for every other role and for any other arguments). CROSSCHECK and REVIEW later. This is a guard change and is asked here, not assumed. |

## Not built yet

Everything in sections 3 to 5. The idea remains open for the kinds (`no-rule`), for a SAFETY view, and for reading the SUPERVISOR's own interventions as a report source.
