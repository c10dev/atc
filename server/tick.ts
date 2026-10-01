import { INFO_ONLY_EVENTS, type Inputs, project, type Role } from "./squelch.ts";

// 조용한 tick(ATC-297, docs/squelch.md): 관제 세션의 `/tick`이 읽는 브리핑에 할 일이 있는가. 순수 함수만 둔다.
// 판단 기준은 각 역할 CLAUDE.md의 표다. 확신이 없으면 act: true다(조용하다고 잘못 말하는 쪽이 비싸다):
// 알 수 없는 모양, 모르는 사건 종류는 모두 할 일로 센다. 여기서 false를 내는 것은 아래 이유가 하나도 없을 때뿐이다.

export interface Actionable {
  act: boolean;
  reasons: string[]; // 짧은 코드. act: false면 빈 배열
  info: number; // TOWER: ATC LOG에 적기만 하는 사건 수(handoff, away.*). QUIET이어도 ack되므로 한 줄에 알린다
}

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const arr = (x: J): J[] => (Array.isArray(x) ? x : []);


function towerActionable(b: J): Actionable {
  if (!b || typeof b !== "object" || !Array.isArray(b.events)) return { act: true, reasons: ["bad-brief"], info: 0 };
  const reasons: string[] = [];
  let info = 0;
  if (b.reset === true) reasons.push("reset"); // 서버가 재시작됐다: 사건보다 현재 상태를 본다
  for (const e of arr(b.events)) {
    const kind = String(e?.kind ?? "unknown");
    if (INFO_ONLY_EVENTS.has(kind)) info++; // ATC LOG에 적기만 하고 CLEARANCE도 보고도 없는 사건(controller/CLAUDE.md "판단 기준")
    else reasons.push(`event:${kind}`);
  }
  for (const q of arr(b.landingQueue)) {
    const holder = q?.landBy === undefined || q?.landBy === null || q?.landBy === "holder";
    if (q?.landing === "CLEARED" && holder && !q?.groundStop && !q?.slotHold && !q?.landClearance) reasons.push("land");
    if (q?.goAround && q.goAround.action !== "sent") reasons.push("go-around"); // send·supervisor만. sent는 이 head에 이미 나갔다
  }
  if (arr(b.clearances?.overdue).length) reasons.push("overdue-clearance");
  if (arr(b.open?.conflicts).length && !arr(b.clearances?.pending).length) reasons.push("conflict");
  return { act: reasons.length > 0, reasons: [...new Set(reasons)], info };
}

// 나머지 역할: 그 역할이 하는 일의 목록이 비어 있지 않으면 할 일이다(SQUELCH 투영의 목록 필드를 그대로 쓴다)
function mccActionable(q: J): Actionable {
  if (!q || typeof q !== "object" || !Array.isArray(q.pulls)) return { act: true, reasons: ["bad-brief"], info: 0 };
  const reasons: string[] = [];
  for (const p of arr(q.pulls)) {
    if (p?.landable) reasons.push("land");
    else if (!p?.inspection && !p?.error) reasons.push("inspect");
  }
  if (q.rts?.due) reasons.push("rts");
  return { act: reasons.length > 0, reasons: [...new Set(reasons)], info: 0 };
}

function occActionable(i: Inputs): Actionable {
  const p = project("occ", i) as J;
  const reasons: string[] = [];
  const add = (cond: boolean, why: string) => cond && reasons.push(why);
  add(p.needsNote.length > 0, "needs-note");
  add(p.inFlight.some((x: string) => /:(approved|recalling)$/.test(x)), "send-plan");
  add(p.overdue.length > 0, "overdue");
  add(p.arrivalCandidates.length > 0, "arrival");
  add(p.crewChange.approved.length > 0, "crew-change");
  add(p.crewChange.overdue.length > 0, "crew-change-overdue");
  add(Object.values(p.schedule.candidates).some((l) => (l as unknown[]).length > 0), "schedule-candidates");
  add(p.schedule.waypointGaps.length > 0, "waypoint-gaps");
  add(p.schedule.slips.length > 0, "slips");
  add(p.schedule.routesWithoutWaypoints.length > 0, "routes-without-waypoints");
  add(p.following.length > 0, "following");
  return { act: reasons.length > 0, reasons, info: 0 };
}

export function actionable(role: Role, inputs: Inputs): Actionable {
  try {
    switch (role) {
      case "tower":
        return towerActionable(inputs.brief);
      case "mcc":
        return mccActionable(inputs.queue);
      case "occ":
        return occActionable(inputs);
      case "crosscheck": {
        const p = project("crosscheck", inputs) as J;
        const reasons = [...(p.dispatch.length ? ["dispatch"] : []), ...(p.schedule.length ? ["schedule"] : [])];
        return { act: reasons.length > 0, reasons, info: 0 };
      }
      case "review": {
        const p = project("review", inputs) as J;
        return { act: p.pending.length > 0, reasons: p.pending.length ? ["pending"] : [], info: 0 };
      }
    }
  } catch {
    return { act: true, reasons: ["error"], info: 0 };
  }
}

// atcctl이 찍는 한 줄. 조용하면 한 줄이 전부다
export function quietLine(role: Role, a: Actionable): string {
  return `TICK QUIET ${role} — nothing to act on${a.info ? ` (${a.info} info event${a.info > 1 ? "s" : ""} acked)` : ""}`;
}
export function actLine(role: Role, a: Actionable): string {
  return `TICK ACT ${role}\nREASONS: ${a.reasons.join(", ") || "-"}`;
}
