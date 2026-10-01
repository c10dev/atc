# Research: what fills a control session's context, and ways to keep it small

**English** · [한국어](control-context.ko.md)

> Status: SURVEY for [ATC-274](https://linear.app/vocado/issue/ATC-274), 2026-10-01. Nothing here changes a manual, guard, hook, timer, setting or session. Section 3 is a recommendation for the SUPERVISOR; nothing in it is decided or built.

Related: [control-recycle.md](../control-recycle.md) (the STOP + LAUNCH design and its section 1 facts, reused here and not redone), [squelch.md](../squelch.md), [mcc.md](../mcc.md) (INSPECTION in a fresh sub-agent context, ATC-135), [duty.md](../duty.md) (server-spawned `claude -p`, D2), [fuel.md](../fuel.md), [lost-comms-and-contingency.md](lost-comms-and-contingency.md) (section 7, position handover).

## Question

TOWER, OCC, MCC, CROSSCHECK and REVIEW run `/loop <n>m /tick` for days. CONTROL RECYCLE answers the growth with STOP + LAUNCH at a cap. This survey asks what the context is made of, how fast it fills, what that costs, and which of 16 listed options (and some new ones) would keep it small.

## Method and limits

- **Transcripts.** Usage fields, record types, block types, tool names, timestamps and text *lengths* only. No message text was copied here. Window: every transcript of the five control folders on 2026-09-26 .. 10-01 across the three account folders (`~/.claude`, `acct-1`, `acct-3`): 16 TOWER, 13 OCC, 13 MCC, 6 CROSSCHECK and 3 REVIEW sessions with at least 50 requests. Requests are folded per message id (last snapshot wins); sub-agent requests are not in these files. Context = `input + cache_read + cache_creation`, the same sum as `mcc/context-cap.mjs`.
- **Tokens from characters.** Transcripts hold text, not tokens. The measured ratio (context growth between two requests vs. characters written between them, 12,000 steps) is **2.0 chars/token for TOWER, 1.7 OCC, 1.8 MCC, 2.6 CROSSCHECK, 3.3 REVIEW**, much lower than the usual 4, because the manuals and logs are mostly Korean and JSON. Token numbers below use these ratios; shares are of characters and do not need them.
- **Prices** from `server/fuel-prices.json` (list price, per million tokens: Sonnet 5.5 in 2 / out 10, Opus 5.5 in 4 / out 20, read 0.1× and 0.05× input, 1-hour cache write 2× input). The transcripts show the 1-hour cache tier for every main-thread write. CROSSCHECK and REVIEW run non-Anthropic models through `ocx`; those requests have no price here, so their dollar rows are partial. These are list-price equivalents of plan usage, not an invoice.
- **Experiments** (scratch only: Haiku in empty temporary folders and one scratch `--bg` job in a worktree sub-folder; Claude Code **2.1.286**; no control or team session was stopped, started, compacted or messaged; nothing in `~/.local/state/atc/` was written). Total spend **about 1 USD** (about a dozen small Haiku runs 0.4 USD, the headless feature check by a sub-agent about 0.3 USD, one stuck scratch job under 0.1 USD).
- **Unverified** is written where a claim rests only on documentation read by a helper agent, or was not tested.

## 1. Current facts

### 1.1 The floor: what every request carries before any tick

| Part | Tokens | How measured |
|---|---|---|
| System prompt and the built-in tool schemas (29 tools, `--strict-mcp-config`, Haiku) | **22.5 k** | `claude -p` in an empty folder, `usage` |
| Same with the account's claude.ai connectors loaded (206–269 tools) | 27–30 k | same; the set varies between runs, which also breaks the shared cache prefix |
| Root `CLAUDE.md` | **+7.1 k** | same run with that file copied in |
| Folder `CLAUDE.md` | **+6.4 k** (TOWER), **+8.4 k** (OCC) | same, replacing the root file |
| Skill listing, deferred-tool names, hook and plugin context, memory index | about **20 k**, not split further | observed first request minus the rows above |
| **First request of a LAUNCH, median** | **59 k** TOWER · 64 k OCC · 44 k MCC · 42 k CROSSCHECK · 37 k REVIEW | transcripts |

So a fresh session starts at 40–65 k. Any scheme that keeps context "small" has this floor under it, and the 20 k in the last row is the largest part nobody has looked at.

### 1.2 How fast it grows, and from what

Growth per hour of long sessions (re-measured, agrees with ATC-165): TOWER 41 k median (17–150), OCC 47 k (6–260), MCC 42 k, CROSSCHECK 31 k, REVIEW 10 k.

**A tick is mostly idle and mostly re-reading.** A tick is one `/loop` fire. "Busy" means it sent a message or ran a write command (`issue`, `readback`, `dispatch note|crosscheck|release|report`, `mcc inspect|land|rts`, `landing review`, SCHEDULE draft/mark, `SendMessage`).

| Role | Ticks that reached the model | per hour | Idle ticks | Requests per idle / busy tick (median) | Cache-read per idle / busy tick | Context growth per idle / busy tick (median, mean) | Idle share of growth / of tokens read |
|---|---|---|---|---|---|---|---|
| TOWER | 1,779 | 15.6 | 88 % | 3 / 7 | 0.62 M / 1.40 M | 1.1 k, 2.6 k / 3.9 k, 6.6 k | 75 % / 79 % |
| OCC | 626 | 5.8 | 71 % | 3 / 9 | 0.92 M / 1.94 M | 1.0 k, 1.8 k / 7.9 k, 11.1 k | 28 % / 51 % |
| MCC | 701 | 10.8 | 64 % | 2 / 5 | 0.33 M / 1.13 M | 0.7 k, 0.7 k / 4.2 k, 8.8 k | 12 % / 30 % |
| CROSSCHECK | 510 | 5.9 | 88 % | 3 / 6 | 0.56 M / 0.75 M | 3.9 k, 3.1 k / 7.5 k, 11.9 k | 66 % / 81 % |
| REVIEW | 436 | 6.4 | 95 % | 2 / 9 | 0.16 M / 0.45 M | 0.3 k, 0.4 k / 18.9 k, 20.1 k | 28 % / 86 % |

(MCC "busy" includes the repeated shadow-mode `mcc land` and `mcc rts` calls of squelch.md 1; this window is partly before SQUELCH.)

The usual TOWER idle tick is three tool calls and so three requests: `manual check`, `brief`, `ack` (29 % of TOWER ticks are `manual check > ack`, 23 % `manual > brief > ack`). Each request re-reads the whole context. REVIEW, CROSSCHECK and MCC ticks are mostly two calls (`manual`, then the queue or brief); 78–91 % of CROSSCHECK and REVIEW ticks have two tool calls or fewer.

**What the growing part is made of** (share of characters written per session, leaving out the once-per-session blocks such as system and instruction snapshots, skill and tool listings):

| Role | `atcctl` output | `/tick` body re-injected | Hook output¹ | Read output | Incoming messages | `gh` output | Model text, thinking and tool calls |
|---|---|---|---|---|---|---|---|
| TOWER | **54 %** | **15 %** | 3 % | 0 | 2 % | 0 | 14 % |
| OCC | 17 % | **33 %** | **17 %** | 7 % | 4 % | 0 | 15 % |
| MCC | 16 % | 13 % | **19 %** | 11 % | 9 % | 6 % | 19 % |
| CROSSCHECK | **66 %** | 15 % | 2 % | 10 % | 0 | 0 | 5 % |
| REVIEW | 37 % | 15 % | 7 % | 3 % | 0 | 0 | 29 % |

¹ Hook records are transcript attachments; whether the `hook_success` ones reach the model's context was not tested (**unverified**). `hook_additional_context` does: OCC's `PreToolUse:SendMessage` guard adds it on every `SendMessage` (151 records, about 2.6 k characters each).

**The `/tick` skill body is re-injected on every tick.** Each loop fire writes the whole skill body again as a user record (TOWER about 170–220, OCC about 1,700–1,900, MCC about 280–310, CROSSCHECK about 420–500, REVIEW 254 "chars/4 units", plus an 18-unit command record). It is not collapsed to a note. A helper agent read the docs as saying an identical re-invocation appends only a short note; for a `/loop`-fired `/tick` the transcripts show the opposite (**the docs reading is unverified for the Skill tool and contradicted here for the loop**). Converted with the ratios above:

| Role | Body per tick (tokens) | Ticks per hour | Re-injected per hour | Share of the hourly growth |
|---|---|---|---|---|
| TOWER | ≈ 440 | 15.6 | **6.9 k** | 17 % |
| OCC | ≈ 3,200 | 5.8 | **18.5 k** | **39 %** |
| MCC | ≈ 870 | 10.8 | 9.4 k | 22 % |
| CROSSCHECK | ≈ 770 | 5.9 | 4.5 k | 15 % |
| REVIEW | ≈ 310 | 6.4 | 2.0 k | 20 % |

OCC's `/tick` is 12 KB (11.9 KB, Korean) against 1.7 KB for TOWER's. The folder `CLAUDE.md` is loaded once, so a body that is a pointer to it would cost one line per tick. SQUELCH changes how many ticks arrive, not how big each is.

**SQUELCH is working but does not remove the growth.** It has been `on` since about 2026-09-30 07:47Z. Since then the share of fires it dropped is TOWER 28 %, OCC 29 %, MCC 63 %, REVIEW 79 %, CROSSCHECK 81 % (`squelch.jsonl`, non-shadow lines). TOWER and OCC fingerprints open on events that are real but small, and sessions measured after SQUELCH went on still grow 17–150 k/h (TOWER) and 29–260 k/h (OCC).

### 1.3 What it costs

Dollar figures are list-price equivalents for the priced requests of each role (Anthropic models only).

| Role | Model mix | Mean context | Requests/h | $/h | of which read / write / output |
|---|---|---|---|---|---|
| TOWER | Sonnet 5.5, Sonnet 5, some Opus | 289 k | 42 | **2.82** | 2.43 / 0.29 / 0.10 |
| OCC | Sonnet 5.5, Sonnet 5, some Opus | 332 k | 26 | **2.15** | 1.73 / 0.32 / 0.11 |
| MCC | Opus 5.5 | 234 k | 37 | **2.56** | 1.70 / 0.64 / 0.22 |
| CROSSCHECK, REVIEW | non-Anthropic via `ocx` | 208 k, 155 k | — | partial | cache read dominates |

**80–86 % of a TOWER or OCC hour is cache reads** (12 M tokens/h for TOWER), 10–25 % cache writes, 3–9 % output. Three roles together are about 7.5 USD/h at list price, about 180 USD a day. The model decides little: Opus 5.5's read price (0.05 × 4) equals Sonnet 5.5's (0.1 × 2), so MCC saves only on writes and output by changing model.

A simple "recycle at a cap" model, replaying the measured growth with a restart that re-writes the 44–64 k floor each time, gives these costs as a share of today's (today's regime: caps 500 k for TOWER and OCC, 150 k MCC, with the recorded 12 recycles in two days):

