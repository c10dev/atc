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

### G2 as built (ATC-207)

MERGE in the PR drawer for `user`-tier CLEARED PRs. The first place the atc server merges from a SUPERVISOR click; tier `user` (outward write).

- **Route.** `POST /api/pr/:airport/:number/merge` with `{head}` (the full 40-character sha the drawer showed), in `server/pr-merge-run.ts` (on the `SIDE_EFFECT` list). Only a request from this screen passes (`fromThisApp`, else 403), so sessions, `atcctl` and `curl` cannot call it, and there is no atcctl command. Nothing on a timer or hook calls it.
- **Rules** (pure, `server/pr-merge.ts` `mergeVerdictOf`, tested). In this order: the AIRPORT is the MCC AIRPORT (else 403, because atc's tier rules reach only there); the PR is open, not a draft, not from a fork, and goes to the default branch (else 409); `head` equals the live head (else 409 with `currentHead`, nothing merged); the tier is `user`, or MCC ESCALATEd the PR (else 403; unknown tier is 409); no SUPERVISOR HOLD (409); atc has polled this head and it is CLEARED (else 409 with the block lines). The route re-reads the PR and the full changed-file list (REST, paginated) from GitHub for every attempt and never trusts the drawer's cached data.
- **Merge.** `gh api -X PUT repos/<slug>/pulls/<n>/merge -f sha=<head> -f merge_method=<method>`: pinned to the exact head (the same condition as `--match-head-commit`; GitHub also refuses if the head moved in between), auto-merge is never enabled. The method is the AIRPORT's: `merge` for the MCC AIRPORT (as MCC lands), the AUTOLAND `mergeMethod` for any other. A GitHub refusal is returned as 409 with its reason and is recorded as failed.
- **Recording.** One FLIGHT RECORDER line per attempt after the request check, refusals and failures too: `{kind: "pr", op: "merge", by: "supervisor", airport, number, head, ok, result: merged|refused|rejected|failed, method?, error?}`. The drawer's 60 s cache for that PR is dropped after a merge.
- **Drawer.** The PR detail now carries `merge` (`allowed`, `why`, `head`, `tier`, `escalated`, `method`), computed by the same pure function from cached data (the click re-checks live). A **MERGE** row shows only for a candidate (tier `user` or ESCALATEd, PR open): `MERGE…` when allowed, otherwise the reason. `MERGE…` opens a confirm step that shows the tier, the 7-character head and the method; **머지 확인** sends the request. A refusal or a moved head shows the server's message, and the success note survives the drawer re-reading.
- **Not built here.** The button on the QUEUE LANDING card: Q1 exists, but the card needs ALERTING A4 or DUTY D3 to render QUEUE cards. The drawer button is the only one for now.
- **Chosen without asking (PILOT'S DISCRETION).** Only the MCC AIRPORT: the tier rules exist only for atc, and other AIRPORTs land through their teams and AUTOLAND. A PR that MCC ESCALATEd counts as `user` tier (ESCALATE means "the user merges"). A SUPERVISOR HOLD blocks the button until it is released. The body needs the full 40-character sha. `refused` and `rejected` attempts are recorded too.
- **Testing.** Every test stubs `gh`; nothing merged for real. The 7702 run used real GitHub data on an open `user`-tier PR: a request without the screen's Origin was 403, a wrong head was 409 with the real head, and the right head on a PR that was not CLEARED was 409, with two recorder lines and the PR still open. The button and confirm step were checked in the browser with the merge request stubbed at 1280 and 390 px.

### G3 as built (ATC-208)

The Linear state button in the FLIGHT drawer, and READY. The first place the atc server writes Linear; tier `user`.

- **Route.** `POST /api/flight/:key/state` with `{from, to}` (state names), in `server/flight-state-run.ts`. Only a request from this screen passes (`fromThisApp`, else 403), so sessions, `atcctl` and `curl` cannot call it, and nothing in the server calls it by itself: no timer, hook or DUTY path. The Linear API key stays on the server.
- **Rules** (pure, `server/flight-state.ts` `moveVerdict`, tested). In this order: the issue's team must be one atc reads (`LINEAR_TEAM_KEYS`, else 403); its current state must still be `from` (else 409, nothing written); its current state must be a Backlog, Todo or Canceled type (else 409: Started and Done issues stay with the team's PR and the SUPERVISOR in Linear); `to` must be a state of that team of a Backlog, Todo or Canceled type (else 400, and the same state is 400). The check and the write are two Linear calls, so a change made in Linear between them can still be overwritten (Linear has no compare-and-set).
- **Only file that writes.** `server/sources/linear-write.ts` holds the one mutation (`issueUpdate` with `stateId`) and is on the `SIDE_EFFECT` list in `deploy/landing-tier.mjs`, with the route file. The other Linear source files still only query.
- **Recording.** One FLIGHT RECORDER line per attempt, failures too: `{kind: "flight", op: "state", flight, by: "SUPERVISOR", ok, from, to, error?}`. The drawer's 60 s cache for that FLIGHT is dropped after a write.
- **READY.** `isReady(stateType, blockerStateTypes)` (pure, `server/detail.ts`): the issue is Backlog, has at least one blocker, and every blocker is Done or Canceled. A blocker whose state is not known makes it not READY, and an issue with no blockers is not READY. It reads the relations the drawer already fetched, so nothing new is polled.
- **Drawer.** The issue detail now also carries `ready` and `moves` (the team's other Backlog, Todo and Canceled states). A READY chip sits next to the state, and a **state move** row shows one button per `moves` entry; the Todo button is emphasised while READY. A click asks once ("Backlog → Todo … writes to Linear now") and only [Confirm] writes. A 409 or 502 shows its text and leaves the drawer as it was.
- **Not built here.** The QUEUE row READY. Q1 exists, but the row also needs ALERTING A4 (the popover); until then READY is the drawer chip only. The Q1 kinds do not include READY.
- **Testing.** All tests use stubs. Nothing wrote to the real Linear workspace, and the 7702 run had no Linear key.

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

### D0 as probed (ATC-193)

Measured 2026-09-30 with Claude Code 2.1.285, model `claude-sonnet-5-5`, on **acct-2** (`~/.claude`, the default folder; also once with `CLAUDE_CONFIG_DIR=~/.claude` set explicitly, same result). Not on acct-1. About 30 short turns in all, under $2 of FUEL. The environment was `cleanEnv`-like (`HOME`, `PATH`, `USER`, `LANG`, `TERM` only). The scratch folder sat outside the repository with a DUTY-style settings file passed with `--settings`: deny `Edit`, `Write`, `NotebookEdit`, `Agent`, `SendMessage`, `WebFetch`; allow `Bash(jq:*)` and `Bash(date:*)`; a `PreToolUse` guard that exits 2 on anything but a plain `jq` or `date`; a `UserPromptSubmit` hook that prints a marker line. No repository content went to the model. Fields are named here; no credentials, tokens or emails were read.

Command: `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --session-id <uuid> --settings <file>`. **`--verbose` is required** with stream-json output. Input lines are `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}`.

**1. Start.**

- Nothing is written before the first user line: no `init`, no output. Idle RSS before any message is 240–258 MB.
- After the first user line the `system/init` event comes in 0.4–0.8 s, and the first text delta in 2.2–2.9 s. A cold first turn ends in 2–3 s.
- RSS after 5 turns was 260 MB, so it does not grow with short turns.
- Idle costs nothing: no API traffic and no events for 15 s, and SIGINT at idle exits the process with code 0 in under a second.

**2. Turns.**

- Five user lines to one process were answered in order, one `result` each. A new user line can be written as soon as the previous `result` arrives.
- Each turn repeats `system/init` and `system/status`.
- Event types, with one example each (text shortened):

| type / subtype | Example |
|---|---|
| `system/init` | `{"type":"system","subtype":"init","cwd":"…","session_id":"…","tools":["Bash","Read",…],"mcp_servers":[…],"model":…}` |
| `system/status` | `{"type":"system","subtype":"status","status":"requesting","session_id":"…"}` |
| `system/thinking_tokens` | `{"type":"system","subtype":"thinking_tokens","estimated_tokens":50,"estimated_tokens_delta":50}` |
| `stream_event` | `{"type":"stream_event","event":{…},"session_id":"…","parent_tool_use_id":null,"uuid":"…"}` |
| `assistant` | `{"type":"assistant","message":{"model":"claude-sonnet-5-5","id":"msg_…","role":"assistant","content":[{"type":"text","text":"ONE"}],"stop_reason":null,"usage":{…}},"session_id":"…"}` |
| `user` (tool result) | `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"2","is_error":false,"tool_use_id":"toolu_…"}]}}` |
| `rate_limit_event` | `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","rateLimitType":"seven_day","utilization":0.82,"resetsAt":…,"unifiedWindows":{"five_hour":{…},"seven_day":{…}}}}` |
| `result/success` | `{"type":"result","subtype":"success","is_error":false,"result":"ONE","stop_reason":"end_turn","total_cost_usd":0.035,"usage":{…},"modelUsage":{…},"permission_denials":[],"num_turns":1,"duration_ms":2204,"session_id":"…"}` |

- **User lines are not echoed.** `--replay-user-messages` re-emits them as `{"type":"user",…,"isReplay":true}`; the server should log the user text itself.
- The `assistant` event carries `usage`, but its `stop_reason` is `null`. The end of a turn is the `result` event, not the `assistant` event.
- Thinking blocks arrive with empty text (`"thinking":""`, a `signature`). Only `estimated_tokens` is shown.
- The `result` event has these fields: `duration_api_ms`, `stop_reason`, `session_id`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `terminal_reason`, `fast_mode_state`, `is_error`, `num_turns`, `subtype`, `api_error_status`, `result`, `ttft_ms`, `duration_ms`, `uuid`, `queued_turn_count`, `result_index`, and a few more.
- `--include-hook-events` adds `system/hook_started` and `system/hook_response` before `init` (see 5).
- `--strict-mcp-config` empties `init.mcp_servers`. Without it the list held account-level connectors and plugins that were failed or needed sign-in.

**3. Partial text.**

- With `--include-partial-messages` a turn is a run of `stream_event` lines, each with `event.type`: `message_start`, `content_block_start` (with `index` and `content_block.type`), `content_block_delta`, `content_block_stop`, `message_delta` (carries `stop_reason: "end_turn"` and `usage`), `message_stop`.
- Text deltas are `{"event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ONE"}}}`. A 500-word story came as 55 deltas. Thinking has `thinking_delta` (empty text, `estimated_tokens`) and `signature_delta`.
- The final text is the `assistant` event whose `content` has the whole `text` block, followed by `message_delta` and `message_stop`. Its `stop_reason` is `null`. The turn's end and full text are in `result.result` after `rate_limit_event`.
- An interrupted turn (7) still sends the `assistant` event with the text written so far.

**4. Denied tool and guard.**

- **Deny list.** A denied tool is **removed from the tool list**: `init.tools` had no `Edit`, `Write`, `Agent`, `WebFetch` or `NotebookEdit`. The model said "the Edit tool isn't available". No `tool_use` line and no denial event. The process goes on.
- **Guard (`PreToolUse` exit 2).** The stream shows `assistant` with a `tool_use` line, then a `user` line with `tool_result`, `is_error: true` and the text `PreToolUse:Bash hook error: [<command>]: <guard's stderr>`. The result's `permission_denials` lists the call (`tool_name`, `tool_use_id`, `tool_input`). The turn goes on (`num_turns` 2), and the model answered from the failure. A guard that allows the call (`jq -n 1+1`) gives a normal `tool_result`.
- **Neither waits for anyone.** The next user line worked as usual.
- **`init.tools` still lists tools the deny list did not name** (`CronCreate`, `EnterWorktree`, `Workflow`, `WebSearch`, `RemoteTrigger`, `PushNotification`, `ListAgents`, …). `--tools Bash,Read` made `init.tools` exactly `["Bash","Read"]`. It also cut the first-turn prompt from about 18k to about 4.6k tokens, and the cold first turn from $0.035 to $0.009. **D1 should pass `--tools` and `--strict-mcp-config`** and keep the deny list as a second lock. The guard must also see every tool the deny list does not name.

**5. Hook.**

- The `UserPromptSubmit` hook's **stdout reaches the model in `-p` stream-json mode**. The marker line `BRIEF-MARKER: the secret word is PELICAN-7` was repeated back by the model, which could not have known it. It ran on every user line, once per turn.
- With `--include-hook-events` the stream shows `system/hook_response` with `hook_name`, `hook_event`, `output`, `stdout`, `stderr`, `exit_code` and `outcome`. It comes before `init`, 0.7 s after the user line.
- The hook ran from the `--settings` file and from a project `.claude/settings.json`.

**6. Resume.**

- The process was killed with SIGKILL after the first result (`exit null SIGKILL`). A new process with `--resume <same id>` and a new user line answered from the earlier context (the code word was remembered).
- The first event is a normal `system/init` with the **same `session_id`**, after the first user line (0.8 s). There is no replay of earlier messages. The new process starts its `total_cost_usd` at zero.
- `--session-id <uuid>` on a fresh process is accepted, and `--resume` needs the same ACCOUNT folder (ATC-145 found it fails across folders).

**7. Stop mid-answer.**

- **Use the control message.** Write `{"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}` on stdin. The stream then shows a `control_response` (`{"subtype":"success","request_id":"<id>","response":{"still_queued":[]}}`), the `assistant` event with the text so far, a `user` line with `[Request interrupted by user]`, and a `result` with `subtype: "error_during_execution"`, `is_error: true` and zero usage. **The process stays up**: the next user line was answered and remembered the interrupted story.
- An interrupt in the middle of a tool call ended the turn the same way.
- **SIGINT also ends the turn, but the process then exits with code 0** within about a second and drops the next line. It is not a way to stop a turn in a long-lived process.

**8. Cost.**

- Short turns on `claude-sonnet-5-5`: a cold first turn was $0.035–0.052 (8–13k cache-write tokens for the system prompt and tools, 1 h cache), later turns $0.005–0.02 (10–23k cache-read tokens, 3–160 output tokens). Five turns to one process came to $0.071. `--tools Bash,Read` brings the cold first turn to $0.009.
- `total_cost_usd` in `result` is **cumulative for the process**. Per-turn cost is the difference between two results. `usage` and `modelUsage` are per turn. `usage` fields: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `output_tokens_details`, `server_tool_use`, `service_tier`, `cache_creation` (`ephemeral_1h_input_tokens`, `ephemeral_5m_input_tokens`), `inference_geo`, `iterations`, `speed`, `fallback_credit`.
- `rate_limit_event` carries the ACCOUNT's `five_hour` and `seven_day` `utilization` and `resetsAt` on every turn. FUEL for DUTY can read them from the stream instead of the statusline.
- Idle cost is none (see 1).
**9. Env and ACCOUNT.** The run above used acct-2 (`~/.claude`) with and without `CLAUDE_CONFIG_DIR`. `cleanEnv` omits the variable for the default folder and this was the same. `-p` refuses to load `permissions.allow` from a project `.claude/settings.json` in a folder the ACCOUNT has not trusted (stderr line `Ignoring 2 permissions.allow entries from .claude/settings.json: this workspace has not been trusted`). Hooks from the same file still ran. Settings passed with `--settings` are not affected. `claude --bg` refuses an untrusted folder outright (`Workspace not trusted. Run claude … once and accept the trust prompt`). So DUTY's settings go on the command line or `duty/` must be trusted in the ACCOUNT folder first.

**10. NEEDS YOU.**

- **State file.** A blocked background job has `state.json` with `state: "working"`, `tempo: "blocked"`, `detail` ("Writing ~/…") and `needs` ("approve Write: /path"). `suggestedReply` was absent for a tool approval (`server/job-state.ts` already reads all of them). Other fields: `sessionId`, `cwd`, `daemonShort`, `backend`, `inFlight`, `providerEnv`, `createdAt`, `updatedAt`. When answered, `tempo` went to `idle` and `needs` went away.
- **CLI.** `claude --help` documents `attach`, `logs`, `stop`, `rm`, `respawn` and `agents [--json]` for background jobs. **None answers a prompt.** `logs` prints the terminal screen. `attach` needs a terminal.
- **What works.** `claude attach <id>` inside a pty (tmux, 120×40) draws the prompt ("Do you want to create bg2.txt? 1. Yes / 2. … / 3. No"). `tmux send-keys 3` answered it, the job went on, and the `state.json` changed as above. So a server that runs `claude attach` in a pty it owns can answer NEEDS YOU from atc without Claude desktop. It scrapes a terminal screen whose text can change with the Claude Code version, so it needs a screen check and a version pin.
- **Where the SUPERVISOR does not need it.** A DUTY-style `-p` process can be given `--permission-prompt-tool stdio`. A tool that is neither allowed nor denied then **waits**: the stream shows `{"type":"control_request","request_id":"…","request":{"subtype":"can_use_tool","tool_name":"Write","input":{…},"description":"other/no.txt","permission_suggestions":[…],"tool_use_id":"toolu_…"}}`, and the process holds until stdin gets `{"type":"control_response","response":{"subtype":"success","request_id":"…","response":{"behavior":"allow","updatedInput":{…}}}}` or `{"behavior":"deny","message":"…"}`. Deny was passed to the model as an error `tool_result` with the message, and allow ran the write. Tools that the deny list or the guard block **never** reach this request. The default (`--permission-prompts host` without the tool) denies at once, as in 4. This is the route for a DUTY card ("DUTY wants to write X: allow / deny") instead of a blanket allow list. It is a decision for the SUPERVISOR to take (L1 is chosen without it), and the button would be atc UI with the Origin check like every other card.
- A `--bg` job started without `--permission-mode default` ran the same write with no prompt, so a held prompt needs the mode set explicitly.
- The throwaway jobs (`claude --bg` in the atc worktree, one that ran the write and one held at the prompt) were stopped and `rm`'d; `claude agents --json` and `jobs/` no longer list them.

**L1 allow list in `-p` (3.5).**

- Rule paths: `Edit(//home/c10/x/allowed/**)` matches an **absolute** path. A single leading slash (`Edit(/home/c10/x/**)`) is relative to the project root and matched nothing: the write failed as "you haven't granted it yet". Use `//` or `~/`.
- With that, `Write` and `Edit` **inside the allowed path passed** (file created, then edited). A path outside failed at once with `Claude requested permissions to write to <path>, but you haven't granted it yet.` (`is_error: true`, listed in `permission_denials`), **with no prompt** and no wait. The turn went on.
- A worktree-shaped pattern worked: `Write(//…/.claude/worktrees/duty-*/**)` allowed `.claude/worktrees/duty-x/w.txt` and refused `.claude/worktrees/other-y/w.txt`.
- **Paths inside the ACCOUNT's config folder are "sensitive".** A scratch folder under `~/.claude/jobs/…` was refused even with a matching allow rule (`which is a sensitive file`). DUTY's worktrees are under the repository, not the config folder, so this does not touch L1.
- The `PreToolUse` guard runs first and can block an allowed tool. The allow list is a second door: for L1 the guard must let `Edit` and `Write` through for the allowed paths, or nothing is written.

**What this changes in the design.**

- D1 spawns with `--tools`, `--strict-mcp-config`, `--settings <file>`, `--include-hook-events` and `--replay-user-messages`, and does not rely on a project `.claude/settings.json` for `allow` (9).
- D2's parser needs: `system/init` (once per turn), `stream_event` text deltas, `assistant` (full text), `user` tool results, `result` (turn end, cost, `permission_denials`), `rate_limit_event`, and `control_response`. The server logs user text itself. The stop button sends the `interrupt` control message (7).
- Idle exit after `duty.idleMin` works: a process that ended mid-conversation resumes with its context (6).
- NEEDS YOU has two routes: a pty around `claude attach` for other jobs, and `can_use_tool` for DUTY's own process. The SUPERVISOR decides whether either is built (10).
- Section 3.2's line "NEEDS YOU links to the AIRCRAFT, unless D0 finds a way" is now: D0 found the pty route, with the fragility above.

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
