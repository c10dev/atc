# Code review and pre-merge inspection: how others do it, and what atc should change

**English** · [한국어](code-review.ko.md)

Status: SURVEY output (ATC-332), written 2026-10-01. Research only: no code, no setting and no real PR was changed. The numbers are a snapshot of the 7 days up to 2026-10-01 ~17:10Z; the logs are live, so a re-run will differ by a few rows.

**Labels used below.** *[observed]* is read from atc's own logs or from GitHub (read-only). *[replay]* is a computation: an atc rule re-run on already merged PRs (a lower bound where it needs data atc keeps elsewhere). *[outside]* is a published source with its date. *[assumed]* is my reasoning, not measured. *unverified* means I could not check it.

atc is a public repository. The AUTOLAND AIRPORT is called **AIRPORT A** here; its PRs, files, people and workflow names are not named. atc's own AIRPORT is ATCC.

## Summary

- **The bottleneck is not review quality, it is the path to a merge.** On AIRPORT A, 121 PRs were merged in 7 days (median 150 min from open to merge, p90 45 h) and 0 PRs were closed unmerged [observed]. One account merged all of them; about 117 were merged by hand and AUTOLAND merged 4, two of them after `reviewedSecurity: delegate` was switched on at 16:25Z today. No GitHub review was a human approval [observed]. On ATCC, where MCC INSPECTION (a model) plus landing tiers decide, the median is 5 min [observed]. The model lane is not what is slow.
- **Three things cost the AIRPORT A path its time:** (1) The security gate: some rule fires on 79% of merged PRs [replay]; the keyword rule alone fires on 42% [replay]. Until `reviewedSecurity: delegate` went on today, those PRs were the SUPERVISOR's to merge, which is where the ≈117 hand merges came from [assumed from the replay and the switch time]. After delegation only the deterministic rules hold a PR with a passing merge review; how many still reach the SUPERVISOR is not measured, because exclusions are not logged. (2) `Require up to date` plus a serial update queue: 53 updates for 4 AUTOLAND merges; 27 settled CLEARED, 24 settled blocked, and about half of those blocks were review-shaped (the update left the head without a valid review) [observed]. (3) Review capacity that depended on Codex: Codex reviewed only 30 of 121 merged PRs [observed], 11 of 13 re-review requests went to REVIEW, and 35% of reviewed PRs needed a second head reviewed.
- **Outside practice agrees on the shape, not on the numbers.** Teams that ship a lot of agent code keep a human at merge for now (Stripe, Shopify, Google) but route by risk with a funnel (Meta RADAR, Cloudflare tiers), use more than one reviewer agent with a verifier (Anthropic, Cloudflare), and measure rework and incidents because AI raises instability (DORA 2025). Two models are not independent: errors correlate (ICML 2025). GitHub's merge queue is not available on a user-owned private repository.
- **Recommendation (first step): turn off "Require up to date" on AIRPORT A's `main`, keep the required CI check, and let AUTOLAND merge a PR as soon as it is CLEARED**, with the post-merge main check and GROUND STOP (ATC-330 makes it latch) as the safety net and five numbers watched weekly (red main heads, revert or hotfix PRs, late review findings, an independent audit sample, the share merged by AUTOLAND). Baseline: 2 of 118 main heads were red (1.7%) under the strict rule [observed]. Rollback triggers are set in advance (section 4). This is a SUPERVISOR repository setting. Honest limit: the largest known cut, delegation, was made today and is only hours old, so the first step is chosen because it is the one remaining measured cost that needs no new code, and the same week's data (W1) tells whether review capacity is the next limit.
- **Second, shadow first:** replace the keyword gate by a reviewer's diff-aware decision, keeping the deterministic rules (secret paths, migrations, Risk labels, no FLIGHT) as they are.

## How this was made

- Part 1: three web-research sub-agents (AI reviewers; who reviews agent PRs, routing and metrics; merge queues, security review and post-merge verification) fetched vendor docs, engineering blogs and papers on 2026-10-01. I did not re-fetch their sources. Where a page showed no date, the date column says so; where a claim stayed uncertain, it says *unverified*. Vendor-written benchmarks are marked.
- Part 2: read-only reads of `autoland.jsonl`, `landing-reviews.jsonl`, `autoland-reviews.jsonl`, `mcc.jsonl`, `logbook.jsonl`, `human-checks.jsonl`, `GET /api/autoland` on the running service, and read-only `gh` reads of merged and closed PRs and `main` push runs. A code-reading sub-agent listed the lanes and gates with file and line; I spot-checked its gate rules against `server/landing.ts`. No file under `~/.local/state/atc/` was written, no session was messaged, no PR was commented on or relabelled, no app or Action was installed. Only counts leave this document.
- **Not done:** the optional experiment (re-running 10–20 merged PRs through candidate reviewers). It would spend money on a small sample and was not needed for the recommendation; it is follow-up W8.
- **Spend:** 4 sub-agents, about 350k tokens in total (75.9k, 84.0k, 76.0k, 115.1k); no external review product or paid API was called. Dollar cost is not metered; my estimate is under $3 at list prices *[assumed]*.

