# Design system: atc's layers (tokens → primitives → patterns → screens)

> Status (2026-10-02): **design draft; S1–S6 decided** by the SUPERVISOR on 2026-10-02, each as recommended (section 7). Written in an ENGINEERING session at the SUPERVISOR's request ("atc 레이어 설계"). Nothing is built. The references behind each choice are in [research/design-system-layers.md](research/design-system-layers.md).

Related:
- [design-language.md](design-language.md): rules and the section 4 patterns. Those rules still win; this draft only decides where things live and what may use what.
- [ui-refactor-plan.md](ui-refactor-plan.md): the work units ATC-404..434. Section 6 below maps them onto the layers.
- [layout.md](layout.md): the five screens.

## 1. Current facts

Read from `origin/main` (`44f59e6`, 2026-10-02).

- **Tokens are one tier.**
  - `web/src/styles.css` `:root` defines about 100 custom properties that a screen uses directly:
    - surfaces (`--bg` … `--panel-3`)
    - text (`--text`, `--muted`, `--faint`)
    - signals (`--radar`, `--amber`, `--cyan`, `--alert`, `--blue`)
    - type, space, radius, z and motion scales
    - domain groups (`--paper-*`, `--stamp-*`, `--fids-*`, `--phase-*`, `--series-*`)
  - The cockpit and night blocks write literal values for about 55 of them. There is no palette tier under the semantic names, so every theme is tuned by hand, value by value.
- **Primitives barely exist.**
  - `web/src/kit/Icon.tsx` (`Icon`, `IconButton`) and the dialog hook `web/src/kit/useDialog.ts` are the only shared building blocks.
  - `web/src/badges.tsx` (was `ui.tsx`) holds 11 domain badges (`SessionBadge`, `NeedsYou` …), not primitives.
  - Buttons come in about 55 class families, chips in about 20, tables in 6. There are 3 copied drawer shells.
  - U5–U8 and U2 of the refactor plan are about to add the first real primitives.
- **Patterns exist in prose only** (design-language section 4: row and detail, card, fold, chips / tags / dots, empty states). Each screen builds them its own way.
- **Screens reach across layers.**
  - `styles.css` holds tokens, shared pieces, four screens' CSS (RADAR, STRIPS, FIDS, settings), both themes and density overrides.
  - HOME imports `Drawer.css`, `DutyDrawer.css` and `fleet/Fleet.css` to borrow their classes.
  - The night block restyles strips and FIDS by selector.
- **Checks today:**
  - `server/css-lint.ts`: colour literals, px and em font sizes, literal spacing, literal radius, literal z-index, token family per colour property (ATC-437), `transition: all`, `outline: none`; ratcheted by `web/css-lint-baseline.json`.
  - `server/theme-contrast.test.ts` (ATC-408, ATC-438): a declared table of (foreground, background, minimum) pairs checked in every theme found in `styles.css`; see section 4.
  - `server/boundaries.test.ts` (ATC-335): import cycles, and web → Node imports.
  - Nothing checks which layer may use which.

## 2. Principles

1. **Four layers, used downward only.**
   - L3 screens use L2 patterns, L1 primitives and L0 tokens.
   - L2 uses L1 and L0.
   - L1 uses L0 only.
   - Nothing uses a layer above it.
   - A screen never styles another screen's classes.
2. **A theme changes token values, nothing else** (design-language section 3). Theme blocks hold custom properties only, no selectors for a view.
3. **Name tokens by job, not by shade or rank.** The test: the name must still be true in a light theme.
4. **Primitives are CSS first.**
   - A primitive is a class with its state in `data-*` or `aria-*` attributes.
   - A React component exists only where behaviour lives: focus, keyboard, open and close. That keeps the button decision Q8 and extends it.
5. **Local before global.** A value one primitive needs is a custom property on its class. It moves to `:root` when three or more places use it.
6. **Every boundary has a check.** A rule that no test or lint enforces drifts (design-language "Tokens only" needed css-lint to hold). Each layer rule in section 3 names its check.
7. **No build step.** Tokens stay plain CSS custom properties that a `node:test` can read. Anything generated is committed as plain CSS and reviewed like any other diff.

