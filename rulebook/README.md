# rulebook: atc's response manual as a Claude Code plugin

**English** · [한국어](README.ko.md)

A plugin (`atc-rulebook`) that holds atc's abnormal-situation checklists as skills, so a session opens the procedure for a situation instead of remembering a paragraph. Design and evidence: [docs/research/skill-rulebook.md](../docs/research/skill-rulebook.md) ([ATC-281](https://linear.app/vocado/issue/ATC-281)), sections 5.1 to 5.4.

**Not loaded by any session yet.** Nothing starts it today. A later change adds `--plugin-dir` to LAUNCH; until then these files only exist in the repository. Skills are called as `atc-rulebook:<id>`.

## Three layers

| Layer | Holds | Where |
|---|---|---|
| Limitations | what must never happen and can be checked by code | guards and hooks (`*guard*.mjs`, `hooks/`), not here |
| Memory items | at most about 10 one-line rules that apply to every turn or are irreversible | the top of `CLAUDE.md`, not here |
| Procedures | everything with a triggering condition | skills in this folder |

## Skills

Layout: `skills/<id>/SKILL.md`. The ID rule is `<kind>-<nn>-<slug>` with kind `sop` (every flight), `cl` (normal checklist), `qrh` (abnormal or emergency) or `mel` (a capability is missing). **A number is never changed or reused**, even when a skill is deleted (`qrh-04` is reserved for GO AROUND).

| ID | For | Owner (the manual it comes from) |
|---|---|---|
| `qrh-01-lost-comms` | an AIRCRAFT that cannot reach OCC or TOWER | CREW BRIEFING, [ATC-258](../docs/research/lost-comms-and-contingency.md) F4 |
| `qrh-02-stalled` | OCC or TOWER seeing health `STALLED` or `RESUME` | `occ/` manual (`following.md`), `controller/` manual, [docs/fleet.md](../docs/fleet.md) 8.8 |
| `qrh-03-undelivered` | OCC when a send fails or a FLIGHT PLAN or RECALL is overdue | `occ/` manual (`flight-plan.md`, `crew-change.md`) |
| `qrh-05-arrival-missing` | OCC reading an ARRIVED report, or a merged FLIGHT with no report | `occ/` manual (`/tick` steps 1 and 2) |

Format of every skill, one screen: frontmatter `name` and a narrow `description` ("Use when …"); a title line with the ID, `rev <date>.<n>` and `owner`; `Condition`; numbered `Steps`; `Stop and report if` (Expected / Found / Why it matters); `End state`; `Report line`.

## How a skill is opened

The server names the checklist in the text it already sends (`Checklist: qrh-03-undelivered`), and the session opens exactly that skill. The `description` is only a fallback for a situation the server cannot see; with many skills installed Claude Code drops descriptions first, so do not rely on it (survey section 4.2).

## Revision and ownership

- Each skill has a revision string `rev <date>.<n>` in its title line. Change it when the steps change.
- A skill copies rules that exist in a manual or `CLAUDE.md`; it does not add new ones. A new rule is decided in the manual first.
- **Every change to this folder is tier `user`** (`deploy/landing-tier.mjs`): the SUPERVISOR merges, like a guard.
- Bodies are English (D1): sessions speak English to each other. The Korean summaries for the SUPERVISOR are in [README.ko.md](README.ko.md).