## 1. Current practice outside atc

Dates are the publication date where the source shows one. "No date shown" means the page has no date; I treat it as current on 2026-10-01.

### 1.1 AI code reviewers

| Tool | What it reviews, how it ranks | False positives, re-review | Gate and plan for a personal private repo | Source · date |
|---|---|---|---|---|
| GitHub Copilot code review | The diff plus related changed files; PR text. High / Medium / Low. | No FP number. Re-review is manual unless automatic review is on; may repeat dismissed comments. | Leaves a Comment review, so it does not count as an approval. Needs a paid Copilot plan; private-repo reviews use Actions minutes from 2026-06-01. | GitHub docs (no date shown); GitHub changelog 2026-04-27 |
| OpenAI Codex review | The PR diff against `AGENTS.md` rules. Only P0 and P1 are flagged. | No FP number. Auto review when a PR opens; `@codex review` on demand; re-review on push *unverified*. | Plus/Pro feature; not Free/Go/Business per the pricing page (a secondary source disagrees: *unverified*). Not documented as a required check. | OpenAI docs and pricing (no date shown) |
| Claude Code review (managed) | Several agents in parallel plus a verification step; reads the codebase and `CLAUDE.md`/`REVIEW.md`. Important / Nit / Pre-existing. | No FP number; per-repo: once, every push or manual; push reviews resolve fixed threads. | Check run always concludes neutral, so it never blocks; a gate needs your own CI parsing. Team/Enterprise only; billed by token, about $15–25 per review. Local `/code-review` works on any plan. | Claude Code docs (updated after a "July 2026" note) |
| CodeRabbit | Clones the repo, builds a code graph, runs 40+ linters. Profiles chill/assertive; pre-merge checks off/warning/error. | No vendor FP number. Incremental review per push. | An error-level check with request-changes can block via branch protection. Private repos: 14-day trial, then $24–72 per developer per month. | CodeRabbit docs and pricing (no date shown) |
| Greptile | Whole-codebase graph. P0–P2 badges and a 0–5 confidence score; severity threshold. | No vendor FP number. Re-runs on new commits (trigger wording unclear). | Gate: not documented. Free tier 50 credits a month; Pro $30 per seat. | Greptile docs and pricing (no date shown) |
| Graphite (Diamond, now Graphite Agent) | Codebase-aware; no ranking published. | None published. | Gate: not documented. Hobby plan free for personal repos; Team $40 per user. Diamond was renamed 2025-10-08. | Graphite blog 2025-03-19 and 2025-10-07 |
| Cursor Bugbot | Diff comments; severity level. | No FP number. Incremental by default; once-per-PR option. | CI check findings default to neutral, so requiring it does not block. Usage-based billing. | Cursor docs (no date shown) |
| Qodo (PR-Agent) | Claims whole-repo context; severity ranking. | No number; learns from dismissed findings (vendor claim). Per-commit trigger. | Its deterministic Quality Gate can be a required check; PR-Agent itself exits 0 on LLM errors (community report, *unverified*). Free plan 30 reviews a month per organisation (secondary). | Qodo docs (no date shown) |

**Benchmarks.** No vendor publishes a false-positive number with a method; only third parties do. Martian Code Review Bench (independent; offline: 50 PRs with 136 human golden comments and an LLM judge; online: developer acceptance on about 200–300k PRs, Jan–Feb 2026) reports F1 between 51% and 64% for the leaders, and the vendor accounts of it disagree on the ranking (CodeAnt and CodeRabbit blog posts, 2026). A vendor-written benchmark (Augment, 2026, no exact date) puts Codex at 68% precision / 29% recall and Claude Code at 23% / 51%, Copilot at 20% / 34% *[vendor, biased]*. Precision there means "the comment led to a code change", a proxy, not ground truth. Take away: the readers differ most in recall, none is documented as a blocking check by default, and Copilot, Bugbot and the managed Claude review are neutral by design.

### 1.2 Who reviews agent-written PRs, and how

