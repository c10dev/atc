import assert from "node:assert/strict";
import { test } from "node:test";
import { type CrewMember, DEFAULT_FLEET } from "./crew.ts";
import { type CrewChangeOp, type CrewState, diffCrew, foldCrewChanges, nextCrewChangeId, pairChanges, planCrewChange, ratingImpact } from "./crew-change.ts";

const D = DEFAULT_FLEET.defaults;
const DEFAULT: CrewState = { complement: D.complement, ratings: D.ratings };
const backend: CrewMember = { position: "backend", agent: "claude-opus-5-5" };
const flash: CrewMember = { position: "flash-helper", agent: "flash-helper", limits: ["no BUILD", "no CHECK verdicts", "no SEC"] };
const ctx = (id: string, at = "2026-09-27T01:00:00.000Z") => ({ registration: "TEAM_H", id, at });

test("diffCrew: 같은 표기의 팀원 수로 비교하고, agent가 바뀌면 내림과 탐으로 본다", () => {
  assert.deepEqual(diffCrew(D.complement, D.complement), { added: [], removed: [] });
  assert.deepEqual(diffCrew([backend, flash], [backend]), { added: [], removed: ["flash-helper: flash-helper (no BUILD, no CHECK verdicts, no SEC)"] });
  assert.deepEqual(diffCrew([backend], [{ position: "backend", agent: "sonnet" }, backend]), { added: ["backend: sonnet"], removed: [] });
  assert.deepEqual(diffCrew([backend], [{ position: "backend", agent: "sonnet" }]), { added: ["backend: sonnet"], removed: ["backend: claude-opus-5-5"] });
});

test("ratingImpact: 유일한 구현 팀원을 내리면 BUILD·CHECK·SEC를 잃는다", () => {
  const impact = ratingImpact({ complement: [backend, flash], ratings: ["DATA", "DOCS"] }, { complement: [flash], ratings: ["DATA", "DOCS"] });
  assert.equal(impact.length, 3);
  assert.match(impact[0], /^BUILD·MAINT·TEST를 더는 날 수 없음/);
  assert.match(impact[1], /^CHECK를 더는 날 수 없음/);
  assert.match(impact[2], /^SEC를 맡을 팀원이 없어짐/);
  // ui-qa를 내리면 UI 우선 조건이 깨진다. TYPE RATING 차이도 적는다
  const ui = ratingImpact(DEFAULT, { complement: D.complement.filter((m) => m.position !== "ui-qa"), ratings: ["UI", "DOCS"] });
  assert.deepEqual(ui.slice(0, 1), ["TYPE RATING −DATA"]);
  assert.match(ui[1], /ui-builder와 ui-qa/);
  assert.deepEqual(ratingImpact(DEFAULT, { complement: D.complement.filter((m) => m !== D.complement[3]), ratings: D.ratings }), []);
});

test("planCrewChange: 새 CREW CHANGE를 만들고 CAPTAIN 지시문을 쓴다", () => {
  const next = { complement: D.complement.filter((m) => m.position !== "flash-helper"), ratings: D.ratings };
  const ops = planCrewChange(null, DEFAULT, next, ctx("CC-0001"));
  assert.equal(ops.length, 1);
  const c = ops[0] as Extract<CrewChangeOp, { op: "created" }>;
  assert.equal(c.op, "created");
  assert.deepEqual(c.removed, ["flash-helper: flash-helper (no BUILD, no CHECK verdicts, no SEC)"]);
  assert.deepEqual(c.added, []);
  assert.deepEqual(c.before, DEFAULT);
  assert.ok(c.text.startsWith("[ATC FLEET] CREW CHANGE · HOTEL (TEAM_H) · CC-0001\n"));
  assert.ok(c.text.includes("내리는 CREW"));
  assert.ok(!c.text.includes("타는 CREW"));
  assert.ok(c.text.includes("- 배정 범위는 그대로입니다."));
  assert.ok(c.text.endsWith('"TEAM_H CREW CHANGE CC-0001 COMPLETE" 한 줄만 남기세요.'));
  // COMPLEMENT가 안 바뀐 PATCH는 기록하지 않는다
  assert.deepEqual(planCrewChange(null, DEFAULT, { ...DEFAULT, ratings: ["DOCS"] }, ctx("CC-0001")), []);
});

