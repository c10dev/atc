import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { callsign } from "./callsign.ts";
import { config } from "./config.ts";
import { type AircraftProfile, canFly, canHoldSec, type CrewMember, type FleetFile, RATINGS, type Rating } from "./crew.ts";
import { type CrewDrift, type ObservedMember, observeCrew, spawnsFor } from "./crew-observed.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";

// CREW CHANGE: 운항 중인 AIRCRAFT의 CREW COMPLEMENT가 바뀌면 CAPTAIN에게 줄 지시문을 만든다. 설계: docs/fleet.md 8.4.
// 1단계: SUPERVISOR가 복사해 붙여 넣고 "전달함"(pending·approved → delivered).
// 2단계(DISPATCH approval 모드만): SUPERVISOR 승인(approved) → OCC가 `atcctl crew-change send`로 발부(sent, 보낼 문구 저장)
//   → CAPTAIN의 "READBACK CC-xxxx"를 OCC가 기록(acknowledged). OCC는 만들거나 승인하지 않는다.
// 새 변경은 pending·approved를 대신하고(superseded), sent는 READBACK까지 그대로 두며 새 건은 그 뒤에 보낸다.
// 기록은 추가만 하는 JSONL(~/.local/state/atc/crew-changes.jsonl): created / approved / sent / acknowledged / delivered / superseded.

export interface CrewState {
  complement: CrewMember[];
  ratings: Rating[];
}
export interface CrewChange {
  id: string; // CC-0001
  registration: string;
  at: string;
  before: CrewState;
  after: CrewState;
  added: string[];
  removed: string[];
  ratingImpact: string[];
  text: string;
  status: CrewChangeStatus;
  approvedAt: string | null;
  sentAt: string | null;
  message: string | null; // OCC가 보낸 문구(send-guard가 비교한다). sent 때 정해진다
  acknowledgedAt: string | null;
  deliveredAt: string | null;
  supersededAt: string | null;
  supersededBy: string | null; // 이어 쓴 새 CREW CHANGE. null이면 원래대로 돌아와 바꿀 것이 없어짐
}
export type CrewChangeStatus = "pending" | "approved" | "sent" | "acknowledged" | "delivered" | "superseded";
type Created = Omit<CrewChange, "status" | "approvedAt" | "sentAt" | "message" | "acknowledgedAt" | "deliveredAt" | "supersededAt" | "supersededBy">;
export type CrewChangeOp =
  | ({ op: "created" } & Created)
  | { op: "approved"; id: string; at: string } // SUPERVISOR(화면·API), approval 모드만
  | { op: "sent"; id: string; at: string; message: string } // OCC가 atcctl crew-change send로 발부
  | { op: "acknowledged"; id: string; at: string } // CAPTAIN의 READBACK CC-xxxx(OCC가 기록)
  | { op: "delivered"; id: string; at: string } // SUPERVISOR가 직접 붙여 넣음
  | { op: "superseded"; id: string; at: string; by: string | null };

// 상태 전이. 표에 없는 op는 무시한다(닫힌 건은 다시 바뀌지 않는다). sent는 새 변경으로 대신하지 않는다
const NEXT: Partial<Record<CrewChangeStatus, Partial<Record<CrewChangeOp["op"], CrewChangeStatus>>>> = {
  pending: { approved: "approved", delivered: "delivered", superseded: "superseded" },
  approved: { sent: "sent", delivered: "delivered", superseded: "superseded" },
  sent: { acknowledged: "acknowledged" },
};
export const canApplyCrewChange = (c: Pick<CrewChange, "status">, op: CrewChangeOp["op"]) => Boolean(NEXT[c.status]?.[op]);
// 아직 보내지 않은 건(새 변경이 대신한다)과 READBACK 대기 건
export const isUnsent = (c: Pick<CrewChange, "status">) => c.status === "pending" || c.status === "approved";
export const isOpenCrewChange = (c: Pick<CrewChange, "status">) => isUnsent(c) || c.status === "sent";
export const CREW_CHANGE_READBACK_OVERDUE_MS = 10 * 60_000;
export const isCrewChangeOverdue = (c: Pick<CrewChange, "status" | "sentAt">, now: number) =>
  c.status === "sent" && c.sentAt !== null && now - Date.parse(c.sentAt) > CREW_CHANGE_READBACK_OVERDUE_MS;

