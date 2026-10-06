# LINEAR RETRY (ATC-561)

**English** · [한국어](linear-retry.ko.md)

An occasional `fetch failed` on a Linear call used to cost the SUPERVISOR work: a `duty flight` call, an MCC INSPECTION packet (`flight ATC-n: fetch failed`) or a DUTY write failed once and had to be redone by hand. The text did not say which hop failed. This document is what was built.

## Two hops

`fetch failed` could come from two places that the text could not tell apart, and both can fail:

| Hop | Where | Label in error text |
|---|---|---|
| atc server → Linear | `server/sources/linear.ts`, `linear-write.ts`, `linear-labels.ts`, `linear-projects.ts` (all go through `server/linear-call.ts`) | `(atc server → Linear)` |
| atcctl → atc server | `call()` in `controller/atcctl.mjs` (127.0.0.1:7700) | `(atcctl → atc server)` |

An error now reads `fetch failed (atc server → Linear) [dns ENOTFOUND]`: the hop, then the cause class and code. A GraphQL error in a 200 reply keeps its own text; it is not a network failure.

## Retry

`server/net-retry.ts` (pure, no dependencies, also imported by `atcctl.mjs`).

- **What is retried.** A network-level failure (`fetch failed`: DNS `ENOTFOUND`/`EAI_AGAIN`, connect `ECONNREFUSED`/`ECONNRESET`, connect timeout, headers or body timeout) and HTTP 429, 502, 503, 504. Never retried: any other 4xx, 500, a GraphQL error in a 200 reply, a TLS error.
- **How.** Up to the configured number of retries (default 2) with exponential backoff and ±20 % jitter: about 250 ms, then about 1 s (then 4 s for a third). For 429 and 503 the `Retry-After` value if it is longer, capped at 5 s so a call cannot be held for long. Every attempt has its own 10 s timeout (`AbortSignal.timeout`), so a retry never holds the server's event loop.
- **Setting.** `linearRetries` (`0`–`3`, default `2`) in `linear-retry.json` (atomic JSON), Settings → OPERATIONS → LINEAR RETRY, SUPERVISOR only (`fromThisApp`, no `atcctl` command; a change is recorded as `policy linear-retry-count`). `0` is today's behavior. `atcctl` reads the same file from the state folder.
- **atcctl hop.** A GET is retried on any retryable failure (network failure, 429, 503). A write (POST …) is retried only when the request cannot have reached the server (connection refused, DNS, connect timeout), never after a reset or a timeout: the server may already have acted. A 502 or 504 from the atc server is not retried again by `atcctl` (the server already retried its own hop).

## A retried write never duplicates

Only writes that may have reached Linear need care; a failure before the request left the machine is simply sent again.

- **Issue create.** The request carries a client-chosen UUID in `IssueCreateInput.id`. Before each retry after a failure that may have reached Linear, the server asks for `issue(id)`; if it exists, that issue is the result and nothing is sent. The same check runs once more after the last attempt fails, so a create Linear accepted is not reported as a failure. If Linear rejects the `id` field as unknown (a validation error, so nothing was created), the request is sent again without it and the server looks the issue up by team, title and creation time (the last 5 minutes) before each retry. The title check against open ATC issues (409, ATC-488) is unchanged.
- **Comment.** Same, with `CommentCreateInput.id` and `comment(id)`; without `id`, the last five comments of the issue are searched for the same body from the last 2 minutes.
- **Relation (`blocks`).** Before a retry the issue's relations are read; an existing `blocks` relation counts as done.
- **State, label and field updates** set a value, so repeating them changes nothing.
- A read is always safe to repeat.

## Record and count

Every failed attempt, retry, recovery and final failure is a FLIGHT RECORDER line `linear-call`: `hop`, `op` (`read`, `create`, `update`, `comment`), `attempt`, `outcome` (`retry`, `recovered`, `gave-up`), `cause` (`dns`, `connect`, `timeout`, `tls`, `network`, `http`) and `code` (`ENOTFOUND`, `ECONNRESET`, `UND_ERR_HEADERS_TIMEOUT`, `503` …), plus the issue key if there is one. No issue text, no title and no token. A GraphQL error in a 200 reply is not recorded.

`atcctl` cannot write the recorder itself: after a call that failed at least once it posts its attempts to `POST /api/linear-calls/note` (every value checked against a fixed list, at most 8 per call, nothing else accepted). If the server cannot be reached at all, that attempt is not recorded; the error text still carries the cause.

`GET /api/linear-calls?days=N` (read only) returns the daily counts by hop and cause: failed attempts, calls recovered by a retry and calls that gave up. METRICS → MISFIRE shows them for the last 7 days (`LINEAR CALLS`). These counts are the misfire counter.

## What uses it

The MCC INSPECTION packet and `atcctl duty flight` go through the same retried reads (`fetchIssueDrawer` → `linearGql`), so one transient failure no longer shows as `flight ATC-n: fetch failed`. A failure that survives every retry shows the hop and the cause class in the packet text.

## Pilot's discretion

- The Linear docs list `id` as an optional field of `IssueCreateInput` and `CommentCreateInput`; this was not exercised against the live API (a write test would create real issues). The fallback above covers a Linear that rejects the field.
- Per-attempt timeout 10 s (the old fixed timeout was 15 s); jitter ±20 %; cap 5 s on `Retry-After`; `atcctl` retries 429 and 503 only.
- No new alert kind: the count is on METRICS and in the FLIGHT RECORDER.
