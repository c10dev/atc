# Message style: plain, controlled English for sessions

> Status (2026-10-02): built (ATC-359). The text builders listed in section 3 follow this style. The style is atc's own. It is close to the idea behind simplified technical English (ASD-STE100), but it does not copy that specification or its dictionary.

atc's server writes English to sessions: FLIGHT PLAN, RECALL, CLEARANCE, CREW CHANGE, GO AROUND, LANDING sequence and the landing block notes. The readers are AIRCRAFT (Claude sessions) and the guards. Short, plain sentences are easier to read right, so the replies should keep to the phraseology more often. READABILITY ([readability.md](readability.md)) can show whether they do.

## 1. The rules

1. **One idea per sentence, 20 words or fewer** (the test allows 35 for fixed lists). If a sentence has a "so", a "which" or a semicolon, make two sentences.
2. **Orders are in the imperative, one order per sentence.** "Merge origin/main and resolve the conflicts. Run the checks." Not "Merge, resolve, run, push".
3. **A condition comes first and has its own sentence.** "If you cannot, answer UNABLE with the reason."
4. **Do not join clauses with a dash (—) or a colon.** Use a full stop. A colon stays only before a list or a value (`Reason: …`, `HOLD: start after …`).
5. **Use the same word for the same thing, every time.** STAND, not "worktree" in one place and "workspace" in another. The aviation terms stay (AIRCRAFT, FLIGHT, READBACK …).
6. **Use the active voice and plain verbs.** "Merge origin/main", not "origin/main is to be merged".
7. **No idiom and no figure of speech.** "Carry the work through to the end", not "see it through".
8. **Say what to do, not only what is wrong.** "Behind base. Merge origin/main and push with a plain git push."

## 2. What must not change

The guards (`occ/send-guard.mjs`, `controller/guard.mjs`) and the sessions read some parts of these texts. A style change must leave all of these exactly as they are:

- Heads: `[DISPATCH D-xxxx] FLIGHT PLAN · …`, `[DISPATCH D-xxxx] RECALL · …`, `[OCC CC-xxxx] CREW CHANGE · …`, `[ATC C-xxxx] …`, `[ATC FLEET] …`.
- Ids (`D-`, `C-`, `CC-`), PR numbers (`#n`), `head <7 characters>`, FLIGHT numbers, file paths.
- Every quoted phraseology string: `"READBACK <id>"`, `"UNABLE <id> — reason"`, `"STANDBY <id>"`, `"ROGER <id>"`, `"READBACK <id> RECALL"`, and the address `"OCC"` / `"TOWER"` with `SendMessage to:`.
- Fixed words in capitals (READBACK, UNABLE, STANDBY, ROGER, RECALL, GO AROUND, LAND, HOLD, PILOT'S DISCRETION, BRIEF: DIRECT, CAUTION …) and the command options (`--force-with-lease`).
- The markers code reads in the stored text: `PR ahead (#n)` (GO AROUND logic) and `head <7 characters>` (the "already sent" check).

`occ/send-guard.mjs` compares the sent message with the stored text. The stored text now comes from the new builders, so the comparison is unchanged. The guard was not touched.

## 3. Which builders follow the style

`server/response.ts` (closing and address lines), `server/briefs.ts` (the DIRECT lines), `server/proposals.ts` (FLIGHT PLAN and RECALL), `server/crew-change.ts` (CREW CHANGE), `server/controller.ts` (LAND text), `server/go-around.ts` (GO AROUND), `server/landing-en.ts` (landing block notes).

Not changed: the control session manuals (`*/CLAUDE.md`), the text the SUPERVISOR writes, Korean text, and the issue text copied into a FLIGHT PLAN.

## 4. How the unchanged parts are checked

`server/message-style.test.ts` builds 17 sample texts from `server/message-style-cases.ts` and compares them with `server/fixtures/message-before.json`, the output of the same builders before this change. For every sample it compares, with counts:

- the head line (when the text has one),
- all ids,
- all quoted strings,
- all capital-letter words,
- all `#n`, `head xxxxxxx`, `--option`, `origin/main` and `.ts` paths.

Any difference fails the test. The test also checks the heads and the quoted replies by hand, and it checks the rule 1 limit.

## 5. READABILITY baseline and the 7-day after-readout

Baseline: the six daily lines in `readability.jsonl`, 2026-09-26 to 2026-10-01 (before this change).

| Measure | Baseline (6 days) |
|---|---|
| Calls / replied | 823 / 790 (96.0%) |
| UNABLE | 39 (4.7% of calls); 11 on 09-29 were the one `no-merge` cause |
| Overdue | 13 |
| Median call-to-reply, per day | 13.4 s to 19.0 s (09-26 13.4, 09-27 18.4, 09-28 19.0, 09-29 16.2, 09-30 15.2, 10-01 18.2) |
| Phraseology: replies checked | 758 |
| `missingHead` | 97 (12.8%); 86 of 463 (18.6%) on 10-01 |
| `multilineUnable` | 5 (all on 10-01) |
| `wrongId` | 0 |
| Characters sent / received | 725,180 / 1,248,519 |

The `missingHead` rate and `multilineUnable` count are the main signals. The text rules aim at them. Latency, UNABLE rate and size are watched so that the change does not make them worse.

After-readout: seven full UTC days after the merge of this change (the daily lines from the first full day after the deploy). Compare, with the same definitions and the `markers` in each line to cut out other phraseology merges:

1. `missingHead` rate (target: lower than 12.8%) and `multilineUnable` (target: not higher).
2. UNABLE rate and the reason classes (no new class from the new texts).
3. Median and p90 call-to-reply, and overdue count (must not be worse).
4. Characters sent per call (the new texts are a little longer; the cost should stay within 5%).

Other changes land in the same window (ATC-353, 354, 362), so the readout lists them from `markers` and says which of them touch the same texts. One week of data is a hint, not a proof.
