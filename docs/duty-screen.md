# DUTY screen: read, find and decide in one chat

Status (2026-10-03): design draft. The SUPERVISOR grilled and confirmed the decisions in section 7 and chose variant **b** (reading column). A throw-away prototype exists (commit `c9790f4` on a local branch, never pushed, not for merge); nothing here is built on `main`. Extends [duty.md](duty.md) section 4 (Screens).

## 1. Current facts

- **The DUTY chat lives only in the drawer** (`web/src/DutyDrawer.tsx`, `#duty`, about 440 px on the right, full screen on a phone). It shows the log, cards inline, an input, a stop button, the head line and NEW SHIFT ([duty.md](duty.md) section 4).
- **The log is already paged on the server.** `GET /api/duty/history?before=<line>` returns a page from the end of `duty.jsonl` and a `next` cursor (`server/duty-log.ts` `pageOf`). The drawer loads only the newest page.
- **Pains the SUPERVISOR named** (2026-10-03):
  1. Long answers are hard to read.
  2. Cards sink into the chat and scroll away.
  3. There is no way to find past talk or decisions.
  4. The input is weak.
  5. The look reads as "AI slop".
  6. No copy and input helpers.
- **Rail and routing.** The shell has five job screens (HOME, RELEASE, FLIGHTS, FLEET, METRICS; [layout.md](layout.md)). The SUPERVISOR QUEUE is on HOME (ATC-422).
- **Standing decisions and SHIFTs** already exist (`decisions.jsonl`, NEW SHIFT; duty.md D4). They are only visible by asking DUTY.
- **Injection rule** (duty.md section 6): text from outside atc is data. The screen may tell DUTY *where* the SUPERVISOR is looking, never *what the page says*.

## 2. Principles

1. **One chat component, two widths.** The drawer and the screen render the same log, composer and cards. Only the frame differs.
2. **Reading first.** Answers are text to read: body font, generous line height, a limited line length. Tool lines and card chrome take the least room.
3. **Decisions stay visible.** What waits for the SUPERVISOR is never further than one glance away, and what was decided stays findable.
4. **Nothing sends by itself.** Suggested replies, autocomplete and attached addresses only fill the input. The SUPERVISOR sends with Enter.
5. **Not an automated control.** The screen changes how things are shown; it takes no decision away from a person, so it has no on/off switch and no misfire counter.
6. **Instrument style, atc tokens.** Head line, panels and cards follow [design-language.md](design-language.md); colour and type come from `:root` tokens in `web/src/styles.css` only.

## 3. Design

### 3.1 Two places, one component

| Place | Address | What it is |
|---|---|---|
| **Screen** | `#duty/screen` | Entered from the drawer's "화면" button. It is a screen but not a rail entry: the rail stays five. Three columns |
| **Drawer** | `#duty` | Over any other tab, as today. Cards stay inline and small |

The component is split into a shared chat part (log, composer, NEW SHIFT, the context hook) and two frames (the screen and the drawer).

### 3.2 Screen layout (three columns, at 1000 px and wider)

- **Left: find.** A search box; the standing decisions with their `until`; a SHIFT list (start time, number of messages) that jumps to a divider. While a search is typed, results replace the two lists.
- **Centre: talk.** The chat in a reading column about 72ch wide (the same idea as the reading-column exception in design-language section 8). A head line (`DUTY · acct · context k/CAP`, state), NEW SHIFT, the log, the composer, always visible.
- **Right: decide.** The cards and drafts DUTY put up that still wait, newest first. Below them a link "할 일 n — HOME에서": the QUEUE is not on this screen.
- **Height.** The page does not scroll; only the log and the right panel do. The frame fills the space between the head line and the CONTROL panel with CSS layout, not by measuring.

### 3.3 Cards: chip in the chat, card in the panel

- A card that sits in the right panel leaves **one line** in the chat (kind, key, "→ 오른쪽 패널").
- When handled, the chip shows the **outcome and time**, and the card leaves the panel for the **decision log** (left column, under the standing decisions).
- A card the server no longer finds in the queue goes grey (as today) and is treated as handled with the outcome "gone".
- **Drawer mode.** Cards stay inline and small. A "결정 n" chip in the head line filters the chat to waiting cards. Search and the decision log are on the screen only; the drawer links to it.

### 3.4 Look: variant b

Chosen by the SUPERVISOR. Reading text in the body font, larger, with generous line height. No boxes around DUTY's answers. Only the SUPERVISOR's own message sits on a soft panel. Head line, panels and cards keep the instrument style. Variant a (a fixed who/when gutter with ruled rows) is dropped: in the 360 px drawer its gutter left the text about 220 px wide.

