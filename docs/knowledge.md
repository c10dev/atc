# Knowledge design (stable IDs, "Relation to existing", a derived index, and where lessons go)

atc's docs hold what atc knows about itself: Principles, Decisions and "as built" notes. Nothing makes a plan decide how a new item relates to them, and nothing lets a plan or a review point at one by name. This design adds three small things: a stable ID on each such item, a fixed "Relation to existing" table in every plan, and a derived index over the sources that already exist. It also says where a lesson that matters beyond one session goes.

> Status (2026-09-30): draft for ATC-104 (design only). Part of ATC-103; steps 2–4 (ATC-105, ATC-106, ATC-107) are not built. Section 9 lists what the SUPERVISOR must choose.

Related: GitHub #41 (ontology graph over the operating snapshot, compared in section 8); [dispatch.md](dispatch.md) 5.1.2 and 6.2 (already-done rules, FLIGHT hold chips); [occ.md](occ.md) 5.3 (CHARTER DESK duplicate search); [mcc.md](mcc.md) (INSPECTION); [atfm.md](atfm.md) principle 1 (shadow first).

## 1. Current facts

Measured on 2026-09-30 from the repository and from the operating state, read-only. Nothing was written. Counts come from a heading scan, so step 2 (ATC-105) will fix them exactly when it tags the items.

| Knowledge | Where | Size today |
|---|---|---|
| Principles | `## 2. Principles` of the design docs | 63 numbered items in 11 docs (accounts 8, atfm 5, dispatch 6, fuel 6, mac-app 4, mcc 6, occ 6, radio 5, routes 5, squelch 6, ui-visibility 6). `fleet.md` and `control-recycle.md` have none |
| Decisions | a `Decisions` section per doc | 12 docs (accounts, atfm, control-recycle, dispatch, fleet, fuel, mcc, occ, radio, routes, squelch, ui-visibility). Four shapes: numbered table (atfm), item/decision table (fleet), dated bullets (mcc), headed list (control-recycle). No item has an ID |
| Features "as built" | headings that say "as built" | 59 in 11 docs (fleet 20, fuel 11, dispatch 5, mcc 4, occ 4 …) |
| Undecided ideas | GitHub `idea` issues | 22, of which 18 open. #121 (split the structure role into MCC and ENGINEERING) is still open although both exist |
| Work orders | Linear ATC | issues plus the unfolded `changelog.d/` fragment pairs |
| Verdict history | `proposals.jsonl` (914 lines), `schedule.jsonl` (55) | used only as 24-hour memory (pair rule, FLIGHT hold) |
| Lessons | Claude auto-memory, per working folder | only the main-checkout folder has entries; control-session folders and worktree sessions see none |
| Existing "does this already exist?" checks | code | planner filters (dispatch.md 5.1.2), CROSSCHECK chips, CHARTER DESK title-word duplicate search over a 45-day snapshot (occ.md 5.3). None looks at Principles, Decisions or ideas |

