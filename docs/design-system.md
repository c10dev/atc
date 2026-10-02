# Design system: atc's layers (tokens → primitives → patterns → screens)

> Status (2026-10-02): **design draft, not decided.** Written in an ENGINEERING session at the SUPERVISOR's request ("atc 레이어 설계"). Nothing is built. Section 7 lists the decisions the SUPERVISOR has to make. The references behind each choice are in [research/design-system-layers.md](research/design-system-layers.md).

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
  - `web/src/Icon.tsx` (`Icon`, `IconButton`) is the only shared building block.
  - `web/src/ui.tsx` holds 11 domain badges (`SessionBadge`, `NeedsYou` …), not primitives.
  - Buttons come in about 55 class families, chips in about 20, tables in 6. There are 3 copied drawer shells.
  - U5–U8 and U2 of the refactor plan are about to add the first real primitives.
- **Patterns exist in prose only** (design-language section 4: row and detail, card, fold, chips / tags / dots, empty states). Each screen builds them its own way.
- **Screens reach across layers.**
  - `styles.css` holds tokens, shared pieces, four screens' CSS (RADAR, STRIPS, FIDS, settings), both themes and density overrides.
  - HOME imports `Drawer.css`, `DutyDrawer.css` and `fleet/Fleet.css` to borrow their classes.
  - The night block restyles strips and FIDS by selector.
- **Checks today:**
  - `server/css-lint.ts`: colour literals, px font sizes, literal z-index, `transition: all`, `outline: none`; ratcheted by `web/css-lint-baseline.json`.
  - `server/theme-contrast.test.ts` (ATC-408): `--faint` and `--muted` on every layer in every theme, and `--paper-muted` on a parked strip.
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
| **Palette** (proposed, decision S1) | Per theme, a neutral ramp of numbered steps with a job each (Radix-style: 1–2 app background, 3–5 component background rest / hover / pressed, 6–8 borders subtle / interactive / strong, 9–10 solid, 11–12 text low / high), plus the five signal hues | Used only by the semantic group, never by a primitive or a screen |
| **Semantic** | Surfaces (`--bg`, `--chrome`, `--panel`, `--panel-2`, `--panel-3`), text (`--text`, `--muted`, `--faint`), lines (`--line`, `--line-strong`), signals (`--radar`, `--amber`, `--cyan`, `--alert`, `--blue`), focus ring; scales for type, space, radius, z, motion, density | The only colour group primitives may use. Each theme sets this group, from the palette or directly |
| **Domain** | `--paper-*`, `--stamp-*`, `--fids-*`, `--flap-*`, `--phase-*`, `--series-*` | Point at semantic tokens where possible (`--phase-enroute: var(--radar)` already does). A theme overrides one only when the domain look differs (paper strips in Radar Console). Used by screens, not by primitives |
| **Contextual** (proposed, decision S2) | `--layer`, `--layer-hover`, set by a container for its children (Carbon) | Rows, cards and dialogs read `--layer`, so the same primitive works on any surface |

**Contrast pairs.** `server/theme-contrast.test.ts` grows into a declared table of (foreground token, background token, minimum), checked in every theme, as Primer does:
- text 4.5
- borders and focus 3
- tags and chips: their text on their fill

A new theme (the light theme, D7) cannot land unless the table passes.

### L1 Primitives

| Primitive | Form | Refactor unit |
|---|---|---|
| Button (`.btn`, `.is-primary`, `.is-danger`) | CSS class | U5 (ATC-411) |
| Chip, tag, dot (design-language 4.4) | CSS classes; a dot never stands without a word or a name | U6 (ATC-412) |
| Table and scroll region | CSS class; the scroll region as a small component (focusable, named) | U7 (ATC-413) |
| Fold | Component (`aria-expanded`, Enter / Space, the count in the header) | U8 (ATC-414) |
| Empty state | CSS class, or a one-line component | U8 |
| Segmented control | Component (radio semantics, arrow keys) | U8 |
| Dialog behaviour | Hook (focus in, Tab trap, focus return, Escape, scroll lock) | U2 (ATC-406) |
| Icon, IconButton | Component (`web/src/Icon.tsx`, already built) | — |

