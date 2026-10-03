Fixes ATC-423

## Summary
- RELEASE draws candidates, Todo before release and recent releases as one-line rows on the shared `TodoRow` (state tag, FLIGHT, title, priority, button) with `SectionHead`, the shared `.tag` and `.btn`. `Release.css` now holds only the reading column, the section spacing and the detail facts; every `rl-*` class and `ReleaseTree.css` are deleted.
- A `K` tag marks a declared K effect; a problem (no priority, unreadable K3 line, content changed after release, release revoked) is said after the title. Pressing a row opens only what the line does not say: state sentence, parent issue, K effects in full, K3 state, who proposed it, `after` order, same-file overlap, FLIGHT link, discard.
- The group tree is replaced by three sections plus a folded `대기·진행 중` (waiting and started issues). Section split is `partitionRelease` in `web/src/sidebar-rows.ts`, used by both the screen and the sidebar.
- RELEASE sidebar is a section index (후보, Todo 발권 전, 최근 발권) with counts; each sets `#release/<section>` and the screen scrolls to it. The READY list is gone from the sidebar; the rail badge is unchanged. `docs/layout.md` "Z2 as built" updated.
- `TodoRow`: `need` and `age` now accept `ReactNode` (HOME passes strings as before).

## Pilot's discretion
- Section heading and card shell: used `SectionHead` / `TodoRow` that HOME (ATC-422) added to `web/src/kit/`; no new shared code was needed, and no card is used.
- The ATC-436 import check has not landed (no allow list in the tree), so nothing to remove.
- K effects: the row shows a `K` tag only when effects are declared; "선언 없음" is said in the detail (absent is the safe default, so not a line on every row).
- Priority is plain text (`URG`/`HIGH`/`MED`/`LOW`, `—` if none), not the coloured `PriorityMark`, to keep a normal row free of coloured blocks (Craft 3.5.1).
- The gate note and the K3 HOLD line now appear only when abnormal (gate not on; K3 HOLD off or a nuisance/miss count above 0), per principle 1 and 7. The constant line "발권해야 DISPATCH가 배정합니다" was dropped.
- The tree's nesting is flattened into the sections; the parent issue shows in the detail. Rows with `fire` but still waiting stay in 후보 (they can be fired or discarded).
- The pending K confirmation section is kept (shown only when non-empty) and is not in the sidebar index, which holds the three sections of the work order.
- No change to `docs/design-system.md`.

## Tier
`auto` (web, docs, tests; no guard, `.claude/`, `package*.json`, hooks or deploy).

## Behavior change
Behavior change: none to firing, discarding, K confirmation or links (same routes and payloads). Sidebar and layout change as described.

## design-language section 5
- [x] Normal state (1): no signal colour in a normal row; gate note and K3 HOLD only when abnormal; tag amber only on a row with a problem.
- [x] Greyscale (2): state is a word in the tag, a problem is a word after the title.
- [x] Signal tokens (3): only `--alert`/amber for problems through `TodoRow` tone; `.btn.is-primary` radar/`.is-danger` alert as kit defines.
- [x] No client-side rule (4): partition uses the server's `fire` field; counts are server rows.
- [x] First action in first screen height (5): first candidate row and its 발권 button are the first row below the section head.
- [x] Detail does not repeat row (6): detail omits key, title, priority; K tag in the row, K text in the detail.
- [x] Removed lines (7): constant line and "all fine" lines removed; each section head shows a count, the fold shows a count.
- [x] 390 px / 1280 px (8): measured no horizontal overflow at 390, ~1000 and 1280 in radar, night, cockpit; reading column 880 px centred.
- [x] Terms / ages (9): FLIGHT, READY, TODO, SCHEDULE NEW; ages by `timeAgo`, clock in the detail only.
- [x] Motion off (10): no motion added.
- [x] No tooltip-only decision value (11): K effects and K3 state are in the detail; tooltips repeat them.
- [x] At most five buttons per card (12): at most 발권 + 3 in an open row; discard confirmed by its own step.
- [x] Tokens only (13): css-lint passes, baseline unchanged (Release.css had no counted violations).
- [x] Keyboard path (14): row button (`aria-expanded`), then action button, then detail links; Enter/Space open.
- [x] Craft 3.5: counts below.

Craft counts: text sizes per block 3 (`--text-2xs` tag, `--text-xs` head and age, `--text-sm` row and detail); inner borders 0 (the tag outline and the discard input only); coloured blocks in a normal state 0; mono only for FLIGHT/NEW ids, tags, priority codes, counts and clock times.

### UI review (`ui-review`, mode diff, scope: `web/src/views/Release.tsx`, `Release.css`, `kit/TodoRow.tsx`, `Sidebar.tsx`, `sidebar-rows.ts`)

| Area | Inspected | Result |
|---|---|---|
| Section 5 checklist | all lines above | 0 findings after fixing the constant lines |
| Layout stability (probe) | not run; opened the first row at 1280, ~1000 and 390 in 3 themes and checked horizontal overflow only | Not verified (probe) |
| Taste brief | focal element = first candidate row and 발권; readable text not `--faint` except notes | 0 findings |
| Focus and keyboard | row button, action buttons, discard input reachable | Clear |
| Long and empty content | long title truncates in one line (wraps below the tag at narrow container width); empty sections have a one-line empty state | Clear |

Verdict: Approve. Not verified: layout-stability probe clicks.

## Checks (Playwright, mocked `/api/releases`, test server 7703, ATC_GITHUB=off, no screenshots kept)
- Described in words: at 1280 px each row is one line (tag, key, title with the `K` tag and problem, priority, button) and the open row lists status, parent, K effect, K3, order and same-file facts under the key column; at ~1000 px the title drops to a second line in the row's container; at 390 px tag, key and priority share the first line, the title and the button the second. No horizontal overflow in any of the 9 width x theme cases.
- Sidebar shows 후보 4 / Todo 발권 전 1 / 최근 발권 2; clicking 최근 발권 sets `#release/recent` and scrolls the section into view.
- `npm test` 3102 pass / 1 skipped, `npx tsc --noEmit -p .` and `npx vite build` pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

