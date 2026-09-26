# Changelog

**English** · [한국어](CHANGELOG.ko.md)

All notable changes to atc are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Settings panel tabs LINEAR and AGENTS. They show read-only server settings from the new `GET /api/settings`, which never returns secrets.
  - LINEAR: connection status, last sync, API key presence, team key, LANDING state.
  - AGENTS: session counts, session folders, claim hook installed or not, TTL and handoff grace.
- Release badge in the READMEs.
- This changelog.

## [0.1.0] — 2026-09-26

First release. ✈️ Ready for takeoff.

### Added

#### Radar and screens
- RADAR: session ─ worktree ─ ticket columns joined by lines, highlighting worktrees with no owner and in-progress tickets with no worktree.
- FLIGHT STRIPS: one strip per session with status, STANDs held, tickets and CLEARANCEs.
- FIDS: a DEPARTURES board, as a list or a board by flight phase, with split-flap characters.
- AIRPORTS: repository registry with auto-discovery under `~/projects`, 4-letter codes, identity by first commit hash, and open / close / rename / delete.
- OUTSTATION: sessions holding a STAND outside their home AIRPORT.
- Aviation terms and phonetic callsigns throughout (`TEAM_A` → `ALPHA`).
- A scrolling ALERT ticker.
- Themes: Radar Console, Glass Cockpit and Night Sky.
- A settings panel: motion, clock (UTC / local), density (comfortable / compact), FIDS view and range.

#### Claims, handoffs and conflicts
- Claim hook (`hooks/claim.mjs`): a Claude Code `PostToolUse` hook that records which linked worktree each session works in. It counts edited files and `cd` / `git -C` in command position only. Echo strings, heredocs and read-only commands don't count.
- ESTIMATED TRACK: claims inferred from transcript tool calls when there is no hook record.
- Codex sessions, claimed by their cwd.
- Verdicts from claim intervals: HANDOFF, LOSS OF SEPARATION or brief visit.
- Alerts: LOSS OF SEPARATION, NORDO STAND, UNIDENTIFIED, NO CONTACT.

#### Stage 1 — CONTROLLER (TOWER)
- A guarded Claude session in `controller/` that reads a traffic brief and sends CLEARANCEs (TRAFFIC, HOLD, CONTINUE, LAND, REPORT, INFO) to team sessions.
- READBACK tracking on the flight strips.
- `atcctl` CLI and a Bash guard.

#### Stage 1.5 — FLIGHT RECORDER and METRICS
- An append-only daily log of events and 5-minute traffic samples, kept for 30 days.
- METRICS tab: conflicts, CLEARANCE READBACK rate and time, merge wait, and the stage 2 readiness check.

#### Stage 2a — DISPATCH (shadow operation)
- Assignment proposals: which FLIGHT (ticket) goes to which AIRCRAFT (team session), with per-factor scores and slots.
- RELEASE suggestions for neglected work.
- A guarded DISPATCH session in `dispatch/` that reviews proposals and adds notes and CAUTION.
- DISPATCH tab where the SUPERVISOR marks agree or disagree. Nothing is sent to anyone yet.

#### Operations and docs
- systemd user service (`deploy/atc.service`).
- English and Korean docs for the root README and every folder.
- MIT license.

[Unreleased]: https://github.com/chaehy5665/atc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chaehy5665/atc/releases/tag/v0.1.0