| Practice | Evidence | Source · date |
|---|---|---|
| A human still approves at merge | Stripe: 1,300+ PRs a week with no human-written code, "every one human-reviewed" (secondary, primary post not found, *unverified*). Shopify: senior review is now the bottleneck, reversion rates stable. Google: 75% of new code AI-generated and approved by engineers. | tenki.cloud blog and Medium 2026-02 (secondary); BVP 2026-04-02; DevOps.com 2026-04 |
| Reviewer is a verifier that complements, not replaces, the human; precision over recall | OpenAI: full-repo context plus execution plus review-specific training beat diff-only; 52.7% of internal comments led to a code change. | OpenAI alignment blog 2025-12-01 |
| Agent writes, a different model reviews | "The agent that wrote a change never certifies it"; self-preference in LLM review. Cross-vendor pairing is emerging. | Augment guide (date unverified); OpenAI Codex upgrades 2025-09 |
| Several reviewers plus a verification and dedup step | Anthropic Code Review: parallel agents, verification filter, score threshold 80, "under 1% of findings marked incorrect", substantive-comment share 16% to 54% (vendor self-report). Cloudflare: coordinator dedups and filters; 131,246 runs, median 3m39s, average $1.19 a run, 0.6% break-glass overrides. | claude.com/blog/code-review 2026-03-09; Cloudflare blog 2026-04-20 |
| **Caution: two models are not independent** | When two LLMs both err they pick the same wrong answer 60% of the time; same-vendor and newer models correlate more. A judge-panel study lost about three quarters of nominal independence. | arXiv 2506.07962 (ICML 2025); arXiv 2605.29800 (2026) |
| Reading versus running | "Reading finds what the source shows, running finds what appears only at runtime"; neither covers the other's gap. Veracode: 45% of AI code samples had an OWASP Top 10 flaw. | specstory (date unverified); Veracode 2025-07-30 |
| Review of agent PRs is thin | A study of 33,596 agent PRs: 61% had no recorded human review, review coverage fell from about 48% to 21%. Review of AI code concentrates on documentation, style and tests more than correctness. | arXiv 2607.01904 (2026); arXiv 2601.19287 (2026-01-27) |

### 1.3 Risk-based routing

| Practice | Evidence | Source · date |
|---|---|---|
| Ship / Show / Ask | Ship = straight to mainline (docs, unremarkable fixes); Show = PR merged without waiting; Ask = PR and wait. "Approval should not be a requirement for a PR to be merged." | martinfowler.com 2021-09-08 |
| Funnel with a risk score (best large-scale write-up) | Meta RADAR: source classification, eligibility gates, static heuristics, an ML risk score, an LLM review, deterministic validation. 535k diffs reviewed, 331k landed; revert rate a third and incident rate a fiftieth of non-RADAR diffs; median close time better by over 330%. | arXiv 2605.30208, 2026-05-28 |
| Size tiers, with security paths always escalated | Cloudflare: Trivial (≤10 lines) 2 agents, Lite (≤100) 4 agents, Full (>100 lines or >50 files) 7+; paths such as auth and crypto always get the full review. | Cloudflare blog 2026-04-20 |
| Path ownership is not risk | Do not derive risk from CODEOWNERS; keep a separate risk-label file. Docs-only auto-approve by changed-path allowlist, size caps, fail closed when the file list truncates. | GitHub issue (2026, date unverified); marketplace action docs (date unverified) |
| Approval agents | Cursor's "PR Routing & Approval" classifies by risk and caps the risk an agent may approve. | cursor.com/docs/approval-agents (date unverified) |
| **Avoiding keyword false positives** | GitHub secret scanning added LLM context checks ("is this value used as a secret") and cut false positives 75.76%; "pattern matching can tell us a value looks like a secret, not whether it is used as one". Diff-aware scanning scores only added lines. Keyword matching near token or key names is "where precision breaks down". | GitHub blog 2026-06-11; cremit.io (date unverified) |

### 1.4 Keeping the branch fresh

| Approach | Evidence | Source · date |
|---|---|---|
| "Require up to date" (strict checks) | Documented trade-off: more builds, because each PR must be brought up to date after every other merge. In practice every merge invalidates all open PRs' green checks: the "merge-queue tax" grows with commit velocity times open PRs. | GitHub docs (fetched 2026-10-01, no date); community issue reports 2026 |
| GitHub merge queue | Tests each PR as if merged behind the ones ahead; main never updated to a failing commit. GitHub: average wait down 33%, 2,500 PRs a month by 500+ engineers. **Available only in organisation-owned public repos and in private repos of organisations on Enterprise Cloud; not on user-owned repos, not on Team.** | GitHub blog 2023-07; community discussions 51483 and 131130 quoting the docs (2023–2025); primary availability paragraph *unverified* |
| Third-party queues | Mergify: free for private teams of up to 5 active contributors, queue included. Graphite: queue on the Team tier ($40 per user). Aviator: queue from $20 per developer. Whether any attaches to a personal-account repo is *unverified* for all three. bors-ng is archived (2024-04-04). | vendor pricing pages fetched 2026-10-01; bors-ng README (archived 2024-04-04) |
| Stacked PRs | GitHub stacked PRs are in public preview, open to all repositories from 2026-07-30, same-repo only; merge-queue support rolling out. Graphite notes GitHub's queue "does not understand stacks". | GitHub docs (fetched 2026-10-01); InfoQ 2026-08; Graphite docs |
| Field report of the failure mode | 15+ open agent PRs outpaced one human's merge capacity; "96 open PRs fleet-wide". | cncf/endusers issue 58 (2026); prlens.dev |

### 1.5 Measuring review quality

