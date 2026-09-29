import assert from "node:assert/strict";
import { test } from "node:test";
import { type CrewMember, DEFAULT_FLEET } from "./crew.ts";
import { readFileSync } from "node:fs";
import {
  approveRefusal,
  CREW_CHANGE_READBACK_OVERDUE_MS,
  type CrewChange,
  type CrewChangeOp,
  type CrewState,
  crewChangeBriefOf,
  crewChangeMessage,
  diffCrew,
  foldCrewChanges,
  isCrewChangeOverdue,
  nextCrewChangeId,
  openCrewChangeOf,
  pairChanges,
  planCrewChange,
  ratingImpact,
  selfCheckCrewChange,
  sendRefusal,
} from "./crew-change.ts";

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
  assert.ok(c.text.includes("CREW leaving"));
  assert.ok(!c.text.includes("CREW joining"));
  assert.ok(c.text.includes("- The assignment range is unchanged."));
  assert.ok(c.text.endsWith('When applied, leave only the line "TEAM_H CREW CHANGE CC-0001 COMPLETE".'));
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
  assert.ok(c.text.includes("CREW changing (same POSITION)\n- backend: claude-opus-5-5 → claude-opus-5-5 (no CHECK verdicts)"));
  assert.ok(c.text.includes("Leave crew whose limits alone changed"));
  assert.ok(!c.text.includes("Stop crew whose agent or model changed"));
});

// ── 2단계: 승인 → OCC 발부 → READBACK ──

const T0 = "2026-09-27T01:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const noFlash = { complement: D.complement.filter((m) => m.position !== "flash-helper"), ratings: D.ratings };
const created = (id = "CC-0001", reg = "TEAM_H") => planCrewChange(null, DEFAULT, noFlash, { registration: reg, id, at: T0 });
const one = (ops: CrewChangeOp[], id = "CC-0001") => foldCrewChanges(ops).find((c) => c.id === id)!;
const sentOps = (id = "CC-0001", reg = "TEAM_H"): CrewChangeOp[] => {
  const base = created(id, reg);
  const c = one(base, id);
  return [...base, { op: "approved", id, at: at(1) }, { op: "sent", id, at: at(2), message: crewChangeMessage(c) }];
};

test("foldCrewChanges: pending → approved → sent → acknowledged, 시각과 보낸 문구를 남긴다", () => {
  const ops = [...sentOps(), { op: "acknowledged" as const, id: "CC-0001", at: at(5) }];
  const c = one(ops);
  assert.equal(c.status, "acknowledged");
  assert.deepEqual([c.approvedAt, c.sentAt, c.acknowledgedAt, c.deliveredAt, c.supersededAt], [at(1), at(2), at(5), null, null]);
  assert.ok(c.message?.startsWith("[OCC CC-0001] CREW CHANGE · HOTEL (TEAM_H)\n"));
  assert.equal(one(sentOps()).status, "sent");
  assert.equal(one(sentOps().slice(0, 2)).status, "approved");
});

test("foldCrewChanges: 순서를 건너뛰거나 닫힌 건을 바꾸는 op는 무시한다", () => {
  const base = created();
  const msg = crewChangeMessage(one(base));
  // 승인 없이 sent·acknowledged는 안 된다
  assert.equal(one([...base, { op: "sent", id: "CC-0001", at: at(1), message: msg }]).status, "pending");
  assert.equal(one([...base, { op: "acknowledged", id: "CC-0001", at: at(1) }]).status, "pending");
  // approved도 전달함(delivered)·대신하기(superseded)가 된다
  assert.equal(one([...base, { op: "approved", id: "CC-0001", at: at(1) }, { op: "delivered", id: "CC-0001", at: at(2) }]).status, "delivered");
  assert.equal(one([...base, { op: "approved", id: "CC-0001", at: at(1) }, { op: "superseded", id: "CC-0001", at: at(2), by: "CC-0002" }]).status, "superseded");
  // sent는 전달함·대신하기·다시 승인되지 않고 READBACK만 기다린다
  for (const op of [
    { op: "delivered", id: "CC-0001", at: at(3) },
    { op: "superseded", id: "CC-0001", at: at(3), by: "CC-0002" },
    { op: "approved", id: "CC-0001", at: at(3) },
    { op: "sent", id: "CC-0001", at: at(3), message: "다른 문구" },
  ] as CrewChangeOp[]) {
    const c = one([...sentOps(), op]);
    assert.deepEqual([c.status, c.sentAt, c.message], ["sent", at(2), msg], op.op);
  }
  // acknowledged·delivered는 닫힌 건
  assert.equal(one([...sentOps(), { op: "acknowledged", id: "CC-0001", at: at(5) }, { op: "superseded", id: "CC-0001", at: at(6), by: null }]).status, "acknowledged");
  assert.equal(one([...base, { op: "delivered", id: "CC-0001", at: at(1) }, { op: "approved", id: "CC-0001", at: at(2) }]).status, "delivered");
});

