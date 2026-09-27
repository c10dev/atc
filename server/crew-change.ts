import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { callsign } from "./callsign.ts";
import { config } from "./config.ts";
import { type AircraftProfile, canFly, canHoldSec, type CrewMember, type FleetFile, RATINGS, type Rating } from "./crew.ts";
import { type CrewDrift, type ObservedMember, observeCrew, spawnsFor } from "./crew-observed.ts";
import type { Snapshot } from "./model.ts";

// CREW CHANGE: 운항 중인 AIRCRAFT의 CREW COMPLEMENT가 바뀌면 CAPTAIN에게 줄 지시문을 만든다. 설계: docs/fleet.md 8.3.
// atc는 보내지 않는다 — SUPERVISOR가 복사해 붙여 넣고 "전달함"을 누른다. OCC 발송은 나중에 스위치 뒤에서.
// 기록은 추가만 하는 JSONL(~/.local/state/atc/crew-changes.jsonl): created / delivered / superseded.

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
  status: "pending" | "delivered" | "superseded";
  deliveredAt: string | null;
  supersededAt: string | null;
  supersededBy: string | null; // 이어 쓴 새 CREW CHANGE. null이면 원래대로 돌아와 바꿀 것이 없어짐
}
type Created = Omit<CrewChange, "status" | "deliveredAt" | "supersededAt" | "supersededBy">;
export type CrewChangeOp =
  | ({ op: "created" } & Created)
  | { op: "delivered"; id: string; at: string }
  | { op: "superseded"; id: string; at: string; by: string | null };

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

export function foldCrewChanges(ops: CrewChangeOp[]): CrewChange[] {
  const byId = new Map<string, CrewChange>();
  for (const o of ops) {
    if (o.op === "created") {
      const { op: _op, ...rest } = o;
      byId.set(o.id, { ...rest, status: "pending", deliveredAt: null, supersededAt: null, supersededBy: null });
      continue;
    }
    const c = byId.get(o.id);
    if (!c || c.status !== "pending") continue;
    if (o.op === "delivered") Object.assign(c, { status: "delivered", deliveredAt: o.at });
    if (o.op === "superseded") Object.assign(c, { status: "superseded", supersededAt: o.at, supersededBy: o.by });
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

// PATCH 한 번에 쓸 기록. 아직 전달 안 한 CREW CHANGE가 있으면 그 "전"을 그대로 두고 최신 "후"로 합쳐 새로 만든다.
// 합친 결과가 원래와 같으면 대기 건만 닫는다(superseded, by null).
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
  const pending = changes.find((c) => c.registration === reg && c.status === "pending") ?? null;
  const ops = planCrewChange(pending, stateOf(prev, defaults), stateOf(next, defaults), { registration: reg, id: nextCrewChangeId(changes), at });
  append(ops);
  const created = ops.find((o) => o.op === "created");
  return created ? foldCrewChanges([...readOps()]).find((c) => c.id === created.id) ?? null : null;
}

export interface PendingCrewChange {
  id: string;
  at: string;
  text: string;
  added: string[];
  removed: string[];
  ratingImpact: string[];
}
export interface CrewFields {
  observedCrew: ObservedMember[] | null;
  crewDrift: CrewDrift | null;
  pendingCrewChange: PendingCrewChange | null;
}

// FLEET 화면 훅: AircraftView에 관측 CREW, drift, 대기 중인 CREW CHANGE를 붙인다
export function withCrew(s: Pick<Snapshot, "sessions">, now = Date.now()) {
  const pending = new Map(allCrewChanges().filter((c) => c.status === "pending").map((c) => [c.registration, c]));
  return <A extends { registration: string; complement: CrewMember[] }>(a: A): A & CrewFields => {
    const spawns = spawnsFor(a.registration, s.sessions, now);
    const seen = spawns && observeCrew(spawns, a.complement, now);
    const p = pending.get(a.registration.toUpperCase());
    return {
      ...a,
      observedCrew: seen?.observedCrew ?? null,
      crewDrift: seen?.crewDrift ?? null,
      pendingCrewChange: p ? { id: p.id, at: p.at, text: p.text, added: p.added, removed: p.removed, ratingImpact: p.ratingImpact } : null,
    };
  };
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
  // SUPERVISOR가 CAPTAIN에게 붙여 넣었다고 표시한다(atc는 보내지 않는다)
  app.post("/api/fleet/:registration/crew-change/:id/delivered", (c) => {
    const reg = (c.req.param("registration") ?? "").toUpperCase();
    const id = (c.req.param("id") ?? "").toUpperCase();
    const change = allCrewChanges().find((x) => x.id === id && x.registration === reg);
    if (!change) return c.json({ error: `CREW CHANGE 없음: ${reg} ${id}` }, 404);
    if (change.status !== "pending") return c.json({ error: `${id}는 이미 ${change.status === "delivered" ? "전달됨" : "다른 CREW CHANGE로 대체됨"}` }, 409);
    const at = new Date().toISOString();
    append([{ op: "delivered", id, at }]);
    return c.json({ ok: true, change: { ...change, status: "delivered", deliveredAt: at } });
  });
}
