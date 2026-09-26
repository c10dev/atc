# Naming rules

**English** · [한국어](naming.ko.md)

atc finds tickets from branch names and links sessions to worktrees through the claim records the hook leaves. Following the rules below lets everything link up without inference.

## Tickets

- Linear team `Vocado`, key `VOC-<n>`.

## Branches (existing convention)

```
claude/voc-<n>-<slug>     # Claude sessions
codex/voc-<n>-<slug>      # Codex sessions
```

- Work without a ticket stays `claude/<slug>`. atc shows it as **AD HOC** (ticketless work, such as a fix of 5 lines or less handed to a team directly). Work that needs a ticket goes through the CHARTER DESK instead ([occ.md](occ.md)).

## Worktree directories

```
/home/c10/projects/worktrees/<repo>-voc-<n>-<slug>
```

- Take the branch name without the agent prefix and put the repository name in front.
  `claude/voc-191-close-anon-write-tables` → `vocado-voc-191-close-anon-write-tables`
- Don't create new ones without the hyphen (`voc185`) or without a slug (`vocado-voc-171`).
- atc doesn't depend on directory names, so existing worktrees don't need renaming.

## Sessions (teams)

- The session names `TEAM_A` … `TEAM_F` are long-lived lanes of work. Tickets change; team names stay.
- Subagent tool calls are recorded under the leader's session ID, so when a leader spreads work across several worktrees, all of them show as that team's claims. Teammates that run as separate processes can show up as their own sessions.

## Control sessions

| Session name | Folder | Role |
|---|---|---|
| `TOWER` | `controller/` | Traffic control: CLEARANCE, READBACK |
| `OCC` | `occ/` | Operations control: DISPATCH review, SCHEDULE drafts, flight following |
| `CROSSCHECK` | `crosscheck/` | A model from a different family than OCC leaves a provisional verdict before the SUPERVISOR decides |

- **CROSSCHECK** is borrowed from the cockpit cross-check, where the second pilot independently checks the first one's setting. Here it is the provisional verdict (`agree`/`disagree` plus a one-line reason) on an open DISPATCH proposal (`D-xxxx`) or SCHEDULE draft (`S-xxxx`). It is also called a **mark**. It never changes a proposal's or draft's state and is never counted in a gate.
- **CROSSCHECK match** (`CROSSCHECK 일치`): among human decisions that had a mark before the decision, the share where the mark agreed (agree ↔ agreed/approved, disagree ↔ disagreed/rejected). It is shown overall and per model: each mark records the model id of the CROSSCHECK session (`unknown` for marks made before the field existed), shown in the screens by its short name (`muse-spark-1.3-contributor`, `gpt-5.6-terra`).

## Claim records

- Claims are recorded automatically by the Claude Code hook ([README "Claim hook"](../README.md#claim-hook)). Leaders and teammates don't need to write anything.
- A team that is done with a worktree just stops touching it. The claim is released after 3 hours.
- A claim is recorded only when a file is edited or Bash enters the worktree with `cd` or `git -C`. Commands that only read a path are not recorded.
- When two teams are recorded on the same worktree, it shows as a conflict (LOSS OF SEPARATION).
