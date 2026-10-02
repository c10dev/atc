# Design language: how atc and ANNUNCIATOR look and behave

> Status (2026-10-01): **adopted.** The SUPERVISOR decided DL1–DL9 as recommended (section 9) on 2026-10-01. Written in an ENGINEERING session at the SUPERVISOR's request ("is there a document on the design and UI philosophy?"). The answer was no: the rules sit in the "Principles" sections of several design drafts and in comments in `web/src/styles.css`. This draft collects them into one place for the atc web screen (AIRPORT ATCC) and the ANNUNCIATOR menu bar app (AIRPORT ATCA, [chaehy5665/atc-app](https://github.com/chaehy5665/atc-app)). It adds the parts that were missing: how much a screen may show, when to fold and when to delete, and how the two clients stay alike. The document itself builds nothing; section 6 lists the steps that apply it. The SUPERVISOR also approved a FLEET card mockup that applies sections 2 and 3.5, and chose to build it that way (ATC-280).

Related: [ui-visibility.md](ui-visibility.md) (visibility review, draft), [alerting.md](alerting.md) (MASTER, ALERTS, QUEUE, LOG), [research/aviation-signals.md](research/aviation-signals.md) (alerting philosophy, sounds), [mac-app.md](mac-app.md) and atc-app `docs/design.md` (the app), [guide/screens.md](guide/screens.md) (what each tab shows today).

## 1. Current facts

### Where the rules live today

| Place | What it says | State |
|---|---|---|
| [ui-visibility.md](ui-visibility.md) section 2 | Quiet when normal; one place for what needs me; never hide, only fold; decide where the context is; same words everywhere; static beats moving | Draft. Section 2 adopted through this document (DL6, 2026-10-01); other parts moved into alerting.md and duty.md |
| [alerting.md](alerting.md) section 2 | One question per place; every item in one place; ACK means one thing; two numbers; the cockpit model; server decides, clients show | Draft |
| `web/src/styles.css` `:root` comments | Four surface layers; the faintest text keeps 4.5:1 on every layer; one signal colour, one meaning; themes change values only | Code comments |
| [research/aviation-signals.md](research/aviation-signals.md) section 5 | FAA AC 25.1322-1: few distinct tones, ACK silences, nuisance alerts destroy trust, remove the alert when the condition clears | Research |
| atc-app `docs/design.md` section 3 | The server decides, the app shows; read only; pure core; no screenshots | App architecture, not visual rules |
| root `CLAUDE.md` | Colours and fonts from `:root` tokens only; aviation terms in English; SUPERVISOR text in Korean | Working rules |

### What is built and follows a rule

