import type { Inputs } from "./squelch.ts";
import { INFO_ONLY_EVENTS, project } from "./squelch.ts";
import { occKeysOf, persistentKeysOf } from "./tick.ts";
import { KIND_OF_WAKE_EVENT, type ServerClearanceKind } from "./server-clearance.ts";

// CONTROL WAKE(ATC-557 a, docs/control-recycle.md 7): TOWER·OCC·MCC를 `/loop` 대신 판단할 일이 생길 때만 깨운다. 순수 함수만(입출력은 control-wake-run.ts).
// 할 일의 목록은 `atcctl tick <역할>`이 쓰는 `actionable`(server/tick.ts)과 같은 브리핑·같은 기준이다. 여기서는 그 이유를 항목(key) 하나하나로 나눠
// 지난 깨움 뒤에 새로 생긴 것(delta)과 풀린 것을 가린다. 깨우는 글 하나에 새 항목·아직 열린 항목·풀린 항목·관련 FLIGHT를 싣는다.
// 메뉴(menu): 브리핑이 문구와 대상을 이미 정해 세션은 그대로 옮기기만 하는 일(LAND·INFO·GO AROUND·FIX 보내기, RELAY, 첫 RESEND, FLIGHT PLAN·CREW CHANGE 보내기,
// MCC의 착륙·RTS). 서버가 맡을 수 있는 일이라 그것만으로 깨운 것은 오작동으로 센다. TOWER의 CLEARANCE는 SERVER CLEARANCE(ATC-557 b)가 서버로 옮겼다:
// 서버가 맡은 항목은 브리핑에 서버 몫으로 표시돼 사건이 되지 않고, 스위치가 off인 종류는 TOWER의 일이라 메뉴로 세지 않는다(EventCtx.serverKinds).

export const WAKE_ROLES = ["tower", "occ", "mcc"] as const;
export type WakeRole = (typeof WAKE_ROLES)[number];
export const isWakeRole = (x: string): x is WakeRole => (WAKE_ROLES as readonly string[]).includes(x);
export const ROLE_NAME: Record<WakeRole, "TOWER" | "OCC" | "MCC"> = { tower: "TOWER", occ: "OCC", mcc: "MCC" };
export const roleOfName = (name: string): WakeRole | null => WAKE_ROLES.find((r) => ROLE_NAME[r] === name.toUpperCase()) ?? null;
// 그 역할 폴더에서 atcctl을 부르는 꼴(관제 폴더 CLAUDE.md의 도구 표와 같다)
export const ATCCTL_OF: Record<WakeRole, string> = { tower: "node atcctl.mjs", occ: "node ../controller/atcctl.mjs", mcc: "node ../controller/atcctl.mjs" };

// ── 스위치(SUPERVISOR만, control-wake.json) ──
// loop: 오늘과 같다(`/loop <n>m /tick`). wake: `/loop` 없이 서버가 깨운다(기본). fresh(깨울 때마다 새 세션)는 이 PR에 없다
export const WAKE_MODES = ["loop", "wake"] as const;
export type WakeMode = (typeof WAKE_MODES)[number];
export const DEFAULT_WAKE_MODE: WakeMode = "wake"; // 처음부터 켠다(SUPERVISOR 결정 2026-10-06, live first)
export const SAFE_WAKE_MODE: WakeMode = "loop"; // 값이 있는데 모르는 값이면 오늘처럼(틀린 값이 깨움을 켜지 않게). 없는 값은 기본
export type WakeSwitch = Record<WakeRole, WakeMode>;
export function parseWakeSwitch(raw: unknown): WakeSwitch {
  const o = (raw && typeof raw === "object" ? (raw as { roles?: unknown }).roles : null) as Record<string, unknown> | null;
  const one = (r: WakeRole): WakeMode => {
    const v = o && typeof o === "object" ? o[r] : undefined;
    if (v === undefined) return DEFAULT_WAKE_MODE;
    return (WAKE_MODES as readonly unknown[]).includes(v) ? (v as WakeMode) : SAFE_WAKE_MODE;
  };
  return { tower: one("tower"), occ: one("occ"), mcc: one("mcc") };
}

// ── 깨우는 사건 ──
export interface WakeEvent {
  key: string; // 안정한 이름. 같은 일이면 같은 key(새로 생긴 것과 이미 깨운 것을 가른다)
  kind: string; // 종류(줄 머리, 수)
  text: string; // 한 줄(영어, 세션이 읽는다)
  flights: string[]; // 이 일이 걸린 FLIGHT
  menu: boolean; // 서버가 맡을 수 있는 일(위 머리말)
  graceMs?: number; // 처음 본 뒤 이만큼은 깨우지 않는다(서버가 먼저 할 기회)
}

