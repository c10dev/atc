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

- Work without a ticket stays `claude/<slug>`. atc shows it as "no ticket".

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

## Claim records

- Claims are recorded automatically by the Claude Code hook ([README "Claim hook"](../README.md#claim-hook)). Leaders and teammates don't need to write anything.
- A team that is done with a worktree just stops touching it. The claim is released after 3 hours.
- A claim is recorded only when a file is edited or Bash enters the worktree with `cd` or `git -C`. Commands that only read a path are not recorded.
- When two teams are recorded on the same worktree, it shows as a conflict (LOSS OF SEPARATION).