// CREW BRIEFING과 같은 한 줄 표기: "flash-helper: flash-helper (no BUILD, no SEC)"
export const memberLabel = (m: CrewMember) => `${m.position}: ${m.agent}${m.limits?.length ? ` (${m.limits.join(", ")})` : ""}`;

// 전후 COMPLEMENT의 차이. 같은 표기의 팀원 수로 센다(POSITION이 같아도 agent·limits가 다르면 내림+탐)
export function diffCrew(before: CrewMember[], after: CrewMember[]): { added: string[]; removed: string[] } {
  const left = before.map(memberLabel);
  const added: string[] = [];
  for (const label of after.map(memberLabel)) {
    const i = left.indexOf(label);
    if (i >= 0) left.splice(i, 1);
    else added.push(label);
  }
  return { added, removed: left };
}

const hasUiCrew = (c: CrewMember[]) =>
  ["ui-builder", "ui-qa"].every((p) => c.some((m) => m.position === p || m.agent === p));

// TYPE RATING 영향: 배정 규칙(crew.ts canFly·canHoldSec, fleet.md 4.3·5)으로 전후를 비교한다
export function ratingImpact(before: CrewState, after: CrewState): string[] {
  const out: string[] = [];
  const b = before.complement;
  const a = after.complement;
  const flip = (was: boolean, now: boolean, lost: string, gained: string) => {
    if (was && !now) out.push(lost);
    if (!was && now) out.push(gained);
  };
  flip(
    canFly(b, "BUILD"),
    canFly(a, "BUILD"),
    "BUILD·MAINT·TEST를 더는 날 수 없음 — 구현을 맡을 팀원(flash-helper가 아니고 no BUILD·read-only가 없는)이 없다",
    "BUILD·MAINT·TEST를 날 수 있게 됨",
  );
  flip(canFly(b, "CHECK"), canFly(a, "CHECK"), "CHECK를 더는 날 수 없음 — 판정을 맡을 팀원이 없다", "CHECK를 날 수 있게 됨");
  flip(
    canHoldSec(b),
    canHoldSec(a),
    "SEC를 맡을 팀원이 없어짐 — TYPE RATING SEC를 줄 수 없다",
    after.ratings.includes("SEC") ? "SEC를 맡을 팀원이 생김" : "SEC를 맡을 팀원이 생김 — TYPE RATING SEC는 SUPERVISOR가 따로 준다",
  );
  for (const r of RATINGS) {
    if (!before.ratings.includes(r) && after.ratings.includes(r)) out.push(`TYPE RATING +${r}`);
    if (before.ratings.includes(r) && !after.ratings.includes(r)) out.push(`TYPE RATING −${r}`);
  }
  if (after.ratings.includes("UI") && hasUiCrew(b) && !hasUiCrew(a)) {
    out.push("UI FLIGHT는 ui-builder와 ui-qa가 함께 있는 AIRCRAFT를 우선한다 — 이제 둘이 다 있지 않다");
  }
  return out;
}

// 같은 POSITION이 한 번씩 내리고 타면 "바뀜"으로 묶는다(지시문용). 표기 "position: agent …"의 앞부분으로 가린다
export function pairChanges(added: string[], removed: string[]) {
  const pos = (label: string) => label.slice(0, label.indexOf(": "));
  const once = (list: string[], p: string) => list.filter((x) => pos(x) === p).length === 1;
  const changed: [string, string][] = [];
  for (const r of removed) {
    const a = added.find((x) => pos(x) === pos(r));
    if (a && once(added, pos(r)) && once(removed, pos(r))) changed.push([r, a]);
  }
  const paired = new Set(changed.flat());
  return { changed, added: added.filter((x) => !paired.has(x)), removed: removed.filter((x) => !paired.has(x)) };
}