| Measure | What teams track and publish | Source · date |
|---|---|---|
| DORA | 2025 report: AI is an amplifier, throughput up, instability up. A fifth metric, rework rate, exists because change-failure rate misses code merged and quietly fixed. The "+441% review time, +242.7% incidents per PR, +51.3% PR size" set is the Faros summary mixed with Faros data, not DORA itself (*unverified*). 2024 tiers: elite change fail rate 0–5%. | DevOps.com 2025-09-29; RedMonk 2025-12-18; Faros 2025-09; dora.dev (updated 2026-01-05, no tiers) |
| Cycle benchmarks | Swarmia: elite PR cycle time under 24 h, batch under 200 lines, change failure rate under 5%. LinearB (6.1M PRs, 2025-01-08): PR size is the biggest driver; elite under 150 lines; pickup under 1 h. | swarmia.com 2026-02-06; linearb.io 2025-01-08; exceeds.ai (date unverified) |
| Comment acceptance | Codex internal 2025-12: 36% of PRs got comments, 46% of those prompted a change. Graphite (vendor): 55% of flags led to a change versus 49% for humans. Enterprise AI-suggestion acceptance 27–35% (secondary). | OpenAI 2025-12-01; Graphite via contrary.com (date unverified); softwareseni (date unverified) |
| Escaped defects | Escaped-defect rate = production defects over all defects; elite under 10%. Human review effectiveness collapses past about 400 lines. | devstats glossary and Endor Labs (dates unverified) |
| Other effects | METR 2025-07-10: experienced developers were 19% slower with AI though they felt 20% faster. GitClear 2025-02: copy-pasted lines 8.3% to 12.3%, refactored lines 25% to under 10%. | metr.org 2025-07-10; gitclear.com 2025-02 |

### 1.6 Security review

| Control | Pre-merge gate or advisory; availability on a personal private repo | Source · date |
|---|---|---|
| Secret scanning and push protection | Free on public repos. On private repos it needs GitHub Secret Protection, sold only to organisations on Team or Enterprise: **unavailable on a personal private repo**. It blocks the push itself. | GitHub docs (fetched 2026-10-01); changelog 2025-12-02 |
| CodeQL code scanning | Free on public repos; private repos need Code Security (organisation Team+). Free and Pro plans: public repos only. The open-source CodeQL CLI can run in your own CI. | GitHub docs (via search, 2026-10-01) |
| Dependency review | The Action fails the check on a vulnerable new dependency and can be a required check; private repos need an Advanced Security licence. | actions/dependency-review-action README |
| Semgrep | Community edition free and self-hostable, single-file analysis; Cloud free for 10 contributors and 10 private repos. Assistant claims over 95% accuracy classifying false positives (vendor). | semgrep.dev 2025 (several posts) |
| Snyk | Free: 200 tests a month on private repos. | snyk.io via search 2026-10-01 |
| AI security review | Claude `/security-review` and its GitHub Action run on any repo that can run Actions; advisory unless wired to branch protection. A 2026-04 prompt-injection flaw (CVSS 9.4) in AI review Actions on `pull_request_target` leaked secrets: trust only your own contributors. SAST false-positive rates are high (OWASP benchmark study: CodeQL about 68%, Semgrep about 75%); an LLM post-filter cut one study's rate from over 92% to about 6%. | github.com/anthropics/claude-code-security-review (no date shown); esecurityplanet 2026-04; arXiv 2601.19239 and 2508.04448 |
| Blocking versus advisory in practice | Blocking when configured as required checks: dependency review, code scanning, push protection. Advisory: Copilot Autofix, Semgrep Assistant, `/security-review`. | summary of the sources above |

### 1.7 Post-merge verification

| Practice | Evidence | Source · date |
|---|---|---|
| Merge, then verify on main, revert on red | Agent workflows that merge, run the full suite on merged main and auto-revert on red, then halt and notify the author. | two GitHub repos' issues and PRs, 2026 (anecdotal) |
| Why it is needed | Two green PRs can merge into a red main because their checks ran against a stale base; "red main notifies nobody" is a documented failure. | GitHub issues 2026 (anecdotal) |
| Flags, canary, auto-rollback | Merge behind a flag; roll back on error and latency signals (Argo Rollouts, Flagger). | getautonoma.com 2026 (vendor blog) |
| Rework rate as the post-merge metric | See 1.5: DORA added rework rate for exactly this reason. | DevOps.com 2025-09-29 |

## 2. atc today

### 2.1 Review lanes (7 days)

"Counts for CLEARED" says where the verdict stands in for a human or Codex review. All lane verdicts are bound to the exact head; a verdict carries across a merge of `main` only when the PR's own changes are identical.

