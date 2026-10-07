import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { accountFolders } from "./accounts.ts";
import { allClearances, isClearanceOverdue, isPending } from "./clearances.ts";
import { resendLinksOf } from "./clearance-resend.ts";
import { config } from "./config.ts";
import type { Clearance, Snapshot } from "./model.ts";
import { readRecords, record } from "./recorder.ts";
import { allRelays } from "./relay-run.ts";
import { checkServerClearance, type ClearanceSend } from "./send-checks.ts";
import {
  capPerSession,
  clearanceWrongOf,
  handedBackOf,
  KIND_LABEL,
  type Owns,
  ownsWhy,
  parseServerClearanceSwitch,
  pendingWorkOf,
  priorClearanceDeliveriesOf,
  SERVER_CLEARANCE_KINDS,
  type ServerClearanceKind,
  type ServerClearanceLine,
  type ServerClearanceSwitch,
  type ServerItem,
  serverClearanceCountsOf,
  serverItemsOf,
  serverLiveOrBooting,
} from "./server-clearance.ts";
import { type Breaker, type BreakerScope, breakerEventOf, breakerOf, confirmOf, unconfirmedOf } from "./server-send.ts";
import { deliverChecked, findSessionRecord, socketTargetWhy, transcriptOf, writerModeOf, writerPlaceNow, writerPlaceWhy } from "./session-socket.ts";

// SERVER CLEARANCE(ATC-557 b)의 입출력. 판단은 server-clearance.ts(순수), 검사는 send-checks.ts checkServerClearance, 세션에 쓰기는 session-socket.ts deliverChecked뿐이다.
// 30초마다(jobs/server-clearance.ts): ① 쓴 글이 받는 세션의 대화 기록에 보이는지(BREAKER) ② 쓰지 못한 CLEARANCE를 1분 뒤 한 번 더, 두 번째면 undeliverable(손으로 전하는 카드)과 TOWER에게 넘김
// ③ TOWER 브리핑이 서버 몫으로 표시한 것(LAND·INFO·GO AROUND·FIX·첫 RESEND·RELAY)을 TOWER와 같은 길(POST /api/clearances)로 적고 그 글을 보낸다.
// 기록과 글은 그 라우트가 만든다(atcctl issue와 같은 clearances.jsonl 줄, head·release, formatClearance). 이 파일은 controller.ts를 가져오지 않는다(브리핑이 이 파일을 묻는다)

const DAY = 86_400_000;
const SWITCH_FILE = () => join(config.stateDir, "server-clearance.json");
const iso = (ms: number) => new Date(ms).toISOString();
type AnyLine = { t: string; kind: string; op?: string } & Record<string, unknown>;
export const SERVER_HEADER = "x-atc-sender"; // 서버가 부르는 POST /api/clearances에 붙인다(TOWER의 같은 글 막기를 건너뛴다)

export function loadServerClearanceSwitch(file = SWITCH_FILE()): ServerClearanceSwitch {
  try {
    return parseServerClearanceSwitch(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseServerClearanceSwitch(null);
  }
}
// 한 칸을 바꾼다. 바뀐 것만 FLIGHT RECORDER에 남긴다(그 줄이 BREAKER의 새 출발점이다). 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveServerClearanceSwitch(key: ServerClearanceKind, v: "on" | "off", by = "SUPERVISOR", file = SWITCH_FILE()) {
  const cur = loadServerClearanceSwitch(file);
  if (cur[key] === v) return;
  const next = { ...cur, [key]: v };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "server-clearance-mode", by, key, from: cur[key], to: v });
}

export const CLEARANCE_SCOPE: BreakerScope = { kind: "server-clearance", policyOp: "server-clearance-mode", handTo: "서버 CLEARANCE를 멈추고 TOWER에게 넘김", probe: "CLEARANCE 하나로" };
const BREAKER_DAYS = 30;
const breakerNow = (now: number): Breaker => breakerOf(readRecords(now - BREAKER_DAYS * DAY) as unknown as AnyLine[], now, CLEARANCE_SCOPE);
const recentLines = (now: number) => readRecords(now - 2 * DAY) as unknown as AnyLine[];
const configDirs = () => accountFolders().map((f) => f.dir);