// CAPTAIN에게 붙여 넣을 지시문. crewBriefing()과 같은 형식·말투(한국어, 항공 용어는 영어)
export function crewChangeText(c: Pick<Created, "id" | "registration" | "after" | "added" | "removed" | "ratingImpact">): string {
  const reg = c.registration;
  const sec = c.after.ratings.includes("SEC");
  const p = pairChanges(c.added, c.removed);
  const agentOf = (label: string) => label.slice(label.indexOf(": ") + 2).replace(/ \(.*\)$/, "");
  const lines = [
    `[ATC FLEET] CREW CHANGE · ${callsign({ name: reg })} (${reg}) · ${c.id}`,
    "",
    `${reg} CAPTAIN, SUPERVISOR가 이 AIRCRAFT의 CREW COMPLEMENT를 바꿨습니다. 아래대로 팀원을 바꿔 주세요.`,
    ...(p.removed.length ? ["", "내리는 CREW (멈추고 더 부르지 않습니다)", ...p.removed.map((x) => `- ${x}`)] : []),
    ...(p.added.length ? ["", "타는 CREW (이 구성과 모델로 만듭니다)", ...p.added.map((x) => `- ${x}`)] : []),
    ...(p.changed.length ? ["", "바뀌는 CREW (같은 POSITION)", ...p.changed.map(([from, to]) => `- ${from} → ${to.slice(to.indexOf(": ") + 2)}`)] : []),
    "",
    "바뀐 뒤 CREW COMPLEMENT",
    ...c.after.complement.map((m) => `- ${memberLabel(m)}`),
    "",
    `TYPE RATING: ${c.after.ratings.join(", ") || "없음"}${sec ? " — SEC 작업은 Codex Engineering Task 템플릿을 쓰고 flash-helper(DeepSeek)는 쓰지 않습니다." : ""}`,
    ...(c.ratingImpact.length ? c.ratingImpact.map((x) => `- ${x}`) : ["- 배정 범위는 그대로입니다."]),
    "",
    "적용",
    ...(p.removed.length ? ["- 내리는 팀원은 맡은 일을 마무리하게 한 뒤 멈추고, 그 구성으로 새로 부르지 않습니다."] : []),
    ...(p.added.length ? ["- 타는 팀원은 위 agent로 만들고, 모델이 적혀 있으면 그 모델을 지정합니다."] : []),
    ...(p.changed.some(([from, to]) => agentOf(from) !== agentOf(to))
      ? ["- agent나 모델이 바뀐 팀원은 멈추고 새 agent·모델로 다시 만듭니다."]
      : []),
    ...(p.changed.some(([from, to]) => agentOf(from) === agentOf(to)) ? ["- 제약만 바뀐 팀원은 그대로 두고 새 제약을 알려 줍니다."] : []),
    `- 지금 FLIGHT는 그대로 계속합니다.${c.ratingImpact.length ? " 다음 배정부터 위 영향이 적용됩니다." : ""}`,
    "",
    `적용이 끝나면 \"${reg} CREW CHANGE ${c.id} COMPLETE\" 한 줄만 남기세요.`,
  ];
  return lines.join("\n");
}