| Lane | Trigger · model · what it reads | Verdict, where stored | Counts for CLEARED | 7-day numbers |
|---|---|---|---|---|
| Human GitHub review | A person on GitHub | APPROVED / COMMENTED / CHANGES_REQUESTED, GitHub only | Every AIRPORT | AIRPORT A: 0 human approvals among 121 merged PRs [observed] |
| Codex | Auto review or `@codex review` (posted by AUTOLAND once per head after an update left it unreviewed); external; its own repo context | thumbs-up = pass, COMMENTED = findings with P0–P3 badges; GitHub only | Every AIRPORT with Codex; on an AUTOLAND AIRPORT the merge review replaces it | AIRPORT A: reviewed 30 of 121 merged PRs, 57 findings reviews; opened to first review median 149 min, p90 5,550 min (n=30) [observed] |
| REVIEW landing review | Codex unavailable (limit notice, 6 h of silence, or handed over after 30 min); a REVIEW session on Claude Sonnet; reads a packet: title, body, FLIGHT acceptance, changed files, diff capped at 80,000 chars; never reads source | pass / findings with P0–P2 counts, `landing-reviews.jsonl` | Any AIRPORT when Codex is unavailable, unless the PR is excluded | 89 records on 7 days: Sonnet 66, older DeepSeek-family 23 [observed]. With the 13 CROSSCHECK records: 102 records on 65 PRs (98 AIRPORT A, 4 ATCC); pass 83, findings 19 (P0 0, P1 23, P2 43); 75 of 102 carry the `security` flag. 23 of 65 PRs (35%) needed a second head reviewed (14 with 2 heads, 6 with 3, 2 with 4, 1 with 6) [observed] |
| CROSSCHECK (Muse family) | A cross-vendor session | same format | Recorded but not counted since the 2026-09-29 decision | 13 records, 12 pass, 1 findings [observed] |
| AUTOLAND merge review (ATC-328) | The same REVIEW session on an open non-Draft PR of an AUTOLAND AIRPORT; Codex status is irrelevant | same format, `autoland-reviews.jsonl` and an `autoland.jsonl` `merge-review` row | Replaces Codex and the REVIEW landing review on AUTOLAND AIRPORTs; re-checked at merge time | 3 pass, all after `reviewedSecurity: delegate` was set (16:25Z) [observed] |
| MCC INSPECTION (ATCC) | MCC `/tick` every 5 min, up to 3 PRs without an INSPECTION on the head; Opus sub-agent; reads body, files, diff, tier reasons, the issue goal and atc code | pass / findings P0–P2, plus ESCALATE, `mcc.jsonl` | ATCC only | 210 inspections on 185 PRs: pass 193, findings 17 (8.1%); 28 ESCALATE rows on 27 PRs; 134 landed by MCC (95 `auto`, 41 `flagged`), 2 land failures; opened to first INSPECTION median 4 min (p90 8), INSPECTION to land median 0 min (p90 6) [observed] |
| HUMAN CHECK | `## UI change` class CHOICE, ACCOUNT or DEVICE; the SUPERVISOR clicks PASS or FAIL | `Human check:` line in the PR body, `human-checks.jsonl` | Not part of CLEARED; gates AUTOLAND merge only | 1 record (pass) [observed] |

### 2.2 Gates (7 days)

A "false-positive proxy" would need the number of PRs a gate held that the SUPERVISOR then merged without a change. atc does not log the held PR's exclusion reason (see the AUTOLAND row), so the proxy is replaced by the replay below and by one observed fact: **no AIRPORT A PR was closed without merging in 7 days** (121 merged, 0 closed unmerged), so every gate firing ended in a merge and the gates cost time, not caught PRs [observed]. Reverts afterwards: no merged PR whose title says revert or hotfix on AIRPORT A or ATCC in 7 days [observed, proxy]; the LOGBOOK `reverted` field is set when read, not when written, so it cannot be counted from the file.

| Gate | What triggers it; who decides | 7-day numbers |
|---|---|---|
| Landing blocks: `stacked`, `draft`, `checks-*`, `no-review`, `review-stale`, `review-findings`, `changes-requested`, `behind`, `dirty`, `blocked`, `merge-unknown`, `los` | `landingBlocks`; the team or the SUPERVISOR | No per-block log. After an AUTOLAND update, 24 PRs settled blocked with these codes: `blocked` 10, `no-review` 9, `review-stale` 5, `behind` 3, `checks-failed` 1 (a PR can carry two) [observed]. At least 14 of 28 codes are review-shaped |
| Security gate (`externalGateOf`): `rating:SEC`, Risk labels, security paths, keywords; hard: no FLIGHT, secret paths | The PR leaves the external-review lane and, in merge mode, goes to the SUPERVISOR unless `reviewedSecurity` is `delegate` and a merge review passed this head | 75 of 102 review records carry the `security` flag [observed]. Replay on the 121 merged PRs [replay, lower bound: ticket labels and FLIGHT text not available]: any rule 95 (79%); security paths 44 (36%: auth 18, migrations 14, SQL 5, functions 3, admission 2, session 1, RLS 1); keywords 94 (78%: `auth` 43, `EXECUTE` 15, `security` 11, `admission` 7, others 18); **keyword only 51 (42%)**; secret paths 0; Risk labels on the PR 0; migration or SQL paths 19 (16%) |
| AUTOLAND `mergeExclusionOf` (HOLD, no FLIGHT, `rating:SEC`, Risk label, unreadable files or 100+ files, secret paths, migrations under delegation, HUMAN CHECK) | The SUPERVISOR merges; tagged "SUPERVISOR 머지 — reason" | 0 `skip` rows logged in 7 days; 2 HOLD rows; the live plan at ~17:05Z tagged 4 PRs (1 delegated merge target, 3 excluded) and GitHub showed 5 open (2 Draft) a few minutes later [observed]. Exclusions are computed live and not logged |
| `reviewedSecurity` switch | The SUPERVISOR, settings window | 1 switch row: delegate, 2026-10-01 16:25Z [observed] |
| Strict up-to-date and update queue (AUTOLAND, one PR in flight per AIRPORT; a CLEARED PR left to the SUPERVISOR holds the queue for 15 min, ATC-331) | `behindOnly` PRs get update-branch | 53 updates (6 on 09-28, 47 on 10-01), settled: CLEARED 27, blocked 24, closed 2 [observed]. 53 updates produced 4 AUTOLAND merges; the rest of the CLEARED PRs were merged by hand [observed] |
| Re-review requests | After an update left the head unreviewed | 13, all on 10-01: 11 to REVIEW, 2 to Codex [observed] |
| GROUND STOP (AUTOLAND, ATC-330 makes it match workflow names) | `applicationCheck` fails on `main`'s head; the SUPERVISOR clears | 0 `groundstop` rows. AIRPORT A `main` push runs: 118 heads, 2 red (1.7%), each a single head [observed] |
| Landing tiers (`auto`, `flagged`, `user`) and MCC L1–L8 (ATCC) | Changed paths; `user` goes to the SUPERVISOR | Landed: 95 `auto`, 41 `flagged`; 28 ESCALATE rows on 27 PRs (the `user` class and format changes) [observed] |
| HUMAN CHECK classes | CHOICE, ACCOUNT, DEVICE with UI impact not `none` | 1 PASS record [observed] |

