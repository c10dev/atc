import { INFO_ONLY_EVENTS, type Inputs, project, type Role, stripDurations } from "./squelch.ts";

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

// 판단 기준표에서 "새 key가 보이면 한 번 알린다 / 새로 생겼을 때 보고한다"인 줄은 사건이 아니라 상태에서 온다. 상태는 사라질 때까지 브리핑에 남으니,
// 그 항목이 이미 한 번 세션에 보였는지(seen)를 서버가 기억하고, 처음 보이는 것만 할 일로 센다(tick-run.ts가 seen을 저장한다).
// 일부러 넣지 않은 줄: open.coldCache(보낼 CLEARANCE가 있을 때 곁들이는 것이라 혼자서는 할 일이 없다), open.fuelError(ATC LOG에만),
// traffic[].away·open.health의 info 단계(ATC LOG에만), groundStops·slotHold(LAND를 내지 않을 뿐이고 새 지시는 사건이나 `reset`이 데려온다), codex·review 필드(LAND·info·fix가 데려온다).
export function persistentKeysOf(b: J): string[] {
  if (!b || typeof b !== "object") return [];
  const keys: string[] = [];
  for (const f of arr(b.open?.fuel)) keys.push(`fuel:${f?.key}`);
  for (const f of arr(b.open?.fuelLeaks)) keys.push(`fuel-leak:${f?.key}`);
  if (b.github?.error) keys.push(`github-error:${String(typeof b.github.error === "string" ? b.github.error : JSON.stringify(b.github.error)).slice(0, 200)}`);
  for (const q of arr(b.landingQueue)) if (q?.extReview?.status === "excluded") keys.push(`ext-excluded:${q.airport ?? ""}#${q.pr?.number ?? ""}`);
  for (const x of arr(b.open?.stranded)) keys.push(`stranded:${x?.key}#${x?.pr}`);
  for (const o of arr(b.open?.orphans)) keys.push(`orphan:${o?.stand}`);
  for (const u of arr(b.open?.unattended)) keys.push(`unattended:${u?.stand}`);
  for (const n of arr(b.open?.noContact)) keys.push(`no-contact:${n}`);
  for (const h of arr(b.open?.health)) if (h?.level === "alert") keys.push(`health:${h?.name}|${h?.code}`);
  for (const a of arr(b.open?.healthAlerts)) keys.push(`health-alert:${stripDurations(String(a?.message ?? ""))}`);
  return [...new Set(keys)].sort();
}

function towerActionable(b: J, seen: ReadonlySet<string>): Actionable {
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
    if (q?.landing === "CLEARED" && holder && !q?.groundStop && !q?.slotHold && !q?.landClearance && q?.landVia !== "server") reasons.push("land"); // landVia server: 서버가 보낸다(ATC-557 b)
    // 상태에서 만든 지시(ATC-128, ATC-270): action이 send(보낸다)·supervisor(보고한다)일 때만 할 일이다.
    // sent는 이미 나갔고, info의 log는 ATC LOG에만 남기는 것이라(매 바퀴 같다) 할 일로 세지 않는다
    for (const [key, why] of [["goAround", "go-around"], ["info", "approach-info"], ["fix", "fix"]] as const) {
      const a = q?.[key]?.action;
      if (a === "send" || a === "supervisor") reasons.push(why);
    }
  }
  if (arr(b.relays).length) reasons.push("relay"); // SUPERVISOR RELAY(ATC-271): 아직 안 보낸 relay가 있다. TICK QUIET이면 TOWER가 읽지 않는다
  if (arr(b.clearances?.overdue).length) reasons.push("overdue-clearance");
  if (arr(b.open?.conflicts).length && !arr(b.clearances?.pending).length) reasons.push("conflict");
  for (const k of persistentKeysOf(b)) if (!seen.has(k)) reasons.push(`new:${k.slice(0, k.indexOf(":"))}`);
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

// OCC의 상태에서 오는 "한 번만 알린다 / 하루에 한 번 본다" 줄(ATC-298): 도착 보고 누락(`arrivalMissing`의 due), 앞 세션이 다듬던 CHARTER REQUEST(`wip`),
// 24시간 안에 TARGET·ROUTE 초안이 없을 때의 NETWORK 점검(날짜마다 한 번만). TOWER와 같이 세션에 이미 보인 key는 seen에 두고, 처음 보이는 것만 할 일이다
const DAY = 86_400_000;
export function occKeysOf(i: Inputs, nowMs: number): string[] {
  const keys: string[] = [];
  for (const m of arr((i.dispatch as J)?.arrivalMissing)) if (m?.due === true) keys.push(`arrival-missing:${m.flight}`);
  for (const w of arr((i.schedule as J)?.wip)) keys.push(`wip:${w?.id}`);
  const ops = [...arr((i.schedule as J)?.open), ...arr((i.schedule as J)?.recent)];
  const recentDraft = ops.some((o) => (o?.kind === "TARGET" || o?.kind === "ROUTE") && nowMs - Date.parse(o?.at) < DAY);
  if (!recentDraft && (i.schedule as J)?.mode !== undefined) keys.push(`target-route:${new Date(nowMs).toISOString().slice(0, 10)}`);
  return [...new Set(keys)].sort();
}

function occActionable(i: Inputs, seen: ReadonlySet<string>, nowMs: number): Actionable {
  const p = project("occ", i) as J;
  const reasons: string[] = [];
  const add = (cond: boolean, why: string) => cond && reasons.push(why);
  add(p.schedule.inProgress.length > 0, "schedule-release"); // S2: 승인된 것을 발부하고, released는 반영될 때까지 다시 본다
  add(arr((i.schedule as J)?.duty?.charters).length > 0, "charter-request"); // DUTY의 CHARTER REQUEST는 `charter-seen`으로 기록할 때까지 구역에 남는다
  for (const k of occKeysOf(i, nowMs)) if (!seen.has(k)) reasons.push(`new:${k.slice(0, k.indexOf(":"))}`);
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

// seen: 이미 세션에 한 번 보인 상태 항목의 key(TOWER만 쓴다). 모르면 비어 있고, 그러면 있는 항목이 모두 새 것이라 할 일이 된다
export function actionable(role: Role, inputs: Inputs, seen: ReadonlySet<string> = new Set(), nowMs = Date.now()): Actionable {
  try {
    switch (role) {
      case "tower":
        return towerActionable(inputs.brief, seen);
      case "mcc":
        return mccActionable(inputs.queue);
      case "occ":
        return occActionable(inputs, seen, nowMs);
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
