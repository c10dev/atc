# FLIGHTS LIST: two-line rows that fit the column with the drawer open

[한국어](flights-list.ko.md) · **English**

Status (2026-10-03): design draft. Nothing here is built. Decided by the SUPERVISOR in a grilling session on 2026-10-03; the stage indicator (option E, one pie glyph) was picked after a private prototype round at 1000 px with the drawer open, 1280 and 390 px. The work orders are in section 5.

**The SUPERVISOR accepts that the LIST stays broken with the FLIGHT drawer open until this lands.** There is no separate hotfix; one redesign replaces the rows.

Related: [follow.md](follow.md) (the board, stages, stuck limits), [layout.md](layout.md) (FLIGHTS is one of the five screens), [design-language.md](design-language.md) (rules and checklist), [duty-screen.md](duty-screen.md) (the drawer pattern).

## 1. Current facts

Read from `origin/main` on 2026-10-03.

- **The break.** At the SUPERVISOR's width (about 1000 px) with the FLIGHT drawer open, the drawer is `clamp(360px, 44vw, 560px)` = 440 px, so the LIST column is about 510 px (about 470 px inside the bundle). `.fw-row` in `web/src/views/Follow.css` is `grid-template-columns: minmax(180px, 1.2fr) auto auto minmax(160px, 1.4fr)`. The dots column is `auto` and cannot shrink (9 dots × 26 px plus gaps, about 266 px). The minimum sum is about 640 px, so the last column overflows the bundle and wraps per character ("살펴보/기", "작업 25시/간").
- **The narrow rule never fires.** It is `@media (max-width: 700px)`, which reads the viewport, not the column the drawer narrowed. `web/src/kit/TodoRow.css` already solves the same problem with `@container`.
- **`.fw-now` is a bucket.** It is a `flex-wrap` area with seven kinds of content and no fixed slots: the now text, the stuck mark, issue tags, `LandingBadge`, `BlockList`, the next chip and `FlightBrakes`.
- **Rule gap.** [design-language.md](design-language.md) has no rule that components size from their container, and every check width in [layout.md](layout.md) (1000, 1280, 390) is with the drawer closed.
- **Widths measured in the prototype** (no row overflowed): 1000 px with the drawer open, bundle 432 px (the sidebar folds itself, layout.md 7.3); **1280 px with the sidebar and the drawer open, bundle 332 px, narrower than at 1000**; 390 px, bundle 334 px.
- **Row data.** `FollowRow` (`server/follow.ts`) has `stages`, `current`, `finished`, `now` (a finished string), `issues`, `stuck`, `next`. `now` comes from `progressText` (`server/progress.ts`), for example `작업 25시간 41분 · 보통 5–14분 (BUILD·M, n=279) · 길어짐`. `FlightProgress` already has `elapsedMin`, `typical` and `late`, but they are flattened into that string before they reach the row.
- **Order.** `stuckFirst` puts stuck rows first in a bundle; nothing orders in-flight before waiting.
- **Stage grouping** (follow.md 3.2): `todo`, `proposed`, `approved`, `sent` happen before the CAPTAIN takes the FLIGHT; `readback`, `pr` are the FLIGHT; `ci`, `landed`, `deployed` are LANDING. So the groups are 4 · 2 · 3, DISPATCH / FLIGHT / LANDING.

## 2. Principles

1. **LIST answers one question: "where is each FLIGHT, and is it stuck?"** It is a watch screen. Actions live in the FLIGHT drawer.
2. **Rows size from their container.** A row is two lines at every width. Its minimum column sum fits the column with the drawer open. Breakpoints are `@container` queries on the row's own container, never `@media`.
3. **One signal per row.** The row shows at most one chip (and `+n`), by priority: stuck, warn issue, landing badge, info issue. The explanations are in the drawer.
4. **Never colour alone.** Stuck is amber plus the word `막힘`. Over the usual range is amber plus the word `길어짐`.
5. **The server decides, the browser draws** (design-language 4). Elapsed, usual range and lateness come as fields; the browser does not parse a string.
6. **No new facts.** Every field comes from a record atc already keeps.

## 3. The design

### 3.1 The row

Always two lines.

```
Line 1:  ATC-381 · Small moves: AIRPORTS into settings, GLOBE to th…   [막힘 PR 없음 +1]
Line 2:  ◔ RB · 25h 41m / usual 5–14m · 길어짐
```

- **Line 1:** KEY, the title (one line, ellipsis), and on the right one signal chip with `+n` for the others. Chip priority: stuck > warn issue (`NO-PR` …) > landing badge > info (`FUEL …`).
- **Line 2:** the stage indicator, the current stage name (`RB`), elapsed and the usual range. When elapsed is over the usual range the text is amber with the word `길어짐`. The sample detail (`BUILD·M, n=279`) moves to the row's title text and the drawer.
- The glyph does not say which stage is stuck. The line 2 text (`row.stuck.text`, amber) and the stage name carry it, and the per-stage times are in the drawer. The old dot tooltips go away.
- **Open row.** The row open in the drawer has a 2 px left bar and a faint background, cleared when the drawer closes. `↑`/`↓` to open the next row is optional.
- Clicking the row (or `Enter`) opens the FLIGHT drawer, as today.