### 2.3 Latency

| Interval | AIRPORT A | ATCC |
|---|---|---|
| PR opened to merged | median 150 min, p90 2,706 min (n=121); the LOGBOOK landing wait says 141 and 2,666 (n=99) [observed] | median 5 min, p90 28 (n=356 LOGBOOK rows) [observed] |
| PR opened to first review | Codex first review median 149 min, p90 5,550 (n=30); REVIEW records are not tied to the open time in the log | opened to first INSPECTION median 4 min, p90 8 |
| Review to CLEARED, CLEARED to merge | Not separable from the logs (CLEARED time is not recorded); the update queue and the SUPERVISOR click sit here | INSPECTION to land median 0 min, p90 6 |
| PR size (added plus deleted lines) | median 403, p90 1,892 [observed]. Half the PRs are above the line where outside sources say human review degrades (about 400) and well above the elite batch size (under 150–200) | n/a |

### 2.4 Agreement between lanes

**No head in the 7 days was reviewed by two lane families** (102 heads, 0 with more than one family), so the agreement of Codex with REVIEW, or of MCC INSPECTION with Codex, cannot be computed [observed]. The lanes are alternates by design (REVIEW only runs when Codex is unavailable), so they never overlap. Within one lane, 0 heads were reviewed twice. Of 9 PRs whose first review was findings, 1 later passed on a new head; the others had not been re-reviewed or merged yet in the window [observed].

### 2.5 What the numbers say

1. The AIRPORT A merge path is a throughput problem: ≈17 merges a day arrive, and until today nearly all of them were merged by hand; AUTOLAND's merge mode was on since 09-28 but, with `reviewedSecurity` off, the security gate held most PRs [observed that merges were by hand; the cause is *assumed* from the replay].
2. The strict rule is the biggest remaining cost I can measure: 24 of 53 updates ended blocked and at least half of the blocking codes are review-shaped, which means the update itself cost a review. Under the strict rule `main` was red on 1.7% of heads.
3. The security gate looks expensive (79%, keyword alone 42%) but, once `delegate` is on and a head-bound merge review passes, only the deterministic rules still hold a PR; the migration and SQL rule applies to 16%. How many PRs still reach the SUPERVISOR after delegation is not logged, so it is the first thing to log.
4. Review capacity: Codex covered a quarter of the PRs; REVIEW (Sonnet) now carries the load, and a head needs a second review in 35% of PRs.
5. ATCC shows the model-only lane with tiers works at minutes of latency and an 8% findings rate; it is not evidence about AIRPORT A's defect rate.
6. No defect rate exists today: 0 reverts, 0 closed PRs, 2 red heads. That is the baseline to watch, not proof of safety.

## 3. Options

Criteria: defects let through, latency, SUPERVISOR minutes, token or money cost, what changes in atc, tier, shadow first. "Defects" and "minutes" are *[assumed]* unless a number is cited.

