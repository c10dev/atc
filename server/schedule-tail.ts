import type { Departure } from "./departures.ts";
import { fleetStatusOf } from "./fleet-status.ts";
import type { AircraftView } from "./fleet.ts";
import type { Clearance, Ticket } from "./model.ts";
import type { Proposal } from "./proposals.ts";
import { compareRegistration, registrationOf, regKey } from "./registration.ts";

// SCHEDULE TAIL(ATC-68): FLIGHT의 `tail:TEAM_X`(TAIL ASSIGNMENT)를 한 AIRCRAFT로 정하는 초안. 설계: docs/occ.md 5장, docs/fleet.md.
// DISPATCH 밖에서 정한 배정(CHARTER DESK의 SUPERVISOR 지시, 팀이 이미 몰고 있는 FLIGHT)을 라벨로 남긴다.
// 라벨만 쓴다 — 상태·담당은 건드리지 않는다(vocado의 OCC 예외). 여기는 순수 함수만.

export interface TailPayload {
  registration: string; // 붙일 tail:의 REGISTRATION(대문자)
  caution?: string; // 다른 팀의 tail:을 그 팀이 몰고 있는 중에 바꾼다(초안 때 atc가 채움)
}

export class TailError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// `tail:` 라벨만(옛 `lane:`은 여기서 보지 않는다 — 바꾸지도 지우지도 않는다)
const TAIL_ONLY = /^tail:\s*(\S+)$/i;
export const tailRegOf = (label: string) => {
  const m = TAIL_ONLY.exec(label.trim());
  return m ? regKey(m[1]) : null; // `tail:team-g`도 TEAM_G(ATC-67)
};
export const tailRegsOf = (labels: string[]) => [...new Set(labels.map(tailRegOf).filter(Boolean) as string[])];

// 발부 때 바꿀 것: 붙일 라벨과 뗄 다른 tail: 라벨(Linear 이름 그대로). 이미 붙어 있으면 add는 빈다
export function tailDiffOf(labels: string[], reg: string): { add: string[]; remove: string[] } {
  const want = regKey(reg);
  const remove = labels.filter((l) => {
    const r = tailRegOf(l);
    return r !== null && r !== want;
  });
  return { add: tailRegsOf(labels).includes(want) ? [] : [`tail:${want}`], remove };
}

// 발부 뒤의 라벨 전체: 지금 라벨에서 다른 tail:을 빼고 새 tail:을 더한다. 나머지(lane: 포함)는 그대로
export function tailLabelsOf(labels: string[], reg: string): string[] {
  const { add, remove } = tailDiffOf(labels, reg);
  return [...labels.filter((l) => !remove.includes(l)), ...add];
}

// 화면·APPLIED 판정용 바뀜 목록. 그 tail:이 이미 붙어 있으면 빈 배열(APPLIED)
export function tailChangesOf(labels: string[], reg: string): string[] {
  const want = regKey(reg);
  if (tailRegsOf(labels).includes(want)) return [];
  const { add, remove } = tailDiffOf(labels, want);
  return [...add.map((l) => `+ ${l}`), ...remove.map((l) => `− ${l}`)];
}

export interface TailCtx {
  teamPattern: string;
  fleet: { registration: string; retired: boolean }[]; // FLEET 등록부(fleet.json)에 있는 AIRCRAFT
  tailLabels: Set<string> | null; // Linear에 있는 tail: 라벨 이름(소문자). 못 읽었으면 null
}

// TAIL 입력 검사(순수). ticket: 대상 FLIGHT
export function parseTail(raw: Record<string, unknown>, ticket: Pick<Ticket, "key" | "labels">, ctx: TailCtx): string {
  const input = String(raw.registration ?? "").trim().replace(/^TAIL:\s*/i, "");
  if (!input) throw new TailError("REGISTRATION이 필요함 (예: TEAM_J)");
  const reg = registrationOf(input, ctx.teamPattern); // `Team J`도 TEAM_J(ATC-67)
  if (!reg) throw new TailError(`${input.toUpperCase()}는 팀 세션 이름 규칙(teamPattern ${ctx.teamPattern})에 맞지 않음`);
  const a = ctx.fleet.find((x) => regKey(x.registration, ctx.teamPattern) === reg);
  if (!a) throw new TailError(`${reg}는 FLEET에 없음 — ENTRY INTO SERVICE 뒤에 붙인다`);
  if (a.retired) throw new TailError(`${reg}는 RETIRED`);
  if (!ctx.tailLabels) throw new TailError("Linear 라벨 목록을 아직 읽지 못함 — 잠시 뒤 다시", 503);
  if (!ctx.tailLabels.has(`tail:${reg}`.toLowerCase())) throw new TailError(`Linear에 tail:${reg} 라벨이 없음 — ENGINEERING이나 사용자가 라벨을 만든 뒤 다시(OCC는 라벨을 만들지 않는다)`);
  if (tailRegsOf(ticket.labels).includes(reg)) throw new TailError(`${ticket.key}에는 이미 tail:${reg}가 있음 — 바꿀 것이 없음`);
  return reg;
}

