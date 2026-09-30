# READABILITY: measuring how well the radio works

atc's sessions talk to each other in a fixed phraseology (FLIGHT PLAN, CLEARANCE, CREW CHANGE, READBACK, UNABLE, STANDBY, ROGER). READABILITY measures how well that traffic works: how fast the replies come, how often a call gets no reply, why teams say UNABLE, whether a clearance was followed, how much each message costs, and whether the replies keep to the phraseology. R0 only collects. It changes nothing it measures.

> Status (2026-09-30): R0 built (ATC-176). The collector, the daily record `readability.jsonl` and `GET /api/readability` exist. No screen, no alert, and no change to the phraseology.

## 1. Current facts

- **The calls and most replies are already recorded** as structured, append-only lines (`clearances.jsonl`, `proposals.jsonl`, `crew-changes.jsonl`, `arrival-reports.jsonl`), and RADIO R1 (`server/radio.ts`, [radio.md](radio.md)) already merges them into transmissions with `replyTo`, `open` and `overdueAt`. READABILITY reads that list. It does not read the files a second way.
- **What the records do not have** is the reply as the control session received it: the reply's own wording, its first line, its size with the envelope, and any reply that was sent but never recorded. Those are in the control sessions' transcripts as inbound `cross-session-message` lines.
- **Transcripts are private and big.** The `fuel` code already reads them read-only ([fuel.md](fuel.md) 4). READABILITY follows the same rule: read, never copy, never write.
- **The phraseology changed on 2026-09-30** (the reply address line, ATC-169; English landing block texts, ATC-174), and it will change again. A metric taken across a change measures two different things, so every daily line carries the merges that touched the phraseology and is also cut at their times.
- **UNABLE is the loudest signal so far.** On 2026-09-29, 11 UNABLEs answered LAND clearances with the same reason: team sessions do not merge. That is one cause, not eleven, which is why the reason is classified and not only counted.

## 2. Model

### Inputs (pure)

`readabilityOf(transmissions, replies, events, window)` in `server/readability.ts`:

- `transmissions`: the RADIO transmissions (calls, and replies with `replyTo`).
- `replies`: the transcript replies (`TranscriptReply`): `{ at, from, to, first, length, lines }`. First line at most 200 characters, total length, and the number of non-empty lines. **Never the text.**
- `events`: the FLIGHT RECORDER traffic events (for GO AROUND compliance).
- `window`: `{ from, to }`, from inclusive, to exclusive.

It returns the same `Bucket` for the whole window (`total`), per frequency (`byFreq`), per kind (`byKind`) and per AIRCRAFT (`byAircraft`). Calls are counted by their own time, in the window.

### The Bucket

| Field | Meaning |
|---|---|
| `calls`, `replied`, `late` | Calls in the window; calls with a first reply before the window's end; calls whose only replies came after the window's end (not counted as no-reply). |
| `latency` | Call to first reply (STANDBY counts as a first reply): `n`, `medianMs`, `p90Ms`. The median of an even count is the mean of the middle two; p90 is the nearest rank. |
| `noReply` | Calls that never got a reply. A call withdrawn by a cancel (`cancel`), a RECALL, a newer FLIGHT PLAN (`supersede`) or a delivery by other means is counted in `withdrawn`, not here. An `expire` is a real no-reply. |
| `overdue` | First reply later than 10 minutes (the rule RADIO already uses), or no reply and 10 minutes passed before the window's end. |
| `unable` | Count and reason **class**: `no-merge`, `wrong-target`, `stale`, `busy`, `blocked`, `other`, and `none` when there is no reason. First match wins, in that order. The reason is the recorded `reason`; when a record has none, the first line of the transcript reply. |
| `sent`, `received` | Messages, characters and **estimated tokens** (characters divided by `CHARS_PER_TOKEN = 2.5`, a named constant). `sent` is the recorded text of atc's calls, without an envelope. **`received` is the whole message as the control session saw it and includes the envelope** (the `<cross-session-message …>` tag and the line and notice the harness puts around it), so it is larger than the text alone. |
| `compliance` | Where the records can show it (below). |
| `phraseology` | Violations from the reply's first line. |

### Compliance

Only what the records can show. No evidence means `unknown`, which is not "did not comply".

| Call | Complied when | Time measured |
|---|---|---|
| GO AROUND | A later event for the same PR shows a different head (a new conflict or previous-PR event with another `head`), or the PR became CLEARED or left the sequence. The PR and head come from the GO AROUND text. | GO AROUND to that event |
| FLIGHT PLAN | The READBACK is followed by an ARRIVED report for the same FLIGHT | READBACK to ARRIVED |
| RECALL | The `recalled` reply exists | RECALL to reply |

Evidence after the window's end is not used, so a day's line never depends on tomorrow.

### Phraseology violations

Read from the first line of a team's message to a control session, for messages that answer an open call (the call's AIRCRAFT, the receiving session, not yet closed by a recorded READBACK, ROGER or UNABLE more than 2 minutes before the message). Reports (`[TEAM_X → OCC] …`) and follow-ups after the call was closed are not replies and are not checked.

- `missingHead`: the first line does not start with `READBACK`, `UNABLE`, `STANDBY` or `ROGER` and an id.
- `multilineUnable`: an UNABLE with more than one non-empty line.
- `wrongId`: a head with an id that is not one of that AIRCRAFT's open calls.

