# changelog.d — CHANGELOG fragments

**English** · [한국어](README.ko.md)

A PR doesn't edit `CHANGELOG.md` or `CHANGELOG.ko.md`. It adds its `[Unreleased]` entry here as two fragments, one per language, so that parallel PRs don't collide on the same lines (ATC-64).

```
changelog.d/ATC-64.md       English
changelog.d/ATC-64.ko.md    Korean
```

- Name: the issue key (`ATC-64`), or the branch name without `claude/` when there is no issue. One pair per PR; a follow-up PR on the same issue adds `ATC-64-2`.
- Content: one or more `### <section>` headings with the entries under them, written exactly as they would read in the CHANGELOG. Nothing before the first heading.
- Sections: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, `Docs`. The Korean fragment may use `추가`, `변경`, `폐기 예정`, `제거`, `수정`, `보안`, `문서` (or the English names).

```markdown
### Changed
- What changed and why (ATC-64, [docs/…](docs/…)).
  - Details.
```

## Folding

```bash
node server/changelog-fold.ts           # fold every pair into [Unreleased] and delete them
node server/changelog-fold.ts --check   # check pairs and format only
```

The fold puts each entry at the top of the first `[Unreleased]` section with the same name (later names end up on top: `ATC-10` above `ATC-9`). A section that doesn't exist yet is created after the last earlier one in Keep a Changelog order. Existing lines and released versions don't move. An entry already in `[Unreleased]` is not added again, so a repeat run changes nothing. If any fragment has no pair or a wrong format, nothing changes and the script exits with 1.

ENGINEERING or the user runs the fold, at the latest before cutting a release, and commits it as its own PR. Until then the DOCS tab's 변경 기록 page shows the Korean fragments under `[Unreleased]`, and `npm test` checks that every fragment here is paired and folds cleanly.