export interface EventCtx {
  seen: ReadonlySet<string>; // tick-seen.json의 그 역할 key(세션에 이미 한 번 보인 상태 항목)
  now: number;
  answers?: readonly string[]; // SUPERVISOR가 답한 DECISION 줄(`DECISION DC-xxxx … ANSWERED`)
  serverResent?: ReadonlySet<string>; // OCC: 서버가 READBACK 없이 한 번 다시 보낸 FLIGHT PLAN(ATC-562 resend). 그 뒤 overdue는 두 번째 침묵
  // TOWER: SERVER CLEARANCE(ATC-557 b) 스위치가 on인 종류. 서버가 맡는 항목은 브리핑에서 서버 몫(action server 등)이라 사건이 되지 않는다.
  // 그래도 TOWER에게 온 그 종류의 항목(서버가 넘겼거나 쓸 수 없는 세션)은 메뉴(서버가 할 수 있던 일)로 센다. 스위치가 off인 종류는 TOWER의 일이라 메뉴가 아니다. 없으면 옛 셈(모두 메뉴)
  serverKinds?: ReadonlySet<ServerClearanceKind>;
}

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const arr = (x: J): J[] => (Array.isArray(x) ? x : []);
const one = (s: unknown, n = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const flightsOf = (...xs: unknown[]) => [...new Set(xs.filter((x): x is string => typeof x === "string" && x.length > 0))];
export const SERVER_FIRST_MS = 3 * 60_000; // 서버 job(SERVER SEND·MCC SERVER AUTO)이 먼저 하도록 기다리는 시간. 그 job들은 30초마다 돈다
export const DAILY_GRACE_MS = 30 * 60_000; // OCC의 하루 한 번 NETWORK 점검(target-route:<날짜>)은 00:30Z 뒤에(00:00Z는 DUTY REVIEW의 heartbeat)

const answerEvents = (answers: readonly string[] | undefined): WakeEvent[] =>
  arr(answers).map((line: string) => {
    const id = /DC-\d+/.exec(line)?.[0] ?? one(line, 40);
    return { key: `decision:${id}`, kind: "decision-answered", text: one(line, 200), flights: [], menu: false };
  });

function towerEvents(b: J, ctx: EventCtx): WakeEvent[] {
  if (!b || typeof b !== "object" || !Array.isArray(b.events)) return [{ key: "bad-brief", kind: "outside-menu", text: "the TOWER brief could not be read by the server — read `brief` yourself", flights: [], menu: false }];
  const out: WakeEvent[] = [];
  const menuOf = (kind: string) => (ctx.serverKinds ? ctx.serverKinds.has(KIND_OF_WAKE_EVENT[kind]!) : true);
  const epoch = String(b.cursor ?? "").split(":")[0] ?? "";
  if (b.reset === true) out.push({ key: `reset:${epoch}`, kind: "reset", text: "atc restarted: the event log is new, act on the current state (open, landingQueue, clearances)", flights: [], menu: false });
  for (const e of arr(b.events)) {
    const kind = String(e?.kind ?? "unknown");
    if (INFO_ONLY_EVENTS.has(kind)) continue; // ATC LOG에만 적는 사건. 깨우지 않는다(서버가 ack한다)
    const who = arr(e?.sessions).map((x) => x?.name ?? x).filter(Boolean).join(", ");
    out.push({ key: `event:${epoch}:${e?.id}`, kind: `event:${kind}`, text: one(`event ${e?.id} ${kind}${who ? ` (${who})` : ""}${e?.message ? `: ${e.message}` : ""}`, 220), flights: flightsOf(e?.flight), menu: false });
  }
  for (const q of arr(b.landingQueue)) {
    const pr = `${q?.airport ?? ""} #${q?.pr?.number ?? "?"}@${String(q?.pr?.head ?? "").slice(0, 7)}`;
    const holders = arr(q?.holders).map((h) => h?.name ?? h).filter(Boolean).join(", ") || "no holder";
    const holder = q?.landBy === undefined || q?.landBy === null || q?.landBy === "holder";
    // landVia server: 서버가 보낸다(ATC-557 b) — TOWER의 일이 아니다
    if (q?.landing === "CLEARED" && holder && !q?.groundStop && !q?.slotHold && !q?.landClearance && q?.landVia !== "server") out.push({ key: `land:${pr}`, kind: "land", text: `LAND due for PR ${pr} (holders: ${holders}) — landText is in the brief`, flights: flightsOf(q?.flight), menu: menuOf("land") });
    for (const [field, kind] of [["goAround", "go-around"], ["info", "approach-info"], ["fix", "fix"]] as const) {
      const a = q?.[field]?.action;
      if (a !== "send" && a !== "supervisor") continue;
      // send: 브리핑의 글을 그대로 보낸다(메뉴). supervisor: 받을 세션이 없거나 되풀이 — SUPERVISOR 보고(판단)
      out.push({ key: `${kind}:${pr}:${a}`, kind: a === "send" ? kind : `${kind}-supervisor`, text: `${kind.toUpperCase()} ${a === "send" ? "to send" : "needs a SUPERVISOR report"} for PR ${pr} (holders: ${holders})`, flights: flightsOf(q?.flight), menu: a === "send" && menuOf(kind) });
    }
  }
  for (const r of arr(b.relays)) out.push({ key: `relay:${r?.id}`, kind: "relay", text: `SUPERVISOR RELAY ${r?.id} to ${r?.to ?? "?"} (${r?.type ?? "?"})`, flights: flightsOf(r?.flight), menu: menuOf("relay") });
  const pending = new Map(arr(b.clearances?.pending).map((c) => [String(c?.id), c]));
  for (const id of arr(b.clearances?.overdue).map(String)) {
    const c = pending.get(id);
    const to = c?.to?.name ?? c?.toName ?? "?";
    const second = arr(c?.resentBy).length > 0 || Boolean(c?.resendOf);
    // 첫 침묵은 RESEND(정해진 글, 메뉴). 두 번째 침묵은 "답 없음" 보고(판단)
    out.push(
      second
        ? { key: `second-silence:${id}`, kind: "second-silence", text: `no answer to ${id} → ${to} after a RESEND — report "no answer" (do not resend)`, flights: flightsOf(c?.flight), menu: false }
        : { key: `overdue:${id}`, kind: "overdue", text: `no READBACK for ${id} → ${to} (${c?.type ?? "?"}) — RESEND once`, flights: flightsOf(c?.flight), menu: menuOf("overdue") },
    );
  }
  if (arr(b.open?.conflicts).length && !arr(b.clearances?.pending).length) {
    for (const c of arr(b.open?.conflicts)) out.push({ key: `conflict:${c?.stand}`, kind: "conflict", text: `LOSS OF SEPARATION on STAND ${c?.stand} (${arr(c?.sessions).map((s) => s?.name ?? s).join(", ")})`, flights: [], menu: false });
  }
  for (const k of persistentKeysOf(b)) if (!ctx.seen.has(k)) out.push({ key: k, kind: `new:${k.slice(0, k.indexOf(":"))}`, text: one(`first sighting — ${k}`, 200), flights: [], menu: false });
  return [...out, ...answerEvents(ctx.answers)];
}

function mccEvents(q: J): WakeEvent[] {
  if (!q || typeof q !== "object" || !Array.isArray(q.pulls)) return [{ key: "bad-queue", kind: "outside-menu", text: "the MCC queue could not be read by the server — read `mcc queue` yourself", flights: [], menu: false }];
  const out: WakeEvent[] = [];
  for (const p of arr(q.pulls)) {
    const pr = `#${p?.pr}@${String(p?.head ?? "").slice(0, 7)}`;
    if (p?.landable) out.push({ key: `land:${pr}`, kind: "land", text: `PR ${pr} (${p?.tier ?? "?"}) has no blocks — LAND`, flights: flightsOf(p?.flight), menu: true, graceMs: SERVER_FIRST_MS });
    else if (!p?.inspection && !p?.error) out.push({ key: `inspect:${pr}`, kind: "inspect", text: one(`PR ${pr} needs an INSPECTION: ${p?.title ?? ""}`, 200), flights: flightsOf(p?.flight), menu: false });
  }
  if (q.rts?.due) out.push({ key: `rts:${one(q.rts.why, 80)}`, kind: "rts", text: one(`RTS is due: ${q.rts.why ?? ""}`, 200), flights: [], menu: true, graceMs: SERVER_FIRST_MS });
  return out;
}

function occEvents(i: Inputs, ctx: EventCtx): WakeEvent[] {
  const p = project("occ", i) as J;
  const d = i.dispatch as J;
  const byId = new Map([...arr(d?.open), ...arr(d?.held), ...arr(d?.inFlight)].map((x) => [String(x?.id), x]));
  const fl = (id: string) => flightsOf(byId.get(id)?.flight);
  const who = (id: string) => byId.get(id)?.aircraftName ?? byId.get(id)?.registration ?? "?";
  const out: WakeEvent[] = [];
  for (const id of p.needsNote as string[]) out.push({ key: `note:${id}`, kind: "needs-note", text: `${id} (${fl(id).join(", ") || "?"}) has no note or BRIEFING`, flights: fl(id), menu: false });
  for (const x of p.inFlight as string[]) {
    const [id, status] = x.split(":") as [string, string];
    if (status === "approved") out.push({ key: `send-plan:${id}`, kind: "send-plan", text: `FLIGHT PLAN ${id} → ${who(id)} approved and not sent by the server`, flights: fl(id), menu: true, graceMs: SERVER_FIRST_MS });
    else out.push({ key: `recall:${id}`, kind: "recall", text: `RECALL ${id} → ${who(id)} to send`, flights: fl(id), menu: true });
  }
  for (const id of p.overdue as string[]) {
    const x = byId.get(id);
    if (x?.status === "sent" && x?.sentVia === "server" && !ctx.serverResent?.has(id)) continue; // 서버가 overdue 뒤 한 번 다시 보낸다(ATC-562): 그전에는 서버 몫
    const second = ctx.serverResent?.has(id);
    out.push({ key: `${second ? "second-silence" : "overdue"}:${id}`, kind: second ? "second-silence" : "overdue", text: second ? `no READBACK for ${id} → ${who(id)} after the server's resend — report to the SUPERVISOR` : `${id} → ${who(id)} is overdue (${x?.status ?? "?"})`, flights: fl(id), menu: false });
  }
  for (const c of arr(d?.arrivalCandidates)) out.push({ key: `arrival:${c?.flight}|${c?.aircraft}`, kind: "arrival", text: one(`ARRIVED candidate ${c?.flight} (${c?.aircraft}): ${c?.reason ?? ""}`, 200), flights: flightsOf(c?.flight), menu: false });
  for (const id of p.crewChange.approved as string[]) out.push({ key: `crew-change:${id}`, kind: "crew-change", text: `CREW CHANGE ${id} approved — send`, flights: [], menu: true });
  for (const id of p.crewChange.overdue as string[]) out.push({ key: `crew-change-overdue:${id}`, kind: "crew-change-overdue", text: `CREW CHANGE ${id} has no READBACK`, flights: [], menu: false });
  for (const [kind, list] of Object.entries(p.schedule.candidates as Record<string, string[]>)) for (const x of list) out.push({ key: `candidate:${kind}:${x}`, kind: `schedule-${kind}`, text: `SCHEDULE ${kind.toUpperCase()} candidate ${x}`, flights: flightsOf(...x.split("+")), menu: false });
  for (const g of p.schedule.waypointGaps as string[]) out.push({ key: `waypoint-gap:${g.split("|")[0]}`, kind: "waypoint-gap", text: `WAYPOINT gap on ROUTE ${g.split("|")[0]}`, flights: [], menu: false });
  for (const k of p.schedule.slips as string[]) out.push({ key: `slip:${k}`, kind: "slip", text: `WAYPOINT slip ${k}`, flights: [], menu: false });
  for (const r of p.schedule.routesWithoutWaypoints as string[]) out.push({ key: `route:${r}`, kind: "route-without-waypoints", text: `ROUTE ${r} has no WAYPOINT`, flights: [], menu: false });
  for (const x of p.schedule.inProgress as string[]) out.push({ key: `schedule-release:${x}`, kind: "schedule-release", text: `SCHEDULE ${x} — release it`, flights: [], menu: true });
  for (const k of p.following as string[]) out.push({ key: `following:${k}`, kind: "following", text: one(`FLIGHT FOLLOWING ${k}`, 200), flights: flightsOf(k.split("|").find((s) => /^[A-Z]+-\d+$/.test(s))), menu: false });
  for (const c of arr((i.schedule as J)?.duty?.charters)) out.push({ key: `charter:${c?.id ?? one(c?.text, 40)}`, kind: "charter-request", text: one(`DUTY CHARTER REQUEST ${c?.id ?? ""}: ${c?.text ?? ""}`, 200), flights: [], menu: false });
  for (const k of occKeysOf(i, ctx.now)) {
    if (ctx.seen.has(k)) continue;
    const kind = k.slice(0, k.indexOf(":"));
    out.push({ key: k, kind: `new:${kind}`, text: one(`first sighting — ${k}`, 200), flights: kind === "arrival-missing" ? flightsOf(k.slice(k.indexOf(":") + 1)) : [], menu: false, ...(kind === "target-route" ? { graceMs: DAILY_GRACE_MS } : {}) });
  }
  return [...out, ...answerEvents(ctx.answers)];
}

// 그 역할의 판단할 일(사건)들. 읽지 못하면 "메뉴 밖" 하나(깨워서 세션이 직접 읽게 한다 — 조용하다고 잘못 말하지 않는다)
export function wakeEventsOf(role: WakeRole, inputs: Inputs, ctx: EventCtx): WakeEvent[] {
  try {
    const list = role === "tower" ? towerEvents(inputs.brief, ctx) : role === "mcc" ? mccEvents(inputs.queue) : occEvents(inputs, ctx);
    const seen = new Set<string>();
    return list.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  } catch (e) {
    return [{ key: "error", kind: "outside-menu", text: one(`the server could not list events (${e instanceof Error ? e.message : String(e)}) — read the brief yourself`, 200), flights: [], menu: false }];
  }
}

// TOWER: 할 일은 없고 ATC LOG에만 적는 사건(handoff, away.*)만 있다 — 서버가 cursor를 ack한다(QUIET tick이 하던 일). 쌓이면 CONTROL RECYCLE을 막는다(TOWER_EVENTS_MAX)
export const infoOnlyAckOf = (b: J): string | null => {
  const ev = arr(b?.events);
  if (!ev.length || b?.reset === true || b?.cursor === undefined || b?.cursor === null) return null;
  return ev.every((e) => INFO_ONLY_EVENTS.has(String(e?.kind))) ? String(b.cursor) : null;
};

// ── 깨울지(순수) ──
export interface OpenItem {
  first: string; // 처음 본 때
  woke?: string; // 이 항목을 실은 깨움이 닿은 때
  wakeId?: string;
  reminded?: true; // "아직 열림"으로 한 번 더 실었다
  missed?: true; // 오작동(깨우지 못함)으로 센 것
  kind: string;
  text: string;
  flights: string[];
  menu: boolean;
}
export interface RoleState {
  open: Record<string, OpenItem>;
  resolved: string[]; // 지난 깨움 뒤에 풀린, 깨웠던 항목(다음 깨움의 delta)
  lastWakeAt?: string;
  lastWakeId?: string;
  lastFailAt?: string;
}
export const emptyRoleState = (): RoleState => ({ open: {}, resolved: [] });

export const SETTLE_MS = 20_000; // 한꺼번에 생긴 일을 한 깨움에 싣는다(다음 패스)
export const MIN_GAP_MS = 60_000; // 같은 역할을 이보다 자주 깨우지 않는다
export const REMIND_MS = 30 * 60_000; // 깨웠는데 이만큼 열린 채면 한 번 더 싣는다(한 번만)
export const MISS_MS = 15 * 60_000; // 판단할 일이 이만큼 열렸는데 어느 깨움에도 실리지 않았으면 오작동(깨우지 못함)
export const RETRY_MS = 60_000; // 보내지 못한 뒤 다시 시도까지

export interface WakePlan {
  fresh: WakeEvent[];
  still: WakeEvent[];
  resolved: string[];
}
export interface PlanResult {
  next: RoleState; // 깨우지 않았을 때의 다음 상태(깨우면 delivered()로 더 고친다)
  wake: WakePlan | null;
  missed: (WakeEvent & { first: string })[]; // 이번에 처음 오작동으로 센 것
}

// busy: 앞 깨움이 아직 끝나지 않았다(결과 줄이 없다). 그동안 생긴 일은 앞 깨움의 브리핑에 보이고, 남으면 다음 깨움에 실린다
export function planWake(prev: RoleState, events: readonly WakeEvent[], o: { now: number; busy: boolean; canSend: boolean }): PlanResult {
  const iso = new Date(o.now).toISOString();
  const open: Record<string, OpenItem> = {};
  const resolved = [...prev.resolved];
  const nowKeys = new Set(events.map((e) => e.key));
  for (const [k, v] of Object.entries(prev.open)) if (!nowKeys.has(k) && v.woke && !resolved.includes(k)) resolved.push(k);
  for (const e of events) {
    const was = prev.open[e.key];
    open[e.key] = { ...(was ?? {}), first: was?.first ?? iso, kind: e.kind, text: e.text, flights: e.flights, menu: e.menu };
  }
  const missed: PlanResult["missed"] = [];
  for (const e of events) {
    const it = open[e.key]!;
    if (!it.woke && !it.missed && o.now - Date.parse(it.first) >= MISS_MS + (e.graceMs ?? 0)) {
      it.missed = true;
      missed.push({ ...e, first: it.first });
    }
  }
  const next: RoleState = { ...prev, open, resolved: resolved.slice(-50) };
  const ready = (e: WakeEvent) => o.now - Date.parse(open[e.key]!.first) >= Math.max(SETTLE_MS, e.graceMs ?? 0);
  const fresh = events.filter((e) => !open[e.key]!.woke && ready(e));
  const still = events.filter((e) => open[e.key]!.woke && !open[e.key]!.reminded && o.now - Date.parse(open[e.key]!.woke!) >= REMIND_MS);
  const gapOk = !prev.lastWakeAt || o.now - Date.parse(prev.lastWakeAt) >= MIN_GAP_MS;
  const retryOk = !prev.lastFailAt || o.now - Date.parse(prev.lastFailAt) >= RETRY_MS;
  if (!o.canSend || o.busy || !gapOk || !retryOk || (!fresh.length && !still.length)) return { next, wake: null, missed };
  return { next, wake: { fresh, still, resolved: next.resolved }, missed };
}

// 깨움이 닿았다: 실은 항목에 시각을 적고 풀린 목록을 비운다
export function delivered(st: RoleState, plan: WakePlan, wakeId: string, now: number): RoleState {
  const iso = new Date(now).toISOString();
  const open = { ...st.open };
  for (const e of plan.fresh) if (open[e.key]) open[e.key] = { ...open[e.key]!, woke: iso, wakeId };
  for (const e of plan.still) if (open[e.key]) open[e.key] = { ...open[e.key]!, reminded: true, wakeId };
  return { ...st, open, resolved: [], lastWakeAt: iso, lastWakeId: wakeId, lastFailAt: undefined };
}

// 깨움 하나가 모두 메뉴 일인가(오작동 "서버가 할 수 있었던 일로 깨움")
export const allMenu = (plan: WakePlan) => plan.fresh.length + plan.still.length > 0 && [...plan.fresh, ...plan.still].every((e) => e.menu);

// ── 글(영어, 세션이 읽는다) ──
export const WAKE_HEAD = /^\[ATC WAKE (W-\d{4,})\] (TOWER|OCC|MCC)\n/;
export const RESULT_LINE = /WAKE RESULT:\s*(acted|nothing)\b/;
const MAX_LINES = 15;
export const WAKE_TEXT_MAX = 8000;
export const wakeIdOf = (n: number) => `W-${String(n).padStart(4, "0")}`;

export interface FlightFact {
  flight: string;
  facts: string[];
}
// 관련 FLIGHT의 사실 줄(브리핑에서, 세션이 다른 FLIGHT와의 관계를 잃지 않게 — 오래 사는 세션의 기억 대신)
export function openFlightsOf(role: WakeRole, inputs: Inputs, flights: readonly string[]): FlightFact[] {
  const want = new Set(flights);
  const out = new Map<string, string[]>();
  const add = (f: unknown, s: string) => {
    if (typeof f !== "string" || !want.has(f)) return;
    out.set(f, [...(out.get(f) ?? []), one(s, 140)]);
  };
  try {
    if (role === "tower") {
      const b = inputs.brief as J;
      for (const q of arr(b?.landingQueue)) add(q?.flight, `PR ${q?.airport ?? ""} #${q?.pr?.number ?? "?"} ${q?.landing ?? ""} · holders ${arr(q?.holders).map((h) => h?.name ?? h).join(", ") || "none"}`);
      for (const c of arr(b?.clearances?.pending)) add(c?.flight, `CLEARANCE ${c?.id} ${c?.type ?? ""} → ${c?.to?.name ?? "?"} pending ${c?.ageMin ?? "?"} min`);
    } else if (role === "mcc") {
      for (const p of arr((inputs.queue as J)?.pulls)) add(p?.flight, `PR #${p?.pr} ${p?.tier ?? ""} · ${p?.inspection ? `INSPECTION ${p.inspection.verdict}` : "no INSPECTION"} · ${arr(p?.blocks).length} blocks`);
    } else {
      const d = inputs.dispatch as J;
      for (const x of [...arr(d?.inFlight), ...arr(d?.open), ...arr(d?.held)]) add(x?.flight, `${x?.id} ${x?.kind ?? ""} ${x?.status ?? ""} → ${x?.aircraftName ?? "?"}`);
    }
  } catch {}
  return [...want].sort().map((f) => ({ flight: f, facts: (out.get(f) ?? ["(no other open item in the brief)"]).slice(0, 4) }));
}

export function wakePromptOf(x: { role: WakeRole; wakeId: string; plan: WakePlan; lastWakeId: string | null; lastWakeAt: string | null; flights: readonly FlightFact[]; now: number }): string {
  const L: string[] = [`[ATC WAKE ${x.wakeId}] ${ROLE_NAME[x.role]}`];
  const ago = x.lastWakeAt ? `${Math.max(0, Math.round((x.now - Date.parse(x.lastWakeAt)) / 60_000))} min ago` : null;
  L.push(`Event wake (ATC-557): atc wakes this session only when something needs a decision; there is no /loop. Delta since ${x.lastWakeId ? `your last wake ${x.lastWakeId} (${ago})` : "this session started"}:`);
  const list = (head: string, es: readonly WakeEvent[]) => {
    if (!es.length) return;
    L.push(head);
    for (const e of es.slice(0, MAX_LINES)) L.push(`- ${e.kind}: ${e.text}`);
    if (es.length > MAX_LINES) L.push(`- … and ${es.length - MAX_LINES} more (all are in the brief)`);
  };
  list("New:", x.plan.fresh);
  list("Still open from an earlier wake (reminder, sent once):", x.plan.still);
  if (x.plan.resolved.length) L.push(`Resolved since then: ${one(x.plan.resolved.slice(0, 20).join(", "), 600)}`);
  if (x.flights.length) {
    L.push("Open FLIGHTs these bear on:");
    for (const f of x.flights.slice(0, 10)) L.push(`- ${f.flight}: ${f.facts.join(" · ")}`);
  }
  L.push(
    "Do this:",
    `1. Run \`${ATCCTL_OF[x.role]} tick ${x.role} --wake ${x.wakeId}\` and work from its output exactly as your /tick skill says (from step 1). Team replies that reached you are in this conversation; record them as usual.`,
    "2. Do not reply to this message: it comes from the atc server, not from a session.",
    "3. End your reply with one line: `WAKE RESULT: acted` if you issued, recorded, sent or reported anything, or `WAKE RESULT: nothing` if there was nothing to do. Then end your turn.",
  );
  const text = L.join("\n");
  return text.length > WAKE_TEXT_MAX ? `${text.slice(0, WAKE_TEXT_MAX - 200)}\n…(cut)\n${L.slice(-4).join("\n")}` : text;
}

// LAUNCH할 때의 첫 프롬프트(깨움 모드): `/loop` 없이 한 번 둘러보고 쉰다. 새 세션이 지난 일을 브리핑에서 이어받는다(docs/control-recycle.md 2.3)
export const WAKE_BOOT_ID = "boot";
export function wakeLaunchPromptOf(role: WakeRole): string {
  return [
    `[ATC WAKE BOOT] ${ROLE_NAME[role]}`,
    "Event wakes are on (ATC-557): there is no /loop. atc wakes this session with [ATC WAKE W-xxxx] messages when something needs a decision; team replies still reach you by name.",
    `Do one pass now: run \`${ATCCTL_OF[role]} tick ${role} --wake ${WAKE_BOOT_ID}\` and follow your /tick skill on its output (a fresh session reads the brief as-is and does not assume earlier LOG lines).`,
    "End your reply with `WAKE RESULT: acted` or `WAKE RESULT: nothing`, then end your turn.",
  ].join("\n");
}
export const isWakeLaunchPrompt = (p: unknown) => typeof p === "string" && p.startsWith("[ATC WAKE BOOT]");

// ── 대화 기록에서 결과 줄 ──
// msgId가 든 줄(깨운 글) 뒤의 assistant 줄에서 WAKE RESULT를 찾는다. 깨운 글 자신(사용자 줄)에도 그 말이 있으니 assistant 줄만 본다.
// 다음 깨움(다른 msgId의 사용자 줄)이 오면 거기서 멈춘다
export function wakeResultOf(tail: string, msgId: string): "acted" | "nothing" | null {
  const lines = tail.split("\n");
  const start = lines.findIndex((l) => l.includes(msgId));
  if (start < 0) return null;
  for (const l of lines.slice(start + 1)) {
    if (l.includes("[ATC WAKE W-")) {
      let j: J;
      try {
        j = JSON.parse(l);
      } catch {
        continue;
      }
      if (j?.type === "user") break;
    }
    if (!l.includes('"assistant"') || !l.includes("WAKE RESULT")) continue;
    let j: J;
    try {
      j = JSON.parse(l);
    } catch {
      continue;
    }
    if (j?.type !== "assistant" || j?.isSidechain === true) continue;
    const content = j?.message?.content;
    const text = typeof content === "string" ? content : arr(content).map((c) => (c?.type === "text" ? String(c.text ?? "") : "")).join("\n");
    const m = RESULT_LINE.exec(text);
    if (m) return m[1] as "acted" | "nothing";
  }
  return null;
}

// ── FLIGHT RECORDER 줄과 SUPERVISOR 화면의 수 ──
type Line = { t: string; kind: string; op?: string } & Record<string, unknown>;
export interface WakeCounts {
  wakes: number; // 닿은 깨움
  menu: number; // 오작동: 모두 서버가 할 수 있었던 일
  nothing: number; // 오작동: 깨웠는데 할 일이 없었다(WAKE RESULT: nothing)
  missed: number; // 오작동: 판단할 일이 깨움 없이 15분
  acted: number;
  unknown: number; // 결과 줄을 찾지 못함
  failed: number;
  refused: number;
  unseen: number;
  trips: number;
  transitions: number; // /loop ↔ wake로 다시 띄운 수
  fallbacks: number; // 깨움 BREAKER가 멈춰 loop로 돌린 수(fail safe)
  returns: number; // BREAKER가 다시 켜져 wake로 돌아간 수
}
const blankCounts = (): WakeCounts => ({ wakes: 0, menu: 0, nothing: 0, missed: 0, acted: 0, unknown: 0, failed: 0, refused: 0, unseen: 0, trips: 0, transitions: 0, fallbacks: 0, returns: 0 });
export function wakeCountsOf(lines: readonly Line[], now: number, days = 7): { days: number; total: WakeCounts; roles: Record<WakeRole, WakeCounts> } {
  const since = now - days * 86_400_000;
  const roles = { tower: blankCounts(), occ: blankCounts(), mcc: blankCounts() } as Record<WakeRole, WakeCounts>;
  const total = blankCounts();
  for (const l of lines) {
    if (l.kind !== "control-wake" || Date.parse(l.t) < since) continue;
    const r = typeof l.role === "string" && isWakeRole(l.role) ? roles[l.role] : null;
    const bump = (k: keyof WakeCounts) => {
      total[k]++;
      if (r) r[k]++;
    };
    if (l.op === "deliver") {
      bump("wakes");
      if (l.menu === true) bump("menu");
    } else if (l.op === "result") bump(l.result === "acted" ? "acted" : l.result === "nothing" ? "nothing" : "unknown");
    else if (l.op === "missed") bump("missed");
    else if (l.op === "failed") bump("failed");
    else if (l.op === "refused") bump("refused");
    else if (l.op === "confirm" && l.seen === false && l.why !== "gone") bump("unseen");
    else if (l.op === "breaker" && l.event === "trip") bump("trips");
    else if (l.op === "transition" && l.ok === true) bump("transitions");
    else if (l.op === "fallback") bump(l.to === "loop" ? "fallbacks" : "returns");
  }
  return { days, total, roles };
}

// ── /loop ↔ wake 옮기기(순수) ──
// 지금 떠 있는 세션이 어떤 첫 프롬프트로 떴나(FLIGHT RECORDER control launch 줄의 wake). 모르면(기록 없음, ATC-557 전 LAUNCH) loop로 본다
export function launchedModeOf(lines: readonly Line[], jobId: string): WakeMode {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.kind === "control" && l.op === "launch" && l.jobId === jobId) return l.wake === true ? "wake" : "loop";
  }
  return "loop";
}
export const TRANSITION_COOLDOWN_MS = 3 * 3_600_000; // CONTROL RECYCLE cooldown과 같다
export const TRANSITION_UPTIME_MS = 5 * 60_000; // 서버가 뜬 직후(RTS가 세션 수를 세는 2분)에는 하지 않는다
// urgent: 깨움 BREAKER가 멈춰 /loop로 돌리는 것(fail safe). 업타임을 기다리지 않고 cooldown은 10분이다(실패하면 10분 뒤 다시). 안전 조건은 그대로
export const FALLBACK_RETRY_MS = 10 * 60_000;
export function transitionWhy(x: { want: WakeMode; launched: WakeMode; single: boolean; idle: boolean; blocks: readonly string[]; auto: boolean; recycleOff?: boolean; urgent?: boolean; lastTryAt: number | null; uptimeMs: number; now: number; recycling: string | null }): { go: true } | { go: false; why: string } {
  if (x.want === x.launched) return { go: false, why: "같은 모드" };
  if (!x.single) return { go: false, why: "claude --bg 세션 하나가 아님" };
  if (x.recycleOff) return { go: false, why: "CONTROL RECYCLE mode off — 자동으로 다시 띄우지 않는다(세션은 깨움을 받는다)" };
  if (!x.auto) return { go: false, why: "CONTROL RECYCLE auto가 꺼짐 — 다시 띄우지 않는다(세션은 깨움을 받는다)" };
  if (!x.urgent && x.uptimeMs < TRANSITION_UPTIME_MS) return { go: false, why: "서버가 뜬 지 5분이 안 됨" };
  if (x.lastTryAt !== null && x.now - x.lastTryAt < (x.urgent ? FALLBACK_RETRY_MS : TRANSITION_COOLDOWN_MS)) return { go: false, why: x.urgent ? "10분 안에 시도함" : "3시간 안에 시도함" };
  if (x.recycling) return { go: false, why: `${x.recycling}가 재시작 중` };
  if (!x.idle) return { go: false, why: "턴 사이가 아님" };
  if (x.blocks.length) return { go: false, why: x.blocks.join("; ") };
  return { go: true };
}