| Cap | TOWER | OCC | MCC | Restarts per hour (TOWER / OCC / MCC) |
|---|---|---|---|---|
| 100 k | 46 % | 49 % | 34 % | 2.0 / 2.0 / 1.1 |
| 150 k | 42 % | 40 % | 37 % | 0.8 / 0.8 / 0.6 |
| 250 k | 50 % | 47 % | 44 % | 0.3 / 0.3 / 0.2 |

Keeping a session under about 150 k halves the bill, and no cap goes much below 40 % because of the floor and the re-writes. One recycle in the FLIGHT RECORDER (`launch-failed` on 2026-09-30 12:19Z) left TOWER down; there were 12 successful ones and 3 shadow `would` lines between 09-30 07:22Z and 10-01 01:27Z.

### 1.4 What a session needs from its own past

[control-recycle.md](../control-recycle.md) 1.2 holds the per-role tables; the conclusion there stands: all durable state is in the server, and only small items live in the conversation alone (TOWER's FUEL "already told" keys and RESEND memory, OCC's open CHARTER REQUEST, now covered by `schedule wip`). That is why **stateless** designs are viable at all. What the five roles do each tick is very regular: 103 distinct tool-call sequences over 1,607 TOWER ticks, 59 over 497 CROSSCHECK ticks, 33 over 419 REVIEW ticks; the commonest sequences are "check the manual, read the brief, ack".

