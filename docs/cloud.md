# Cloud FLIGHT: running one ATC FLIGHT in a Claude Code cloud session

[한국어](cloud.ko.md) · **English**

How the SUPERVISOR sends one ATC FLIGHT to a Claude Code cloud session ([claude.ai/code](https://claude.ai/code)) and what that session can and cannot do. Design background (what atc itself would still need for fleet-level cloud use) is in [cloud-aircraft.md](cloud-aircraft.md); this page is the how-to (ATC-452).

## 1. What a cloud FLIGHT can and cannot do

| | Cloud session |
|---|---|
| Code, `npm test`, `npx tsc --noEmit -p .`, `npx vite build`, `git push`, `gh pr create` | Yes, as in CI. Node 24 and `npm ci` are done by the SessionStart hook `hooks/cloud-setup.mjs` before the first turn |
| Rules | The repo's `CLAUDE.md`, `.claude/settings.json` hooks and skills (`atc-task`) are carried over. `~/.claude` (memory, user MCP servers) is not |
| STAND | The session's own clone. No `EnterWorktree`, no `cp -al node_modules`. Branch `claude/atc-<n>-<short name>` |
| Spec | From the prompt text (paste the FLIGHT PLAN). `localhost:7700` is not reachable. The Linear connector, if enabled in your claude.ai settings, can be read |
| Report | `SendMessage` is not there. The final report (`atc-task` section 8, same fixed header) is the last message of the session and a PR comment |
| Screen checks | No Playwright MCP, no test server on 7702. Screen FLIGHTs (`web/`) stay local |
| Seen by atc | Only through the PR (LANDING, MCC INSPECTION, tiers apply as for a local PR). No FLEET row, no FUEL line, no DISPATCH life cycle (READBACK, DEPARTED); the PR branch carries `atc-<n>`, so the PR is matched to the FLIGHT |

Use it for self-contained docs, server, test or `auto`/`flagged` work that needs no running screen. Anything `user` tier still waits for the SUPERVISOR's merge.

## 2. One-time SUPERVISOR setup

1. **GitHub access to [c10dev/atc](https://github.com/c10dev/atc).** Install the Claude GitHub App on the repository, or run `/web-setup` in a local Claude Code session to sync your `gh` login.
2. **Environment settings** (claude.ai → Claude Code → environment for this repository):
   - *Network access*: the default "Trusted" level reaches the npm registry. The hook also downloads Node from `nodejs.org`. If your level blocks it, choose "Custom" and allow exactly these domains:

     ```
     nodejs.org
     registry.npmjs.org
     github.com
     ```
   - *Setup script*: none needed. The SessionStart hook does the work; leave it empty.
   - *Environment variables*: none needed. Do not add `.env.local` values, the repo is public.
3. Confirm once: start a cloud session on the repository and ask it to run `node -v && ls node_modules | head -3`. Expect `v24.x` and package names.

## 3. Sending a FLIGHT

- Terminal: `claude --cloud "<prompt>"`. Desktop: choose **Cloud** as the environment.
- The prompt is the FLIGHT PLAN text: the issue body from Linear (goal, Done when, constraints) plus the line `Use the atc-task skill. Branch claude/atc-<n>-<short name>. End with the section 8 report as a PR comment.` The session has no other way to read the spec.
- Open the PR as non-draft with `Fixes ATC-<n>` as for any FLIGHT. The branch name carries the key, so atc links the PR to the FLIGHT; CI (`check`) and MCC INSPECTION run on it. `auto` and `flagged` PRs land through MCC; `user` PRs wait for you.
- A cloud session cannot be recalled or messaged from atc. To stop it, stop it in claude.ai. Follow-ups (`GO AROUND`, `FIX`) go to a local AIRCRAFT through PR HOLDER.

## 4. What runs on session start

`hooks/cloud-setup.mjs` (registered in `.claude/settings.json` SessionStart):

- `CLAUDE_CODE_REMOTE` not `true` (every local session): the shell line exits 0 before node is started. Nothing runs.
- `CLAUDE_CODE_REMOTE=true`: if `node -v` is older than 24, download Node 24.19.0 from nodejs.org to `~/.cache/atc-node/v24.19.0`, prepend it to `PATH` for later Bash calls (via `CLAUDE_ENV_FILE`); if `node_modules` is missing, run `npm ci`.
- Any failure is printed to stderr and the hook still exits 0, so a broken download never blocks the session. Check `node -v` if a command fails.
- Tested in `hooks/cloud-setup.test.mjs` both ways in a temporary folder with the download and `npm ci` stubbed out.
