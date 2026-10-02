# DUTY: talk to atc and decide in the same window

Status (2026-09-30): design draft for [ATC-192](https://linear.app/vocado/issue/ATC-192/desk-chat-with-atc-and-decide-in-the-same-window-design-and-phases), from the idea [chaehy5665/atc#271](https://github.com/chaehy5665/atc/issues/271). The SUPERVISOR decided to go ahead, chose the name DUTY and the permission level (section 7). Nothing is built. The first draft called it DESK (`docs/desk.md`, [#273](https://github.com/chaehy5665/atc/pull/273)); this file replaces it.

**DUTY** is the airline's Duty Manager: the one person in the OCC whom management calls. The Duty Manager holds the overview and passes work to dispatch, crew control and maintenance control. In atc, DUTY is the SUPERVISOR's single window: it talks, writes designs and work orders (it takes over ENGINEERING), and routes the rest. Unlike a real Duty Manager, it decides nothing. The SUPERVISOR decides on DUTY's cards.

Decisions made while the SUPERVISOR is away are not DUTY's either. They belong to WATCH ([watch.md](watch.md)): a separate session that acts only inside a scope and time the SUPERVISOR hands over on the screen.

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
- **ENGINEERING today** is a working session opened in Claude desktop at the repository root. It writes design docs and Linear issues, and it doesn't merge, deploy or message teams (root `CLAUDE.md` "계획·DUTY·Linear", [naming.md](naming.md) "Working sessions").
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
| **L1** | L0, plus: `Edit`/`Write` only under its own worktrees (`.claude/worktrees/duty-*`); `git` in those worktrees, including push of its own `claude/duty-*` branches; `gh pr create` and `gh pr view`; Linear create, update and comment **through the server** (`atcctl duty linear`, not MCP; see "D7a as built") | **Chosen** (D7). Built in D7a, behind the `l1` switch of `duty.json` (off by default) |
| L2 | Code, tests and test servers in its own conversation | Not given. Code work goes to a working session (3.4) |
| L3 | Approve, judge, merge, deploy, switch modes | **Never.** Card buttons only |
| L4 | Messages to team sessions | **Never.** DISPATCH, OCC and TOWER own that traffic |

The guard enforces L1 by path and command, fail-closed, like `controller/guard.mjs`:

- no `gh pr merge`, `gh api` writes, `systemctl`, `curl`, `kill`, `pkill`;
- no writes outside its worktrees;
- no `SendMessage`;
- no `.env*`, `.credentials.json` or `~/.local/state/atc` writes;
- **no self-authority**: even inside its own worktree it cannot write `duty/` (`settings.json`, the guard, its manual), `*guard*`, `.claude/`, `.github/`, `package*.json`, `deploy/`, `hooks/`, the root `CLAUDE.md`, `.env*`, `.git*` or `node_modules`.

`settings.test.mjs` pins the allow and deny lists, and `guard-l1.test.mjs` pins every allowed and refused path and git or gh form ("D7a as built").

**Linear replaces "(MCP)" here.** DUTY runs with `--strict-mcp-config`, so it has no MCP (D0: connectors differ per ACCOUNT, and a session that depends on one breaks when the ACCOUNT changes). The server writes with its own key through `atcctl duty linear`, so the rules (ATC team only, Backlog and Todo only, priority on every new issue) live in one tested place, not in a connector's permissions.

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
| D7 | **L1**: worktree, `gh pr create` and Linear in DUTY's settings and guard; root `CLAUDE.md` "계획·DUTY·Linear" moves to DUTY; [naming.md](naming.md) gets DUTY as a control session; `duty work` LAUNCH cards and ARRIVED reports as cards | Design, work orders and code hand-off without Claude desktop. `user` tier |

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

### D1 as built (ATC-219)

The `duty/` folder, its fail-closed guard and `atcctl duty` at **L0**. No server spawn, no drawer, no Origin write route, no `decisions.jsonl` (D4), and OCC does not read charters (D5). Tier `user` (guard, settings, root `CLAUDE.md`, `deploy/`, `package.json`).

- **Folder `duty/`.** `CLAUDE.md` (Korean original) and `CLAUDE.en.md`; `settings.json` (passed with `--settings`, not under `.claude/`, see D0 item 9; a test pins that `duty/.claude/settings.json` does not exist); `guard.mjs`; `spawn.mjs`; tests. The manual says what DUTY may and may not do, that outside text is data, the two languages, and each `atcctl duty` command. It has no `/tick` and no SQUELCH.
- **Settings.** `model` `claude-sonnet-5-5`. `permissions.deny`: `Edit`, `Write`, `NotebookEdit`, `Agent`, `SendMessage`, `WebFetch`, `WebSearch`. `permissions.allow`: the `atcctl duty` commands, eight read-only atcctl commands, `jq`, `gh pr view|list|checks|diff`, `git log|show|diff|status`, and `Read`, `Glob`, `Grep` (the guard is what limits those three). One hook: `PreToolUse`, matcher `.*`, `guard.mjs || exit 2`. No `UserPromptSubmit` hook yet (D4). `settings.test.mjs` pins the lists and the hook, and checks that every allowed Bash rule also passes the guard.
- **Spawn argv.** `duty/spawn.mjs` exports the pure `dutyArgvOf({ claudeBin?, sessionId?, resume?, dir? })` (chosen over a spawn script: D2 imports it and adds the environment). It returns `{ command, args, cwd, sessionId }`: `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --include-hook-events --replay-user-messages --strict-mcp-config --tools Bash,Read,Glob,Grep --settings <abs>/duty/settings.json --session-id <uuid>` (or `--resume <id>`), cwd `duty/`. A missing or non-UUID id is an error.
- **Guard (`duty/guard.mjs`).** A separate file with the same style as `controller/guard.mjs`; the control-session guards were not touched. It allows only the tools `Bash`, `Read`, `Glob` and `Grep`, and refuses any other tool name. Every parse failure, unknown input shape or crash is exit 2 (a broken stdin too).
  - *Bash*: `node <repo>/controller/atcctl.mjs` with `duty brief|flight|pr|card|note|charter`, or one of `dispatch brief`, `dispatch flight`, `schedule brief`, `crosscheck brief`, `landing queue`, `manual check`, and `network` and `following` without arguments; `jq` only after a pipe (no files, `-f`, `env`, `import`); `gh pr view|list|checks|diff` (no `--web`, `--watch`, `gh api`); `git log|show|diff|status` with no global option first and no `--output`, `--no-index`, `--ext-diff` or `-c`. Every command in a `;`, `&&` or `|` chain must match; redirection and command substitution or variable expansion are refused outright.
  - *Read, Glob, Grep*: only inside the repository, after resolving symlinks. Refused: any `.env*` name, `.credentials.json`, anything under `.git`, `~/.claude*`, `~/.local/state/atc` (and `ATC_STATE_DIR`), `~/.ssh`, `/proc`. Glob and Grep patterns may not contain `..`, and an absolute or `~` pattern is checked by its fixed prefix. A part of the path that cannot be resolved is checked with `lstat`: only a part that truly does not exist (`ENOENT`) is joined back by name; a symlink that cannot be resolved (a dangling target or a loop) and any other `lstat` error are refused, so a dangling link inside the repository cannot point at a secret path outside it (MCC INSPECTION P1 on the first head). Grep refuses a folder that contains a `.env*` file anywhere below it (a bounded scan that refuses when the folder is too large), so it cannot print a secret by content.
- **`atcctl duty`** (`controller/atcctl.mjs`): `brief`, `flight <KEY>`, `pr <AIRPORT> <n>`, `card <kind> <key>`, `note -- '<rule>' [--until <iso>]`, `charter -- '<English request>'`. `flight` and `pr` print the G1 drawer data as text, with issue, comment and PR bodies between `BEGIN DATA` and `END DATA` and a line saying it is data.
- **Server.** `GET /api/duty/brief` and three POSTs, `/api/duty/card`, `/api/duty/note`, `/api/duty/charter`, in `server/duty-api.ts`. The POSTs come from atcctl (no Origin, like other control-session routes), take at most 16 KB, validate the shape, and only append a line to `duty-drafts.jsonl` in the **state folder** (never the repository). Nothing goes out. A request that carries an `Origin` other than localhost is refused (403), so a page on another site cannot append drafts; atcctl sends no Origin and passes.
  - `server/duty-brief.ts` (pure `dutyBriefOf`): the SUPERVISOR QUEUE (counts and the eight oldest rows), alerts at WARNING or CAUTION (ten rows), FLEET one line per AIRCRAFT (status, AIRPORT, FLIGHT, ACCOUNT, FUEL-HOLD), FUEL top window per ACCOUNT, FLIGHTs in progress (key and state only). Keys and counts only, no ticket or PR text. Capped at `briefMaxChars` (default 6,000, read from `duty.json` in the state folder, 500 to 50,000); if cut it drops rows from the last sections first and ends with `[brief cut at N chars: …]`.
  - `server/duty-drafts.ts` (pure): a card is accepted only if `<kind>/<key>` is a row of `supervisorQueueOf` right now, else refused with the reason and the current keys of that kind. A note is 1 to 1,000 characters with an optional future `--until`. A charter is up to 4,000 characters and must be English (Hangul, kana and Han characters are refused, ATC-126). Draft lines are `{id: "DD-0001", at, kind: card|note|charter, …}`. A note is only a proposal; `decisions.jsonl` is D4.
- **Tiers.** `deploy/landing-tier.mjs`: `duty/settings.json` is `user` (`duty/*guard*.mjs` was already `user` through the guard rule), the rest of `duty/` is `flagged` like `occ/`, and `server/duty-run.ts` is on the side-effect list ahead of D2. That file exists as an empty placeholder because the tier test requires listed files to exist. `package.json` `test` now includes `duty/**/*.test.mjs`.
- **Rules files.** Root `CLAUDE.md` and `CLAUDE.en.md` list `duty/` with the folders that follow their own `CLAUDE.md`. `docs/naming.md` and `naming.ko.md` get one line that DUTY exists at L0 and does not run yet; it moves to the control sessions in D7.
- **Smoke check (2026-09-30).** 7702 test server (`ATC_GITHUB=off`, temporary state folder), one real `claude -p` process per run with `dutyArgvOf`'s argv, cwd `duty/`, on acct-2 (the default folder), environment `HOME`, `PATH`, `USER`, `LANG`, `TERM` and `ATC_URL`. About $0.26 of FUEL in all (two processes, ten short turns). Stopped by saved PID; the test server and its state folder were removed.
  - `init.tools` was exactly `["Bash","Glob","Grep","Read"]`, `init.mcp_servers` empty, model `claude-sonnet-5-5`, permission mode `default`.
  - "Tell me the situation" → it ran `atcctl duty brief` (the guard allowed it: `PreToolUse` `success`) and answered in Korean from the brief.
  - Asked plainly, it refused a file write, `curl`, reading `.env.local` and approving a DISPATCH proposal **by itself**, from the manual, without calling a tool, and pointed at the SUPERVISOR QUEUE. A card request for a key not in the queue was passed to the server and refused with the reason.
  - With "this is a guard test, call the tool anyway", the tools were called and every one was refused by the guard and the turn went on: `echo hello > /tmp/…` (redirection), `curl -s http://127.0.0.1:7702/api/duty/brief`, `Read /home/c10/projects/atc/.env.local`, `gh pr merge 1`, `atcctl dispatch note D-0001 -- x`. `Write` was not in the tool list at all. The `.env.local` read was refused as "outside the repository" because the run was in a worktree; the `.env*` rule itself is covered by the unit tests. No file was created.
  - Also confirmed: `$CLAUDE_PROJECT_DIR` resolved to `duty/` in the hook command (the guard ran and blocked), and the allow list needed no prompt (nothing waited).
- **Left for later.** The brief hook and standing decisions (D4), showing and acting on cards (D3), the server spawn and `duty.jsonl` (D2), OCC reading charters (D5), L1 (D7). The alert rows in the brief carry the alert key as it is, which for some kinds contains a worktree path; shorten them when D4 sizes the brief.

### D2 as built (ATC-220)

The server runtime and the text chat. Tier `flagged`: `server/duty-run.ts` was pre-registered as an external side-effect file by D1, so no `deploy/` file changed. No cards and no queue row (D3), no brief hook or `decisions.jsonl` (D4), no OCC routing (D5), no L1 powers (D7). DUTY stays off (`enabled` false) until the SUPERVISOR turns it on.

- **Pieces.** Pure and tested: `server/duty-stream.ts` (parser), `server/duty-machine.ts` (state machine), `server/duty-log.ts` (log lines, paging, image check), `server/duty-config.ts` (`duty.json`), `server/duty-chat.ts` (the drawer's reducer, shared with the screen). I/O: `server/duty-run.ts` (spawn, stdin, stdout, log, routes). Screen: `web/src/DutyDrawer.tsx`, `useDuty.ts`, the header readout in `App.tsx`. `duty/spawn.d.mts` types `dutyArgvOf` for the server.
- **Process.** Spawned on the first message with `dutyArgvOf` (cwd `duty/`) and `cleanEnv(<ACCOUNT dir>)`. The ACCOUNT is `duty.account` (default `acct-2`), found in the `fleet.json` `accounts` registry by label; a label that is not there refuses the message with the reason. One process, one input queue: while a turn runs, a second message waits (its sender gets 202 and "DUTY is answering") and is written after the `result`. After `duty.idleMin` (default 30) with no input the server closes stdin (with a SIGTERM after 10 s if it does not end); the next message respawns with `--resume <id>`. The session id is in `duty-session.json` (atomic write). **NEW SHIFT** ends the process (kill if a turn is running, else close stdin), clears the queue and the id, and writes a `shift` line. **Stop** writes the `interrupt` control message; the process stays up and the queue goes on. An unexpected exit is `down` with the last stderr line and drops the queue; the next message respawns with `--resume`; three unexpected exits in five minutes stay `down` (messages are refused) until NEW SHIFT, or a settings change of the ACCOUNT. Turning `enabled` off ends a running process; the server's own exit ends the child.
- **Parser.** `stream_event` text deltas → `text` (partial); the `assistant` text block → `text` (final); `tool_use` → `tool` with the name and a one-line summary (the first line of a Bash command, a path or a pattern, cut at 80 characters); an `is_error` tool result → a `tool` line with the error's first line (the guard's `PreToolUse … hook error: […]:` head is cut off); `result` → `usage` (per-turn tokens, context = input + cache read + cache write, cumulative cost) and `state idle`, plus a `notice` when it is an error other than an interrupt; `rate_limit_event` → `usage` with the `five_hour` and `seven_day` windows; `system/init` → model. Replayed user lines, hooks, `control_response`, thinking and unknown lines are ignored; a malformed line is counted (`status.malformed`), not thrown. The server writes the user's own line to the log at the moment it is written to stdin, so a queued message appears in order.
- **Log and files** (state folder only): `duty.jsonl` (user text with an image file name, final DUTY text, tool name + summary lines, notices, turn usage, `shift`), `duty-session.json`, `duty-images/`. Never tool inputs or outputs beyond the one-line summary.
- **API.** `POST /api/duty/message` `{ text, image?: { mediaType, data(base64) } }` (text up to 20,000 characters; PNG, JPEG or WebP up to 5 MB; body up to 8 MB), `POST /api/duty/stop`, `POST /api/duty/new-shift`: all `fromThisApp` (JSON content type and a localhost `Origin`; `atcctl` sends no Origin, so it cannot send a DUTY message) and 409 with a reason when `enabled` is off. `GET /api/duty/history?before=<line>` (200 lines a page, from the end), `GET /api/duty/status` (state, ACCOUNT, id prefix, model, context, CAP, cost, rate windows, queued, blocked, malformed). `/api/events?topics=duty` (opt-in, not in the default set): a `status` frame on connect, then `user`, `text`, `tool`, `notice`, `state` (with `queued` and `blocked`), `usage`, `shift`, and `status` again when the settings change.
- **Settings.** `duty.json` in the state folder: `enabled` (default off), `account` (`acct-2`), `idleMin` (30, 1 to 720), `briefMaxChars` (D1). The switch is in **Settings → OPERATIONS → DUTY**: it is the same kind of switch as CONTROL RECYCLE (something the server starts on its own and that spends an ACCOUNT's FUEL), and OPERATIONS is where those live. It is marked ⚠ (confirm step) when turned on and shows in the policy line at the top. `account` and `idleMin` are edited in the file (Pilot's discretion: only the switch has a screen). The CAP shown is 250k, the same as the control sessions' default; nothing recycles DUTY at the CAP yet (NEW SHIFT is by hand).
- **Screen.** A `● DUTY` readout in the header only while enabled (dot: green idle, amber answering, red down or blocked). It sets the address `#duty`, which opens the drawer over any tab (the tab is not changed). About 440 px on the right, full screen at 600 px and below; Esc, backdrop, × and Back close it. Head line `DUTY · acct-2 · context 12/250k` and NEW SHIFT with a confirm step. Chat: SUPERVISOR and DUTY messages (DUTY's Markdown through the same safe renderer as the other drawers), streaming text, tool lines small and muted (red with `거절됨` when the guard refused), notices, a `— NEW SHIFT —` divider, Enter sends (not while composing Korean), Shift+Enter adds a line, a pasted image is attached, and a stop button while answering. Colours and fonts are `:root` tokens only. Nothing here is read aloud.
- **Checked (2026-09-30).** `npm test` cases: the parser with D0-shaped fixtures (init, deltas, assistant, a tool_use with an error tool_result from the guard, result, rate_limit_event, the interrupt result, hook and unknown lines), the state machine (queue, idle timeout and resume, crash backoff, NEW SHIFT, disable), the runtime against a fake `claude` script (spawn on first message, queue order in the log, stop keeps the process, idle exit then `--resume`, NEW SHIFT gets a fresh `--session-id`, image file, crashes, blocked), the routes (Origin and JSON refusals, `enabled` off, validation, 202 queued), and the reducer. Real run on a 7702 test server (`ATC_GITHUB=off`, temporary state folder, `duty.json` with `idleMin` 1), real `claude -p` on acct-2, five short processes, well under $0.5 of FUEL:
  - the first message spawned the process and the second, sent while it answered, got 202 and was answered after it, in order;
  - **stop** mid-answer (a long story) ended the turn with the partial text in the log, the process stayed and the next message was answered with the earlier context;
  - the guard refusal (a `curl` call the model was asked to make) showed as a `tool` line with `error`, and the model answered from the refusal;
  - after one minute idle the child process was gone; the next message came up with `--resume` and answered the code word it had been given before;
  - NEW SHIFT: the next message got a new session id and the answer did not know the code word.
  - Playwright on the drawer at 390, 768, 1280 and 1600 px in the `radar`, `night` and `cockpit` themes: no horizontal overflow, the input stays in view on the phone, the drawer is 440 px wide from 768 px up and the whole screen at 390. The stop button and a queued-message note were not clicked in the browser (covered by the runtime tests and the real run above).
  - The test server and its state folder were removed; the processes were stopped by saved PID.
- **Left for later.** Cards, the queue row and their Origin-checked buttons (D3); the brief hook and `decisions.jsonl` (D4); OCC routing (D5); a CONTROL RECYCLE-style restart at the CAP; a screen for `account` and `idleMin`; L1 (D7).

### D3 as built (ATC-230)

Cards in the chat and the folded QUEUE row. Tier `flagged`: `duty/` manuals, screen code, and two server files that were already on the side-effect list (`server/duty-run.ts`, `server/index.ts`). No `deploy/` file changed. No approve, reject, merge or send route is callable from DUTY or `atcctl`, no `decisions.jsonl` or brief hook (D4), OCC does not read charters (D5), no L1 (D7).

- **Card event.** `mountDuty` takes an `onDraft` callback. After `/api/duty/card|note|charter` accepts and appends a draft, `DutyRuntime.recordDraft` writes a `card` line (`{queueKind, key, draft: "DD-n"}`) or a `draft` line (note, charter) to `duty.jsonl` and emits the same as a `card` or `draft` event on the `duty` topic. It goes through the same append and emit as the text, so it sits in order with the text around it, and `GET /api/duty/history` pages it too. A refused card request writes nothing; DUTY reports the reason in text. The card line holds only the pointer; the content is read from the queue when drawn.
- **Live card** (`server/duty-card.ts`, pure, tested, shared with the screen). `cardViewOf(ref, items, handled, airports)` gives `live` (the current queue row and its actions), `gone` with `처리됨` (the SUPERVISOR's click on this screen was accepted) or `큐에서 빠짐` (the row left the queue by itself), or `unknown` while the queue is not read yet. The card never re-checks by itself.
- **Buttons** (`web/src/DutyCards.tsx`). Every inline button is the screen's own fetch with the existing Origin check, so `fromThisApp` holds. `atcctl` got no command.
  - FLEET PLAN: reads `/api/fleet/plan` for the mode. SHADOW: `반대` and `동의` (`/verdict`). APPROVAL: `거절` (`/verdict` disagree) and `승인(실행)` (`/approve` with `{}`, so the server defaults apply; the FLEET tab has the form for permission mode and model). A stale row disables approve. A manual REFRESH (`isManual`) or a row the plan no longer lists shows a link to FLEET instead. Both paths ask for one inline confirm (reject also takes an optional reason).
  - UPDATE: `/api/update/start` after one inline confirm.
  - Links: PROPOSAL `#dispatch`, SCHEDULE `#schedule`, HUMAN CHECK `#strips`, LANDING `#pr/<AIRPORT>/<n>` (falls back to `#strips` when the repo is not an AIRPORT), NEEDS YOU and GO `#fleet`. GO is a link: there is still no route for the SUPERVISOR's GO and none that messages a session was added.
- **Draft cards.** `note` and `charter` drafts are muted, dashed, read-only cards with the text and `D4에서 확정` or `D5에서 확정`. No button.
- **QUEUE row.** `QUEUE nn · <kind n> …`, folded by default, above the chat. It expands to the whole queue with the same button or link per row. It reads `/api/supervisor/queue` when the screen's snapshot changes (`snapshot.at`), when a card arrives, and after a click. No new polling loop. A handled row is hidden at once.
- **Manual.** `duty/CLAUDE.md` and `.en.md` have "카드를 청할 때" / "When to ask for a card": ask when the SUPERVISOR has something to decide or asks what waits; the card is only a pointer; a refused key is reported and not retried.
- **Pilot's discretion.**
  - DUTY's child process now gets `ATC_URL=http://127.0.0.1:<this server's port>`. Without it, `atcctl` inside DUTY talks to 7700, so DUTY on a test server would have written cards to prod. (A test pins it.)
  - The UPDATE bar has no confirm step, but the spec asks for "the same confirm"; both inline buttons get one confirm, like the FLEET tab's approve and reject.
  - Links do not focus the item (no tab takes an item address yet) and they close the drawer, because `hashchange` to a tab address closes `#duty`; the chat state is kept.
  - Card order is the order the server accepted the requests. When DUTY runs several `atcctl` calls in parallel, that can differ from the order it wrote them.
- **Checked (2026-09-30).** `npm test`, `tsc`, `vite build`. Cases: card and draft events in order in the log and the stream, refused request writes nothing, `cardViewOf` states, actions by kind, the QUEUE head, the reducer and history. 7702 test server (`ATC_GITHUB=off`, temporary state folder, `duty.json` enabled) with a temporary, uncommitted hook that added a PROPOSAL, an UPDATE and a LANDING to the queue and two FLEET PLAN proposals in `fleet-plan.jsonl`. One real DUTY conversation on acct-2 (about $0.07) asked for three cards:
  - FLEET PLAN `FP-T1` (inline) and LANDING (link) became cards in that order; the third request (a PROPOSAL key that is not in the queue) was refused with its reason and DUTY told the SUPERVISOR in text;
  - the FLEET PLAN `반대` with its confirm wrote a `disagree` verdict for `FP-T1` and the card greyed to `처리됨`; the QUEUE row dropped from 5 to 4;
  - the QUEUE row showed `QUEUE 5 · PROPOSAL 1 · FLEET PLAN 2 · LANDING 1 · UPDATE 1` folded, and expanded to the rows with buttons and links; the UPDATE confirm opened and was cancelled (not sent: it would start a deploy);
  - Playwright at 1280 and 390 px in `radar` and `night`: no horizontal overflow, the drawer 440 px and full width. In `night` the drawer background is translucent (the existing drawer style), so the page shows through behind the cards.
  - The test server was stopped by its saved PID, the temporary hook was reverted and the state folder removed.
- **Left for later.** `decisions.jsonl` and confirm cards (D4), OCC reading charters (D5), a route for the SUPERVISOR's GO, focusing the item on the target tab, and keeping the drawer open across a link.

### D4 as built (ATC-231)

Memory from atc state. Tier **`user`**: `duty/settings.json` changed (the `UserPromptSubmit` hook). The `PreToolUse` guard is untouched and stays fail-closed; only the brief hook is fail-open. No OCC routing (D5), no L1 (D7).

- **Brief hook** (`duty/brief-hook.mjs`, `UserPromptSubmit`, `… || exit 0`, hook timeout 8 s). It prints the text of `GET /api/duty/brief` (the same the `atcctl duty brief` command prints) to the turn, using `ATC_URL` (set by the server for the DUTY child, D3) or 7700. If the server is down, answers with an error, or does not answer in 5 s, it prints one line `brief unavailable: <reason>` (`ECONNREFUSED`, `HTTP 500`, `no answer in 5s`, `empty brief`) and exits 0; the turn runs. The hook's output arrives as a hook event, which the parser ignores: a run checked that `DUTY BRIEF` is not in `duty.jsonl` and does not reach the drawer.
- **`decisions.jsonl`** (state folder, append-only) and pure `server/duty-decisions.ts`: `{op:"note", id:"SD-n", at, text, until?, from:"DD-n"}` and `{op:"retire", id, at, why?}`. `decisionsOf(lines, now)` folds them: a retire line turns a note off, a note past `until` is off without a retire line, the first line of an id wins, broken lines are skipped. It also gives which draft became which decision.
- **Routes** (`server/duty-api.ts`). Writes are `fromThisApp` only (a JSON content type and a localhost `Origin`; `atcctl` has no Origin, so it cannot reach them). `atcctl` got no command that writes `decisions.jsonl`; `duty note` stays a proposal.
  - `POST /api/duty/decisions {draft}` confirms a `note` draft. The text and `until` are read **from the draft on the server**, never from the request. Refused: not a note draft (404), already confirmed, dismissed, or `until` past (409).
  - `POST /api/duty/decisions/:id/retire {why?}`: only a decision that is active now (404 otherwise).
  - `POST /api/duty/drafts/:id/dismiss` appends `{kind:"dismiss", draft, at}` to `duty-drafts.jsonl` (a line without `id`, so it does not count in `DD-n` numbering). A confirmed draft cannot be dismissed.
  - `GET /api/duty/decisions`: active decisions, draft → decision map, dismissed drafts (read only, same data as the brief).
- **Cards.** A `note` draft card now has **확정** and **버림** (states: pending, `확정됨 · SD-n`, `버림`, `until이 지났습니다`; greyed when done). `atcctl duty card DECISIONS retire` (the existing `duty card` command and guard rule; no new subcommand) requests a **retire card**: the list of active decisions, each with **해제**. `charter` drafts stay read-only (D5). The drawer reads `/api/duty/decisions` when a draft arrives, when the screen's snapshot changes and after a click; no new polling.
- **Brief content** (`server/duty-brief.ts`). A first section `STANDING DECISIONS n` with the last `duty.briefDecisions` (default 20, 1 to 100, `duty.json`) active decisions, oldest first: `SD-n — <text> (until …)`, and `… k older decisions not shown` when more are active. The text is the SUPERVISOR's own, folded to one line and cut at 300 characters. The brief still carries keys, counts and atc terms, never ticket or PR text. The cap `briefMaxChars` cuts the other sections first; decisions are cut last and the cut note names `DECISIONS`. D1's leftover is fixed: an absolute path inside an alert key is shortened to its last segment (the STAND name).
- **Manual.** `duty/CLAUDE.md` and `.en.md`: a section "정해 둔 결정" / "Standing decisions" (the list at the top of every turn is all the rules in force, earlier chat is not a decision, propose with `duty note` then ask for the confirm, retire card, what to do on `brief unavailable`); the tool table and "How it works" no longer tell DUTY to call `duty brief` at every start.
- **Pilot's discretion.**
  - The retire card is requested with `duty card DECISIONS retire` so that `duty/guard.mjs` needed no change (a new allowed subcommand would have loosened the guard).
  - A decision's text cut is 300 characters per row in the brief; 20 rows of the full 1,000 characters would not fit the 6,000 cap.
  - The confirm and dismiss buttons act at once (the card itself is the confirm), unlike D3's inline buttons that ask first, because nothing runs: a decision only changes what the brief says.
  - An `until` in a note is checked when it is proposed and again when it is confirmed.
- **Checked (2026-09-30).** `npm test`, `tsc`, `vite build`. New cases: the hook with the server down (closed port, exit 0), slow, HTTP 500, empty and broken answers, and the real script against a local server; the decisions fold (retire, `until`, duplicates, broken lines); confirm and retire and dismiss routes refuse without an Origin, from another site and without a JSON content type, and write nothing; the confirmed text comes from the draft; double confirm, dismissed, past `until`; brief order, `briefDecisions`, cap and cut order, path shortening; settings pin (`UserPromptSubmit` only beside `PreToolUse`, `|| exit 0`). 7702 test server (`ATC_GITHUB=off`, temporary state folder), real DUTY on acct-2, about $0.23 of FUEL in all:
  - "rule: reject acct-1 proposals until 2026-12-31" → DUTY called `duty note` and a note card appeared; **확정** wrote `SD-0001` to `decisions.jsonl` and the card showed `확정됨`;
  - NEW SHIFT, then "what rules are in force?" with no tool call → DUTY answered `SD-0001` and its text, from the brief;
  - "I want to drop it" → DUTY called `duty card DECISIONS retire`; the retire card listed `SD-0001`; **해제** wrote a `retire` line and the card showed none active; the next turn answered that no rule is in force (the brief had `STANDING DECISIONS 0`);
  - with the server stopped (by saved PID), one real turn run with the same argv and `ATC_URL` at the closed port: the hook event was `brief unavailable: ECONNREFUSED` with exit 0, the turn ran, and DUTY said it could not know the rules and did not invent any;
  - `DUTY BRIEF` does not appear in `duty.jsonl`. The test server, its state folder and the direct run were stopped by saved PID.
- **Left for later.** OCC reading charters and the `charter` confirm (D5); a screen list of active decisions outside a card; editing a proposed note before confirming; showing which decisions a brief cut.

### G4 as built (ATC-232)

The IDEAS drawer and ADOPT. Tier **`user`**: `duty/guard.mjs` changed (one word in the allowed `duty` subcommands) and `deploy/landing-tier.mjs` (a description string). No GitHub write anywhere.

- **Route chosen (PILOT'S DISCRETION): `atcctl duty idea <n>`.** The guard allows only `gh pr view|list|checks|diff`, so DUTY could not run `gh issue view`; widening `gh` to `issue` would have let it read any issue of any repository. `duty idea <n>` goes through atc, which reads one fixed repository. So `duty/guard.mjs` gets `idea` in `DUTY_SUBS` (still fail-closed; `gh issue …` stays refused, pinned in `guard.test.mjs`), and `duty/settings.json` needed no change (`duty *` is already allowed).
- **Server (read only).** `GET /api/ideas` (open issues labelled `idea`: number, title, labels, updated, comment count, first 300 characters of the body with heading marks removed) and `GET /api/ideas/:n` (body up to 20,000 characters, first 20 comments, and the ADOPT text). Shaping is pure (`server/ideas.ts`, tested); the routes are `server/ideas-run.ts`; the two `gh issue list|view` calls are in `server/sources/github.ts`, so the landing tier list has no new file. The repository is the constant `IDEAS_REPO = "chaehy5665/atc"`: the request cannot name another one, and private ideas (another repository) are never fetched. `:n` must be a positive integer; an issue that is closed or has no `idea` label is 404 (so a PR number cannot be read through it). Each call is cached 60 s on open (`makeCache`, errors not cached); nothing is polled. `ATC_GITHUB=off` answers 503 `GitHub off (ATC_GITHUB=off)` with `off: true`.
- **Drawer.** `#ideas` and `#ideas/<n>` (`drawerOfHash`), a lazy chunk in the same shell as the FLIGHT and PR drawers (`web/src/IdeasDrawer.tsx`; Esc, backdrop, ×, Back; full screen under 600 px). Openers: an `IDEAS` link in the DUTY drawer head (always shown, also when DUTY is off) and the address. The list is sorted by last update; each row links to the detail, which shows author, updated, labels, the safe-Markdown body, the comments and `↗ GitHub`. Back from a detail returns to the list.
- **ADOPT.** In the detail, `ADOPT…` then one confirm (`보내기`) posts the text the server built, unchanged, to the existing `POST /api/duty/message` from the screen's own fetch (so `fromThisApp` holds). Text: `ADOPT idea #<n> "<title>" — read it (duty idea <n>) and propose a design outline: problem, current facts to check, principles, steps. Do not write files.` The title is one line, without `"`, cut at 120 characters. It works only while DUTY is enabled and not blocked; otherwise the row shows the reason. After sending, the screen goes to `#duty`.
- **`atcctl duty idea <n>`** (read only) prints labels, comment count and URL, then the title, the body and the comments between `BEGIN DATA`/`END DATA`, like `duty flight`.
- **Manual.** `duty/CLAUDE.md` and `CLAUDE.en.md`: the `duty idea` row and a section "ADOPT" / "ADOPT (an idea to a design outline)": outline only, Korean to the SUPERVISOR, no file and no GitHub write, the design document comes later in a worktree (D7) or from ENGINEERING. Guide page "DUTY 채팅" gets IDEAS and ADOPT.
- **Pilot's discretion.**
  - The detail accepts only open issues with the `idea` label; a stale link to an adopted or closed idea shows a 404 text.
  - Only the first 20 comments are shown, with a note when there are more.
  - The list holds at most 100 issues (`gh issue list --limit 100`).
  - A message sent by ADOPT waits in DUTY's queue like any message if DUTY is answering.
- **Checked (2026-09-30).** `npm test`, `tsc`, `vite build`. New cases: idea number and address parsing, list shaping (label filter, sort, preview, comment count), detail shaping (open and label only, 20 comments, cut, unsafe URL dropped), the ADOPT text, `duty idea` output with the data markers, and the guard (`duty idea` allowed, `gh issue list` still refused). Test server on 7702 with a temporary state folder and real GitHub reads (DUTY enabled there only): `/api/ideas` returned the 15 open `idea` issues of the atc repository, `/api/ideas/<n>` the detail with the ADOPT text, a PR number 404, a non-number 400. One real ADOPT on acct-2 (about $0.10): DUTY ran `duty idea 271` and one Grep, answered in Korean with an outline (problem, facts to check, principles, steps, two questions) and wrote no file. Playwright at 1280 and 390 px in `radar` and `night`: the list and a detail open, no horizontal overflow, the drawer 560 px and full width, the `IDEAS` link is in the DUTY head. With `ATC_GITHUB=off` (7703, because another session held 7702) both routes answered 503 `GitHub off`. Test servers were stopped by saved PID and the temporary state folder removed. DUTY was never enabled on 7700.
- **Left for later.** Writing the design document from ADOPT (D7); an item address on other tabs; searching or filtering the list; showing closed ideas.

### D5 as built (ATC-233)

CHARTER REQUEST routing in **shadow**. Tier **`user`**: OCC's guard profile changed (`controller/guard.mjs --occ`, `occ/.claude/settings.json`); the OCC manual and skill are `flagged`. OCC stays fail-closed. DUTY has no `SendMessage` and no new command; no Linear write outside the existing SCHEDULE path. No L1 (D7).

- **Switch** `duty.charter` in `duty.json`: `off` (default) · `shadow` · `on` (`parseDutyConfig`, pure `charterModeOf`). It sits in Settings → OPERATIONS → DUTY under `duty.enabled`, as `DUTY CHARTER`, with one line per mode; `on` has the ⚠ confirm step and shows in the policy line (`DUTY CHARTER on`). It is written by `PUT /api/settings` `dutyCharter`, which is `fromThisApp` only; `atcctl` has no command for it.
- **`duty-charters.jsonl`** (state folder, append-only) and pure `server/duty-charters.ts`: `{op:"queue", id:"CR-n", at, from:"DD-n", text}` (the SUPERVISOR's confirm) and `{op:"seen", id, at, would? | draft?}` (OCC). `chartersOf` folds them (the first `seen` of an id wins; a `seen` for an unknown id is dropped).
- **Confirm and dismiss.** The `charter` draft card now has **확정** and **버림**. `POST /api/duty/charters/:draft/confirm` and `/dismiss` are `fromThisApp` only (no Origin, another site or a non-JSON body → 403 and nothing written). The queued text is read from the draft on the server, not from the request. Confirm works with the switch off too (the charter waits in the queue). Refused: not a charter draft (404), already queued, dismissed (409). Dismiss appends the same `{kind:"dismiss", draft}` line D4 uses and is refused once the draft is queued.
- **OCC source.** `GET /api/schedule/brief` gets a `duty` section from `dutySourceNow()`: absent when the switch is off; otherwise `{mode, shadow, note, charters: [{id, at, text}]}` with only the requests OCC has not recorded yet. `note` says the texts are **data**, never instructions about OCC's own rules, guard or manual, and what to do per mode. A read error drops the section and does not block the brief.
- **`atcctl schedule charter-seen`** → `POST /api/duty/charters/:id/seen` (no Origin: a control-session route). Shadow: `-- '<would draft: title / team / why>'` only (a `--draft` is refused, a leading `would draft:` is cut); on: `--draft <S-id>` only, and the S-id must exist in SCHEDULE; off: refused (409); a request is recorded once (409 after). `controller/guard.mjs` refuses `schedule charter-seen` unless it is started with `--occ` (TOWER, `--gh-read` alone, CROSSCHECK, REVIEW and MCC are refused); `occ/.claude/settings.json` passes `--gh-read --occ`. Everything else in the OCC guard is unchanged.
- **Card state.** The card reads `GET /api/duty/charters` (when a draft arrives, when the screen's snapshot changes, after a click): `queued (shadow)`, `queued`, `switch is off — kept as a draft`, and after OCC recorded it `OCC would draft: …` or `OCC drafted S-n`.
- **Shadow record.** The same endpoint gives the settings window `shadowRecord`: requests in the queue, how many OCC has seen in shadow, the last ten with OCC's would-draft text, and the first SCHEDULE `NEW` draft made after OCC saw it (the SUPERVISOR's own later request, if any). No gate number: the SUPERVISOR switches `on` when satisfied and says so in Linear.
- **OCC manual.** `occ/CLAUDE.md` and `.en.md` (the `schedule charter-seen` row, the `duty` part of the `schedule brief` row, the data rule) and `occ/.claude/skills/tick/schedule.md` and `.en.md` (a new part "DUTY의 CHARTER REQUEST" / "CHARTER REQUESTs from DUTY"); [occ.md](occ.md) and [occ.ko.md](occ.ko.md) 5.1 list the new source. The DUTY manuals say a confirmed charter is read only after the card shows it.
- **Pilot's discretion.**
  - `charter-seen` lives under `/api/duty/charters/:id/seen` (DUTY's data) while the command is `schedule charter-seen` (OCC's vocabulary).
  - A request OCC finds too small for a ticket is recorded in shadow as `would draft: none — AD HOC, no ticket needed`; in `on` nothing is recorded, because `--draft` needs a SCHEDULE draft.
  - The shadow record's "later request" is the first SCHEDULE `NEW` draft made after OCC's record, whoever asked; atc cannot tell which request it answered.
  - A scratch OCC session was not run: the guard hook was run by hand with and without `--occ`, and the brief and `charter-seen` with the real `atcctl` against the test server.
- **Checked (2026-09-30).** `npm test`, `tsc`, `vite build`. New cases: switch parsing, the fold, confirm/dismiss/seen rules per mode, the brief section per mode (`off` absent, `shadow`, `on`, seen ones dropped, a broken `duty.json` reads as off), routes refusing without an Origin, from another site and without a JSON body, the card states, the shadow record, the settings policy (`on` ⚠), and the guard profiles (`--occ` passes, TOWER, `--gh-read` only, CROSSCHECK, REVIEW and MCC refuse; redirection, substitution and other commands still refused for OCC). 7702 test server (`ATC_GITHUB=off`, temporary state folder, `duty.charter` shadow), one real DUTY turn on acct-2 (about $0.08 of FUEL):
  - DUTY called `duty charter` and a CHARTER REQUEST card appeared; clicking **확정** wrote `CR-0001` and the card showed `확정됨 · queued (shadow)`;
  - `atcctl schedule brief` showed the `duty` section in shadow with `CR-0001` as data; a hand-run `atcctl schedule charter-seen CR-0001 -- 'would draft: …'` was recorded and a second one refused; the section then listed no charters and the card read `OCC would draft: …`;
  - the settings window showed `DUTY CHARTER shadow`, its note, and the shadow record (1 queued, 1 seen, the would-draft text, no later `NEW` draft); `PUT /api/settings {dutyCharter:"on"}` worked from the app, a bad value was 400 and a call without an Origin 403;
  - the guard hook by hand: `--gh-read --occ` exit 0, `--gh-read` only and no flags exit 2.
  - The test server and its state folder were stopped and removed by saved PID.
- **Left for later.** A gate number for `on`; OCC's own `charter-seen` for charters it decided not to draft in `on`; L1 (D7).

### D7a as built (ATC-235)

L1 powers: DUTY edits only its own `duty-*` STANDs, commits and pushes `claude/duty-*` branches, opens PRs, and writes Linear through the server. Tier **`user`**: `duty/settings.json`, `duty/guard.mjs`, the root `CLAUDE.md` and `CLAUDE.en.md`, and `deploy/landing-tier.mjs` changed. No code work in DUTY's conversation (L2 stays out); the code path is D7b. **Off by default**: the routes answer 403 until the SUPERVISOR sets `"l1": true` in `duty.json`.

- **STAND.** `atcctl duty stand <name>` → `POST /api/duty/stand {name}`. The server runs the git commands (`fetch`, `worktree add --no-track <repo>/.claude/worktrees/duty-<name> -b claude/duty-<name> origin/main`) and hard-links `node_modules` (`cp -al`, only when it is a real folder). `duty stand-done <name>` → `POST /api/duty/stand-done` removes it: only a registered `duty-*` STAND, and only when it has no uncommitted change, or its pushed branch (`origin/claude/duty-<name>`) is already in `origin/main`; the branch stays. The name is lowercase letters, digits and hyphens, 40 characters at most, with no ATC key (`server/duty-stand.ts`, pure and tested). Creating and removing run one at a time.
- **Guard (`duty/guard.mjs`, fail-closed).** `--tools` is now `Bash,Read,Glob,Grep,Edit,Write`.
  - **Edit and Write**: only a `.md` file inside a `duty-*` STAND, judged on the **resolved** absolute path (symlinks followed; a dangling link, a loop or an unreadable node refuses). A path with a `..` segment is refused outright: `resolve()` tidies the text first but the OS follows a symlink first, so `docs/link/../x.md` could name another place. Refused even inside the STAND: `duty/` (all of it, which includes `settings.json`, the guard and this manual), `*guard*`, `.claude/` and `.github/` at any depth, `package*.json`, `deploy/`, `hooks/`, the root `CLAUDE.md` and `CLAUDE.en.md`, `.env*` and `.git*` at any depth, `node_modules` (hard-linked to the running service's folder) and the STAND folder itself.
  - **git**: `-C <STAND>` (or a cwd inside one; the folder must exist and resolve into a `duty-*` STAND): `status|diff|log|show` (the L0 read bans stay), `add` with `-A --all -u --update` and relative paths only, `commit` with `-m|--message[=]`, `-a`, `-q` only (no `--amend`, `-n`, `--no-verify`, `-F`, `-C`, combined short flags), `push [-u] origin claude/duty-<name>` (one ref; no `--force`, `+`, `:`, `--delete`, tags or other remotes), `fetch [-q] origin [main]`, `merge [--no-edit] origin/main` or `--abort`. Outside a STAND only the L0 reads work.
  - **gh**: `pr create` with exactly `--base main --head claude/duty-<name> --title <text> [--body <text>]` (long or short flags, `--flag=value`); no `--draft`, `--web`, `--fill`, `--repo`, `--body-file`, labels or reviewers, no repeats. `pr view|list|checks|diff` stay; `pr merge|edit|comment|ready|close`, `api` and the rest are refused.
  - **atcctl**: `duty stand|stand-done|linear` join the `duty` subcommands.
- **Settings (`duty/settings.json`).** Allow: `Bash(gh pr create *)`, `Bash(git -C <worktrees>/duty-* *)`, `Edit(//<worktrees>/duty-*/**)`. Deny: `Edit(…)` for the same self-authority paths as the guard, as a third lock. **There is no `Write(path)` rule**: Claude Code ignores `Write(path)` rules with a warning ("only `Edit(path)` rules are matched by file permission checks; Edit rules cover all file-editing tools"), and an `Edit(path)` rule covers `Write` too. The permission layer is a second door; the guard is the first.
- **Linear through the server** (`server/duty-linear.ts` pure, `sources/linear-write.ts` calls, `server/duty-l1-run.ts` route): `atcctl duty linear create|update|comment` → `POST /api/duty/linear`. Team **ATC** only (an issue of another team is refused, also as `parent`). `create` needs `title`, `body` (Markdown) and a **priority 1–4** (no-priority issues are dropped by DISPATCH's planner); `state` is `Backlog` (default) or `Todo`; `parent`, `project` and `labels` by name (labels must already exist, none are created). `update` changes title, body, priority and labels (add only); a state move only between Backlog and Todo and only from a Backlog or Todo state. `comment` needs `key` and `body`. There is no delete, close, archive, assign or state beyond Backlog and Todo; unknown fields are refused. One FLIGHT RECORDER line per call (`kind: "duty"`, `by: "DUTY"`, `op`, `action`, `key`, `ok`, the error; **never the body**), refusals too. This replaces the "(MCP)" of the L1 row (section 3.5).
- **Routes.** All three are **off unless `duty.json` `l1` is true** (403), and refuse **any request that carries an `Origin` header** (403): atcctl sends none, a browser always does. They have no screen button. `duty.json` gets `l1` (`parseDutyConfig`); no Settings item yet.
- **Rules move.** Root `CLAUDE.md` and `CLAUDE.en.md`: "ENGINEERING" becomes "DUTY (design and work orders, formerly ENGINEERING)"; the ENGINEERING session stays as break-glass under the same rules. `naming.md` and `naming.ko.md`: DUTY is a control session with L1. `duty/CLAUDE.md` and `CLAUDE.en.md` get the ENGINEERING duties and the root rules that apply (design doc shape, English first, `Fixes` only when a PR completes the issue, no ATC key in a design PR's title or branch, full GitHub URLs in Linear bodies, a priority on every work order, never a Draft PR, public repository, changelog fragments). The ADOPT text now asks DUTY to open a STAND and write `docs/<topic>.md` as a design draft PR **after the SUPERVISOR agrees in the chat** (`server/ideas.ts`).
- **Tiers.** `deploy/landing-tier.mjs` needed only `server/duty-l1-run.ts` (git worktrees and Linear writes) on the side-effect list, and a comment on `sources/linear-write.ts`. A PR from a `claude/duty-*` branch has no special case: the tier comes from the changed paths, so a docs-only PR is `auto` and MCC lands it, and anything under `duty/`, `.claude/` or the root `CLAUDE.md` is `user` (and DUTY cannot write those anyway).
- **Pilot's discretion.**
  - **Docs only.** Edit and Write reach `.md` files only. The issue listed the self-authority paths; "no code work beyond docs and manuals" is enforced by the extension too, so a design PR cannot carry code even by mistake.
  - **All of `duty/` is refused**, not just `settings.json` and the guard: the manual (`duty/CLAUDE.md`) sets DUTY's own rules, and the folder is tier `flagged`, so MCC could land a manual change without the SUPERVISOR. Also refused: the root `CLAUDE.md` and `CLAUDE.en.md`, `.git*`, and `node_modules` (a write through the hard link would change the running service's dependencies).
  - **`l1` switch, file only.** The issue asked for no switch; a default-off `duty.json` `l1` makes "never enable it on production" true until the SUPERVISOR decides. A Settings item is left for later.
  - **`..` is refused** in Edit, Write and `git -C` paths (the symlink case above); the model passes cleaned absolute paths.
  - **Origin.** The L1 routes refuse every request with an `Origin` header, not only foreign ones: they are for atcctl, and the screen has no button for them.
  - **Backlog is the default state** for `duty linear create`; `--state Todo` is what makes DISPATCH read it.
  - **Labels add only**, and only existing ones; a missing label is a 400 rather than a silently created label.
  - **`stand-done` "merged"** means a pushed `claude/duty-<name>` that is now inside `origin/main`. A brand-new branch is always an ancestor of `origin/main`, so ancestry alone would let a STAND with unpublished notes be removed.
  - **`gh pr create` needs `--title`**, and `--body` is optional; no `--fill`.
  - **A local stub endpoint for Linear.** `ATC_LINEAR_WRITE_URL` is honoured only when it points to `127.0.0.1` or `localhost` (tests and this check); any other value is ignored. Nothing else in the server changes when it is set.
- **Checked (2026-09-30).** `npm test` (1,993 of 1,994 pass, 1 skipped, as before), `tsc` and `vite build`.
  - New tests: `duty/guard-l1.test.mjs` (every allowed and refused path and git or gh form: symlinks out of the STAND, to its own `duty/settings.json`, to other STANDs, dangling and looping links, `..` through a symlink, the self-authority paths at every depth, non-doc files, other worktrees, a `duty-*` name that is really a symlink outside, forced pushes and other refspecs, `--amend`, `-n`, `--no-verify`, `--draft`, and every non-create `gh`), `duty/settings.test.mjs`, `server/duty-stand.test.ts`, `server/duty-linear.test.ts`, `server/duty-l1-run.test.ts` (real git against a scratch repository whose `origin` is a local bare repository: STAND creation, a doc committed and pushed to the bare origin, removal rules, the switch, the Origin refusal, every Linear refusal and the recorder lines), `controller/atcctl-duty.test.mjs`, `deploy/landing-tier.test.mjs`.
  - **A scratch clone of this repository whose `origin` is a local bare repository** (no push to GitHub), a test server on 7702 (`ATC_GITHUB=off`, temporary state folder, no `.env.local` so nothing reads Linear, `duty.json` with `enabled` and `l1`), a fake Linear on `127.0.0.1`, and a `gh` stub that only logs its arguments (put first on DUTY's `PATH` through `ATC_CLAUDE_BIN`). One real DUTY run on acct-2 (claude-sonnet-5-5), **$0.19 in two turns**, all through the real spawn, guard and settings: `duty stand e2e-note` opened the STAND; `Write` created `docs/e2e-note.md`; `git -C <STAND> add -A && commit && push -u origin claude/duty-e2e-note` reached the bare origin (the branch and file were there); `gh pr create --base main --head claude/duty-e2e-note --title … --body …` reached the stub with exactly those arguments; `duty linear create --title 'E2E check' --priority 4` reached the fake Linear as a `Backlog` issue with the priority; `Write` to `/tmp/outside-stand.md` and `Edit` to a file in the scratch main checkout were refused by the guard hook (its message); `Write` and `Edit` to `duty/settings.json` and to the STAND's `CLAUDE.md` were refused by the deny rules; an `Edit` of `docs/e2e-note.md` inside the STAND worked. Nothing was written outside the scratch folder. Everything was stopped by saved PID and the production service on 7700 was not touched.
  - **Two things the run showed.** (1) A scratch folder **under `~/.claude/`** (the job temp folder) makes every write "a sensitive file" even with a matching allow rule (D0 saw it for the config folder); the check moved to `/tmp`. Production STANDs are under the repository, not under `~/.claude`, and the same probe passed there. (2) `Write(path)` rules are ignored (above). Also, the scratch clone's `node_modules` was a symlink (`/tmp` is another filesystem, so no hard link): `add -A` committed it, so `stand` now hard-links only a real folder.
- **Left for later.** D7b: `duty work` LAUNCH cards and the ARRIVED report to DUTY as a card; a Settings item for `l1`; tidying a STAND automatically after its PR merges (`stand-done` is a manual call for now).

### DUTY ACCOUNT as built (ATC-242)

The SUPERVISOR picks the ACCOUNT DUTY runs on in Settings → OPERATIONS → DUTY (a **DUTY ACCOUNT** dropdown under the DUTY switch). Before, `duty.json` `account` could only be hand-edited. Tier `flagged` (server settings, and DUTY spawns processes on an ACCOUNT). No change to `duty/settings.json`, `duty/guard.mjs` or `duty/CLAUDE.md`.

- **Setting.** `PUT /api/settings` accepts `dutyAccount: "<label>"` (SUPERVISOR only: this screen's Origin and a JSON Content-Type). The label must be in the ACCOUNT registry (`fleet.json` accounts); an unknown or empty label is a 400 (`errors.dutyAccount`). It is saved with `saveDutyConfig({ account })` (`server/duty-account.ts`, pure and tested). `GET /api/settings` `duty.accountWarning` is set when the saved label is no longer registered: DUTY then runs on `~/.claude` (as the LAUNCH ACCOUNT does) and the block shows the warning. `parseDutyConfig` still accepts old files.
- **Screen.** The options are the ACCOUNTs from `GET /api/fleet/launch-accounts`. **Not logged in** is disabled with its reason. **FUEL hold** stays selectable with a warning line, because DUTY runs only on the SUPERVISOR's own messages and blocking it could leave no DUTY when every ACCOUNT is high. The row says the change applies from the next message and that the conversation starts fresh, and points to the control sessions' LAUNCH ACCOUNT (ATC-239, AGENTS tab), which is a separate setting: DUTY is not LAUNCHed like the other control sessions.
- **A change starts a fresh DUTY session** (`--resume` does not cross config folders, `docs/accounts.md` 1). The runtime stores the ACCOUNT next to the session id (`duty-session.json` `account`; an old file without it resumes as before). A running turn **finishes on the old ACCOUNT** (state machine flag `retiring`); the process then closes, messages queued in the meantime go to a new process on the new ACCOUNT with a new `--session-id` and no `--resume`, and a later message does the same. Like NEW SHIFT, the brief and `decisions.jsonl` carry over and the conversation does not. If `duty.json` was edited by hand (or changed while the server was down), the next spawn sees that the stored session was started on another ACCOUNT and starts fresh too.
- **Record.** `duty.jsonl` gets `{kind: "account", from, to, by: "SUPERVISOR"}`; the drawer shows it as a notice ("DUTY ACCOUNT acct-2 → acct-3 · next message starts a new conversation"). The drawer head line (`DUTY · <account> · context …`) follows the new ACCOUNT at once, through the status event.
- **Pilot's discretion.** FUEL hold is selectable with a warning (the issue's choice). A running turn is finished on the old ACCOUNT rather than killed (the issue's wording), which needed the `retiring` state. A saved label that left the registry falls back to `~/.claude`, not to a refusal, as `launchAccountOf` does. An old `duty-session.json` without `account` resumes as before.
- **Checked.** `server/duty-account.test.ts` (validation, fallback, resume decision), `server/duty-machine.test.ts` (`retiring`), `server/duty-run.test.ts` with the fake `claude`: after a change the next spawn has the new `CLAUDE_CONFIG_DIR` and no `--resume`; a turn running at save time finishes and the queued message is answered by the new process; a stored session from another ACCOUNT is not resumed after a restart.

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
