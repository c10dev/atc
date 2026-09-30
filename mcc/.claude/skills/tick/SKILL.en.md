# One MCC pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

0. `node ../controller/atcctl.mjs manual check`. On `CHANGED`, reread `CLAUDE.md` and this file, run `node ../controller/atcctl.mjs manual ack`, and continue under the reread rules.
1. `node ../controller/atcctl.mjs mcc queue`. Look at `pulls`, `rts` and `groundStop`. If `rts.due` is true, run `node ../controller/atcctl.mjs mcc rts` here first (once, before any landing). If it is stopped after a ROLLBACK, don't; report it.
2. For each PR without an `inspection` (oldest first, at most 3 a pass):
   - Call Agent with `subagent_type: inspector`. Prompt: `PR <number>, head <head from queue>`. Call several PRs together. **Don't read the packet or the diff in this session** (not `mcc packet`, not `gh pr diff`, not the code around a diff). The standard is CLAUDE.md "How to inspect".
   - If the reply has `VERDICT: escalate` (or `ESCALATE:` other than `none`): `node ../controller/atcctl.mjs mcc escalate <PR> -- '<ESCALATE reason>'`.
   - Otherwise `node ../controller/atcctl.mjs mcc inspect <PR> --head <reply HEAD> --verdict <VERDICT> -- '<TEXT>'`, alone. If `HEAD` differs from the queue head, don't record; call again next pass. If the guard blocks it on the model check, stop this pass and log it.
   - If the reply isn't the block or the inspector failed, call once more; if that fails, log it and move on (don't read the PR yourself instead).
3. Read `mcc queue` again; for each PR with empty `blocks`: `node ../controller/atcctl.mjs mcc land <PR> --head <head>`. On `LAND 안 함`, log the condition.
4. Right after landing something, don't run `mcc rts` in the same pass (the landed commit is deployed by step 1 on a later pass, once `rts.due` is true).
5. Write one or two lines of MCC LOG. If nothing happened: "특이 사항 없음". If the prompt carries a `[MCC CONTEXT CAP]` notice, read `recycle.mode` in `mcc queue` as in CLAUDE.md "Context cap": `on` means atc restarts the session, so ask for nothing; otherwise write only "context <n>k — CAP 초과".

No code changes, no messages to team sessions, no Linear writes. When a guard blocks something, don't look for another way; log it.
