# One DISPATCH pass (2a, `/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

**Description:** One DISPATCH pass — review atc's assignment proposals that have no note yet against the FLIGHT body, and add notes and CAUTION. Run it with `/loop 10m /tick`.

1. Run `node ../controller/atcctl.mjs dispatch brief`.
2. For each proposal in `open` without a `note`:
   - Read the body and comments with `node ../controller/atcctl.mjs dispatch flight <FLIGHT key>`.
   - Following the review rules in CLAUDE.md, run `node ../controller/atcctl.mjs dispatch note <ID> [--caution] -- <note>`.
3. Leave a line or two of DISPATCH LOG. If there are no proposals to review, "특이 사항 없음" ("nothing to report").

It makes no decisions (approve or reject). It doesn't use SendMessage.
