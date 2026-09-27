# Working on atc

[한국어](CLAUDE.md) · **English**

> English translation for readers. Sessions load the Korean [`CLAUDE.md`](CLAUDE.md), which is the source of truth; this file is not loaded.

Rules for sessions that change atc's code (team sessions, and sessions working directly with the user). Design and terms are in `README.md` and `docs/`.

**Control sessions are excluded.** Sessions opened in `controller/` (TOWER), `occ/` (OCC) and `crosscheck/` (CROSSCHECK) follow the `CLAUDE.md` in their own folder. They load this file too, but control sessions never change code, so the working rules below don't apply to them. Where the two differ, the folder's `CLAUDE.md` wins.

## Where to work

- `/home/c10/projects/atc` (the main checkout) is the **production service folder**: the systemd service builds and runs from it. Don't change code or switch branches there.
- Work in a worktree based on `origin/main`: `git -C /home/c10/projects/atc worktree add /home/c10/projects/worktrees/atc-<task> -b claude/<task> origin/main`. For node_modules, `cp -al /home/c10/projects/atc/node_modules <worktree>/node_modules`.
- The git stash is shared by every worktree. Never use bare `git stash` / `git stash pop`; set work aside with a temporary commit.
- Don't touch the production state in `~/.local/state/atc/` (proposals, CLEARANCEs, FLEET, FLIGHT RECORDER). Test with a temporary state folder (below).

## Verification

- `npm test`, `npx tsc --noEmit -p .` and `npx vite build` must all pass.
- Pure functions are tested with `node:test` (`server/*.test.ts`, `controller/*.test.mjs`, `occ/*.test.mjs`, `hooks/*.test.mjs`).
- For an end-to-end check, run a test server on 7702: `(set -a; . /home/c10/projects/atc/.env.local; set +a; ATC_STATE_DIR=<temp folder> ATC_PORT=7702 node server/index.ts)`. Copy only the registries you need (`airports.json`, `fleet.json`) into the temp folder. Never copy or print `.env.local` (the Linear API key). Stop the server and delete the temp folder afterwards.
- Open the UI with Playwright. Don't message real team sessions during tests.

## Operations

- Don't restart the production service (7700). Merging and deploying are the user's (or done when the user asks).
- Keep the control sessions' guards (`controller/guard.mjs`, `occ/send-guard.mjs`, `occ/mcp-guard.mjs`) fail-closed (`… || exit 2`). Ask the user before loosening what they block.

## git and PRs

- Commit, push and open PRs when the task asks for it. Commit messages and PR titles and bodies are in English.
- No attribution lines (Co-Authored-By etc.) in commit messages. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- The user merges.

## Code

- Node 24 runs TypeScript directly (`node server/index.ts`). With `erasableSyntaxOnly`, don't use enums, constructor parameter properties or namespaces.
- Server: Hono. UI: Vite + React 19. Keep calculations in pure functions, separate from I/O.
- Records are append-only JSONL (`proposals.jsonl`, `clearances.jsonl`, `schedule.jsonl`, `flight-recorder/`); settings and registries are JSON rewritten atomically.
- UI colors and fonts use only the `:root` tokens in `web/src/styles.css` (so themes apply).
- Code comments are short and in Korean, like the surrounding code.

## Terms and docs

- Aviation terms stay in English everywhere: UI, docs and messages (AIRCRAFT, STAND, FLIGHT, READBACK, HOLD, CLEARANCE, HANDOFF …). Don't translate them into Korean words such as "복창". Explanatory sentences are Korean.
- A team session name `TEAM_X` is a REGISTRATION. In atc's words a team is an AIRCRAFT flown by a CREW under a CAPTAIN (`docs/fleet.md`).
- Update the English (`*.md`) and Korean (`*.ko.md`) versions together for `README`, `CHANGELOG`, `docs/dispatch`, `docs/naming`, `docs/occ`, `docs/fleet`, `docs/atfm` and each folder README. In the control session folders the Korean `CLAUDE.md` / `SKILL.md` are the originals and `*.en.md` are translations.
- Record changed behavior under `[Unreleased]` in the `CHANGELOG`.
- When how the user works changes (tabs, flows, commands, terms), update the user guide in `docs/guide/` (the DOCS tab, Korean) too. Add a new page to `DOC_NAV` in `web/src/views/Docs.tsx`.

## Plans and ideas

- Ideas not yet decided go in a GitHub Issue labelled `idea`, not in the repository docs.
- Once decided, write a design draft in `docs/<topic>.md` (Status line, Current facts, Principles, Implementation order, Risks, Decisions). New design docs start in English. Link the doc from the issue when it is adopted.
- Put a stage in `docs/guide/stages.md`, work left in that design doc's "Not built yet", and finished work in the `CHANGELOG`.
- atc's own work lives in the Linear `atc` team (ATC). atc reads every team in `LINEAR_TEAM_KEYS`, but only the configured teams (`candidateTeams` in `dispatch.json`; empty means the main team) produce DISPATCH and SCHEDULE candidates. The classification labels (`type`, `wake`, `rating:*`, `Risk`, `tail:*`) are workspace labels shared by both teams. Ideas stay in GitHub `idea` issues.

## Radio

- Don't message other team sessions. Report results and blockers only to the session (or user) that gave you the task.
