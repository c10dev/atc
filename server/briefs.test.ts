import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BRIEF_BODY_MAX, briefFactsOf, briefLineOf, compareBriefs, crewModeOf, directLines, directSectionsOf, FULL_TEXT_LINE, findingsOf, formatAssignment, labelOf, reworkOf, type TalkEvent, talkEventsOf } from "./briefs.ts";
import type { LandingReview } from "./landing.ts";

test("BRIEF 줄: DIRECT·VECTORS를 읽고, 없으면 null", () => {
  assert.equal(briefLineOf("/atc-task ATC-32\nBRIEF: DIRECT\n목표: x"), "DIRECT");
  assert.equal(briefLineOf("brief：vectors"), "VECTORS");
  assert.equal(briefLineOf("DIRECT로 해 주세요"), null);
});

test("칸 제목 줄: 마크다운 제목·굵은 줄은 늘, 평문 이름표는 아는 칸 이름일 때만", () => {
  assert.deepEqual(labelOf("## 2. Done when:"), { i: 0, level: 2, title: "done when", rest: "" });
  assert.deepEqual(labelOf("**Goal:** 버튼 정리"), { i: 0, level: 7, title: "goal", rest: "버튼 정리" });
  assert.deepEqual(labelOf("완료 기준: 테스트 통과"), { i: 0, level: 7, title: "완료 기준", rest: "테스트 통과" });
  assert.equal(labelOf("참고: 이건 칸이 아님"), null);
  assert.equal(labelOf("- 목표: 글머리표"), null);
});

test("이슈 본문에서 목표·완료 기준·이 작업만의 제약", () => {
  const md = ["## Why", "배경", "## Outcome", "짧은 지시서", "### 세부", "- a", "## Not in scope", "- vocado 템플릿", "## Done when", "* 초안 통과", "* 비교 화면"].join("\n");
  assert.deepEqual(directSectionsOf(md), { goal: "짧은 지시서\n### 세부\n- a", done: "* 초안 통과\n* 비교 화면", constraints: "- vocado 템플릿" });
  // 금지 사항과 Hard constraints는 합친다. 완료 기준·제약은 자르지 않고, 목표만 600자에서 줄 경계로 자른다(ATC-35)
  const items = Array.from({ length: 80 }, (_, i) => `- 줄 ${i} ${"y".repeat(10)}`);
  const long = ["**목표**", ...Array.from({ length: 60 }, (_, i) => `목표 줄 ${i} ${"x".repeat(10)}`), "**Hard constraints:** staging 금지", "## 금지 사항", ...items].join("\n");
  const s = directSectionsOf(long);
  assert.ok(s.goal!.endsWith(" …") && s.goal!.length <= 603);
  assert.equal(s.constraints, ["staging 금지", ...items].join("\n"));
  assert.equal(s.done, null);
  assert.deepEqual(directSectionsOf(null), { goal: null, done: null, constraints: null });
});

test("DIRECT 배정 문구: 받는 팀·BRIEF 줄·목표·완료 기준·PILOT'S DISCRETION, 끝은 끝까지 진행", () => {
  const text = formatAssignment({ key: "ATC-40", title: "짧은 일", url: "https://linear.app/x/ATC-40" }, "목표: 한 줄\n완료 기준: 테스트", "team_h".toUpperCase());
  assert.equal(
    text,
    [
      "[→ TEAM_H] ATC-40",
      "BRIEF: DIRECT",
      "짧은 일",
      "https://linear.app/x/ATC-40",
      "목표: 한 줄",
      "완료 기준: 테스트",
      "애매한 곳은 PILOT'S DISCRETION으로 합리적인 기본값을 고르고 PR에 적으세요.",
      '— 맡으면 "READBACK ATC-40", 못 맡으면 사유로 답해 주세요. PR을 올리면 번호를 알려 주세요.',
      "끝까지 진행하고, SUPERVISOR 결정이 필요한 것만 멈춰서 물어 주세요.",
    ].join("\n"),
  );
});

// 대화 기록 줄(Claude Code JSONL)
const U = (t: string, content: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "user", timestamp: t, message: { role: "user", content }, ...extra });
const A = (t: string, ...uses: { name: string; input: unknown }[]) =>
  JSON.stringify({ type: "assistant", timestamp: t, message: { role: "assistant", content: [{ type: "text", text: "…" }, ...uses.map((u) => ({ type: "tool_use", id: "x", ...u }))] } });