### 3.5 History

- One continuous log with SHIFT dividers.
- **Load older** when scrolling up, through the existing `?before=` cursor. The scroll position holds still when a page is prepended.
- A faint **UTC time** on every line (hover or focus gives the full date).
- **Search** over `duty.jsonl` through a new **read-only** API (section 5, U3), not over the loaded 200 lines. A hit opens its place in the log: the page around it is loaded and the line is scrolled to.

### 3.6 Tool lines

Tool lines fold **per turn** into one line, for example `도구 7 · 거절 2`. The running tool and the refused count stay visible even when folded. Tool inputs and outputs are still not shown (duty.md section 7).

### 3.7 Input and copy

- Copy a whole answer (as Markdown) and single blocks (a code block, a table).
- See the **queued messages** and cancel one before DUTY starts it.
- Auto-growing input; the draft is kept in the browser (per tab, cleared when sent).
- **Autocomplete** for `ATC-n`, `#PR` and REGISTRATION names (`TEAM_X`) from state atc already holds.
- **Attach what I am looking at**: a button adds the address and key of the current view (`#flight/ATC-n`, `#pr/ATCC/n`). **Address and key only, never page text** (injection rule, section 1).
- A ```` ```choices ```` block in a DUTY answer renders as buttons that **only fill the input**.

### 3.8 Answer shape (`duty/CLAUDE.md`, flagged tier)

- A **3-line conclusion first**; the rest folds under it.
- Long output (designs, big tables) goes as a **doc or PR link plus a summary**, not into the chat.
- Optional ```` ```choices ```` block at the end when the SUPERVISOR must pick.
- The screen folds by a pure rule (`leadOf`: first paragraph up to 3 lines, no cut inside a list, table or code block; short answers are not split), so a DUTY that ignores the shape still reads acceptably.
- `duty/CLAUDE.md` is a control-session manual, so this change is the `flagged` tier and the PR lists the changed control rule.

### 3.9 Narrow screens (860 px and below)

Rules only; built last. One column. The left column and the right panel become tabs above the chat ("대화 · 결정 n · 기록"). The composer stays at the bottom. The drawer already fills the screen on a phone and does not change.

### 3.10 What the prototype shortcuts become

| Prototype shortcut | Decision |
|---|---|
| The left column belongs to the screen, not the shell Sidebar | **Keep.** It is DUTY's own content; the shell Sidebar stays out of it |
| Search is client-side over the loaded lines | **Server search** (U3) |
| The frame height is re-measured every second | **CSS layout** (flex, dynamic viewport height); no timer |
| Variant a did not stick to the bottom after a resize | Variant a is dropped. b keeps the "stuck to bottom" state through resizes, and a test covers it |
| `?variant=` query switch | **Removed** in U1 (one look) |

## 4. Done when (measured on the same seeded history)

1. **More of each screenful is reading text** than in the drawer today (tool lines and card buttons excluded).
2. **Waiting cards are visible without scrolling.**
3. **One past decision is found by search within 10 seconds.**

**Effect metric (recorded only, no verdict):** the SUPERVISOR's share of messages sent to DUTY versus Claude desktop, two weeks after release.

The check uses a seeded test state (fake history, `schedule.json {"auto":"off"}`, no real sessions). Screens are described in words in PRs, never as screenshots (public repository).

## 5. Implementation order

Each step is one work order. U1 first; the rest are chained.

| # | Step | Output |
|---|---|---|
| U1 | Shared chat part and the `#duty/screen` shell (b only), the drawer on the same part, drawer buttons and chips on the kit `.btn` and chip (the DUTY part of ATC-431) | Same chat in two widths; pure `blocksOf`, `leadOf`, `choicesOf` with tests |
| U2 | Right panel, chat chips, the decision log, the "결정 n" chip | Waiting cards visible; handled ones leave an outcome |
| U3 | History: load older, UTC times, SHIFT dividers, read-only search API over `duty.jsonl` | Find a past decision |
| U4 | Input: copy answer and blocks, queued messages view and cancel, auto-grow, kept draft | Better input |
| U5 | Autocomplete (`ATC-n`, `#PR`, REGISTRATION) and attach the current address | Fewer typos |
| U6 | `duty/CLAUDE.md` answer shape and the `choices` block (flagged) | Shorter, foldable answers |
| U7 | 860 px and below | One column with tabs |