// OCC가 CAPTAIN에게 보낼 문구. FLIGHT PLAN·RECALL과 같은 꼴: [OCC CC-xxxx] 머리, 지시문 본문, READBACK 요청 줄.
// 본문에 옛 머리([ATC FLEET] …, 또는 이미 붙은 [OCC CC-xxxx] …)가 있으면 떼어 낸다. send-guard가 이 문구를 그대로 비교한다.
export function crewChangeMessage(c: Pick<CrewChange, "id" | "registration" | "text">): string {
  const reg = c.registration;
  const sign = callsign({ name: reg });
  const who = sign === reg ? reg : `${sign} (${reg})`;
  const body = c.text.replace(/^\[(?:ATC FLEET|OCC CC-\d+)\][^\n]*\n(?:[ \t]*\n)*/, "").trim();
  return [`[OCC ${c.id}] CREW CHANGE · ${who}`, "", body, "", `— 받았으면 이 메시지에 "READBACK ${c.id}"로 답장해 주세요.`].join("\n");
}

export function foldCrewChanges(ops: CrewChangeOp[]): CrewChange[] {
  const byId = new Map<string, CrewChange>();
  for (const o of ops) {
    if (o.op === "created") {
      const { op: _op, ...rest } = o;
      byId.set(o.id, {
        ...rest,
        status: "pending",
        approvedAt: null,
        sentAt: null,
        message: null,
        acknowledgedAt: null,
        deliveredAt: null,
        supersededAt: null,
        supersededBy: null,
      });
      continue;
    }
    const c = byId.get(o.id);
    const next = c && NEXT[c.status]?.[o.op];
    if (!c || !next) continue;
    c.status = next;
    if (o.op === "approved") c.approvedAt = o.at;
    if (o.op === "sent") Object.assign(c, { sentAt: o.at, message: o.message });
    if (o.op === "acknowledged") c.acknowledgedAt = o.at;
    if (o.op === "delivered") c.deliveredAt = o.at;
    if (o.op === "superseded") Object.assign(c, { supersededAt: o.at, supersededBy: o.by });
  }
  return [...byId.values()];
}

export const nextCrewChangeId = (changes: Pick<CrewChange, "id">[]) =>
  `CC-${String(Math.max(0, ...changes.map((c) => Number(c.id.slice(3)) || 0)) + 1).padStart(4, "0")}`;

const sameCrew = (a: CrewMember[], b: CrewMember[]) => {
  const d = diffCrew(a, b);
  return !d.added.length && !d.removed.length;
};
const sameRatings = (a: Rating[], b: Rating[]) => a.length === b.length && a.every((r) => b.includes(r));

// PATCH 한 번에 쓸 기록. 아직 보내지 않은(pending·approved) CREW CHANGE가 있으면 그 "전"을 그대로 두고 최신 "후"로 합쳐 새로 만든다.
// 승인된 건도 대신한다(새 지시문은 다시 승인받는다). 합친 결과가 원래와 같으면 대기 건만 닫는다(superseded, by null).
// sent(READBACK 대기)는 여기로 오지 않는다: 부르는 쪽이 넘기지 않고, 새 건은 지금 선언(= sent의 "후")에서 시작한다.
export function planCrewChange(
  pending: CrewChange | null,
  current: CrewState,
  next: CrewState,
  ctx: { registration: string; id: string; at: string },
): CrewChangeOp[] {
  const crewChanged = !sameCrew(current.complement, next.complement);
  if (!crewChanged && !(pending && !sameRatings(current.ratings, next.ratings))) return [];
  const before = pending?.before ?? current;
  const { added, removed } = diffCrew(before.complement, next.complement);
  if (!added.length && !removed.length) {
    return pending ? [{ op: "superseded", id: pending.id, at: ctx.at, by: null }] : [];
  }
  const base = { id: ctx.id, registration: ctx.registration, at: ctx.at, before, after: next, added, removed, ratingImpact: ratingImpact(before, next) };
  const created: CrewChangeOp = { op: "created", ...base, text: crewChangeText(base) };
  return [...(pending ? [{ op: "superseded" as const, id: pending.id, at: ctx.at, by: ctx.id }] : []), created];
}

// ── 입출력 ──

const file = () => join(config.stateDir, "crew-changes.jsonl");