const cross = (from: string, name: string, body: string) => `Another Claude session sent a message:\n<cross-session-message from="${from}" from-session="s" from-name="${name}" from-mode="prompting">\n${body}\n</cross-session-message>`;
const SOCK = "uds:/run/user/1000/cc-socks/1.sock";

test("대화 기록 사건: 받은 지시(cross-session·사용자), 보낸 SendMessage, AskUserQuestion만 — 도구 결과·skill 본문·서브에이전트는 뺀다", () => {
  const text = [
    U("2026-09-28T01:00:00Z", cross(SOCK, "structure", "/atc-task ATC-32\nBRIEF: DIRECT\n목표: x"), { isMeta: true }),
    U("2026-09-28T01:00:01Z", [{ type: "tool_result", tool_use_id: "x", content: "ATC-32 본문" }]),
    U("2026-09-28T01:00:02Z", "Base directory for this skill … ARGUMENTS: ATC-32", { isMeta: true }),
    A("2026-09-28T01:00:03Z", { name: "SendMessage", input: { to: SOCK, message: "READBACK ATC-32" } }),
    JSON.stringify({ type: "assistant", isSidechain: true, timestamp: "2026-09-28T01:00:04Z", message: { content: [{ type: "tool_use", name: "SendMessage", input: { to: "main", message: "끝" } }] } }),
    A("2026-09-28T01:10:00Z", { name: "AskUserQuestion", input: {} }, { name: "SendMessage", input: { to: "ui-builder", message: "화면 맡아 줘" } }),
    U("2026-09-28T01:20:00Z", "[DISPATCH D-0012] FLIGHT PLAN · JULIETT (TEAM_J)\nFLIGHT VOC201 · AIRPORT VCDO"),
    "not json",
  ].join("\n");
  const ev = talkEventsOf(text);
  assert.deepEqual(
    ev.map((e) => [e.t.slice(11, 19), e.dir, e.keys.join(","), e.ids.join(","), e.brief ?? e.to ?? "", Boolean(e.readback)]),
    [
      ["01:00:00", "in", "ATC-32", "", "DIRECT", false],
      ["01:00:03", "out", "ATC-32", "", SOCK, true],
      ["01:10:00", "ask", "", "", "", false],
      ["01:10:00", "out", "", "", "ui-builder", false],
      ["01:20:00", "in", "VOC-201", "D-0012", "", false],
    ],
  );
  assert.equal(ev[0].fromName, "structure");
  assert.equal(ev[0].from, SOCK);
  assert.equal(ev[4].from, null);
});

const ev = (t: string, e: Partial<TalkEvent>): TalkEvent => ({ t: `2026-09-28T${t}:00.000Z`, dir: "in", keys: [], ids: [], ...e });

test("지시서 사실: READBACK 직전의 지시, READBACK 뒤 PR 전까지 지시한 쪽에 보낸 질문과 AskUserQuestion", () => {
  const events = [
    ev("00:00", { dir: "in", from: SOCK, fromName: "structure", keys: ["ATC-32"], brief: null }), // 예고(VECTORS)
    ev("01:00", { dir: "in", from: SOCK, fromName: "structure", keys: ["ATC-32"], brief: "DIRECT" }),
    ev("01:01", { dir: "out", to: SOCK, keys: ["ATC-32"], readback: true }),
    ev("01:30", { dir: "out", to: SOCK, keys: [], readback: false }), // 질문
    ev("01:40", { dir: "out", to: "ui-builder", keys: [] }), // 팀원에게: 질문 아님
    ev("01:50", { dir: "ask" }),
    ev("02:00", { dir: "out", to: SOCK, keys: ["ATC-32"], report: true }), // PR 보고
    ev("03:00", { dir: "out", to: SOCK, keys: [] }), // PR 뒤
  ];
  assert.deepEqual(briefFactsOf(events, "ATC-32", "2026-09-28T02:30:00.000Z", "2026-09-28T01:05:00.000Z"), {
    kind: "DIRECT",
    at: "2026-09-28T01:00:00.000Z",
    by: "structure",
    readbackAt: "2026-09-28T01:01:00.000Z",
    questions: 2,
  });
  // 다른 FLIGHT·PR 뒤 지시는 보지 않는다
  assert.equal(briefFactsOf(events, "ATC-99", "2026-09-28T02:30:00.000Z", "2026-09-28T01:05:00.000Z"), null);
});

