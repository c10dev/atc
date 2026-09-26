# web — the ATC screen

**English** · [한국어](README.ko.md)

The atc web UI: a Vite + React 19 single-page app that shows the live snapshot from the atc server in aviation terms. All data comes from the server's `/api`; the only thing it stores is your display settings, in the browser.

## Run

From the repository root:

```bash
npm run dev        # vite on :7700 (proxies /api to the API server on :7701) + API server with --watch
npm run build      # builds into web/dist, which the server serves on :7700
npm run typecheck
```

In production the systemd service rebuilds on every restart ([deploy](../deploy/README.md)).

## Data flow

```
server ──SSE /api/events (snapshot every 2 s)──▶ useSnapshot ──▶ buildIndex ──▶ views
```

- `useSnapshot.ts` opens an `EventSource` on `/api/events` and keeps the latest `Snapshot`. The header shows the connection as live / connecting / lost.
- `derive.ts` builds lookup indexes from a snapshot (ticket → worktree → claim → session, session location, ordering).
- Types come straight from the server (`../../server/model.ts` and friends), so the UI and API can't drift apart.
- METRICS and DISPATCH fetch their own endpoints (`/api/metrics`, `/api/dispatch/…`) and refetch once a minute (keyed to the snapshot time).

## Screens

Tabs are addressed by URL hash; old bookmarks (`#map`, `#teams`, `#tickets`) still open.

| Tab | Hash | File | Shows |
|---|---|---|---|
| RADAR | `#radar` | `views/Map.tsx` | Session ─ worktree ─ ticket columns joined by lines, ordered by barycenter to reduce crossings |
| STRIPS | `#strips` | `views/Teams.tsx` | One flight strip per session: status, STANDs held, tickets, CLEARANCEs (awaiting READBACK blue, NO READBACK orange, READBACK dotted) |
| FIDS | `#board` | `views/Tickets.tsx` | A DEPARTURES board (TIME · FLIGHT · DESTINATION · AIRCRAFT · STAND · PRI · REMARKS) or a board by flight phase |
| AIRPORTS | `#airports` | `views/Airports.tsx` | Repository registry: open, rename, close, reopen, delete; home and TRANSIENT aircraft |
| METRICS | `#metrics` | `views/Metrics.tsx` | FLIGHT RECORDER metrics and the stage 2 readiness check |
| DISPATCH | `#dispatch` | `views/Dispatch.tsx` | Stage 2a shadow proposals — shown only, never sent |

Across the top: the ALERT ticker (`Ticker.tsx`, scrolls only when it overflows, pauses on hover or focus) and the handoff list.

## Aviation terms

`aviation.ts` is the single place where code names become screen names: session status → AIRBORNE / HOLDING / PARKED / NORDO, Linear state → flight phase (FILED, ENROUTE, APPROACH, CLEARED TO LAND …), alerts → LOSS OF SEPARATION, NORDO STAND, UNIDENTIFIED, NO CONTACT. Code and the API keep `Session`, `Workspace`, `Ticket`, `Claim` (see the [glossary](../README.md#glossary)).

## Settings

Click the ATC logo to open the settings panel (`SettingsPanel.tsx`; Esc or a click outside closes it). Settings are stored in this browser's `localStorage` (`atc.settings`) only, not on the server.

| Setting | Values | Default |
|---|---|---|
| Theme | Radar Console (`radar`) · Glass Cockpit (`cockpit`) · Night Sky (`night`) | `radar` |
| Motion | on / off — radar sweep, stars, blinking, split-flap flips, ticker scroll | off if the OS asks for reduced motion |
| Clock | UTC (`06:24Z`) / local (`15:24L`) | UTC |
| Density | comfortable / compact (one 4px step tighter) | comfortable |
| Meteors | on / off (Night Sky) | on |
| FIDS view | list / board | list |
| FIDS range | include SCHEDULED and past ARRIVED / CANCELLED | off |

Themes are sets of CSS tokens under `:root[data-theme="…"]` in `styles.css`; `settings.ts` sets `data-theme`, `data-motion` and `data-density` on `<html>`.

## Files

| File | Role |
|---|---|
| `index.html` | Entry page |
| `src/main.tsx` | Applies saved settings before the first paint, mounts `App` |
| `src/App.tsx` | Header, tabs, alert ticker, handoff list, clock |
| `src/useSnapshot.ts` | SSE connection; `useNow` re-renders relative times |
| `src/derive.ts` | Indexes and helpers over a snapshot |
| `src/aviation.ts` | Code names → aviation terms, phase colors and codes |
| `src/settings.ts` | Settings store, themes, clock formatting |
| `src/SettingsPanel.tsx` | Settings panel |
| `src/SplitFlap.tsx` | Solari split-flap characters: cells turn through the drum (space, A–Z, 0–9, `: - . /`), at most 6 flaps, left to right. Tiles fall like real flaps; text without tiles drops in letter by letter. Only flaps on screen move |
| `src/Ticker.tsx` | Scrolling alert ticker |
| `src/Starfield.tsx` | Night Sky background (30 fps cap, pauses when hidden) and today's moon phase icon |
| `src/ui.tsx` | Small shared pieces: AIRPORT code, OUTSTATION tag, session place, status dot, priority mark |
| `src/styles.css`, `src/ui.css`, `src/views/*.css` | Theme tokens and styles |
| `src/views/*.tsx` | One file per tab |