Rules:
- A primitive's CSS uses semantic and contextual tokens only: no domain token, no literal, no screen class.
- Its states are attributes: `[aria-pressed]`, `[aria-expanded]`, `[data-tone="alert"]`.
- Its own adjustable values are local custom properties, e.g. `--btn-h`.
- Where primitives live is decision S3.

### L2 Patterns

The patterns of design-language section 4: row and expanded detail, card (header, alert band, body grid, folded history), section (heading plus body), queue item, status row.

- A pattern is **a composition of primitives plus layout CSS**.
- It becomes shared code only when two or more screens draw it the same way. Likely candidates: the section heading (`h2.label` and its ten variants) and the card shell (header and alert band, from the FLEET reference card).
- Otherwise the pattern stays guidance in design-language, and each screen composes it from primitives. This is how Primer, Carbon and EUI treat patterns. Decision S4.

### L3 Screens

- HOME, RELEASE, FLIGHTS (list, board, radar, radio), FLEET, METRICS, the settings window and the drawers.
- Each screen has its own stylesheet next to its view and imports only that, plus the primitives and patterns it uses.
- Screens may use semantic and domain tokens. They define no colours or new scale values.
- `styles.css` keeps no screen sections: the screen units S1–S9 move them out.

## 4. Checks, one per boundary

| Boundary | Check | Status |
|---|---|---|
| No literal colour, size, z-index, radius or spacing outside L0 | `server/css-lint.ts` (colour, font size, z-index today; spacing, radius, `em` with U4) | partly built |
| A property takes only its token family (`color` → text and signal tokens, `background` → surface tokens, `border-color` → line and signal tokens), as Primer's `primer/colors` does | a new css-lint rule, ratcheted like the others | proposed, decision S5 |
| Primitives use no domain token and no screen class | css-lint, scoped to the primitive files | proposed |
| A screen imports no other screen's stylesheet; a primitive imports nothing from screens | `server/boundaries.test.ts`, which already parses imports, gains a layer map by path | proposed |
| Theme blocks hold custom properties only | css-lint: a `:root[data-theme=…]` rule with a selector after it fails | proposed (lands with S9) |
| Contrast pairs in every theme | `server/theme-contrast.test.ts` with a declared pairs table | partly built (ATC-408) |

Each new rule starts with a baseline of today's count and only goes down, as css-lint does now.

## 5. Themes

Today each theme is about 55 hand-set values. Two references make themes cheaper:
- **Linear** replaced 98 values per theme with three inputs (base, accent, contrast) in LCH.
- **Grafana** derives hover, text and border from one main colour with a contrast threshold.

Proposal (decision S1): a theme is a short list of inputs.
- **Inputs:** background, foreground, the five signal hues, and a contrast level.
- **Generator:** a pure function produces the palette ramp and the semantic tokens.
- **Committed output:** the result is written into the theme's block of plain CSS, so no build step runs at load.
- **Tests:**
  - the contrast table checks the output;
  - a second test checks that the committed CSS equals the generator's output, so hand edits and inputs cannot drift apart.

The light theme (D7) would then be one more input set. The three dark themes would be re-expressed as inputs first, with **no visible change** as the acceptance test. Then later colour fixes become input changes.

`color-mix()` and `oklch()` in plain CSS can do part of this at runtime (hover = the surface mixed toward the text colour). They are supported in current browsers. They are an option for hover and pressed states even without a generator.

## 6. How the refactor units change

The units of [ui-refactor-plan.md](ui-refactor-plan.md) already cover most of this. The layer model changes where some of them put their output, and adds four small units. Units already accepted by an AIRCRAFT (READBACK) are not edited: additions become follow-up issues, blockedBy the original (`docs/rules.ko.md`, "작업 지시서"). Backlog units not yet released can take the change before they are fired.