### 1.5 Experiments (scratch, 2.1.286)

| Question | Result |
|---|---|
| Is the cache shared between separate `claude -p` runs? | **Yes.** A second identical run read 22,490 of 22,500 tokens from cache (0 written). On this account headless writes use the **1-hour tier**, so a tick every 3–10 minutes keeps its prefix warm. When the tool set differs between runs (connectors loaded or not) only the shared prefix hits (18 of 29 k) |
| Do the guards (`PreToolUse` hooks) run for a sub-agent's tool calls? | **Yes** (project settings). The hook input carries `agent_id` and `agent_type` for a sub-agent call and not for the parent, so a guard can tell them apart |
| Does a sub-agent have `SendMessage`? | **Yes**, as a deferred tool (found through `ToolSearch`). Whether such a send reaches a session on another ACCOUNT was not tested (ATC-251 says no for sessions) |
| Is `SendMessage` available in `claude -p`? | The tool is in the list. Delivery to a real session was not tested (no messages to real sessions) |
| Does a prompt `/compact <instructions>` work headless? | **Yes**, on a resumed session: `compactMetadata` `trigger: manual`, 22.8 k → 0.9 k tokens, and the model still answered with the kept facts. The record is the same one auto-compact writes |
| Does `/compact` work when a cron or `/loop` fire delivers it? | **Not established.** The one scratch `--bg` attempt went `blocked` before any fire (cause not examined); **unverified** |
| Auto-compact threshold env var, hook-triggered `/compact` or `/clear`, tool-result clearing | Not documented as available in Claude Code (helper agent, docs of 2026-10-01): **unverified**, and the only one measured is the real auto-compact (9 runs in the ATC-165 window, all `auto`: 4 at about 800–970 k, 5 in REVIEW at about 170 k) |
| Prices | Standard rates across the whole 1M window, no long-context surcharge (docs, per helper agent; **unverified**) |

