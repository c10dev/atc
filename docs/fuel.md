# FUEL design (token burn per FLIGHT, leaks, and plan limits)

FUEL is the tokens a FLIGHT uses. atc records how long a FLIGHT took (block time, landing wait) and how well it went (rollbacks, LOS, Codex findings), but not what it burned, why some of that burn was waste, or how close each account is to its plan limit. FUEL adds those three things from records atc can already read.

> Status (2026-09-28): draft for ATC-46 (moved from GitHub idea #53, whose research comment is the source for the pricing and cache facts below). F1 is built (`server/fuel.ts`, `server/fuel-run.ts`, `GET /api/fuel`) and F2 (ACCOUNT label, `LIMIT` held by ACCOUNT) is built (ATC-51); the rest is not. Sections 8 and 9 hold the split into issues and the SUPERVISOR decisions this needs.

Related: [fleet.md](fleet.md) 8.3 (observed crew, never read bodies), 8.6 (FLEET PLAN, "Usage: none per AIRCRAFT"), 8.8 (AIRCRAFT health, `LIMIT` after a limit is hit); `server/logbook.ts` (LOGBOOK), `server/health.ts` (`quotaLimits`), `server/crew-observed.ts`; GitHub #41 (ontology graph projection, K1).

## 1. Current facts

Read on 2026-09-28 from local transcripts (field names and numbers only, no bodies), the atc code and `~/.claude/settings.json`. Nothing was written.

| Area | Today | What it means |
|---|---|---|
| Per-FLIGHT usage | None. LOGBOOK `arrived` lines have time and quality fields only | No way to say what a FLIGHT cost or compare teams by cost |
| Per-account limits | None. ATC-45 sees a `LIMIT` only after a session is refused (`quotaLimits.resetsAt`, `rateLimitType`). atc does not know which AIRCRAFT share an account | On 2026-09-28 TEAM_K's Pro account was nearly spent and atc could not tell |
| Where usage lives | Each assistant line in `~/.claude/projects/<cwd>/<sessionId>.jsonl` carries `message.usage` with `cache_creation.ephemeral_5m/1h_input_tokens`, plus `message.model`, `stop_reason`, `version`. CREW is in `<sessionId>/subagents/agent-*.jsonl` | Everything needed is on disk, read-only |
| Volume (last 7 days) | 176 main transcripts, 214 subagent files, 19,760 unique requests | A full scan is small enough for the LOGBOOK cycle |
| Duplicates | 47,796 assistant lines with usage for 19,760 unique `(message.id, requestId)`: 2.42 lines per request | Summing lines without dedupe inflates totals about 2.4× |
| Cache | Every request that wrote cache wrote the 1 h tier (15,809 requests, 0 at 5 m). Totals: 40.0 M uncached input, 83.6 M cache writes, 6,596 M cache reads, 14.1 M output. CACHE HIT (Σ read / Σ(input + write + read)) = 0.982 | Reads dominate the token count; writes and output dominate the cost. Show both |
| Models seen | `claude-opus-5-5` 15,431 requests, then DeepSeek and Muse routes (~3,800) and `claude-sonnet-5` 375 | The price table must know non-Anthropic routes or leave them out of cost |
| Transcript reading in atc | `readTail` reads the last 1 MB; ATC-45 reads the last 64 KB; `talkEventsFile` reads on from a byte offset | FUEL needs the offset reader, not the tail |
| Statusline | No `statusLine` is configured in `~/.claude/settings.json` | The plan-limit source #53 proposed (statusline `rate_limits`) is not wired and must be verified first |

## 2. Principles

1. **Measure from records, never from bodies.** Filter lines on `"usage"` / `"compact_boundary"` before parsing and drop `message.content` right after. Same rule as fleet.md 8.3 and 8.8.
2. **One request counts once.** Dedupe globally by `(message.id, requestId)`, falling back to `(message.id, sessionId, timestamp)`. Among copies, keep the non-sidechain one, then the larger token sum.
3. **Show, don't steer.** FUEL numbers are displayed next to TARGETS and in briefs. They never feed DISPATCH scores or assignments, except a plan-limit HOLD that the SUPERVISOR switches on (section 6).
4. **Tokens and cost side by side.** Cost uses a config price table; a model with no price is left out of cost with a warning, never guessed.
5. **Name the cause.** A leak is only counted with a rule that says why (cold cache, control wake, model switch …). Anything else is `UNEXPLAINED`, not blamed on a team.
6. **Accounts are declared, not discovered.** atc does not read credentials or account settings. The SUPERVISOR labels which account an AIRCRAFT flies on.

## 3. Terms

| Term | Meaning |
|---|---|
| FUEL | Tokens, counted as `input` (uncached), `cacheWrite5m`, `cacheWrite1h`, `cacheRead`, `output` |
| FUEL BURN | Actual use, CAPTAIN (main transcript) and CREW (subagents) separately |
| FUEL COST | The kinds combined by list price (nominal on subscription plans) |
| FUEL LEAK | Excess from re-writing context that was already cached: `rewritten × P_in × (writeMult − readMult)` |
| NET FUEL | FUEL BURN minus FUEL LEAK; TRIP FUEL learns from this |
| TRIP FUEL | Pre-departure estimate: p50–p90 of past NET FUEL COST for the same TYPE × WAKE |
| CACHE HIT | Σ `cacheRead` / Σ(`input` + `cacheWrite` + `cacheRead`), summed over requests |
| FUEL REMAINING | What is left of an account's plan limit |
| ACCOUNT | A SUPERVISOR-chosen label for the plan an AIRCRAFT flies on (e.g. `main`, `pro-2`); never an email |

## 4. Measuring and attributing

- **Parser** (`server/fuel.ts`, pure): lines → per-request records `{key, session, sidechain, t, model, input, cacheWrite5m, cacheWrite1h, cacheRead, output, stopReason, version, effort}`. Unknown line shapes are skipped and counted.
- **Reader**: per-file byte offsets like `talkEventsFile`; start over when a file shrinks. Main transcripts and `subagents/*.jsonl`; `agent-*.meta.json` gives `agentType`, `toolUseId`, `spawnDepth`.
- **CREW output is a lower bound.** Subagent lines are often start-of-response snapshots (`stop_reason: null`, a few output tokens). Mark CREW output `outputLowerBound` and record the share of such lines.
- **Codex**: sum `last_token_usage` from `token_count` events; `uncached = input − cached − cache_write`; skip the parent history a MultiAgent rollout replays.
- **FLIGHT attribution**: cut usage by the FLIGHT interval (STAND occupancy, `departures.jsonl`, LOGBOOK `departedAt`–`arrivedAt`), CAPTAIN and CREW separately. What fits no FLIGHT is `UNATTRIBUTED`. The LOGBOOK `arrived` line gains an optional `fuel` field (old lines have none): `{captain, crew, cost, netCost, cacheHit, leak: {coldCache, controlWake, sessionChange, compaction, modelSwitch, unexplained}, crewWarnings, models}`.

## 5. Leaks and CREW warnings

A **miss** follows Claude Code: re-processing more than 5 % of what could have been read from cache, and at least 2,000 tokens. Rebuilds explained by compaction or tool-result clearing are "expected rebuilds".

| Rule | Test | Confidence |
|---|---|---|
| COLD CACHE: expired during HOLD | Gap since the previous request in the session exceeds the TTL read from that response (1 h if `ephemeral_1h > 0`, else 5 m), and a miss | High |
| COLD CACHE: woken by a control message | As above, and the waking input is a message atc sent (CLEARANCE, FLIGHT PLAN, RECALL, CREW CHANGE). atc caused it | High (matched on message times) |
| MODEL SWITCH | Consecutive CAPTAIN requests with a different `message.model`, and a miss | High |
| COMPACTION | The summary request after `compact_boundary`; a leak only if the cache was cold | Medium |
| SESSION CHANGE | A new `sessionId` on the same FLIGHT/STAND, minus the AIRPORT's measured new-session baseline | Low |
| UPGRADE / EFFORT CHANGE | A miss right after `version` or `effort` changes | Medium |
| UNEXPLAINED | Any other miss | — |

CREW warnings are shown, not added to leaks: HEAVY PREFIX (first CREW request writes > 30 K), TRIVIAL DELEGATION (prefix > 50 % of the subagent's input and ≤ 3 turns), HIGH CREW SHARE (> 50 % of the FLIGHT), DEEP NESTING (`spawnDepth` ≥ 2), EXPENSIVE READ-ONLY (Explore/Plan on Opus), COLD CREW (a subagent reused after 5 min idle), COMPLEMENT DRIFT (declared POSITION model ≠ actual `message.model`, feeding `crew-observed.ts`). Thresholds are proposals to tune after measuring.

## 6. Accounts and FUEL REMAINING

This is the part the 2026-09-28 TEAM_K case asks for.

- **ACCOUNT label** (built, ATC-51): a new optional AIRCRAFT profile field `account` in `fleet.json`, set on the FLEET card. AIRCRAFT without it count as the default account (`default`). If no AIRCRAFT has a label, atc does not know accounts and keeps grouping by reset time.
- **LIMIT by account** (built, ATC-51; [fleet.md](fleet.md) 8.8): ATC-45's `healthAlerts` groups `LIMIT` by reset time. With labels it groups by ACCOUNT, and a `LIMIT` on one AIRCRAFT marks every AIRCRAFT on that ACCOUNT as held until the reset. This also stops DISPATCH from sending the next FLIGHT to a sibling session that is about to hit the same wall.
- **FUEL REMAINING**: needs a live source per account. Candidates, in order of preference, to verify before building:
  1. The statusline input's `rate_limits` (what #53 cited). A statusline command would append `{t, sessionId, rate_limits}` to the atc state folder; atc maps session → AIRCRAFT → ACCOUNT. This changes user settings (`statusLine`) and adds a `hooks/` script: `user` tier.
  2. `quotaLimits` on refused requests (already read by ATC-45): exact but only after the limit is hit.
  3. FUEL BURN per ACCOUNT in the current window against a SUPERVISOR-entered budget: an estimate, labelled as such.
- **Use**: a FLEET row line `FUEL 82% · resets 21:00Z` per ACCOUNT; an INFO to TOWER/OCC at a threshold (default 80 %); optionally (SUPERVISOR switch, off by default) DISPATCH skips an AIRCRAFT whose ACCOUNT is above a second threshold (default 95 %). Nothing is switched automatically between accounts.

## 7. Screens and estimates

- **FLEET card / row**: last 14 days FUEL COST per ARRIVED FLIGHT, CACHE HIT (CAPTAIN, CREW), CREW share, top leaks and warnings; FUEL REMAINING per ACCOUNT.
- **LOGBOOK / recent FLIGHTs**: FUEL BURN, NET, LEAK per FLIGHT, and whether it stayed inside TRIP FUEL.
- **DISPATCH card**: TRIP FUEL p50–p90 by TYPE × WAKE, widening to WAKE and then AIRPORT below `MEDIAN_MIN_SAMPLES` (and saying so). Display only.
- **TOWER/OCC brief**: AIRCRAFT with large leaks, and whether a message to a HOLDING CAPTAIN would hit a cold cache. Warn, never block.
- **Cost formula**: `input·P_in + cacheWrite5m·1.25·P_in + cacheWrite1h·2·P_in + cacheRead·P_read + output·P_out` (× data-residency or fast-mode multipliers). The cache-read multiplier differs by model (Opus 5.5 0.05, Fable 5.1 0.025); the table lives in a config file.

## 8. Implementation order (one issue each)

| # | Issue | Depends on | Tier | Size |
|---|---|---|---|---|
| F1 (ATC-50) ✅ | Parser, global dedupe, offset reader, read-only `GET /api/fuel` (per session: kinds, CACHE HIT, CREW lower bound), cross-checked against ccusage on the same days. **Done**, see 8.1 | — | `auto` | BUILD · M |
| F2 (ATC-51) ✅ | ACCOUNT label on the FLEET card and `fleet.json`; `LIMIT` grouped and held by ACCOUNT (health.ts, DISPATCH, SCHEDULE). **Done**, see [fleet.md](fleet.md) 8.8 | — | `auto`, raised to `user` if the `fleet.json` change is judged a format change | BUILD · M |
| F3 (ATC-52) | Leaks with high confidence: COLD CACHE (HOLD and control wake) and MODEL SWITCH | F1 | `auto` | BUILD · M |
| F4 (ATC-53) | FLIGHT attribution: optional `fuel` field on LOGBOOK `arrived` lines, `UNATTRIBUTED` | F1 | `user` (LOGBOOK record format) | BUILD · M |
| F5 (ATC-54) | Cost: config price table, FUEL COST, NET FUEL | F1 | `auto` | BUILD · L |
| F6 (ATC-55) | FUEL REMAINING source (section 6): verify statusline `rate_limits`, then the statusline script and per-ACCOUNT view | F2, decision D1 | `user` (`hooks/`, settings) | BUILD · M |
| F7 (ATC-57) | Other leaks and CREW warnings (COMPACTION, SESSION CHANGE after measuring the baseline, the warning list) | F3 | `auto` | BUILD · M |
| F8 (ATC-56) | Screens and TRIP FUEL: FLEET/LOGBOOK/DISPATCH/brief views, TARGETS items `fuelPerFlight`, `cacheHit` | F4, F5 | `auto` (rating:UI) | BUILD · M |

### 8.1 F1 as built (ATC-50)

- **Dedupe fallback**: without `requestId` the key is `(message.id, sessionId)`, not `(message.id, sessionId, timestamp)`. The content-block lines of one response carry different timestamps (3,032 of 6,385 such keys in 7 days), so the timestamp would count one request several times. No id without `requestId` appeared in two sessions.
- **Kinds**: the write total is `cache_creation_input_tokens`; the 1 h part comes from `cache_creation.ephemeral_1h_input_tokens`, the rest is 5 m (all of it when `cache_creation` is missing). `<synthetic>` lines (no API call) are skipped.
- **CREW writes the 5 m tier.** Over 7 days (2026-09-28) CAPTAIN wrote 86.6 M at 1 h and 0 at 5 m, CREW 54.0 M at 5 m and 0 at 1 h. Section 1's "every request wrote 1 h" held for main transcripts only; F3's COLD CACHE TTL must follow each response, as section 5 says.
- **Names**: the live session name from `~/.claude/sessions`, else the last `agent-name` line of the transcript. AIRCRAFT groups sessions by upper-cased name; unnamed sessions stay per session only.
- **CREW files** include `subagents/workflows/wf_*/agent-*.jsonl`.
- **ccusage cross-check** (UTC days, `ccusage claude daily`, 2026-09-26/27): requests with a `requestId` (Opus, Sonnet) match ccusage exactly on 09-26. On 09-27 Opus is lower (cache writes 24,216,148 vs 25,086,025; reads 1,794,265,874 vs 1,906,561,851; output 3,894,909 vs 4,201,713) because ccusage does not dedupe lines without a `requestId`; counting those lines raw reproduces ccusage's Opus numbers exactly. Proxied routes (DeepSeek, Muse; no `requestId`) are higher or equal in ccusage for the same reason, and no simple rule reproduces them exactly; FUEL counts them once per `(message.id, session)`, largest copy.
- **Speed**: 7 days, 500 files: first scan 953 MB in 2.6 s, next call 36 ms (only new bytes).
- **Not in F1**: Codex `token_count` (section 4) is not read yet.

F1 and F2 started at once and in parallel, and both are built; they answer the TEAM_K question soonest. The rest wait in Backlog behind their dependencies (Linear `blocked by`).

## 9. Decisions for the SUPERVISOR

| # | Question | Proposal |
|---|---|---|
| D1 | FUEL REMAINING source | Verify statusline `rate_limits` first; if present, install a statusline command (user tier). If not, fall back to FUEL BURN against a declared budget |
| D2 | Where the ACCOUNT label lives | AIRCRAFT profile field `account` in `fleet.json`, edited on the FLEET card |
| D3 | May a plan-limit threshold hold DISPATCH? | Yes, behind a switch that is off by default (95 %) |
| D4 | Exact CREW output via OTel (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, file exporter)? | Not now; keep the lower-bound flag |
| D5 | Scan cadence | Offsets on the LOGBOOK cycle (10 min); FUEL REMAINING on every snapshot |
| D6 | Codex prices | Leave Codex out of cost until a price is set |

## 10. Risks

| Risk | Mitigation |
|---|---|
| Transcript format is not a public API | One pure parser with fixtures; unknown lines counted, not guessed |
| Double counting across resume/HANDOFF copies | Global dedupe (2.42× measured) |
| Reading bodies by accident | Filter before parse, drop content after; tests assert no body text in records |
| A team blamed for atc's own leaks | `controlWake` is counted separately; `UNEXPLAINED` never names a cause |
| FUEL steering assignment | Display only; the one HOLD is a switched, account-level threshold |
| Account data in a public repository | Labels only, chosen by the SUPERVISOR; no emails or plan names from the account in code, docs or PRs |

## Not built yet

F3–F8 in section 8, and Codex usage (section 4).