test("crewChangeMessage: [OCC CC-xxxx] 머리 + 지시문 본문(옛 머리 뗌) + READBACK 요청 줄. 두 번 감싸도 같다", () => {
  const c = one(created());
  const m = crewChangeMessage(c);
  const lines = m.split("\n");
  assert.equal(lines[0], "[OCC CC-0001] CREW CHANGE · HOTEL (TEAM_H)");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "TEAM_H CAPTAIN, the SUPERVISOR changed this AIRCRAFT's CREW COMPLEMENT. Change your crew as follows.");
  assert.ok(!m.includes("[ATC FLEET]"));
  assert.ok(m.includes('When applied, leave only the line "TEAM_H CREW CHANGE CC-0001 COMPLETE".'));
  assert.ok(m.endsWith('— Reply to this message with "READBACK CC-0001" if you take it, "UNABLE CC-0001 — reason" if you cannot, or "STANDBY CC-0001" if you need time.'));
  // 본문은 지시문 그대로(머리 두 줄만 다름)
  assert.equal(lines.slice(2, -2).join("\n"), c.text.split("\n").slice(2).join("\n"));
  // 이미 [OCC …] 머리가 붙은 본문도 머리를 한 번만 둔다
  assert.equal(crewChangeMessage({ ...c, text: m.split("\n").slice(0, -2).join("\n") }), m);
  // 머리가 없는 본문은 그대로 감싼다. callsign이 없는 이름은 REGISTRATION만
  assert.equal(crewChangeMessage({ id: "CC-0009", registration: "OPS", text: "본문" }), '[OCC CC-0009] CREW CHANGE · OPS\n\n본문\n\n— Reply to this message with "READBACK CC-0009" if you take it, "UNABLE CC-0009 — reason" if you cannot, or "STANDBY CC-0009" if you need time.');
});

test("planCrewChange: approved는 새 변경이 대신하고(다시 승인), sent는 그대로 두고 새 건은 지금 선언에서 시작한다", () => {
  const withSonnet = { complement: [...noFlash.complement, { position: "reviewer", agent: "sonnet" }], ratings: D.ratings };
  // approved → superseded, 새 건은 원래 "전"에서 합쳐 pending
  const approvedOps = [...created(), { op: "approved" as const, id: "CC-0001", at: at(1) }];
  const next = planCrewChange(one(approvedOps), noFlash, withSonnet, ctx("CC-0002", at(3)));
  assert.deepEqual(next[0], { op: "superseded", id: "CC-0001", at: at(3), by: "CC-0002" });
  const merged = foldCrewChanges([...approvedOps, ...next]);
  assert.deepEqual(merged.map((c) => c.status), ["superseded", "pending"]);
  assert.deepEqual(merged[1].before, DEFAULT);
  // sent가 열려 있으면 부르는 쪽(noteCrewChange)은 대기 건 없이 부른다: sent는 그대로, 새 건은 sent의 "후"에서
  const later = planCrewChange(null, noFlash, withSonnet, ctx("CC-0002", at(3)));
  assert.equal(later.length, 1);
  const both = foldCrewChanges([...sentOps(), ...later]);
  assert.deepEqual(both.map((c) => c.status), ["sent", "pending"]);
  assert.deepEqual(both[1].before, noFlash);
  assert.deepEqual(both[1].added, ["reviewer: sonnet"]);
  assert.deepEqual(both[1].removed, []);
});

test("isCrewChangeOverdue: sent 뒤 10분 넘게 READBACK이 없으면", () => {
  const c = one(sentOps());
  const sentAt = Date.parse(at(2));
  assert.equal(CREW_CHANGE_READBACK_OVERDUE_MS, 10 * 60_000);
  assert.equal(isCrewChangeOverdue(c, sentAt + 10 * 60_000), false);
  assert.equal(isCrewChangeOverdue(c, sentAt + 10 * 60_000 + 1), true);
  assert.equal(isCrewChangeOverdue({ ...c, status: "acknowledged" }, sentAt + 60 * 60_000), false);
  assert.equal(isCrewChangeOverdue(one(created()), sentAt + 60 * 60_000), false);
});