- U2 and U3 touch different files and could run side by side, but both touch the log component, so they are chained to avoid conflicts (`Sequence` in the work orders where it is only an order).
- U6 is independent of U2–U5 and uses the `choices` renderer from U1.

### U1 as built (ATC-477)

- **Shared part.** `web/src/DutyChat.tsx` holds `useDutyChat` (queue, decisions, charters, send, NEW SHIFT, pasted image, `fill`), `DutyLog`, `DutyComposer`, `NewShift` and `DutyGate`. `web/src/DutyDrawer.tsx` and `web/src/views/DutyScreen.tsx` are the two frames. Pure rules are in `server/duty-view.ts` (`blocksOf`, `leadOf`, `choicesOf`, `foldTools`, `shiftsOf`, `matchesQuery`, and the stick-to-bottom rules) with `server/duty-view.test.ts`.
- **Routing.** `#duty/screen` replaces the `main` area; the rail keeps five entries and `#duty` still opens the drawer. Choosing a rail screen leaves the DUTY screen; "닫기" returns to the screen that was under it.
- **Height.** While the screen is open the shell is `100dvh` and the centre column is a flex column; no timer, no measuring. A `ResizeObserver` only re-pins the log to the bottom when it was stuck, and a scroll event caused by a resize does not change the stuck state (`nextStick`).
- **Left column** filters the loaded lines (client side; server search is U3), lists the standing decisions, and lists the SHIFTs newest first; a click clears the search and jumps to the divider.
- **Right column** shows the cards and drafts that still wait (`waitingOf`, newest first) and the `QueueRow` link "할 일 n — HOME에서". Chips in the chat, the decision log and the "결정 n" chip are U2: here a waiting card still also shows inline in the log.
- **Answers.** `leadOf` shows the first paragraph (at most 3 lines; a longer first paragraph is cut at 3 lines, never inside a list, table or code block; an answer of 3 lines or fewer is not split) and folds the rest under "더 보기". A `choices` fence is removed from the text and drawn as chips only under the newest DUTY answer that no SUPERVISOR message follows; a click only fills the input.
- **Tool lines** fold per turn (consecutive tool lines) into `도구 7 · 거절 2`; the trailing group shows the running tool while DUTY is thinking; the folded line opens to the list of names and summaries.
- **Below 1000 px** (before U7): one column, the chat first, then the waiting cards, then the left column; the page scrolls. At 1279 px and below the shell sidebar is hidden while the screen is open, like it is for a drawer.
- **Kit.** The drawer's and cards' `dr-btn` became `.btn`; "더 보기" and the choices use `.chip`.

### U2 as built (ATC-478)

- **One rule, one file.** `server/duty-card-status.ts` decides "waiting", "handled" and the outcome for a card or draft (`statusOf`), the panel list (`waitingOf`, newest first, one entry per card key), the decision log (`decisionLog`, rebuilt from the chat items) and the chip text (`chipText`). The right panel, the chips, the log and the drawer's "결정 n" all call it, so they count the same cards. Tests: `server/duty-card-status.test.ts`.
- **States.** A queue card is waiting while the server's queue holds its `<kind>/<key>`; when the queue no longer holds it the card is handled with the outcome `gone` (grey, time unknown). A button pressed on this screen records outcome and time in the browser's memory (`승인`, `거절`, `동의`, `반대`, `업데이트 시작`, `손으로 전했음`; drafts `확정`, `버림`) and wins over the server's view. A draft is handled when confirmed (outcome `확정`, time from the decision's `at`), dismissed (`버림`) or past its `until` (`until 지남`). Until the queue or the decisions are read a card is neither waiting nor handled ("읽는 중").
- **Screen.** Cards in the chat are one-line chips (`DecisionChip`): waiting ones read `종류 키 → 오른쪽 패널` and scroll the panel to the card; handled ones show outcome and UTC time. The STANDING DECISIONS list card (`retire`) never waits, so it stays a full card. The left column gets a "결정 기록" list between the standing decisions and the SHIFTs; a row scrolls the chat to its chip.
- **Drawer.** Cards stay inline. A "결정 n" chip in the head line (`aria-pressed`) filters the chat to the waiting cards; n is `waitingOf(...).length`, the same call the screen's panel uses.
- **Not stored.** The decision log has no file. After a reload the in-session outcomes are gone: a card handled earlier shows as `gone` without a time, and confirmed drafts keep their outcome and time because the server holds them.

### U3 as built (ATC-479)

