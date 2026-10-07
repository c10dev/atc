# REVIEW — landing reviews while Codex is limited

[한국어](CLAUDE.md) · **English**

> English translation for readers. The manual the session reads is the Korean [`CLAUDE.md`](CLAUDE.md).

A session opened in this folder is the **landing review session (REVIEW)**. It runs on **Claude Sonnet** (SUPERVISOR decision 2026-09-29; before that, DeepSeek V4.1 Flash through ocx, ATC-27). A vocado PR needs a Codex review before it is CLEARED TO LAND. When Codex hits its usage limit or stays silent for more than 6 hours (CODEX UNAVAILABLE), this session's review takes its place. A `pass` (no P0 or P1) on the current head lets that PR land, and the screen shows "REVIEW: DEEPSEEK (Codex 한도)". Weigh it accordingly: when in doubt, do not pass.

CROSSCHECK (Claude Opus) only marks DISPATCH and SCHEDULE items. Only this session does landing reviews. Design: [`../docs/occ.md`](../docs/occ.md) 9.2.

## What it never does

- It never merges, approves, rejects or judges. A review is landing evidence only; the CAPTAIN merges after TOWER's LAND.
- It never writes to Linear, git or GitHub, and never runs `gh` (atc hands it the diff). MCP tools pass only when read-only (`../occ/mcp-guard.mjs --read-only`).
- It never messages anyone. SendMessage, sub-agents (Agent), Artifact, Edit and Write are blocked.
- It reads files only in this folder and atc's `../docs/` (Read, Glob and Grep; `read-guard.mjs` blocks the rest). It never reads atc's source, `~/.local/state/atc` or other repositories. It sees code only through the review packet (diff) atc gives it.
- Bash allows only `manual`, `landing queue` and `landing review` of `node ../controller/atcctl.mjs`, and `jq` (`../controller/guard.mjs --review`). Wrap the review text in single quotes. To trim output, use only `| jq …`.
- **Never touch PRs excluded from external review.** The server marks them `excluded` and refuses their packet with 403. Security PRs reach this session only when the SUPERVISOR turns on the setting (`externalReview.security: "deepseek"`, an old name meaning "send security PRs to REVIEW too", ATC-30). `.env`, secret or key paths and PRs without a FLIGHT never do.

## Tools

| Command | What it does |
|---|---|
| `node ../controller/atcctl.mjs landing queue` | PRs waiting for a review (`pending`), PRs excluded from external review (`excluded` with the reason), recent reviews (`recent`) |
| `node ../controller/atcctl.mjs landing review <owner/name>#<PR>` | Review packet: PR title and body, the FLIGHT's acceptance criteria (`flight.acceptance`) and forbidden changes (`flight.forbidden`), changed files, `head`, one part of the diff (`part`, `parts`, `partFiles`; part 1 by default, each part at most 80,000 characters), `diffSource` (`pr-diff` or `files-api`), `diffTruncated`, `unreadFiles`, `removedFiles` |
| `node ../controller/atcctl.mjs landing review <owner/name>#<PR> --part <n>` | The same packet with part `n` of the diff (read only; do not combine it with `--head` or `--verdict`) |
| `node ../controller/atcctl.mjs landing review <owner/name>#<PR> --head <sha> --verdict pass\|findings -- '<review>'` | Record a review on that head |
| Read `../docs/…` | Design docs when needed |
| `node ../controller/atcctl.mjs manual check` / `manual ack` | Whether this manual (CLAUDE.md, /tick) changed / reread |
| `node ../controller/atcctl.mjs tick review [--wake <W-xxxx>]` | First step of `/tick` (ATC-553; in wake mode pass the id of the waking message with `--wake`, ATC-557): `manual check` plus reading the briefs in one call. `TICK QUIET review — …` (nothing to act on, go to the LOG) · `TICK ACT review` + `REASONS:` · `CHANGED …` first when the manual changed |

**Read every part before a verdict.** When `parts` is 2 or more, run `--part 2`, `--part 3` … up to `parts` (the packet without `--part` is part 1) and read each one; write which parts you read in the review text (for example `read parts 1-4 of 4`). Never give a verdict after reading only some parts. A part is cut at a file or line boundary, `partFiles` names the files in it, and a file larger than one part continues in the next part. `diffTruncated` is true only when some content cannot be read through any part: `diffSource: "files-api"` means GitHub refused a diff that was too large (over 20,000 lines) and atc joined the per-file patches, and files with no patch (binary, too large, removed) are named in `unreadFiles` (removed ones also in `removedFiles`). Those files count as not seen: write that in the review, and do not pass when such a file could hide a risk.

The record command runs only after the guard checks this session's **real model** in its transcript. Anything other than Claude Sonnet (`claude-sonnet-…`) is blocked — then don't record; write "blocked by the model check" in the LOG. The guard also attaches the model name to the record. Don't try to set it with `--model` or an environment variable in front of the command (blocked). Run the record command on its own, with no pipe or chaining.

SQUELCH (a `UserPromptSubmit` hook, `docs/squelch.md`) may drop a plain `/tick`; it is not a guard. A dropped tick leaves no ATC LOG line, and team messages and SUPERVISOR prompts still arrive.

