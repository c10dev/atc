import type { ServerClearancePurpose } from "./send-checks.ts";
import { type BreakerState, RETRY_AFTER_MS, SERVER_LIVE_MS } from "./server-send.ts";

// SERVER CLEARANCE(ATC-557 b): TOWER가 브리핑의 글을 고치지 않고 옮기기만 하던 CLEARANCE를 서버가 짓고 보낸다. 순수 함수만(입출력은 server-clearance-run.ts).
// 대상: CLEARED PR의 LAND(landText), APPROACH INFO·GO AROUND·FIX(action send의 text), 첫 RESEND(답 없이 10분, "RESEND " + 원래 글), SUPERVISOR RELAY(relays[]의 글).
// 기록은 TOWER의 `atcctl issue`와 같은 길(POST /api/clearances)이고, 글은 그 응답의 message(formatClearance)다. 보내는 것은 send-checks.ts의 검사를 거쳐 session-socket.ts뿐이다.
// 종류마다 스위치(server-clearance.json, 기본 on). 끄면 그 종류는 TOWER가 오늘처럼 한다. 판단(supervisor 항목, 두 번째 침묵, 메뉴 밖 일)은 늘 TOWER다.

export const SERVER_CLEARANCE_KINDS = ["info", "goAround", "fix", "land", "resend", "relay"] as const satisfies readonly ServerClearancePurpose[];
export type ServerClearanceKind = (typeof SERVER_CLEARANCE_KINDS)[number];
export const KIND_LABEL: Record<ServerClearanceKind, string> = { info: "INFO", goAround: "GO AROUND", fix: "FIX", land: "LAND", resend: "RESEND", relay: "RELAY" };
export type OnOff = "on" | "off";
export type ServerClearanceSwitch = Record<ServerClearanceKind, OnOff>;

// 꺼지는 것은 정확히 "off"뿐(읽을 수 없는 값은 기본 on, SERVER SEND와 같다)
export function parseServerClearanceSwitch(raw: unknown): ServerClearanceSwitch {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(SERVER_CLEARANCE_KINDS.map((k) => [k, o[k] === "off" ? "off" : "on"])) as ServerClearanceSwitch;
}

// CONTROL WAKE(ATC-557 a)의 TOWER 사건 종류 → 서버가 맡는 종류. 스위치가 on인 종류의 사건만 "메뉴"(서버가 할 수 있던 일)로 센다
export const KIND_OF_WAKE_EVENT: Record<string, ServerClearanceKind> = { land: "land", "approach-info": "info", "go-around": "goAround", fix: "fix", relay: "relay", overdue: "resend" };

// 항목의 이름(브리핑의 표시, 넘김, 기록이 같은 이름을 쓴다). PR 항목은 AIRPORT·번호·head, relay는 R-id, RESEND는 원래 C-id
export const prRefOf = (airport: unknown, pr: unknown, head: unknown) => `${airport ?? ""}#${pr ?? "?"}@${String(head ?? "").slice(0, 7)}`;
export const itemKeyOf = (kind: ServerClearanceKind, ref: string) => `${kind}:${ref}`;

// ── 누가 보내나(브리핑이 묻는다) ──
export interface OwnerFacts {
  sw: ServerClearanceSwitch;
  live: boolean; // 서버 job이 3분 안에 돌았다(막 떴으면 3분까지 돈 것으로 본다)
  breaker: BreakerState;
  writable: (sessionId: string) => boolean; // 서버가 쓸 수 있는 세션: background, 확인한 세션 파일·소켓, 이 프로세스가 쓸 수 있는 곳
  handedBack: ReadonlySet<string>; // 서버가 TOWER에게 넘긴 항목(두 번 닿지 않음·검사가 막음)
}
// 서버가 이 항목을 맡나. 맡지 않으면 사유(TOWER가 오늘처럼 한다). 받는 이가 없으면 맡지 않는다(SUPERVISOR 보고는 TOWER 몫)
export function ownsWhy(f: OwnerFacts, kind: ServerClearanceKind, key: string, recipients: readonly string[]): string | null {
  if (f.sw[kind] !== "on") return `SERVER CLEARANCE ${KIND_LABEL[kind]} off`;
  if (!f.live) return "서버 job이 3분 넘게 돌지 않음";
  if (f.breaker !== "armed" && f.breaker !== "probe") return `BREAKER ${f.breaker}`;
  if (f.handedBack.has(key)) return "서버가 TOWER에게 넘김";
  if (!recipients.length) return "받는 세션 없음";
  const bad = recipients.find((id) => !f.writable(id));
  return bad ? `서버가 쓸 수 없는 세션(${bad.slice(0, 8)}) — background가 아니거나 세션 파일·소켓을 확인하지 못함` : null;
}
export type Owns = (kind: ServerClearanceKind, key: string, recipients: readonly string[]) => boolean;
export const serverLiveOrBooting = (lastPassAt: number | null, startedAt: number, now: number) => (lastPassAt === null ? now - startedAt <= SERVER_LIVE_MS : now - lastPassAt >= 0 && now - lastPassAt <= SERVER_LIVE_MS);

