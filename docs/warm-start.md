# WARM START (ATC-539)

**English** · [한국어](warm-start.ko.md)

After a restart (for example RETURN TO SERVICE) the server needs about 90 s to read Linear, GitHub and every workspace before its snapshot is warm (`isWarm`, `server/events.ts`). Until then the screen is missing PRs. WARM START keeps the last warm snapshot on disk and shows it at once. It is **display only**.

## How it works

- **Save.** When the live snapshot is warm, the server writes it to `<state folder>/warm-snapshot.json` (`{ savedAt, snapshot }`, mode 0600). The write is atomic (temp file, then rename) and happens at most once a minute. Cold snapshots are never saved.
- **Restore.** On boot, if the file exists, parses, and is younger than `maxAgeMin` (default 10, `warm-start.json`), the server keeps it as the *restored* snapshot. `GET /api/snapshot` and the SSE `snapshot` event serve it with `restored: { savedAt, ageSec }`. The screen shows one line ("재시작 직후라 마지막 상태를 보여 주는 중입니다 …") until it is replaced.
- **Replace.** The restored snapshot is dropped, and the live one is sent, when the first live snapshot is warm, or when the restored one gets older than `maxAgeMin` (a live snapshot that never warms up, for example Linear is down).
- **Safe to delete.** A missing, corrupt, unreadable, future-dated or too-old file is a normal cold start. Deleting `warm-snapshot.json` at any time is safe. It is a new file; no existing state format changed.

## What does not use it

The restored snapshot lives only inside `WarmStart` (`server/warm-start.ts`). It is never assigned to the live `current` snapshot. So `isWarm`, `diffSnapshots` (no `alert.raised`/`alert.cleared`/LANDING events, no FLIGHT RECORDER lines), the jobs (DISPATCH, AUTOLAND, MCC, ATFM …), SUPERVISOR alerts and the summary all read live data only. Other `/api/*` routes (HOME flow, DISPATCH, …) also read live data, so they stay as cold as before until the live snapshot warms up.

## Switch

Settings → OPERATIONS → **WARM START** (`warm-start.json`, default `on`, SUPERVISOR only, no `atcctl` command). `off` neither writes nor reads the cache file. `maxAgeMin` (1–120, default 10) is edited in `warm-start.json`. There is no misfire counter: nothing acts on the data, it is only shown.