function readOps(): CrewChangeOp[] {
  let text = "";
  try {
    text = readFileSync(file(), "utf8");
  } catch {
    return [];
  }
  const ops: CrewChangeOp[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      ops.push(JSON.parse(line));
    } catch {}
  }
  return ops;
}

function append(ops: CrewChangeOp[]) {
  if (!ops.length) return;
  mkdirSync(dirname(file()), { recursive: true });
  appendFileSync(file(), ops.map((o) => JSON.stringify(o) + "\n").join(""));
}

export const allCrewChanges = () => foldCrewChanges(readOps());

const stateOf = (p: AircraftProfile, defaults: FleetFile["defaults"]): CrewState => ({
  complement: p.complement ?? defaults.complement,
  ratings: p.ratings ?? defaults.ratings,
});

// PATCH 훅: 운항 중(퇴역 아님, 그 이름의 살아 있는 세션이 있음)인 AIRCRAFT의 COMPLEMENT가 바뀌었으면 기록한다.
// 운항 전 AIRCRAFT는 CREW BRIEFING에 새 구성이 들어가므로 만들지 않는다.
export function noteCrewChange(
  registration: string,
  prev: AircraftProfile,
  next: AircraftProfile,
  defaults: FleetFile["defaults"],
  sessions: Pick<Snapshot["sessions"][number], "name" | "status">[],
  at = new Date().toISOString(),
): CrewChange | null {
  const reg = registration.toUpperCase();
  const inService = !next.retired && sessions.some((x) => x.status !== "dead" && x.name.toUpperCase() === reg);
  if (!inService) return null;
  const changes = allCrewChanges();
  const pending = changes.find((c) => c.registration === reg && isUnsent(c)) ?? null;
  const ops = planCrewChange(pending, stateOf(prev, defaults), stateOf(next, defaults), { registration: reg, id: nextCrewChangeId(changes), at });
  append(ops);
  const created = ops.find((o) => o.op === "created");
  return created ? foldCrewChanges([...readOps()]).find((c) => c.id === created.id) ?? null : null;
}

// FLEET 카드의 열린 CREW CHANGE(acknowledged·delivered·superseded 전까지)
export interface PendingCrewChange {
  id: string;
  at: string;
  text: string;
  added: string[];
  removed: string[];
  ratingImpact: string[];
  status: "pending" | "approved" | "sent";
  message: string | null; // 보낸 문구(sent만)
  approvedAt: string | null;
  sentAt: string | null;
  overdue: boolean; // sent 뒤 10분 넘게 READBACK 없음
  waitingFor: string | null; // 앞서 보낸(sent) 건의 id. 그 READBACK 뒤에 보낸다
}
export interface CrewFields {
  observedCrew: ObservedMember[] | null;
  crewDrift: CrewDrift | null;
  pendingCrewChange: PendingCrewChange | null;
}

// AIRCRAFT 하나의 열린 CREW CHANGE 중 카드에 보일 것: 보내지 않은 건이 있으면 그것(승인·전달할 일), 없으면 READBACK 대기 건
export function openCrewChangeOf(changes: CrewChange[], registration: string, now: number): PendingCrewChange | null {
  const reg = registration.toUpperCase();
  const mine = changes.filter((c) => c.registration === reg);
  const sent = mine.find((c) => c.status === "sent") ?? null;
  const p = mine.find(isUnsent) ?? sent;
  if (!p) return null;
  return {
    id: p.id,
    at: p.at,
    text: p.text,
    added: p.added,
    removed: p.removed,
    ratingImpact: p.ratingImpact,
    status: p.status as PendingCrewChange["status"],
    message: p.message,
    approvedAt: p.approvedAt,
    sentAt: p.sentAt,
    overdue: isCrewChangeOverdue(p, now),
    waitingFor: sent && sent !== p ? sent.id : null,
  };
}