let lastPassAt: number | null = null;
const startedAt = Date.now();
export const serverClearanceLive = (now = Date.now()) => serverLiveOrBooting(lastPassAt, startedAt, now);

// 서버가 이 세션에 쓸 수 있나: 살아 있는 background 세션, 세션 파일의 이름이 같고, 확인한 소켓 꼴, 이 프로세스가 쓸 수 있는 곳(운영 서버·시험 opt-in)
function writableIn(s: Pick<Snapshot, "sessions">, id: string): boolean {
  const sess = s.sessions.find((x) => x.id === id);
  if (!sess || sess.status === "dead" || sess.kind !== "background") return false;
  const rec = findSessionRecord(id, configDirs());
  if (!rec || (rec.name ?? "") !== sess.name) return false;
  return !socketTargetWhy(rec) && !writerPlaceWhy(writerPlaceNow(), rec.cwd);
}

// TOWER 브리핑이 묻는다: 이 항목을 서버가 보내나(맞으면 브리핑이 서버 몫으로 표시하고 TOWER는 보내지 않는다)
export function serverClearanceOwner(s: Pick<Snapshot, "sessions">, now = Date.now()): Owns {
  const memo = new Map<string, boolean>();
  const writable = (id: string) => {
    if (!memo.has(id)) memo.set(id, writableIn(s, id));
    return memo.get(id)!;
  };
  let facts: Parameters<typeof ownsWhy>[0] | null = null;
  return (kind, key, recipients) => {
    facts ??= { sw: loadServerClearanceSwitch(), live: serverClearanceLive(now), breaker: breakerNow(now).state, writable, handedBack: handedBackOf(recentLines(now)) };
    return ownsWhy(facts, kind, key, recipients) === null;
  };
}

// TOWER가 서버가 이미 적은 것과 같은 CLEARANCE를 또 적으려 하나(POST /api/clearances의 막음). 같은 받는 이·종류·STAND·본문으로 열린 서버의 CLEARANCE id
export function serverDuplicateOf(input: { to: string; type: string; stand: string | null; text: string }, now = Date.now()): string | null {
  const ids = new Set((recentLines(now) as unknown as ServerClearanceLine[]).flatMap((l) => (l.kind === "server-clearance" && l.op === "issue" ? [l.id] : [])));
  if (!ids.size) return null;
  const hit = allClearances().find((c) => ids.has(c.id) && isPending(c) && c.to === input.to && c.type === input.type && (c.stand ?? null) === input.stand && c.text === input.text);
  return hit?.id ?? null;
}