**Rejections for "already done" or a duplicate.** The reason chips exist only since 2026-09-27. In `proposals.jsonl` the chips seen so far are few: `already-done` 1, `parent-issue` 1, `needs-human` 3, `waiting-on-prior` 3, `out-of-repo` 2, `no-priority` 1, `wrong-aircraft` 6 (7 `disagree` verdicts and 3 `reject` ops in total). Before the chips, dispatch.md 5.1.2 and 6.2 record that "already done" was the most common rejection among the first shadow verdicts, and that 6 of the first 9 DISPATCH verdicts were rejections for the ticket not being ready. Separately, 63 proposals were SUPERSEDED (4 because the FLIGHT already had a STAND, 6 because the FLIGHT's state changed). `schedule.jsonl` has 16 verdict or supersede lines and none names a duplicate. So the sample is too small to size the problem; the point of the shadow step (section 7, step 4) is to measure it. Nothing here calls for a bigger claim.

**Conflicts found late** (found by reading, not by a step in planning):

| What | Found how |
|---|---|
| SELF-LANDING (PR #105 design, PR #107 shadow lander) and MCC drafted in parallel for the same goal | The SUPERVISOR picked MCC (mcc.md Decisions, 2026-09-28); #105 and #107 were closed. No planning step noticed the overlap |
| occ.md section 9 says "atc's own landing is out of scope" while MCC lands atc PRs | MCC's own current-facts table had to quote the old line |
| fleet.md "atc does not start sessions" reversed on 2026-09-28 (session control) | The Decisions table carries the change inline, so a reader of the older rows can miss it |
| mcc.md section 9 asks for a 5-day shadow gate; the 2026-09-29 decision waives most of it | Both texts stay in the same doc |
| GitHub #121 (split structure into MCC and ENGINEERING) is open after the split was built | Found while writing this table |

## 2. Principles

1. **Derived only.** The index and every table in this design are computed from docs, Linear, GitHub and the changelog. Nothing new becomes a source of truth. Same rule as GitHub #41.
2. **The plan does the judging; structure gathers the evidence.** A contradiction between a new plan and an old principle is a judgement. The index can list the candidates; a person or session decides. There is no automatic Conflicts verdict.
3. **Conflict is a question, never a silent override.** A plan that conflicts with a Principle or Decision ends its table with a question for the SUPERVISOR. The old item changes only after the answer.
4. **IDs are never reused and never silently deleted.** A retired item stays in its doc with a pointer to what replaced it.
5. **Shadow before action.** Consumers (CHARTER DESK, CROSSCHECK, MCC) record what the index would have said next to what actually happened, before anything they do depends on it ([atfm.md](atfm.md) principle 1).
6. **Guards never depend on it.** No guard, hook or landing condition reads the index (the `… || exit 2` guards stay as they are).
7. **Small.** One tag per item, one table per plan. No graph database, triple store or reasoner (GitHub #41 "What does not fit" applies).

## 3. Terms

| Concept | Term | Meaning |
|---|---|---|
| A tagged item | **ITEM** | A Principle, a Decision, an "as built" feature or a lesson, with a stable ID |
| Its ID | **KID** | Knowledge ID, `<doc>.<kind><n>` (section 4) |
| The check | **RELATION TABLE** | The "Relation to existing" table in a plan (section 6) |
| The relation | **RELATION** | One of New, Extends, Supersedes, Conflicts |
| The list | **INDEX** | The derived list of ITEMs and their links (section 7) |
| A lesson | **LESSON** | A short, dated rule learned from an incident, worth reading beyond one session (section 8) |

"KID" is only the abbreviation used in this doc and in the index code; screens and messages can say "knowledge ID".

## 4. Units and IDs

**What gets an ID.** Each Principle, each Decision, each "as built" feature, and each LESSON. Work orders, ideas, PRs and changelog fragments already have IDs (`ATC-n`, GitHub numbers, PR numbers) and keep them; the index refers to them with a source prefix (section 7).

**Format:** `<doc>.<kind><n>`, where `<doc>` is the file name without `.md` (`mcc`, `dispatch`; a doc in a subfolder keeps its own name, `aviation-signals`), `<kind>` is one letter and `<n>` counts up inside that doc and kind.

| Kind | Letter | Example | Numbered by |
|---|---|---|---|
| Principle | `P` | `mcc.P2` | the number the doc already gives it, so no renumbering |
| Decision | `D` | `atfm.D3` | order of the decision in the doc, then append-only |
| As built | `A` | `fuel.A7` | order of the section, then append-only |
| Lesson | `L` | `lessons.L4` (section 8) | append-only |

Why this format: the dot and the lower-case doc name make it impossible to mistake for `D-xxxx` (DISPATCH), `S-xxxx` (SCHEDULE), `C-xxxx` (CLEARANCE), `CC-xxxx` (CREW CHANGE) or `ATC-n`. Those all use a capital prefix, a hyphen and a number. `atfm.D3` (dot, doc name in front) and `D-0003` (hyphen, four digits) differ in more than one character. The Korean file `dispatch.ko.md` uses the same KIDs as `dispatch.md`.

**Where the tag goes.** At the start of the item, in bold, so a search finds it and a renderer shows it: `**mcc.P2** The tiers don't move.` For a table row (Decisions), the tag is the first cell. For an "as built" note the tag goes in the first line under the heading (`**fuel.A7**`), not in the heading, so headings and their anchors do not change.

**Lifecycle.**

| Event | What happens to the ID |
|---|---|
| Reworded, meaning unchanged | Same ID. The wording is not the identity |
| Meaning changed a little (a threshold, a scope) | Same ID plus a dated note in the item (`(2026-09-30: …)`). If a reader who depended on the old meaning would now be wrong, treat it as Supersedes below |
| Split in two | The old ID is retired ("split into X, Y"). Two new IDs. Both `Extends` the old one in the index |
| Merged | The old IDs are retired ("merged into X"). One new ID |
| Superseded | The old ID is retired ("superseded by X"). The new item says `Supersedes <old>` |
| Retired without a successor | The ID stays with "retired, <date>, <reason>" |
| Numbers | Never reused, never renumbered. Gaps are fine |

A retired item stays in place. Its first line reads `**mcc.P3** ~~The old wording.~~ Retired 2026-10-01: superseded by **dispatch.P7**.` so the index can read status and successor from one line, and a reader sees both. The ID line of a live item carries nothing extra.

## 5. Relation vocabulary

A plan lists each new item it proposes and gives one RELATION for it against what exists.

| Relation | Applies when | Evidence the plan must give | What it triggers |
|---|---|---|---|
| **New** | Nothing existing covers it | The searches made (section 6 list), with the words or paths queried and "no hit", or hits judged unrelated with a reason | Nothing. The item gets a KID when it lands |
| **Extends** | It adds to, narrows or implements something that stays true | The KID or link it extends, and what it adds | The plan links to the extended item. Nothing is removed |
| **Supersedes** | It replaces an item, which must stop being true | The KID or link it replaces, why, and every place that text or behaviour lives (docs, guide, guard text, code) | The plan's PR retires the old item with a pointer (section 4), fixes the places listed, and states the change in the PR body. Removing a Principle or Decision needs the SUPERVISOR's decision when it was recorded as one (see Conflicts); an item nobody decided can be superseded in the PR |
| **Conflicts** | It cannot both hold with an existing Principle or Decision, and the plan does not settle which wins | Both items, the exact clash | A question in the plan's "Decisions for the SUPERVISOR". The old item is not edited or overridden until answered. After the answer the row becomes Supersedes (new wins) or the plan changes (old wins) |

Rules of thumb: if the row says "but", it is probably not New; if the plan quietly makes a Principle false, it is Conflicts, not Supersedes, until the SUPERVISOR agrees.

**Other link kinds.** `implements` (a feature realizes a Decision), `decided-by` (a Decision points at the ticket or the answer that made it) and `learned-from` (a LESSON points at the incident) are useful to the index but are not relations a plan has to pick. They come from text already written (`Fixes ATC-n`, "built (ATC-57)", the incident line in a LESSON). Plans do not need a column for them. See decision 2 in section 9.

## 6. The "Relation to existing" table

**Columns:**

| Item | Relation | Existing | Searched | Consequence |
|---|---|---|---|---|
| One line naming the proposed item | New / Extends / Supersedes / Conflicts | KIDs or links (`mcc.P2`, `gh:41`, `ATC-87`); `none` for New | Search codes from the list below, plus the words used | For Extends/Supersedes: what changes. For Conflicts: the question. For New: `none` |

**The fixed places to search** (each is a code the table can cite):

| Code | Place |
|---|---|
| S1 | Principles and Decisions and "as built" sections of `docs/*.md` (and `docs/research/`) |
| S2 | GitHub `idea` issues (open and closed) |
| S3 | Open ATC issues in Linear, including their parents and children |
| S4 | Open and recently merged PRs (last 30) |
| S5 | `changelog.d/` and `CHANGELOG` |
| S6 | The code paths involved (files the plan would touch, and the tests around them) |
| S7 | Lessons (section 8) |

A table that says New must cite S1–S6 at least, with the words used. It is fine to say "S3: none, no open issue mentions 'radio'" — a wrong or missing search line is what a reviewer looks for.

**Where the table goes.**

| Place | Rule |
|---|---|
| Design drafts (`docs/<topic>.md`) | A section "Relation to existing", right after Current facts |
| Linear work orders (EO) | A short table in the description for any issue that proposes something new; a bug fix or a change fully described by its parent needs none, and says "no new item" |
| PR bodies | Not required when the work order or design draft has one; the PR body links to it. A PR that adds or retires a Principle or Decision includes the row |

The SUPERVISOR-facing cost is one table. The check is ENGINEERING's (who writes designs and work orders), the CAPTAIN's (for a PR that adds an item) and MCC INSPECTION's (reading the table, section 7 step 4).

## 7. Derived index

**Row shape:**

```
{ id, kind, status, title, doc, links[] }
```

| Field | Values |
|---|---|
| `id` | a KID (`mcc.P2`) or a prefixed native ID: `linear:ATC-87`, `gh:41` (issue), `pr:223`, `cl:ATC-87` (changelog fragment or CHANGELOG entry). The prefix keeps them apart from KIDs and from `D-xxxx` |
| `kind` | `principle`, `decision`, `feature`, `lesson`, `idea`, `work-order`, `pr`, `change` |
| `status` | `active`, `draft` (its doc says Status: draft), `retired`, `superseded`, `open`, `closed`, `done` |
| `title` | first sentence or heading of the item, at most 120 characters |
| `doc` | file path and line of the item (`docs/mcc.md:29`) or the URL of the issue or PR |
| `links` | `[{rel, to}]` with `rel` in `extends`, `supersedes`, `conflicts-with`, `implements`, `decided-by`, `learned-from`, `mentions` |

**Sources and how each field is read** (a pure function over text, so step 3 needs no new choices):

| Source | Gives | How |
|---|---|---|
| `docs/*.md`, `docs/research/*.md` (English only; `*.ko.md` share the KIDs) | Principles, Decisions, features, lessons | The bold KID tag at the start of an item (section 4). `~~…~~` plus "Retired … superseded by X" gives `status` and `supersedes` |
| Plan "Relation to existing" tables | `extends`, `supersedes`, `conflicts-with` | Table rows: Relation column and Existing column |
| Linear (read-only, existing fetchers) | work orders | Issue key, state, parent/related/blocked links, `Fixes ATC-n` mentions |
| GitHub `idea` issues and PRs (existing `gh` reads) | ideas, PRs | Number, state, title, body mentions of `ATC-n` and KIDs |
| `changelog.d/`, `CHANGELOG` | changes | Fragment file name gives `ATC-n`; mentions of KIDs |

Inline mentions of a KID or `ATC-n` in any text give a `mentions` link. Only the relations written in a table or a retirement line give `extends`/`supersedes`/`conflicts-with`. The function never guesses a relation from wording. The read-only API is `GET /api/knowledge` (whole index) and `GET /api/knowledge/:id` (one row and the rows that link to it); it reads only and adds no record file.

**Consumers, in shadow first (step 4).**

| Consumer | Uses the index to | Shadow record |
|---|---|---|
| CHARTER DESK (occ.md 5.3) | look for duplicates by KID/ATC mentions and ideas, not only title words | what it would have flagged, next to what the SUPERVISOR did |
| CROSSCHECK | mark `already-done` with a KID or PR as evidence | same |
| MCC INSPECTION | list Principles and Decisions a PR touches and the PR's own table | same; never a landing condition |

A record shape for these shadow lines is left to step 4; it follows the existing JSONL rules (append-only).

## 8. Lessons, and the relation to GitHub idea 41

**Where lessons go.** A LESSON is a rule learned from an incident that would still matter to a session that did not live through it (for example: re-read Linear state before moving it; never kill a test server by name pattern). Claude auto-memory is per working folder and stays a private convenience of one folder; atc never writes to `~/.claude/projects/*/memory`.

Proposed: a single doc `docs/lessons.md`, one short entry per LESSON with the KID `lessons.L<n>`, the rule in one or two sentences, the incident (date, ticket or PR), and the docs or manuals it applies to (`applies: mcc, occ`). ENGINEERING and the SUPERVISOR write it, not team sessions, the same as Linear writes. A team session that learns something reports it in its final report ("LESSON candidate: …") and ENGINEERING decides.

How a control session reads it: each control folder's `CLAUDE.md` is a manual that is already reloaded when it changes (`atcctl manual check`). Step 2 or a follow-up adds one line to each manual pointing at the lessons that apply to it; the lessons doc itself is read on demand. That manual edit is a control-manual change, so its tier is decided in section 9. Team sessions read `docs/lessons.md` through the repository like any doc. Root `CLAUDE.md` gets one line telling sessions to search it in the "Relation to existing" step (search S7).

Alternatives (recorded in section 9): a `Lessons` section per design doc; putting lessons straight into the manual of the session they concern.

**Relation to GitHub idea 41.** Idea 41 models the operating world (AIRCRAFT, FLIGHT, STAND, PR, claim, ROUTE, CLEARANCE …), rebuilt from the snapshot every 2 seconds, for server functions (planner, CHECK independence, conflict risk). This design models what atc knows about itself (Principle, Decision, feature, doc section, idea, work order, lesson), changing on a merge, decision or incident, for ENGINEERING planning, MCC INSPECTION, CHARTER DESK duplicates and CROSSCHECK `already-done`. Shared: a work order is a FLIGHT, and both aim at the duplicate search. If idea 41's K1 (`GET /api/graph`) is built, the INDEX becomes a second node layer in that graph: `work-order` rows join the FLIGHT nodes by key, and a `doc` row joins idea 41's Area node (the code area a doc owns). Until then the INDEX is standalone and steps 2–3 do not need idea 41.

## 9. Decisions for the SUPERVISOR

Each has a default so the steps can go on, and the default is the one used in the sections above.

1. **KID format.** Default `<doc>.<kind><n>` (`mcc.P2`). Alternative: `KN-0001` style running numbers. The default carries the doc and kind in the ID, so it reads well in a table and can be told from `D-xxxx`; running numbers are shorter but say nothing.
2. **Extra link kinds in plans.** Default: plans pick only New/Extends/Supersedes/Conflicts; `implements`, `decided-by` and `learned-from` are read from existing text. Alternative: add them as relation values too. More columns, more chance of a wrong value.
3. **Where lessons live.** Default: one `docs/lessons.md`. Alternatives: a Lessons section per design doc (no new file, but a lesson about several docs has no home), or straight into each control manual (fastest for that session, but a `user`-tier edit per lesson and no shared view).
4. **Who may write lessons.** Default: ENGINEERING and the SUPERVISOR. Alternative: any CAPTAIN through a PR (faster, less consistent).
5. **How much the "Relation to existing" table is required.** Default: required for design drafts and for work orders that propose something new; bug fixes and fully-specified sub-issues say "no new item". Alternative: every work order.
6. **Step 4 consumers.** Default: all three in shadow. If MCC INSPECTION is too close to a landing condition, leave it out until the shadow record is in.
7. **Existing conflicts in section 1.** Default: this design only lists them. Fixing them (for example closing #121, or adding a "superseded by" note to the occ.md "out of scope" line) belongs to step 2 and needs the SUPERVISOR's word where a Decision is affected.

## 10. Implementation order

Each step is its own FLIGHT and PR. Tiers follow `deploy/landing-tier.mjs` by the files each step touches.

| Step | Issue | Content | Landing tier |
|---|---|---|---|
| 1 | ATC-104 | This design draft (`docs/knowledge.md`) and the docs index link | `auto` (docs only) |
| 2 | ATC-105 | Tag every Principle, Decision and "as built" item with its KID in `docs/*.md`; add the "Relation to existing" rule to root `CLAUDE.md`, design docs, the work-order template and the `atc-task` checklist; create `docs/lessons.md` if decision 3 is the default | `user` (root `CLAUDE.md` and `.claude/` are `user`) |
| 3 | ATC-106 | `server/knowledge.ts`: a pure function over docs, Linear, ideas and changelog, and `GET /api/knowledge`; read-only, with `node:test` on fixtures | `auto` if it only reads through the existing fetchers; `flagged` if it adds a new outside call |
| 4 | ATC-107 | Shadow consumers: CHARTER DESK duplicates, CROSSCHECK `already-done`, MCC INSPECTION principle hits; recorded, not acted on | `flagged` (control-session manuals and CLI). It becomes `user` if it touches a guard |

Step 2 must land before step 3 is worth running (nothing to read otherwise). Step 3 can start on the doc parser while step 2 is in review. Step 4 waits for a few days of index data.

**Metrics** (from ATC-103): share of DISPATCH/SCHEDULE rejections with `already-done` or `parent-issue`; drafts or work orders later superseded or found conflicting after they were written; plans whose table was missing or wrong at review.

## 11. Risks

| Risk | Answer |
|---|---|
| Tags rot: nobody adds one to a new item | Step 3 lists untagged items in a Principles/Decisions section; MCC INSPECTION reads the plan's table. It is a nudge, not a landing condition |
| The table becomes a ritual ("New, searched everything") | The Searched column names words; a reviewer can rerun them. The shadow step measures how often a "New" row was later contradicted |
| Tagging 63 Principles and about a dozen Decisions sections is a large edit in shared docs | Step 2 only adds a tag; it changes no wording. One PR per few docs if needed |
| Parsing four Decision shapes | Step 3 reads only the KID tag and the following text. If a doc's Decisions are unparseable, step 2 fixes the doc, not the parser |
| The index says a conflict that is not one | It only lists candidates. Conflicts is a person's or a session's judgement (principle 2) |
| A public repository | The index holds titles from public docs and public issues only. Linear titles come from the same fetchers atc already uses, and are not written to a file |
| Overlap with idea 41 | Same principles; section 8 says where they join |

## 12. Worked example: this issue's own table

The "Relation to existing" table of ATC-104 (this design), filled in as the rule asks. The search line is what was actually done while writing.

| Item | Relation | Existing | Searched | Consequence |
|---|---|---|---|---|
| Knowledge layer that models what atc knows about itself | Extends | `gh:41` (ontology graph over the snapshot) | S2: idea 41 read in full and compared; S1: `dispatch.P*`, `mcc.P*` for shadow/derived | Section 8 keeps the parent's comparison; the INDEX joins idea 41's graph as a second node layer if K1 is built |
| Stable IDs on Principles, Decisions, features and lessons | New | none | S1: grep "ID scheme", "stable id" in `docs/`; S2: ideas titled "ontology", "knowledge"; S3: open ATC issues mentioning "principle"; S5: no fragment | IDs are added in step 2 (ATC-105) |
| Format `<doc>.<kind><n>` | New | none; must not clash with `D-xxxx` (`dispatch.md`), `S-xxxx` (`occ.md` 5), `C-xxxx` and `CC-xxxx` (`fleet.md` 8.3) | S1: the four ID formats above | See section 4 |
| Relation vocabulary New/Extends/Supersedes/Conflicts | Extends | `dispatch.md` 6.1 (FLIGHT hold chips, SUPERSEDED reasons) uses "superseded" for proposals only | S1: "supersede"; S4: PR 10 ("Name the real rule in SUPERSEDED reasons") | Same word, different object (proposals vs. knowledge items): the INDEX statuses `superseded` apply to KIDs only |
| "Relation to existing" table in plans | Extends | `occ.md` 5.3 (CHARTER DESK duplicate search by title words) | S1, S3 | Step 4 feeds the same check with the INDEX; the title-word search stays |
| Lessons in `docs/lessons.md` | New | Claude auto-memory (per folder; outside the repository) | S7: none exists; S1: no doc holds lessons; S2: none | Decision 3 |
| Derived index and `GET /api/knowledge` | Extends | `docs/*.md` and the changelog as sources (no new source); idea 41 K1 (`GET /api/graph`) | S6: `server/` has no doc parser; S2: idea 41 | Step 3; joins idea 41's graph later |
| Shadow consumers | Extends | `atfm.P1` (shadow first), `mcc.P4` (shadow before action) | S1: principles 1 in atfm.md and 4 in mcc.md | Step 4 follows the same pattern and gate style |

(The KIDs `atfm.P1` and `mcc.P4` are the ones step 2 will assign to those numbered Principles, cited here as the worked example shows them; they do not exist in the files yet.)