// FLIGHT RECORDER 줄(kind control-wake). 깨움마다 그 입력(사건 key·종류·메뉴, delta, FLIGHT)과 글 전체를 남긴다(docs/autonomy.md 원칙 7)
type R = "tower" | "occ" | "mcc";
export type ControlWakeLine =
  | { t: string; kind: "control-wake"; op: "deliver"; id: string; role: R; sessionId: string; session: string; pid: number; msgId: string; transcript: string | null; textHash: string; text: string; check: "pass"; menu: boolean; events: { key: string; kind: string; menu: boolean }[]; fresh: string[]; still: string[]; resolved: string[]; flights: string[] }
  | { t: string; kind: "control-wake"; op: "failed"; id: string; role: R; sessionId: string | null; stage: string; why: string }
  | { t: string; kind: "control-wake"; op: "refused"; id: string; role: R; sessionId: string | null; check: string }
  | { t: string; kind: "control-wake"; op: "confirm"; id: string; role: R; msgId: string; sessionId: string; seen: boolean; why?: "idle" | "timeout" | "gone" }
  | { t: string; kind: "control-wake"; op: "result"; id: string; role: R; msgId: string; result: "acted" | "nothing" | "unknown"; why?: string }
  | { t: string; kind: "control-wake"; op: "missed"; role: R; key: string; event: string; first: string; menu: boolean }
  | { t: string; kind: "control-wake"; op: "pickup"; role: R; id: string }
  | { t: string; kind: "control-wake"; op: "breaker"; role: R; event: "trip" | "rearm"; id: string; why: string | null }
  | { t: string; kind: "control-wake"; op: "transition"; role: R; from: WakeMode; to: WakeMode; ok: boolean; result: string; jobId?: string; error?: string; cause?: "breaker" }
  | { t: string; kind: "control-wake"; op: "fallback"; role: R; to: WakeMode; why: string | null }
  | { t: string; kind: "control-wake"; op: "ack"; role: "tower"; cursor: string };