// FLEET 화면 훅: AircraftView에 관측 CREW, drift, 열린 CREW CHANGE를 붙인다
export function withCrew(s: Pick<Snapshot, "sessions">, now = Date.now()) {
  const changes = allCrewChanges();
  return <A extends { registration: string; complement: CrewMember[] }>(a: A): A & CrewFields => {
    const spawns = spawnsFor(a.registration, s.sessions, now);
    const seen = spawns && observeCrew(spawns, a.complement, now);
    return {
      ...a,
      observedCrew: seen?.observedCrew ?? null,
      crewDrift: seen?.crewDrift ?? null,
      pendingCrewChange: openCrewChangeOf(changes, a.registration, now),
    };
  };
}

// OCC 브리핑: 보낼 것(approved, 앞선 sent가 없는 것), 기다리는 것(approved인데 앞선 sent가 READBACK 전), READBACK 대기(sent), 늦은 것
export function crewChangeBriefOf(changes: CrewChange[], mode: "shadow" | "approval", now: number) {
  const sentBy = new Map(changes.filter((c) => c.status === "sent").map((c) => [c.registration, c.id]));
  const row = (c: CrewChange) => ({
    id: c.id,
    registration: c.registration,
    at: c.at,
    status: c.status,
    approvedAt: c.approvedAt,
    sentAt: c.sentAt,
    overdue: isCrewChangeOverdue(c, now),
  });
  const approved = changes.filter((c) => c.status === "approved");
  return {
    mode,
    at: new Date(now).toISOString(),
    approved: approved.filter((c) => !sentBy.has(c.registration)).map(row),
    waiting: approved.filter((c) => sentBy.has(c.registration)).map((c) => ({ ...row(c), waitingFor: sentBy.get(c.registration)! })),
    sent: changes.filter((c) => c.status === "sent").map(row),
    overdue: changes.filter((c) => isCrewChangeOverdue(c, now)).map((c) => c.id),
    // SUPERVISOR 승인을 기다리는 건(OCC는 승인하지 않는다. 참고로만)
    pending: changes.filter((c) => c.status === "pending").map((c) => c.id),
  };
}

// 승인·발부 규칙. 되면 null, 아니면 [HTTP 상태, 사유]
export function approveRefusal(c: CrewChange | undefined, mode: "shadow" | "approval"): [404 | 409, string] | null {
  if (!c) return [404, "CREW CHANGE 없음"];
  if (mode !== "approval") return [409, "CREW CHANGE 승인은 approval 모드(2b)에서만 — shadow면 복사해 붙여 넣고 전달함"];
  if (!canApplyCrewChange(c, "approved")) return [409, `${c.id}는 승인할 상태가 아님(${c.status})`];
  return null;
}
export function sendRefusal(c: CrewChange | undefined, all: CrewChange[], mode: "shadow" | "approval"): [404 | 409, string] | null {
  if (!c) return [404, "CREW CHANGE 없음"];
  if (mode !== "approval") return [409, "CREW CHANGE는 approval 모드(2b)에서만 보낸다"];
  if (c.status === "sent") return null; // 재송신: 같은 문구
  if (c.status !== "approved") return [409, `${c.id}는 보낼 상태가 아님(${c.status}) — SUPERVISOR 승인(approved)이 먼저`];
  const ahead = all.find((x) => x.registration === c.registration && x.status === "sent" && x.id !== c.id);
  if (ahead) return [409, `${c.registration}에 READBACK 대기 중인 ${ahead.id}가 있음 — 그 READBACK 뒤에 보낸다`];
  return null;
}

// POST /api/fleet/crew-changes/:id/<동작>(OCC). 2b 점검표도 이 목록으로 창구를 확인한다.
// 승인(approve)·전달함(delivered)은 SUPERVISOR 창구 /api/fleet/:registration/crew-change/:id/<동작>
export const CREW_CHANGE_OCC_ACTIONS = ["send", "readback"] as const;
export const CREW_CHANGE_SUPERVISOR_ACTIONS = ["approve", "delivered"] as const;

