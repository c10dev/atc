# BROWSER GATE (ATC-520)

Every session has its own Playwright MCP server, and each starts its own headless Chrome. A burst of FLIGHTs used to start many at once and, together with the VERIFY GATE's commands ([verify-gate.md](verify-gate.md)), saturate the 8 vCPUs. The gate puts the Chrome processes in a short queue: at most N run at once on the host, across all sessions.

## How it is wired

Playwright can start a browser from any executable (`browser.launchOptions.executablePath` in the Playwright MCP config). The gate is that executable: `deploy/browser-gate/chromium-gated` runs `server/browser-gate-cli.ts`, which takes a slot and then starts the real Chrome with the arguments, stdio and the debugging pipes (fd 3 and 4) Playwright gave it. Nothing else about the MCP server changes, and screenshots keep going to the config's `outputDir` (`/tmp/playwright-mcp`): the gate writes none.

## Turn it on (SUPERVISOR)

A team session does not edit `~/.claude`. The repo only produces the config; the SUPERVISOR installs it:

```bash
node server/browser-gate-cli.ts --print-config ~/.claude/playwright-mcp.json > /tmp/playwright-mcp.gated.json
# read it, then put it in place yourself:
cp /tmp/playwright-mcp.gated.json ~/.claude/playwright-mcp.json
```

`--print-config` reads the existing config and prints it with only `browser.launchOptions.executablePath` set (the path is this checkout's `deploy/browser-gate/chromium-gated`, so run it from the production checkout). A Playwright MCP server reads the config when it starts: sessions started after the change are gated; older ones keep their own Chrome until they end. To go back, put the old file back.

## What it does

- **N at a time.** Default N is 3 (VERIFY GATE takes 2 runs of up to 3 test processes each; a browser is usually idle and sometimes one core). A slot is an `flock` on `browser/slots/slot-<i>.lock`, held by Chrome itself, so the kernel releases it however Chrome ends: closed, crashed, killed.
- **A short queue, not a failure.** With no free slot the request takes a ticket in `browser/queue/` and waits its turn (arrival order); stderr says `waiting for a browser slot: position P in line …`. Dead tickets are not counted.
- **A readable "busy".** Past the wait limit (default 90 s, under Playwright's own 180 s start timeout) no browser starts and the gate exits **75** with a message that begins `BUSY:` and says the page and the test are fine, to close a browser it no longer needs (`browser_close`) or retry in a minute. Playwright puts that stderr text in its launch error.
- **Released when the session ends.** Chrome normally exits when its Playwright parent disappears (the debugging pipe closes). If the parent is gone and Chrome is still there, the gate stops Chrome (SIGTERM, then SIGKILL after 3 s) and records `endedWithSession`; the slot is free either way.
- **Fail open.** If the gate cannot work (its folder is unwritable, `flock` is missing) it says so on stderr, starts Chrome directly and records `fallback`. No Chrome found at all is the one case it cannot start anything (exit 127, says what to set).
- **Switch.** `browserGate` (Settings → OPERATIONS → BROWSER GATE, default `on`, SUPERVISOR only, recorded as `policy / browser-gate-mode`). `off`: Chrome starts directly with no queue and no record.

An open browser holds its slot until the session closes it (`browser_close`) or ends. That is the cost of a hard limit; the BUSY answer tells the caller to close one it no longer needs.

## Settings and files

The folder is `~/.local/state/atc-gate/browser/` (`ATC_GATE_DIR` moves the parent), next to the VERIFY GATE files and separate from `~/.local/state/atc/`.

| File | What |
|---|---|
| `config.json` | `mode` (written by the switch), optional `slots` (1–8), `waitLimitSec`, `realExecutable` (absolute path of the Chrome to wrap) |
| `runs.jsonl` | one append-only line per browser request |
| `slots/`, `queue/` | slot locks, tickets |

Environment overrides: `ATC_BROWSER_SLOTS`, `ATC_BROWSER_WAIT_LIMIT_SEC`, `ATC_BROWSER_REAL`, `ATC_NODE` (the node the wrapper script uses). Without `realExecutable` the gate wraps the newest `chromium-<revision>` in Playwright's cache (`PLAYWRIGHT_BROWSERS_PATH` or `~/.cache/ms-playwright`).

## Record and misfire counter

Each line of `runs.jsonl`: `t`, `where` (`local`), `cwd` (which STAND asked), `waited`, `waitedMs`, `ranMs`, `exit`, and when they apply `busy`, `endedWithSession`, `killed`, `fallback`. The BROWSER GATE block of the settings window shows, for all time and the last 7 days: requests, requests that waited, longest wait, busy answers, slots released after the session ended, and direct starts (gate broken).

## Other AIRPORT repos (ATC-526)

A Playwright Chromium started by a script in another repo on this host goes through the same gate when the script points its browser executable at the gated launcher. It takes a slot from the same N slots, the same queue and the same counters as the MCP-launched Chrome, and gets the same `BUSY:` answer past the wait limit. Nothing about Playwright or the other repo changes beyond setting the executable.

Find the launcher with the CLI of the atc production checkout:

```bash
node <atc checkout>/server/browser-gate-cli.ts --print-launcher   # prints …/deploy/browser-gate/chromium-gated
```

Then set it in that repo's own script, for example `chromium.launch({ executablePath: "<launcher path>" })`, or `launchOptions.executablePath` in a Playwright config. `--print-config` prints the same path inside an MCP config.

- **Which repo.** Each record in `browser/runs.jsonl` carries `repo`, the top folder name of the folder the browser was started from (a STAND counts as its main repo; the full path is never recorded). The BROWSER GATE block of the settings window shows requests per repo folder name, all time and last 7 days.
- **Per-repo settings.** `repos.json` in the gate folder (see [verify-gate.md](verify-gate.md), "Other AIRPORT repos") may give a repo its own real Chrome: `{ "<repo folder name>": { "browserExecutable": "/absolute/path/to/chrome" } }`. Order: `ATC_BROWSER_REAL`, then the repo's entry, then `realExecutable` in `browser/config.json`, then Playwright's cache. Slots, queue and wait limit stay shared.
- **Same rules.** Switch `browserGate` (SUPERVISOR only, default on) and fail-open (`fallback`) are unchanged.
