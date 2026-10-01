import type { ArrivalReport } from "./arrival-report.ts";
import { callsign } from "./callsign.ts";
import type { ClearanceOp } from "./clearances.ts";
import { CREW_CHANGE_READBACK_OVERDUE_MS, type CrewChangeOp } from "./crew-change.ts";
import type { MccRecord, RtsRecord } from "./mcc.ts";
import type { Op } from "./proposals.ts";
import type { LogLine as ScheduleLine } from "./schedule.ts";
import { READBACK_OVERDUE_MS } from "./proposals.ts";
import { DEFAULT_TEAM_PATTERN, registrationOf } from "./registration.ts";
import { overdueBase } from "./response.ts";

// RADIO(docs/radio.md, ATC-170): 이미 기록된 교신을 한 줄 목록(transmission)으로 합친다. 읽기만, 순수 함수.
// 새 상태 파일이 없고 기록 형식도 그대로다. 대화 기록(transcript)은 읽지 않는다.

export const FREQS = ["DELIVERY", "TOWER", "GROUND", "COMPANY", "PREFLIGHT"] as const;
export type Freq = (typeof FREQS)[number];

export type ClosedBy = "cancel" | "expire" | "supersede" | "delivered" | "recall" | "undelivered";

export interface Transmission {
  id: string; // 호출은 기록 id(C-0007, D-0012, CC-0003), 답은 "<id>#<답>"
  at: string;
  freq: Freq;
  from: string; // TOWER · OCC · MCC · "GOLF (TEAM_G)"
  to: string; // 위와 같다. 모두에게 하는 GROUND 방송은 "ALL"
  aircraft?: string; // 이 교신의 AIRCRAFT REGISTRATION(필터용)
  kind: string; // CROSSCHECK · PREFLIGHT HOLD · HOLD(PREFLIGHT, 호출이 아님) · GO AROUND · FLIGHT PLAN · READBACK · ROGER · UNABLE · STANDBY · RECALL · CREW CHANGE · ARRIVED · INSPECTION · LAND · ESCALATE · RTS …
  flight?: string;
  airport?: string;
  pr?: number; // 이 교신이 다루는 PR 번호(ARRIVED 보고, MCC INSPECTION·LAND·ESCALATE)
  re?: string; // 답이면 호출의 kind(GO AROUND, FLIGHT PLAN …). 음성 문구(ATC-172)가 쓴다
  result?: string; // GROUND 줄의 결과(소문자): pass·findings(INSPECTION), ok·rejected·failed(LAND), started·running·ok·refused·rollback·failed(RTS)
  head: string; // 필드로 만든 한 줄 요약
  body?: string; // 기록된 문구 그대로
  replyTo?: string; // 답이면 호출의 id
  open?: true; // 호출인데 아직 닫는 답이 없음
  overdueAt?: string; // open이고 이 시각을 넘으면 overdue(기존 규칙)
  orphan?: true; // 답인데 호출 기록이 없음(남겨 두고 표시)
  undelivered?: string; // 보냈지만 닿지 않았다고 OCC가 알림(ATC-183): 그 사유. 이 호출은 닫혔고 다시 보내면 같은 id의 새 호출이 생긴다
  closedBy?: ClosedBy; // 답 없이 닫힌 호출이 어떻게 닫혔나(READABILITY가 취소를 무응답에서 뺀다, ATC-176)
}

export interface RadioInput {
  clearances: readonly ClearanceOp[];
  proposals: readonly Op[];
  crewChanges: readonly CrewChangeOp[];
  reports: readonly ArrivalReport[];
  mcc: readonly MccRecord[];
  rts: readonly RtsRecord[];
  schedule?: readonly ScheduleLine[]; // SCHEDULE 초안의 CROSSCHECK mark(PREFLIGHT)
}

// CLEARANCE READBACK overdue와 같은 10분(controller.ts OVERDUE_MS)
export const CLEARANCE_OVERDUE_MS = 10 * 60_000;
export const MAX_LIMIT = 2000;
export const DEFAULT_WINDOW_MS = 6 * 3_600_000;

type Who = { station: string; aircraft?: string };