- **Tokens and themes.** `web/src/styles.css` `:root` defines surfaces (`--bg` < `--chrome` < `--panel` < `--panel-2` < `--panel-3`), text (`--text`, `--muted`, `--faint`), signals (`--radar`, `--amber`, `--cyan`, `--alert`, `--blue`), a type scale (`--text-2xs` 10 px to `--text-2xl` 24 px), a 4 px spacing scale, radii and two font stacks (`--mono` JetBrains Mono, `--sans` Pretendard). Three themes (Radar Console, Glass Cockpit, Night Sky) change only values. Settings add `density` (comfortable, compact), `motion` (on by default; the OS's reduced-motion request always wins, live, ATC-409) and `clock` (UTC, local).
- **Alert levels** (ATC-110): WARNING red, CAUTION amber, ADVISORY grey; only WARNING and CAUTION count. ANNUNCIATOR shows the same levels with a letter (`W`, `C`, `A`), so a row does not depend on colour alone, and keeps NEEDS YOU in its own accent colour so it is never read as a CAUTION.
- **Dark cockpit** (ATC-111): RADAR and STRIPS fold finished STANDs into `GATE CLEANUP` by default. FIDS caps ARRIVED (ATC-112).
- **Decisions first** (ATC-113): DISPATCH and SCHEDULE put "what I must do now" on top and fold READINESS into one line at the bottom.
- **Fold rules in the app** (ATC-168): WARNING never folds, CAUTION shows its first rows, ADVISORY folds behind a counted header.
- **Labels** use an English code plus a Korean gloss (`.label` with `<em>`). Korean text gets no letter spacing.

### What goes wrong without a shared rule

- **Long flat screens.** The 2026-09-29 review measured DISPATCH at 6.9 screens and 2,572 words (ui-visibility section 1). On 2026-10-01 the FLEET AIRCRAFT card was a single column of about 20 blocks of equal weight, capped at 720 px, with the right half of the screen empty ([ATC-280](https://linear.app/vocado/issue/ATC-280)).
- **Detail repeats its parent.** The FLEET card repeats FLYING, the activity line and FOB from the row it opens under.
- **Constant text takes lines.** `CAPTAIN 팀 리더 세션` on every card. "세션 메타데이터만 읽음 — 대화 내용은 읽지 않는다" under every OBSERVED CREW. `지정 없음` for every empty field.
- **Tooltips carry a lot.** The web code has about 280 `title` attributes (205 computed, 77 fixed). The FLEET card alone has 22. Some carry the only explanation of a number. Touch screens and keyboards do not get them.
- **Additions without a slot.** The ANNUNCIATOR popover gained a DUTY row, a GitHub line, a RADIO hint and a FORWARD line in one day (ATC-234, ATC-247, ATC-173, ATC-204). Each was a new full row in the fixed strip, while [ATC-222](https://linear.app/vocado/issue/ATC-222) is trying to make the popover calmer.
- **Twelve tabs**, ordered by data source rather than by task (RADAR, GLOBE, STRIPS, FIDS, AIRPORTS, FLEET, METRICS, NETWORK, DISPATCH, SCHEDULE, RADIO, DOCS).
- **Fold or delete?** "Never hide, only fold" (ui-visibility) and "remove what is not needed" (the SUPERVISOR on ATC-280) pull in different directions, and nothing says which wins.

## 2. Principles

Each principle has a check that a reviewer can apply to a PR.

1. **Quiet when normal (dark cockpit).** A normal state uses few words, neutral colour and no motion. Colour, counts, badges and motion are for things the SUPERVISOR can act on or should notice. *Check:* with everything normal, nothing on the screen is red, amber or moving, and no line says only that things are fine, unless the whole screen would otherwise be empty (then one line, `✓ all normal`).
2. **One scale of urgency, never colour alone.** WARNING > CAUTION > ADVISORY, plus NEEDS YOU (a person must answer) and CALL (a new request), which are separate and never borrow the CAUTION colour. Each level also differs by shape, letter, position or weight. *Check:* in greyscale, every level can still be told apart.
3. **One colour, one meaning.** The signal tokens keep their meanings across tabs and clients (section 3.2). A new meaning gets no existing signal colour; it uses neutral text or a new token added with a reason. *Check:* every new use of a signal token matches its row in the 3.2 table.
4. **The server decides, the clients show.** Levels, counts, texts, "what is pending" and what goes where are computed once on the server. The browser, ANNUNCIATOR and SwiftBar draw them. *Check:* the PR adds no rule in the client that decides a level, a count or a destination.
5. **Decisions first.** A screen is ordered by what the SUPERVISOR must do: exceptions and decisions on top, current state next, history and statistics last and folded. *Check:* the first thing to act on is in the first screen height at 1280 × 800.
6. **Every item lives in one place, and a detail does not repeat its parent.** An expanded detail shows what the row does not. A screen does not show the same value twice. *Check:* no value in an expanded detail is visible in the row above it.
7. **Delete, fold or show.** Each line belongs to exactly one of these three, by these rules (this settles the fold-or-delete question):
   - **Delete** text that does not change between items or over time (`CAPTAIN 팀 리더 세션`, "대화 내용은 읽지 않는다"), placeholders for an empty optional field (`지정 없음`, `없음`), and normal-state confirmations (`RULES current`). Such text moves to the guide, or to one tooltip on a heading if it explains how a value is made.
   - **Fold** information that is true and specific to the item but rarely needed: counts behind a total, history, statistics, breakdowns. A fold always shows a count or a one-line summary, and opens in one click or key.
   - **Show** anything abnormal, anything to act on, and the one or two numbers that answer the question of that place.
   - An empty optional field is **hidden** on a read screen and **shown** in its editor.
   - *Check:* no line on a read screen is the same for every item, and no fold is empty.
8. **Use the width; collapse, never scroll sideways.** Layouts fill the space they get. Wide spaces use columns (a grid with `auto-fit` and a minimum column width). Narrow spaces collapse to one column. *Check:* no horizontal page scroll at 390 px, and no empty half at 1280 px.
9. **Same words everywhere.** Aviation terms in English (AIRCRAFT, FLIGHT, STAND, READBACK, MASTER WARNING, LAMP …). The SUPERVISOR's explanatory text is in Korean. Labels are an English code with a Korean gloss. Times are UTC with `Z` unless the clock setting is local. Ages are one unit (`4m`, `3h`, `2d`). *Check:* a new term exists in [naming.md](naming.md) or is added there.
10. **Static beats moving.** Status is chips, dots and counts. Motion is allowed only for liveness (a busy dot, the RADAR sweep, FIDS flaps) and for a new WARNING. Every motion stops with `data-motion="off"` and `prefers-reduced-motion`. *Check:* the screen is fully readable with motion off.
11. **Tooltips explain, they never carry the only copy.** A tooltip may hold how a number was made, the full text of a cut line, or the IDs behind a count. It may not hold the only statement that something is wrong, the only way to act, or the only copy of a value the SUPERVISOR needs to decide. *Check:* with tooltips removed, every decision can still be made from the screen.
12. **Rare and destructive actions go one step back.** The actions used every day are buttons. Rare actions (AOG) and destructive ones (퇴역, STOP ALL) sit in a `⋯` menu or behind a confirmation that says what will happen. *Check:* a card has at most five visible buttons.
13. **Tokens only.** Colours, fonts, sizes, radii and spacing come from `:root` tokens (web) or system styles (app). Themes change values, never structure. *Check:* no literal colour or pixel font size in a component's CSS.
14. **Reachable by keyboard and screen reader.** Every row, fold and menu works with Tab, Enter, Space and Escape. Focus returns to the opener when a panel closes. Every icon-only control has an accessible name. *Check:* the PR's Playwright pass includes a keyboard path.

## 3. Visual language

### 3.1 Surfaces and text

| Layer | Token | Used for |
|---|---|---|
| 0 | `--bg`, `--scope` | Page background, RADAR scope |
| 1 | `--chrome`, `--panel` | Header, panels |
| 2 | `--panel-2` | Cards, expanded details |
| 3 | `--panel-3` | Hover, popovers, menus |

Each layer is one step brighter and has a stronger border (`--line`, `--line-strong`). Text has three levels: `--text` (values, names), `--muted` (secondary values), `--faint` (labels, ages, captions). The faintest text keeps 4.5:1 on every layer in every theme.

### 3.2 Signal colours

| Token | Meaning | Not for |
|---|---|---|
| `--alert` | WARNING, LOSS OF SEPARATION, NORDO, failure, destructive action | Emphasis, a number that is only high, a kind or rating (the `SEC` TYPE RATING chip is neutral) |
| `--amber` | CAUTION, HOLDING, CLEARED TO LAND, below target, needs attention soon | Information, selection |
| `--radar` | AIRBORNE, ENROUTE, live and healthy, primary action | Decoration, "done" (done is neutral) |
| `--cyan` | APPROACH, information, links, a state the SUPERVISOR set on purpose | Warnings |
| `--blue` | HANDOFF | Anything else |
| `--faint` | ADVISORY, finished, parked | — |
| accent (app) | NEEDS YOU | CAUTION |

Charts use the series tokens (`--series-captain`, `--series-crew`), not the signal tokens.

### 3.3 Type, space and shape

- **Type.** `--mono` for codes, IDs, numbers, times and aviation terms. `--sans` for Korean sentences and explanations. Sizes from `--text-2xs` (uppercase codes, captions) to `--text-2xl` (headline numbers). Body is `--text-md` (14 px; 13 px in the compact density). Numbers that change or are compared in columns use tabular figures (the `.tn` utility and the list next to it in `styles.css`, see L5a as built).
- **Space.** The 4 px scale (`--space-*`). Inside a block `--gap-item` (8 px), between columns `--gap-column` (16 px), between sections `--gap-section` (32 px).
- **Shape.** Radius 2 px for chips and tags, 4 px for controls, 8 px for panels and cards, pill for toggles and counts. A level or state shape (dot, triangle, dashed border) is never only a colour change.

### 3.4 ANNUNCIATOR

The app follows macOS: system fonts (monospaced for codes and numbers), template images in the menu bar so the title follows light and dark, system materials for the popover, and the system accent for NEEDS YOU. It maps atc's levels to the same order and the same letters, and draws the same counts with the same rule (`warning + caution`, then `+advisory`), which come from the server's summary.

### 3.5 Craft

Sections 2 to 3.4 decide *what* a screen shows. This section decides how calm and clean it looks. Compared with calm, well-made apps (Linear, Vercel's Geist, Apple's own apps, Stripe's dashboard), atc's behaviour rules are at the same level, but its screens use more colour, more borders, more monospace and less size contrast. These rules close that gap without changing atc's identity (the console look, the aviation words, the three themes).

1. **Colour budget.** Grey is the default. Signal colour marks state, never decoration or grouping.
   - At most **two** signal colours in one card or row in a normal state, and **none** when everything is normal (principle 1). "Healthy" and "live" are a small dot or a word in `--radar`, never a border, a background or a whole line of green text.
   - The colour belongs to the smallest element that carries the state: the dot, the tag or the number, not the whole row or card. A coloured left bar on a card is allowed only for WARNING, CAUTION and AOG.
   - *Check:* in the normal state, the coloured pixels in a card are a dot or a word, not a block.
2. **Font roles.** `--mono` for things a person might copy or compare character by character: IDs, codes, keys, numbers, times, model names, commands. `--sans` for names, sentences and labels a person reads. Uppercase letter-spaced codes (`.label`, `.fl-sub`) only for section headings, at most one level of them per card.
   - *Check:* no Korean sentence and no list of names is set in mono; no card has more than one level of uppercase headings.
3. **Three sizes per block.** Each card or panel uses at most three text sizes: the **title** (`--text-lg`, 600), the **value** (`--text-md`), and the **caption** (`--text-xs`, `--faint`). Weight adds contrast inside the same size (600 for names and values that matter, 400 otherwise).
   - *Decided (DL7):* raise body text from 13 px to 14 px and captions from 11 px to 12 px in the default density. `compact` keeps today's sizes.
   - *Check:* a card uses three sizes or fewer.
4. **Border budget.** Group by space and by surface step (section 3.1), not by lines. A card has one outer border or one surface step, not both plus inner rules. Lines are for tables, inputs and the one divider between a header and its body.
   - *Check:* no border inside a card except table rows, inputs and the header divider.
5. **Spacing rhythm.** Inside a block, related lines sit `--space-1` to `--space-2` apart; blocks inside a card `--space-4`; cards `--space-3` to `--space-4`; sections `--gap-section`. Padding inside a card is at least `--space-4` on every side. Things that line up (labels, values, numbers) share one left edge.
   - *Check:* the label column and the value column of a card each have one left edge.
6. **One icon set.** Web: one outline set, **Lucide** (MIT, DL8) at 14 and 16 px with a 1.5 px stroke. App: SF Symbols. Text glyphs (`▸ ▾ ✓ ⋯ ✈`) are replaced where an icon exists. An icon-only control has an accessible name (principle 14).
   - *Check:* the PR adds no new text glyph used as an icon.
7. **Numbers.** `font-variant-numeric: tabular-nums` on every number that changes or sits in a column. Numbers in tables align right; units stay with the number (`32%`, `$4.34`, `287k`).
   - *Check:* changing numbers do not shift their neighbours.
8. **Motion.** Two durations (`--dur-fast` 120 ms for hover and press, `--dur-base` 200 ms for open, close and fold) and one curve (`--ease` `cubic-bezier(0.2, 0, 0, 1)`). Folds animate height or opacity, never position jumps. Liveness motion (principle 10) is the only repeating motion.
   - *Check:* no new duration or curve outside the tokens.
9. **One theme finished first.** The default theme (Radar Console) gets every craft fix first and is the reference for screenshots in the Mac checklist and Playwright passes. The other themes must stay readable and keep 4.5:1, but they follow the default, not the other way round.
10. **Menu bar icon (ANNUNCIATOR).** A template (single-colour) image in the normal state, like every other menu bar app. Colour appears only with CAUTION or WARNING, and the shape changes with it (principle 2).

## 4. Patterns

### 4.1 Row and expanded detail

A list row answers "what is this and is it all right" in one line: name, place, state, the current item, age and one or two numbers. Clicking or pressing Enter opens the detail under the row. The detail shows only what the row does not (principle 6) and uses the full row width.

### 4.2 Card

A card has four parts, in this order:

1. **Header.** Name, code, place, state badge, origin badge on the left. Everyday actions on the right, rare ones in `⋯`.
2. **Alert band.** One compact line per abnormal condition, ordered by level. Not rendered when nothing is abnormal.
3. **Body grid.** Named columns (for example NOW, CREW, ACCOUNT · FUEL, PERFORMANCE). An empty column is hidden. The grid collapses to one column when narrow.
4. **Folded history.** Long lists (LOGBOOK, past events) show a few rows and `더 보기`.

[ATC-280](https://linear.app/vocado/issue/ATC-280) applies this to the FLEET card.

### 4.3 Fold

A fold header always says what it holds: `ADVISORY 13`, `ARRIVED 42 more · 전체 보기`, `READINESS · gate 12/20 ✗`. The open or closed state may be remembered per tab in the browser. A WARNING is never folded.

### 4.4 Chips, tags and dots

- **Chip** (pill): a selectable or countable value (TYPE RATING, PENDING with a count).
- **Tag** (2 px radius, mono, uppercase): a fixed state or kind (`BG auto`, `STALE`, `AOG`).
- **Dot**: liveness or a level next to a name. A dot never stands alone without a text or an accessible name.

### 4.5 Status row group (ANNUNCIATOR)

Secondary status lines (DUTY, GitHub, Linear, RADIO) share one group under the LAMP list. When none of them needs attention, they collapse into one line (`DUTY · GitHub 3 · RADIO TOWER`). A new source joins the group; it does not get its own row in the fixed strip. [ATC-222](https://linear.app/vocado/issue/ATC-222) applies this.

### 4.6 Empty and unreachable states

An empty list says what would be there in one faint line (`LOGBOOK에 ARRIVED 기록 없음`), and only when the list is the main content of its place. Otherwise the block is hidden. "Unreachable" is its own state: grey, with what to do (`atc 연결 안 됨 — SSH 포워딩` and its repair button), never an empty screen.

## 5. Review checklist

For a PR that changes a screen in atc or ANNUNCIATOR. Copy the lines that apply into the PR body and answer each in one line.

Running atc sessions get the diff of this file on their next turn when it changes on `origin/main` (the rules-drift hook wired in `.claude/settings.json`, ATC-295; [hooks/README.md](../hooks/README.md) "Wired in atc").

- [ ] Normal state: no signal colour, no motion, no "all fine" line (1).
- [ ] Levels readable in greyscale; NEEDS YOU not amber (2).
- [ ] Signal tokens used only for their meaning in 3.2 (3).
- [ ] No client-side rule for levels, counts or destinations (4).
- [ ] First action within the first screen height at 1280 × 800 (5).
- [ ] Detail does not repeat its row (6).
- [ ] Each removed line is constant, empty or a normal-state confirmation; each fold shows a count (7).
- [ ] No horizontal scroll at 390 px, no empty half at 1280 px (8).
- [ ] Terms in [naming.md](naming.md); times in Z; ages in one unit (9).
- [ ] Readable with motion off (10).
- [ ] Nothing needed for a decision lives only in a tooltip (11).
- [ ] At most five visible buttons per card; destructive actions confirmed (12).
- [ ] Tokens only (13). `npm test` checks the web part (`server/css-lint.ts`, `server/css-lint.test.ts`): new literal colours, px/rem font sizes, `z-index` that is not `var(--z-…)`, `transition: all` and `outline: none` without a `:focus-visible` rule fail against the baseline `web/css-lint-baseline.json`. When a count drops, lower the baseline in the same PR with `node server/css-lint.ts --update`; never raise it to accept a new violation.
- [ ] Keyboard path checked (14).
- [ ] Craft (3.5): normal state has no coloured blocks; mono only for IDs, codes and numbers; three text sizes per card; no inner borders; one left edge per column; icons from the set; `tabular-nums` on changing numbers; motion from the tokens.

Taste: [design-taste.md](design-taste.md) (brief v1, a tendency from one round; this document wins where they disagree) says how a screen should feel: one focal element, readable before quiet, alignment over density, status-page bars for history, detail on demand.

The `ui-review` skill (`.claude/skills/ui-review/`, run by `atc-task` before a screen PR) runs this checklist and adds the vendored rules for focus, forms, states, hit targets and long content; where a vendored rule disagrees with this document it is marked `CONFLICT` and not applied until decided. All skills and agents of atc are listed in [skills.md](skills.md).

## 6. Implementation order

| Step | What | Where | Tier |
|---|---|---|---|
| L0 ✅ | Adopt this document, with the section 9 answers (2026-10-01) | this file | `auto` |
| L1 | Mark [ui-visibility.md](ui-visibility.md) section 2 and [alerting.md](alerting.md) section 2 as gathered here (a link, not a copy) ✅, and point atc-app `docs/design.md` section 3 here | docs | `auto` |
| L2 | [ATC-280](https://linear.app/vocado/issue/ATC-280) (FLEET card) and [ATC-222](https://linear.app/vocado/issue/ATC-222) (menu bar) cite this document and use the section 5 checklist | the two work orders | — |
| L3 | A one-line rule in root `CLAUDE.md` and atc-app `CLAUDE.md`: screen PRs follow `docs/design-language.md` and answer the checklist | `CLAUDE.md` | `user` |
| L4 | An audit of each tab against the checklist, one work order per tab that fails. Since 2026-10-02 the tabs themselves are regrouped by [layout.md](layout.md); the audit follows its order (Y1–Y6) and checks each new screen, not the retired tabs | Linear | — |
| L5a | Craft tokens: `--dur-*`, `--ease`, `tabular-nums` utility, DL7 sizes, the icon set (3.5) | `web/src/styles.css`, one component | `auto` (`package.json` for the icon set: `user`) |
| L5b | Craft pass on the FLEET card as the reference card, together with [ATC-280](https://linear.app/vocado/issue/ATC-280) | web | `auto` |
| L6 | Tooltip pass: move tooltips that carry the only copy of a decision value onto the screen (principle 11) | web | `auto` |

### L5a as built (ATC-283)

CSS only, in `web/src/styles.css` (plus one cell width in `Dispatch.css`); no colour, layout or component structure changed.

- **Sizes (DL7).** `--text-md` 13 → **14 px** and `--text-xs` 11 → **12 px** in the default density; `:root[data-density="compact"]` sets them back to 13 and 11. `--text-2xs`, `--text-sm` and `--text-lg` and up are unchanged (so `--text-sm` and `--text-xs` are both 12 px in the default density).
- **Motion tokens.** `--dur-fast: 120ms`, `--dur-base: 200ms`, `--ease: cubic-bezier(0.2, 0, 0, 1)`. The interaction transitions (settings gear, map line hover, block hover, the "found" highlight) use them; the repeating liveness animations (ping, sweep, flaps, ticker, twinkle, blink) keep their own durations. `data-motion="off"` still stops everything (no running infinite animation on RADAR, FLEET, FIDS or DISPATCH).
- **Numbers.** A `.tn` utility and one selector list in `styles.css` apply `font-variant-numeric: tabular-nums` to the header readouts and clock, STRIPS values and ages, FLEET list cells and card actuals, DISPATCH score and age, SCHEDULE age and counts, FLEET PLAN age, DUTY since and the activity age. It is `!important` because a later `font:` shorthand resets the value. METRICS keeps its own rules.
- **DISPATCH factor detail** cell: `max-width` 140 → 160 px so the larger caption size does not truncate more of it.
- **Not done here:** the icon set (L5a second half, `package.json`, `user` tier).

### Not built yet

Everything except L0 and the atc half of L1: the atc-app pointer (L1), the two `CLAUDE.md` lines (L3, a separate `user`-tier PR), the tab audit (L4), the Craft tokens and the Lucide icon set (L5a), the FLEET card (L5b, in progress as ATC-280) and the tooltip pass (L6).

## 7. Risks

| Risk | Mitigation |
|---|---|
| A principle document nobody reads | L2 and L3 tie it to work orders and PR bodies; the checklist is short and testable |
| "Delete" removes something a person needed | Rule 7 deletes only constant text, empty placeholders and normal-state confirmations; anything item-specific folds instead |
| Two clients drift (web and app) | Principle 4: the server computes; section 3.4 and 4.5 name the shared mappings; the app's ATCCore tests pin the same title rule as `menubar/format.mjs` |
| The rules freeze the look | Section 3 is values, not structure; themes keep changing values. A principle changes by editing this document with a decision row |
| A checklist line becomes busywork | Lines that do not apply are left out of the PR body; reviewers check the ones that do |

## 8. Terms

| Term | Meaning |
|---|---|
| Dark cockpit | Normal is quiet; only abnormal states light up |
| Alert band | The block under a card's header with one line per abnormal condition |
| Fold | A collapsed block that shows a count or summary and opens in one action |
| Signal colour | One of `--alert`, `--amber`, `--radar`, `--cyan`, `--blue`, each with one meaning (3.2) |

## 9. Decisions (SUPERVISOR)

Decided by the SUPERVISOR on 2026-10-01: every row as recommended (the bold answer).

| # | Question | Decision (2026-10-01) |
|---|---|---|
| DL1 | One document for both atc and ANNUNCIATOR, kept in the atc repository | **Yes**; atc-app links to it |
| DL2 | The delete / fold / show rule (principle 7) settles "never hide, only fold" versus "remove what is not needed" | **Yes**: delete only constant text, empty placeholders and normal-state confirmations; fold the rest |
| DL3 | Tooltip rule (principle 11) | **Adopt**, applied to new PRs now and to old screens through L6 |
| DL4 | At most five visible buttons per card | **Yes**, the rest in `⋯` |
| DL5 | Add the one-line rule to both `CLAUDE.md` files (L3) | **Yes**, after DL1–DL4 |
| DL6 | Adopt ui-visibility section 2 through this document (its other sections stay a draft) | **Yes** |
| DL7 | Body 14 px and captions 12 px in the default density (3.5 rule 3) | **Yes**; `compact` keeps 13/11 |
| DL8 | Icon set for the web | **Lucide** (MIT, outline, tree-shaken per icon) |
| DL9 | Radar Console is the reference theme that gets craft fixes first (3.5 rule 9) | **Yes** |
