# OCC procedure: BRIEFING

[한국어](briefing.md) · **English**

> English translation for readers. The OCC session reads the Korean [`briefing.md`](briefing.md), which is the source of truth; this file is not loaded.

Procedure moved from [`CLAUDE.md`](../../../CLAUDE.en.md). Read it in `/tick` step 3, when a proposal in `open` or `held` has no `briefing`. `CLAUDE.md` sets the role and what OCC doesn't do.

## Commands

| Command | What it does |
|---|---|
| `node ../controller/atcctl.mjs dispatch briefing <D-0003> --what '<무슨 일>' --why '<왜 이 AIRCRAFT>' --risk '<걸리는 점>'` | The three plain lines at the top of the card (BRIEFING). Only for open and HELD proposals. Writing again replaces them. All three lines are required, each at most 300 characters |

## BRIEFING (the three lines at the top of a card)

The SUPERVISOR judges from the card alone, often without remembering the ticket. Separately from the note, for each proposal in `open` or `held` without a `briefing`, read the body and comments, then write three lines with `dispatch briefing`.

| Line | What to write |
|---|---|
| `--what` 무슨 일 | One plain Korean sentence on what changes when this is done. No code names, table names or abbreviations |
| `--why` 왜 이 AIRCRAFT | The one thing that explains this pairing: base AIRPORT, TYPE RATING, or a recent FLIGHT on the same ROUTE |
| `--risk` 걸리는 점 | Prerequisite FLIGHTs, risk (DB, permissions, deployment …), anything a person must decide. If none, "특별히 걸리는 점 없음" |

- One sentence per line, ideally under 80 characters. Facts only; no approve or reject opinion.
- PRIORITY, wait days, ROUTE and WAYPOINT, prerequisite states and recent FLIGHTs appear separately in the card's facts line, computed by the server (`briefs.<ID>.facts` in `dispatch brief`). Explain what they mean instead of repeating the numbers.
- Wrap each line in single quotes, and don't put a single quote, `$` or a backtick inside (the guard blocks them).
- Write again, replacing the lines, when you set or lift a HOLD or reread a changed body.
- A card without a BRIEFING shows the title and the first sentence of the body, marked "BRIEFING 대기" (waiting for a BRIEFING).
