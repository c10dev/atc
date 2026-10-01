# Design taste, brief v1

Status: v1, 2026-10-01. A tendency from one round by one person, not a rule. [design-language.md](design-language.md) wins wherever the two disagree.

The SUPERVISOR judged eight working dashboard variants blind. Each was built from a different reference with the same request and the same data, in a private review page. This brief turns what they kept and cut into points a screen can be checked against. The FLEET card is the first screen to apply it (ATC-325).

## Evidence

Ranked by the SUPERVISOR, with the tags they gave:

| Rank | Variant (style of) | Tags |
|---|---|---|
| 1 | a model-platform health page | chart reads, alignment and whitespace, status at a glance |
| 2 | a database-platform tile page | density right, type hierarchy |
| 3 | a database-branching topology page with side charts | chart reads, detail flow |
| 4 | an uptime-monitor dark page | chart reads |
| 5 | an edge-network page of dense KPIs | alignment |
| 6 | a serverless-database page | type hierarchy, alignment, detail flow |

Cut: a widget wall ("too dense") and a near-black page ("dim, hard to read"). Among real products the SUPERVISOR kept the GitHub, OpenAI and Cloudflare status pages, shadcn and Tabler, and cut a dense metrics-panel wall.

## The brief

1. **One focal element per view.** One thing is big and readable (the first-ranked variant had one large chart). Everything else is quieter and smaller. Quieter means smaller and lower in the page, not less legible.
2. **Readable before quiet.** Secondary text that carries information meets 4.5:1 on its surface in every theme. The near-black page was cut for being dim while a dark page with readable text was kept: dark is fine, dim is not. Use `--muted` for information, keep `--faint` for what carries none.
3. **Alignment and whitespace over density.** One label column and one value column, numbers right-aligned in `tabular-nums`, the same left edge in every section. The widget wall and the metrics-panel wall were the only cuts in their groups.
4. **Status-page form for history.** A row of small, quiet bars with the state encoded per bar beats a table when the question is "has it been OK lately?". Give each bar a readable label, and keep the table one click away.
5. **Detail on demand, smoothly.** The detail flow was praised twice. Folded sections show a one-line summary and open in place; opening one moves nothing above it and no neighbouring card (the layout-stability step of ATC-311 measures this).

## Status of this brief

v1 rests on one category (dashboards) and one round: one variant per reference, scores by one person. Treat it as a tendency and revise it when another category is judged. Nothing here is checked by a tool yet; wiring it into `ui-review` is proposed in the ATC-325 PR (`.claude/` is tier `user`).

## Precedence

`design-language.md` (DL1 to DL9, including DL2 fold, don't hide; DL4 at most five visible buttons; DL9 Radar Console as the reference theme) wins over this brief. A conflict is listed in the PR that meets it and is decided by the SUPERVISOR, not resolved by the PR.

## Applied: the FLEET card (ATC-325)

| Point | What the card does |
|---|---|
| 1 Focal | NOW is the one focal block under the alert band: the FLIGHT key and its title on one line, the state line (working or idle, last tool, age) and the FOB bar. |
| 2 Readable | Information text on the card uses `--muted` instead of `--faint` (the card used `faint` for "claude-opus-5-5 ×37 5시간 전", "14일 안 씀", targets, captions). Measured on the card surface: `--text` 14.3 / 16.6 / 16.8, `--muted` 8.2 / 9.6 / 9.2, `--faint` 5.8 / 6.7 / 6.4 (Radar / Glass Cockpit / Night Sky). No token fails 4.5:1, so no global token changes. |
| 3 Grid | Every folded section is one row: label column (`--fl-label-w`), value column, chevron. Numbers in the opened sections are right-aligned `tabular-nums`. |
| 4 History | LOGBOOK is a strip of the last 14 FLIGHTs, oldest to newest: on time (neutral), late (amber), no PR (outlined), UNEXPECTED or reverted (alert), no expectation (line-strong). Each bar has an accessible label; the opened section holds the table. |
| 5 Detail | CREW, TYPE RATING (ROUTE), ACCOUNT, FUEL, PERFORMANCE and LOGBOOK fold to one summary line each. Which are open is remembered in this browser only. |