- **Search API.** `GET /api/duty/search?q=` reads `duty.jsonl` and writes nothing. `searchLog` (`server/duty-log.ts`, pure) matches a trimmed, case-insensitive substring of at least 2 characters in the text of `user` and `text` lines, in a draft's text and `DD-n`, and in a card's kind, key and `DD-n`. Broken lines and tool, notice, shift and usage lines are skipped. It returns `{ hits: [{ n, t, kind, snippet }], truncated }`, newest first, at most 50 hits (`truncated` says more exist); `n` is the 0-based line number that `/api/duty/history` also uses (the screen shows `n + 1`). The snippet is about 70 characters either side of the match with whitespace flattened. Tests: `server/duty-log.test.ts`, `server/duty-run.test.ts`.
- **Origin rule.** `/api/duty/history` has no Origin check (a plain GET), so search has none either, except one step stricter: a request that carries a non-localhost `Origin` is answered 403. A query is capped at 200 characters. History gained `limit=1..5000` (default 200) so a jump can read many lines in one request.
- **One continuous log.** `useDuty` keeps the first 200 lines and the `next` cursor of that read (`Chat.older`). `useOlder` (`web/src/dutyOlder.ts`) prepends earlier pages (`before=`) as items with ids `h<line>`; every item read from the log carries its line number `n` (`data-n` on its row). A reconnect that moves the cursor drops the prepended pages and starts again. Reaching the top of the log (within 120 px) or pressing "이전 대화 더 불러오기" loads one page. `overflow-anchor` is off on the log, and the log adds the height difference to `scrollTop` after a prepend, so the line being read stays put.
- **UTC times.** Every line (SUPERVISOR, DUTY, notices, SHIFT dividers, card and draft chips on the screen) shows `HH:MMZ`; hover or keyboard focus (`tabIndex 0`) shows `YYYY-MM-DD HH:MM:SSZ`. The drawer keeps its cards inline and gets the times on the lines that had none.
- **Search on the screen.** While the box holds 2 or more characters, "찾은 줄" replaces the standing decisions, decision log and SHIFT list (250 ms after typing stops). A hit is a button with kind, UTC time, line number and snippet. Pressing it loads pages up to 20 lines before the hit (reading from the loaded start down in one request, repeated if the server caps it), scrolls the line to the middle and outlines it for 2 s. The search text stays so another hit is one click away.
- **Checked.** 7702 test server with a seeded `duty.jsonl` of 1,200 lines (one broken line, SHIFTs, one decision about "Musixmatch"): older page prepended with the probe line moving 0 px; search "musixmatch" → click → line outlined and in view in about 0.5 s; log continuous from the hit to the end.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Search over `duty.jsonl` reads private talk | The API is read-only, same Origin rule as `/api/duty/history`, and returns snippets from the SUPERVISOR's own log. The state folder never goes into the repo |
| Attaching the current view leaks page text into DUTY | Only the address and key are attached (injection rule); a test pins the shape |
| Autocomplete or `choices` sends something unintended | They only fill the input. The SUPERVISOR sends with Enter |
| The chip and panel hide a decision | The chip stays in the chat until handled, the "결정 n" chip counts the same cards, and the decision log keeps the outcome |
| The screen becomes a second HOME | The QUEUE is not on the screen (ATC-422); only a link back |
| A long answer folds the part that mattered | The fold is a click away; the rule never cuts inside a table, list or code block |

## 7. Decisions

Decided by the SUPERVISOR (2026-10-03):

1. Scope: the DUTY drawer and how DUTY shapes its answers. HOME's queue and ANNUNCIATOR are out.
2. One chat component in two widths: `#duty/screen` (from the drawer's "화면" button; the rail stays five) and the `#duty` drawer.
3. Screen: three columns (find / talk / decide). QUEUE is not on the screen (link to HOME).
4. Cards: chip in the chat and card in the right panel; handled cards move to the decision log. The drawer keeps cards inline and small, with a "결정 n" filter chip.
5. At 860 px and below: one column, sidebar and panel as tabs (rules only in this document).
6. History: one continuous log, SHIFT dividers, load older, UTC times, server search.
7. Tool lines fold per turn.
8. Input and copy as in 3.7. `choices` only fills the input.
9. Answer shape as in 3.8 (flagged tier).
10. Look: variant **b**, `:root` tokens only.
11. No on/off switch (not an automated control).
12. Priority Medium. U1 Todo, the rest Backlog chained by `blockedBy`. ATC-431's DUTY part is folded into U1; ATC-431 keeps FLIGHT, PR and IDEAS.

Decided by this draft (pilot's discretion, reversible): the shortcut table in 3.10; "gone" cards count as handled; the decision log is held in the browser's view of the chat, rebuilt from the log, not a new file.