test("지시서 사실: DISPATCH FLIGHT PLAN은 D-xxxx READBACK으로 잇고, READBACK이 없으면 착수 12시간 전 이후의 첫 지시", () => {
  const plan = [
    ev("01:00", { dir: "in", from: "uds:occ", fromName: "OCC", keys: ["VOC-201"], ids: ["D-0012"], brief: "DIRECT" }),
    ev("01:02", { dir: "out", to: "uds:occ", keys: [], ids: ["D-0012"], readback: true }),
  ];
  assert.deepEqual(briefFactsOf(plan, "VOC-201", "2026-09-28T03:00:00.000Z", "2026-09-28T01:10:00.000Z")?.readbackAt, "2026-09-28T01:02:00.000Z");
  const noRb = [
    ev("00:00", { keys: ["VOC-5"], fromName: "structure" }),
    { ...ev("00:00", { keys: ["VOC-5"] }), t: "2026-09-27T00:00:00.000Z" },
  ].sort((a, b) => a.t.localeCompare(b.t));
  const f = briefFactsOf(noRb, "VOC-5", "2026-09-28T05:00:00.000Z", "2026-09-28T04:00:00.000Z");
  assert.deepEqual(f, { kind: "VECTORS", at: "2026-09-28T00:00:00.000Z", by: "structure", readbackAt: null, questions: 0 });
});

test("P0–P2 지적: Codex 스레드 첫 댓글(배지 없으면 P2, P3 제외) + 착륙 리뷰는 head마다 마지막 것", () => {
  const th = (author: string, body: string) => ({ comments: [{ author, at: "", commit: null, body }] });
  const threads = [th("chatgpt-codex-connector", "![P1 Badge](x) 고쳐야"), th("chatgpt-codex-connector", "배지 없음"), th("chatgpt-codex-connector", "![P3 Badge](x)"), th("someone", "![P0 Badge](x)")];
  const r = (head: string, p0: number, p1: number, p2: number, number = 7): LandingReview => ({ at: "", repo: "o/r", number, head, verdict: "findings", text: "", by: "", model: "", family: "", p0, p1, p2 });
  assert.deepEqual(findingsOf(threads, [r("a", 1, 1, 0), r("a", 0, 1, 0), r("b", 0, 0, 2), r("a", 5, 5, 5, 8)], "o/r", 7), { p0: 0, p1: 2, p2: 3 });
});

test("PR 뒤 수정 커밋: authoredDate가 PR을 연 뒤이고 병합 커밋이 아닌 것", () => {
  const c = (authoredDate: string, messageHeadline = "fix") => ({ authoredDate, messageHeadline });
  assert.equal(reworkOf([c("2026-09-28T00:00:00Z"), c("2026-09-28T02:00:00Z"), c("2026-09-28T03:00:00Z", "Merge branch 'main'"), c("2026-09-28T04:00:00Z")], "2026-09-28T01:00:00Z"), 2);
});

test("VECTORS 대 DIRECT 비교: 기간 안 ARRIVED만, 지시서를 못 찾은 것은 unmeasured, 지적·수정 커밋은 잰 것만 평균", () => {
  const NOW = Date.parse("2026-09-28T12:00:00Z");
  const e = (key: string, arrivedAt: string, measured?: object) => ({ key, flight: key, aircraft: "TEAM_H", arrivedAt, landingWaitMin: 60, measured });
  const b = (kind: "DIRECT" | "VECTORS", at: string, questions: number, readbackAt: string | null = null) => ({ kind, at, by: "structure", readbackAt, questions });
  const out = compareBriefs(
    [
      e("A-1", "2026-09-28T10:00:00Z", { brief: b("DIRECT", "2026-09-28T07:00:00Z", 0, "2026-09-28T07:30:00Z"), findings: { p0: 0, p1: 1, p2: 1 }, rework: 1 }),
      e("A-2", "2026-09-28T11:00:00Z", { brief: b("DIRECT", "2026-09-28T09:00:00Z", 1) }),
      e("A-3", "2026-09-27T10:00:00Z", { brief: b("VECTORS", "2026-09-27T05:00:00Z", 3), findings: { p0: 1, p1: 2, p2: 0 }, rework: 4 }),
      e("A-4", "2026-09-27T09:00:00Z", { brief: null }),
      e("A-5", "2026-09-27T08:00:00Z"),
      e("A-6", "2026-08-01T08:00:00Z", { brief: b("VECTORS", "2026-08-01T05:00:00Z", 9) }), // 기간 밖
    ],
    NOW,
    30,
  );
  assert.deepEqual(out.rows.map((r) => [r.key, r.kind, r.questions, r.readbackToPrMin, r.findings, r.rework]), [
    ["A-2", "DIRECT", 1, 60, null, null],
    ["A-1", "DIRECT", 0, 90, 2, 1],
    ["A-3", "VECTORS", 3, 240, 3, 4],
  ]);
  assert.equal(out.unmeasured, 2);
  assert.deepEqual(out.stats.DIRECT, { flights: 2, questionsPerFlight: 0.5, oneShot: 0.5, readbackToPrMedianMin: 75, findingsPerFlight: 2, findingsMeasured: 1, reworkPerFlight: 1, reworkMeasured: 1 });
  assert.equal(out.stats.VECTORS.flights, 1);
  assert.deepEqual(compareBriefs([], NOW, 30).stats.DIRECT, { flights: 0, questionsPerFlight: null, oneShot: null, readbackToPrMedianMin: null, findingsPerFlight: null, findingsMeasured: 0, reworkPerFlight: null, reworkMeasured: 0 });
});

