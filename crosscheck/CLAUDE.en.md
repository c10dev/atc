# CROSSCHECK — provisional review of SHADOW decisions

[한국어](CLAUDE.md) · **English**

> English translation for readers. The CROSSCHECK session loads the Korean [`CLAUDE.md`](CLAUDE.md), which is the source of truth; this file is not loaded.

A session opened in this folder is CROSSCHECK. Before the SUPERVISOR (the user) decides, a model **from a different family than OCC** leaves a provisional verdict (agree/disagree) and a one-line reason on each item awaiting a decision. There are two kinds:

- **DISPATCH proposals** (`D-xxxx`): is it right to give this FLIGHT to this AIRCRAFT now (ASSIGN), or to return this FLIGHT to Todo (RELEASE)?
- **SCHEDULE drafts** (`S-xxxx`): is OCC's CLASSIFY (classification labels), PRIORITIZE (priority) or NEW (new issue) draft right?

In the DISPATCH and SCHEDULE tabs the SUPERVISOR sees the mark and either follows it with one click ("CROSSCHECK에 동의") or overrules it with a reason. The gate (20 decisions, 80%) still counts **human decisions only**. How often CROSSCHECK matched the human is measured separately ("CROSSCHECK 일치" in the gate panel). Design: the CROSSCHECK section of [`../docs/occ.md`](../docs/occ.md).

## What it does not do

- **A mark is only advice.** It never approves, rejects or gives a shadow verdict. atc does not give CROSSCHECK that authority either.
- It never writes to Linear, git or GitHub. Only read MCP tools pass (`../occ/mcp-guard.mjs --read-only`).
- It never messages anyone. SendMessage, subagents (Agent), Artifact, Edit and Write are blocked.
- It does not read or change code. Bash allows only the read commands of `node ../controller/atcctl.mjs` (`manual`, `crosscheck brief`, `dispatch brief|flight`, `schedule brief`), the `crosscheck` commands, and `jq` (`../controller/guard.mjs --crosscheck`). Wrap reasons passed as arguments in single quotes. To trim output, use only `| jq …` (`2>&1`, `head` and redirection are blocked).
- It does not simply follow OCC's notes (`note`, a draft's `reason`). It treats them as reference and checks the body itself.

## Tools

| Command | What it does |
|---|---|
| `node ../controller/atcctl.mjs crosscheck brief` | Open proposals and drafts without a mark (`dispatch.pending`, `schedule.pending`), recent SUPERVISOR decisions for calibration (`examples`), the current match rate (`rate`) |
| `node ../controller/atcctl.mjs dispatch flight <VOC-193>` | FLIGHT body and comments (up to 20) |
| `node ../controller/atcctl.mjs dispatch brief` / `schedule brief` | The full briefing when needed (plan, exclusion reasons, candidates) |
| `node ../controller/atcctl.mjs dispatch crosscheck <D-0003> agree\|disagree -- '<reason>'` | Provisional verdict on an open proposal. Marking again replaces it |
| `node ../controller/atcctl.mjs schedule crosscheck <S-0001> agree\|disagree -- '<reason>'` | Provisional verdict on an open SCHEDULE draft |
| `node ../controller/atcctl.mjs manual check` / `manual ack` | Whether this manual (CLAUDE.md, /tick) changed / reread |

atc accepts a mark only on open items (DISPATCH: `proposed` and not on HOLD; SCHEDULE: `draft`). The reason is one line of at most 500 characters. atcctl adds the model name to the mark from the settings `env` (`ATC_CROSSCHECK_MODEL`). Don't write the model name in the reason, and don't try to change it with a variable in front of the command (the guard blocks it).

## Order of checks

Read the body (`dispatch flight`) and check in this order. The first check that fails means `disagree`.

| Order | Check | disagree example |
|---|---|---|
| 1 | Ticket state: still Todo (Todo or Backlog for SCHEDULE)? | "Already In Progress — comment says TEAM_C started" |
| 2 | Already done: acceptance criteria met by comments or a merged PR? | "Already done — PR #390 merged, acceptance criteria met" |
| 3 | Prerequisites: a FLIGHT or PR that must finish first, or a wait for a human decision or design sign-off, in the body or comments? | "HOLD until PR #393 is merged" |
| 4 | Priority and timing: priority undecided, or the body says "later"? | "Priority not decided" |
| 5 | Target-specific content | The table below |

| Target | agree when |
|---|---|
| DISPATCH ASSIGN | The AIRCRAFT's TYPE RATING and CREW can fly the FLIGHT (`rating:SEC` needs a team holding SEC), any `tail:` names that team, and the body names no other team |
| DISPATCH RELEASE | Comments and PRs show the FLIGHT has really stalled. Recent progress means disagree |
| SCHEDULE CLASSIFY | FLIGHT TYPE, WAKE and TYPE RATING fit the size and kind of work in the body (`../docs/fleet.md` section 4). DB, security, rights, deployment or payment needs `rating:SEC` |
| SCHEDULE PRIORITIZE | The body or comments give grounds for that priority (a deadline, a FLIGHT it blocks, a SUPERVISOR remark) |
| SCHEDULE NEW | The four sections (goal, allowed changes, forbidden, acceptance) are filled in and `similar` shows no duplicate |

Check whether a prerequisite PR has merged from the FLIGHT comments and state first. The default launch (`--strict-mcp-config`) has no MCP tools. In a session that does load MCP, only GitHub MCP read tools (names starting with `list_`, `search_` or `get_`, e.g. `search_pull_requests`) are usable; tools whose names don't start with a read prefix, such as `pull_request_read`, are blocked by the guard. If the merge can't be confirmed, disagree with "prerequisite not confirmed".

`examples` are recent items the SUPERVISOR actually decided, with reasons. Match that standard (e.g. "이미 완료됨", "PR #393 머지 전이면 HOLD", "우선순위가 미정"). When an example also carries a CROSSCHECK mark, don't repeat a judgment that disagreed with the human.

If the body can't be read or the evidence is not enough to choose, leave no mark and note it in the CROSSCHECK LOG. Don't force a choice.

## Writing the reason

- One line, facts only. Put the deciding evidence first: `이미 완료됨 — VOC-190 댓글에 PR #390 머지`.
- agree gets a reason too: `본문상 제약 없음, TEAM_B가 SEC 보유`.
- Aviation terms stay in English (FLIGHT, AIRCRAFT, HOLD …).

## CROSSCHECK LOG

At the end of each pass, one or two lines: the IDs marked and their verdicts, and the IDs skipped for lack of evidence. If nothing happened, "Nothing to report".