## 3. The layers

### L0 Tokens

| Group | What | Rule |
|---|---|---|
| **Palette** (decision S1) | Per theme, a neutral ramp of numbered steps with a job each (Radix-style: 1–2 app background, 3–5 component background rest / hover / pressed, 6–8 borders subtle / interactive / strong, 9–10 solid, 11–12 text low / high), plus the five signal hues | Used only by the semantic group, never by a primitive or a screen |
| **Semantic** | Surfaces (`--bg`, `--chrome`, `--panel`, `--panel-2`, `--panel-3`), text (`--text`, `--muted`, `--faint`), lines (`--line`, `--line-strong`), signals (`--radar`, `--amber`, `--cyan`, `--alert`, `--blue`), focus ring; scales for type, space, radius, z, motion, density | The only colour group primitives may use. Each theme sets this group, from the palette or directly |
| **Domain** | `--paper-*`, `--stamp-*`, `--fids-*`, `--flap-*`, `--phase-*`, `--series-*` | Point at semantic tokens where possible (`--phase-enroute: var(--radar)` already does). A theme overrides one only when the domain look differs (paper strips in Radar Console). Used by screens, not by primitives |
| **Contextual** (decision S2) | `--layer`, `--layer-hover`, set by a container for its children (Carbon) | Rows, cards and dialogs read `--layer`, so the same primitive works on any surface |

**Contrast pairs (built, ATC-438).** `server/theme-contrast.test.ts` holds a declared table (`PAIRS`) of (foreground token, background token, minimum), checked in every theme, as Primer does:
- text 4.5
- borders and focus 3
- tags and chips: their text on their fill

A new theme (the light theme, D7) cannot land unless the table passes. A pair that fails today goes in `KNOWN` with the unit that fixes it; a `KNOWN` pair that starts passing must be removed, and the minimums are never lowered.

### L1 Primitives

| Primitive | Form | Refactor unit |
|---|---|---|
| Button (`.btn`, `.is-primary`, `.is-danger`) | CSS class, `web/src/kit/Button.css` (built, ATC-411: replaces `fb-`, `rl-`, `hm-`, `apt-btn`) | U5 (ATC-411) |
| Loading (`Loading`, `Lights` in `web/src/kit/Loading.tsx` and `.css`) | Component with a CSS animation; the lights appear only after about 300 ms, the text keeps `role="status"` (ATC-453, design-language principle 10) | — |
| Chip, tag, dot (design-language 4.4) | CSS classes; a dot never stands without a word or a name | U6 (ATC-412) |
| Table and scroll region | CSS class; the scroll region as a small component (focusable, named) | U7 (ATC-413) |
| Fold | Component (`aria-expanded`, Enter / Space, the count in the header) | U8 (ATC-414) |
| Empty state | CSS class, or a one-line component | U8 |
| Segmented control | Component (radio semantics, arrow keys) | U8 |
| Dialog behaviour | Hook (focus in, Tab trap, focus return, Escape, scroll lock; `web/src/kit/useDialog.ts`, already built) | U2 (ATC-406) |
| Icon, IconButton | Component (`web/src/kit/Icon.tsx`, already built) | — |

Rules:
- A primitive's CSS uses semantic and contextual tokens only: no domain token, no literal, no screen class.
- Its states are attributes: `[aria-pressed]`, `[aria-expanded]`, `[data-tone="alert"]`.
- Its own adjustable values are local custom properties, e.g. `--btn-h`.
- Primitives live in `web/src/kit/`, one `.css` per primitive and a `.tsx` where behaviour needs one (decision S3). `web/src/badges.tsx` (was `ui.tsx`, renamed in ATC-435) holds the domain badges and `web/src/badges.css` their styles; they are not primitives.

#### U8 as built (ATC-414)

