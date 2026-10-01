# Design audit (L4): every atc tab against the design-language checklist

> Status: SURVEY for [ATC-285](https://linear.app/vocado/issue/ATC-285), 2026-10-01. Audited commit: `de58907` (`origin/main` with ATC-283, ATC-280 and ATC-287 / PR 360 merged, so the FLEET card is measured **as built**). Nothing here changes a screen. The work orders in section 4 are proposals for ENGINEERING or DUTY to file in Linear.

Related: [design-language.md](../design-language.md) (section 5 is the checklist), [ui-visibility.md](../ui-visibility.md) (the 2026-09-29 review this updates).

## 1. Method and limits

- **Where.** A test server on port 7722 (temporary state folder with copies of `airports.json`, `fleet.json`, `proposals.jsonl`, `schedule.jsonl`, `logbook.jsonl`; `ATC_GITHUB=off`; a `claude` stub; PID saved and killed by PID). Linear was live (read only), so FIDS and RADAR show real FLIGHTs; GitHub was off, so FOLLOW had little to show. **Production (7700) was not opened**; the copies carry its real DISPATCH and SCHEDULE volumes. Headless Chromium (Playwright), default theme and density, **1280 × 800 and 390 × 800**. No screenshots; everything below is computed (counts, positions, computed styles) or read from code.
- **What the numbers mean.** `screens` = page height / viewport height. `words` = words in `main`. `signal-coloured` = elements in `main` whose text, background or border colour equals `--radar`, `--cyan`, `--amber`, `--alert` or `--blue`. `sizes` = distinct computed font sizes on text. `nested borders` = bordered elements inside a bordered element (table cells and form controls excluded). `title only` is a heuristic: elements whose tooltip contains a digit while their visible text has none. The data was a live, busy state, so "no signal colour when normal" (principle 1) cannot be judged by a count alone; I judge colour by **what carries it** (decoration vs state).
- **Judgement.** Each checklist line is ✓ (passes on the evidence), ✗ (fails, evidence in section 3) or – (not applicable, or not assessed; the reason is in the note under the table). The drawers and the ANNUNCIATOR app were not audited (the app is ATC-222; the drawers are listed under "not covered").
- **Usage order.** The FLIGHT RECORDER does not record which tab is open, so "how often a tab is used" is not available. Work orders are ordered by words per screen and by the amount of decorative colour and tooltips.

## 2. Summary

Columns are the section 5 lines: **1** quiet when normal · **2** urgency scale · **3** one colour one meaning · **4** server decides · **5** first action in the first screen · **6** detail does not repeat · **7** delete / fold / show · **8** width (no side scroll at 390, no empty half at 1280) · **9** words and Z times · **10** static beats moving · **11** tooltips never the only copy · **12** actions (≤ 5 buttons, rare ones in `⋯`) · **13** tokens only · **14** keyboard · **C** Craft (3.5: colour budget, font roles, three sizes, borders, numbers).

| Tab | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | C |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RADAR | – | – | ✗ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✗ | – | ✓ | – | ✗ |
| FOLLOW | – | – | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | – | ✗ | – | – |
| GLOBE | – | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | – | ✗ | – | – |
| STRIPS | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✗ | – | ✓ | – | ✗ |
| FIDS | – | – | ✗ | ✓ | ✓ | – | ✗ | ✗ | ✓ | – | ✗ | – | ✓ | – | ✗ |
| AIRPORTS | – | – | ✓ | ✓ | ✓ | – | ✓ | ✗ | ✓ | – | ✓ | – | ✓ | – | ✓ |
| FLEET (row, FLEET PLAN, CHECKRIDE, CONTROL, FUEL) | – | – | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✗ | ✓ | ✓ | ✓ | ✗ |
| METRICS | – | – | ✓ | ✓ | ✓ | – | ✓ | ✗ | ✓ | – | ✓ | – | ✓ | – | ✓ |
| NETWORK | – | – | ✓ | ✓ | ✗ (390) | – | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | ✗ |
| DISPATCH | – | – | ✗ | ✓ | ✓ | – | ✗ | ✓ | ✓ | – | ✗ | ✓ | ✓ | – | ✗ |
| SCHEDULE | – | – | ✓ | ✓ | ✗ | – | ✗ | ✓ | ✗ | – | ✗ | ✗ | ✓ | – | ✗ |
| RADIO | – | – | ✗ | ✓ | ✓ | – | – | ✗ | ✓ | – | ✓ | – | ✓ | – | ✗ |
| DOCS | – | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | – | ✓ |
| Header (console, readouts, ticker) | – | – | ✓ | ✓ | ✗ (390) | – | ✓ | ✗ (390) | ✓ | – | ✓ | – | ✓ | – | ✓ |
| Settings window | – | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ |

Notes on the dashes. **1, 2, 10** need a controlled state; with live data every tab shows something. Principle 10 is only counted as a finding where something moves with no state behind it (section 3, "cross-tab"). **4** was checked by reading code: the only client-side level rule found is `Card.tsx:429` (see C7); the RADIO `overdue` compares a server-provided `overdueAt` with the clock, which is a note, not a fail. **6** applies to the tabs with expandable details: STRIPS and FLEET pass, the others have none. **12** is only judged where a tab has per-item cards or buttons. **14** (keyboard) was checked on the FLEET card in ATC-280 and ATC-287; for other tabs 0 icon-only buttons lack a name (`aria-label` or text) and every control is a native `button` or `a`, but I did not walk each tab with the keyboard. FOLLOW had too little data to judge words and width. Drawers: not covered.

## 3. Findings by tab (ordered by impact)

Figures are 1280 px unless marked 390.

### DISPATCH (6.0 screens at 1280, 9.1 at 390; 1,179 words)

- **7 delete / fold / show; 3 colour; C Craft.** 1,317 signal-coloured elements (`--radar` 843, `--cyan` 359, `--amber` 109): colour is on rows and codes, not only on state. **2,367 nested borders** (`.dp-` cards inside bordered panels). **567 elements set Korean sentences in mono** (3.5.2). 5 distinct text sizes (3.5.3). 10 text-glyph icons (3.5.6).
- **11 tooltips.** **1,864 `title` attributes**; 206 carry a number the visible text does not show.
- **12 actions pass:** at most 2 buttons per card.
- Improved since 2026-09-29: 6.0 screens / 1,179 words against 6.9 / 2,572.

### FIDS (10.8 screens at 1280, **24.1 at 390**; 6,651 words)

- **7 / 8.** The longest screen by far: 217 buttons and 6,651 words, and 24 screens at 390 px; the right side of the table is not folded or collapsed to a card on a phone.
- **3 / C.** **366 signal-coloured elements, 294 of them `--cyan`**: the cyan is the AIRPORT code and key text, decoration by 3.5.1.
- **11.** **1,354 `title` attributes**, 163 with a number only in the tooltip.
- 4 text sizes; Korean in mono on 8 elements.

### SCHEDULE (4.5 screens at 1280, 9.6 at 390; 1,589 words)

- **5 first action.** The first verdict buttons (`승인했을 것` / `거절했을 것`) sit at **y = 900 px**, below the first screen at 1280 × 800; the first button on the screen is the mode switch `S2 승인 운용 켜기` (y = 161).
- **12 actions.** One card holds up to **19 buttons**.
- **9.** Two times without `Z`. **7.** Words are down from 2,464 to 1,589 but the page is still 4.5 screens. **11.** 115 `title`s (15 number-only). **C.** 5 Korean lines in mono, 2 glyph icons.

### FLEET: list, FLEET PLAN, CHECKRIDE, CONTROL SESSIONS, FUEL (3.5 screens, 1,915 words)

The card is the reference and passes (ATC-280, ATC-287). The rest of the tab still has the old look, because L5b was scoped to `.fl-card`:

- **3 / C.** The list rows keep a **coloured left bar per STATUS** (`StatusList.css:50–58`: radar, cyan, alert) and coloured status words (`:78–89`); `.fl-r-flight .mono` is `--radar`. `.fl-chip.r-SEC` is `--alert` outside the card (`Fleet.css:43`) and `.fl-origin.o-background` is `--radar` bordered (`:221`). 272 signal-coloured elements, 195 of them `--cyan`.
- **11.** 345 `title`s (26 number-only). **C.** 22 text-glyph icons at 390 (list chevrons and others).
- The shared `.fl-btn`, `.fl-sub`, `.fl-origin`, `.fl-chip` styles outside the card still use mono uppercase letter-spaced headings and the `--panel-2` filled button.

### RADIO (1.2 screens at 1280; 2,268 words)

- **3 colour.** **546 signal-coloured elements: `--blue` 360 and `--cyan` 185**. `--blue` means NEEDS YOU / HANDOFF (design-language 3.2), but it is on the ordinary lines of the log.
- **8 width.** At 1280 px only one element sits in the right 45 % of `main`: the log is a left-aligned text column with an empty right half.
- **C.** 181 nested borders; 103 folds and 117 buttons (every line is a button). Only 2 text sizes (✓).

### RADAR (2.0 screens at 1280, 4.9 at 390; 517 words)

- **3 / C.** **63 `--cyan` elements** are the AIRPORT code (`.apt`, `styles.css:1020`): a decorative signal colour (3.5.1). 9 glyph icons.
- **11.** 90 `title`s (34 number-only). 11 infinite animations run (header, busy dots and sweep): within principle 10 as liveness, but the count is worth a pass.
- Words, width and first action pass (first item at y = 163).

### STRIPS (2.5 screens; 737 words)

- **C.** 5 text sizes; **230 nested borders** (strip inside bordered column); 7 Korean lines in mono; 11 glyph icons. **11.** 174 `title`s (41 number-only). Everything else passes; 6 (detail does not repeat) passes.

### NETWORK (3.6 screens at 1280, 5.1 at 390; 672 words)

- **5 at 390.** The first item sits at y = 522 at 390 px (header 263 px plus controls). **C.** 4 text sizes; 6 Korean lines in mono. Otherwise passes.

### AIRPORTS and METRICS (width at 390 px)

- **8.** AIRPORTS: `.apt-table` is 623 px wide at 390 px (page scrolls sideways); METRICS: `.mx-table` is 563 px wide at 390 px. Both fail "no horizontal page scroll at 390". Other lines pass. (Both overflowed before ATC-283; that change made AIRPORTS about 11 px wider.)

### FOLLOW and GLOBE (token literals)

- **13.** `Follow.css:145` sets `font-size: 8px`; `Globe.css:116` and `:221` set `font-size: 14px`. Everything else measured passes; FOLLOW had too little data (GitHub off) to judge words and width.

### Header (console, readouts, ticker)

- **5 / 8 at 390.** The header is **263 px tall with four tab rows** at 390 px, a third of the first screen, so the first item sits at y ≈ 340–520. At 1280 it is 111 px with one row. 9–11 infinite animations run in it.

### DOCS and the settings window

Pass. DOCS is prose (its 5 sizes are heading levels). The settings window has 4 text sizes (10, 12, 14, 18 px; 18 is the title) and 17 controls; no `title`-only values.

## 4. Proposed work orders (one per failing tab, by impact)

Each is `auto` tier unless noted (web screen code, no server change). Sizes follow the issue labels (S, M, L). "Done when" always includes `npm test`, `npx tsc --noEmit -p .`, `npx vite build` and a Playwright check at 1280 and 390 px in the three themes, described in words (no screenshots).

1. **DISPATCH: Craft pass and volume.** *Why:* the largest page (6 screens, 1,179 words), 1,317 coloured elements, 2,367 nested borders, 567 Korean lines in mono, 1,864 tooltips. *Change:* use the reference-card rules (neutral rows, colour only for state, sans for sentences, one divider, three sizes); fold the per-row detail behind a count; move number-only tooltips onto the screen (with L6). *Done when:* coloured elements in a normal state drop by 80 % (measure with the method in section 1), no Korean sentence in mono, ≤ 3 text sizes, nested borders ≤ 50, first card still within the first screen. *Wake:* L.
2. **FIDS: fold and collapse.** *Why:* 10.8 screens at 1280 and 24 at 390 with 6,651 words; 294 cyan elements. *Change:* fold groups behind counts (the ATC-112 cap pattern), turn the table into one-line cards at 390, make the AIRPORT code neutral, move number-only tooltips. *Done when:* ≤ 5 screens at 1280 and ≤ 10 at 390, no cyan on static codes. *Wake:* L.
3. **FLEET list, FLEET PLAN, CHECKRIDE, CONTROL SESSIONS: apply the card rules outside the card.** *Why:* the shared `.fl-btn`, `.fl-sub`, `.fl-chip`, `.fl-origin` and the list status bars still use signal colour and mono uppercase. *Change:* neutral status as dot plus word on the row (like the card), `SEC` neutral, buttons transparent with a 1 px border, one uppercase level; then remove the `.fl-card`-only overrides in `Card.css` that become redundant. *Done when:* the list, FLEET PLAN and CHECKRIDE show no coloured bar or chip in a normal state and the card looks unchanged. *Wake:* M.
4. **SCHEDULE: decisions first and fewer buttons per card.** *Why:* the first verdict is at y = 900 px; a card has 19 buttons. *Change:* put the open verdicts above the mode switch and READINESS (principle 5), move rare actions into `⋯` (principle 12), add `Z` to the two bare times, fold history. *Done when:* the first verdict is inside 800 px at 1280, ≤ 5 visible buttons per card. *Wake:* M.
5. **RADIO: neutral lines and use the width.** *Why:* 546 coloured elements (`--blue` 360 on ordinary lines) and an empty right half. *Change:* `--blue` only for NEEDS YOU / HANDOFF; neutral frequency and station text; a two-column layout (log and a thread or filter side) or a wider line grid at 1280. *Done when:* no `--blue` in a normal log, right half used or the log capped to a readable width with the filters beside it. *Wake:* M.
6. **STRIPS and RADAR: neutral AIRPORT code, one border level, three sizes.** *Why:* 63 cyan codes (RADAR), 230 nested borders and 5 sizes (STRIPS). *Change:* `.apt` neutral (shared, see C1), strip inner rules removed in favour of surface steps, sizes cut to three. *Done when:* no cyan on `.apt`, STRIPS ≤ 3 sizes. *Wake:* M.
7. **AIRPORTS and METRICS tables at 390 px.** *Why:* both scroll sideways. *Change:* collapse the tables to stacked rows (or two columns) below 860 px. *Done when:* no horizontal scroll at 390 px in the three themes. *Wake:* S.
8. **NETWORK and header at 390 px.** *Why:* the header takes 263 px, NETWORK's first item is at 522 px. *Change:* collapse the 13 tab names into a one-row scroller or a menu below 860 px (keep every tab reachable by keyboard), and use the saved space to start NETWORK at the controls. *Done when:* header ≤ 120 px at 390 px, first item of every tab inside the first screen. *Tier:* `auto`; *Wake:* M.
9. **Literal sizes in FOLLOW and GLOBE.** *Change:* replace `font-size: 8px` (`Follow.css:145`) and 14 px (`Globe.css:116`, `:221`) with `--text-*` tokens. *Done when:* `grep -rn "font-size: *[0-9]*px" web/src --include=*.css` is empty. *Wake:* S.

## 5. Cross-tab changes (one shared change each)

- **C1. `.apt` is cyan everywhere** (`styles.css:1020`). It is the biggest single source of decorative colour (RADAR 63, FIDS 294). One rule change to `--line-strong` and `--muted` text, the card already does it locally. Replaces the `.fl-card .apt` override. *Tier:* `auto`.
- **C2. Korean sentences in mono.** The global `.mono { font-family: var(--mono); font-size: var(--text-sm) }` is applied to spans that hold sentences (DISPATCH 567, FIDS 8, STRIPS 7, NETWORK 6, SCHEDULE 5). Audit the `.mono` call sites; give sentences `--sans`; keep `.mono` for IDs, codes, numbers and times. One shared sweep, and lint the case in `design-language` checklist.
- **C3. The tooltip pass (L6).** `title` counts: DISPATCH 1,864, FIDS 1,354, FLEET 345, STRIPS 174, SCHEDULE 115, RADAR 90; 480 of them carry a number the visible text does not show. Move those onto the screen (a fold or a caption) and keep tooltips for "how it was made".
- **C4. Nested borders.** DISPATCH 2,367, STRIPS 230, RADIO 181, FLEET 133, RADAR 129. A shared `.panel` / `.card` rule (surface step, one divider) would remove most of them; the FLEET card is the pattern.
- **C5. Text-glyph icons** (`▸ ▾ ✓ ⋯`): 9–22 per tab. Waits for the Lucide set (ATC-284); then one sweep.
- **C6. The header at 390 px** (work order 8) and the nine to eleven infinite animations in the normal header and RADAR state: check that each is liveness (busy dot, sweep) and stop the rest.
- **C7. A client-side level rule in the reference card.** `web/src/views/fleet/Card.tsx:429` adds `lv-info` when `a.fuel.top.pct >= 80` and the server level is `ok`. That is a client rule for a level (principle 4). Remove the extra condition and use `a.fuel.level` only (the server already returns `info` at its threshold). *Tier:* `auto`, S. (This is a finding against ATC-287's own change.)
- **C8. A shared fold component.** FIDS (ARRIVED cap), RADAR and STRIPS (GATE CLEANUP), DISPATCH and SCHEDULE (READINESS) and the FLEET card (`더 보기`) each fold in their own way. One component that always shows a count and opens by click or key would satisfy principle 7 once.

## 6. Not covered

- The drawers (IDEAS, DUTY, DISPATCH briefing), the UPDATE bar and the alert panel; a keyboard walk of every tab; the Glass Cockpit and Night Sky themes and the compact density (the card was checked there in ATC-287, the other tabs were not); a state with nothing abnormal (principle 1 and 2 need a controlled data set); the production screen (7700), which was not opened.
