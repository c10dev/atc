---
name: ui-review
description: Use when a FLIGHT changes atc's web screen (web/src) or the ANNUNCIATOR app screens, before the PR, or when asked to audit one tab. Reviews the changed screens against atc's design language (docs/design-language.md section 5) a softer taste layer (docs/design-taste.md) and two vendored rule sets, clicks through the running screen to catch layout shifts, and prints a findings block for the PR body. Not for server, hooks or docs-only FLIGHTs.
---

# ui-review

A review tool for screen changes. It answers the section 5 checklist of [docs/design-language.md](../../../docs/design-language.md) with evidence instead of from memory, and adds the rules the design language does not have (focus, forms, states, hit targets, long text, loading).

## Order of authority

1. Root `CLAUDE.md`.
2. `docs/design-language.md`: the principles, 3.5 Craft and the section 5 checklist. **Do not copy it into your output; cite its numbers** (`3.5.4`, `principle 11`). It stays the single source.
3. `docs/design-taste.md` (the taste brief): a softer third layer, below. A tendency from one round by one person, so it never outranks layers 1 and 2 and never produces a Blocker.
4. The vendored references, below. They only add rules.

A value the design language decided is **a decision, not a defect**: never report it, whatever a vendored rule says. Where a vendored rule and the design language disagree, the reference line is marked `CONFLICT`. Do not apply a `CONFLICT` line and do not decide it: list it under **Conflicts seen** in your output (once per rule, with the file and line it would have hit) and move on. The SUPERVISOR decides after the ATC-285 audit.

## Taste layer (layer 3)

Read [docs/design-taste.md](../../../docs/design-taste.md) before reviewing. It holds five numbered points (1 one focal element, 2 readable before quiet, 3 alignment and whitespace over density, 4 status-page form for history, 5 detail on demand). **Cite the point number only** (`taste 2`); never copy the brief's text into the output, and never quote its evidence. Read its status line: it is a tendency, revised when another category is judged.

- **Severity cap.** A taste finding is **Should-fix** or **Note**, never a Blocker, and never makes the verdict Block. It still needs the proof gate below (contract = the point number, evidence = `file:line` plus a runtime or measured fact, correction in tokens). "Feels busy" is not evidence; a count is (equal-weight sections, text tokens and their measured ratio, left edges, height against the viewport).
- **Conflict rule.** Where a taste point disagrees with `docs/design-language.md`, the design language wins. Do not apply the point and do not decide it: list it under **Conflicts seen** as `taste N vs <design-language rule>` with the file and line it would have hit (the SUPERVISOR decides). A value the design language decided is a decision, not a taste finding.
- **Where taste looks.** Point 1: how many blocks compete at the same weight and size, and whether the card or view fits the viewport. Point 2: information text on a token weaker than `--muted` (measure the ratio in all three themes; the tokens are in `web/src/styles.css`). Point 3: label column width and left edge per section, numbers `tabular-nums` and right-aligned. Point 4: a history shown as a table where a bar row would answer "has it been OK lately?", and bars without a label. Point 5: sections that are long and always open, folds without a summary, a fold that moves anything above or beside it (the layout-stability step below measures it).
- **Not a taste finding:** anything already in the section 5 checklist or the vendored rules (report it there), and anything that is a design-language decision.
- Cap: at most 3 taste findings in `diff`, 6 in `audit`; merge repeats.

References (read both before reviewing):

- [references/web-interface-guidelines.md](references/web-interface-guidelines.md): Vercel's MUST/SHOULD/NEVER list (MIT). Focus, targets, forms, state, content handling, accessibility.
- [references/feel.md](references/feel.md): make-interfaces-feel-better, trimmed to what fits plain CSS and a static console (MIT). Radii, alignment, numbers, wrapping, icons, hit areas.

Sources, commits and licences: `THIRD_PARTY_NOTICES.md` at the repository root. Do not vendor anything else into this skill.

## Modes

- `diff` (default): the screens a FLIGHT changed. Take the changed files from `git diff --name-only origin/main...HEAD`, keep `web/src/**` and the ANNUNCIATOR screen files, and read each changed component with its CSS. Review only what the diff touches and what it renders next to; do not audit the whole tab.
- `audit`: one whole tab (name it, for example `audit DISPATCH`). Read the tab's view file, the CSS it imports and the shared pieces it uses (`ui.tsx`, `styles.css` tokens). For runtime evidence start a test server (see "Evidence" below). This is the mode for ATC-285-style audits.