test("대화 기록 사건: 파일 쓰기(Edit·Write·MultiEdit·NotebookEdit)는 leader, 서브에이전트 기록은 crew로 쓰기만", () => {
  const main = [
    A("2026-09-28T02:00:00Z", { name: "Edit", input: { file_path: "/w/s/a.ts", old_string: "x", new_string: "y" } }, { name: "Read", input: { file_path: "/w/s/b.ts" } }),
    A("2026-09-28T02:01:00Z", { name: "NotebookEdit", input: { notebook_path: "/w/s/n.ipynb" } }),
    JSON.stringify({ type: "assistant", isSidechain: true, timestamp: "2026-09-28T02:02:00Z", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/w/s/c.ts" } }] } }),
  ].join("\n");
  assert.deepEqual(talkEventsOf(main).map((e) => [e.dir, e.by, e.path]), [["write", "leader", "/w/s/a.ts"], ["write", "leader", "/w/s/n.ipynb"]]);
  // CAPTAIN의 Bash: 명령에 적힌 /home/… 경로를 CAPTAIN 작업으로
  const bash = A("2026-09-28T02:05:00Z", { name: "Bash", input: { command: "cd /home/c10/w/atc-33 && python3 - <<'EOF'\nopen('/home/c10/w/atc-33/server/a.ts')\nEOF" } });
  assert.deepEqual(talkEventsOf(bash).map((e) => [e.dir, e.by, e.path]), [["write", "leader", "/home/c10/w/atc-33"], ["write", "leader", "/home/c10/w/atc-33/server/a.ts"]]);
  const sub = [
    JSON.stringify({ type: "user", isSidechain: true, timestamp: "2026-09-28T02:03:00Z", message: { content: "ATC-32 구현해 줘" } }),
    JSON.stringify({ type: "assistant", isSidechain: true, timestamp: "2026-09-28T02:04:00Z", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/w/s/c.ts" } }, { type: "tool_use", name: "SendMessage", input: { to: "main", message: "끝" } }] } }),
  ].join("\n");
  assert.deepEqual(talkEventsOf(sub, "crew").map((e) => [e.dir, e.by, e.path]), [["write", "crew", "/w/s/c.ts"]]);
  // 서브에이전트의 Bash는 세지 않는다
  assert.deepEqual(talkEventsOf(JSON.stringify({ type: "assistant", isSidechain: true, timestamp: "2026-09-28T02:06:00Z", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cd /home/c10/w/atc-33 && npm test" } }] } }), "crew"), []);
});

test("SOLO·CREW: STAND 안 문서 밖 파일을 서브에이전트가 썼으면 CREW, CAPTAIN만 썼으면 SOLO, 쓰기가 없으면 null", () => {
  const w = (t: string, by: "leader" | "crew", path: string): TalkEvent => ({ t: `2026-09-28T${t}:00.000Z`, dir: "write", by, path, keys: [], ids: [] });
  const from = "2026-09-28T01:00:00Z";
  const to = "2026-09-28T05:00:00Z";
  const stands = ["/w/atc-33"];
  assert.equal(crewModeOf([w("02:00", "leader", "/w/atc-33/server/a.ts"), w("02:10", "crew", "/w/atc-33/docs/x.md")], stands, from, to), "SOLO");
  assert.equal(crewModeOf([w("02:00", "leader", "/w/atc-33/server/a.ts"), w("02:10", "crew", "/w/atc-33/web/b.tsx")], stands, from, to), "CREW");
  // STAND 밖(비슷한 이름 포함)·기간 밖·문서만은 세지 않는다
  assert.equal(crewModeOf([w("02:00", "crew", "/w/atc-33-old/a.ts"), w("06:00", "crew", "/w/atc-33/a.ts"), w("02:00", "leader", "/w/atc-33/CHANGELOG.md")], stands, from, to), null);
  assert.equal(crewModeOf([w("02:00", "leader", "/w/atc-33/a.ts")], [], from, to), null);
});

test("2×2 비교: 지시서 × SOLO·CREW, crew를 모르는 행은 crewUnknown", () => {
  const NOW = Date.parse("2026-09-28T12:00:00Z");
  const b = (kind: "DIRECT" | "VECTORS") => ({ kind, at: "2026-09-28T01:00:00Z", by: null, readbackAt: null, questions: 0 });
  const e = (key: string, kind: "DIRECT" | "VECTORS", crew: "SOLO" | "CREW" | null) => ({ key, flight: key, aircraft: "TEAM_J", arrivedAt: "2026-09-28T10:00:00Z", landingWaitMin: 0, measured: { brief: b(kind), crew } });
  const out = compareBriefs([e("A-1", "DIRECT", "SOLO"), e("A-2", "DIRECT", "SOLO"), e("A-3", "VECTORS", "CREW"), e("A-4", "VECTORS", null)], NOW, 30);
  assert.deepEqual(Object.fromEntries(Object.entries(out.grid).map(([k, v]) => [k, v.flights])), { "VECTORS·SOLO": 0, "VECTORS·CREW": 1, "DIRECT·SOLO": 2, "DIRECT·CREW": 0 });
  assert.deepEqual([out.crewStats.SOLO.flights, out.crewStats.CREW.flights, out.crewUnknown], [2, 1, 1]);
  assert.equal(out.rows.find((r) => r.key === "A-4")?.crew, null);
});

// ATC-34 본문: 2026-09-28 지시서가 `merge` 제외 목록을 첫 항목 뒤에서 잘라 보안 경로·Human Preview·FLIGHT 없음·hold·GROUND STOP이 빠졌다(ATC-35)
const ATC34 = readFileSync(new URL("./fixtures/atc-34-body.md", import.meta.url), "utf8");

test("DIRECT 지시서: ATC-34 본문의 완료 기준·제약을 자르지 않고 모두 싣는다", () => {
  const s = directSectionsOf(ATC34);
  const text = formatAssignment({ key: "ATC-34", title: "AUTOLAND", url: "u" }, ATC34, "TEAM_H");
  for (const item of [
    "`rating:SEC` or `Risk:*`;",
    "migration, SQL, auth, admission or RLS paths",
    "Human Preview is `required` and not `passed`;",
    "a PR with no FLIGHT;",
    "any PR the SUPERVISOR marks \"hold\"",
    "puts AUTOLAND in GROUND STOP",
    "The en and ko docs and the glossary include AUTOLAND.",
    "No force-push, no auto-merge setting on GitHub",
    "The atc repo's own landing (structure merges auto/flagged) is out of scope.",
  ]) {
    assert.ok(s.done!.includes(item) || s.constraints!.includes(item), item);
    assert.ok(text.includes(item), item);
  }
  assert.ok(!s.done!.includes("…") && !s.constraints!.includes("…"));
  assert.ok(!text.includes(FULL_TEXT_LINE));
});

test("DIRECT 지시서: 상한을 넘으면 완료 기준·제약을 일부만 싣지 않고, 이슈 본문을 읽으라고 한 줄로 적는다", () => {
  const big = { goal: "짧은 목표", done: Array.from({ length: 400 }, (_, i) => `* 기준 ${i} ${"z".repeat(10)}`).join("\n"), constraints: "* 금지" };
  assert.ok(big.done.length > BRIEF_BODY_MAX);
  assert.deepEqual(directLines(big), ["목표: 짧은 목표", FULL_TEXT_LINE]);
  // 목표가 없어도 한 줄은 남는다
  assert.deepEqual(directLines({ ...big, goal: null }), [FULL_TEXT_LINE]);
  // 상한 안이면 그대로
  assert.deepEqual(directLines({ goal: null, done: "* 하나", constraints: null }), ["완료 기준: * 하나"]);
});