// ── 브리핑에서 보낼 것(순수) ──
type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const arr = (x: J): J[] => (Array.isArray(x) ? x : []);
export interface ServerItem {
  kind: ServerClearanceKind;
  key: string;
  type: string; // CLEARANCE 종류
  to: string; // 받는 세션 id
  toName: string;
  stand: string | null; // --stand(브리핑의 STAND 이름 또는 경로)
  flight: string | null; // --flight
  source: string; // 브리핑·relay의 글(RESEND면 원래 CLEARANCE의 글)
  relay?: string; // R-xxxx
  resendOf?: string; // C-xxxx
}
// 브리핑(buildBrief)이 서버 몫으로 표시한 것만 고른다: landVia server, info·goAround·fix action server, serverSends.relays, serverSends.resend
// RESEND의 원래 글·STAND 경로는 기록에서 찾는다(byId). 받는 세션이 끝났으면(dead) 보내지 않는다
export function serverItemsOf(b: J, byId: (id: string) => { to: string; toName: string; type: string; stand: string | null; flight: string | null; text: string } | null): ServerItem[] {
  const out: ServerItem[] = [];
  const liveHolders = (q: J) => arr(q?.holders).filter((h) => h && h.status !== "dead" && typeof h.id === "string");
  for (const q of arr(b?.landingQueue)) {
    const ref = prRefOf(q?.airport, q?.pr?.number, q?.pr?.head);
    const base = { stand: typeof q?.stand === "string" ? q.stand : null, flight: typeof q?.key === "string" ? q.key : null };
    const add = (kind: ServerClearanceKind, type: string, text: unknown) => {
      if (typeof text !== "string" || !text.trim()) return;
      for (const h of liveHolders(q)) out.push({ kind, key: itemKeyOf(kind, ref), type, to: h.id, toName: String(h.name ?? ""), ...base, source: text });
    };
    // TOWER의 순서와 같다: GO AROUND·FIX(행동 지시)가 INFO보다 먼저, LAND는 CLEARED PR에만
    if (q?.landVia === "server") add("land", "LAND", q?.landText);
    if (q?.goAround?.action === "server") add("goAround", "GO AROUND", q.goAround.text);
    if (q?.fix?.action === "server") add("fix", "FIX", q.fix.text);
    if (q?.info?.action === "server") add("info", "INFO", q.info.text);
  }
  for (const r of arr(b?.serverSends?.relays)) {
    if (typeof r?.sendToId !== "string" || typeof r?.text !== "string") continue;
    out.push({ kind: "relay", key: itemKeyOf("relay", String(r.id)), type: String(r.type), to: r.sendToId, toName: String(r.sendTo ?? r.to ?? ""), stand: typeof r.stand === "string" ? r.stand : null, flight: typeof r.flight === "string" ? r.flight : null, source: r.text, relay: String(r.id) });
  }
  for (const id of arr(b?.serverSends?.resend).map(String)) {
    const c = byId(id);
    if (!c) continue;
    out.push({ kind: "resend", key: itemKeyOf("resend", id), type: c.type, to: c.to, toName: c.toName, stand: c.stand, flight: c.flight, source: c.text, resendOf: id });
  }
  return out;
}

// 한 바퀴에 한 세션에 보낼 수(TOWER 매뉴얼: 한 팀에 한 번에 둘까지). 나머지는 다음 바퀴
export const PER_SESSION_PER_PASS = 2;
export function capPerSession<T extends { to: string }>(items: readonly T[], max = PER_SESSION_PER_PASS): T[] {
  const n = new Map<string, number>();
  return items.filter((i) => {
    const k = (n.get(i.to) ?? 0) + 1;
    n.set(i.to, k);
    return k <= max;
  });
}