## 2. The options

Savings are estimates from the model in 1.3 (read price × context × requests), per role, relative to today. "Shadow" means it can run beside the live session writing nothing. "CC" is Claude Code.

| # | Option | Saves | Loses, risks | Effort | Shadow | Verdict |
|---|---|---|---|---|---|---|
| 1 | Thinner briefs (tick cards: only actionable items, deltas, hard caps) | `atcctl` output is 54 % (TOWER) and 66 % (CROSSCHECK) of growth; a card half the size slows growth about 25–30 % | A card that hides something needed; cards must be tested against real briefs | M (server views + manuals) | yes (write both, compare) | **Build, after 5′** |
| 2 | `/tick` body as a one-line pointer to `CLAUDE.md` (loaded once) | 6.9 / 18.5 / 9.4 / 4.5 / 2.0 k tokens/h (17–39 % of growth); no extra request | Rules move from the per-tick prompt into the memory file; a rule far above in a 300 k context is followed less well, and `CLAUDE.md` is also paid in the floor (6–8 k) | S (edit five SKILL.md and the CLAUDE.md order) | yes (a scratch loop with both) | **Build first** |
| 3 | Output discipline: caps on `gh` and `atcctl`, short LOG lines, no echo of sent messages | `gh` is 6 % (MCC) and Read 7–11 % (OCC, MCC); the OCC `SendMessage` guard context 17 % of OCC growth | Truncated evidence | S | yes | **Build with 1** (guard text: see work order 7) |
| 4 | Wake on events only | SQUELCH already drops 28–81 % of fires; real event wake is not offered by `/loop` (docs: fixed or model-chosen interval; channels are separate; **unverified** for this use) | None new | — | — | **Reject the new mechanism; keep SQUELCH and tune** (heartbeat 50 min already sits under the 1-hour cache tier) |
| 5 | Stateless ticks: the server runs each tick as a fresh `claude -p` with the brief | Floor read per request only: TOWER 15.6 ticks/h × 1.7 requests × 59 k at 0.2 USD/M, plus the tick's new tokens and output = **0.6 USD/h vs 2.82** (21 %), OCC 21 %, MCC 30 % | The cache between runs holds (1.5), but the run needs: a send path (the tool exists in `-p`, delivery to real sessions and across ACCOUNTs untested; ATC-251), guards in `-p` (there is no prompt to answer: allow list and guard only), a headless runtime in the server (DUTY D2 is the precedent), identity for the replies, and a rebuild of the small conversation-only memories (1.4) | L | yes, with sends off | **Shadow first for CROSSCHECK and REVIEW** (no send, no conversation state), then TOWER idle path |
| 5′ | **Composite tick command** (new): one `atcctl tick` doing manual check, brief and ack-when-empty | Idle ticks 3 requests → 1: TOWER reads **−51 %**, OCC −30 %, MCC −21 % at the same context | One command can hide a step; the ack moves server-side | S–M | yes | **Build first** |
| 6 | Sub-agent ticks: the long session hands the tick to a fresh-context sub-agent and keeps one line | Parent grows about 0.6 k/tick instead of 2.6 k; est. TOWER 35 %, OCC 28 %, MCC 41 % of today's cost | Guards run for sub-agents (1.5) and `SendMessage` exists, but the parent still re-reads its context twice per tick, and a sub-agent starts without the folder state; ATC-135 (MCC INSPECTION) is the precedent and already runs this way for the heavy step | M | partly (a second session) | **Use for heavy steps only** (INSPECTION-style), not for every tick |
| 7 | Rule-following work into the server (no model) | TOWER idle ticks are 88 % of its ticks and 79 % of its reads; a server that handles "nothing to do" removes them | Today only sessions can `SendMessage`; GO AROUND and INFO text must be sent by a session, so the server can decide and record but not deliver; OCC and MCC keep judgment | L (it is SQUELCH grown into a rule engine) | yes (record "would have done") | **Do the part SQUELCH already is** (drop idle ticks); defer actions until a server delivery path exists |
| 8 | Scheduled `/compact` with role instructions instead of STOP + LAUNCH | Cost like a recycle at the compaction point, no new session, same job id and socket | Works headless on a resumed session (1.5). Under `/loop` untested. A summary of a rule-following role is only as good as the instructions; atc's 9 auto-compacts (to 10–22 k) gave no outcome data. A compact fires a cache miss on the summary | M | needs a scratch loop test | **Probe in a scratch loop first** (work order 8) |
| 9 | CC context controls | Auto-compact threshold env, hook-triggered `/compact`, tool-result clearing, `/clear`: not documented in Claude Code (**unverified**) | — | — | — | **Nothing to build; recheck after upgrades** |
| 10 | Self-summary handover before recycle | A recycle that starts from a card instead of cold | The summary is written by a session that is over its cap and is in the same state that made it long; ATC-165 shows what is lost is small and server-side | M | yes | **Replace by 11** (server writes it) |
| 11 | Position relief briefing generated by the server | Makes recycles cheap and safe so caps can drop to 150 k; closes the gaps of control-recycle 1.2 (TOWER FUEL keys, RESEND) | Another summary to keep right; aviation says the *leaving* position writes it from the record before it stops ([lost-comms](lost-comms-and-contingency.md) section 7, F8) | M | yes | **Build, after 2 and 5′** |
| 12 | Overlap handover (new session shadows, then the old stops) | No gap, no double send | Two sessions on one frequency for a tick; guard needs a read-only mode; launch limit and ACCOUNT headroom; more complex than 11 | L | — | **Reject now** (11 gives most of it) |
| 13 | Time-based shifts instead of caps | A shift of 4 h at today's growth ends at 200–250 k, similar to a 250 k cap | Fixed cost when idle; doesn't track growth | S | yes | **Reject**; keep caps, and add a maximum age only as a backstop |
| 14 | Cheaper model for routine ticks, strong model for judgment | TOWER on Haiku halves the read price (0.1 vs 0.2 USD/M); Opus→Sonnet for MCC saves only write and output (read is the same) | Quality unknown per role; a model per step needs 5 or 6 | M | yes (compare decisions) | **Try after 5′ and 2** (when contexts are small a cheaper model costs little in quality; large contexts hurt cheap models most) |
| 15 | Fewer or smaller sessions (merge roles, split lanes) | Merging TOWER and MCC reads would share one floor but double each context | Different manuals, guards and intervals; one failure takes both | L | — | **Reject** |
| 16 | 1M vs 200k window | No surcharge; cost is linear in context, so no break-even exists except the compaction point | A bigger window only delays compaction | — | — | **Reject as a lever; choose it by cap** |
| N1 | **Hook output diet** (new) | OCC `SendMessage` guard context is 17 % of OCC growth (2.6 k chars per send) | Guard text is safety text; change needs the SUPERVISOR (guards fail closed) | S | — | **Ask the SUPERVISOR** |
| N2 | **Floor audit** (new) | 20 k of the 59 k start is unexplained (skill and tool listings, plugin and hook context); a 10 k cut is worth a 17 % cut on every request of every session | Needs scratch matrix runs | S | yes | **Do early** (work order 6) |
| N3 | **Lower the TOWER and OCC caps** (new, existing mechanism) | 500 k → 150–250 k: 50–58 % of today's cost (1.3) | More recycles (up to 19 a day at 150 k for TOWER) and the failure seen once (`launch-failed`) | S | already has `shadow` | **After 2, 5′ and 11**: a cap of 250 k first |
| N4 | **Heartbeat and SQUELCH tuning** (new) | TOWER and OCC fingerprints open on 71–72 % of fires | A missed event | S | yes (shadow lines) | **Later** |