test("planCrewChange: 대기 건이 있으면 원래 '전'에서 최신 '후'로 합치고, 원래로 돌아오면 닫기만 한다", () => {
  const noFlash = { complement: D.complement.filter((m) => m.position !== "flash-helper"), ratings: D.ratings };
  const first = planCrewChange(null, DEFAULT, noFlash, ctx("CC-0001"));
  const pending = foldCrewChanges(first)[0];
  const withSonnet = { complement: [...noFlash.complement, { position: "reviewer", agent: "sonnet" }], ratings: D.ratings };
  const second = planCrewChange(pending, noFlash, withSonnet, ctx("CC-0002", "2026-09-27T02:00:00.000Z"));
  assert.deepEqual(second[0], { op: "superseded", id: "CC-0001", at: "2026-09-27T02:00:00.000Z", by: "CC-0002" });
  const merged = second[1] as Extract<CrewChangeOp, { op: "created" }>;
  assert.deepEqual(merged.before, DEFAULT);
  assert.deepEqual(merged.added, ["reviewer: sonnet"]);
  assert.equal(merged.removed.length, 1);
  // 대기 중이면 TYPE RATING만 바뀌어도 지시문을 새로 쓴다
  const rated = planCrewChange(foldCrewChanges([...first, ...second]).find((c) => c.status === "pending")!, withSonnet, { ...withSonnet, ratings: ["DOCS"] }, ctx("CC-0003"));
  assert.equal(rated.length, 2);
  // CHECKRIDE 부여·회수도 이 길로 온다: 새 지시문의 TYPE RATING 줄이 바뀐 rating을 따른다
  assert.ok((rated[1] as Extract<CrewChangeOp, { op: "created" }>).text.includes("TYPE RATING: DOCS"));
  // 원래 구성으로 돌리면 대기 건만 닫는다
  const back = planCrewChange(foldCrewChanges([...first, ...second]).find((c) => c.status === "pending")!, withSonnet, DEFAULT, ctx("CC-0003"));
  assert.deepEqual(back, [{ op: "superseded", id: "CC-0002", at: "2026-09-27T01:00:00.000Z", by: null }]);
});

test("foldCrewChanges: pending → delivered, 닫힌 건은 다시 바뀌지 않는다. 번호는 가장 큰 것 다음", () => {
  const created = planCrewChange(null, DEFAULT, { complement: [backend], ratings: ["DOCS"] }, ctx("CC-0007"));
  const folded = foldCrewChanges([
    ...created,
    { op: "delivered", id: "CC-0007", at: "2026-09-27T03:00:00.000Z" },
    { op: "superseded", id: "CC-0007", at: "2026-09-27T04:00:00.000Z", by: null },
    { op: "delivered", id: "CC-9999", at: "2026-09-27T03:00:00.000Z" },
  ]);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].status, "delivered");
  assert.equal(folded[0].deliveredAt, "2026-09-27T03:00:00.000Z");
  assert.equal(folded[0].supersededAt, null);
  assert.equal(nextCrewChangeId(folded), "CC-0008");
  assert.equal(nextCrewChangeId([]), "CC-0001");
});

test("pairChanges: 같은 POSITION이 한 번씩 내리고 타면 바뀜으로 묶고, 지시문에 따로 적는다", () => {
  const before = { complement: [backend, flash], ratings: D.ratings };
  const after = { complement: [{ ...backend, limits: ["no CHECK verdicts"] }, { position: "reviewer", agent: "sonnet" }], ratings: D.ratings };
  const c = planCrewChange(null, before, after, ctx("CC-0001"))[0] as Extract<CrewChangeOp, { op: "created" }>;
  assert.deepEqual(pairChanges(c.added, c.removed), {
    changed: [["backend: claude-opus-5-5", "backend: claude-opus-5-5 (no CHECK verdicts)"]],
    added: ["reviewer: sonnet"],
    removed: ["flash-helper: flash-helper (no BUILD, no CHECK verdicts, no SEC)"],
  });
  assert.ok(c.text.includes("바뀌는 CREW (같은 POSITION)\n- backend: claude-opus-5-5 → claude-opus-5-5 (no CHECK verdicts)"));
  assert.ok(c.text.includes("제약만 바뀐 팀원은"));
  assert.ok(!c.text.includes("agent나 모델이 바뀐 팀원은"));
});
