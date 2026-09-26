# One DISPATCH pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

**Description:** One DISPATCH pass — review assignment proposals that have no note yet against the FLIGHT body and add notes and CAUTION; in approval mode, send approved proposals as FLIGHT PLANs and record READBACKs. Run it with `/loop 10m /tick`.

1. First handle any replies from CAPTAINs since the last pass: for "READBACK D-xxxx", run `node ../controller/atcctl.mjs dispatch readback D-xxxx`; for a decline with a reason, `dispatch decline D-xxxx -- <reason>`.
2. Run `node ../controller/atcctl.mjs dispatch brief` and check `mode`.
3. For each proposal in `open` without a `note`:
   - Read the body and comments with `node ../controller/atcctl.mjs dispatch flight <FLIGHT key>`.
   - Following the review rules in CLAUDE.md, run `node ../controller/atcctl.mjs dispatch note <ID> [--caution] -- <note>`.
4. If `mode` is `approval`, follow "Sending FLIGHT PLANs" in CLAUDE.md: approved in `inFlight` → `dispatch release` → SendMessage the printed text unchanged, and handle `overdue`. In `shadow`, skip this step.
5. Leave a line or two of DISPATCH LOG. If nothing happened, "특이 사항 없음" ("nothing to report").

It makes no decisions (approve or reject). If send-guard blocks a send, don't retry; report to the SUPERVISOR.
