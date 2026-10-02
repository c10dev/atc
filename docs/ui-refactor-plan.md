# UI refactor plan: the web screen against the design system

> Status (2026-10-02): **survey and plan; the twelve questions are decided** (section 6, the SUPERVISOR's answers on 2026-10-02). Nothing here changes a screen. Written in an ENGINEERING session at the SUPERVISOR's request ("전체 UI를 디자인 시스템에 맞춰 일관되게 개선한다 — 지금은 조사와 계획만"). Audited commit: `origin/main` `bbb1c70`. The work units in section 4 are filed in Linear as ATC-405 to ATC-434 under the parent ATC-404 (section 4 has the map).

Related:
- [design-language.md](design-language.md): the rules, the 3.5 Craft section and the section 5 checklist. This plan applies them; it adds no new rule.
- [design-taste.md](design-taste.md)
- [layout.md](layout.md): the five screens, Y1–Y6, all built.
- [research/design-audit.md](research/design-audit.md): the L4 audit of the old 13 tabs. Section 3.5 below says what became of each of its items.

## 1. Scope, method and limits

- **Scope.** The atc web screen: `web/src`, 80 `.tsx` and 30 `.css` files. The request said `src/`; atc's screen lives in `web/src`. ANNUNCIATOR (atc-app) is out of scope.
- **Method.** A static read of the code and the stylesheets, plus contrast ratios computed from the token values (WCAG relative luminance). Every file:line below was checked against `bbb1c70`.
- **Not run.** No test server and no browser. So none of these were measured:
  - screens per page
  - signal colour in a normal state
  - the keyboard walk
  - the cockpit and night themes and the compact density at runtime

  Section 7 lists what that leaves open.
- **Severity.**
  - **P1** — something is broken, or a promise written in the docs or the token comments is not kept.
  - **P2** — drift from the system: tokens, scales or breakpoints are bypassed, so themes and later changes do not reach the place.
  - **P3** — duplication and structure: the same thing built several ways, or CSS in the wrong file.

## 2. What is already in good shape

Keep these; the units below must not regress them.

- **css-lint** (`server/css-lint.ts`, baseline `web/css-lint-baseline.json`) ratchets literal colours, px/rem font sizes, literal `z-index`, `transition: all` and `outline: none` without `:focus-visible`. The baseline is small: `styles.css` 43 colours, `Starfield.tsx` 2, `Drawer.css` 1 colour and 1 outline, `Follow.css` 1 and `Globe.css` 2 font sizes.
- **No literals** for `z-index`, `font-family` or transition durations. The only literal durations are the liveness animations, which the token comment exempts.
- **Themes change values only.** `radar` (`:root`), `cockpit` and `night` redefine colour and radius tokens, never `--space-*`, `--text-*`, `--z-*` or `--dur-*`.
- **Focus rings.** A global `:focus-visible` rule (`styles.css:152`) plus 37 component rules. All 5 `outline: none` have a replacement.
- **Icon buttons.** Every icon-only button has an accessible name (236 buttons, 234 `aria-label`s, the rest have text). `Icon` and `IconButton` (`web/src/Icon.tsx`, Lucide) are used in 14 and 8 files.
- **The settings window is a correct dialog** (`SettingsPanel.tsx:93-136`): it moves focus in, traps Tab, returns focus to the opener and locks page scroll. It is the model for unit U2.
- **Menus.** The FLEET card menu (`Card.tsx:683`) and the HELP menu (`HelpMenu.tsx:37`) use `role="menu"` with roving focus and Escape.
- **Scroll regions done right.** `Network.tsx` (a focusable `Scroll` region) and `MetricsFuel` (`.mf-scroll`) wrap wide tables. That is the pattern for unit U3.

## 3. Problem list

### 3.1 Broken, or a promise not kept (P1)

| Where | Problem |
|---|---|
| `views/Atfm.tsx:211,216,244,250,431` | `dp-btn` and `dp-error` have **no base rule**. Their rules went with `Dispatch.css` when DISPATCH was deleted (ATC-377). Only the modifiers `.atfm .dp-btn.atfm-off`, `.atfm-mini` and `.t-stop` remain (`Atfm.css:17,171,176`). The ATFM buttons on HOME render as browser-default buttons. |
| `styles.css` `:root` (`--faint` `#8494a6`, `--panel-3` `#212e3d`) | `--faint` on `--panel-3` is **4.44:1** in radar and about **4.36:1** in night (cockpit 5.17). The token comment ("가장 흐린 글자도 모든 층에서 4.5:1 이상") and design-language 3.1 promise 4.5:1 on every layer. `--faint` is used by 99 CSS rules and 194 `faint` class names. |
| `styles.css:1267` `.strip.is-parked` | `--paper-muted` on `--paper-parked` is 3.21:1, and the strip also has opacity 0.8. |
| `ui.css:113`, `alerts.css:85`, `DutyDrawer.css:182` | **Opacity on text:**<ul><li>`.activity.is-idle` 0.55 takes `--faint` to about 2.6:1 and `--muted` to about 3.3:1.</li><li>`.bell-item.is-acked` 0.6.</li><li>`.du-card.is-gone` 0.7.</li></ul> |
| `Drawer.tsx:459-467`, `DutyDrawer.tsx:111-155`, `IdeasDrawer.tsx:174-188` | The three drawers say `role="dialog" aria-modal="true"`, so a screen reader treats the page behind as inert. But:<ul><li>Tab leaves the drawer: there is **no focus trap**.</li><li>Focus does **not return to the opener** on close.</li><li>The window-level Escape listener also fires while typing in the DUTY drawer's textarea.</li></ul> |
| `GlobeMode.tsx:18` | `role="dialog"` without `aria-modal`. Focus is never moved into the overlay. |
| `views/GlobeAirport.tsx:179` | An SVG `<g onClick>` with no role, `tabIndex` or key handler. The line cannot be picked by keyboard. |
| `views/Metrics.tsx:298`, `views/MetricsMisfire.tsx:46` | `mx-table` (9 columns, and 6 in MISFIRE) has no scroll wrapper, so the page scrolls sideways at 390 px. This breaks principle 8. The old audit's WO7 measured 563 px at 390 px. |
| `views/Checkride.css:14`, `styles.css:1615` | `minmax(320px, 1fr)` without `min()` overflows at 375 px (327 px usable). Compare `FleetPlan.css:78`, which does it right. `.view-menu` is a fixed 300 px popover. |
| `settings.ts:44` | `prefers-reduced-motion` is read **once**, only to pick the default when nothing is saved. A saved `motion: on` keeps motion running after the OS asks for less. Principle 10 says motion stops with `data-motion="off"` **and** `prefers-reduced-motion`. |
| `views/Follow.css:145` | `.fw-dot small` is **8 px** in `--faint`. That is under the 10 px floor of the scale and is one of the 3 baselined font-size literals. |
| `ui.tsx:105` `ActivityLine` | The tool / model / idle phase is told apart only by dot colour, a tooltip and opacity. This breaks principle 2 (never colour alone) and principle 11. |

### 3.2 Token drift (P2)

| Where | Problem |
|---|---|
| CSS, all files | **75 px literals in padding, margin or gap**, out of about 1,040 spacing declarations. css-lint does not check spacing. 21 are off the 4 px scale: 1, 2.5, 3, 4.5, 10, 11, 14, 20 and 22 px. Worst files:<ul><li>`styles.css` 29</li><li>`alerts.css` 19</li><li>`Drawer.css` 4</li><li>`Docs.css` 4</li><li>`FleetPlan.css` 4</li><li>`Metrics.css` 3</li></ul>Examples: `styles.css:3451` `margin-top: 10px`, `Metrics.css:161` `margin: 8px 0 4px 22px`, `Drawer.css:229` `padding: 2px 10px`. |
| `Drawer.css:45`; `Docs.css:5,98,182`; `Fleet.css:198` | **Wrong `var()` fallbacks:**<ul><li>`var(--space-8, 40px)`, where the token is 32 px.</li><li>`var(--space-6, 32px)`, where the token is 24 px.</li><li>`var(--space-2-5, …)`: that token does not exist, so the fallback always applies.</li></ul> |
| `Drawer.css:31,93,145,174,231,262`; `Teams.css:343,370`; `MetricsFuel.css:395` | **9 literal radii.** The four 4 px ones in `Drawer.css` ignore night's `--radius-md` override (12 px). |
| `styles.css:411-483, 858-867, 1144, 1180, 1245, 1272, 1279, 1552` | About 15 of the 43 baselined colour literals sit in base rules, so they do not follow the theme:<ul><li>`.tone-alert`</li><li>`.ticker`, `.is-serious`, `-head`</li><li>`.prio`, `.prio-2`</li><li>`.los-tag`</li><li>`.fp.is-nocontact`</li><li>`.bay-rail`</li><li>`.strip.is-parked .holder` `#6b7280`</li><li>`.strip.is-los .holder`</li><li>`.fl-shade`</li></ul> |
| `settings.ts:11,18,25` | 15 hex values for the theme swatches in settings. They copy theme tokens and can drift from `styles.css`. css-lint scans only `.css` and `.tsx`, so it never sees them. `SettingsPanel.tsx:231` passes them into `style`. |
| `Starfield.tsx:5,74,93-94` | Canvas colours (`TINTS`, `addColorStop("rgba(…)")`) are not caught by the lint. `:148-149` (SVG) is baselined. |
| `styles.css` `:root` | **Type scale.**<ul><li>`--text-xs` and `--text-sm` are both 12 px in the default density. That is decided (DL7): compact sets `--text-xs` back to 11 px, so the two differ there. Not a finding; noted because the scale comment says "7단계".</li><li>There is no weight token, and four weights are in use: 700 ×96, 600 ×79, 400 ×20, 500 ×17. Craft 3.5.3 names only 600 and 400.</li><li>Five `em` font sizes pass the lint by design: `Docs.css:94,101,106` and `Drawer.css:46,167`.</li></ul> |
| cockpit and night theme blocks | `--magenta` (cockpit), `--gold` and `--display` (night) exist only inside their theme and have no `:root` default. They are safe today, because each is used only in its own theme's rules. Night keeps the base `--flap-ink` and patches the flaps by selector (`styles.css:1745-1752`). |
| all CSS | **26 `@media` queries at 13 widths:**<ul><li>860 / 861 (the main one)</li><li>640, 600, 480</li><li>one-offs: 700 (`Follow.css`), 720 (settings), 760 (Docs, Globe), 960, 1100, 1180</li><li>`ControlStrip.css:89,100`: 1761 and **767**, against the 861 / 1760 pairs used everywhere else</li></ul>There is no query below 480 and none for `pointer: coarse` or `hover: none`. |
| `App.tsx:256`, `Ticker.tsx`, `AlertBell.tsx` | **No live region** on the alert strip `ul.alerts`, the ticker or the bell count. About 45 `role="alert"` / `role="status"` exist elsewhere. The RADIO log is `aria-live="off"` on purpose. |
| controls | Hit areas:<ul><li>`.mf-table th button` has `padding: 0` (`MetricsFuel.css:98`), so the target is just the text height.</li><li>`.docs-toc button`.</li><li>`.rl-opt` and `.fl-dismiss` are 24 px.</li><li>About ten controls are 26–28 px: `.config-btn`, `.fl-btn`, `.dr-btn`, `.settings-close`, `.fl-layout-btn`, `.atfm-seg-btn` and others.</li></ul>All pass 24 px; none reach 44 px, and nothing enlarges them on touch. See Q4. |

### 3.3 Duplication (P3)

| What | Implementations |
|---|---|
| **Shared components** | `ui.tsx` exports 11 domain pieces, all session or job badges:<ul><li>`AirportCode`, `AwayTag`, `SessionPlace`, `StatusDot`, `SessionBadge`</li><li>`PriorityMark`, `NeedsYou`, `PendingApproval`</li><li>`ActivityLine`, `JobDetail`, `SuggestedReply`</li></ul>There is no shared button, chip, table, empty state, fold or dialog. |
| **Buttons** | 236 raw `<button>`s with about **55 first class names**. The big families:<ul><li>`dr-btn` 37 (drawers, `DutyCards`)</li><li>`config-btn` 37 (settings, ApplyNow, ControlBulk, ControlSessions)</li><li>`fl-btn` 36 (FLEET, FleetCrew, FleetPlan, Checkride)</li></ul>`fb-btn` (`FlightBrakes.css:14`), `rl-btn` (`Release.css:103`), `hm-btn` (`Home.css:89`) and `apt-btn` (`Airports.css:45`) are the **same button**: `--panel-2` fill, strong border, md radius, 600 sm sans, `--panel-3` on hover. They differ only in height (28–30 px). The emphasis modifier has three names: `.is-primary` (dr, fw), `.primary` / `.danger` (fl, apt) and `.is-stop` (hm). |
| **Chips, tags, badges** | About 20 variants against the three kinds of design-language 4.4 (chip, tag, dot):<ul><li>`.tag` (`styles.css:814`), `.code-chip` (`:531`), `.stamp` (`:1374`)</li><li>`.fl-chip` (pill, `Fleet.css:36`), `.dr-chip` (3 px radius, `Drawer.css:90`), `.fw-chip` (a button, `Follow.css:172`), `.hm-chip` (plain text), `.rd-chip` (pill button, `Radio.css:25`)</li><li>`cs-chip`, `since-look-chip`, `acct-model-chip`, `status-chip`, `pr-badge`, `session-badge`</li><li>one-off tags: `apt-tag`, `atfm-tag`, `bf-tag`, `fc-tag`, `cs-tag`, `los-tag`, `away-tag`</li></ul> |
| **Tables** | Six table styles, each in its own file, with no base:<ul><li>`apt-table` (`Airports.css:72`)</li><li>`mx-table` (`Metrics.css:229`)</li><li>`nw-table` (`Network.css:62`)</li><li>`bf-table` (`Briefs.css:45`)</li><li>`mf-table` (`MetricsFuel.css:83`, 6 tables)</li><li>`fids-table` (`styles.css:1691`)</li></ul> |
| **Empty states** | `.empty` (`styles.css:214`, 38 uses), plus nine variants:<ul><li>`nw-empty`, `mx-empty`, `mf-empty`, `fp-empty`</li><li>`rl-none`, `fids-empty`, `bell-empty`</li><li>`settings-hits-none`, `alert-quiet`</li></ul> |
| **Segmented controls** | One `Segmented` component, **copy-pasted** in `SettingsPanel.tsx:310` and `SettingsAlerts.tsx:253`. About eight more hand-built ones:<ul><li>`.view-switch`</li><li>`.mx-range`, `.mx-sub`</li><li>`.fl-views`, `.fl-layout-btn`</li><li>`.atfm-seg`, `.flp-seg`, `.rm-seg`</li><li>`.rd-chip[aria-pressed]`</li></ul> |
| **Dialogs and drawers** | The three drawer shells (backdrop, Escape, focus on open) are near line-for-line copies. `fleet/usePanelFocus.ts` is a fourth focus helper. Only `SettingsPanel` is complete (3.1). |
| **Folds** | Each screen folds its own way: GATE CLEANUP, the FIDS group caps, the FLEET card's `더 보기`, the HOME sections. This is the old audit's C8. |
| **Section headers** | `h2.label` (53 uses) plus about ten others:<ul><li>`dr-h`, `dr-title`</li><li>`fl-sub`, `rm-h4`, `rm-sub`</li><li>`mf-sub`, `mft-glabel`</li><li>`globe-rows-head`, `docs-group-title`, `fc-change-head`</li></ul>`.settings-section` is defined twice (`styles.css:2333` and `:2438`). |
| **Prefixes** | `fl-` means FLIGHTS in `Flights.tsx` (`fl-view`, `fl-views`) and FLEET in `views/fleet/` (`fl-btn`, `fl-row`, `fl-card` …). |

### 3.4 Structure (P3)

`web/src/styles.css` has 3,492 lines, and most of them belong to one screen:

| Lines | What | Belongs in |
|---|---|---|
| 1–237 | tokens, numerals, icons, `.label`, `.empty` | stays |
| 238–812 | console header, ticker, alert levels, NEW VERSION and UPDATE bars, tab error | a header stylesheet next to `App.tsx` / `UpdateBar.tsx` |
| 813–888 | `.tag`, `.dot` and other shared pieces | stays (the base for U6) |
| 889–1216 | RADAR | `views/Map.css` (Map has no stylesheet) |
| 1217–1397 | FLIGHT STRIPS | `views/Teams.css` (exists) |
| 1398–1847 | FIDS, split-flap, display options | `views/Tickets.css` (new), `SplitFlap.tsx` |
| 1849–2128 | motion off, header responsive rules (mostly `.fids-table`) | split between the header and FIDS |
| 2129–2251 | Glass Cockpit theme | a theme file |
| 2252–2882, 3345–3492 | settings window, AUTOLAND, theme cards, `.segmented`, AUTOMATION, ACCOUNTS, PLAN·USAGE | `SettingsPanel.css` (new, about 780 lines) |
| 2883–3282 | Night Sky theme, including per-view overrides of strips and FIDS | a theme file; the per-view parts move with their view |
| 3283–3344 | compact density overrides for RADAR, strips and FIDS | with their views |

Other structure findings:

- **Dead classes**, found by searching the TSX. Names built from templates were excluded.
  - `dp-score`, `dp-age`, `dp-count`, `sc-age`, `sc-cand-count` (`styles.css:176-180`, left by DISPATCH and SCHEDULE)
  - `fl-actuals` (173), `tab-label` (338), `column-label` (1432), `fids-group-th` (1722), `acct-next` (3458)
- **HOME borrows other screens' stylesheets.** `Home.tsx` imports `Drawer.css`, `DutyDrawer.css` and `fleet/Fleet.css` to reuse their classes.
- **Stale text.**
  - `styles.css:1869` still says "탭 10개".
  - `layout.md` line 3 says "Nothing here is built", while its own section 4 records Y1–Y6 as built.
  - The Y6 note in `layout.md` still mentions NETWORK in the tab row.
  - The layout.md status belongs to DUTY or ENGINEERING; this plan only reports it.

### 3.5 What became of the L4 audit's items

| Item in [design-audit.md](research/design-audit.md) | State on `bbb1c70` |
|---|---|
| WO1 DISPATCH Craft pass | Done (ATC-315). The view was later deleted (ATC-377). |
| WO2 FIDS fold and collapse | Done (ATC-316). |
| WO3 FLEET outside the card | Done (ATC-317). |
| WO4 SCHEDULE | Gone with the view (ATC-378). |
| WO5 RADIO neutral lines and width | Not done. Carried into **S3d**. |
| WO6 STRIPS and RADAR | `.apt` part done (C1). Sizes and borders carried into **S3a** and **S3c**; re-measure, because both are now FLIGHTS views. |
| WO7 AIRPORTS and METRICS tables at 390 px | METRICS is P1 above, unit **U3**. AIRPORTS (now in settings) is re-measured in **S6**. |
| WO8 Header and NETWORK at 390 px | The tab row went from 13 tabs to 5, and the readouts wrap (ATC-364). Re-measure in **S8**. |
| WO9 literal font sizes | 3 left (`Follow.css:145`, `Globe.css` ×2). Unit **U1**. |
| C1 `.apt` neutral | Done (ATC-313). |
| C2 Korean sentences in mono | Not done. **D6**. |
| C3 tooltip pass (L6) | Not done. There are 238 `title=` attributes now (DISPATCH's 1,864 left with it). **D5**. |
| C4 nested borders | Not re-measured. Each screen unit checks Craft 3.5.4. |
| C5 text-glyph icons | The Lucide set is in. 36 glyphs remain in TSX. **D6**. |
| C6 header animations | Re-measure in **S8**. |
| C7 client-side level rule | Done (the `pct >= 80` rule is gone). |
| C8 shared fold component | Not done. **U8**. |

## 4. Work units

**Filed (2026-10-02).** Parent [ATC-404](https://linear.app/vocado/issue/ATC-404). U1, U2, U3, D1 and D4 were released to Todo; the rest wait in Backlog behind their blockers and show as READY on the RELEASE screen once those are done. Priority Medium for all.

| Unit | Issue | Unit | Issue | Unit | Issue |
|---|---|---|---|---|---|
| U1 | ATC-405 | U9 | ATC-415 | S6 | ATC-430 |
| U2 | ATC-406 | U10 | ATC-416 | S7 | ATC-431 |
| U3 | ATC-407 | S1 | ATC-422 | S8 | ATC-432 |
| U4 | ATC-410 | S2 | ATC-423 | S9 | ATC-433 |
| U5 | ATC-411 | S3a | ATC-424 | D1 | ATC-408 |
| U6 | ATC-412 | S3b | ATC-425 | D2 | ATC-421 |
| U7 | ATC-413 | S3c | ATC-426 | D3 | ATC-417 |
| U8 | ATC-414 | S3d | ATC-427 | D4 | ATC-409 |
| | | S4 | ATC-428 | D5 | ATC-418 |
| | | S5 | ATC-429 | D6 | ATC-419 |
| | | | | D7 | ATC-434 |
| | | | | D8 | ATC-420 |

Each unit is one PR. The tier is `auto` unless noted; `deploy/landing-tier.mjs` decides from the changed paths. Sizes are S, M and L as in Linear.

**Done when — common to every unit:**

- `npm test`, `npx tsc --noEmit -p .` and `npx vite build` pass.
- Where a lint count drops, the baseline is lowered in the same PR (`node server/css-lint.ts --update`). It is never raised.
- The PR body answers the design-language section 5 lines that apply. A screen unit also runs the `ui-review` skill and a Playwright pass at 1280, about 1000 and 390 px, in the three themes, described in words (no screenshots: the repository is public).
- A unit that changes what the SUPERVISOR sees adds a `changelog.d` fragment and updates `docs/guide/screens.md` where the guide describes it.

### Phase 0: fixes and guardrails

These need no decision. Apart from the fix itself, nothing should look different.

| Unit | What | Files | Size | Done when |
|---|---|---|---|---|
| **U1 Leftovers** | <ul><li>Give `dp-btn` and `dp-error` a real style: rename them to the button and error classes the rest of HOME uses, or add base rules in `Atfm.css`.</li><li>Delete the dead classes (3.4).</li><li>Fix the three wrong fallbacks and the missing `--space-2-5`.</li><li>Replace the three literal font sizes: `Follow.css:145` (8 px to `--text-2xs`) and `Globe.css` ×2.</li><li>Fix the `styles.css:1869` comment.</li></ul> | `Atfm.tsx`/`.css`, `styles.css`, `Drawer.css`, `Docs.css`, `Fleet.css`, `Follow.css`, `Globe.css` | S | ATFM buttons have a styled base in the three themes; `font-size-px` drops to 0 in the baseline; no `var()` fallback differs from its token. |
| **U2 Dialog behaviour** | Extract a `useDialog` hook from `SettingsPanel.tsx:93-136`: focus in, Tab trap, Escape, focus back to the opener, scroll lock. Use it in:<ul><li>`Drawer`, `DutyDrawer`, `IdeasDrawer`. Escape inside a text field first leaves the field.</li><li>`GlobeMode`, which also gets `aria-modal`.</li></ul>Give `GlobeAirport.tsx:179` a keyboard path (`role="button"`, `tabIndex=0`, Enter / Space). Decide whether `fleet/usePanelFocus.ts` folds into the hook. | `Drawer.tsx`, `DutyDrawer.tsx`, `IdeasDrawer.tsx`, `GlobeMode.tsx`, `views/GlobeAirport.tsx`, `SettingsPanel.tsx`, new hook | M | <ul><li>With a drawer open, Tab and Shift+Tab stay inside it.</li><li>Closing returns focus to the button that opened it.</li><li>Escape in the DUTY textarea does not close the drawer.</li><li>A GLOBE line can be picked with the keyboard.</li></ul> |
| **U3 Narrow overflow** | <ul><li>Wrap both `mx-table`s in the existing focusable `Scroll` region (Network) or `.mf-scroll`.</li><li>`Checkride.css:14` gets `minmax(min(320px, 100%), 1fr)`.</li><li>`.view-menu` gets `width: min(300px, 100vw - 2 * var(--gutter))`.</li></ul> | `views/Metrics.tsx`, `views/MetricsMisfire.tsx`, `Checkride.css`, `styles.css` | S | No horizontal page scroll at 375 and 390 px on METRICS (all sub-views), FLEET → CHECKRIDE and FLIGHTS → BOARD options. |
| **U4 Lint extension** | Add three rules to `server/css-lint.ts` (Q6):<ul><li>spacing literals (px in padding / margin / gap / inset)</li><li>radius literals</li><li>`em` font sizes</li></ul>`.ts` files stay outside the scan (Q6); U9 pins the `settings.ts` swatches with a test instead. Then record the new baseline. | `server/css-lint.ts`, `server/css-lint.test.ts`, `web/css-lint-baseline.json` | M | The tests cover each new rule; the baseline holds today's counts, so later units can only lower them. |

### Phase 1: shared primitives

Each primitive is extracted from the best existing instance, not designed fresh. Each PR migrates at least the instances it was taken from, so the base is used from day one.

| Unit | What | Size | Done when |
|---|---|---|---|
| **U5 Button** | <ul><li>A base `.btn`, plus a quiet and an emphasis variant and a destructive one, from the identical `fb-` / `rl-` / `hm-` / `apt-btn` four.</li><li>A CSS class, not a React component (Q8). Modifiers `.is-primary` and `.is-danger`; `.primary`, `.danger` and `.is-stop` are retired as their screens move.</li><li>Migrate those four in the same PR.</li></ul> | M | The four old classes are gone; one height token for controls; the emphasis modifier has one name. |
| **U6 Chip, tag, dot** | <ul><li>Bases for the three kinds in design-language 4.4: chip = pill, selectable or counted; tag = 2 px, mono, uppercase; dot.</li><li>The dot never stands alone without a word or an accessible name. This fixes `ActivityLine` (3.1).</li><li>Migrate `.tag`, `.code-chip`, `.dr-chip`, `.fl-chip`.</li></ul> | M | <ul><li>Those four use the bases.</li><li>`ActivityLine` reads in greyscale.</li><li>No new chip class is added outside the bases.</li></ul> |
| **U7 Table** | <ul><li>A base table rule: header, row line, `tabular-nums`, right-aligned numbers per Craft 3.5.7.</li><li>The `Scroll` wrapper as a shared component.</li><li>Migrate `mx-table`, which U3 has just touched.</li></ul> | S | `mx-table` uses the base; the base sets numeric alignment once. |
| **U8 Empty, fold, segmented** | <ul><li>One empty-state component (design-language 4.6).</li><li>One fold component that always shows a count and opens by click or key (4.3, the old C8).</li><li>One `Segmented` replacing the two copies.</li></ul> | M | <ul><li>`Segmented` exists once.</li><li>The fold is used by at least one screen (HOME sections).</li><li>The empty component replaces `.empty` call sites.</li></ul> |
| **U9 Colour literals to tokens** | <ul><li>Move the base-rule literals of 3.2 (`.tone-alert`, ticker, `.prio`, `.los-tag`, `.bay-rail`, holders, `.fl-shade`) into `:root` and the theme blocks.</li><li>Pin the `settings.ts` swatches with a `node:test` that compares them with the theme tokens in `styles.css` (the lint does not scan `.ts`, Q6).</li><li>Give `--magenta`, `--gold` and `--display` a `:root` default.</li></ul> | M | `color-literal` in `styles.css` counts only the `:root` and theme blocks; the swatches cannot drift. |
| **U10 Spacing and radius sweep** | <ul><li>Put the 75 spacing literals and the 9 radius literals onto the scale, file by file: `alerts.css`, `Drawer.css`, `Docs.css`, `Metrics.css`, `FleetPlan.css`, `Teams.css`, `MetricsFuel.css`, `Card.css`.</li><li>Every off-scale value snaps to the nearest step, with no exception (Q7): 1 and 2.5 px → `--space-0-5`, 3 and 4.5 px → `--space-1`, 10 px → `--space-2` or `--space-3` by context, 14 px → `--space-3`, 20 and 22 px → `--space-6`. Borders are not spacing and keep 1 px.</li><li>Leave the `styles.css` screen sections to their screen units.</li></ul>Needs **U4**. | M | The spacing and radius counts in the baseline drop to the `styles.css` screen sections only. |

### Phase 2: one PR per screen

Each screen unit does three things in the same PR, as layout.md principle 5 asks:

- moves the screen onto the phase 1 primitives
- moves that screen's CSS out of `styles.css` into its own file
- deletes the classes it replaces

It also checks Craft 3.5 on that screen: colour budget, font roles, three sizes, the border budget (old C4) and spacing rhythm.

| Unit | Screen | Notes |
|---|---|---|
| **S1** | HOME (with `Atfm`, `HumanCheck`, `SinceLook`) | Stop importing `Drawer.css`, `DutyDrawer.css` and `Fleet.css` for borrowed classes; use the primitives. Use the fold (U8) for the sections. |
| **S2** | RELEASE | `rl-btn` is already migrated in U5. Check the candidate rows against 4.1 (row and detail). |
| **S3a** | FLIGHTS → LIST and the AIRCRAFT STRIPS fold | STRIPS lines 1217–1397 go to `Teams.css`. Rename the FLIGHTS classes `fl-view`, `fl-views` to `ft-` (Q9). The parked strip contrast is D1's. |
| **S3b** | FLIGHTS → BOARD (FIDS) | Lines 1398–1847 go to a new `Tickets.css`. `fids-table` goes onto the U7 base. |
| **S3c** | FLIGHTS → RADAR | Lines 889–1216 go to a new `Map.css`. |
| **S3d** | FLIGHTS → RADIO | `--blue` only for NEEDS YOU and HANDOFF (old WO5); use the width at 1280. |
| **S4** | FLEET | Move `fl-btn` onto `.btn` and `fl-chip` onto the chip base. FLEET keeps `fl-` (Q9). |
| **S5** | METRICS (OPERATIONS, LEAKS, MISFIRE, FUEL, NETWORK) | `mf-table`, `nw-table` and `bf-table` onto the table base. The `mf-table` sort buttons get a 24 px target (D3). |
| **S6** | Settings window, including AIRPORTS | Lines 2252–2882 and 3345–3492 go to a new `SettingsPanel.css`. Merge the two `.settings-section` rules. `config-btn` onto `.btn`. Re-measure `apt-table` at 390 px. |
| **S7** | Drawers (FLIGHT, PR, DUTY, IDEAS) and `DutyCards` | `dr-btn` and `dr-chip` onto the primitives; drawer radii from the tokens. |
| **S8** | Header, ALERT line, ticker, bell, UPDATE bar | Lines 238–812 move next to `App.tsx`. Add live regions to `ul.alerts`, the ticker and the bell count. Re-measure the header at 390 px and its running animations (old WO8 and C6). |
| **S9** | Themes | Move the cockpit and night blocks into their own files. Any per-view override still left in them moves to its view. Comes last, after the screens have taken their sections. |

### Phase 3: units set by the decisions

Each of these was waiting on a question; section 6 answers them all, so each can be filed.

| Unit | What | Decision | Size |
|---|---|---|---|
| **D1** | <ul><li>Lighten `--faint` in radar and night until it is 4.5:1 or more on `--panel-3`, and check it on every other layer of all three themes.</li><li>Raise `--paper-muted` on parked paper to 4.5:1.</li><li>Remove opacity from text (`.activity.is-idle`, `.bell-item.is-acked`, `.du-card.is-gone`, `.strip.is-parked`); mark the state another way (a word or a weight).</li></ul> | Q1 (a) | S |
| **D2** | <ul><li>Breakpoints 860, 600 and 480, plus 1760 for the header only, written in the `:root` comment block (CSS variables cannot be used in `@media`).</li><li>Move every `@media` onto them: 640 and 700–767 go to 600 or 860, 960–1180 to 860, `ControlStrip.css` 767 / 1761 to 860 / 1760.</li><li>Re-check each moved layout at 390, ~1000 and 1280 px.</li></ul> | Q2 | M |
| **D3** | Keep the 24 px desktop minimum; no `pointer: coarse` rule. Raise the controls under 24 px: the `mf-table` sort buttons (with S5) and `.docs-toc` buttons. | Q4 (a) | S |
| **D4** | Reduced motion from the OS always wins: listen to the `matchMedia` change and set `data-motion="off"` while the OS asks for less, whatever the saved setting says. The setting still turns motion off when the OS allows it. Update the settings hint. | Q5 (a) | S |
| **D5** | Tooltip pass (L6, old C3), limited to tooltips that hold a number or a state not on the screen. They move onto the screen; tooltips that explain how a value is made stay. | Q10 (a) | M |
| **D6** | Mono for IDs, codes and numbers only (old C2); replace the 36 text glyphs with Lucide icons (old C5). | — (after U6) | M |
| **D7** | **A light theme as a fourth choice** in settings, not picked by the OS. It needs:<ul><li>values for every colour token, including paper, FIDS, stamps and series</li><li>`color-scheme: light` in its block (`:root` fixes `dark` today)</li><li>the Starfield and backdrop off</li><li>4.5:1 for `--faint` on every layer</li><li>a swatch entry in `settings.ts`, pinned by U9's test</li></ul>The values are proposed in the PR and checked by the SUPERVISOR before landing. | Q3 (b) | L |
| **D8** | <ul><li>Retire weight 500 (17 uses) to 400 or 600 by role; no weight tokens.</li><li>Raise `--text-2xs` from 10 to **11 px**; 11 px becomes the floor for every text. In compact density `--text-2xs` and `--text-xs` are then both 11 px.</li><li>Update the `:root` comment ("영문 약호는 10") and design-language 3.3 in the same PR.</li><li>Re-check the header readouts and table headers at 860 and 1280 px, since uppercase codes grow by 10 %.</li></ul> | Q11 (b), Q12 (b) | M |

## 5. Order and dependencies

```
Phase 0   U1 ─┐
          U2 ─┼─→ U4 ─┐
          U3 ─┘       │
Phase 1        U5  U6  U7  U8  U9  U10 (after U4)
Phase 2   S1 S2 S3a S3b S3c S3d S4 S5 S6 S7 S8   (any order) ─→ S9 ─→ D7
Phase 3   D1 D4 (now) · D2 D3 D5 D6 D8 (any time, D6 after U6) · D7 (after U9 and S9)
```

- **Start with U2 and U3.** They fix keyboard and narrow-screen bugs, need no decision and touch few files. U1 can run beside them.
- **U4 comes before the sweeps.** Without the new lint rules, the spacing and radius work in U10 and the screen units can slide back.
- **Phase 1 before phase 2.** A screen unit without the primitives would just create one more local button and chip.
- **One screen unit at a time per file group.** layout.md section 5 names the conflict risk: many AIRCRAFT edit screen files every day. Screen units are small and land as they pass; there is no long-lived restyle branch, and no single PR splits all of `styles.css`.
- **S9 last.** The theme blocks hold per-view overrides that move with their screens.
- **D1 and D4 early.** Both fix a broken promise, are small and are now decided.
- **D7 last.** A light theme is easiest once every colour is a token (U9) and each theme lives in its own file (S9).
- **D8 before the screen units where possible.** It changes text sizes on every screen; landing it early means each screen unit checks its layout once.

## 6. Decisions (SUPERVISOR, 2026-10-02)

The twelve questions of the first draft, answered by the SUPERVISOR in the ENGINEERING session. Where the answer differs from the draft's recommendation, the recommendation is given in brackets.

| # | Question | Decision | Unit |
|---|---|---|---|
| Q1 | `--faint` misses 4.5:1 on `--panel-3`: how is it fixed? | **Lighten `--faint`** in radar and night | D1 |
| Q2 | Which breakpoints stay? | **860, 600, 480**, plus 1760 for the header only | D2 |
| Q3 | A light theme? | **Yes, as a fourth theme** chosen in settings (recommended: not in this plan) | D7 |
| Q4 | Minimum target size? | **Keep 24 px**; no larger targets on touch (recommended: 44 px under `pointer: coarse`) | D3 |
| Q5 | Saved motion setting or the OS's reduced motion? | **The OS wins** when it asks for less | D4 |
| Q6 | What does the lint extension check? | **Spacing literals, radius literals, `em` font sizes.** Not colour literals in `.ts` (recommended: all four) | U4, U9 |
| Q7 | Off-scale spacing values? | **Snap every one to the nearest step**, no 1 px exception (recommended: allow 1 px hairlines) | U10 |
| Q8 | Button primitive? | **CSS class `.btn`** with `.is-primary` / `.is-danger` | U5 |
| Q9 | The shared `fl-` prefix? | **FLIGHTS' classes become `ft-`**; FLEET keeps `fl-` | S3a, S4 |
| Q10 | Tooltip pass scope? | **Only tooltips holding a number or a state** not on the screen | D5 |
| Q11 | Font weights? | **Retire 500**; no weight tokens (recommended: tokens for 400 / 600 / 700) | D8 |
| Q12 | 10 px `--text-2xs`? | **Raise the floor to 11 px** (recommended: keep 10 px for codes). This changes the `:root` comment and design-language 3.3 | D8 |

## 7. Not covered

- **ANNUNCIATOR** (atc-app).
- **Runtime measurements.** None of these were measured:
  - screens per page, coloured elements in a normal state, nested borders, text sizes per card (old audit method)
  - the keyboard walk of every screen
  - the cockpit and night themes and the compact density in a browser

  Each screen unit measures them for its screen.
- **The production screen (7700)** was not opened.
