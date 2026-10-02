# Design-system layers: what public design systems and design engineers do

> Status: SURVEY, 2026-10-02, at the SUPERVISOR's request ("atc 레이어 설계 및 x, github 에서 레퍼런스 리서치"). Nothing here changes a screen. The design draft that uses it is [design-system.md](../design-system.md). New candidates are listed in [ui-references.md](ui-references.md) section 3 with no verdict.

Related: [design-language.md](../design-language.md) (rules; they win over any reference), [ui-refactor-plan.md](../ui-refactor-plan.md) (the work units this informs), [ui-references.md](ui-references.md) (the one living list of references and verdicts).

## 1. Question and short answer

**Question.** How do public design systems split tokens, primitives, patterns and screens? What does it take to keep the layers apart, and what can a plain-CSS console with three dark themes (a light one coming) copy cheaply?

**Short answer.**

1. **Two token tiers are enough for atc.**
   - The big systems use three tiers: palette → semantic → component (Primer, Carbon, EUI). Their component tier exists because many products share one set of components.
   - The lean systems use two (Radix, shadcn, Blueprint, Grafana, Tabler).
   - Nathan Curtis's advice matches the lean ones: keep a component's own values local, and promote one to a shared token only when three or more components use it.
2. **A theme overrides the semantic tier, never component CSS.** Every system that has themes does this: Primer per-theme overrides, Carbon per-theme values, Radix `[data-accent-color]` remaps, shadcn `.dark`.
3. **Name semantic tokens by job, not by shade or rank.** Radix gives each of its 12 steps a job, and Geist gives each of its 10 a job: app background, component rest / hover / pressed, border subtle / interactive / strong, solid fill, text low / high. Ranks like "primary/secondary background" break when a light theme inverts them.
4. **Surfaces are their own token family**, and depth comes from surface steps, not shadows. Examples: Carbon `layer-01..03` (plus a contextual `$layer`), Grafana canvas / primary / secondary / elevated, Geist "materials", Linear's surface elevations.
5. **Themes can be generated from a few inputs.**
   - Linear replaced 98 colours per theme with three inputs (base, accent, contrast) in LCH.
   - Grafana derives hover, text and border from one main colour with a contrast threshold.
   - Radix's palette tool takes an accent, a gray and a background.

   For atc's planned light theme this is the cheapest path.
6. **Layers are enforced by lint and tests, not by folders.**
   - Lint rules map a property to the token family it may use, or forbid literals: Primer `primer/colors`, Carbon `theme-use`, Atlassian `ensure-design-token-usage`, EUI `no_css_color`, Blueprint `no-color-literal`.
   - Contrast is either tested from a declared table of pairs (Primer `colorContrast.config.ts`) or guaranteed by how the scale is built (Radix: text steps reach APCA Lc 60 / 90 on step 2).
7. **A "pattern" is a combination of components plus guidance, not a code layer.** Examples: Primer UI patterns, Carbon patterns, EUI patterns, shadcn blocks.
8. **Primitives are CSS first.** State lives in `data-*` attributes and CSS variables; a React component is added only where behaviour is needed, as in Emil Kowalski's Sonner. Karri Saarinen describes Linear's system as "mostly colors, type, icons and components", with no design-system team.

## 2. Method and limits

- **GitHub and the docs sites.** Each target's repository was read through the GitHub contents API and raw files, plus its public docs site. Paths and token names below are the ones the fetches returned. Sentences from docs pages are paraphrased.
- **X.** Every x.com post and X's own embed endpoint returned HTTP 402 (login wall). **No post on X was read.** For the posts below, only the search-result title is known; each row says so. The ideas are taken from the long-form primary sources the authors wrote (blog posts, docs), which were read. No mirror sites were used.
- **Not opened:**
  - the primer/primitives recursive tree
  - the carbon stylelint-plugin GitHub page (the raw README was read instead)
  - shadcn's raw `theming.mdx` (the docs page was read)
  - the blueprintjs.com docs
  - two EUI docs pages
  - npm `@atlaskit/tokens` (the unpkg package file was read) and the Bitbucket mirror
  - Nathan Curtis's Medium post (a full repost was read)
