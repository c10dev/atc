// WAYPOINT 완료 기준에 atc 게이트를 잇는다(docs/routes.md 7장 6단계). atc 자체의 ROUTE(M15–M20)는 완료 기준이
// "DISPATCH 판정 20건·80%"처럼 atc가 이미 재는 게이트다. 기준 문장을 규칙(정규식)으로 게이트에 맞춰 지금 상태를 붙인다.
// 판정은 게이트 계산이 한다: 여기서는 모인 사실(GateFacts)을 기준 한 줄의 점검(GateCheck)으로 옮기기만 한다(순수).
// 맞는 규칙이 없는 기준(사람이 정할 일, 다른 저장소의 일)은 null — 화면은 그대로 둔다.

export type CheckState = "pass" | "fail" | "insufficient" | "check";

export interface GateCheck {
  id: string; // 규칙 id
  state: CheckState;
  value: string; // 지금 값 한 줄
  target: string; // 기준 한 줄
}

// ATFM 켜는 조건 한 줄(atfm-run.ts Row와 같은 모양)
export interface TurnOnRow {
  id: string;
  value: string;
  target: string;
  status: CheckState;
}

export interface GateFacts {
  dispatchGate: { decided: number; agreement: number | null; ready: boolean; target: { decided: number; agreement: number } };
  scheduleGate: { decided: number; agreement: number | null; ready: boolean; target: { decided: number; agreement: number } };
  readiness: { id: string; label: string; status: "ready" | "not-ready" | "check" }[];
  dispatchMode: string;
  scheduleMode: string;
  autoTurnOn: TurnOnRow[]; // ATFM 자동 배정 켜는 조건(2b, gate3, precision, crosscheck, los)
  recalled: number; // CAPTAIN이 READBACK한 RECALL 수
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

// 여러 점검을 하나로: 하나라도 미달이면 미달, 그다음 데이터 부족, 확인 필요, 모두 충족이면 충족
const RANK: Record<CheckState, number> = { fail: 0, insufficient: 1, check: 2, pass: 3 };
export const worst = (xs: CheckState[]): CheckState => xs.reduce<CheckState>((a, b) => (RANK[b] < RANK[a] ? b : a), "pass");

function shadowGate(id: string, name: string, g: GateFacts["dispatchGate"]): GateCheck {
  const state: CheckState = g.ready ? "pass" : g.decided < g.target.decided ? "insufficient" : "fail";
  return { id, state, value: `${name} 판정 ${g.decided}/${g.target.decided}건 · 합의 ${pct(g.agreement)}`, target: `≥ ${g.target.decided}건 · ${Math.round(g.target.agreement * 100)}%` };
}

function rows(id: string, ids: string[], f: GateFacts, target: string): GateCheck {
  const got = ids.map((k) => f.autoTurnOn.find((r) => r.id === k)).filter(Boolean) as TurnOnRow[];
  if (got.length < ids.length) return { id, state: "check", value: "ATFM 점검을 읽지 못함", target };
  return { id, state: worst(got.map((r) => r.status)), value: got.map((r) => r.value).join(" · "), target };
}

export interface GateRule {
  id: string;
  match: RegExp; // 기준 문장(영어·한국어)
  of: (f: GateFacts) => GateCheck;
}

export const GATE_RULES: GateRule[] = [
  { id: "dispatch-gate", match: /DISPATCH shadow gate|DISPATCH 그림자 게이트/i, of: (f) => shadowGate("dispatch-gate", "DISPATCH", f.dispatchGate) },
  { id: "schedule-gate", match: /SCHEDULE shadow gate|SCHEDULE 그림자 게이트/i, of: (f) => shadowGate("schedule-gate", "SCHEDULE", f.scheduleGate) },
  {
    id: "readiness-2b",
    match: /2b readiness checklist|2b 켜기 점검표/i,
    of: (f) => {
      const not = f.readiness.filter((x) => x.status === "not-ready");
      const check = f.readiness.filter((x) => x.status === "check");
      const state: CheckState = not.length ? "fail" : check.length ? "check" : "pass";
      const value = not.length ? `준비 안 됨: ${not.map((x) => x.label).join(", ")}` : check.length ? `확인 필요: ${check.map((x) => x.label).join(", ")}` : `${f.readiness.length}개 모두 준비됨`;
      return { id: "readiness-2b", state, value, target: "모두 준비됨 또는 확인함" };
    },
  },
  {
    id: "dispatch-mode",
    match: /switches DISPATCH mode to approval|DISPATCH 모드를 approval/i,
    of: (f) => ({ id: "dispatch-mode", state: f.dispatchMode === "approval" ? "pass" : "fail", value: `DISPATCH mode ${f.dispatchMode}`, target: "approval" }),
  },
  {
    id: "schedule-mode",
    match: /switches SCHEDULE mode to approval|SCHEDULE 모드를 approval/i,
    of: (f) => ({ id: "schedule-mode", state: f.scheduleMode === "approval" ? "pass" : "fail", value: `SCHEDULE mode ${f.scheduleMode}`, target: "approval" }),
  },
  { id: "2b-run", match: /2b has run for two weeks|2b를 2주/i, of: (f) => rows("2b-run", ["2b", "gate3"], f, "2b 14일 이상 · gate3 ≥ 10건 · 90% · 80%") },
  { id: "atfm-precision", match: /Shadow precision .*CROSSCHECK|그림자 정확도.*CROSSCHECK/i, of: (f) => rows("atfm-precision", ["precision", "crosscheck"], f, "정확도 ≥ 95% · 20건 · CROSSCHECK ≥ 90% · 20건") },
  {
    // "RECALL is in use; ATFM steps 6–10 are built" — RECALL은 기록으로 알 수 있고, 단계 구현은 사람이 본다
    id: "recall",
    match: /RECALL is in use|RECALL을 (실제로 )?썼/i,
    of: (f) => ({ id: "recall", state: f.recalled > 0 ? "check" : "fail", value: `RECALL ${f.recalled}건${f.recalled > 0 ? " · ATFM 단계 구현은 docs/atfm.md에서 확인" : ""}`, target: "RECALL 1건 이상 · ATFM 6–10단계" }),
  },
];

// 기준 한 줄의 점검. 처음 맞는 규칙, 없으면 null. f가 함수면 맞는 규칙이 있을 때만 부른다(사실 모으기가 무겁다)
export function criterionCheck(text: string, f: GateFacts | (() => GateFacts), rules = GATE_RULES): GateCheck | null {
  const rule = rules.find((r) => r.match.test(text));
  return rule ? rule.of(typeof f === "function" ? f() : f) : null;
}
