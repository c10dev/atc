# menubar/ — macOS menu bar for the SUPERVISOR

**English** · [한국어](README.ko.md)

A [SwiftBar](https://github.com/swiftbar/SwiftBar) plugin (ATC-149). It reads atc every 15 seconds, shows what is waiting and how bad it is in the menu bar title, and each item opens the right atc tab in the browser. **Read only**: it makes GET requests and opens URLs. Approve, ACK and the switches stay in the browser. No new endpoint, token or CORS change. User guide (Korean): [docs/guide/menubar.md](../docs/guide/menubar.md).

| File | Role |
|---|---|
| `atc.15s.mjs` | The plugin. Run by the Mac's node (`#!/usr/bin/env node`); `15s` is the refresh interval. Does the GETs, prints the menu, sends notifications, keeps the seen keys in `$SWIFTBAR_PLUGIN_CACHE_PATH/seen.json` |
| `format.mjs` | Pure formatting: alerts + fleet + update + control JSON in, SwiftBar lines out; the new-key diff; the `swiftbar://notify` URL |
| `format.test.mjs` | `node:test` on Linux (fixtures: empty, advisory only, warning, call, unreachable, Korean text with `\|`), part of `npm test` |

## What it reads

| Endpoint | Used for |
|---|---|
| `GET /api/supervisor-alerts` | Items (level, cue, text, next, link). Required: if it fails the title is `✈ —` |
| `GET /api/fleet` | `fuelAccounts` (most-used ACCOUNT: `5h 33% · 7d 53%`) and how many AIRCRAFT are `busy` |
| `GET /api/update` | The last RTS (`RTS ok 15:21 · …`) |
| `GET /api/control/sessions` | How many control sessions are working |

A missing optional endpoint only drops its line. The base URL is `ATC_URL` (default `http://localhost:7700`).

## Menu

- Title: `✈ <WARNING+CAUTION> [+<ADVISORY>] <FUEL>`. Red with a WARNING, amber with a CAUTION, plain otherwise. atc unreachable: `✈ —` and "atc 연결 안 됨: SSH 포워딩 확인".
- Items grouped by level, highest first (15 per level, then `외 n개`), each `text — next`; clicking opens `<ATC_URL>/<link>`.
- DISPATCH approvals waiting (opens `#dispatch`), the last RTS, working AIRCRAFT and control sessions, `Open atc`, `Refresh`.
- Notifications: a key new since the last run with level `warning` or cue `call` gets one `swiftbar://notify` (`open -g`). The first run marks what is there as seen and notifies nothing. Seen keys expire after 7 days.

`|` in a text is SwiftBar's parameter separator, so it is shown as `¦`. Newlines become spaces and a leading `-` (a submenu marker) becomes `–`.

## Install

See the guide. In short: install SwiftBar, point it at this folder (or copy `atc.15s.mjs` and `format.mjs`), `chmod +x atc.15s.mjs`, and make `localhost:7700` reach atc. If atc runs elsewhere use an SSH local forward (`ssh -N -L 7700:127.0.0.1:7700 <host>`). **Do not make 7700 listen on the LAN**: atc has no login and the Origin check is not access control.

Not checked on a Mac: the SwiftBar render and the notification were written on Linux (the pure module is tested there). The SUPERVISOR checks them after merge.