// CAUTION: 바꿔 떼는 다른 팀의 tail:인데, 그 팀이 AIRBORNE이거나 이 FLIGHT의 STAND를 쥐고 있다(docs/occ.md 7장 "Never automatic")
export function tailCautionOf(
  ticket: Pick<Ticket, "key" | "labels">,
  reg: string,
  views: Pick<AircraftView, "registration" | "retired" | "aog" | "status" | "flying">[],
): string | null {
  const notes: string[] = [];
  for (const other of tailRegsOf(ticket.labels)) {
    if (other === regKey(reg)) continue;
    const v = views.find((x) => regKey(x.registration) === other);
    if (!v) continue;
    const airborne = fleetStatusOf(v) === "AIRBORNE";
    const stand = v.flying.includes(ticket.key);
    if (!airborne && !stand) continue;
    notes.push(`${other}가 ${[airborne && "AIRBORNE", stand && `${ticket.key}의 STAND를 쥠`].filter(Boolean).join(" · ")}`);
  }
  return notes.length ? `다른 팀의 tail:을 바꿈 — ${notes.join(", ")}` : null;
}

// ── atc 신호: tail: 없이 팀이 몰고 있는 FLIGHT ──

export type TailSource = "STAND" | "DEPARTURE LOG" | "READBACK";
export interface TailEvidence {
  source: TailSource;
  at: string | null;
  detail: string; // 어떤 기록인가(STAND 경로, D-xxxx, C-xxxx …)
}
export interface TailSignal {
  flight: string;
  registration: string;
  evidence: TailEvidence[];
}

export interface TailSignalInput {
  tickets: Pick<Ticket, "key" | "labels" | "stateType">[];
  views: Pick<AircraftView, "registration" | "flying" | "flyingSince">[];
  departures: Pick<Departure, "t" | "flight" | "aircraft" | "stand" | "via">[];
  proposals: Pick<Proposal, "id" | "kind" | "flight" | "aircraftName" | "status" | "statusAt" | "timeline">[];
  clearances: Pick<Clearance, "id" | "flight" | "toName" | "readbackAt" | "cancelledAt">[];
  fleet: TailCtx["fleet"];
  teamPattern: string;
  now: number;
}

export const TAIL_DEPARTURE_WINDOW_MS = 7 * 86_400_000; // DEPARTURE LOG는 최근 7일만 본다
const CLOSED = new Set(["completed", "canceled", "duplicate"]);
const READBACK_LIVE = new Set(["accepted", "departed"]); // READBACK 뒤 몰고 있는 DISPATCH 제안(RECALL 중은 뺀다)

// tail:이 없는 열린 FLIGHT를 팀이 몰고 있다는 기록(순수). 초안은 쓰지 않는다 — OCC가 schedule brief에서 보고 판단한다.
// REGISTRATION은 teamPattern에 맞고 FLEET에 있고 RETIRED가 아니어야 한다(그래야 TAIL 초안이 된다). FLIGHT·REGISTRATION 순
export function tailSignalsOf(inp: TailSignalInput): TailSignal[] {
  const team = new RegExp(inp.teamPattern, "i");
  const usable = new Set(inp.fleet.filter((a) => !a.retired).map((a) => regKey(a.registration, inp.teamPattern)));
  const open = new Map(inp.tickets.filter((t) => !CLOSED.has(t.stateType) && !tailRegsOf(t.labels).length).map((t) => [t.key, t]));
  const out = new Map<string, TailSignal>();
  const add = (flight: string | null, reg: string | null, e: TailEvidence) => {
    const r = reg ? regKey(reg, inp.teamPattern) : null;
    if (!flight || !r || !open.has(flight) || !team.test(r) || !usable.has(r)) return;
    const k = `${flight}|${r}`;
    const s = out.get(k) ?? { flight, registration: r, evidence: [] };
    s.evidence.push(e);
    out.set(k, s);
  };
  for (const v of inp.views) for (const f of v.flying) add(f, v.registration, { source: "STAND", at: v.flyingSince, detail: `${v.registration}가 STAND를 쥐고 있음` });
  // DEPARTURE LOG: FLIGHT마다 마지막으로 AIRCRAFT가 적힌 줄(HANDOFF 뒤면 이어받은 쪽)
  const lastDep = new Map<string, (typeof inp.departures)[number]>();
  for (const d of inp.departures) {
    if (!d.flight || !d.aircraft || inp.now - Date.parse(d.t) > TAIL_DEPARTURE_WINDOW_MS) continue;
    const prev = lastDep.get(d.flight);
    if (!prev || d.t >= prev.t) lastDep.set(d.flight, d);
  }
  for (const d of lastDep.values()) add(d.flight, d.aircraft, { source: "DEPARTURE LOG", at: d.t, detail: d.stand ? `${d.via} ${d.stand}` : `${d.via}(STAND 없음)` });
  for (const p of inp.proposals) {
    if (p.kind !== "ASSIGN" || !READBACK_LIVE.has(p.status)) continue;
    add(p.flight, p.aircraftName, { source: "READBACK", at: p.timeline.accepted ?? p.statusAt, detail: `DISPATCH ${p.id} (${p.status})` });
  }
  for (const c of inp.clearances) {
    if (!c.readbackAt || c.cancelledAt) continue;
    add(c.flight, c.toName, { source: "READBACK", at: c.readbackAt, detail: `CLEARANCE ${c.id}` });
  }
  return [...out.values()].sort((a, b) => a.flight.localeCompare(b.flight, "en", { numeric: true }) || compareRegistration(a.registration, b.registration));
}
