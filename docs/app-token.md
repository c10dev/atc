# App token: a credential for atc write routes, for the ANNUNCIATOR app

Status (2026-10-01): design draft for [ATC-250](https://linear.app/vocado/issue/ATC-250) (atc-app N5). Nothing is built, no token exists, no route changed. The SUPERVISOR chose option C on 2026-10-01: the app merges through atc's MERGE route (DUTY G2, [ATC-207](https://linear.app/vocado/issue/ATC-207)), not through the GitHub API. Decisions are in section 8.

**LANDING tier of the resulting server change: `user`.** It changes who may write, and it adds a credential store. The T0 and T1 PRs are `user` tier and the SUPERVISOR merges them (`deploy/landing-tier.mjs`, root `CLAUDE.md`). This draft PR only adds docs, so it is `auto`.

Related: [mac-app.md](mac-app.md) (principle 2), [duty.md](duty.md) (G2), [mcc.md](mcc.md), atc-app `docs/design.md` (N5, D3, D9, D12c).

## 1. Current facts

Verified in the code on `origin/main` (2026-10-01).

- **Write routes and the Origin check.** A SUPERVISOR-only write route calls `fromThisApp(c)` (`server/origin.ts`). It passes when the request has `Content-Type: application/json` **and** an `Origin` header whose host is `localhost`, `127.0.0.1` or `[::1]`. Otherwise the route answers 403. `atcctl` sends no Origin, so team sessions and control sessions cannot use these routes by design (ATC-34).
- **What the check is.** The Origin header is a browser convention. It stops another website from driving the SUPERVISOR's browser into a write (CSRF). It is not authentication: any process that can reach the port can send `Origin: http://localhost`.
- **Who can reach the port.** The server listens on `127.0.0.1:7700` only. Team sessions run on the same host as the same Unix user, so they can reach it. The SUPERVISOR's Mac reaches it through an SSH local forward and never over the LAN ([guide/menubar.md](guide/menubar.md)).
- **MERGE.** `POST /api/pr/:airport/:number/merge {head}` (`server/pr-merge-run.ts`). It requires `fromThisApp`, reads the PR and its files from GitHub again, computes the LANDING tier, and merges only a `user`-tier (or MCC-ESCALATEd), CLEARED, not-held PR whose live head equals `head` (the `sha` is also sent to GitHub). Every attempt, including a refusal, writes one FLIGHT RECORDER line with `by: "supervisor"`. No timer, hook or session calls it. `atcctl` has no such command.
- **The app today.** It sends only GET and SSE to atc (atc-app N5, D3, D9). The atc web UI inside the app window writes as a browser does (D9, unchanged).
- **atc has no login and no key store.** Same-user processes (including team sessions) can read and write every file in `~/.local/state/atc/`. Registers and settings are JSON written by rename (`server/account-add.ts` is one example).
- **What same-user processes cannot do today** is call a SUPERVISOR-only route *as a matter of policy*; technically a hand-written `curl` with an Origin header does. That gap exists already and this design does not close it (section 3).

## 2. Principles

1. **atc decides, the app asks.** The token only identifies the caller. Tier, CLEARED, hold and exact-head checks stay in the route and run at the moment of the merge. The app never computes a verdict (it reads atc's).
2. **A token grants less than the browser, never more.** A token reaches only the routes in its scope. It never grants settings writes, LAUNCH/STOP, token management, or anything `fromThisApp` alone does not already allow.
3. **One merge implementation.** The app does not hold a GitHub write credential (atc-app D12c). GitHub has no "merge only" permission, so a second implementation would also bypass tiers, INSPECTION and the FLIGHT RECORDER.
4. **Secrets are shown once and stored as hashes.** No token value in logs, errors, records, docs or Linear. Docs name keys, never values.
5. **Additive and tolerant.** A build without token support must keep working with a state file that has token entries (section 6).
6. **Honest about what it adds.** Section 3 says what stays unsolved.

## 3. What the token adds over the Origin check, and what it does not

| Threat | Origin check alone | With an app token |
|---|---|---|
| Another website drives the SUPERVISOR's browser | Blocked | Same (the token is not in the browser) |
| A native app on the Mac (not a browser) must write | Cannot say who it is: it would have to fake an Origin, which makes forging normal | **Adds:** a named, revocable credential, so the app does not impersonate a browser |
| A process on the Mac that is not the app, over the SSH forward | Passes with a forged Origin | **Adds:** a native-only route family requires the secret, which lives in the Keychain (11.5 rules), not on disk in plain text |
| A team session on the atc host (same Unix user) | Passes with a forged Origin (already true) | **Adds nothing against reading the host's secrets, and little else.** See below |
| A leaked token | n/a | **Adds:** revoke one device, expiry, last-used visibility |
| Audit | Record says `by: supervisor` for everything | **Adds:** `by: app` plus the token name, so app writes are separable from browser writes |

What it does **not** add, stated plainly:

- **It is not a defence against a hostile same-user process on the atc host.** That process can add its own hash to the store (3.3 below), or keep using the forged-Origin path that the browser UI needs. Closing that needs the server to run as a different user, or to hold a secret that sessions cannot read; neither is in scope. The existing guards (`controller/`, `occ/`, `duty/`, `hooks/`) already keep team sessions off these routes by policy, and that is the real control. The token should not be described as stopping them.
- It does not make the SSH forward private. Anyone who holds the Mac login can read the Keychain item through the same prompt the app gets.
- It does not prove a human clicked. Section 5 (confirmation on the Mac) does that.

So the honest gain is **separation and accountability for a native client**, not a new wall. That is enough to justify it: without it the app would send a forged `Origin: http://localhost` on every merge, which turns the Origin check into a lie and gives no way to revoke or tell app writes from browser writes.

### 3.1 Scope

- **v1: `merge` only**, i.e. `POST /api/pr/:airport/:number/merge` with `{head}`.
- Candidates for later, each a **separate decision with its own PR and `Risk: Security` review**: ACK (alerts), DISPATCH approve/reject, FLEET PLAN approve, UPDATE (RTS start). None is in this design.
- **Never in scope:** settings writes, LAUNCH/STOP, ACCOUNT changes, MCC mode, token issue/revoke, GitHub off switch, anything that is not already allowed by `fromThisApp`.
- Scope is a list of route ids stored with the token (`["pr.merge"]`), checked by a small pure function `tokenAllows(token, routeId)`. A request with a valid token on a route outside its scope gets 403 and one log line (no value).

### 3.2 Issue and pairing

- The SUPERVISOR opens the **settings window** (a `fromThisApp`-only route; it needs the browser, never a token) and presses "Add app token", names the device ("MacBook"). The server returns a **pairing code** (short, one-time, 10-minute life, e.g. 8 characters from an unambiguous alphabet).
- The app exchanges the code once at `POST /api/app/pair {code, name}` (no Origin needed, rate limited, 3.8) and receives the long token (256-bit random, base64url, prefix `atcapp_`). The token is shown **only to the app** in that response; the settings window never sees it.
- Why a code and not "copy the token from the screen": a long secret on screen ends up in the clipboard, scrollback and screenshots. A pairing code is useless after one use or ten minutes.
- The app stores the token in the **Keychain** under the same rules as atc-app 11.5 (own item, no iCloud sync, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`).
- The settings window lists tokens: name, scope, created, last used, expires, revoke button.

### 3.3 Storage on the host

- New optional file `app-tokens.json` in the state folder (atomic rewrite, mode 0600), or a key in an existing settings file if T0 prefers (**PILOT'S DISCRETION: separate file**, so a build without support never reads or rewrites it).
- Each entry: `id`, `name`, `scope`, `hash` (SHA-256 of the token with a per-entry random salt, constant-time compare with `timingSafeEqual`; the token is high-entropy so a fast hash is enough), `created`, `lastUsed`, `expires`, `revoked`. No token value.
- Pairing codes live in memory only (they die with the server, which is fine).
- **The same-user problem.** A team session can read this file (harmless: hashes only) and can **add its own entry**. What stops that:
  1. By policy, the guard paths: control sessions and DUTY cannot write outside their STANDs, and team sessions' hooks block writes under `~/.local/state/atc/` (verify at T0; if a hook does not cover it, adding it is a `hooks/` change and `user` tier).
  2. A server-held secret does not help: the server's own files are readable by the same user.
  3. **Accept and record:** adding an entry by hand is possible for a same-user process that already ignores the guards. The control is detection, not prevention: every token use writes a FLIGHT RECORDER line with the token id and name, and the settings window shows every token with its last-used time. An unknown token name in that list is the signal. **Recommendation: accept and record**, and say so in the settings window help text.

### 3.4 Request shape

- **Recommendation: the same route, `Authorization: Bearer <token>`**, no `/api/app/...` mirror of MERGE. One implementation, one set of checks; a second route family would be a second place to forget a check.
- A token request **skips the Origin check but must still send `Content-Type: application/json`** (a cheap guard against form-style CSRF if the token ever leaked into a browser) and **must pass every other check** (tier, CLEARED, hold, exact head).
- A request with both an `Authorization` header and a browser `Origin` is treated as a token request (token must be valid; a bad token is 401, not a fallback to the Origin path).
- The new helper is `callerOf(c)` returning `{ by: "supervisor" } | { by: "app", token } | null`, replacing `fromThisApp(c)` at the merge route only (T1). Other routes keep `fromThisApp` and **reject** `Authorization` tokens (403 + log): scope is enforced by routes opting in, not by a deny list.
- Only `POST /api/app/pair` is new in T0; it is outside the write routes.

### 3.5 Revoke, expiry, rotation

- **Revoke:** from the settings window (marks `revoked`, takes effect on the next request) and from the app's sign-out (`POST /api/app/revoke` with the token itself, which revokes only itself).
- **Expiry:** 30 days, **renewed on use** (sliding), so an app used weekly never expires and a lost Mac's token dies by itself. Hard cap 180 days since pairing, then the SUPERVISOR pairs again.
- **Rotation:** the app may call `POST /api/app/rotate` to swap its token for a new one (old one dies at once). The app does this when more than half the life has passed. Optional in T2.
- **ROLLBACK to a build without token support:** the older build ignores `app-tokens.json`, and the token routes do not exist. `Authorization` is ignored, so the merge route answers 403 (no Origin). Nothing is merged, nothing breaks; the app shows "atc does not accept this token" and the SUPERVISOR merges in the browser. The state file format is tolerant in both directions (unknown fields kept on rewrite, as in ATC-239).

### 3.6 Confirmation on the Mac

- A merge from the app is **never** a single click and never from a notification action, a timer or a hotkey.
- The app shows a confirm sheet with **PR title, number, AIRPORT, exact head (short sha), tier and CLEARED status** as read from atc just before showing it, and sends `{head}` for that sha. If atc answers 409 with `currentHead`, the app redraws and asks again.
- **Touch ID (LocalAuthentication) before the sheet's "Merge" button is enabled**, with the system password as fallback. **Recommendation: require it**; the token in the Keychain is then not enough for a malicious local process to merge without the SUPERVISOR present.
- The "Merge…" button appears only when atc says the SUPERVISOR may merge this PR (the app reads atc's verdict and does not compute it). This needs the verdict in the data the app already gets; T1 adds `mergeable` to the PR summary if it is missing.

### 3.7 Records

- FLIGHT RECORDER merge line gets `by: "app"` and `token: "<name>"` (the name, not the id and never the value). Browser merges stay `by: "supervisor"`.
- A SUPERVISOR-facing list: the settings window's token list shows last used and a "recent app writes" view (last 20 FLIGHT RECORDER lines with `by: "app"`).
- Refused token requests (bad token, wrong scope, expired, revoked) are recorded as one line each, with the reason and no value.

### 3.8 Brute force and abuse

- A token has 256 bits; guessing is not realistic. The pairing code has about 40 bits and a 10-minute life, so it needs the limit.
- **Limits:** 5 failed pairings or 10 failed token checks per 10 minutes (per process, in memory), then 429 for 10 minutes. A lockout does not touch valid tokens already in use (a flood must not block the SUPERVISOR). Three failed pairings kill the open code.
- No token or code value in logs, error bodies, records or `console.log`; errors say "token invalid" and nothing else. A test asserts that a request log line never contains the `Authorization` value.

### 3.9 Fit with the app's other designs

- **D12c** (merge from the app): the wording becomes "no direct GitHub merge; atc's MERGE through the app token (N5)". D12's no-GitHub-write-token rule stands unchanged.
- **D3 / D9:** D3 changes from "not in v1" to "merge only, via N5, once T0 and T1 are built". D9 is unchanged: the window's web UI keeps the browser's model; Swift writes use the token and only for `pr.merge`.
- **Work window:** the PR row shows "Merge…" only when atc says it is mergeable by the SUPERVISOR; the app reads that verdict.
- **Principle 1 of atc-app** (the server decides) is kept: atc computes the tier and the verdict at merge time.

## 4. Implementation order

| Step | Content | Tier | Needs |
|---|---|---|---|
| T0 | **Server token store.** `app-tokens.json`, hashing and compare, `POST /api/app/pair`, `/revoke`, settings window section (add, list, revoke), rate limit, tests (pure functions in `server/*.test.ts`) | `user` | Decisions D1 to D5 |
| T1 | **MERGE scope.** `callerOf`, Bearer on `pr.merge`, `by: "app"` records, 403 on every other route, tests for scope and for "no value in logs" | `user` | T0 |
| T2 | **App side** (atc-app): Keychain item, pair screen, "Merge…" confirm sheet with Touch ID, error handling. Not built by atc teams on Linux except the pure parts | atc-app (SUPERVISOR merges) | T1, atc-app GL1a |
| T3 | **Later scopes** (ACK, DISPATCH, FLEET PLAN, UPDATE), one decision each | `user` | T1 |

## 5. Risks

| Risk | Mitigation |
|---|---|
| The token is described as stronger than it is | Section 3 states the same-user gap; the settings help text says so |
| A team session adds its own token entry | Policy guards plus record and list (3.3); not preventable by design |
| A leaked token merges a PR | Scope is merge only; atc still requires tier, CLEARED and exact head; Touch ID on the Mac; revoke and expiry |
| The app becomes a merge route around LANDING | The route is MERGE itself: same checks, same record |
| Token header ends up in a log | `Redact` in the logger and a test (3.8) |
| A rollback strands the app | Section 3.5: older build answers 403, the browser path still works |
| Scope creep ("just add ACK") | Each new scope is a PR that edits this document and needs a SUPERVISOR decision |

## 6. Not built yet

Everything: T0 to T3.

## 7. Verification at T0 and T1

- Pure tests: hash and compare, expiry arithmetic, scope check, pairing code lifetime, rate limiter.
- Route tests with a test double for the store: bad token, expired, revoked, wrong scope, Bearer plus bad Origin, no JSON content type.
- A 7702 test server with `ATC_GITHUB=off` and a temporary state folder; never the production state folder.

## 8. Decisions

| # | Question | Recommendation |
|---|---|---|
| D1 | Scope of the first token | `pr.merge` only; every other route is its own later decision |
| D2 | Issue and pairing | Settings window shows a one-time pairing code (10 minutes); the app exchanges it; the token is never shown on screen |
| D3 | Storage | Separate `app-tokens.json`, salted SHA-256, constant-time compare, mode 0600; accept and record the same-user gap |
| D4 | Request shape | Same MERGE route with `Authorization: Bearer`; skips the Origin check but needs `application/json` and every other check; opt-in per route |
| D5 | Expiry | 30 days sliding, 180-day cap; revoke in settings and from sign-out |
| D6 | Mac confirmation | Confirm sheet with PR, head, tier, plus Touch ID; never from a notification, timer or hotkey |
| D7 | Records | `by: "app"` plus the token name; recent app writes in settings |
| D8 | Rate limit | 5 failed pairings or 10 failed checks per 10 minutes, then 10 minutes of 429; valid tokens unaffected |
| D9 | Is the token worth it given the same-user gap? | Yes, for separation, revocation and audit of a native client. It is not sold as a wall against team sessions |

**PILOT'S DISCRETION** choices made in this draft: separate state file (3.3); 30-day sliding expiry (3.5); the rate-limit numbers (3.8); pairing code length and life (3.2); Touch ID as a requirement rather than an option (3.6).