// ── FLIGHT RECORDER 줄(kind server-clearance) ──
type K = ServerClearanceKind;
export type ServerClearanceLine =
  | { t: string; kind: "server-clearance"; op: "issue"; id: string; type: K; clearanceType: string; key: string; sessionId: string; session: string; relay?: string; resendOf?: string; message: string; source: string } // message: 보낼 글(재시도가 쓴다), source: 출처 글(검사가 본다)
  | { t: string; kind: "server-clearance"; op: "deliver"; id: string; type: K; key: string; attempt: "first" | "retry"; sessionId: string; session: string; pid: number; msgId: string; transcript: string | null; textHash: string; bodyHash: string; check: "pass"; wrong: string[] }
  | { t: string; kind: "server-clearance"; op: "refused"; id: string | null; type: K; key: string; sessionId: string | null; stage: "issue" | "check"; check: string }
  | { t: string; kind: "server-clearance"; op: "failed"; id: string; type: K; key: string; sessionId: string; attempt: number; stage: string; why: string }
  | { t: string; kind: "server-clearance"; op: "confirm"; id: string; type: K; msgId: string; sessionId: string; seen: boolean; why?: "idle" | "timeout" | "gone" }
  | { t: string; kind: "server-clearance"; op: "handback"; id: string | null; type: K; key: string; why: string }
  | { t: string; kind: "server-clearance"; op: "breaker"; event: "trip" | "rearm"; id: string; why: string | null };
type Line = { t: string; kind: string; op?: string } & Record<string, unknown>;
const mine = (lines: readonly Line[]) => lines.filter((l) => l.kind === "server-clearance") as unknown as ServerClearanceLine[];

// 넘긴 항목(이 key는 TOWER 몫)
export const handedBackOf = (lines: readonly Line[]) => new Set(mine(lines).flatMap((l) => (l.op === "handback" ? [l.key] : [])));
// 그 CLEARANCE를 서버가 보낸 기록(검사의 "두 번 보내지 않음")
export const priorClearanceDeliveriesOf = (lines: readonly Line[], id: string) => mine(lines).flatMap((l) => (l.op === "deliver" && l.id === id ? [{ at: l.t, sessionId: l.sessionId }] : []));
// 서버가 보낸(deliver) CLEARANCE id
export const deliveredIdsOf = (lines: readonly Line[]) => new Set(mine(lines).flatMap((l) => (l.op === "deliver" ? [l.id] : [])));

// 다시 보낼 것과 넘길 것(순수). 서버가 적고(issue) 쓰지 못한 CLEARANCE:
//   failed가 하나이고 1분이 지났고 아직 열려 있다 → retry · failed가 둘 → undeliverable(손으로 전하는 카드) + TOWER에게 넘김
//   issue 뒤 deliver·failed·refused가 없이 1분(서버가 그 사이에 멈춤) → undeliverable + 넘김(10분 뒤 RESEND가 보내지 않은 글을 다시 보내지 않게)
export interface PendingWork {
  retry: (ServerClearanceLine & { op: "issue" })[];
  giveUp: { issue: ServerClearanceLine & { op: "issue" }; why: string; stage: string }[];
}
export const CRASH_AFTER_MS = 60_000;
export const MAX_ATTEMPTS = 2;
export function pendingWorkOf(lines: readonly Line[], open: (id: string) => boolean, now: number): PendingWork {
  const all = mine(lines);
  const out: PendingWork = { retry: [], giveUp: [] };
  for (const is of all) {
    if (is.op !== "issue" || !open(is.id)) continue;
    const after = all.filter((l) => "id" in l && l.id === is.id && l.op !== "issue" && l.op !== "confirm");
    if (after.some((l) => l.op === "deliver" || l.op === "refused" || l.op === "handback")) continue;
    const fails = after.filter((l): l is ServerClearanceLine & { op: "failed" } => l.op === "failed");
    if (!fails.length) {
      if (now - Date.parse(is.t) >= CRASH_AFTER_MS) out.giveUp.push({ issue: is, why: "server stopped between recording the CLEARANCE and writing it", stage: "crash" });
      continue;
    }
    if (fails.length >= MAX_ATTEMPTS) out.giveUp.push({ issue: is, why: fails.at(-1)!.why, stage: fails.at(-1)!.stage });
    else if (now - Date.parse(fails.at(-1)!.t) >= RETRY_AFTER_MS) out.retry.push(is);
  }
  return out;
}