## 3. Recommendation for the next two weeks

**What fills it.** Past the 40–65 k floor, the context grows 30–47 k per hour because every tick adds three things: the `atcctl` outputs (54 % of TOWER's growth, 66 % of CROSSCHECK's), the whole `/tick` body again (17 % TOWER, **39 % OCC**), and the guard and harness text. The cost is not the growth itself but the reading: 80–86 % of the money is cache reads, and an idle tick makes three requests that each read 300 k tokens to decide nothing.

**Build in this order**

1. **Option 2, `/tick` body to a pointer.** Hours of work, no new mechanism, removes 17–39 % of growth and about 18 k tokens/h in OCC. Do OCC first (3,200 tokens per tick).
2. **Option 5′, a composite `atcctl tick`** (manual check, brief and the empty-case ack in one call) per role, TOWER first. Cuts the requests on idle ticks from 3 to 1, which cuts TOWER's reads by about half at any context size.
3. **Option 1 with 3 (tick cards and output caps)**, once the two above have run a week: only then is it clear what each brief still adds.
4. **Option 11 (server-written relief briefing) and then lower caps (N3)**: TOWER and OCC to 250 k, MCC stays 150 k. Do not lower caps before this: today the recycle is a cold start and `launch-failed` happened once in 13 real attempts.
5. **Shadow, no send: stateless ticks (option 5) for CROSSCHECK and REVIEW**, which have no conversation state, run every 10 minutes through a headless run with the same brief; compare the marks and reviews with the live ones. Then decide about TOWER's idle path.
6. **Probe** option 8 (loop-delivered `/compact`) and the floor (N2) in scratch.