- **Licences** are noted per row. EUI's default licence (SSPL-1.0 / Elastic-2.0) is not permissive: take ideas only, no code. Grafana is AGPL-3.0 at the root, but `packages/grafana-data` and `packages/grafana-ui` are Apache-2.0.
- **Judgement.** "What atc takes" is this survey's proposal, not a decision. Verdicts in [ui-references.md](ui-references.md) are the SUPERVISOR's.

## 3. GitHub: design systems

### 3.1 Token tiers and themes

| System | Tiers | How a theme is made | What atc takes | Licence |
|---|---|---|---|---|
| [primer/primitives](https://github.com/primer/primitives) (GitHub) | 3: `src/tokens/base` → `functional` → `component`. Names run prefix → namespace → pattern → variant → property → scale, e.g. `base-color-green-5` → `bgColor-inset` → `button-primary-bgColor-hover` ([token names](https://primer.style/product/primitives/token-names/)) | Written by hand. Each functional token has a default and per-theme overrides (`fgColor.default` → `neutral.13`, dark `neutral.12`, dark-dimmed `neutral.11`), built with Style Dictionary | The words `default` / `muted` / `emphasis` and the pattern name `control`, shared by button, input and chip | MIT |
| [radix-ui/colors](https://github.com/radix-ui/colors), [radix-ui/themes](https://github.com/radix-ui/themes) | 2: scales `--blue-1..12` (and alpha `--blue-a1..12`) → remapped `--accent-1..12` / `--gray-1..12`, plus a few functional ones (`--color-background`, `--color-panel-solid`, `--color-surface`) | Selector remaps (`[data-accent-color='blue'] { --accent-1: var(--blue-1) … }`); a [custom palette](https://www.radix-ui.com/colors/custom) generator from accent + gray + background | **The step jobs** ([understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)): 1–2 app background, 3/4/5 component background rest/hover/pressed, 6 non-interactive border, 7 interactive border, 8 strong border and focus, 9/10 solid and its hover, 11/12 low/high-contrast text. Alpha steps for borders and hover washes that work on any layer | MIT |
| [carbon-design-system/carbon](https://github.com/carbon-design-system/carbon) (IBM) | 3: palette → role tokens (`$background`, `$layer-01..03`, `$text-primary`, `$border-subtle-01`) → component tokens; DTCG sources in `packages/themes/src/dtcg` | One value per theme in a single entry (`white`, `g10`, `g90`, `g100`), generated with Style Dictionary; "zones" emit a theme's custom properties | **Contextual layer tokens:** a container redefines `--layer` for its children, so a row or card works on any layer. layer-02 sits on layer-01, layer-03 on layer-02 | Apache-2.0 |
| [Vercel Geist](https://vercel.com/geist/colors) (docs only; no public system repo) | Scales with steps 100–1000; `--ds-background-100/200` | Not public | **Slot jobs:** 100–300 component background default/hover/active, 400–600 border default/hover/active, 700–800 high-contrast fill, 900/1000 secondary/primary text. "Use the second background sparingly." **[Materials](https://vercel.com/geist/materials):** named surface presets (`material-base`, `-menu`, `-modal`, `-tooltip`) bundling radius, fill, stroke and shadow | no repo (fonts OFL-1.1) |
| [Atlassian tokens](https://atlassian.design/foundations/tokens/design-tokens) | foundation.property.modifier, e.g. `color.background.accent.teal.bolder.hovered` → CSS `--ds-background-neutral` | `<html data-theme="light:light dark:dark spacing:spacing …">`; a Babel plugin inlines `token()` calls | State modifiers in the name (`.hovered`, `.pressed`); **one `data-*` attribute per theme axis** (colour separate from spacing and type) | Apache-2.0 |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | 1 semantic tier in **pairs**: `--background` / `--foreground`, `--card` / `--card-foreground`, `--muted-foreground`, `--border`, `--ring`, `--radius` (oklch) ([theming](https://ui.shadcn.com/docs/theming)) | `:root` plus `.dark` overrides, written by hand | **The pair rule:** every surface token has a foreground partner, so contrast pairs are explicit | MIT |
| [palantir/blueprint](https://github.com/palantir/blueprint) | 2: palette `$blue3` → aliases `$pt-intent-primary`, `$pt-text-color-muted` (`packages/core/src/common/_color-aliases.scss`) | Parallel `$pt-dark-*` aliases | A "no colour literal outside the token file" rule | Apache-2.0 |
| [elastic/eui](https://github.com/elastic/eui) | 3: `_primitive_colors.ts` → `_semantic_colors.ts` (`shade140`, `primary70Alpha12`) → `_colors_dark.ts` roles (`backgroundBasePlain`, `textSubdued`, `borderBaseSubdued`) | Hand-written light and dark files, plus a high-contrast severity file | Role names grouped by purpose (`background*`, `text*`, `border*`) on top of a numbered ramp | SSPL / Elastic (ideas only) |
| [grafana/grafana](https://github.com/grafana/grafana) `packages/grafana-data/src/themes` | Roles: `text.primary/secondary/disabled`, `background.canvas/primary/secondary/elevated`, `border.weak/medium/strong`, `action.hover/selected/focus` | **Generated:** `createColors` derives shade, text, border and transparent from one `main` colour (`contrastThreshold = 3`, `hoverFactor = 0.03`, `tonalOffset` 0.15 dark / 0.2 light); a theme definition (`gloom.json`) is about 28 values | A theme as a small input, with a pure function deriving hover and selected | Apache-2.0 (these packages) |
| [nasa/openmct](https://github.com/nasa/openmct) | One SCSS constants file per theme (`_constants-espresso.scss`, `-snow`, …), names `$color[Component][State]` | Partly derived: `$colorBodyBgSubtle: pullForward($colorBodyBg, 5%)` | Status colours always set as a **bg/fg pair** through one helper; "subtle = base pulled forward n %" (CSS `color-mix()` does this natively) | Apache-2.0 |
| [tabler/tabler](https://github.com/tabler/tabler) | Bootstrap SCSS → CSS `--gray-50..950`, `--primary` | **Theme axes as separate attributes:** `[data-theme-base]`, `[data-theme-primary]`, `[data-theme-radius]`, `[data-theme-font]` (`core/scss/tabler-themes.scss`) | Independent axes, as atc already does with `data-theme` and `data-density` | MIT |

For comparison:
- The [W3C DTCG format](https://www.designtokens.org/tr/drafts/format/) prescribes **no tiers** ("groups are arbitrary"). Its [resolver](https://www.designtokens.org/tr/drafts/resolver/) models themes as sets, modifiers and a resolution order.
- [Style Dictionary](https://styledictionary.com/info/tokens/) calls its category/type/item naming "not required".
- Neither is needed without a build step.

### 3.2 Primitives and patterns

| System | Primitive (code) | Pattern |
|---|---|---|
| Primer | `packages/react/src/Button`, `Label`, `Dialog`, `SegmentedControl`, `Blankslate` | Guidance pages only ([UI patterns](https://primer.style/product/ui-patterns/): empty states, progressive disclosure, notifications) |
| Carbon | Components "ready to be imported" | "Reusable combinations of components" ([patterns](https://carbondesignsystem.com/patterns/overview/): disclosures, empty states, notifications, read-only states) |
| EUI | Components | [Patterns](https://eui.elastic.co/docs/patterns/): error messages, save buttons, health and severity, tables |
| shadcn | `registry/.../ui` | `registry/.../blocks` (compositions) |
| Radix Themes | Layout components (Box, Flex, Grid, Section) kept apart from content components | none |
| Grafana | One flat `grafana-ui/src/components/` (Button, EmptyState, Collapse, InteractiveTable) | none |
| Open MCT | `src/ui/components/` must "not depend on styling from parent elements" ([COMPONENTS.md](https://github.com/nasa/openmct/blob/master/src/ui/components/COMPONENTS.md)) | none |

### 3.3 How layers are enforced

| System | Rule | What it checks |
|---|---|---|
| Primer | [`@primer/stylelint-config`](https://github.com/primer/stylelint-config) `primer/colors`, `primer/spacing`, `primer/borders`, … | **Property → token family:** `color` only `fgColor*`/`iconColor*`, `background` only `bgColor*`, `border-color` only `borderColor*` |
| Primer | `scripts/colorContrast.config.ts` | **A declared table** of (fg token, bg token, minimum) checked in every theme: 4.5 for text, 3 for borders, 7 / 4.5 in high-contrast themes |
| Carbon | [stylelint-plugin-carbon-tokens](https://github.com/carbon-design-system/stylelint-plugin-carbon-tokens) `carbon/theme-use`, `theme-layer-use`, `layout-use`, `motion-duration-use` | Tokens for colour, layout, type and motion; prefer the contextual `$layer` |
| Atlassian | [`@atlaskit/eslint-plugin-design-system`](https://atlassian.design/components/eslint-plugin-design-system/usage) `ensure-design-token-usage`, `use-tokens-space`, `use-tokens-shape` | Tokens for colour, space, shape and motion |
| EUI | `packages/eslint-plugin/src/rules/no_css_color.ts`, `no_static_z_index.ts` | No colour literal, no literal z-index |
| Blueprint | `@blueprintjs/no-color-literal`, `prefer-spacing-variable` | Same idea, with autofix |
| Grafana | `grafana-eslint-rules` `no-border-radius-literal`, `no-unreduced-motion` | Radius and reduced motion |

Nobody found here enforces layers with folder rules alone.

## 4. X: design engineers

No post could be opened (section 2). The table gives each post's search-result title only, and the primary source that was read.

| Author | Post (search title only) | Primary source read | Idea | What atc takes |
|---|---|---|---|---|
| Linear | [x.com/linear/status/1773435685275328542](https://x.com/linear/status/1773435685275328542) | [How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui), 2024-03-28 | 98 colours per theme replaced by three inputs (base, accent, contrast) in LCH, because equal LCH lightness looks equally light. The contrast input gives high-contrast themes "automatically" | Each theme as a short list of inputs; the light theme as one more set of inputs |
| Linear | [x.com/linear/status/2032145903578923156](https://x.com/linear/status/2032145903578923156) ("reduce noise and bring structure back into focus") | [A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh), 2026-03-12 | Navigation made "a few notches dimmer" so the work area leads; smaller tabs and icons; softer, lower-contrast borders | Chrome on a quieter text tier than content; hairline borders |
| Karri Saarinen | [1563626144724709378](https://x.com/karrisaarinen/status/1563626144724709378), [1715407158928724209](https://x.com/karrisaarinen/status/1715407158928724209) (the system is "mostly colors, type, icons and components"; nobody makes a new button because one is 1 px off) | the Linear posts above | Keep the system small; discipline over taxonomy | No large token taxonomy |
| Radix | [x.com/radix_ui/status/1771868155532468570](https://x.com/radix_ui/status/1771868155532468570) (custom palettes reach APCA ratios similar to the stock scales) | [Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), [Radix Themes 3.0](https://www.radix-ui.com/blog/themes-3) | Steps by job; a generator from accent, gray and background | Semantic tokens named by job |
| Colm Tuite | [x.com/colmtuite/status/1397258083773161477](https://x.com/colmtuite/status/1397258083773161477) (each scale has a near-matching transparent version) | Radix docs | Alpha steps look right on any layer | Alpha tokens for borders and hover |
| Nathan Curtis | [x.com/nathanacurtis/status/987411286924414976](https://x.com/nathanacurtis/status/987411286924414976) (tokens used inside one component are "just variables") | "Naming Tokens in Design Systems" (EightShapes, 2020; read as a [full repost](https://blog.bakarema.com/2022/10/05/naming-tokens-in-design-systems-terms-types-and-taxonomy-to-describe-by-nathan-curtis-eightshapes/)) | Names from levels (category, concept, property, variant, state, scale, mode). "Don't globalize decisions prematurely"; promote at 3+ uses | Component-local custom properties on the class; promote to `:root` at 3+ uses |
| Brad Frost | no post found | [The Many Faces of Themeable Design Systems](https://bradfrost.com/blog/post/the-many-faces-of-themeable-design-systems/), 2022 | Tier 1 raw, tier 2 theme (semantic), tier 3 component; argued for multi-brand systems | Tier 3 is for many brands sharing components; atc has one product |
| Sarah Federman | [1164166321069645825](https://x.com/sarah_federman/status/1164166321069645825) (global and component tokens are "hugely different problems") | none | Two separate layers | `:root` tokens vs per-class properties |
| Ridd | [x.com/ridd_design/status/1693400719804547377](https://x.com/ridd_design/status/1693400719804547377) (naming two backgrounds that swap prominence between light and dark) | none | Rank names break when a theme inverts | Surfaces named by layer |
| Steve Schoger | [1695139153753604384](https://x.com/steveschoger/status/1695139153753604384), [1453826826854412300](https://x.com/steveschoger/status/1453826826854412300) (borders with opacity; a light design that does not lean on shadows converts to dark more easily) | none | Translucent borders; depth from surfaces | Alpha `--line`; surface steps rather than shadows |
| Emil Kowalski | no post found | [Building a toast component](https://emilkowal.ski/ui/building-a-toast-component); [emil-design-eng skill](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md) | State in `data-*` attributes and CSS variables; interruptible CSS transitions; "never animate keyboard-initiated actions" | Primitives as CSS classes with `data-*` state; React only for behaviour |
| Rauno Freiberg | no post found | [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design), 2023 | An animation used hundreds of times a day becomes a burden | No motion on filtering, row selection or keyboard navigation |

Also searched with nothing on-topic found: Jhey Tompkins, Paco Coursey, Pedro Duarte. The posts by Jina Anne, Adam Wathan and Romain Cascino turned up only as titles, without a primary source, and are left out.

## 5. Patterns that recur

1. Two tiers in lean systems, three in big ones; component tokens point at semantic tokens, never at the palette.
2. Themes override the semantic tier only.
3. Neutral ramps with a documented job per step (Radix 1–12, Geist 100–1000, EUI shades); text steps carry the contrast guarantee.
4. Surfaces are a token family of their own, and depth is surface steps.
5. Themes generated from a few inputs (Linear, Grafana, Radix, shadcn).
6. Enforcement is lint: property → allowed token family, and no literals.
7. Contrast as a declared table of pairs, tested per theme.
8. Patterns are guidance plus composition, not a code layer; primitives are CSS first, with React only where behaviour lives.

## 6. What does not fit atc

- **A build step for tokens** (Style Dictionary, DTCG JSON → CSS, Babel `token()` inlining, SCSS per-theme bundles). atc's tokens are plain custom properties in `web/src/styles.css`, and a test can read them directly, as `server/theme-contrast.test.ts` already does.
- **Tailwind or CSS-in-JS** (shadcn's `@theme inline`, Grafana and EUI's Emotion theme objects).
- **A third token tier for every component.** atc has one product and a few primitives.
- **Copying a look.** A token-only restyle was cut as "AI slop" ([ui-references.md](ui-references.md) section 2). These references are about structure.
- **Code from EUI** (licence).