// 쓴 뒤 다시 읽은 사실 → 잘못 보낸 사유(sent wrongly, 기대 0). 검사와 따로: 쓴 뒤 세션 파일과 기록을 다시 읽어 비교한다
export function clearanceWrongOf(x: { sessionName: string | null; stored: { to: string; toName: string; type: string; text: string; open: boolean } | null; sentSessionId: string; sentText: string; id: string }): string[] {
  const out: string[] = [];
  const s = x.stored;
  if (!s) return [`${x.id}가 기록에 없음`];
  if (s.to !== x.sentSessionId) out.push(`받은 세션이 ${x.id}의 받는 이가 아님`);
  if (!x.sessionName || x.sessionName !== s.toName) out.push(`받은 세션 이름(${x.sessionName ?? "없음"})이 ${s.toName}이 아님`);
  if (!x.sentText.startsWith(`[ATC ${x.id}] `) || !x.sentText.split("\n")[0]!.endsWith(` · ${s.type}`)) out.push("머리가 기록의 id·종류와 다름");
  if (!x.sentText.includes(`\n${s.text}\n`)) out.push("보낸 글의 본문이 기록과 다름");
  if (!x.sentText.includes('session name "TOWER"')) out.push("TOWER 이름으로 답하라는 줄이 없음");
  return out;
}

// 두 번 보냄(sent twice): 같은 세션에 같은 종류·같은 본문이 하루 안에 두 번 이상 간 것(같은 CLEARANCE를 두 번 쓴 것 포함). RESEND는 본문이 달라 세지 않는다
export function clearanceTwiceOf(ds: readonly { t: string; id: string; sessionId: string; type: K; bodyHash: string }[]): { t: string; id: string; type: K }[] {
  const out: { t: string; id: string; type: K }[] = [];
  const last = new Map<string, number>();
  for (const d of [...ds].sort((a, b) => a.t.localeCompare(b.t))) {
    const k = `${d.sessionId}|${d.type}|${d.bodyHash}`;
    const prev = last.get(k);
    if (prev !== undefined && Date.parse(d.t) - prev < 86_400_000) out.push({ t: d.t, id: d.id, type: d.type });
    last.set(k, Date.parse(d.t));
  }
  return out;
}

// SUPERVISOR 화면의 수: 종류마다 7일 보냄·잘못 보냄·두 번 보냄·검사가 막음·실패·안 보임·넘김. 0도 보인다
export interface ClearanceCounts {
  delivered: number;
  wrong: number;
  twice: number;
  refused: number;
  failed: number;
  unseen: number;
  handback: number;
}
const blank = (): ClearanceCounts => ({ delivered: 0, wrong: 0, twice: 0, refused: 0, failed: 0, unseen: 0, handback: 0 });
export function serverClearanceCountsOf(lines: readonly Line[], now: number, days = 7) {
  const since = now - days * 86_400_000;
  const kinds = Object.fromEntries(SERVER_CLEARANCE_KINDS.map((k) => [k, blank()])) as Record<K, ClearanceCounts>;
  const total = blank();
  const reasons = new Map<string, number>();
  let trips = 0;
  let rearms = 0;
  const all = mine(lines);
  const typeOfMsg = new Map(all.flatMap((l) => (l.op === "deliver" ? [[l.msgId, l.type] as const] : [])));
  const bump = (k: K | undefined, f: keyof ClearanceCounts) => {
    total[f]++;
    if (k && kinds[k]) kinds[k][f]++;
  };
  for (const l of all) {
    if (Date.parse(l.t) < since) continue;
    if (l.op === "deliver") {
      bump(l.type, "delivered");
      if (l.wrong.length) bump(l.type, "wrong");
    } else if (l.op === "refused") {
      bump(l.type, "refused");
      reasons.set(l.check, (reasons.get(l.check) ?? 0) + 1);
    } else if (l.op === "failed") bump(l.type, "failed");
    else if (l.op === "confirm" && !l.seen && l.why !== "gone") bump(l.type ?? typeOfMsg.get(l.msgId), "unseen");
    else if (l.op === "handback") bump(l.type, "handback");
    else if (l.op === "breaker") {
      if (l.event === "trip") trips++;
      else rearms++;
    }
  }
  for (const x of clearanceTwiceOf(all.flatMap((l) => (l.op === "deliver" ? [{ t: l.t, id: l.id, sessionId: l.sessionId, type: l.type, bodyHash: l.bodyHash }] : [])))) {
    if (Date.parse(x.t) >= since) bump(x.type, "twice");
  }
  return { days, total, kinds, trips, rearms, reasons: [...reasons].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n) };
}
