---
name: test-server
description: Run an end-to-end check against a throwaway atc test server (own port, temporary state folder, ATC_GITHUB=off) and always clean up. Use when an atc FLIGHT needs to see the real server or screen working (atc-task section 5). Refuses production 7700 and the production state folder.
---

# Test server

One script starts a test server, lets you check against it, and removes everything. Use it instead of hand-writing the `ATC_PORT=7702 … &` recipe.

```bash
S=.claude/skills/test-server/testserver.mjs
node $S start                 # prints {"url","port","dir","pid"}; port is picked free from 7702-7799
node $S stop <dir>            # kills by saved PID, frees the port, deletes the folder
node $S run -- <command…>     # start, run the command with ATC_TEST_URL/ATC_TEST_PORT, always clean up
```

## Guarantees

- **Never 7700.** `--port 7700` (or anything outside 7702-7799) exits 2 with `refused`. The state folder is always a fresh `$TMPDIR/atc-ts-*` folder; `stop` refuses any other folder, the production state folder included.
- **Two FLIGHTs at once.** Ports are claimed with an atomic lock (`$TMPDIR/atc-ts-ports/<port>`); each run gets its own port and folder. A lock whose owner died is reclaimed.
- **Kill by saved PID only.** `stop` reads `server.pid`, checks `/proc/<pid>/environ` carries this folder's `ATC_STATE_DIR` and `ATC_PORT`, then `SIGTERM` (then `SIGKILL`) that PID. No `pkill`, `killall` or pattern kills (`hooks/kill-guard.mjs` blocks those anyway).
- **No GitHub, no real sessions.** `ATC_GITHUB=off`; only `airports.json` and `fleet.json` are copied (read-only) into the temporary folder; `XDG_CACHE_HOME` is inside it. `.env.local` is loaded into the child's environment and never printed or copied. Do not send messages to real team sessions from a test. The server's own SERVER SEND job (ATC-562) never writes to a session from a test server: only port 7700 with the real state folder writes. `ATC_SERVER_SEND_TEST=1` lets a test write only to a throwaway session whose cwd is under the OS temp folder (or `ATC_SERVER_SEND_TEST_ROOT`).

## Steps

1. From your STAND: `node .claude/skills/test-server/testserver.mjs start`. Keep the `dir`.
2. Check with `curl "$url/api/…"` or Playwright against `url`.
3. **Always** finish with `node .claude/skills/test-server/testserver.mjs stop <dir>`, also when the check failed. For a scripted check prefer `run -- …`, which cleans up by itself.
4. Confirm nothing is left: the port is no longer listening and `<dir>` is gone. If a check needs real PR data, that is the only reason to unset `ATC_GITHUB`; this skill does not do it (do it by hand, briefly).
