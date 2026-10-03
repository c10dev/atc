# UI references: one list of what atc's screens learn from

Status: living list, started 2026-10-02 at the SUPERVISOR's request ("레퍼런스들을 모아두는 목록이 필요할 것 같음"). It is not a design decision. Before this list, references were scattered over [design-taste.md](../design-taste.md), the `ui-review` skill, the FLEET card experiment and session chats.

Related: [layout.md](../layout.md) (the five screens), [design-language.md](../design-language.md) (rules, which win over any reference), [design-taste.md](../design-taste.md) (what the SUPERVISOR liked in a blind round).

## How to use it

- **Start from the liked rows.** A screen step (for example `layout.md` Y1–Y6) names the liked references it borrows from, and what it borrows. Candidates are only ideas until the SUPERVISOR judges them.
- **Do not propose a cut row again** unless something about it changed.
- **To add a row,** tell DUTY or an ENGINEERING session, and they add it by PR.
  - A reference is a link plus **what to take**: one concrete thing (a layout, a form, a behaviour), not "the look".
  - The verdict is the SUPERVISOR's, with the date and their words when they gave some.
- **atc is public.** Name only public products and repositories. Screens from private review pages stay off this list, and so do screenshots.

Verdicts: **liked** · **kept** (fine, not a favourite) · **cut** · **—** (not judged yet).

## 1. Liked or kept

| Reference | What to take | atc place | Verdict |
|---|---|---|---|
| [GitHub status](https://www.githubstatus.com) | A row of small per-day bars per component; status at a glance | METRICS history, HOME | kept (2026-10-01, design-taste) |
| [OpenAI status](https://status.openai.com) | The same status-page form, calm type | METRICS history | kept (2026-10-01) |
| [Cloudflare status](https://www.cloudflarestatus.com) | Many components, grouped and folded | FLEET, METRICS | kept (2026-10-01) |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | Plain components, spacing and type scale | all | kept (2026-10-01) |
| [Tabler](https://github.com/tabler/tabler) | Admin dashboard layout, cards with one number | METRICS | kept (2026-10-01) |
| Six dashboard styles ranked in the blind round | One focal element, readable before quiet, alignment over density, status-page bars, detail on demand | all | liked, ranked 1–6 (2026-10-01; see [design-taste.md](../design-taste.md), where the styles are described without names) |
| FLEET card "s2" instrument panel (atc's own experiment) | A domain form: big mono FLIGHT number, readouts, vertical gauges, block time against the expected time | FLEET, FLIGHTS | mildly liked: "2가 낫긴해" (2026-10-02) |

## 2. Cut

| Reference | Why | Verdict |
|---|---|---|
| [Mobbin](https://mobbin.com) | Mostly consumer mobile screens; nothing for a dense ops console | cut: "도움 안되는것같고" (2026-10-02) |
| A restyle of tokens only (a Vercel/Railway type scale, chips, dividers) | Looked generic | cut: "AI slop 같음" (2026-10-02, FLEET experiment) |
| A widget wall; a dense metrics-panel wall | Too dense | cut (2026-10-01, design-taste) |
| A near-black page | Dim, hard to read | cut (2026-10-01, design-taste) |

## 3. Candidates for the layout steps (not judged)

These were picked from their READMEs and code, not from looking at the running screens (2026-10-02). Open two or three and judge.

| Reference | What to take | atc place |
|---|---|---|
| [paperclipai/paperclip](https://github.com/paperclipai/paperclip) | Its flow "goal → team → approve and run → watch the dashboard" is the closest to the arrow. Budgets and governance screens; Node + React like atc | RELEASE, HOME, METRICS |
| [generalaction/emdash](https://github.com/generalaction/emdash) | A Linear issue goes to an agent; one worktree per task; diff, CI and merge in one place | FLIGHTS, the PR drawer |
| [temporalio/ui](https://github.com/temporalio/ui) | A run list and an event history per run | FLIGHTS, the FLIGHT drawer |
| [nasa/openmct](https://github.com/nasa/openmct) | Mission control: composed layouts, a time conductor, fault management | HOME, FLIGHTS |
| [derailed/k9s](https://github.com/derailed/k9s) | List → detail by keyboard; a dense table that stays readable | FLIGHTS, FLEET |
| [mathuo/dockview](https://github.com/mathuo/dockview) | Docked, split panels (VS Code style) instead of many tabs | layout |
| [dagster-io/dagster](https://github.com/dagster-io/dagster) (UI) | A run timeline and status per asset | FLIGHTS, METRICS |
| [palantir/blueprint](https://github.com/palantir/blueprint), [elastic/eui](https://github.com/elastic/eui) | Design systems made for dense desktop data | all |

For the design-system layers ([design-system.md](../design-system.md), survey [design-system-layers.md](design-system-layers.md), 2026-10-02). These are about structure, not a look:

| Reference | What to take | atc place |
|---|---|---|
| [primer/primitives](https://github.com/primer/primitives), [primer/stylelint-config](https://github.com/primer/stylelint-config) | A declared contrast table checked in every theme; a lint that lets each property take only its token family | tokens, checks |
| [radix-ui/colors](https://github.com/radix-ui/colors) | A numbered neutral ramp where each step has one job (background, component rest / hover / pressed, borders, solid, text) | tokens, themes |
| [carbon-design-system/carbon](https://github.com/carbon-design-system/carbon) | A contextual layer token a container sets for its children | tokens, primitives |
| [grafana/grafana](https://github.com/grafana/grafana) `packages/grafana-data/src/themes` | A theme as a small input; a pure function derives hover, text and border | themes |
| [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui) | Themes from three inputs (base, accent, contrast) in LCH | themes, the light theme |
| [Vercel Geist colors](https://vercel.com/geist/colors), [materials](https://vercel.com/geist/materials) | Slots by job (component background, border, text); named surface presets | tokens, primitives |

Not candidates:
- [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban): its README announces it is sunsetting (2026-10-02).
- [stravu/crystal](https://github.com/stravu/crystal): it is now Nimbalyst.

## 4. Domain: aviation

| Reference | What to take | atc place | Verdict |
|---|---|---|---|
| FAA AC 25.1322-1 (flight deck alerting) | Few distinct tones, ACK silences, nuisance alerts destroy trust | alerts, HOME | adopted as rules ([research/aviation-signals.md](aviation-signals.md), design-language principles 1–2) |
| [wiedehopf/tar1090](https://github.com/wiedehopf/tar1090) | A live map beside an aircraft table, both in sync | FLIGHTS radar view, GLOBE | — |
| [openscope/openscope](https://github.com/openscope/openscope) | Flight strips next to a radar scope | FLIGHTS | — |

## 5. Rules vendored into atc

These are adopted, not candidates. They live in the `ui-review` skill (`.claude/skills/ui-review/references/`), and the design language wins where they disagree.

- [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines): focus, targets, forms, state, accessibility (MIT).
- [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better): radii, alignment, numbers, wrapping, icons (MIT).
