# DESK: talk to atc and decide in the same window

Status (2026-09-30): design draft for [ATC-192](https://linear.app/vocado/issue/ATC-192/desk-chat-with-atc-and-decide-in-the-same-window-design-and-phases), from the idea [chaehy5665/atc#271](https://github.com/chaehy5665/atc/issues/271). The SUPERVISOR decided to go ahead. Nothing is built. The open decisions are in section 7. "DESK" is a working name.

## 1. Current facts

**Where the SUPERVISOR talks and where they decide** (2026-09-30):

| Place | What happens there |
|---|---|
| Claude desktop: ENGINEERING or a user session | Design, Linear issues, sometimes direct work |
| Claude desktop: the OCC session | CHARTER DESK. A request becomes an AD HOC FLIGHT draft (`occ/CLAUDE.md` 4) |
| Claude desktop: a blocked background session | NEEDS YOU (ATC-99). A permission prompt can only be answered in that session |
| The atc tab | Every decision: DISPATCH and SCHEDULE verdicts, FLEET PLAN, HUMAN CHECK, `user`-tier merges, UPDATE, ⚠ switches. All writes check the Origin (`server/origin.ts` `fromThisApp`) |

- **Pain points the SUPERVISOR named.**
  1. They type a request in one app and then approve in another.
  2. Too many windows.
  3. Memory. Long sessions compact and lose detail, and a new session knows nothing of earlier decisions. Also, Claude Code memory lives under the config folder (`<configDir>/projects/<cwd>/memory`), so every ACCOUNT has its own. `~/.claude-acct-1`'s atc memory is empty. That split is [ATC-191](https://linear.app/vocado/issue/ATC-191/accounts-one-claude-code-memory-across-account-folders-sessions-on).
- **The decision list is designed but not built.** SUPERVISOR QUEUE, [ui-visibility.md](ui-visibility.md) 3.1, is one list of what waits on the SUPERVISOR. It is built by a pure `supervisorQueueOf` behind `GET /api/supervisor/queue`. That document is a draft, not adopted, and no step of it is built.
- **The screen never sends free text to a session.** RADIO is read only ([radio.md](radio.md) principle 1). Session-to-session traffic goes through guarded templates: OCC's `send-guard` swaps a head line for the stored FLIGHT PLAN, and CLEARANCEs are built by the server.
- **The server already runs `claude` itself.**
  - `claude auth login` with piped stdin (ATC-187, `server/account-login.ts`).
  - `claude --bg` for LAUNCH (`server/session-control.ts`).
  - Both use `cleanEnv(configDir)`, so the ACCOUNT is chosen per process.
- **Headless conversation is supported** by the installed Claude Code (2.1.285, `claude --help`):
  - `-p` with `--input-format stream-json --output-format stream-json` keeps one process for many turns. `--include-partial-messages` streams text as it is written.
  - `--session-id <uuid>` and `--resume <id>` continue a conversation after a restart.
  - `--settings`, `--permission-mode`, `--allowedTools` / `--disallowedTools`, `--append-system-prompt` and `--strict-mcp-config` fix what the session may do.
  - In `-p` there is nobody to answer a permission prompt: a tool that is not allowed fails instead of waiting.
- **The control-session pattern exists.** Each control session has its own folder (`controller/`, `occ/`, `mcc/`) with:
  - a Korean `CLAUDE.md`;
  - `.claude/settings.json` that denies `Edit`/`Write` and allows only `atcctl` and read commands;
  - fail-closed guard hooks (`… || exit 2`);
  - a `UserPromptSubmit` hook (SQUELCH).
- **ANNUNCIATOR** (the Mac menu bar app, [mac-app.md](mac-app.md)) already reads `/api/events` (`summary`, alerts) from the SUPERVISOR's Mac through an ssh forward.

## 2. Principles

1. **One window for talk and decisions.** The SUPERVISOR types in the atc tab and decides in the same place. They should not need Claude desktop for day-to-day operations.
2. **DESK talks; the SUPERVISOR decides.** DESK can read, explain and draft, and it can put a decision card in front of the SUPERVISOR. It can never approve, reject, merge, flip a switch or order a session. Card buttons are atc UI calling the existing endpoints with the existing Origin check. atcctl gets no approve command, as for every control session.
3. **Narrow tools, fail-closed.** DESK is a control session like OCC: its own folder, `Edit`/`Write` denied, only `atcctl desk …` and read commands allowed, and a guard that exits 2 on anything else. Being the SUPERVISOR's chat is not a reason to give it more.
4. **Route, don't do.**
   - A request becomes a CHARTER REQUEST for OCC (the existing CHARTER DESK flow and its SCHEDULE drafts) or a note for ENGINEERING.
   - Work that needs code context stays with a team or a working session.
   - DESK sends no `SendMessage` of its own.
5. **Memory is state, not recall.** Each turn, DESK starts from what atc knows: the queue, FLEET, alerts, FLIGHTs, and the SUPERVISOR's standing decisions. It does not rely on remembering them. Standing decisions go into one atc-owned log that is the same whatever ACCOUNT or process runs DESK.
6. **Shadow first.** DESK's routing starts as drafts that the SUPERVISOR confirms on the card. Automatic hand-off to OCC waits for a measured shadow period, like MCC and REPOSITION.
7. **Language.** DESK writes Korean to the SUPERVISOR. Anything it hands to other sessions (a CHARTER REQUEST) is English (ATC-126). Its text is never read aloud: voice stays template-only (ATC-140).

## 3. The model

**DESK session.** One conversation at a time, owned by the atc server.

- **Folder `desk/`:**
  - `CLAUDE.md`, Korean original plus `CLAUDE.en.md`;
  - `.claude/settings.json`: deny `Edit`, `Write`, `NotebookEdit`, `Agent`, `SendMessage`, `WebFetch`; allow `node ../controller/atcctl.mjs desk *` and `jq`;
  - `guard.mjs`, fail-closed;
  - `brief-hook.mjs`, a `UserPromptSubmit` hook (section 3.3).
- **Process.**
  - The command is `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --session-id <id>`, run with cwd `desk/` and env `cleanEnv(<ACCOUNT dir>)`.
  - It is spawned on the first message and kept while messages keep coming. It exits after `desk.idleMin` (default 30) without input.
  - The next message resumes the conversation with `--resume <id>`.
  - At most one process runs. A new conversation (a **NEW DESK** button, or CONTROL RECYCLE at its CAP) starts a fresh `<id>`.
- **ACCOUNT.** The process runs on the ACCOUNT the SUPERVISOR picks, `desk.account` in `fleet.json` `control`, like the other control sessions. FUEL sees it like any session.

### 3.1 Transcript and events

- The server parses the stream-json lines into DESK events: `user`, `text` (partial and final), `tool` (name and a one-line summary only), `card` and `state` (`idle` · `thinking` · `down`).
- It appends the user text and the final assistant text to `desk.jsonl` in the state folder, append-only, private, never in the repository.
- The browser gets the events on `/api/events` topic `desk` (opt-in, ATC-153). `GET /api/desk/history?before=` pages the log.
- Tool inputs and outputs are not shown on the screen and not logged, beyond the tool name. The Claude Code transcript under the ACCOUNT folder is the full record.

### 3.2 Cards

- DESK asks for a card with `atcctl desk card <kind> <key>`.
- The server accepts it only if `<kind>/<key>` is in the current SUPERVISOR QUEUE (`supervisorQueueOf`, the same function the queue uses). Otherwise it refuses with a reason, and DESK tells the SUPERVISOR in text.
- A card is the queue row: kind, key, since, title in atc terms. The chat renders it live, and it greys out when the row leaves the queue.
- Buttons, by kind (decision 7.3 sets the list):
  - **Inline**, where the decision needs no more evidence than the card holds: FLEET PLAN approve or reject, UPDATE, GO (the SUPERVISOR's go for a waiting CAPTAIN).
  - **Link**, where the evidence is on another screen (ui-visibility principle 4): DISPATCH and SCHEDULE verdicts, HUMAN CHECK, LANDING. The link opens that screen at the item. Judging still happens there.
  - NEEDS YOU links to the AIRCRAFT. The prompt itself is answered in that session.

### 3.3 Brief (memory)

- The `UserPromptSubmit` hook runs `atcctl desk brief` and adds its output to the turn. It is fail-open: without a brief the turn still runs, and the brief says so.
- The brief holds:
  - the queue (counts plus the oldest rows);
  - actionable alerts;
  - FLEET in one line per AIRCRAFT (state, FLIGHT, ACCOUNT, FUEL);
  - FLIGHTs in progress;
  - the last `desk.briefDecisions` (default 20) standing decisions.
- **Standing decisions.** When the SUPERVISOR states a rule ("reject acct-1 proposals until 10-03 03:00Z", "UI work goes through DISPATCH"), DESK proposes `atcctl desk note -- '<rule>' [--until <iso>]`. The server shows it as a card. Only the SUPERVISOR's confirm click writes it to `decisions.jsonl` (append-only; `note`, `retire`).
- **Size.** The brief is capped by `desk.briefMaxChars`, default 6,000 characters. It carries atc's own terms, not ticket bodies.

### 3.4 Routing

- `atcctl desk charter -- '<English request>'` records a CHARTER REQUEST draft and shows it as a card.
- On the SUPERVISOR's confirm, the server queues it for OCC. OCC's next tick reads it through `schedule brief` (a new `desk` source) and handles it as a CHARTER REQUEST. OCC is unchanged apart from reading one more source.
- No `SendMessage` is involved.
- In shadow (the default), a confirmed request is queued but OCC only sees it when `desk.charter` is `on` (decision 7.5). Until then the card says "queued (shadow)".

## 4. Screens

- **DESK drawer.**
  - Opened by a `DESK` readout in the header (its dot shows the state) or by the address `#desk`, over any tab.
  - About 440 px wide on the right. On a phone it fills the screen.
  - It shows the chat log, the cards inline, an input (Enter sends, Shift+Enter adds a line) and a stop button while DESK is thinking.
  - The head line shows `DESK · <ACCOUNT> · context <k>/<CAP>k` and **NEW DESK**.
- **The queue in the drawer.** Above the chat, a folded `QUEUE nn` row lists what waits even when DESK has not mentioned it. It is the same data as the ui-visibility drawer, so it replaces that drawer (decision 7.4).
- **ANNUNCIATOR (later).** The Mac app gets a DESK window: the same events, sending with the same Origin rules through the forward. It is a separate atc-app issue.

## 5. Implementation order

Each step is one issue. It is shadow or read-only until the step that says otherwise.

| # | Step | Output |
|---|---|---|
| D0 | **Probe** (SURVEY). Headless `claude -p` stream-json with a `desk/`-style settings file on a scratch folder. Measure: start time and RSS; many turns in one process; `--resume` after kill; what a denied tool looks like in the stream; whether a `UserPromptSubmit` hook's output reaches the turn in `-p`; partial-message shape; cost per idle turn | Findings in this document, "D0 as probed" |
| Q1 | SUPERVISOR QUEUE data: `supervisorQueueOf` and `GET /api/supervisor/queue` with tests for every kind ([ui-visibility.md](ui-visibility.md) step 2, adopted here) | `server/supervisor-queue.ts`, read-only API |
| D1 | DESK folder and CLI, no UI: `desk/CLAUDE.md`, settings, fail-closed guard, `atcctl desk brief`, `desk card` and `desk note` (drafts only), `desk charter` (draft only) | Guard and CLI tests. `user` tier: control-session settings and guard |
| D2 | Server runtime and chat: spawn and resume, the stream-json parser (pure) → events, `desk.jsonl`, `POST /api/desk/message` (Origin), `/api/events` topic `desk`, the drawer with text only | Chat works; cards show as plain text |
| D3 | Cards: server validation against the queue, the card component, inline buttons for the list in decision 7.3, links for the rest; the folded QUEUE row | Decide in the chat |
| D4 | Memory: `brief-hook.mjs`, `decisions.jsonl`, confirm and retire cards; the brief cap | Standing decisions survive a NEW DESK |
| D5 | Routing on: OCC reads the `desk` source; the `desk.charter` switch in settings (AUTOMATION → OPERATIONS) | CHARTER REQUESTs without Claude desktop |
| D6 | ANNUNCIATOR DESK window (atc-app repo) | Mac window |

Q1 can run beside D0. D1 needs D0's answers on hooks and denied tools. D3 needs Q1.

## 6. Risks

| Risk | Mitigation |
|---|---|
| DESK becomes a do-everything session | Principle 3; step D1 is `user` tier, and every change to its settings or guard is too; `settings.test.mjs` pins the allow and deny lists as for OCC |
| The model approves something | No approve command in atcctl; the guard blocks `curl` and `gh` writes; buttons are atc UI with the Origin check; step D3 tests that a card cannot be created for an item that is not in the queue |
| Prompt injection from data (ticket titles, PR text in the brief) | The brief carries atc terms, keys and counts, not bodies; cards come only from the queue; DESK's tools cannot write anywhere but drafts |
| Relay loss and delay | DESK routes, it does not do; links open the real screen; a request that needs code context is sent on with the SUPERVISOR's words quoted |
| Cost and context growth | Idle exit; `--resume` instead of a warm process; CONTROL RECYCLE CAP; FUEL counts it on its ACCOUNT |
| DESK down | The screen, the queue and every other session keep working. The drawer shows `down` and the error line; the next message restarts it |
| A private conversation on a public repository | `desk.jsonl` and `decisions.jsonl` live in the state folder, never in the repo; PRs describe screens in words (no screenshots) |
| Two browser tabs typing at once | One process and one input queue; the second sender sees "DESK is answering"; the log shows both in order |

## 7. Decisions

Open, for the SUPERVISOR:

1. **Name.** DESK (proposed), DUTY, or another.
2. **Model and ACCOUNT.** Sonnet (proposed: a chat does not need Opus, and it saves FUEL) or Opus; and which ACCOUNT runs it.
3. **Inline buttons.** FLEET PLAN, UPDATE and GO inline (proposed); DISPATCH, SCHEDULE, HUMAN CHECK and LANDING as links. Or more kinds inline.
4. **Queue placement.** The queue lives in the DESK drawer (proposed), and the separate ui-visibility drawer (its step 3) is dropped. Or both.
5. **Routing.** CHARTER REQUESTs from DESK reach OCC only with `desk.charter` `on` after a shadow period (proposed), or on at once.
6. **Claude desktop.** After D5, day-to-day requests go through DESK. ENGINEERING and working sessions stay in Claude desktop for design and code (proposed), or ENGINEERING also moves into DESK later.

Decided by this draft (pilot's discretion, reversible):

- DESK never sends `SendMessage`.
- Its text is never spoken.
- Tool inputs and outputs are not shown on the screen.
- One conversation at a time.
- Approving inside Claude desktop (an atc widget in the desktop chat) is out: the desktop cannot pass atc's localhost Origin check, and the design would push toward the model calling approval APIs.