// 세션 이름·REGISTRATION → 스테이션. TEAM_G → "GOLF (TEAM_G)", 팀 이름이 아니면 이름 그대로
export function aircraftStation(name: string, teamPattern = DEFAULT_TEAM_PATTERN): Required<Who> {
  const reg = registrationOf(name, teamPattern);
  if (!reg) return { station: name, aircraft: name };
  return { station: `${callsign({ name: reg })} (${reg})`, aircraft: reg };
}
const short = (station: string) => station.replace(/ \(.*\)$/, "");
const headOf = (from: string, to: string, ...parts: (string | undefined | null)[]) => [`${short(from)} → ${short(to)}`, ...parts.filter(Boolean)].join(" · ");
const iso = (ms: number) => new Date(ms).toISOString();

export function radioOf(input: RadioInput, teamPattern = DEFAULT_TEAM_PATTERN): Transmission[] {
  const out: Transmission[] = [];
  const flightOf = new Map<string, string>(); // D-xxxx → FLIGHT
  const airportOfFlight = new Map<string, string>();
  for (const o of input.proposals) {
    if (o.op !== "create") continue;
    if (o.flight) flightOf.set(o.id, o.flight);
    if (o.airport && o.flight) airportOfFlight.set(o.flight, o.airport);
  }
  const add = (t: Transmission) => {
    if (t.flight && !t.airport && airportOfFlight.has(t.flight)) t.airport = airportOfFlight.get(t.flight);
    for (const k of ["flight", "airport", "aircraft", "body", "pr", "re", "result"] as const) if (t[k] === undefined) delete t[k];
    out.push(t);
    return t;
  };
  // 답. 호출 기록이 없으면 남겨 두고 orphan으로 표시한다
  const reply = (call: Transmission | undefined, callId: string, suffix: string, t: Omit<Transmission, "id" | "replyTo">) =>
    add({ ...t, id: `${callId}#${suffix}`, replyTo: call?.id ?? callId, re: call?.kind, ...(call ? {} : { orphan: true as const }), ...(call && !t.flight ? { flight: call.flight } : {}) });
  const close = (call: Transmission, by?: ClosedBy) => {
    delete call.open;
    delete call.overdueAt;
    if (by) call.closedBy = by;
  };
  // 첫 STANDBY가 overdue를 한 번 다시 센다(overdueBase)
  const standby = (call: Transmission, seen: Set<string>, at: string, ms: number) => {
    if (seen.has(call.id)) return;
    seen.add(call.id);
    if (call.open) call.overdueAt = iso(overdueBase(call.at, at) + ms);
  };
  const REPLY_KIND = { readback: "READBACK", roger: "ROGER", unable: "UNABLE", standby: "STANDBY" } as const;

  // ── TOWER: clearances.jsonl ──
  const clr = new Map<string, Transmission>();
  const clrWho = new Map<string, Who>();
  const clrStandby = new Set<string>();
  for (const o of input.clearances) {
    if (o.op === "issue") {
      const to = aircraftStation(o.toName, teamPattern);
      clrWho.set(o.id, to);
      clr.set(
        o.id,
        add({
          id: o.id, at: o.at, freq: "TOWER", from: "TOWER", to: to.station, aircraft: to.aircraft, kind: o.type, flight: o.flight ?? undefined,
          head: headOf("TOWER", to.station, o.type, o.flight), body: o.text, open: true, overdueAt: iso(Date.parse(o.at) + CLEARANCE_OVERDUE_MS),
        }),
      );
      continue;
    }
    const call = clr.get(o.id);
    if (o.op === "cancel" || o.op === "undeliverable") {
      if (call) close(call, "cancel"); // 취소는 교신이 아니라 호출을 거두는 것
      continue;
    }
    if (o.op === "hand") continue; // SUPERVISOR의 표시이지 교신이 아니다(ATC-271)
    const w = clrWho.get(o.id) ?? { station: "?" };
    const kind = REPLY_KIND[o.op];
    reply(call, o.id, o.op, {
      at: o.at, freq: "TOWER", from: w.station, to: "TOWER", aircraft: w.aircraft, kind, head: headOf(w.station, "TOWER", kind, call?.flight ?? o.id),
      body: o.op === "unable" ? o.reason : undefined,
    });
    if (!call) continue;
    if (o.op === "standby") standby(call, clrStandby, o.at, CLEARANCE_OVERDUE_MS);
    else close(call);
  }

  // ── DELIVERY: proposals.jsonl ──
  const who = new Map<string, Who>();
  const plan = new Map<string, Transmission>();
  const recall = new Map<string, Transmission>();
  const planStandby = new Set<string>();
  const undelivers = new Map<string, number>(); // D-xxxx → 닿지 않은 횟수(ATC-183)
  for (const o of input.proposals) {
    if (o.op === "create") {
      const name = o.registration ?? o.aircraftName;
      if (name) who.set(o.id, aircraftStation(name, teamPattern));
      continue;
    }
    const a = who.get(o.id) ?? { station: "?" };
    const flight = flightOf.get(o.id);
    if (o.op === "send") {
      plan.set(
        o.id,
        add({
          id: o.id, at: o.at, freq: "DELIVERY", from: "OCC", to: a.station, aircraft: a.aircraft, kind: "FLIGHT PLAN", flight,
          head: headOf("OCC", a.station, "FLIGHT PLAN", flight), body: o.message, open: true, overdueAt: iso(Date.parse(o.at) + READBACK_OVERDUE_MS),
        }),
      );
    } else if (o.op === "undelivered") {
      // 닿지 않은 FLIGHT PLAN(ATC-183): 그 호출을 닫고 표시한다. 다시 보내면 같은 id의 새 호출이 생기므로 이 호출의 id는 바꿔 둔다
      const p = plan.get(o.id);
      if (p) {
        p.id = `${o.id}#undelivered${(undelivers.get(o.id) ?? 0) + 1}`;
        undelivers.set(o.id, (undelivers.get(o.id) ?? 0) + 1);
        p.undelivered = o.reason;
        close(p, "undelivered");
      }
    } else if (o.op === "recall") {
      const p = plan.get(o.id);
      if (p) close(p, "recall"); // 거둔 FLIGHT PLAN은 더 답을 기다리지 않는다
      recall.set(
        o.id,
        add({
          id: `${o.id}#recall`, at: o.at, freq: "DELIVERY", from: "OCC", to: a.station, aircraft: a.aircraft, kind: "RECALL", flight,
          head: headOf("OCC", a.station, "RECALL", flight), body: o.message, open: true, overdueAt: iso(Date.parse(o.at) + READBACK_OVERDUE_MS),
        }),
      );
    } else if (o.op === "recalled") {
      const call = recall.get(o.id);
      reply(call, call?.id ?? `${o.id}#recall`, "readback", {
        at: o.at, freq: "DELIVERY", from: a.station, to: "OCC", aircraft: a.aircraft, kind: "READBACK", flight, head: headOf(a.station, "OCC", "READBACK RECALL", flight),
      });
      if (call) close(call);
    } else if (o.op === "accept" || o.op === "decline" || o.op === "standby") {
      const call = plan.get(o.id);
      if (!call && o.op === "standby") continue;
      const kind = o.op === "accept" ? "READBACK" : o.op === "decline" ? "UNABLE" : "STANDBY";
      reply(call, o.id, kind.toLowerCase(), {
        at: o.at, freq: "DELIVERY", from: a.station, to: "OCC", aircraft: a.aircraft, kind, flight, head: headOf(a.station, "OCC", kind, flight),
        body: o.op === "decline" ? o.reason : undefined,
      });
      if (!call) continue;
      if (o.op === "standby") standby(call, planStandby, o.at, READBACK_OVERDUE_MS);
      else close(call);
    } else if (o.op === "supersede" || o.op === "expire") {
      const call = plan.get(o.id);
      if (call) close(call, o.op); // 기록상 답 없이 닫힘: open만 풀고 답은 만들지 않는다
    }
  }

  // ── COMPANY: CREW CHANGE, ARRIVED ──
  const cc = new Map<string, Transmission>();
  const ccWho = new Map<string, Who>();
  const ccStandby = new Set<string>();
  for (const o of input.crewChanges) {
    if (o.op === "created") {
      ccWho.set(o.id, aircraftStation(o.registration, teamPattern));
      continue;
    }
    const a = ccWho.get(o.id) ?? { station: "?" };
    if (o.op === "sent") {
      cc.set(
        o.id,
        add({
          id: o.id, at: o.at, freq: "COMPANY", from: "OCC", to: a.station, aircraft: a.aircraft, kind: "CREW CHANGE",
          head: headOf("OCC", a.station, "CREW CHANGE"), body: o.message, open: true, overdueAt: iso(Date.parse(o.at) + CREW_CHANGE_READBACK_OVERDUE_MS),
        }),
      );
    } else if (o.op === "acknowledged" || o.op === "unable" || o.op === "standby") {
      const call = cc.get(o.id);
      if (!call && o.op === "standby") continue;
      const kind = o.op === "acknowledged" ? "READBACK" : o.op === "unable" ? "UNABLE" : "STANDBY";
      reply(call, o.id, kind.toLowerCase(), {
        at: o.at, freq: "COMPANY", from: a.station, to: "OCC", aircraft: a.aircraft, kind, head: headOf(a.station, "OCC", kind, "CREW CHANGE"),
        body: o.op === "unable" ? o.reason : undefined,
      });
      if (!call) continue;
      if (o.op === "standby") standby(call, ccStandby, o.at, CREW_CHANGE_READBACK_OVERDUE_MS);
      else close(call);
    } else if (o.op === "superseded" || o.op === "delivered") {
      const call = cc.get(o.id);
      if (call) close(call, o.op === "delivered" ? "delivered" : "supersede");
    }
  }
  for (const r of input.reports) {
    const a = r.proposal ? who.get(r.proposal) : undefined;
    const from = a?.station ?? "AIRCRAFT";
    add({
      id: `report:${r.flight}:${r.at}`, at: r.at, freq: "COMPANY", from, to: "OCC", aircraft: a?.aircraft, kind: "ARRIVED", flight: r.flight, pr: r.pr ?? undefined,
      head: headOf(from, "OCC", "ARRIVED", r.flight, r.pr !== null ? `PR #${r.pr}` : "RESULT", `TIER ${r.tier}`),
    });
  }

  // ── GROUND: mcc.jsonl, rts.jsonl ──
  const ground = (id: string, at: string, kind: string, head: string, body?: string, pr?: number, result?: string) => add({ id, at, freq: "GROUND", from: "MCC", to: "ALL", kind, head, body, pr, result });
  for (const r of input.mcc) {
    if (r.op === "inspect") ground(`mcc:${r.at}:inspect:${r.pr}`, r.at, "INSPECTION", headOf("MCC", "ALL", "INSPECTION", `PR #${r.pr}`, r.verdict.toUpperCase()), r.text, r.pr, r.verdict);
    else if (r.op === "escalate") ground(`mcc:${r.at}:escalate:${r.pr}`, r.at, "ESCALATE", headOf("MCC", "ALL", "ESCALATE", `PR #${r.pr}`), r.reason, r.pr, "escalate");
    else if (r.op === "land") ground(`mcc:${r.at}:land:${r.pr}`, r.at, "LAND", headOf("MCC", "ALL", "LAND", `PR #${r.pr}`, r.result.toUpperCase()), r.detail, r.pr, r.result);
    else if (r.op === "rts") ground(`mcc:${r.at}:rts`, r.at, "RTS", headOf("MCC", "ALL", "RTS", r.result.toUpperCase(), r.to.slice(0, 7)), r.detail, undefined, r.result);
  }
  for (const r of input.rts) ground(`rts:${r.at}:${r.result}`, r.at, "RTS", headOf("MCC", "ALL", `RTS ${r.result.toUpperCase()}`, r.to.slice(0, 7)), r.detail, undefined, r.result);

  // ── PREFLIGHT: 출발 전 점검(ATC-267). CROSSCHECK mark, PREFLIGHT HOLD, DISPATCH HOLD ──
  // 호출이 아니다: open·overdueAt·replyTo가 없고 READABILITY도 세지 않는다. 같은 제안에 mark가 다시 달리면 줄을 모두 남기고 head는 각 mark의 판정을 말한다
  const pre = (id: string, at: string, from: string, to: string, kind: string, flight: string | undefined, head: string, body: string | undefined, a: Who, result?: string) =>
    add({ id, at, freq: "PREFLIGHT", from, to, aircraft: a.aircraft, kind, flight, head, body, result });
  const notes = new Map<string, string>(); // D-xxxx → 마지막 note(선행 없는 HOLD의 사유가 여기 있다)
  for (const o of input.proposals) {
    if (o.op === "note") notes.set(o.id, o.text);
    const a = who.get(o.id) ?? { station: "?" };
    const flight = flightOf.get(o.id);
    const label = [o.id, flight].filter(Boolean).join(" ");
    if (o.op === "crosscheck") {
      pre(`${o.id}#crosscheck:${o.at}`, o.at, "CROSSCHECK", "OCC", "CROSSCHECK", flight, headOf("CROSSCHECK", "OCC", label, o.verdict.toUpperCase()), o.reason, a, o.verdict);
    } else if (o.op === "preflight") {
      pre(`${o.id}#preflight:${o.at}`, o.at, o.by || "OCC", "OCC", "PREFLIGHT HOLD", flight, headOf(o.by || "OCC", "OCC", label, "PREFLIGHT HOLD"), o.reason, a);
    } else if (o.op === "hold") {
      const why = o.blockedBy.length ? `blocked by ${o.blockedBy.join(", ")}` : notes.get(o.id);
      pre(`${o.id}#hold:${o.at}`, o.at, "OCC", "ALL", "HOLD", flight, headOf("OCC", "ALL", label, "HOLD"), why, a);
    }
  }
  const draftFlight = new Map<string, string>();
  for (const o of input.schedule ?? []) if (o.op === "draft" && o.flight) draftFlight.set(o.id, o.flight);
  for (const o of input.schedule ?? []) {
    if (o.op !== "crosscheck") continue;
    const flight = draftFlight.get(o.id);
    pre(`${o.id}#crosscheck:${o.at}`, o.at, "CROSSCHECK", "OCC", "CROSSCHECK", flight, headOf("CROSSCHECK", "OCC", [o.id, flight].filter(Boolean).join(" "), o.verdict.toUpperCase()), o.reason, { station: "?" }, o.verdict);
  }

  // 시각순. 같은 시각이면 호출이 답보다 앞, 그다음은 기록 순서(안정 정렬)
  const idx = new Map(out.map((t, i) => [t, i]));
  return out
    .filter((t) => Number.isFinite(Date.parse(t.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || Number(Boolean(a.replyTo)) - Number(Boolean(b.replyTo)) || idx.get(a)! - idx.get(b)!);
}

export const isOverdue = (t: Transmission, now: number) => Boolean(t.open && t.overdueAt && now > Date.parse(t.overdueAt));

export interface RadioQuery {
  since: number; // ms
  freqs: Set<Freq> | null;
  limit: number;
}

// ?since=<iso>&freq=<list>&limit= — 없으면 지난 6시간·상한 MAX_LIMIT. 모르는 freq·잘못된 값은 오류
export function parseRadioQuery(q: { since?: string; freq?: string; limit?: string }, now: number): { ok: true; query: RadioQuery } | { ok: false; error: string } {
  let since = now - DEFAULT_WINDOW_MS;
  if (q.since) {
    const t = Date.parse(q.since);
    if (!Number.isFinite(t)) return { ok: false, error: `since is not a time: ${q.since}` };
    since = t;
  }
  let freqs: Set<Freq> | null = null;
  const parts = (q.freq ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (parts.length) {
    const unknown = parts.filter((p) => !(FREQS as readonly string[]).includes(p));
    if (unknown.length) return { ok: false, error: `unknown freq: ${unknown.join(", ")}` };
    freqs = new Set(parts as Freq[]);
  }
  let limit = MAX_LIMIT;
  if (q.limit) {
    const n = Number(q.limit);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: `limit must be a positive integer: ${q.limit}` };
    limit = Math.min(n, MAX_LIMIT);
  }
  return { ok: true, query: { since, freqs, limit } };
}

// 걸러서 가장 최근 limit개, 오래된 것부터(newest last)
export function selectRadio(all: readonly Transmission[], q: RadioQuery): Transmission[] {
  return all.filter((t) => Date.parse(t.at) >= q.since && (!q.freqs || q.freqs.has(t.freq))).slice(-q.limit);
}

// SSE용: 지난번에 보낸 서명과 비교해 새로 생겼거나 바뀐(답이 붙어 open이 풀림, STANDBY로 overdueAt이 밀림) 교신만
export const txKey = (t: Transmission) => JSON.stringify([t.open ?? false, t.overdueAt ?? null, t.orphan ?? false]);
export function changedRadio(prev: ReadonlyMap<string, string>, all: readonly Transmission[]): Transmission[] {
  return all.filter((t) => prev.get(t.id) !== txKey(t));
}
