# One OCC pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

**Description:** One OCC pass — check whether the manual changed, review assignment proposals that have no note yet against the FLIGHT body and add notes and CAUTION; in approval mode, send approved proposals as FLIGHT PLANs and record READBACKs; write SCHEDULE drafts (CLASSIFY, PRIORITIZE, shadow operation) for FLIGHTs with no classification or priority. Run it with `/loop 10m /tick`.

0. `node ../controller/atcctl.mjs manual check`. On `CHANGED`, reread `CLAUDE.md` and this file, run `node ../controller/atcctl.mjs manual ack`, then continue under the reread manual.
1. First handle any replies from CAPTAINs since the last pass. Check PR, review and done reports with `gh` as in "Flight following" in CLAUDE.md. For FLIGHT PLAN replies: "READBACK D-xxxx", run `node ../controller/atcctl.mjs dispatch readback D-xxxx`; for a decline with a reason, `dispatch decline D-xxxx -- <reason>`.
2. Run `node ../controller/atcctl.mjs dispatch brief` and check `mode`.
3. For each proposal in `open` without a `note`:
   - Read the body and comments with `node ../controller/atcctl.mjs dispatch flight <FLIGHT key>`.
   - Following the review rules in CLAUDE.md, run `node ../controller/atcctl.mjs dispatch note <ID> [--caution] [--hold [<FLIGHT>]] -- <note>`. A prerequisite written only in the body, or a wait for a human decision, gets a `--hold`, not just a note.
4. If `mode` is `approval`, follow "Sending FLIGHT PLANs" in CLAUDE.md: approved in `inFlight` → `dispatch release` → SendMessage the printed text unchanged, and handle `overdue`. In `shadow`, skip this step.
5. SCHEDULE drafts (S1, shadow operation), following "SCHEDULE drafts" in CLAUDE.md:
   - Run `node ../controller/atcctl.mjs schedule brief` and look at `candidates` and `examples` (the SUPERVISOR's recent decisions and rejection reasons). Don't repeat a mistake a rejection reason names.
   - If there are CLASSIFY candidates, first Read `../docs/fleet.md` (4.1 FLIGHT TYPE, 4.2 WAKE, 4.3 TYPE RATING). Decide the FLIGHT TYPE in the order from "Before a CLASSIFY" in CLAUDE.md (BUILD only when behavior users see changes), and cite the sections applied in the reason.
   - For up to 3 candidate FLIGHTs, read each with `dispatch flight <FLIGHT key>`. If it is in `candidates.classify`, run `schedule draft CLASSIFY <FLIGHT> [--type …] [--wake …] [--rating …] -- "<reason>"`. If it is in `candidates.prioritize` and the body or comments give grounds, `schedule draft PRIORITIZE <FLIGHT> --priority <1-4> -- "<reason>"`. With no grounds, skip PRIORITIZE.
   - On `LIMIT`, stop drafting for this pass. Nothing is written to Linear.
   - Open `NEW` drafts (AD HOC FLIGHTs from the CHARTER DESK) count toward the limit of 5 too. A CHARTER REQUEST is not a per-pass duty; handle it as in "CHARTER DESK" in CLAUDE.md when the SUPERVISOR asks in this session.
6. If `mode` in `schedule brief` is `approval` (S2), follow "SCHEDULE release" in CLAUDE.md: for each approved in `inProgress`, `schedule release <S-xxxx>` → for each CALL in the output, pass its JSON unchanged to that Linear tool. If linear-guard blocks it or Linear returns an error, don't retry; report to the SUPERVISOR. In `shadow`, skip this step.
7. Leave a line or two of OCC LOG. If nothing happened, "특이 사항 없음" ("nothing to report").

It makes no decisions (approve or reject). If send-guard blocks a send, don't retry; report to the SUPERVISOR.