test("approveRefusal: approval 모드의 pending만. 아니면 404·409", () => {
  const pending = one(created());
  assert.equal(approveRefusal(pending, "approval"), null);
  assert.deepEqual(approveRefusal(undefined, "approval")?.[0], 404);
  assert.match(approveRefusal(pending, "shadow")?.[1] ?? "", /approval 모드\(2b\)에서만/);
  for (const c of [one(sentOps().slice(0, 2)), one(sentOps()), { ...pending, status: "delivered" as const }, { ...pending, status: "superseded" as const }])
    assert.deepEqual(approveRefusal(c, "approval"), [409, `CC-0001는 승인할 상태가 아님(${c.status})`]);
});

test("sendRefusal: approval 모드의 approved(또는 재송신할 sent)만, 같은 AIRCRAFT에 READBACK 대기 건이 있으면 기다린다", () => {
  const approved = one(sentOps().slice(0, 2));
  const sent = one(sentOps());
  assert.equal(sendRefusal(approved, [approved], "approval"), null);
  assert.equal(sendRefusal(sent, [sent], "approval"), null); // 재송신
  assert.match(sendRefusal(approved, [approved], "shadow")?.[1] ?? "", /approval 모드/);
  assert.match(sendRefusal(one(created()), [], "approval")?.[1] ?? "", /보낼 상태가 아님\(pending\) — SUPERVISOR 승인/);
  assert.equal(sendRefusal(undefined, [], "approval")?.[0], 404);
  const next = { ...approved, id: "CC-0002" };
  assert.deepEqual(sendRefusal(next, [sent, next], "approval"), [409, "TEAM_H에 READBACK 대기 중인 CC-0001가 있음 — 그 READBACK 뒤에 보낸다"]);
  // 다른 AIRCRAFT의 sent는 상관없다
  assert.equal(sendRefusal({ ...next, registration: "TEAM_B" }, [sent, next], "approval"), null);
});

test("openCrewChangeOf: 카드에는 보내지 않은 건을 먼저, 없으면 READBACK 대기 건. waitingFor·overdue", () => {
  const sentAt = Date.parse(at(2));
  const withNext = [...sentOps(), ...planCrewChange(null, noFlash, DEFAULT, ctx("CC-0002", at(4)))];
  const all = foldCrewChanges(withNext);
  const card = openCrewChangeOf(all, "team_h", sentAt + 11 * 60_000)!;
  assert.deepEqual([card.id, card.status, card.waitingFor, card.overdue, card.message], ["CC-0002", "pending", "CC-0001", false, null]);
  const only = openCrewChangeOf(foldCrewChanges(sentOps()), "TEAM_H", sentAt + 11 * 60_000)!;
  assert.deepEqual([only.id, only.status, only.waitingFor, only.overdue, only.sentAt, only.approvedAt], ["CC-0001", "sent", null, true, at(2), at(1)]);
  assert.ok(only.message?.startsWith("[OCC CC-0001]"));
  assert.equal(openCrewChangeOf(foldCrewChanges([...sentOps(), { op: "acknowledged", id: "CC-0001", at: at(5) }]), "TEAM_H", sentAt), null);
  assert.equal(openCrewChangeOf(all, "TEAM_B", sentAt), null);
});

test("crewChangeBriefOf: 보낼 것(approved), 기다리는 것(waiting), READBACK 대기(sent), 늦은 것, 승인 대기(pending)", () => {
  const h = sentOps("CC-0001", "TEAM_H");
  const hNext = planCrewChange(null, noFlash, DEFAULT, { registration: "TEAM_H", id: "CC-0002", at: at(3) });
  const b = created("CC-0003", "TEAM_B");
  const c = created("CC-0004", "TEAM_C");
  const ops: CrewChangeOp[] = [...h, ...hNext, { op: "approved", id: "CC-0002", at: at(4) }, ...b, { op: "approved", id: "CC-0003", at: at(4) }, ...c];
  const brief = crewChangeBriefOf(foldCrewChanges(ops), "approval", Date.parse(at(13)));
  assert.equal(brief.mode, "approval");
  assert.deepEqual(brief.approved.map((x) => x.id), ["CC-0003"]);
  assert.deepEqual(brief.waiting.map((x) => [x.id, x.waitingFor]), [["CC-0002", "CC-0001"]]);
  assert.deepEqual(brief.sent.map((x) => [x.id, x.overdue]), [["CC-0001", true]]);
  assert.deepEqual(brief.overdue, ["CC-0001"]);
  assert.deepEqual(brief.pending, ["CC-0004"]);
  // 기록 안의 문구·지시문은 브리핑에 싣지 않는다(보낼 문구는 crew-change send가 준다)
  assert.ok(!JSON.stringify(brief).includes("CAPTAIN,"));
});

