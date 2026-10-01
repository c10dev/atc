<!--
Adapted from jakubkrehel/make-interfaces-feel-better (https://github.com/jakubkrehel/make-interfaces-feel-better),
skills/make-interfaces-feel-better/{SKILL.md, surfaces.md, typography.md, icons.md} at commit
35545ea1512ad59fa463e6b1f95ca9c052981fe6. Licence: MIT, Copyright (c) 2026 Jakub Krehel (full text in THIRD_PARTY_NOTICES.md).
MODIFIED for atc: reordered and shortened; Tailwind examples and the motion-first content left out (upstream animations.md,
performance.md, enter/exit, stagger, scale on press, icon animation: atc says static beats moving, docs/design-language.md
principle 10 and 3.5.8); the review output section rewritten for atc (severity names, proof gate, scope table);
a CONFLICT line added where atc's design language decided otherwise. Precedence: root CLAUDE.md > docs/design-language.md >
this file. A line marked CONFLICT is NOT APPLIED until the SUPERVISOR decides.
-->

# Interface details (vendored, adapted)

Express every correction in atc's own system: plain CSS with the `:root` tokens of `web/src/styles.css`, never Tailwind and never a new styling approach.

## Principles that fit atc

### 1. Concentric Border Radius

Outer radius = inner radius + padding. Mismatched radii on nested elements is the most common thing that makes interfaces feel off.

### 2. Optical Over Geometric Alignment

When geometric centering looks off, align optically. Buttons with icons, play triangles, and asymmetric icons all need manual adjustment.

### 3. Shadows for Elevation, Borders for Structure

For buttons, cards, and containers whose border exists only to create depth, prefer layered transparent `box-shadow` values. Keep borders that communicate structure or state: dividers, layout separators, and selected or focus states.

**CONFLICT — design-language 3.5.4 border budget (a card has one outer border *or* one surface step, not both plus inner rules). Not applied until decided; the shadow values are in the Surfaces section below.**

### 9. Tabular Numbers

Use `font-variant-numeric: tabular-nums` for any dynamically updating numbers to prevent layout shift.

### 10. Text Wrapping

Use `text-wrap: balance` on headings. Use `text-wrap: pretty` for body text to avoid orphans.

### 11. Image Outlines

Add a subtle `1px` outline with low opacity to images for consistent depth. The color must be pure black in light mode (`oklch(0 0 0 / 0.1)`) and pure white in dark mode (`oklch(1 0 0 / 0.1)`), never a near-black like slate, zinc, or any tinted neutral. A tinted outline picks up the surface color underneath it and reads as dirt on the image edge.

### 16. Minimum Hit Area

Interactive elements should prefer a 44×44px hit area for touch or mobile contexts. In dense desktop interfaces, use at least 40×40px. Extend with a pseudo-element if the visible element is smaller. Never let hit areas of two elements overlap.

**Note — web-interface-guidelines asks for ≥24px (≥44px on mobile); this file says ≥40px in dense desktop UI. Both are listed; atc has not decided a number. Report a target below 24px as a finding and one between 24 and 40px as a Note.**

### 17. Match Icon Stroke to Text Weight

An icon next to text carries the text's optical weight: `1.5px` stroke beside regular (400) text, `2px` beside semibold (600). One stroke weight per icon set; never mix libraries on one surface.

**CONFLICT — design-language 3.5.6 decided one stroke (Lucide, 1.5 px at 14 and 16 px). The "2px beside semibold" part is not applied; "one weight per set" is.**

### 18. One SVG, Recolored per State

Icons use `currentColor` and get their states (hover, selected, disabled) from CSS color and opacity, never from separate assets. Outline variant is the default; fill variant marks the active state.

### 19. Motion Restraint

No custom animation on high-frequency interactions: the attention cost repeats on every trigger. Motion is never the only feedback channel; every animated state change also needs a static cue such as color, icon, or label.


---

# Surfaces

## Concentric Border Radius

When nesting rounded elements, the outer radius must equal the inner radius plus the padding between them:

```
outerRadius = innerRadius + padding
```

This rule is most useful when nested surfaces are close together. If padding is larger than `24px`, treat the layers as separate surfaces and choose each radius independently instead of forcing strict concentric math.

### Example

```css
/* Good — concentric radii */
.card {
  border-radius: 20px; /* 12 + 8 */
  padding: 8px;
}
.card-inner {
  border-radius: 12px;
}

/* Bad — same radius on both */
.card {
  border-radius: 12px;
  padding: 8px;
}
.card-inner {
  border-radius: 12px;
}
```

## Optical Alignment

When geometric centering looks off, align optically instead.

### Buttons with Text + Icon

Use slightly less padding on the icon side to make the button feel balanced. A reliable rule of thumb is:
`icon-side padding = text-side padding - 2px`.

```css
/* Good — less padding on icon side */
.button-with-icon {
  padding-left: 16px;
  padding-right: 14px; /* icon side = text side - 2px */
}

/* Bad — equal padding looks like icon is pushed too far right */
.button-with-icon {
  padding: 0 16px;
}
```

```tsx
// Tailwind
<button className="pl-4 pr-3.5 flex items-center gap-2">
  <span>Continue</span>
  <ArrowRightIcon />
</button>
```

### Play Button Triangles

Play icons are triangular and their geometric center is not their visual center. Shift slightly right:

```css
/* Good — optically centered */
.play-button svg {
  margin-left: 2px; /* shift right to account for triangle shape */
}

/* Bad — geometrically centered but looks off */
.play-button svg {
  /* no adjustment */
}
```

### Asymmetric Icons (Stars, Arrows, Carets)

Some icons have uneven visual weight. The best fix is adjusting the SVG directly so no extra margin/padding is needed in the component code.

```tsx
// Best — fix in the SVG itself
// Adjust the viewBox or path to visually center the icon

// Fallback — adjust with margin
<span className="ml-px">
  <StarIcon />
</span>
```

## Shadows Instead of Borders (CONFLICT with design-language 3.5.4, not applied)

For **buttons, cards, and containers** that use a border for depth or elevation, prefer replacing it with a subtle `box-shadow`. Shadows adapt to any background since they use transparency; solid borders don't. This also helps when using images or multiple colors as backgrounds — solid border colors don't work well on backgrounds other than the ones they were designed for.

**Do not apply this to dividers** (`border-b`, `border-t`, side borders) or any border whose purpose is layout separation rather than element depth. Those should stay as borders.

### Shadow as Border (Light Mode)

The shadow is comprised of three layers. The first acts as a 1px border ring, the second adds subtle lift, and the third provides ambient depth:

```css
:root {
  --shadow-border:
    0px 0px 0px 1px oklch(0 0 0 / 0.06),
    0px 1px 2px -1px oklch(0 0 0 / 0.06),
    0px 2px 4px 0px oklch(0 0 0 / 0.04);
  --shadow-border-hover:
    0px 0px 0px 1px oklch(0 0 0 / 0.08),
    0px 1px 2px -1px oklch(0 0 0 / 0.08),
    0px 2px 4px 0px oklch(0 0 0 / 0.06);
}
```

### Shadow as Border (Dark Mode)

In dark mode, simplify to a single white ring — layered depth shadows aren't visible on dark backgrounds:

```css
/* Dark mode — adapt to whatever setup the project uses
   (prefers-color-scheme, class, data attribute, etc.) */
--shadow-border: 0 0 0 1px oklch(1 0 0 / 0.08);
--shadow-border-hover: 0 0 0 1px oklch(1 0 0 / 0.13);
```

### Usage with Hover Transition

Apply the variable and add `transition-[box-shadow]` for a smooth hover:

```css
.card {
  box-shadow: var(--shadow-border);
  transition-property: box-shadow;
  transition-duration: 150ms;
  transition-timing-function: ease-out;
}

.card:hover {
  box-shadow: var(--shadow-border-hover);
}
```

### When to Use Shadows vs. Borders

| Use shadows | Use borders |
| --- | --- |
| Cards, containers with depth | Dividers between list items |
| Buttons with bordered styles | Table cell boundaries |
| Elevated elements (dropdowns, modals) | Form input outlines (for accessibility) |
| Elements on varied backgrounds | Hairline separators in dense UI |
| Hover/focus states for lift effect | |


---

# Typography

## Text Wrapping

### text-wrap: balance

Distributes text evenly across lines, preventing orphaned words on headings and short text blocks. **Only works on blocks of 6 lines or fewer** (Chromium) or 10 lines or fewer (Firefox) — the balancing algorithm is computationally expensive, so browsers limit it to short text.

```css
/* Good — even line lengths on short text */
h1, h2, h3 {
  text-wrap: balance;
}
```

```css
/* Bad — default wrapping leaves orphans */
h1 {
  /* no text-wrap rule → "Read our
     blog" instead of balanced lines */
}
```

```css
/* Bad — balance on long paragraphs (silently ignored, wastes intent) */
.article-body p {
  text-wrap: balance;
}
```

**Tailwind:** `text-balance`

### text-wrap: pretty

Prevents orphaned words (a single word dangling on the last line) by adjusting line breaks throughout the paragraph. Unlike `balance`, it doesn't try to equalize line lengths — it just ensures the last line isn't embarrassingly short. Works on text of any length with no line-count limit.

This should be your **default for short-to-medium text** — paragraphs, descriptions, captions, list items, card text. For very long text (10+ lines), skip both `pretty` and `balance` — the browser's default wrapping is fine and you avoid unnecessary layout cost.

```css
/* Good — descriptions, captions, short paragraphs */
p, li, figcaption, blockquote {
  text-wrap: pretty;
}
```

```tsx
// Tailwind
<p className="text-pretty">
  A short paragraph that won't leave an orphan on the last line.
</p>
```

**Tailwind:** `text-pretty`


## Tabular Numbers

When numbers update dynamically (counters, prices, timers, table columns), use tabular-nums to make all digits equal width. This prevents layout shift as values change.

```css
/* CSS */
.counter {
  font-variant-numeric: tabular-nums;
}
```

```tsx
// Tailwind
<span className="tabular-nums">{count}</span>
```

### When to Use

| Use tabular-nums | Don't use tabular-nums |
| --- | --- |
| Counters and timers | Static display numbers |
| Prices that update | Decorative large numbers |
| Table columns with numbers | Phone numbers, zip codes |
| Animated number transitions | Version numbers (v2.1.0) |
| Scoreboards, dashboards | |


---

# Icons

## Match Icon Stroke to Text Weight

An icon next to text should carry the same optical weight as the text.

| Adjacent text | Icon stroke width (24px grid) |
| --- | --- |
| Regular (400), 14–16px | `1.5px` |
| Medium/Semibold (500–600) | `2px` |
| Bold (700), or emphasized standalone | `2.5px` |

Use one stroke weight per icon set on a surface. Size inline icons relative to the text's cap height, typically `1em`–`1.25em`.

## One SVG, Recolored per State

Use one SVG drawn with `currentColor`; let CSS drive hover, selected, and disabled states. Strip hardcoded `fill` and `stroke` colors when importing icons.

```html
<svg fill="none" stroke="currentColor" stroke-width="2">…</svg>
```

```css
.icon-button { color: oklch(0.552 0.016 285.938); }
.icon-button:hover { color: oklch(0.21 0.006 285.885); }
.icon-button[aria-pressed="true"] { color: oklch(0.623 0.188 259.815); }
.icon-button:disabled { opacity: 0.4; }
```

## Outline Default, Fill Active

| Variant | Use for |
| --- | --- |
| Outline | Default state: toolbars, list rows, inline with text |
| Fill | Selected or active state: active tab, toggled bookmark, liked heart |

The swap between variants is a contextual icon animation; use the exact cross-fade values in [animations.md](animations.md).

## Design at Render Size

- Test every icon at the smallest size it will render, often `16px`.
- Prefer simplified glyphs for small contexts over scaled-down detailed artwork.
- Use the icon set's native grid sizes (`16`, `20`, `24`) rather than arbitrary fractional scales.
- Use SVG rather than raster assets.


atc's icon set and stroke are decided: Lucide, 14 and 16 px, 1.5 px stroke (design-language 3.5.6). The weight table above is not applied (see principle 17); atc's decision wins.

---

# Review output

This section replaces the upstream review format with the one atc's `ui-review` skill uses (see the skill's SKILL.md for the template). The ideas kept from upstream: a **scope and coverage table** that shows what was inspected, findings in a table with *Before* and *After*, **Considered but rejected**, a **Verification** list that names a check that was not run as *Not verified*, and a **Verdict** of Block, Needs changes or Approve. Severity is atc's: Blocker, Should-fix, Note.