### 3.2 The stage indicator (SUPERVISOR's pick: E)

One Linear-style pie glyph of about 14 px that fills with progress. The current stage fills half a step; a full pie means finished only (otherwise a STAND-free FLIGHT at its last stage would look finished). Amber when stuck. Not-applicable stages (STAND-free, `tail:`, no deploy) keep their slot in the count.

The grouped-dot option (B: dots 4 · 2 · 3 with gaps) was shown and not picked.

**Narrow fallback.** Below a container of about 320 px, the glyph is hidden and the text `RB 5/9` is shown. The prototype never reached it (the narrowest bundle was 332 px), so it is a guard, not a measured case.

### 3.3 What moves to the drawer

Out of the row, into the FLIGHT drawer: `살펴보기`, `Todo로` (also on RELEASE, layout.md), `CANCEL` / `RECALL` (`FlightBrakes`), the issue explanations, `기록 n` (history), `BlockList`, and the per-stage times. These must exist in the drawer **before** the row stops showing them, so no action disappears between two PRs (section 5, order).

### 3.4 The bundle

- Order inside a bundle: **stuck → in flight → waiting** (new: in flight before waiting).
- Head: `ARROWS · 막힘 3 · 비행 6 · 끝남 65/75`, with `막힘` first and amber. `다음 할 일` is dropped (its actions are in the drawer).
- Finished rows fold into one `끝남 n` line at the end of the bundle. Opened, they are faint one-line rows.
- The `따라가는 FLIGHT` input moves to the bottom of the list. It needs `flex: none`: `.fw-form` inside the column-flex `.follow` grows to its flex-basis height today.
- **Out of scope:** LATE WAYPOINTS, LANDING SEQUENCE and AIRCRAFT STRIPS stay as they are.

### 3.5 Server fields

- `FollowRow.progress: {elapsed, usual, late, sample} | null` (additive), built from `FlightProgress`; `now` keeps its text for the old readers and the alerts. `elapsed` in minutes, `usual` as `{lo, hi}` minutes or null, `late` boolean, `sample` the `BUILD·M, n=279` group text.
- Row order: `stuckFirst` followed by in flight before waiting (stable).
- The landing badge text needs the PR (`pulls`), as the old row had it; the signal chip reads it from there.
- Bundle counts `stuck`, `flying`, `finished`, `total` already exist (follow.md F1/F2).

## 4. Rules (same PR as this draft)

- design-language.md principle 8 gains: **rows and cards size from their container (`@container`), and a row's minimum column sum fits the column with the drawer open.**
- design-language.md section 5 gains a checklist line, "1000 px with the FLIGHT drawer open: no row overflows its column", and layout.md's Playwright widths gain **1000 px with the drawer open** and **1280 px with the sidebar and the drawer open** (the narrowest case, 332 px).

## 5. Implementation order

All three are `auto` (server read model, `web/src`, docs). The implementing PRs answer the design-language section 5 checklist in the body and run `ui-review` at 1000 px with the drawer open. No screenshots in the public repo or PRs; describe the screens in words.

| # | Step | Output | Needs |
|---|---|---|---|
| LS1 ([ATC-491](https://linear.app/vocado/issue/ATC-491)) | **Row data.** `FollowRow.progress`, in-flight-before-waiting order, with `node:test` | The browser can draw line 2 and the order without parsing | none |
| LS2 ([ATC-492](https://linear.app/vocado/issue/ATC-492)) | **Drawer takes the actions.** `살펴보기`, `Todo로`, CANCEL/RECALL, issue explanations, 기록, BlockList and per-stage times in the FLIGHT drawer | Nothing the old row did is lost when the row is cut | none |
| LS3 ([ATC-493](https://linear.app/vocado/issue/ATC-493)) | **Two-line rows, bundle head, input.** Section 3.1–3.4: container query, pie glyph, signal chip, open-row mark, finished fold, head, input at the bottom | The LIST fits at 1000 (drawer open), 1280 (sidebar and drawer open) and 390 px | LS1, LS2 |

Checks for each step: `npm test`, `npx tsc --noEmit -p .`, `npx vite build`; a 7702 test server (`ATC_GITHUB=off`, temp state folder) with seeded data: a stuck row, an over-usual row, a row with several issues, a not-applicable stage, a finished bundle, long titles.

## 6. Risks

| Risk | Mitigation |
|---|---|
| The pie does not show which stage is stuck | Line 2 text and the stage name carry it; per-stage times in the drawer. Decided by the SUPERVISOR after seeing both |
| A row loses an action before the drawer has it | LS3 is blocked by LS2 |
| The 320 px fallback is untested | It is a guard; the ui-review pass forces a narrow container once and describes it |
| `progress.sample` shown only in a title | Title text is not a decision aid (design-language 11); the drawer shows the same text |

## 7. Decisions

**Made (SUPERVISOR, 2026-10-03):**

- One redesign, no hotfix; the LIST stays broken with the drawer open until it lands.
- The two-line row, the signal chip order, the move of actions to the drawer, bundle order and head, finished fold, input at the bottom.
- Stage indicator: **E, the pie glyph**.
- Rules for container sizing and the new check widths.