// 2b 점검표용 코드 사실: 합성 기록으로 전이·대신하기·문구·늦음·API·CLI를 확인한다. 빠진 것 목록(비면 갖춰짐)
export function selfCheckCrewChange(atcctlSource: string | null, now = Date.now()): string[] {
  const missing: string[] = [];
  const at = new Date(now - 30 * 60_000).toISOString();
  const state = (ratings: Rating[]): CrewState => ({ complement: [{ position: "backend", agent: "claude-opus-5-5" }], ratings });
  const next: CrewState = { complement: [], ratings: ["DOCS"] };
  const base = planCrewChange(null, state(["DOCS"]), next, { registration: "TEAM_A", id: "CC-0001", at });
  const created = foldCrewChanges(base)[0];
  if (!created) return ["CREW CHANGE 기록"];
  const message = crewChangeMessage(created);
  const flow = foldCrewChanges([...base, { op: "approved", id: "CC-0001", at }, { op: "sent", id: "CC-0001", at, message }]);
  if (flow[0].status !== "sent" || flow[0].message !== message) missing.push("pending → approved → sent 전이");
  if (!isCrewChangeOverdue(flow[0], now)) missing.push("READBACK 10분 늦음(overdue)");
  if (foldCrewChanges([...base, { op: "approved", id: "CC-0001", at }, { op: "sent", id: "CC-0001", at, message }, { op: "acknowledged", id: "CC-0001", at }])[0].status !== "acknowledged")
    missing.push("sent → acknowledged 전이");
  if (approveRefusal(created, "shadow")?.[0] !== 409) missing.push("shadow 모드 승인 거절");
  if (!message.startsWith("[OCC CC-0001] CREW CHANGE") || !message.endsWith('"READBACK CC-0001"로 답장해 주세요.')) missing.push("[OCC CC-xxxx] 문구");
  const approved = foldCrewChanges([...base, { op: "approved", id: "CC-0001", at }])[0];
  const again = planCrewChange(approved, next, { ...next, complement: [{ position: "reviewer", agent: "sonnet" }] }, { registration: "TEAM_A", id: "CC-0002", at });
  if (again[0]?.op !== "superseded") missing.push("approved는 새 변경이 대신함");
  const sentAhead = sendRefusal({ ...approved, id: "CC-0002" }, [flow[0]], "approval");
  if (!sentAhead || !/READBACK 대기/.test(sentAhead[1])) missing.push("sent가 READBACK 전이면 새 건은 기다림");
  const actions: readonly string[] = [...CREW_CHANGE_OCC_ACTIONS, ...CREW_CHANGE_SUPERVISOR_ACTIONS];
  for (const a of ["approve", "send", "readback"]) if (!actions.includes(a)) missing.push(`POST …/${a}`);
  const src = atcctlSource ?? "";
  for (const a of ["send", "readback"])
    if (!new RegExp(`CREW_CHANGE_CMDS = \\[[^\\]]*"${a}"`).test(src)) missing.push(`atcctl crew-change ${a}`);
  return missing;
}

