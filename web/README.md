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
- The same stream carries `version` (the bundle the server serves). `main.tsx` takes the page's own bundle from `new URL(import.meta.url).pathname` (`/assets/index-<hash>.js` in a build) and `NewVersion.tsx` shows "새 버전이 배포됨 · 새로고침" under the header when they differ (`showNewVersion` in `server/version.ts`). It never reloads on its own; 닫기 hides it for that build while the tab is open. In dev (`/src/main.tsx`) or with no server build it never shows.
- **Code splitting.** Only RADAR (the default tab) and the shared parts (header, new-version notice, SSE) are in the main bundle. Every other tab is a `React.lazy` chunk loaded the first time it opens, with its CSS and any library only it uses (DOCS carries `marked` and the guide Markdown). `lazyTab.tsx` wraps the named-export views. While a chunk loads, the tab shows "화면 불러오는 중…". Build (2026-09-27): main `index` 261 kB (83 kB gzip, was 512 kB / 159 kB in one bundle) plus 47.7 kB CSS; DOCS 107 kB; DISPATCH 46 kB; SCHEDULE 28 kB; FLEET 24 kB; NETWORK 16 kB; the rest under 12 kB. The 500 kB warning is gone.
- **Old tab after a deploy.** The build empties `web/dist`, so a tab opened before a deploy asks for chunk files that no longer exist (404). Each tab sits in its own error boundary (`TabBoundary`): a failed chunk shows "이 화면을 불러오지 못함" in that tab only, with a 새로고침 (reload) button. The text says a new version was deployed when the server's build differs from the page's (`showNewVersion`), and otherwise that the file could not be fetched. `isChunkLoadError` (`server/version.ts`) recognises the Chrome, Firefox, Safari and Vite CSS-preload messages. Tabs already loaded keep working, the page never reloads on its own (typed text survives), and the new-version notice still shows. Any other error in a tab is caught the same way instead of blanking the whole screen. The build id stays the entry script: its hash changes whenever any lazy chunk or its CSS changes, because the entry embeds their file names.
- `derive.ts` builds lookup indexes from a snapshot (ticket → worktree → claim → session, session location, ordering).
- Types come straight from the server (`../../server/model.ts` and friends), so the UI and API can't drift apart.
- METRICS, DISPATCH and SCHEDULE fetch their own endpoints (`/api/metrics`, `/api/dispatch/…`, `/api/schedule/brief`) and refetch once a minute (keyed to the snapshot time).

## Screens

Tabs are addressed by URL hash; old bookmarks (`#map`, `#teams`, `#tickets`) still open.

| Tab | Hash | File | Shows |
|---|---|---|---|
| RADAR | `#radar` | `views/Map.tsx` | Session ─ worktree ─ ticket columns joined by lines, ordered by barycenter to reduce crossings |
| STRIPS | `#strips` | `views/Teams.tsx`, `views/Teams.css` | LANDING SEQUENCE at the top (open PRs from `snapshot.pulls`: CLEARED TO LAND by `readyAt`, then APPROACH folded, Drafts muted and folded; a notice when `github.error` is set), then one flight strip per session: status, STANDs held with each STAND's PR badge (`CLEARED TO LAND` + `SEQ n`, or `APPROACH` + block count and the blocks behind a toggle, `#PR` link), tickets, CLEARANCEs (awaiting READBACK blue, NO READBACK orange, READBACK dotted) |
| FIDS | `#board` | `views/Tickets.tsx` | A DEPARTURES board (TIME · FLIGHT · DESTINATION · AIRCRAFT · STAND · PRI · REMARKS) or a board by flight phase |
| AIRPORTS | `#airports` | `views/Airports.tsx` | Repository registry: open, rename, close, reopen, delete; home and TRANSIENT aircraft |
| METRICS | `#metrics`, `#metrics/leaks`, `#metrics/misfire`, `#metrics/fuel`, `#metrics/network` | `views/Metrics.tsx` | Sub-views OPERATIONS, LEAKS, MISFIRE (every automatic lane: DISPATCH, SCHEDULE, FLEET PLAN, `views/MetricsMisfire.tsx`), FUEL and NETWORK (`views/Network.tsx`, the Stage 4 read-only overview from `GET /api/network`; the old `#network` opens it) |
| FLEET | `#fleet` | `views/fleet/Fleet.tsx` (one file per part in `views/fleet/`) | Every AIRCRAFT with status, current FLIGHTs and profile (crew, TYPE RATINGS, ROUTES, TARGETS); ENTRY INTO SERVICE, CREW BRIEFING, AOG, RETIREMENT |
| DISPATCH | `#dispatch` | `views/Dispatch.tsx` | Stage 2 proposals: shadow verdicts in 2a; approve / reject, IN FLIGHT (sent, READBACK, overdue) and the stage 3 check in 2b; mode switch with confirmation |

The header holds the logo, tabs and counters on one row above 1760px; from 861 to 1760px the tabs move to a second header row, and at 860px and below they wrap.

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
| `src/main.tsx` | Applies saved settings before the first paint, reads the page's own bundle path, mounts `App` |
| `src/App.tsx` | Header, tabs, alert ticker, handoff list, clock; loads tab views lazily (`tabView`) |
| `src/lazyTab.tsx` | `lazyTab` (React.lazy for named exports), `TabLoading` placeholder, `TabBoundary` (per-tab error boundary with the chunk-load message) |
| `src/useSnapshot.ts` | SSE connection (snapshots and the server's bundle); `useNow` re-renders relative times |
| `src/NewVersion.tsx` | "새 버전이 배포됨 · 새로고침" notice (a polite `role="status"` region) |
| `src/derive.ts` | Indexes and helpers over a snapshot |
| `src/aviation.ts` | Code names → aviation terms, phase colors and codes |
| `src/settings.ts` | Settings store, themes, clock formatting |
| `src/SettingsPanel.tsx` | Settings panel |
| `src/SplitFlap.tsx` | Solari split-flap characters: cells turn through the drum (space, A–Z, 0–9, `: - . /`), at most 6 flaps, left to right. Tiles fall like real flaps; text without tiles drops in letter by letter. Only flaps on screen move |
| `src/Ticker.tsx` | Scrolling alert ticker |
| `src/Starfield.tsx` | Night Sky background (30 fps cap, pauses when hidden) and today's moon phase icon |
| `src/badges.tsx`, `src/badges.css` | Small shared domain badges: AIRPORT code, OUTSTATION tag, session place, status dot, priority mark |
| `src/kit/` | Shared building blocks (L1 primitives): `Icon.tsx` (`Icon`, `IconButton`), `useDialog.ts` and `dialog-focus.ts` (dialog focus rules). One `.css` per primitive, a `.tsx` only where behaviour needs one ([design-system.md](../docs/design-system.md)) |
| `src/styles.css`, `src/views/*.css` | Theme tokens and styles |
| `src/App.tsx`, `src/App.css`, `src/AlertLive.tsx`, `src/alert-live.ts` | The top bar and the notice rows under it (ticker, ALERT list, NEW VERSION and UPDATE bars, tab error) with their CSS, and the screen-reader announcements of new alerts |
| `src/views/*.tsx` | One file per tab. FLEET is a folder, `src/views/fleet/`, one file per part (page shell, status list, card, FUEL, ENTRY INTO SERVICE, LAUNCH and CREW BRIEFING panels, editor) with its CSS next to it |