| Unit | Today | With the layer model |
|---|---|---|
| U2 ATC-406, U5 ATC-411, U6 ATC-412, U7 ATC-413, U8 ATC-414 | primitives added wherever fits | written into the primitives location (S3), using semantic tokens only |
| U4 ATC-410 | spacing, radius, `em` lint | unchanged; S5's property → token family rule is a new unit after it |
| U9 ATC-415 | colour literals to tokens | literals go into the semantic or domain group by the rules of L0 |
| S1–S8 ATC-422..432 | screen CSS out of `styles.css` | also: no borrowed stylesheets (the import check), patterns from L2 where shared |
| S9 ATC-433 | themes in their own files | theme files hold custom properties only (the theme-block check) |
| D7 ATC-434 | light theme by hand | the light theme as an input set, if S1 chooses the generator |
| D8 ATC-420 | 11 px floor | unchanged (a type-scale token change) |
| **new** | — | (a) the layer map in `boundaries.test.ts`; (b) the property → token family lint (S5); (c) the contrast pairs table; (d) the theme generator and its two tests (only if S1 chooses it) |

## 7. Decisions for the SUPERVISOR

| # | Question | Options | Recommended | Affects |
|---|---|---|---|---|
| S1 | How is a theme defined? | (a) as today: each theme sets about 55 semantic values by hand; (b) add a palette tier (a numbered neutral ramp with a job per step) and set semantic tokens from it by hand; (c) a theme is a few inputs, and a pure generator writes the palette and semantic tokens into committed CSS | (c), introduced with no visible change to the three dark themes first; it makes the light theme (D7) and later contrast fixes one-line changes | U9, S9, D7 |
| S2 | A contextual layer token (`--layer`, set by a container for its children)? | (a) yes; (b) no, primitives read the fixed surface tokens | (a): the same row, card or dialog then works on any layer, and the contrast table checks one pair per layer | U5–U8 |
| S3 | Where do primitives live? | (a) a folder `web/src/kit/` with one `.css` (and a `.tsx` where needed) per primitive, and today's `ui.tsx` renamed to say it holds domain badges; (b) one shared `primitives.css` plus `ui.tsx`; (c) leave them in `styles.css` and `ui.css` | (a): the import check and the primitive-scoped lint can then work by path | U2, U5–U8, the new import check |
| S4 | Patterns as code or as guidance? | (a) code only when two or more screens draw one the same way (the section heading and the card shell first); (b) code for every section 4 pattern; (c) guidance only | (a) | S1–S8 |
| S5 | Add the property → token family lint (as Primer does)? | (a) yes, ratcheted from today's count; (b) no, keep "no literals" only | (a): it is what keeps a screen from painting a background with a text colour, the kind of drift no literal check sees | new unit after U4 |
| S6 | Keep the current token names or rename by job? | (a) keep `--bg`, `--panel`, `--panel-2`, `--panel-3`, `--text`, `--muted`, `--faint` (they already read as layers and text levels); (b) rename to Radix-style job names | (a): the names already describe layers and levels, a rename touches every stylesheet, and S1's palette can carry the job names underneath | all |

## 8. Risks

| Risk | Mitigation |
|---|---|
| The layers become ceremony on a small app | Four layers, one check each; local custom properties before global tokens (principle 5); patterns as code only when shared (S4) |
| The generator makes colours worse than the hand-tuned themes | First step reproduces today's three themes with no visible change; the contrast table and a compare against today's values gate it |
| Merge conflicts with daily screen work | The units stay small and land one at a time, as in the refactor plan; the new checks start at today's count |
| The look stays generic | This draft is structure. The look comes from the screens and the SUPERVISOR's references ([ui-references.md](research/ui-references.md)); a token-only restyle was already cut |