### Where the replies come from

**The receiving control session's transcript**: the inbound `cross-session-message` lines of TOWER (replies to CLEARANCEs) and OCC (replies to FLIGHT PLANs, RECALLs and CREW CHANGEs). The other choice, the team's outgoing send, would need every team's transcript and would miss replies that never arrived. The two control sessions are two folders.

- Located with the code that already exists: `projectDirName` (`server/control-recycle-run.ts`), `projectsRoots` (`server/fuel-run.ts`) and `ROLE_DIRS` (`server/squelch-run.ts`). Only the top-level `<sessionId>.jsonl` files of the `controller` and `occ` project folders are read.
- Only `user` lines whose content starts with the envelope, from a team session. `queue-operation` and `attachment` copies of the same message are ignored, and a message with the same time, sender and length is counted once.
- Files are read again only when their size or time changed.

### Daily record

`readability.jsonl` in the state directory, append-only. One line per UTC day, written once the day is over:

```
{ v, day, computedAt, window, charsPerToken, metrics, segments, markers, replies, repliesTotal }
```

- `metrics`: the day's `Readability`.
- `markers`: the merges of that day that touched the phraseology. `{ at, pr, key, sha }`: the merge time, the PR number and the ATC key.
- `segments`: when a marker falls inside the day, the day is also cut at each marker's time, with `total` and `byFreq` for each part and `afterPr`, the PR whose merge opens the part. This is how a change is compared with the hour before it.
- `replies`: at most 500 per day, each `{ at, from, id, first, len }`: the first line (200 characters at most) and the length. No message bodies.
- **First run**: every day from 2026-09-26 that is not in the file is filled in, oldest first.
- **Idempotent**: the file is read again before every append, so a restart, an RTS or two runs never write the same day twice. A day whose git lookup failed is not written and is tried again on the next hour.

### Change markers

`git log origin/main --first-parent --merges` (or `HEAD` if there is no `origin/main`), for merges in the day that touched:

- the `controller/`, `occ/`, `mcc/` and `crosscheck/` manuals (`CLAUDE.md`, `CLAUDE.en.md`) and their `.claude/skills` (and `mcc/.claude/agents`);
- `.claude/skills/atc-task/`;
- `server/response.ts` and `server/landing-en.ts`;
- the FLIGHT PLAN, CLEARANCE and CREW CHANGE text builders (`server/proposals.ts`, `server/crew-change.ts`, `server/controller.ts`, `server/go-around.ts`), only for merges that changed a line with a phraseology word (`FLIGHT PLAN`, `RECALL`, `CREW CHANGE`, `GO AROUND`, `READBACK`, `UNABLE`, `STANDBY`, `ROGER`, `[DISPATCH`, `[OCC CC`, `[ATC C-`, `LANDING sequence`). This is a heuristic: those files change for other reasons too.

### API

`GET /api/readability?days=N` (default 7, 1 to 60, anything else is `400`): `{ at, days, today }`.

- `days`: the last N stored lines, oldest first, before today.
- `today`: `{ day, partial: true, window, metrics, markers }`, computed on the request from midnight UTC to now.

## 3. R0 as built (ATC-176)

Files: `server/readability.ts` (pure), `server/readability-run.ts` (reads, writes the daily line, mounts the route), tests in `server/readability.test.ts` and `server/readability-run.test.ts`. RADIO gained one optional field for this: `Transmission.closedBy` (`cancel`, `expire`, `supersede`, `delivered`, `recall`), so a call closed without a reply can be told apart from an unanswered one. It is also in `GET /api/radio`. Nothing else in RADIO changed.

**PILOT'S DISCRETION.**

- The reply source is the receiving control session's transcript (above), and a reply's UNABLE reason falls back to it only when the record has none.
- `none` is its own UNABLE class (no reason), and `stale` and `wrong-target` are added next to the four named in the brief. The classifier is a fixed list of patterns in `server/readability.ts` and the `other` bucket catches the rest.
- `withdrawn` is separate from `noReply`. The brief said to exclude `cancel`; a RECALL, a newer FLIGHT PLAN and a delivery by other means also mean atc stopped waiting, so they are excluded too. An `expire` stays a no-reply.
- The daily line is cut at every phraseology marker of that day, not only at two named times. The 2026-09-30 merges of ATC-169 (reply address line, 06:49:21Z by the merge commit) and ATC-174 (English landing blocks, 06:47:04Z) are among them.
- The daily job runs 20 seconds after the server starts and then hourly; it does nothing when no day is missing. Today is never written; it is computed on request.
- `GET /api/readability` reads the records, the transcripts and `git log` on each request. It is not meant for a polling screen; R1 will decide whether to cache.

## Not built yet

- **A screen** (a READABILITY view or a section of RADIO) and DOCS text for it.
- **CAUTION on a repeated UNABLE class.** Two UNABLEs of the same class in a day would raise a CAUTION for the SUPERVISOR. It needs a threshold and a place in the alert list.
- **SAY AGAIN.** A control session asks a team to repeat a reply that broke the phraseology. It changes what the sessions send, so it is a SUPERVISOR decision (tier `user`).
- **Content read-back.** The reply repeats the substance of the call, not only its id (aviation read-back of the clearance itself). Also a SUPERVISOR decision.
- Reading the team's outgoing sends (the other reply source) and per-CREW measures.