**Not now:** a cheaper model for TOWER (14: wait for small contexts), sub-agent ticks for every tick (6), overlap handover (12), time-based shifts (13), merged roles (15), a 1M window (16).

**Expected effect** (a model estimate, section 2 and 1.3), as a share of today's cost, for 5′ alone / 5′ with a 150 k cap: TOWER 56 % / 22 %, OCC 76 % / 30 %, MCC 86 % / 31 %. Option 2 comes on top of both and was not modelled.

**What to measure to know it worked** (all from the transcripts, per role, weekly, with the same scripts as this survey; see work order 1):

- cache-read tokens per hour and list-price dollars per hour (today TOWER 12 M and 2.8 USD, OCC 8.7 M and 2.2 USD, MCC 8.5 M and 2.6 USD);
- context growth per hour (today 41 k, 47 k, 42 k) and re-injected tokens per tick;
- requests per idle tick (today 3, 3, 2);
- recycles per day, `launch-failed` count and time between a stop and the next tick;
- correctness of the small memories: repeated RESEND, repeated FUEL reports, overdue CLEARANCEs and FLIGHT PLANs, dropped ARRIVED reports (all in records already);
- for shadow runs: agreement of stateless decisions with live ones on the same briefs.

## 4. Follow-up work orders (not created in Linear)