| # | Option | Defects let through | Latency · SUPERVISOR minutes | Cost | What changes in atc · tier | Shadow first | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Status quo plus ATC-330 and ATC-331 | Unchanged; GROUND STOP now latches on workflow names | ATC-331 un-stalls the queue; the strict update cycle (an update, a new head, a review) remains | None | Already built · n/a | n/a | Keep as the base; not enough alone |
| 2 | Replace the keyword gate with a diff-aware security decision by the reviewer | Slightly up for PRs the keyword used to catch by luck; the deterministic rules stay (secret paths, migrations, Risk labels, no FLIGHT). Outside: LLM context checks cut secret-scanning false positives 75.76% | Keyword alone fires on 42% of PRs; delegation already hides it for passing heads, so the gain is fewer needless findings and a cleaner `security` flag | One field in the existing review | Review manual and packet, `landing-review.ts`; `landing.ts` rule removal later · `flagged`, the final removal `user` | Yes: log the reviewer's flag next to the keyword on every head | **Adopt, second step** |
| 3 | Two independent model reviews, agreement required for security-gated PRs | Lower only if errors are independent; they are not (60% same wrong answer, ICML 2025; same-vendor worse) | Adds a lane and a wait; a disagreement goes to a person | About ×2 review tokens; Cloudflare average $1.19 a run is the outside scale | New lane and agreement rule · `flagged` | Yes | **Reject as a per-PR rule; adopt as a 10% audit sample** (W6) |
| 4 | A verifier lane that runs the change (tests, smoke flow, Preview) | Lower for runtime-only failures; CI already runs tests, so the new part is smoke and Preview evidence | Adds minutes per PR | Compute plus model | New lane and evidence packet · `flagged` | Yes | **Later**, after W5 shows which defects escape |
| 5a | Drop "Require up to date"; keep the required CI check; post-merge main check plus GROUND STOP | Semantic conflicts can reach `main`: 1.7% red heads under the strict rule is the baseline; GROUND STOP now stops AUTOLAND on red | Removes the update step: no head change, no `review-stale`, no serial queue; this is where I expect the largest cut | None | A repository setting (the SUPERVISOR); small atc change to merge a CLEARED PR at once · n/a for the setting | Partly: compare the weekly numbers before and after; one click to roll back | **Adopt, first step** |
| 5b | GitHub merge queue | Lowest for semantic conflicts | Good at high volume | Needs an organisation on Enterprise Cloud | None possible today | n/a | **Reject** (unavailable on a user-owned private repository; primary availability text *unverified*) |
| 5c | Third-party queue (Mergify, Graphite, Aviator) | Like 5b | Like 5b | Mergify free for up to 5 contributors; others $20–40 a user | New app on the repository | n/a | **Reject for now**: personal-repo support *unverified*, and a new app is a SUPERVISOR decision |
| 5d | Stacked PRs | Neutral | Helps dependent PRs only | None | AIRCRAFT workflow change; GitHub feature in public preview | No | **Reject for now**: preview, same-repo only |
| 6 | Smaller FLIGHTs and a WIP limit per AIRPORT | Lower (human review degrades past ~400 lines; median PR is 403) | Fewer huge PRs, lower p90 | None | FLIGHT PLAN size hint, DISPATCH WIP cap · `flagged` | Yes: log size and WIP only | **Adopt, cheap, later** (W7) |
| 7 | Carry the verdict across `main` merges more widely | Slightly up if `main` touched the same files without a re-review | Removes re-reviews caused by updates | None | `carriedReviewOf` rules · `flagged` | Yes | **Subsumed by 5a** (without updates there is nothing to carry); keep ATC-31 as is |
| 8 | Sampled audit: a different-vendor reviewer re-reviews a random 10% of auto-merged heads after merge | It is the measurement of defects let through, not a gate | None for the PR | About 10% of one review a PR | New shadow lane writing a record · `flagged` | It is shadow by nature | **Adopt with the first step** (W6) |
| 9 | Buy a managed AI reviewer | Unknown | Adds a third lane | Managed Claude review is Team/Enterprise only at $15–25 a review: at 17 PRs a day about $260–430 a day; Copilot, Bugbot and the managed Claude check are neutral so none blocks; CodeRabbit private repos are paid | New app, new secret surface | No | **Reject** |

**Experiments.** Not run (see "How this was made"). W8 describes it.

## 4. Recommendation

**First step: turn off "Require branches to be up to date" on AIRPORT A's `main` (keep the required CI check), and let AUTOLAND merge a PR the moment it is CLEARED and not excluded.**