## Runtime step: layout stability (run it early, in `diff` and `audit`)

Run this **once the screen renders, before polishing**. Why: in ATC-309, 7 of 8 dashboards built by sessions moved their layout when a filter, chip or row was clicked, and no other measure (axe, hit targets, focus, keyboard) saw it; ATC-296 found this skill running at turns 46 to 55 of 53 to 63, too late to change anything. The standard CLS metric cannot see it: shifts within 500 ms of input are `hadRecentInput` and left out. A bounding-box diff around each click can.

The probe is [references/layout-probe.js](references/layout-probe.js): plain browser JS, run through the Playwright MCP `browser_evaluate`. No dependency is added.

1. Start the screen (for atc: a test server, see "Evidence") and open it with `browser_navigate`. Wait until it has data.
2. `browser_evaluate` with the **whole contents of `layout-probe.js`** as `function`. It installs `window.__lp`. Run it again after any click that navigates (the page loses `__lp`; the "before" boxes are kept in `sessionStorage`).
3. `() => __lp.idle("main")` (use the screen's root selector). Whatever moves with no click (a clock, a live feed) is ignored from here on.
4. `() => __lp.controls("main")` lists what to click: tabs, sort headers, buttons and chips, checks, selects, rows, details, same-app links. Go through all of them, view controls first.
5. For each control: reload (or click it back), install if needed, `() => __lp.mark("main")`, click with `browser_click` (`browser_select_option` for a select), then `() => __lp.check("<label>", {target: "<sel>", expectInsert: <true for a row, detail or editor that is meant to open>})`. For an in-page click one call does all three: `() => __lp.step("<sel>", {expectInsert})`.
6. **Never click an action that writes or sends** (STOP, LAUNCH, RESTART, DELETE, SEND, APPROVE, MERGE, SAVE, APPLY, unfollow …). View controls only. Use fake data and a temporary `HOME`, so no real session is on the screen.

`check` returns the elements that moved or resized by 1 px or more, grouped, with a likely cause. The intended change is not reported: the clicked control's own state, and whatever changed **inside** the region where content appeared or disappeared (a detail panel, a table body), unless the clicked control is inside it too. Severity: **Blocker** = a landmark, column, sibling or container that was not the target moved or resized by 2 px or more (1 px for a header, nav, form, table or table head); **Note** = smaller shifts, the target itself, rows added or removed, an intended open.

| Cause the probe names | Fix |
|---|---|
| table column width changes | fixed column widths or `table-layout: fixed`; `tabular-nums` |
| a sibling's width or position changes | reserve the width of the thing that changes (fixed width, `min-width`, `tabular-nums`) |
| pushed by inserted content (a badge, ×, count, panel) | reserve the space, or overlay instead of insert |
| border or padding changes on the active state | keep the same box: border always present (transparent when off), or outline / box-shadow |
| font-weight changes on the active state | do not change weight, or reserve the bold width (`::after` bold-text trick) |
| scrollbar appears or disappears | `scrollbar-gutter: stable` |
| text wraps or its height changes | `overflow-wrap`, `min-width: 0`, or a fixed-line layout |
| a container's height follows the swapped content | `min-height` on the list area, or scroll the list inside a fixed-height box |

Limits: it compares boxes, not pixels, so a static misalignment (an × button not aligned) is invisible to it; it clicks one control at a time from a clean state, so shifts that need two steps are not found; boxes inside an inner scroll container are compared in page coordinates. Report what it could not click as **Not verified**.

## Proof gate (every finding)

A finding is kept only if it has all three, and survives your attempt to falsify it:

1. **Contract**: the section 5 checklist line, design-language principle or 3.5 rule, or the vendored rule it breaks (quote its id or its first words).
2. **Evidence**: `file:line`, plus one runtime fact where one exists (a selector, a count, the keyboard path, a computed size). "Looks off" is not evidence.
3. **Correction**: the exact change, in plain CSS or React, using the `:root` tokens of `web/src/styles.css`. Never Tailwind, never a new library, never a hard-coded colour or font.

Then try to falsify it: is it a design-language decision? Is the state it affects reachable? Does a token or a shared component already handle it? Drop what does not survive; list it under **Considered but rejected**.

Severity: **Blocker** (breaks a section 5 line, makes a control inaccessible or misleading, or hides a decision value); **Should-fix** (noticeable usability or consistency problem); **Note** (isolated polish; only in `audit` mode or when it is one line to fix). Never pad the report. Cap: 8 findings in `diff`, 20 in `audit`; merge a repeated issue into one row with every location.

## Evidence

- Prefer reading: `grep -n` the CSS for the property, count the components, trace the keyboard path through the handlers.
- For runtime facts start a test server on a free port (7702, else 7703 or 7704) with `ATC_GITHUB=off`, a temporary `ATC_STATE_DIR` holding only copies of `airports.json` and `fleet.json`, and a PID file, exactly as root `CLAUDE.md` "검증" says. Kill it with `kill "$(cat <pid file>)"` only. Never touch 7700 or `~/.local/state/atc/`.
- **No screenshots in the PR or in any branch** (public repository). Describe what you saw in words. Never send messages to real team sessions while testing.
- A check you did not run is **Not verified**, with what remains. Do not imply an uninspected surface was reviewed. If no screen could be started, the layout-stability row says so and the verdict lists it.

## What to look for (short list; the references hold the rules)

Section 5 line by line first. Then, in this order: focus and keyboard (visible focus, no `outline: none` without a replacement, a path to every action); hit targets (see the Note in feel.md principle 16); long and empty content (long IDs and branch names, zero items, one item, 200 items, an error); loading and error states (a state exists, copy says what to do next); numbers (`tabular-nums`, units kept with the number, times in Z); icon-only controls (accessible name); nested radii; motion (reduced-motion honoured, nothing needed only while moving).

## Output (print this block; the PR body carries it next to the section 5 answers)

```markdown
### UI review (`ui-review`, mode diff|audit, scope: <files or tab>)

**Scope and coverage**

| Area | Inspected | Result |
|---|---|---|
| Section 5 checklist | lines applied: … | n findings / Clear |
| Layout stability (runtime step) | controls clicked: n of m | n findings / Clear / Not verified (reason) |
| Taste (layer 3, `docs/design-taste.md`) | points checked: 1 to 5 | n findings (Should-fix or Note) / Clear / Not reviewed (reason) |
| Focus and keyboard | … | n findings / Clear / Not reviewed (reason) |
| Targets, forms, states | … | … |
| Long and empty content | … | … |
| Numbers, icons, radii | … | … |

**Findings**

| Severity | Location | Contract | Evidence | Before | After |
|---|---|---|---|---|---|
| Blocker | `web/src/views/X.tsx:42` | 3.5.4 border budget | 3 inner rules in `.card` | … | … |
| Note | `web/src/views/Y.css:10` | taste 2 | `.tag` text on `--faint`, 5.8:1 | `color: var(--faint)` | `color: var(--muted)` |

**Conflicts seen** (not applied, for the SUPERVISOR)

| Vendored rule or taste point | Design language | Where it would have hit |
|---|---|---|

**Considered but rejected**

| Location | Candidate | Rejected because |
|---|---|---|

**Verification**: the commands and interactions run, with what was observed. A check not run is **Not verified** + what remains.

**Verdict**: Block (a Blocker remains) · Needs changes (only Should-fix or Note remain) · Approve (nothing actionable). Taste findings alone never give Block. List every Not verified item beside the verdict.
```

When there are no findings, omit the findings table, write "No actionable findings", and keep Verification, Considered but rejected and Verdict.

## After the review

- Fix every Blocker, or write it in the report as `BLOCKED` with the reason. Do not ship a Blocker silently.
- Should-fix and Note items (taste findings included) are fixed when cheap and otherwise stay in the block; the PR body keeps the block as written.
- A taste point that a FLIGHT cannot satisfy without breaking the design language is a conflict to list, not a reason to bend the screen.
- New candidate rules that are not in the design language (for example a hit-target size) are **not** added to it here. They are a SUPERVISOR decision.