test("selfCheckCrewChange: 지금 코드와 atcctl에서 빠진 것이 없고, atcctl이 없으면 명령이 빠졌다고 한다", () => {
  const src = readFileSync(new URL("../controller/atcctl.mjs", import.meta.url), "utf8");
  assert.deepEqual(selfCheckCrewChange(src), []);
  assert.deepEqual(selfCheckCrewChange(null), ["atcctl crew-change send", "atcctl crew-change readback"]);
  assert.deepEqual(selfCheckCrewChange(src.replace('"brief", "send", "readback"', '"brief", "send"')), ["atcctl crew-change readback"]);
});

test("CrewChange 기록 형: 새 필드는 만든 때 null", () => {
  const c: CrewChange = one(created());
  assert.deepEqual([c.status, c.approvedAt, c.sentAt, c.message, c.acknowledgedAt], ["pending", null, null, null, null]);
});

test("CREW CHANGE UNABLE·STANDBY(ATC-122): UNABLE은 sent를 닫고 브리핑에 사유를, STANDBY는 overdue를 한 번 다시 센다", () => {
  const next = { complement: D.complement.filter((m) => m.position !== "flash-helper"), ratings: D.ratings };
  const at = "2026-09-27T01:00:00.000Z";
  const base = planCrewChange(null, DEFAULT, next, ctx("CC-0001", at));
  const created = foldCrewChanges(base)[0];
  const sentAt = "2026-09-27T01:10:00.000Z";
  const sent: CrewChangeOp[] = [...base, { op: "approved", id: "CC-0001", at }, { op: "sent", id: "CC-0001", at: sentAt, message: crewChangeMessage(created) }];
  const min = (m: number) => Date.parse(sentAt) + m * 60_000;
  assert.equal(isCrewChangeOverdue(foldCrewChanges(sent)[0], min(11)), true);
  const standby = foldCrewChanges([...sent, { op: "standby", id: "CC-0001", at: new Date(min(8)).toISOString() }])[0];
  assert.equal(standby.status, "sent");
  assert.equal(standby.standbys, 1);
  assert.equal(isCrewChangeOverdue(standby, min(11)), false);
  assert.equal(isCrewChangeOverdue(standby, min(19)), true);
  const unableAt = new Date(min(3)).toISOString();
  const unable = foldCrewChanges([...sent, { op: "unable", id: "CC-0001", at: unableAt, reason: "flash-helper가 지금 FLIGHT 중" }]);
  assert.equal(unable[0].status, "unable");
  assert.equal(unable[0].unableReason, "flash-helper가 지금 FLIGHT 중");
  assert.equal(isCrewChangeOverdue(unable[0], min(30)), false);
  // 닫힌 뒤에는 READBACK·STANDBY를 받지 않는다
  const after = foldCrewChanges([...sent, { op: "unable", id: "CC-0001", at: unableAt, reason: "r" }, { op: "acknowledged", id: "CC-0001", at: unableAt }])[0];
  assert.equal(after.status, "unable");
  const brief = crewChangeBriefOf(unable, "approval", min(5));
  assert.deepEqual(brief.unable, [{ id: "CC-0001", registration: "TEAM_H", at: unableAt, reason: "flash-helper가 지금 FLIGHT 중" }]);
  assert.deepEqual(brief.sent, []);
  // 하루가 지나면 브리핑에서 빠진다
  assert.deepEqual(crewChangeBriefOf(unable, "approval", min(25 * 60)).unable, []);
  // 2b 점검은 새 끝줄에서도 그대로 갖춰짐
  assert.ok(!selfCheckCrewChange(readFileSync(new URL("../controller/atcctl.mjs", import.meta.url), "utf8")).includes("[OCC CC-xxxx] 문구"));
});
