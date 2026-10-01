// QRH shadow(ATC-288, docs/research/skill-rulebook.md 4.2·5.2·5.4): 서버가 이미 아는 조건 코드를 체크리스트 ID에 잇는 하나뿐인 표.
// 아직 어떤 글도 바꾸지 않는다 — 서버가 "이 체크리스트를 불렀을 것"이라는 사실만 FLIGHT RECORDER에 한 번 적는다(qrh.named).
// 이 파일은 순수 계산이다. 조건을 모으는 것과 기록·읽기 길은 qrh-run.ts.
// ID 모양: `<kind>-<nn>-<slug>`(kind는 sop|cl|qrh|mel). 번호는 바꾸지도 다시 쓰지도 않는다. 이 표에는 지금 안정된 코드가 있는 조건만 올린다.

export interface Qrh {
  id: string;
  title: string;
}

// 조건 코드 → 체크리스트. 코드는 서버가 이미 쓰는 이름 그대로다(어디서 나는지는 주석의 파일)
const QRH_BY_CODE: Readonly<Record<string, Qrh>> = {
  // server/health.ts stalledOf: In Progress FLIGHT를 쥔 AIRCRAFT가 idle로 오래 활동이 없고 열린 PR이 없다.
  // RESUME은 한도에 걸린 세션을 다시 잇는 다른 절차(한도가 풀린 뒤 "계속")라 같은 체크리스트로 묶지 않는다
  STALLED: { id: "qrh-02-stalled", title: "STALLED" },
  // server/following.ts undeliveredOf(제안의 undelivered)와 FLIGHT FOLLOWING의 undelivered: OCC가 보낸 FLIGHT PLAN이 닿지 않음
  undelivered: { id: "qrh-03-undelivered", title: "FLIGHT PLAN UNDELIVERED" },
  // server/proposals.ts overdueOf 가운데 sent(READBACK 없음)와 recalling(RECALL READBACK 없음): 보냈는데 답이 없다
  overdue: { id: "qrh-03-undelivered", title: "FLIGHT PLAN UNDELIVERED" },
  // server/clearances.ts: TOWER CLEARANCE의 GO AROUND(ClearanceType)
  "GO AROUND": { id: "qrh-04-go-around", title: "GO AROUND" },
  // server/following.ts arrivalMissingOf의 due: 머지 뒤 도착 보고가 30분 넘게 없다
  arrivalMissing: { id: "qrh-05-arrival-missing", title: "ARRIVAL REPORT MISSING" },
};

export const QRH_CODES: readonly string[] = Object.keys(QRH_BY_CODE);

export function qrhOf(code: string): Qrh | null {
  return Object.hasOwn(QRH_BY_CODE, code) ? QRH_BY_CODE[code] : null;
}

// 지금 참인 조건 하나. subject는 같은 조건이 풀릴 때까지 변하지 않는 키(D-0305, C-0123, AIRCRAFT, FLIGHT)
export interface QrhCondition {
  code: string;
  subject: string;
  session?: string;
  aircraft?: string;
  flight?: string;
}

// FLIGHT RECORDER 줄(고정 모양, ATC-289가 읽는다). 글은 싣지 않는다
export interface QrhNamedLine {
  t: string;
  kind: "qrh";
  op: "named";
  id: string;
  code: string;
  session?: string;
  aircraft?: string;
  flight?: string;
  subject: string;
}

export const qrhKey = (id: string, subject: string) => `${id}|${subject}`;

// 한 번 쓸고 난 결과(순수). 같은 체크리스트·subject는 풀릴 때까지 한 번만 적는다:
// - open: 이미 적었고 아직 풀리지 않은 키. 이번에 참이 아닌 키는 빠진다(풀림) — 다시 참이 되면 새로 적는다
// - 한 체크리스트에 코드가 둘(undelivered·overdue)이어도 subject가 같으면 한 줄(먼저 만난 코드)
export function qrhSweep(active: readonly QrhCondition[], open: ReadonlySet<string>, at: string): { lines: QrhNamedLine[]; open: Set<string> } {
  const next = new Set<string>();
  const lines: QrhNamedLine[] = [];
  for (const c of active) {
    const q = qrhOf(c.code);
    if (!q) continue; // 표에 없는 코드는 이름을 부르지 않는다
    const key = qrhKey(q.id, c.subject);
    if (next.has(key)) continue;
    next.add(key);
    if (open.has(key)) continue;
    lines.push({
      t: at,
      kind: "qrh",
      op: "named",
      id: q.id,
      code: c.code,
      ...(c.session ? { session: c.session } : {}),
      ...(c.aircraft ? { aircraft: c.aircraft } : {}),
      ...(c.flight ? { flight: c.flight } : {}),
      subject: c.subject,
    });
  }
  return { lines, open: next };
}

// ── 조건 모으기(순수): 이미 계산된 값만 받는다. 새 감지는 없다 ──

export interface QrhInput {
  sessions: readonly { id: string; name: string; status: string; health?: { code: string } | null }[];
  proposals: readonly { id: string; flight: string; aircraftName: string | null; status: string }[];
  overdue: readonly string[]; // overdueOf의 제안 id
  undelivered: readonly { id: string; flight: string; aircraft: string | null }[]; // undeliveredOf
  clearances: readonly { id: string; to: string; toName: string; type: string; flight: string | null; readbackAt: string | null; cancelledAt: string | null; unableAt?: string | null }[];
  arrivalMissing: readonly { flight: string; aircraft: string | null; due: boolean }[];
  regOf: (name: string) => string; // 세션 이름 → REGISTRATION
}

export function qrhConditionsOf(inp: QrhInput): QrhCondition[] {
  const out: QrhCondition[] = [];
  for (const s of inp.sessions)
    if (s.status !== "dead" && s.health?.code === "STALLED") out.push({ code: "STALLED", subject: inp.regOf(s.name), session: s.id, aircraft: inp.regOf(s.name) });
  for (const u of inp.undelivered) out.push({ code: "undelivered", subject: u.id, ...(u.aircraft ? { aircraft: inp.regOf(u.aircraft) } : {}), flight: u.flight });
  const byId = new Map(inp.proposals.map((p) => [p.id, p]));
  for (const id of inp.overdue) {
    const p = byId.get(id);
    if (!p || (p.status !== "sent" && p.status !== "recalling")) continue; // 출발·도착 지연은 다른 절차다
    out.push({ code: "overdue", subject: p.id, ...(p.aircraftName ? { aircraft: inp.regOf(p.aircraftName) } : {}), flight: p.flight });
  }
  for (const c of inp.clearances)
    if (c.type === "GO AROUND" && !c.readbackAt && !c.cancelledAt && !c.unableAt) out.push({ code: "GO AROUND", subject: c.id, session: c.to, aircraft: inp.regOf(c.toName), ...(c.flight ? { flight: c.flight } : {}) });
  for (const a of inp.arrivalMissing) if (a.due) out.push({ code: "arrivalMissing", subject: a.flight, ...(a.aircraft ? { aircraft: inp.regOf(a.aircraft) } : {}), flight: a.flight });
  return out;
}
