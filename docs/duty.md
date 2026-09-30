# DUTY: talk to atc and decide in the same window

Status (2026-09-30): design draft for [ATC-192](https://linear.app/vocado/issue/ATC-192/desk-chat-with-atc-and-decide-in-the-same-window-design-and-phases), from the idea [chaehy5665/atc#271](https://github.com/chaehy5665/atc/issues/271). The SUPERVISOR decided to go ahead, chose the name DUTY and the permission level (section 7). Nothing is built. The first draft called it DESK (`docs/desk.md`, [#273](https://github.com/chaehy5665/atc/pull/273)); this file replaces it.

**DUTY** is the airline's Duty Manager: the one person in the OCC whom management calls. The Duty Manager holds the overview and passes work to dispatch, crew control and maintenance control. In atc, DUTY is the SUPERVISOR's single window: it talks, writes designs and work orders (it takes over ENGINEERING), and routes the rest. Unlike a real Duty Manager, it decides nothing. The SUPERVISOR decides on DUTY's cards.

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
  3. Memory. Long sessions compact and lose detail, and a new session knows nothing of earlier decisions. Also, Claude Code memory lives under the config folder (`<configDir>/projects/<cwd>/memory`), so every ACCOUNT has its own, and `~/.claude-acct-1`'s atc memory is empty. That split is [ATC-191](https://linear.app/vocado/issue/ATC-191/accounts-one-claude-code-memory-across-account-folders-sessions-on).
- **The decision list is designed but not built.** SUPERVISOR QUEUE ([ui-visibility.md](ui-visibility.md) 3.1) is one list of what waits on the SUPERVISOR, built by a pure `supervisorQueueOf` behind `GET /api/supervisor/queue`. Its data step is Q1 here ([ATC-194](https://linear.app/vocado/issue/ATC-194/desk-q1-supervisor-queue-data-supervisorqueueof-and-get)).
- **The screen never sends free text to a session.** RADIO is read only ([radio.md](radio.md) principle 1). Session-to-session traffic goes through guarded templates: OCC's `send-guard` swaps a head line for the stored FLIGHT PLAN, and CLEARANCEs are built by the server.
- **The server already runs `claude` itself.**
  - `claude auth login` with piped stdin (ATC-187, `server/account-login.ts`).
  - `claude --bg` for LAUNCH (`server/session-control.ts`).
  - Both use `cleanEnv(configDir)`, so the ACCOUNT is chosen per process.
- **Headless conversation is supported** by the installed Claude Code (2.1.285, `claude --help`):
  - `-p` with `--input-format stream-json --output-format stream-json` keeps one process for many turns, and `--include-partial-messages` streams text as it is written.
  - `--session-id <uuid>` and `--resume <id>` continue a conversation after a restart.
  - `--settings`, `--permission-mode`, `--allowedTools` / `--disallowedTools`, `--append-system-prompt` and `--strict-mcp-config` fix what the session may do.
  - **In `-p` nobody answers a permission prompt.** Whatever is allowed runs without the SUPERVISOR seeing it, and anything else fails. The allow list and the guard are the only check. The step D0 probe ([ATC-193](https://linear.app/vocado/issue/ATC-193/desk-d0-probe-headless-claude-p-stream-json-with-a-desk-style-settings)) measures this.
- **The control-session pattern exists.** Each control session has its own folder (`controller/`, `occ/`, `mcc/`) with:
  - a Korean `CLAUDE.md`;
  - `.claude/settings.json` that denies `Edit`/`Write` and allows only `atcctl` and read commands;
  - fail-closed guard hooks (`… || exit 2`);
  - a `UserPromptSubmit` hook (SQUELCH).
- **ENGINEERING today** is a working session opened in Claude desktop at the repository root. It writes design docs and Linear issues, and it doesn't merge, deploy or message teams (root `CLAUDE.md` "ENGINEERING", [naming.md](naming.md) "Working sessions").
- **ANNUNCIATOR** (the Mac menu bar app, [mac-app.md](mac-app.md)) already reads `/api/events` (`summary`, alerts) from the SUPERVISOR's Mac through an ssh forward.

## 2. Principles

1. **One window.** The SUPERVISOR talks, reads and decides in the atc tab. For everyday work they don't need Claude desktop. A terminal or Claude desktop stays only as break-glass for when atc itself is down.
2. **DUTY talks and works; the SUPERVISOR decides.**
   - DUTY can read, explain, draft, write designs and work orders, and put a decision card in front of the SUPERVISOR.
   - It can never approve, reject, judge, merge, deploy, flip a switch, or order a session.
   - Card buttons are atc UI calling the existing endpoints with the existing Origin check, and atcctl gets no approve command.
3. **ENGINEERING powers, no more (level L1, section 3.5).**
   - DUTY holds exactly what ENGINEERING holds today: edit files in its own worktree, write Linear, open a PR.
   - It gets no merge, no deploy, no `systemctl`, and no messages to teams.
   - It starts at L0 (read and drafts) and opens L1 in its own step, after L0 has run. Every change to its settings or guard is `user` tier.
4. **Heavy work goes to a working session.**
   - Code that needs a build-and-look loop goes to a working session that the SUPERVISOR LAUNCHes from a DUTY card. DUTY watches it and reports back as cards, and keeps talking meanwhile.
   - Operations requests go to OCC as CHARTER REQUESTs.
   - DUTY builds nothing in its own conversation.
5. **Memory is state, not recall.**
   - Each turn, DUTY starts from what atc knows: the queue, FLEET, alerts, FLIGHTs, and the SUPERVISOR's standing decisions.
   - Standing decisions go into one atc-owned log that is the same whatever ACCOUNT or process runs DUTY.
   - Claude Code memory is shared across ACCOUNTs by ATC-191.
6. **Shadow first.** Routing to OCC starts as confirmed drafts that OCC does not yet read. It is switched on after a measured shadow period, like MCC and REPOSITION.
7. **Language.**
   - DUTY writes Korean to the SUPERVISOR.
   - What it hands to other sessions (a CHARTER REQUEST, a work order, a brief for a working session) is English (ATC-126).
   - Its text is never read aloud; voice stays template-only (ATC-140).

## 3. The model

**DUTY session.** One conversation at a time, owned by the atc server.

- **Folder `duty/`:**
  - `CLAUDE.md` (Korean original) plus `CLAUDE.en.md`;
  - `.claude/settings.json`: model `claude-sonnet-5-5` and the permission level (3.5);
  - `guard.mjs`, fail-closed;
  - `brief-hook.mjs`, a `UserPromptSubmit` hook (3.3).
- **Process.**
  - The command is `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --session-id <id>`, with cwd `duty/` and env `cleanEnv(<ACCOUNT dir>)`.
  - It is spawned on the first message and exits after `duty.idleMin` (default 30) without input. The next message resumes with `--resume <id>`.
  - At most one process runs. A **NEW SHIFT** button, or CONTROL RECYCLE at its CAP, starts a fresh `<id>`. The brief and the decision log carry over; the conversation does not.
- **ACCOUNT.** `acct-2` (section 7), labelled in `fleet.json` `control` like the other control sessions. FUEL counts it like any session.

### 3.1 Transcript and events

- The server parses the stream-json lines into DUTY events: `user`, `text` (partial and final), `tool` (name and a one-line summary only), `card` and `state` (`idle` · `thinking` · `down`).
- The user text and the final assistant text go to `duty.jsonl` in the state folder: append-only, private, never in the repository.
- The browser gets the events on `/api/events` topic `duty` (opt-in, ATC-153). `GET /api/duty/history?before=` pages the log.
- Tool inputs and outputs are not shown on the screen and not logged beyond the tool name and a summary line. The Claude Code transcript under the ACCOUNT folder is the full record.
- Images: the drawer accepts a pasted image (a screenshot). The server saves it in the state folder and passes it to the turn as an image block.

### 3.2 Cards

- DUTY asks for a card with `atcctl duty card <kind> <key>`.
- For a decision, the server accepts it only if `<kind>/<key>` is in the current SUPERVISOR QUEUE (`supervisorQueueOf`). Otherwise it refuses with a reason, and DUTY says so in text.
- A card is the queue row: kind, key, since, title in atc terms. The chat renders it live, and it greys out when the row leaves the queue.
- Buttons, by kind (section 7):
  - **Inline**, where the decision needs no more evidence than the card holds: FLEET PLAN approve or reject, UPDATE, GO (the SUPERVISOR's go for a waiting CAPTAIN).
  - **Link**, where the evidence is on another screen (ui-visibility principle 4): DISPATCH and SCHEDULE verdicts, HUMAN CHECK, LANDING. The link opens that screen at the item, and judging still happens there.
  - NEEDS YOU links to the AIRCRAFT, unless D0 finds a way to answer a blocked job's prompt from atc.
- DUTY's own cards, confirmed by the SUPERVISOR's click:
  - a standing decision (3.3);
  - a CHARTER REQUEST (3.4);
  - a working-session LAUNCH (3.4);
  - a PR it opened, shown with its tier.

### 3.3 Brief (memory)

- The `UserPromptSubmit` hook runs `atcctl duty brief` and adds its output to the turn. It is fail-open: without a brief the turn still runs, and the brief says so.
- The brief holds:
  - the queue (counts and the oldest rows);
  - actionable alerts;
  - FLEET in one line per AIRCRAFT (state, FLIGHT, ACCOUNT, FUEL);
  - FLIGHTs in progress;
  - DUTY's open PRs and working sessions;
  - the last `duty.briefDecisions` (default 20) standing decisions.
- **Standing decisions.**
  - When the SUPERVISOR states a rule ("reject acct-1 proposals until 10-03 03:00Z", "UI work goes through DISPATCH"), DUTY proposes `atcctl duty note -- '<rule>' [--until <iso>]`.
  - The SUPERVISOR's confirm click writes it to `decisions.jsonl` (append-only; `note`, `retire`).
- **Size.** The brief is capped by `duty.briefMaxChars` (default 6,000 characters). It carries atc's own terms and counts, not ticket bodies.

### 3.4 Routing

- **Operations request → OCC.**
  - `atcctl duty charter -- '<English request>'` records a CHARTER REQUEST draft as a card.
  - On confirm, the server queues it. OCC reads it through `schedule brief` (a new `duty` source) and handles it as a CHARTER REQUEST.
  - OCC reads the source only when `duty.charter` is `on`; until then the card says "queued (shadow)". No `SendMessage` is involved.
- **Design and work orders.** With L1, DUTY does these itself:
  - write the design doc in its own worktree and open a docs PR (MCC lands `auto` docs as today);
  - write the Linear issue in Todo, so DISPATCH assigns it (the flow in root `CLAUDE.md`).
- **Code work.**
  - `atcctl duty work <ATC-n> -- '<brief>'` proposes a working-session LAUNCH card: STAND name, ACCOUNT, brief.
  - On the SUPERVISOR's click, atc LAUNCHes it like an AIRCRAFT with a `BRIEF: DIRECT` work order.
  - The session reports ARRIVED to DUTY through atc, as a card, not to Claude desktop.
  - The rule that in-session building happens only when the SUPERVISOR says so still holds. This is the "here" path, run in its own session.

### 3.5 Permission levels

| Level | DUTY may | Status |
|---|---|---|
| L0 | Read atc state (`atcctl duty brief`, read commands), write drafts and cards through `atcctl duty …` | First (D1) |
| **L1** | L0, plus: `Edit`/`Write` only under its own worktrees (`.claude/worktrees/duty-*`); `git` in those worktrees, including push of its own `claude/duty-*` branches; `gh pr create` and `gh pr view`; Linear create, update and comment (MCP) | **Chosen** (D7), after L0 has run |
| L2 | Code, tests and test servers in its own conversation | Not given. Code work goes to a working session (3.4) |
| L3 | Approve, judge, merge, deploy, switch modes | **Never.** Card buttons only |
| L4 | Messages to team sessions | **Never.** DISPATCH, OCC and TOWER own that traffic |

The guard enforces L1 by path and command, fail-closed, like `controller/guard.mjs`:

- no `gh pr merge`, `gh api` writes, `systemctl`, `curl`, `kill`, `pkill`;
- no writes outside its worktrees;
- no `SendMessage`;
- no `.env*`, `.credentials.json` or `~/.local/state/atc` writes.

`settings.test.mjs` pins the allow and deny lists.

### 3.6 Linear and GitHub inside atc

The SUPERVISOR opens Linear and GitHub for a few reasons. Each reason gets a home in atc, or is left out on purpose.

**Current facts:**

- **Reading.** atc polls both services. Linear gives issues, states, labels and relations (`server/sources/linear.ts`), and `fetchIssueDetail` already reads an issue's description and 20 comments, read-only, for briefings, landing review and MCC. GitHub gives PRs, CI, reviews and comments through `gh` (`server/sources/github.ts`). No screen shows an issue body or a PR description.
- **Writing.**
  - The server never writes Linear. SCHEDULE S2 builds the call inputs, and OCC runs them through MCP.
  - The server writes GitHub in two places, both exact-head: AUTOLAND (`update-branch`, delegated merges) and MCC landings.

| Why the SUPERVISOR goes there | Home in atc | Kind |
|---|---|---|
| Read an issue: body, state, labels, blockers, comments, linked PRs | **FLIGHT drawer**: opened from any FLIGHT key on any screen, address `#flight/<KEY>`. It uses `fetchIssueDetail`, fetched on open and cached for a short time | Read |
| Read a PR: description, checks, MCC INSPECTION, changed files and tier | **PR drawer**, address `#pr/<airport>/<n>`. It uses the polled PR data plus one `gh` call on open | Read |
| Merge a `user`-tier PR | **MERGE** button on the QUEUE LANDING card and in the PR drawer | SUPERVISOR write |
| Move an issue (Backlog → Todo when its blockers are done) | A **state** button in the FLIGHT drawer, and a QUEUE row **READY** ("all blockers done, move to Todo?") | SUPERVISOR write |
| Write issues, designs and work orders | DUTY at L1 (3.5) | DUTY |
| Browse and adopt `idea` issues | **IDEAS** list, read. An **ADOPT** card asks DUTY to write the design draft | Read, then DUTY |
| Line-by-line diff review, long editing, notifications settings | **Left out.** Links open GitHub or Linear. These are the core of those products and not worth rebuilding | — |

**Write routes** (MERGE, the state button, READY):

- **Origin.** SUPERVISOR only: `fromThisApp`, like every settings write.
- **Exactness.** MERGE sends the head SHA it showed (`--match-head-commit`), is allowed only for a `user`-tier PR that is CLEARED, and never enables auto-merge.
- **The server writes.** Linear state changes go through the server with the existing API key. The browser never gets a token.
- **Recording.** Each write is one FLIGHT RECORDER line: who, what, before and after.
- **No model can call them.** atcctl has no such command, and the guards block `curl`. This is the same rule as L3 (3.5).
- **Tier.** Each route is its own issue with tier `user`, because it adds an outward write.

**Load.**

- Drawers fetch on open and cache for 60 s; nothing new is polled in the background.
- READY is computed from relations that atc already polls.
- 7700 is local-only, so there are no webhooks.

**Public repository.** The drawers show issue and PR text on the SUPERVISOR's screen only. PRs, docs and screenshots keep describing screens in words.

### G1 as built (ATC-206)

The FLIGHT drawer and the PR drawer, read only. No write route was added.

- **Address and shell.** `#flight/<KEY>` and `#pr/<AIRPORT code>/<number>` open a drawer over the current tab (about 560 px on the right, full screen under 600 px). The tab does not change. Esc, the backdrop, × and the browser's Back button close it. `drawerOfHash` (pure, `server/detail.ts`) reads the address. The drawer is a lazy chunk, so the Markdown renderer loads on first open.
- **Server.** `GET /api/flight/:key/detail` (Linear: body, state, priority, assignee, labels, blockers, parent and children, attached PRs, 20 comments) and `GET /api/pr/:airport/:number/detail` (`gh pr view`: body, checks by name, first 100 changed files, review decision, merge state). Both are in `server/detail-run.ts`; the shaping is pure (`server/detail.ts`) and tested. The keys and numbers are validated (`^[A-Z][A-Z0-9]*-\d{1,7}$`, a positive integer), and a PR is read only from an AIRPORT that atc has open (the code maps to its repository), so the route cannot be pointed at another repository.
- **Load.** Each call happens on open and is cached for 60 s (`makeCache`, errors are not cached). Nothing is polled in the background. The two calls live in the existing read-only source files (`sources/linear.ts` `fetchIssueDrawer`, `sources/github.ts` `fetchPrView`), so the landing tier list needed no change.
- **What atc adds to a PR.** For an open PR that atc polls, outside the cache: landing state (CLEARED or APPROACH) with the block lines, the tier (`deploy/landing-tier.mjs` over the changed files), and the MCC INSPECTION for that head on the MCC AIRPORT.
- **Markdown.** `server/safe-markdown.ts`: raw HTML is shown as text, images become links, and only `http(s)` links are made, opened in a new tab with `rel="noreferrer"`. Tokens stay on the server.
- **Openers.** A FLIGHT number opens the drawer from STRIPS (LANDING SEQUENCE), HUMAN CHECK, DISPATCH, FOLLOWING and FLEET. A PR number opens the PR drawer from STRIPS, and a small `↗` next to it opens GitHub. A number that already sits inside a Linear link keeps that link (no link inside a link); the drawer is still reachable from another row or by address.
- **Chosen without asking (PILOT'S DISCRETION).**
  - The address uses the AIRPORT code, as the plan said, and the airport must be open.
  - Linked PRs on the FLIGHT drawer are the GitHub links attached to the Linear issue, opened on GitHub, not in the PR drawer, because the PR's AIRPORT is not known from the link.
  - Comments are capped at 20 and body text at 20,000 characters (and 4,000 per comment), with a note when cut.
  - SCHEDULE and TICKETS numbers were not changed in this step (SCHEDULE has its own link component that goes to Linear).

## 4. Screens

- **DUTY drawer.**
  - Opened by a `DUTY` readout in the header (its dot shows the state) or by the address `#duty`, over any tab.
  - About 440 px wide on the right. On a phone it fills the screen.
  - It shows the chat log, cards inline, an input (Enter sends, Shift+Enter adds a line, paste an image) and a stop button while DUTY is thinking.
  - The head line shows `DUTY · acct-2 · context <k>/<CAP>k` and **NEW SHIFT**.
- **The queue in the drawer.** Above the chat, a folded `QUEUE nn` row lists what waits, even when DUTY has not mentioned it. It replaces ui-visibility's own drawer (section 7).
- **ANNUNCIATOR (later).** The Mac app gets a DUTY window: the same events, sending with the same Origin rules through the forward. That is a separate atc-app issue.

## 5. Implementation order

Each step is one issue. Everything is shadow or read-only until the step that says otherwise.

| # | Step | Output |
|---|---|---|
| D0 | **Probe** (SURVEY, [ATC-193](https://linear.app/vocado/issue/ATC-193/desk-d0-probe-headless-claude-p-stream-json-with-a-desk-style-settings)). Headless `claude -p` stream-json with a DUTY-style settings file on a scratch folder: start time and RSS, many turns, `--resume`, denied tools in the stream, the `UserPromptSubmit` hook in `-p`, partial messages, cost, and whether a blocked background job's prompt can be answered without its window | "D0 as probed" in this document |
| Q1 | SUPERVISOR QUEUE data ([ATC-194](https://linear.app/vocado/issue/ATC-194/desk-q1-supervisor-queue-data-supervisorqueueof-and-get), ui-visibility step 2) | `server/supervisor-queue.ts`, read-only API |
| D1 | DUTY folder and CLI at **L0**, no UI: `duty/CLAUDE.md`, settings, fail-closed guard, `atcctl duty brief`, `duty card`, `duty note`, `duty charter` (drafts only) | Guard and CLI tests. `user` tier |
| D2 | Server runtime and chat: spawn and resume, the stream-json parser (pure) → events, `duty.jsonl`, `POST /api/duty/message` (Origin), image paste, `/api/events` topic `duty`, the drawer with text only | Chat works; cards show as plain text |
| D3 | Cards: server validation against the queue, the card component, inline FLEET PLAN, UPDATE and GO, links for the rest, the folded QUEUE row | Decide in the chat |
| D4 | Memory: `brief-hook.mjs`, `decisions.jsonl`, confirm and retire cards, the brief cap | Standing decisions survive NEW SHIFT |
| D5 | Routing on: OCC reads the `duty` source; the `duty.charter` switch (settings, AUTOMATION → OPERATIONS) | Operations requests without Claude desktop |
| D6 | ANNUNCIATOR DUTY window (atc-app repo) | Mac window |
| G1 | FLIGHT drawer (`#flight/<KEY>`) and PR drawer (`#pr/<airport>/<n>`), read only, opened from FLIGHT keys and PR numbers everywhere; short cache | Reading without Linear or GitHub. Tier auto |
| G2 | MERGE for `user`-tier CLEARED PRs: exact head, Origin, FLIGHT RECORDER; on the PR drawer and the QUEUE LANDING card | Merging without GitHub. Tier user |
| G3 | Linear state button in the FLIGHT drawer, and the QUEUE row READY (blockers done → move to Todo?) | Releasing work without Linear. Tier user |
| G4 | IDEAS list (`idea` issues) and the ADOPT card that asks DUTY for a design draft | Ideas without GitHub. Needs D3 |
| D7 | **L1**: worktree, `gh pr create` and Linear in DUTY's settings and guard; root `CLAUDE.md` "ENGINEERING" moves to DUTY; [naming.md](naming.md) gets DUTY as a control session; `duty work` LAUNCH cards and ARRIVED reports as cards | Design, work orders and code hand-off without Claude desktop. `user` tier |

- Q1 can run beside D0.
- D1 needs D0's answers on hooks and denied tools.
- D3 needs Q1.
- G1 needs nothing and can start at once. G2 and G3 need the QUEUE (Q1, and ALERTING A4 for the popover) to show their cards, but their drawer buttons do not.
- D7 comes after D1–D4 have run, and uses ATC-191 so DUTY shares the memory on any ACCOUNT.

## 6. Risks

| Risk | Mitigation |
|---|---|
| **Headless means no prompt.** Whatever L1 allows runs unseen | The guard limits writes by path and commands by pattern, fail-closed. `settings.test.mjs` pins the lists. L1 opens only after L0 has run. Every change is `user` tier |
| DUTY becomes a do-everything session | L2–L4 are out by principle (3.5). Code goes to working sessions that the SUPERVISOR LAUNCHes |
| The model approves or merges something | No approve or merge command. The guard blocks `gh pr merge`, `gh api` writes and `curl`. Buttons are atc UI with the Origin check. D3 tests that a decision card needs a queue row. Its PRs land by tier like everyone's |
| Prompt injection from data (ticket titles, PR text, team reports) | The brief carries atc terms, keys and counts, not bodies. Cards come from the queue or from DUTY's own confirmed drafts. Writes are limited to its worktrees and Linear |
| Relay loss and delay | DUTY does design and work orders itself (L1). Working sessions get the SUPERVISOR's words quoted in the brief, and report back as cards |
| Cost and context growth | Idle exit, `--resume`, NEW SHIFT, CONTROL RECYCLE CAP, and FUEL on `acct-2`. Long design work runs in the same conversation, so the CAP is set per D0's measurements |
| DUTY down | The screen, the queue and every other session keep working. The drawer shows `down` with the error line, and the next message restarts it. Break-glass: terminal or Claude desktop |
| Private conversation on a public repository | `duty.jsonl`, `decisions.jsonl` and pasted images live in the state folder, never in the repo. PRs describe screens in words |
| Two browser tabs typing at once | One process, one input queue. The second sender sees "DUTY is answering", and the log shows both in order |

## 7. Decisions

Decided by the SUPERVISOR (2026-09-30):

- **Name:** DUTY (Duty Manager).
- **Model and ACCOUNT:** Claude Sonnet 5.5 (`claude-sonnet-5-5`) on `acct-2`.
- **Inline buttons:** FLEET PLAN, UPDATE and GO are inline. DISPATCH, SCHEDULE, HUMAN CHECK and LANDING are links.
- **Queue placement:** in the DUTY drawer. ui-visibility step 3's separate drawer is not built; its badges may still read the queue API.
- **Routing:** operations requests go to OCC as CHARTER REQUESTs, starting in shadow.
- **Claude desktop:** everyday work moves to DUTY. A terminal or Claude desktop stays only as break-glass.
- **Linear and GitHub:** bring in reading (drawers) and the few SUPERVISOR writes (MERGE, state, READY). Leave diff review and long editing in the services (3.6).
- **Permissions:** L1 (ENGINEERING powers). Code work goes to working sessions LAUNCHed from DUTY cards. L3 and L4 never.

Decided by this draft (pilot's discretion, reversible):

- DUTY never sends `SendMessage`.
- Its text is never spoken.
- Tool inputs and outputs are not shown on the screen.
- One conversation at a time.
- Approving inside Claude desktop (an atc widget in the desktop chat) is out: it cannot pass atc's localhost Origin check, and it would push toward the model calling approval APIs.