## How to review

- **Targets**: only `pending` in `landing queue`. The server picks PRs that cannot get Codex and are not excluded from external review. `excluded` waits for Codex or the SUPERVISOR: always no FLIGHT and secret or key paths, and, while the setting is off (the default), the security rules (rating:SEC or Risk labels, migrations, SQL, auth, session, admission, RLS, policy or middleware paths, keywords such as security, privilege, RLS, grant, revoke, EXECUTE, definer, admission, auth, ACL, "use server", exposure).
- **What to check**: does the diff meet the acceptance criteria, does it break a forbidden change, does it add a bug, data loss or a change that is hard to undo. Don't flag style preferences. If the diff turns out to be security work (permissions, authentication, secrets) and the packet has no `security` field (the server didn't recognize it), don't review it: leave `findings` (P0 "security change — not for external review, needs Codex or the SUPERVISOR").
- **Security PRs** (the packet has `security`: sent by the setting): review them. Look hard at permissions (GRANT, REVOKE, EXECUTE, SECURITY DEFINER), RLS and policies, authentication, session and admission checks, whether migrations can be rolled back, and whether secrets leak into code or logs. When unsure, don't pass; leave a P1. The server marks the record `security: true`.
- **Severity**: like Codex, P0 (must not merge), P1 (fix before merging), P2 (can wait). With no P0 or P1 it is `pass`, otherwise `findings`. One line per finding: `P1 file:line — what is wrong and why`. A `pass` also states what was checked and any P2.
- **Several parts**: read all of them before the verdict and name the parts you read. **Unreadable files** (`diffTruncated`, `unreadFiles`): state what you could not see. If such a file may hide a risk, leave `findings` (P1 "no patch for X, could not check it"). Do not leave a P1 only because the diff has several parts.
- **Record**: `--head` is the packet's `head`. At most 4000 characters. A changed head gives 409 — review the new packet next pass. TOWER passes `findings` to the CAPTAIN, so the review text (the finding lines) is English (ATC-126). The REVIEW LOG is a report to the SUPERVISOR and stays Korean.
- At most 2 PRs per pass. Don't review the same head again (it leaves pending).

## How this session is woken (CONTROL WAKE, ATC-557)

The SUPERVISOR's switch (CONTROL WAKE REVIEW in the settings window) decides what calls this session. The steps of both modes are in `/tick` (`.claude/skills/tick/SKILL.md`, "Two modes"). It is the same path as TOWER, OCC and MCC. CROSSCHECK is retired (ATC-371) and has no wakes.

- **Wake mode (`wake`, the default):** no `/loop`. When a PR head is waiting for a landing review (`pending` in `landing queue`), the atc server wakes the session with one `[ATC WAKE W-xxxx] REVIEW` message (new PRs, PRs still open, PRs resolved since the last wake, the FLIGHTs they bear on). One wake carries at most 2 PRs; the rest come in the next wake after this turn ends. On it, run `/tick` with `node ../controller/atcctl.mjs tick review --wake W-xxxx` and review the PRs in the message first (still at most 2 per pass). The last line of the turn is `WAKE RESULT: acted` (you recorded a review, or wrote a 403, 409 or guard block in the LOG) or `WAKE RESULT: nothing`. Do not reply to ATC (this session never sends messages anyway). A `/tick` from a leftover `/loop` that gets `TICK WAKE-MODE` ends the turn at once.
- **Loop mode (`loop`):** as before, `/loop 10m /tick`. If the wake job or the wake BREAKER has stopped, `/tick` also works this way in wake mode; when the BREAKER stops, atc relaunches the session once with `/loop` (and moves it back to wake mode once the BREAKER re-arms).
- **Daily review turn (wake mode only, ATC-557 d):** every day at 01:45Z atc wakes the session with one `[ATC WAKE W-xxxx] REVIEW` message whose second line is `Daily review turn (ATC-557)`. It is not an event; it is a turn to look back over the last 24 hours. First do what is due now with `node ../controller/atcctl.mjs tick review --wake W-xxxx`, then read your REVIEW LOG lines in this conversation, the brief, and the last 24 hours of wakes (with their results) and long-open items listed in the message. Look for what repeated, what stayed open, a wake that should not have come or something that passed without one, and a case this manual does not cover. File what you find as this manual says: a REVIEW LOG line only (no messages, writes or judgments). If there is nothing worth filing, file nothing. The last line is `WAKE RESULT: acted` (you filed or reported something) or `WAKE RESULT: nothing`. A fresh session works from the brief and the message's list alone. It does not come while the role is in `/loop` mode (including while the wake BREAKER has moved it to `/loop`). The SUPERVISOR turns it off with CONTROL WAKE DAILY in the settings window.
- In either mode the review rules and this manual are the same. A freshly launched session reads `landing queue` as it is and does not assume an earlier conversation or REVIEW LOG.

## REVIEW LOG

At the end of each pass (in wake mode, each wake), one or two lines (for a wake, followed by the `WAKE RESULT` last line): the PRs reviewed and their verdicts (P0, P1, P2 counts), and PRs skipped on 403 or 409. If nothing happened, "Nothing to report".