- `web/src/kit/Empty.tsx` (`.kit-empty`): one faint line, 4.6. The 38 `.empty` call sites use it; `className` only adjusts the place.
- `web/src/kit/Fold.tsx` (`.kit-fold-*`): a heading button with `aria-expanded` (click, Enter, Space) and a count or one-line summary (`foldSummary`, tested in `server/kit.test.ts`). `foldable={false}` keeps the same look without the button (a WARNING is never folded, 4.3). HOME's six sections use it; they start open.
- `web/src/kit/Segmented.tsx` (`.segmented`): the two settings copies in one component; `role="radiogroup"`, one tab stop, arrow keys, Home and End select (`nextSegment`). The ATFM switch row in `Atfm.tsx` is a different control (a labelled switch with three modes) and stays.
- `--layer` and `--layer-hover` are defined on `:root` (`--panel`, `--panel-2`); a container may redefine them for its children. Segmented reads them; no kit file uses a domain token, a literal or a screen class.

#### U7 as built (ATC-413)

- `web/src/kit/Table.css` (`.kit-table`): the base table: header row, row divider, `tabular-nums`, and `.num` on `th` and `td` for right-aligned numbers (Craft 3.5.7). It reads `--layer` and `--layer-hover`; no domain token, literal or screen class. `web/src/kit/TableScroll.tsx` (`.kit-scroll`) is the one scroll region for a wide table: a named `role="region"` with a tab stop.
- `mx-table` (METRICS DAILY and MISFIRE, NETWORK) and the NETWORK-only `Scroll` / `.nw-scroll` / `.mx-scroll` are gone; screens keep only layout (`.nw-table` turns the collapse off so row heads can stick). The ROUTE map line uses `.kit-scroll` as well.
- Three tables are still separate styles: `apt-table`, `bf-table`, `mf-table`; they move to the base in later units. `fids-table` moved in ATC-425: it carries `.kit-table` inside `.kit-scroll` and keeps its departure-board look through its own rules in `views/Tickets.css`.

### L2 Patterns

The patterns of design-language section 4: row and expanded detail, card (header, alert band, body grid, folded history), section (heading plus body), queue item, status row.

- A pattern is **a composition of primitives plus layout CSS**.
- It becomes shared code only when two or more screens draw it the same way. Likely candidates: the section heading (`h2.label` and its ten variants) and the card shell (header and alert band, from the FLEET reference card).
- Otherwise the pattern stays guidance in design-language, and each screen composes it from primitives. This is how Primer, Carbon and EUI treat patterns (decision S4).

### L3 Screens

- HOME, RELEASE, FLIGHTS (list, board, radar, radio), FLEET, METRICS, the settings window and the drawers.
- Each screen has its own stylesheet next to its view and imports only that, plus the primitives and patterns it uses.
- Screens may use semantic and domain tokens. They define no colours or new scale values.
- `styles.css` keeps no screen sections: the screen units S1–S9 move them out.

## 4. Checks, one per boundary