function transcriptHas(path: string, msgId: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const len = Math.min(size, 4 << 20);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8").includes(msgId);
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export interface ClearancePassDeps {
  get: (path: string) => Promise<unknown>; // TOWER 브리핑(서버 안의 같은 핸들러, ack하지 않는다)
  post: (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>; // 서버 안의 같은 라우트(SERVER_HEADER를 붙인다)
  deliver?: typeof deliverChecked;
  now?: () => number;
}
export interface ClearancePassSummary {
  writer: string | null;
  delivered: string[];
  failed: string[];
  refused: string[];
  handback: string[];
  skipped: number;
}

const openOf = (c: Clearance | undefined) => Boolean(c && isPending(c));

// 적힌 CLEARANCE 하나를 검사하고 쓴다(첫 발송과 재시도가 같은 길). 실패는 failed 줄만(다음 바퀴의 pendingWorkOf가 다시 보내거나 넘긴다)
async function deliverOne(x: { id: string; kind: ServerClearanceKind; key: string; message: string; source: string; attempt: "first" | "retry" }, deps: ClearancePassDeps, out: ClearancePassSummary, now: number): Promise<"ok" | "failed" | "refused"> {
  const c = allClearances().find((y) => y.id === x.id);
  const rec = c ? findSessionRecord(c.to, configDirs()) : null;
  const session = { id: c?.to ?? "", name: rec?.name ?? "" };
  const check = checkServerClearance({
    purpose: x.kind,
    attempt: x.attempt,
    clearance: { id: x.id, to: c?.to ?? "", toName: c?.toName ?? "", type: c?.type ?? "", text: c?.text ?? "", open: openOf(c) },
    source: x.source,
    message: x.message,
    session,
    prior: priorClearanceDeliveriesOf(recentLines(now), x.id),
    now,
  });
  if (!check.ok) {
    // 적은 CLEARANCE를 열어 두지 않는다: 취소하고(팀에 가지 않았다) TOWER에게 넘긴다
    if (openOf(c)) await deps.post(`/api/clearances/${x.id}/cancel`, {}).catch(() => null);
    record({ t: iso(now), kind: "server-clearance", op: "refused", id: x.id, type: x.kind, key: x.key, sessionId: session.id || null, stage: "check", check: check.reason });
    record({ t: iso(now), kind: "server-clearance", op: "handback", id: x.id, type: x.kind, key: x.key, why: `검사가 막음: ${check.reason}` });
    out.refused.push(x.id);
    return "refused";
  }
  const send: ClearanceSend = check.send;
  const r = await (deps.deliver ?? deliverChecked)(send, { configDirs: configDirs() });
  const t = iso(deps.now?.() ?? Date.now());
  if (!r.ok) {
    const n = (readRecords(now - 2 * DAY) as unknown as ServerClearanceLine[]).filter((l) => l.kind === "server-clearance" && l.op === "failed" && l.id === x.id).length + 1;
    record({ t, kind: "server-clearance", op: "failed", id: x.id, type: x.kind, key: x.key, sessionId: send.sessionId, attempt: n, stage: r.stage, why: r.why });
    out.failed.push(x.id);
    return "failed";
  }
  // 쓴 뒤 다시 읽는다: 받은 세션의 이름, 기록의 받는 이·종류·본문, 답 주소 줄(sent wrongly, 기대 0)
  const after = allClearances().find((y) => y.id === x.id);
  const rec2 = findSessionRecord(send.sessionId, configDirs());
  const wrong = clearanceWrongOf({ id: x.id, sessionName: rec2?.name ?? null, stored: after ? { to: after.to, toName: after.toName, type: after.type, text: after.text, open: openOf(after) } : null, sentSessionId: send.sessionId, sentText: send.text });
  record({ t, kind: "server-clearance", op: "deliver", id: x.id, type: x.kind, key: x.key, attempt: x.attempt, sessionId: send.sessionId, session: send.to, pid: r.pid, msgId: r.msgId, transcript: r.cwd ? transcriptOf(r.configDir, r.cwd, send.sessionId) : null, textHash: send.textHash, bodyHash: send.bodyHash, check: "pass", wrong });
  if (wrong.length) console.error(`[atc] SERVER CLEARANCE misfire ${x.id}: ${wrong.join("; ")}`);
  out.delivered.push(x.id);
  return "ok";
}

// 항목 하나: 기록(POST /api/clearances) → relay면 issued 표시 → 검사 → 쓰기
async function issueAndDeliver(it: ServerItem, deps: ClearancePassDeps, out: ClearancePassSummary, now: number) {
  const text = it.kind === "resend" ? `RESEND ${it.source.trim()}` : it.source.trim();
  const body = { to: it.to, type: it.type, text, ...(it.stand ? { stand: it.stand } : {}), ...(it.flight ? { flight: it.flight } : {}) };
  const r = await deps.post("/api/clearances", body).catch((e: Error) => ({ status: 0, json: { error: e.message } as Record<string, unknown> }));
  const cl = r.json.clearance as Clearance | undefined;
  const message = typeof r.json.message === "string" ? r.json.message : null;
  if (r.status !== 200 || !cl || !message) {
    const why = String(r.json.error ?? `HTTP ${r.status}`);
    record({ t: iso(now), kind: "server-clearance", op: "refused", id: null, type: it.kind, key: it.key, sessionId: it.to, stage: "issue", check: why });
    record({ t: iso(now), kind: "server-clearance", op: "handback", id: null, type: it.kind, key: it.key, why: `기록하지 못함: ${why}` });
    out.refused.push(it.key);
    out.handback.push(it.key);
    return;
  }
  record({ t: iso(now), kind: "server-clearance", op: "issue", id: cl.id, type: it.kind, clearanceType: cl.type, key: it.key, sessionId: cl.to, session: cl.toName, ...(it.relay ? { relay: it.relay } : {}), ...(it.resendOf ? { resendOf: it.resendOf } : {}), message, source: it.source });
  // relay는 적자마자 issued로 표시한다(브리핑에서 빠져 다음 바퀴에 다시 적지 않게). 표시가 거절되면 CLEARANCE를 취소하고 TOWER에게 둔다
  if (it.relay) {
    const m = await deps.post(`/api/relay/${it.relay}/issued`, { clearance: cl.id }).catch((e: Error) => ({ status: 0, json: { error: e.message } as Record<string, unknown> }));
    if (m.status !== 200) {
      await deps.post(`/api/clearances/${cl.id}/cancel`, {}).catch(() => null);
      const why = String(m.json.error ?? `HTTP ${m.status}`);
      record({ t: iso(now), kind: "server-clearance", op: "refused", id: cl.id, type: it.kind, key: it.key, sessionId: cl.to, stage: "issue", check: `relay issued: ${why}` });
      record({ t: iso(now), kind: "server-clearance", op: "handback", id: cl.id, type: it.kind, key: it.key, why: `relay issued 거절: ${why}` });
      out.refused.push(cl.id);
      out.handback.push(it.key);
      return;
    }
  }
  const res = await deliverOne({ id: cl.id, kind: it.kind, key: it.key, message, source: it.source, attempt: "first" }, deps, out, now);
  if (res === "refused") out.handback.push(it.key);
}

// 아직 그 항목을 보내도 되나(브리핑을 읽은 뒤 바뀌었을 수 있다): RESEND는 원래 것이 열려 있고 overdue이고 RESEND 고리가 없을 때, relay는 아직 queued일 때
function stillDue(it: ServerItem, now: number): boolean {
  if (it.kind === "resend") {
    const all = allClearances();
    const c = all.find((x) => x.id === it.resendOf);
    if (!c || !isClearanceOverdue(c, now, 10 * 60_000)) return false;
    const l = resendLinksOf(all).get(c.id);
    return !l?.resentBy.length && !l?.resendOf && !l?.answeredVia;
  }
  if (it.kind === "relay") return allRelays().some((r) => r.id === it.relay && r.status === "queued");
  return true;
}

export async function serverClearancePass(s: Snapshot, deps: ClearancePassDeps): Promise<ClearancePassSummary> {
  const now = deps.now?.() ?? Date.now();
  lastPassAt = now;
  const mode = writerModeOf(writerPlaceNow());
  const out: ClearancePassSummary = { writer: mode, delivered: [], failed: [], refused: [], handback: [], skipped: 0 };
  if (!mode) return out; // 시험 서버(opt-in 없음): 브리핑이 아무것도 서버 몫으로 표시하지 않는다(쓸 수 있는 세션이 없다)

  // ① 확인: 쓴 글이 받는 세션의 대화 기록에 보이나(바쁜 세션은 턴이 끝날 때 받으므로 60분까지 기다린다). 안 보이면 BREAKER가 멈추고 TOWER가 보낸다
  for (const d of unconfirmedOf(recentLines(now) as never, "server-clearance")) {
    const seen = d.transcript ? transcriptHas(d.transcript, d.msgId) : false;
    const rec = seen ? null : findSessionRecord(d.sessionId, configDirs());
    const c = confirmOf({ seen, ageMs: now - Date.parse(d.t), session: seen ? "idle" : !rec ? "gone" : rec.status === "busy" ? "busy" : "idle" });
    if (!c) continue;
    const before = breakerNow(now);
    record({ t: iso(now), kind: "server-clearance", op: "confirm", id: d.id, type: (d as unknown as { type: ServerClearanceKind }).type, msgId: d.msgId, sessionId: d.sessionId, ...c });
    const after = breakerNow(now);
    const event = breakerEventOf(before, after);
    if (event) {
      record({ t: iso(now), kind: "server-clearance", op: "breaker", event, id: d.id, why: event === "trip" ? after.why : null });
      if (event === "trip") console.error(`[atc] SERVER CLEARANCE breaker trip: ${after.why}`);
    }
  }

  // ② 쓰지 못한 CLEARANCE: 1분 뒤 한 번 더. 두 번째 실패(또는 적고 쓰기 전에 멈춤)는 undeliverable(손으로 전하는 카드)과 TOWER에게 넘김
  const clearances = allClearances();
  const open = (id: string) => openOf(clearances.find((c) => c.id === id));
  const work = pendingWorkOf(recentLines(now), open, now);
  for (const g of work.giveUp) {
    const reason = `server send ${g.stage}: ${g.why}`.slice(0, 300);
    await deps.post(`/api/clearances/${g.issue.id}/undeliverable`, { reason }).catch(() => null);
    if (g.issue.relay) await deps.post(`/api/relay/${g.issue.relay}/undeliverable`, { reason }).catch(() => null);
    record({ t: iso(now), kind: "server-clearance", op: "handback", id: g.issue.id, type: g.issue.type, key: g.issue.key, why: reason });
    out.handback.push(g.issue.key);
  }
  const breaker = breakerNow(now);
  if (breaker.state === "tripped" || breaker.state === "probe-pending") return out;
  const probe = breaker.state === "probe";
  if (!probe) {
    for (const is of work.retry) {
      if (typeof is.message !== "string" || typeof is.source !== "string") continue;
      await deliverOne({ id: is.id, kind: is.type, key: is.key, message: is.message, source: is.source, attempt: "retry" }, deps, out, now);
    }
  }

  // ③ 브리핑이 서버 몫으로 표시한 것
  const brief = (await deps.get("/api/controller/brief?consumer=controller").catch(() => null)) as { open?: { health?: { id?: string }[] } } | null;
  if (!brief) return out;
  const byId = (id: string) => {
    const c = allClearances().find((x) => x.id === id);
    return c ? { to: c.to, toName: c.toName, type: c.type, stand: c.stand, flight: c.flight, text: c.text } : null;
  };
  // 코드가 있는 AIRCRAFT에는 새 CLEARANCE를 내지 않는다(TOWER 매뉴얼 AIRCRAFT HEALTH). 코드가 풀리면 다음 바퀴에 보낸다
  const coded = new Set((brief.open?.health ?? []).map((h) => String(h?.id ?? "")));
  const listed = serverItemsOf(brief, byId);
  const items = capPerSession(listed.filter((it) => !coded.has(it.to)));
  out.skipped = listed.length - items.length;
  for (const it of items) {
    if (!writableIn(s, it.to) || !stillDue(it, now)) {
      out.skipped++;
      continue;
    }
    await issueAndDeliver(it, deps, out, now);
    if (probe) break; // 시험 발송은 하나
  }
  return out;
}

// 설정 창 SERVER CLEARANCE 블록의 자료: 종류마다 스위치와 7일 수, 서버 job, BREAKER
export function serverClearanceData(now = Date.now()) {
  const lines = readRecords(now - 8 * DAY) as unknown as AnyLine[];
  const b = breakerNow(now);
  const sw = loadServerClearanceSwitch();
  const counts = serverClearanceCountsOf(lines, now, 7);
  return {
    ...counts,
    switches: Object.fromEntries(SERVER_CLEARANCE_KINDS.map((k) => [k, sw[k]])),
    labels: KIND_LABEL,
    live: serverClearanceLive(now),
    lastPassAt: lastPassAt ? iso(lastPassAt) : null,
    breaker: b.state,
    breakerWhy: b.why,
    trippedAt: b.trippedAt,
    writer: writerModeOf(writerPlaceNow()),
  };
}
