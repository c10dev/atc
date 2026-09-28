<!-- ATC-34 이슈 본문(2026-09-28). ATC-35 시험용. 목표 절의 vocado 내부 규칙 인용 한 문장만 일반화했고, 완료 기준·제약은 원문 그대로다 -->
## Goal

Landing on vocado should need at most one human click per PR, and none for the PRs the SUPERVISOR chooses to delegate.

Today every merge puts the other open PRs `behind`, because vocado's `main` ruleset is `strict`. The SUPERVISOR then repeats three steps for each PR by hand: Update branch, wait for CI, merge. With [ATC-31](https://linear.app/vocado/issue/ATC-31), a main-only update keeps its review, so the waiting is now pure mechanics.

Add **AUTOLAND** behind one switch: `autoland: "off" | "update" | "merge"`, default `"off"`.

* `update`: for a PR that is CLEARED except for `behind`, atc updates the branch. It takes one PR at a time, in LANDING SEQUENCE order.
  * The call is GitHub `PUT /repos/{owner}/{repo}/pulls/{n}/update-branch` with `expected_head_sha`, which is a normal merge commit, not a force-push.
  * The PR then returns to CLEARED once CI passes. The SUPERVISOR only clicks merge.
  * After each merge, atc updates the next PR.
* `merge`: for PRs in the delegated class, atc also merges when CLEARED, using the exact head (`--match-head-commit`), one at a time.
  * Every other PR stays at `update` behavior.

The SUPERVISOR decided on 2026-09-28 to turn `update` on once this ships. `merge` is built but stays off until the SUPERVISOR allows it in the team rules.

## Done criteria

* The switch is in config, and the settings window shows it with a one-line warning for each mode. Default is `off`. Only the SUPERVISOR changes it: from the UI or the API, never from a control session.
* `update`:
  * only CLEARED-but-behind PRs;
  * one in flight per AIRPORT;
  * `expected_head_sha` is always passed;
  * a rejected update (the head moved) is skipped and retried on the next cycle;
  * PRs that are draft, stacked, `dirty` or have LOS are never touched.
* `merge` never merges any of these, which stay with the SUPERVISOR:
  * `rating:SEC` or `Risk:*`;
  * migration, SQL, auth, admission or RLS paths (the [ATC-27](https://linear.app/vocado/issue/ATC-27) security gate);
  * a PR whose body says Human Preview is `required` and not `passed`;
  * a PR with no FLIGHT;
  * any PR the SUPERVISOR marks "hold", with a way to mark it from the landing strip.
* A red post-merge `Application Check` on `main` puts AUTOLAND in GROUND STOP. It stops both modes until the SUPERVISOR clears it.
* Every action is recorded in LOGBOOK or the landing record: the update or merge, the PR, head, result and mode.
* The landing strip shows what AUTOLAND will do next ("AUTOLAND: updating #383"), or why a PR is excluded.
* Tests cover each exclusion, the one-at-a-time rule, a head-moved rejection and GROUND STOP.
* The en and ko docs and the glossary include AUTOLAND.

## Constraints specific to this task

* No force-push, no auto-merge setting on GitHub, and no change to branch protection or `strict`.
* Write calls are only `update-branch` in `update`, and in `merge` only the exact-head merge of a delegated PR. Nothing else writes to team branches.
* The atc repo's own landing (structure merges auto/flagged) is out of scope.