| Boundary | Check | Status |
|---|---|---|
| No literal colour, size, z-index, radius or spacing outside L0 | `server/css-lint.ts` (colour, font size, `em`, spacing, radius, z-index; ATC-410) | built, ratcheted |
| A property takes only its token family (`color` → text and signal tokens, `background` → surface tokens, `border-color` → line and signal tokens), as Primer's `primer/colors` does | a new css-lint rule, ratcheted like the others | built (ATC-437): rule `token-family` and the two tables `TOKEN_FAMILIES` and `PROP_FAMILIES` in `server/css-lint.ts`; today's count is in the baseline |
| Primitives use no domain token and no screen class | css-lint, scoped to the primitive files | to build |
| A screen imports no other screen's stylesheet; a primitive imports nothing from screens | `server/boundaries.test.ts`, which already parses imports, gains a layer map by path | built (ATC-436): a `kit/` file imports no screen file and no stylesheet outside `kit/`; a screen imports no stylesheet that belongs to another screen. Today's four exceptions are an allow list that only shrinks, each with the unit that removes it (HOME's three: S1, ATC-422; `SettingsAlerts` → `alerts.css`: S6, ATC-430) |
| Theme blocks hold custom properties only | css-lint: a `:root[data-theme=…]` rule with a selector after it fails | to build (with S9) |
| Contrast pairs in every theme | `server/theme-contrast.test.ts` with a declared pairs table | built (ATC-438); pairs that fail today are listed in `KNOWN` with their fixing unit |

Each new rule starts with a baseline of today's count and only goes down, as css-lint does now.

## 5. Themes

Today each theme is about 55 hand-set values. Two references make themes cheaper:
- **Linear** replaced 98 values per theme with three inputs (base, accent, contrast) in LCH.
- **Grafana** derives hover, text and border from one main colour with a contrast threshold.

Decided (S1): a theme is a short list of inputs.
- **Inputs:** background, foreground, the five signal hues, and a contrast level.
- **Generator:** a pure function produces the palette ramp and the semantic tokens.
- **Committed output:** the result is written into the theme's block of plain CSS, so no build step runs at load.
- **Tests:**
  - the contrast table checks the output;
  - a second test checks that the committed CSS equals the generator's output, so hand edits and inputs cannot drift apart.

The light theme (D7) would then be one more input set. The three dark themes would be re-expressed as inputs first, with **no visible change** as the acceptance test. Then later colour fixes become input changes.

### As built (ATC-439)

- **Inputs** (`THEMES` in `web/src/theme-gen.ts`, one entry per theme): `bg`, `surface` (the panel colour: surfaces lean toward it), `fg`, the five `hues`, `contrast` (how far `--line` and `--line-strong` sit from the background; 1 is the baseline), `depth` (how far cards and floating surfaces rise above the panel), and `glass` (translucent surfaces and lines, Night Sky). `surface`, `depth` and `glass` are additions to the S1 list: the old themes tint their surfaces differently per theme, and one background plus one foreground cannot reproduce that.
- **Generator:** `generate(inputs)` is pure. It returns the palette and the semantic tokens; `block(inputs)` formats them as CSS; `applyGenerated(css)` swaps the marked region in `styles.css`.
- **Palette** (`--n-1` … `--n-11`, `--hue-*`), each step with one job:

  | Step | Token | Job |
  |---|---|---|
  | n-1 | `--bg` | app background (layer 0) |
  | n-2 | `--scope` | inside of the RADAR scope, a breath above the background |
  | n-3 | `--chrome` | console and rail on top (layer 0.5) |
  | n-4 | `--panel` | panel (layer 1) |
  | n-5 | `--panel-2` | card, hover surface (layer 2) |
  | n-6 | `--panel-3` | floating or pressed surface (layer 3) |
  | n-7 | `--line` | divider, decorative border (no contrast requirement) |
  | n-8 | `--line-strong` | control border (WCAG 1.4.11, 3:1 target) |
  | n-9 | `--faint` | faintest text (4.5:1) |
  | n-10 | `--muted` | secondary text |
  | n-11 | `--text` | body text |

  `--hue-radar`, `--hue-amber`, `--hue-cyan`, `--hue-alert` and `--hue-blue` are the five signals, one meaning each.
- **Semantic tokens** (`--bg` … `--text`, `--radar` … `--blue`) are `var()` references to the palette. Token names did not change (S6). Domain tokens (`--paper-*`, `--fids-*`, `--blk-*`, `--phase-*`) stay hand-set, and so do `--bracket`, `--scope-glow`, shadows and fonts.
- **Written into CSS:** between `/* theme-gen:<name> begin … */` and `/* theme-gen:<name> end */` in each theme's block (`:root` is Radar Console). The output is committed; nothing runs at page load. To change a theme, edit its inputs and run `node web/gen-themes.ts`; the `:root` comment says the same.
- **Tests:** `server/theme-gen.test.ts` (pure function; committed CSS equals the generator output; no generated token is set again outside the marked region; every generated colour is within 12/255 per channel of the pre-ATC-439 hand-set value, the five hues exactly) and `server/theme-contrast.test.ts` (the pairs table in every theme).
- **Not changed:** the pairs in `KNOWN` of the contrast test still fail, because this unit kept today's colours. Raising `contrast` or the alert hue in the inputs fixes them as a visible change, tracked separately.

`color-mix()` and `oklch()` in plain CSS can do part of this at runtime (hover = the surface mixed toward the text colour). They are supported in current browsers. They are an option for hover and pressed states even without a generator.

## 6. How the refactor units change

The units of [ui-refactor-plan.md](ui-refactor-plan.md) already cover most of this. The layer model changes where some of them put their output, and adds four small units. Units already accepted by an AIRCRAFT (READBACK) are not edited: additions become follow-up issues, blockedBy the original (`docs/rules.ko.md`, "작업 지시서"). Backlog units not yet released can take the change before they are fired. On 2026-10-02 the decisions were written into the Backlog units U5–U9, S1–S9 and D7 (one Done-when line each, and blockedBy ATC-435 for U5–U8 and ATC-439 for D7); the Todo units U1–U3 were not edited, and ATC-435 moves U2's dialog hook into `kit/` if it lands first.

| Unit | Today | With the layer model |
|---|---|---|
| U2 ATC-406, U5 ATC-411, U6 ATC-412, U7 ATC-413, U8 ATC-414 | primitives added wherever fits | written into the primitives location (S3), using semantic tokens only |
| U4 ATC-410 | spacing, radius, `em` lint | unchanged; S5's property → token family rule is a new unit after it |
| U9 ATC-415 | colour literals to tokens | literals go into the semantic or domain group by the rules of L0 |
| S1–S8 ATC-422..432 | screen CSS out of `styles.css` | also: no borrowed stylesheets (the import check), patterns from L2 where shared |
| S9 ATC-433 | themes in their own files | theme files hold custom properties only (the theme-block check) |
| D7 ATC-434 | light theme by hand | the light theme as an input set (S1) |
| D8 ATC-420 | 11 px floor | unchanged (a type-scale token change) |
| **new** (filed 2026-10-02) | — | (a) [ATC-436](https://linear.app/vocado/issue/ATC-436) the layer map in `boundaries.test.ts`; (b) [ATC-437](https://linear.app/vocado/issue/ATC-437) the property → token family lint (S5); (c) [ATC-438](https://linear.app/vocado/issue/ATC-438) the contrast pairs table; (d) [ATC-439](https://linear.app/vocado/issue/ATC-439) the theme generator and its two tests, re-expressing the three dark themes with no visible change (S1); (e) [ATC-435](https://linear.app/vocado/issue/ATC-435) the `web/src/kit/` folder and the rename of `ui.tsx` (S3), before U5–U8 |

## 7. Decisions (SUPERVISOR, 2026-10-02)

Asked in the ENGINEERING session; every answer was the recommended option.

| # | Question | Decision | Affects |
|---|---|---|---|
| S1 | How is a theme defined? | **A few inputs and a pure generator** (background, foreground, the five signal hues, a contrast level). The palette and semantic tokens are written into committed CSS; a test checks that the CSS equals the generator's output. The three dark themes are re-expressed first with no visible change; the light theme is one more input set | U9, S9, D7 |
| S2 | A contextual layer token? | **Yes:** a container sets `--layer` / `--layer-hover` for its children | U5–U8 |
| S3 | Where do primitives live? | **`web/src/kit/`**, one `.css` (and a `.tsx` where needed) per primitive; today's `ui.tsx` is renamed to say it holds domain badges | U2, U5–U8, the import check |
| S4 | Patterns as code or guidance? | **Code only when two or more screens draw one the same way** (the section heading and the card shell first); the rest stays guidance in design-language section 4 | S1–S8 |
| S5 | A property → token family lint? | **Yes**, ratcheted from today's count | new unit after U4 |
| S6 | Rename tokens by job? | **No:** keep `--bg`, `--panel`, `--panel-2`, `--panel-3`, `--text`, `--muted`, `--faint`; the S1 palette carries the job names underneath | all |

## 8. Risks

| Risk | Mitigation |
|---|---|
| The layers become ceremony on a small app | Four layers, one check each; local custom properties before global tokens (principle 5); patterns as code only when shared (S4) |
| The generator makes colours worse than the hand-tuned themes | First step reproduces today's three themes with no visible change; the contrast table and a compare against today's values gate it |
| Merge conflicts with daily screen work | The units stay small and land one at a time, as in the refactor plan; the new checks start at today's count |
| The look stays generic | This draft is structure. The look comes from the screens and the SUPERVISOR's references ([ui-references.md](research/ui-references.md)); a token-only restyle was already cut |