| # | Title | Scope | Expected tier |
|---|---|---|---|
| 1 | Context ledger: a read-only daily line per control role (tokens read/h, growth/h, requests per idle tick, $/h, recycles) | `server/` view over transcripts, reusing the ATC-165/ATC-274 methods and the READABILITY pattern; no manual change | auto |
| 2 | `/tick` body to a pointer (OCC first, then MCC, TOWER, CROSSCHECK, REVIEW) | the five `.claude/skills/tick/SKILL.md` and `CLAUDE.md`; shadow-check in a scratch loop first | user if the paths are under `.claude/`, else flagged (check `deploy/landing-tier.mjs`) |
| 3 | Composite `atcctl tick` per role, TOWER first | `controller/atcctl.mjs`, a server tick view, manuals; the guard allow lists must admit it | flagged (manual and CLI); user if a guard changes |
| 4 | Tick cards: brief views with deltas and size caps, `gh`/`atcctl` output caps | server views and manuals | flagged |
| 5 | Server-written relief briefing (F8) at recycle | server writes it from state before STOP; the new session reads it first | flagged |
| 6 | SURVEY: audit the 20 k floor (skill and tool listings, plugin and hook context) in scratch | scratch runs only | auto (docs) |
| 7 | OCC `SendMessage` guard context: shorten what it adds on every send | `occ/send-guard.mjs` text only, the checks unchanged | user (guard); ask the SUPERVISOR first |
| 8 | SURVEY: loop-delivered `/compact` and compaction quality for a rule-following role | scratch `--bg` loop; compare post-compact behaviour with a recycle | auto (docs) |
| 9 | Shadow stateless tick runner for CROSSCHECK and REVIEW (no send) | `server/` headless runner like DUTY D2; writes only a comparison log | flagged |
| 10 | SQUELCH tuning (TOWER and OCC fingerprints open 71–72 % of fires) | `server/squelch*.ts` fingerprints | flagged |
| 11 | Lower TOWER and OCC caps to 250 k | `control-recycle.json` through the settings window by the SUPERVISOR, after 2, 3 and 5 | n/a (SUPERVISOR setting) |

## 5. What this survey did not do

- It did not run a control or team session in any way, nor read any message text. All transcript work is counts and lengths.
- The sawtooth and option costs in 1.3 and section 2 are a model on measured inputs (growth, requests per tick, floor, prices), not a replay of a changed system. The five-role average chars-per-token is a regression; real tokens per tick for a given role may differ by tens of percent.
- It did not test a send from a headless run to a real session, `/compact` under a real `/loop`, or the quality of a compacted rule-following session.