export function mountCrewChange(app: Hono) {
  // 최근 CREW CHANGE 기록(새것 먼저). registration으로 거르고 limit(기본 20, 최대 100)만큼
  app.get("/api/fleet/crew-changes", (c) => {
    const reg = (c.req.query("registration") ?? "").toUpperCase();
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 20));
    const changes = allCrewChanges()
      .filter((x) => !reg || x.registration === reg)
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(0, limit);
    return c.json({ changes });
  });
  // OCC 브리핑(atcctl crew-change brief). :id보다 먼저
  app.get("/api/fleet/crew-changes/brief", (c) => c.json(crewChangeBriefOf(allCrewChanges(), loadDispatchConfig().mode, Date.now())));
  // send-guard가 쓰는 단건 조회
  app.get("/api/fleet/crew-changes/:id", (c) => {
    const change = allCrewChanges().find((x) => x.id === (c.req.param("id") ?? "").toUpperCase());
    return change ? c.json({ change, mode: loadDispatchConfig().mode }) : c.json({ error: "그런 CREW CHANGE가 없음" }, 404);
  });
  const find = (id: string, reg?: string) => allCrewChanges().find((x) => x.id === id.toUpperCase() && (!reg || x.registration === reg.toUpperCase()));
  const CLOSED_WHY: Record<string, string> = { delivered: "전달됨", superseded: "다른 CREW CHANGE로 대체됨", acknowledged: "READBACK 받음", sent: "OCC가 보냄(READBACK 대기)" };
  const closedWhy = (x: CrewChange) => CLOSED_WHY[x.status] ?? x.status;

  // SUPERVISOR만(화면·API): 2b에서 OCC가 보내도록 승인. OCC의 atcctl에는 이 명령이 없다
  app.post("/api/fleet/:registration/crew-change/:id/approve", (c) => {
    const reg = (c.req.param("registration") ?? "").toUpperCase();
    const change = find(c.req.param("id") ?? "", reg);
    const bad = approveRefusal(change, loadDispatchConfig().mode);
    if (bad) return c.json({ error: bad[0] === 404 ? `CREW CHANGE 없음: ${reg} ${c.req.param("id")}` : bad[1] }, bad[0]);
    append([{ op: "approved", id: change!.id, at: new Date().toISOString() }]);
    return c.json({ ok: true, change: find(change!.id) });
  });
  // SUPERVISOR가 CAPTAIN에게 직접 붙여 넣었다고 표시한다(pending·approved만. 승인한 뒤 shadow로 돌아갔을 때도 이 길)
  app.post("/api/fleet/:registration/crew-change/:id/delivered", (c) => {
    const reg = (c.req.param("registration") ?? "").toUpperCase();
    const id = (c.req.param("id") ?? "").toUpperCase();
    const change = find(id, reg);
    if (!change) return c.json({ error: `CREW CHANGE 없음: ${reg} ${id}` }, 404);
    if (!canApplyCrewChange(change, "delivered")) return c.json({ error: `${id}는 이미 ${closedWhy(change)}` }, 409);
    append([{ op: "delivered", id, at: new Date().toISOString() }]);
    return c.json({ ok: true, change: find(id) });
  });
  // OCC: 승인된 건을 sent로 바꾸고 보낼 문구를 돌려준다(atcctl crew-change send). 이미 sent면 같은 문구(재송신)
  app.post("/api/fleet/crew-changes/:id/send", (c) => {
    const all = allCrewChanges();
    const change = all.find((x) => x.id === (c.req.param("id") ?? "").toUpperCase());
    const bad = sendRefusal(change, all, loadDispatchConfig().mode);
    if (bad) return c.json({ error: bad[1] }, bad[0]);
    if (change!.status === "approved") append([{ op: "sent", id: change!.id, at: new Date().toISOString(), message: crewChangeMessage(change!) }]);
    const sent = find(change!.id)!;
    return c.json({ change: sent, sendTo: sent.registration, message: sent.message });
  });
  // OCC: CAPTAIN이 "READBACK CC-xxxx"로 답함(모드와 상관없이 받는다 — 보낸 건은 닫아야 한다)
  app.post("/api/fleet/crew-changes/:id/readback", (c) => {
    const change = find(c.req.param("id") ?? "");
    if (!change) return c.json({ error: "그런 CREW CHANGE가 없음" }, 404);
    if (!canApplyCrewChange(change, "acknowledged")) return c.json({ error: `${change.id}는 READBACK 대기가 아님(${change.status})` }, 409);
    append([{ op: "acknowledged", id: change.id, at: new Date().toISOString() }]);
    return c.json({ ok: true, change: find(change.id) });
  });
}
