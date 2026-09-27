# OCC procedure: Sending CREW CHANGEs

[한국어](crew-change.md) · **English**

> English translation for readers. The OCC session reads the Korean [`crew-change.md`](crew-change.md), which is the source of truth; this file is not loaded.

Procedure moved from [`CLAUDE.md`](../../../CLAUDE.en.md). Read it (2b) in `/tick` steps 1 and 4, when a CREW CHANGE reply came in, or `crew-change brief` has `approved` or `overdue`. `CLAUDE.md` sets the role and what OCC doesn't do.

## Commands

| Command | What it does |
|---|---|
| `node ../controller/atcctl.mjs crew-change send <CC-0001>` | (2b) Mark an approved CREW CHANGE sent and print `SEND TO` (the REGISTRATION) and the text. If already sent, print the same text again (for a resend) |
| `node ../controller/atcctl.mjs crew-change readback <CC-0001>` | The CAPTAIN replied "READBACK CC-0001" |

## Sending CREW CHANGEs (2b, only when `mode` in `crew-change brief` is approval)

When the SUPERVISOR changes the CREW COMPLEMENT of an in-service AIRCRAFT, atc writes a CREW CHANGE (`CC-xxxx`). **Only the SUPERVISOR approves it** (FLEET tab). OCC sends approved ones only and records the READBACK. atc writes the text (`[OCC CC-xxxx] CREW CHANGE · …`); OCC only passes it on.

| Situation (`crew-change brief` field) | What to do |
|---|---|
| `approved` | `crew-change send <CC-xxxx>` → SendMessage the text below `---` **unchanged** to the `SEND TO` session (that AIRCRAFT). One per AIRCRAFT per pass |
| `waiting` (approved, but an earlier one for the same AIRCRAFT, `waitingFor`, has no READBACK yet) | Don't send. `crew-change send` refuses it with 409 too. After the earlier READBACK it shows up in `approved` on a later pass |
| The CAPTAIN replies "READBACK CC-xxxx" | `crew-change readback CC-xxxx`. If only "… CREW CHANGE CC-xxxx COMPLETE" arrives without a READBACK, the CAPTAIN clearly got it: run `crew-change readback CC-xxxx` and put the COMPLETE in the OCC LOG |
| A sent one in `overdue` (no READBACK for over 10 minutes after sending) | Get the same text with `crew-change send <CC-xxxx>` and send it **once** more. If there's still nothing, report to the SUPERVISOR |
| `pending` | Nothing to do (waiting for the SUPERVISOR). OCC doesn't approve or chase it |
| send-guard blocks it, or `crew-change send` refuses | Don't retry with changed text or recipient; report to the SUPERVISOR |

- In `shadow` (2a), skip this section. The SUPERVISOR copies the CREW CHANGE from the FLEET card and pastes it directly.
- If the SUPERVISOR changes the complement again after one was sent, a new CC is written and goes out after the earlier one's READBACK. If it changes before sending (approved), atc supersedes it with a new CC, which needs approval again.
- Don't mix it up with a FLIGHT PLAN's "READBACK D-xxxx" or a RECALL's "READBACK D-xxxx RECALL". CC numbers start with `CC-`.