- *Why this first.* The biggest cut, delegation, was made today (it moves the ≈79% of PRs the security gate touched from the SUPERVISOR to AUTOLAND once a merge review passes), so the next question is what still stops AUTOLAND. The one remaining cost I can measure on every PR is the update cycle: the update branch, a new head, and a review the update may invalidate (24 of 53 updates ended blocked, at least 14 of 28 codes review-shaped), plus the extra CI run. Dropping the strict rule needs no new code and removes that cycle for every PR. The keyword gate no longer holds a PR whose head has a passing merge review, so loosening it first would cut little. *[assumed]* effect: more PRs reach CLEARED while the REVIEW lane is free, so more are merged by AUTOLAND; W1 measures whether review capacity is the next limit instead, and if the AUTOLAND share does not rise within a week the second step is capacity (a second REVIEW lane or Codex as a parallel lane), not more gates.
- *What bounds the risk.* The required CI check stays; the post-merge main check and AUTOLAND GROUND STOP stop updates and merges on a red head (ATC-330 makes the latch work for workflow names, and warns if the configured name matches nothing); the deterministic rules still send secret paths, migrations, Risk labels, no-FLIGHT PRs and HUMAN CHECK classes to the SUPERVISOR; the setting is one click to restore.
- *What to watch, weekly, in one place* (W5): (1) red `main` heads per 100 merges (baseline 1.7), (2) revert or hotfix PRs within 72 hours of an AUTOLAND merge (baseline 0), (3) findings that a later review raises on code already merged (late catches), (4) the 10% audit sample by a different-vendor reviewer on merged heads: its findings of P0 or P1 severity per audited head, (5) the share of AIRPORT A merges done by AUTOLAND and the median open-to-merge time (baseline 150 min and about 3% by AUTOLAND, 4 of 121).
- *Rollback triggers, agreed in advance:* more than 3 red heads in any 50 merges (about 3 times the baseline), or 2 reverts in a week, or an audit finding of P0, restores the strict rule. A red head latches GROUND STOP regardless.
- *Which gate to relax or replace next:* the keyword rule, in shadow first: log the reviewer's diff-aware decision next to the keyword and the path rule for two weeks; remove the keyword only if the reviewer's flag catches every PR the path and label rules catch plus what a person would have wanted. Keep the secret, migration, Risk-label and no-FLIGHT rules deterministic (the outside practice that works is a classifier on top of fixed paths, not instead of them).
- *What the SUPERVISOR must decide:* (1) turn the repository setting off or keep it, (2) whether the rollback triggers above are right, (3) whether a migration or SQL PR may auto-merge when the hosted DB already has the migration (ATC-329 can answer that already), (4) the cost of the audit sample, (5) whether Codex stays a first lane on AIRPORT A at all (it covered 25%).

## 5. Follow-up work orders

Not created in Linear; DUTY or ENGINEERING will.

| # | Title | Scope | Expected tier |
|---|---|---|---|
| W1 | Log AUTOLAND exclusions every cycle | Write one `skip` row per CLEARED PR and its exclusion reason per head (not only when a merge is attempted) and a daily count; shows what still reaches the SUPERVISOR after delegation | `flagged` (`autoland-run.ts`) |
| W2 | Merge a CLEARED PR at once when strict up-to-date is off | AUTOLAND's merge pass does not require `behind` to be cleared when the AIRPORT is marked non-strict in `autoland.json` (optional field, default as today); the SUPERVISOR turns the repository setting off | `user` if the `autoland.json` format changes, else `flagged` |
| W3 | Reviewer-side security decision, shadow | The merge-review verdict gets an optional `securityBoundary: yes/no` with a reason; recorded next to the keyword, path and label results; no gate uses it yet | `flagged` |
| W4 | Retire the security keyword | After W3's two weeks, drop `SECURITY_WORDS` from `externalGateOf`; keep the other rules | `user` (loosens the ATC-27 gate) |
| W5 | Escaped-defect view | Count red `main` heads, revert and hotfix PRs, late catches and audit findings per week from GitHub and the logs; show on METRICS; fix the LOGBOOK `reverted` write | `auto` or `flagged` |
| W6 | Audit sample lane | A different-vendor reviewer re-reviews a random 10% of auto-merged heads after merge; writes a record; no PR comment; also gives the missing agreement numbers | `flagged` |
| W7 | Size hint and WIP cap | FLIGHT PLAN suggests splitting above about 400 lines of change; DISPATCH caps open non-Draft PRs per AIRPORT | `flagged` |
| W8 | Replay experiment | In a scratch folder re-run 10–20 merged AIRPORT PRs at their merged heads through one or two candidate reviewers and a classifier prompt; compare with the lanes and any later revert; report as a small sample; keep spend small | `auto` (docs only) |
| W9 | Verifier lane study | Decide, from W5's data, whether smoke or Preview evidence would have caught any escaped defect | `auto` (docs) |

## 6. Limits and what I could not verify

- The web facts come from sub-agent fetches on 2026-10-01 and were not re-fetched by me. Many vendor pages show no date; I marked them. Primary sources were not located for the Stripe figure, the DORA 2025 PDF (only summaries), GitHub's merge-queue availability paragraph (quoted from community discussions that quote the docs), personal-repo support for Mergify, Graphite and Aviator queues, and whether Codex can be a required check.
- Vendor-reported numbers (Anthropic's "under 1% incorrect", Augment's benchmark, Graphite's acceptance rates, Semgrep's accuracy) are marked vendor.
- The gate replay uses PR labels, paths and text only. Ticket labels (`rating:SEC`, Risk) and FLIGHT text are in Linear, so the replay is a lower bound for gates that depend on them.
- The numbers are a 7-day snapshot of live logs; merges, updates and reviews kept arriving while I read them (the AUTOLAND merge count rose from 3 to 4 during the read; I report 4). AIRPORT A's AUTOLAND merge mode only ran with delegation from 2026-10-01 16:25Z, so the post-delegation behaviour is covered by hours of data.
- Defects let through cannot be measured today: there is no revert, no closed PR and 2 red heads in 7 days. That is a baseline of small numbers, not proof that the gates catch nothing.
