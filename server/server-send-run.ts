import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { accountFolders } from "./accounts.ts";
import { resolveRecipient } from "./address.ts";
import { enforcedStops, groundStopWhy } from "./atfm.ts";
import { config } from "./config.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { launchReleaseWhyOf } from "./dispatch-launch.ts";
import { freshStartBusy } from "./fresh-start-busy.ts";
import { ackFollowingWhere } from "./following.ts";
import { contentHashOf } from "./input-binding.ts";
import type { Session, Snapshot } from "./model.ts";
import { allProposals, append, crossAccountWhyOf, flightPlanMessageOf, noLiveSessionWhyOf, type Proposal, regOfProposal, restartingWhyOf } from "./proposals.ts";
import { readRecords, record } from "./recorder.ts";
import { regKey } from "./registration.ts";
import { type CheckedSend, checkServerSend, READBACK_OVERDUE_MS, type SendPurpose, serverRepeatWhy } from "./send-checks.ts";
import {
  approvedPurposeOf,
  confirmOf,
  crashedOf,
  freshRefusal,
  parseServerSendSwitch,
  priorDeliveriesOf,
  type ServerSendKey,
  type ServerSendSwitch,
  serverLiveOf,
  serverSendCountsOf,
  suspendedOf,
  unconfirmedOf,
  wrongOf,
} from "./server-send.ts";
import { deliverChecked, findSessionRecord, socketTargetWhy, transcriptOf } from "./session-socket.ts";

// SERVER SEND(ATC-562)의 입출력. 판단은 server-send.ts(순수), 검사는 send-checks.ts(OCC send-guard와 같은 함수), 세션에 쓰기는 session-socket.ts뿐이다.
// 30초마다(jobs/server-send.ts): ① 쓴 발송이 받는 세션의 대화 기록에 보이는지 확인 ② send를 적고 멈춘 카드를 undelivered로 ③ 서버가 보낸 FLIGHT PLAN의 overdue 재송신(한 번)
// ④ 승인된 카드의 첫 발송과 닿지 않은 카드의 재시도. 스위치는 server-send.json(설정 창에서만, 기본 on)

const DAY = 86_400_000;
const SWITCH_FILE = () => join(config.stateDir, "server-send.json");
const iso = (ms: number) => new Date(ms).toISOString();

export function loadServerSendSwitch(file = SWITCH_FILE()): ServerSendSwitch {
  try {
    return parseServerSendSwitch(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseServerSendSwitch(null);
  }
}

// 한 칸을 바꾼다. 바뀐 것만 FLIGHT RECORDER에 남긴다(그 줄이 프로토콜 확인의 새 출발점이다). 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveServerSendSwitch(key: ServerSendKey, v: "on" | "off", by = "SUPERVISOR", file = SWITCH_FILE()) {
  const cur = loadServerSendSwitch(file);
  if (cur[key] === v) return;
  const next = { ...cur, [key]: v };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "server-send-mode", by, key, from: cur[key], to: v });
}

let lastPassAt: number | null = null;
export const serverSendLive = (now = Date.now()) => serverLiveOf(lastPassAt, now);
const configDirs = () => accountFolders().map((f) => f.dir);
type AnyLine = { t: string; kind: string; op?: string } & Record<string, unknown>;
const recentLines = (now: number) => readRecords(now - 2 * DAY) as unknown as AnyLine[];
// 멈춤(프로토콜 확인)은 스위치를 바꿀 때까지 간다: FLIGHT RECORDER 보관 기간(30일) 전체를 본다. 패스와 화면이 같은 창을 쓴다
const SUSPEND_DAYS = 30;
const suspensionNow = (now: number) => suspendedOf(readRecords(now - SUSPEND_DAYS * DAY) as unknown as AnyLine[]);

// release와 같은 막음(GROUND STOP, RESTARTING, LAUNCH 카드, 세션 없음, ACCOUNT 불일치). 막히면 사유 — 서버도 OCC도 보내지 않는다
function blockOf(p: Proposal, s: Snapshot, tp: string): string | null {
  const stop = p.airport ? enforcedStops(s.atfm?.groundStops ?? []).get(p.airport) : undefined;
  if (stop) return groundStopWhy(stop);
  return restartingWhyOf(p, s, tp) ?? launchReleaseWhyOf(p, s, tp) ?? noLiveSessionWhyOf(p, s, tp) ?? crossAccountWhyOf(p, s, tp);
}

// 보낼 때의 받는 이(ATC-353): REGISTRATION의 살아 있는 세션을 id로 정하고, 그 세션 파일이 서버가 쓸 수 있는 꼴인지(background, 확인한 프로토콜)
function recipientOf(p: Proposal, s: Snapshot, tp: string): { ok: true; session: Session } | { ok: false; why: string } {
  const r = resolveRecipient(s.sessions, { registration: regOfProposal(p, tp) }, tp);
  if (!r.ok) return { ok: false, why: r.why };
  const session = s.sessions.find((x) => x.id === r.session.id);
  if (!session) return { ok: false, why: "세션을 다시 찾지 못함" };
  if (session.kind !== "background") return { ok: false, why: `${session.name}는 background 세션이 아님 — OCC가 보낸다` };
  const rec = findSessionRecord(session.id, configDirs());
  if (!rec) return { ok: false, why: `${session.name}의 세션 파일이 없음` };
  const why = socketTargetWhy(rec);
  return why ? { ok: false, why } : { ok: true, session };
}

// OCC의 dispatch release에 줄 409 문구(DispatchLauncher.serverSends). null이면 OCC가 전처럼 보낸다
export function serverOwnsWhy(p: Proposal, s: Snapshot, now = Date.now()): string | null {
  if (p.status === "sent" && p.sentVia === "server") {
    const sw = loadServerSendSwitch();
    const resent = priorDeliveriesOf(recentLines(now), p.id).some((d) => d.purpose === "resend" && (!p.timeline.sent || d.at >= p.timeline.sent));
    if (resent) return "atc 서버가 보냈고 한 번 다시 보냄(sentVia server) — OCC는 보내지 않는다. 그래도 READBACK이 없으면 SUPERVISOR 보고";
    return sw.resend === "on"
      ? `atc 서버가 보냄(sentVia server) — OCC는 다시 보내지 않는다. READBACK 없이 ${READBACK_OVERDUE_MS / 60_000}분이 지나면 서버가 한 번 다시 보낸다`
      : "atc 서버가 보냄(sentVia server) — OCC는 다시 보내지 않는다. SERVER SEND resend가 off라 다시 보내지 않으니 overdue면 SUPERVISOR 보고";
  }
  if (p.status !== "approved") return null;
  if (!serverSendLive(now)) return null; // 서버 job이 3분 넘게 돌지 않았다: OCC가 보낸다
  const cfg = loadDispatchConfig();
  if (cfg.mode !== "approval") return null;
  const pur = approvedPurposeOf(p, loadServerSendSwitch(), now, false);
  if ("skip" in pur) return null;
  if (suspensionNow(now).suspended) return null;
  if (blockOf(p, s, cfg.teamPattern)) return null; // release가 제 사유로 409를 준다
  const rcpt = recipientOf(p, s, cfg.teamPattern);
  if (!rcpt.ok || rcpt.session.name !== p.aircraftName) return null;
  return `atc 서버가 이 FLIGHT PLAN을 보낸다(ATC-562 SERVER SEND ${pur.purpose}, sentVia server) — OCC는 release하지 않는다. 서버가 보내지 못하면 카드가 approved로 남아 OCC에게 돌아온다`;
}

// 대화 기록 끝(최대 4 MB)에 msg_id가 있나
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

export interface PassDeps {
  beforeRelease?: (p: Proposal, s: Snapshot) => Promise<string | null>; // 자동 FRESH START 게이트(ATC-560). 문구를 돌려주면 FRESH START가 맡는다: 서버는 보내지 않는다
  deliver?: typeof deliverChecked;
  message?: (p: Proposal, s: Snapshot) => Promise<string>;
  now?: () => number;
}
export interface PassSummary {
  delivered: string[];
  failed: string[];
  refused: string[];
  skipped: number;
}

// 검사를 통과한 발송을 쓰고 기록한다. 실패면 undelivered(ATC-183: approved로 돌아가 다음에 다시 — 두 번째 실패는 OCC에게)
async function deliverAndRecord(send: CheckedSend, s: Snapshot, tp: string, deps: PassDeps, out: PassSummary) {
  const r = await (deps.deliver ?? deliverChecked)(send, { configDirs: configDirs() });
  const t = iso(deps.now?.() ?? Date.now());
  if (!r.ok) {
    append([{ op: "undelivered", id: send.id, at: t, reason: `server send ${r.stage}: ${r.why}`, cause: r.cause }]);
    record({ t, kind: "server-send", op: "failed", id: send.id, purpose: send.purpose, sessionId: send.sessionId, textHash: send.textHash, check: "pass", stage: r.stage, why: r.why });
    const n = allProposals().find((x) => x.id === send.id)?.undelivered?.n ?? 0;
    if (n >= 2) record({ t, kind: "server-send", op: "handback", id: send.id, why: `${n}번 닿지 않음 — OCC가 보낸다` });
    out.failed.push(send.id);
    return;
  }
  // 쓴 뒤 다시 읽는다: 받은 세션이 CAPTAIN인가, 보낸 글이 저장된 글인가, 보낼 수 있는 상태였나(sent wrongly, 기대 0)
  const p = allProposals().find((x) => x.id === send.id);
  const rec = findSessionRecord(send.sessionId, configDirs());
  const wrong = wrongOf({
    sessionReg: rec?.name ? regKey(rec.name, tp) : null,
    proposalReg: p ? regOfProposal(p, tp) : null,
    sentHash: send.textHash,
    storedHash: p?.message ? contentHashOf(p.message) : null,
    status: p?.status ?? null,
  });
  record({ t, kind: "server-send", op: "deliver", id: send.id, purpose: send.purpose, sessionId: send.sessionId, session: send.to, pid: r.pid, textHash: send.textHash, check: "pass", msgId: r.msgId, transcript: r.cwd ? transcriptOf(r.configDir, r.cwd, send.sessionId) : null, wrong });
  if (wrong.length) console.error(`[atc] SERVER SEND misfire ${send.id}: ${wrong.join("; ")}`);
  // 다시 보내 풀린 FLIGHT FOLLOWING 문제(닿지 않음)는 보고한 것으로 적는다: OCC가 새 문제로 받지 않는다
  if (p?.undelivered) {
    try {
      ackFollowingWhere(s, (i) => i.code === "undelivered" && i.key.includes(`|${send.id}|`));
    } catch (e) {
      console.error("[atc] SERVER SEND following ack:", e);
    }
  }
  out.delivered.push(send.id);
}

export async function serverSendPass(s: Snapshot, deps: PassDeps = {}): Promise<PassSummary> {
  const now = deps.now?.() ?? Date.now();
  lastPassAt = now;
  const out: PassSummary = { delivered: [], failed: [], refused: [], skipped: 0 };
  const cfg = loadDispatchConfig();
  const tp = cfg.teamPattern;
  let lines = recentLines(now);

  // ① 확인: 쓴 발송이 받는 세션의 대화 기록에 보이나(쓰기 성공은 닿았다는 증거가 아니다 — 받는 쪽은 틀린 키도 조용히 받거나 버린다)
  // 바쁜 세션은 턴이 끝날 때 받으므로 idle일 때만 10분으로 판정하고, 바쁘면 60분까지 기다린다. 세션이 끝났으면 gone(멈춤에 세지 않는다)
  for (const d of unconfirmedOf(lines)) {
    const seen = d.transcript ? transcriptHas(d.transcript, d.msgId) : false;
    const rec = seen ? null : findSessionRecord(d.sessionId, configDirs());
    const c = confirmOf({ seen, ageMs: now - Date.parse(d.t), session: seen ? "idle" : !rec ? "gone" : rec.status === "busy" ? "busy" : "idle" });
    if (c) record({ t: iso(now), kind: "server-send", op: "confirm", id: d.id, msgId: d.msgId, sessionId: d.sessionId, ...c });
  }
  // ② send를 적고 쓰기 전에 멈춘 카드: 10분 기다리지 않고 undelivered로 돌린다
  for (const p of allProposals()) {
    if (!crashedOf(p, lines, now)) continue;
    append([{ op: "undelivered", id: p.id, at: iso(now), reason: "server send: 서버가 send를 적고 쓰기 전에 멈춤", cause: "other" }]);
    record({ t: iso(now), kind: "server-send", op: "failed", id: p.id, purpose: "first", sessionId: null, textHash: p.message ? contentHashOf(p.message) : null, check: "n/a", stage: "crash", why: "send를 적고 발송 줄이 없음" });
  }
  if (cfg.mode !== "approval") return out;
  lines = recentLines(now);
  if (suspensionNow(now).suspended) return out; // 프로토콜 확인 실패: OCC에게 넘김(release가 409를 주지 않는다)
  const sw = loadServerSendSwitch();
  const refuse = (id: string, purpose: SendPurpose, sessionId: string | null, textHash: string | null, check: string) => {
    if (freshRefusal(lines, id, check)) record({ t: iso(now), kind: "server-send", op: "refused", id, purpose, sessionId, textHash, check });
    out.refused.push(id);
  };

  // ③ 재송신(b): 서버가 보낸 sent 카드가 READBACK 없이 overdue를 지나면 한 번
  if (sw.resend === "on") {
    for (const p of allProposals()) {
      if (p.kind !== "ASSIGN" || p.status !== "sent" || p.sentVia !== "server") continue;
      const prior = priorDeliveriesOf(lines, p.id);
      const proposal = { ...p, sentAt: p.timeline.sent ?? null, standbyAt: p.standbyAt ?? null, awaitSupervisor: p.awaitSupervisor };
      if (serverRepeatWhy({ proposal, purpose: "resend", prior, now })) continue; // 아직 때가 아니거나 이미 한 번 함(거절이 아니다)
      const rcpt = recipientOf(p, s, tp);
      if (!rcpt.ok) {
        // 받을 세션이 없다(ATC-183): 보내지 않고 approved로 돌려 세션이 돌아오면 retry가 한다
        append([{ op: "undelivered", id: p.id, at: iso(now), reason: `server resend: ${rcpt.why}`, cause: "absent" }]);
        record({ t: iso(now), kind: "server-send", op: "failed", id: p.id, purpose: "resend", sessionId: null, textHash: p.message ? contentHashOf(p.message) : null, check: "n/a", stage: "session", why: rcpt.why });
        out.failed.push(p.id);
        continue;
      }
      const c = await checkServerSend({ proposal, mode: cfg.mode, session: { id: rcpt.session.id, name: rcpt.session.name }, purpose: "resend", prior, now });
      if (!c.ok) {
        refuse(p.id, "resend", rcpt.session.id, p.message ? contentHashOf(p.message) : null, c.reason);
        continue;
      }
      await deliverAndRecord(c.send, s, tp, deps, out);
    }
  }

  // ④ 첫 발송(first)과 재시도(retry, c)
  for (const p of allProposals()) {
    const pur = approvedPurposeOf(p, sw, now);
    if ("skip" in pur) continue;
    if (freshStartBusy(p.id) || blockOf(p, s, tp)) {
      out.skipped++;
      continue;
    }
    // 자동 FRESH START(ATC-560)가 이 세션을 다시 띄우면 FLIGHT PLAN은 새 세션의 첫 프롬프트로 간다(sentVia fresh-start): 서버는 보내지 않는다
    const fresh = deps.beforeRelease ? await deps.beforeRelease(p, s).catch((e: Error) => (console.error("[atc] SERVER SEND FRESH START gate:", e), "gate failed")) : null;
    if (fresh) {
      out.skipped++;
      continue;
    }
    const rcpt = recipientOf(p, s, tp);
    if (!rcpt.ok) {
      out.skipped++; // background가 아니거나 쓸 수 없는 세션: OCC가 보낸다(release가 409를 주지 않는다)
      continue;
    }
    const session = { id: rcpt.session.id, name: rcpt.session.name };
    // 세션 이름이 제안의 CAPTAIN과 다르면 검사가 막는다: 30초마다 문구(Linear 읽기)를 만들지 않고 OCC에게 둔다(release도 409를 주지 않는다)
    if (session.name !== p.aircraftName) {
      out.skipped++;
      continue;
    }
    const prior = priorDeliveriesOf(lines, p.id);
    const message = await (deps.message ?? flightPlanMessageOf)(p, s);
    const at = iso(deps.now?.() ?? Date.now());
    // 먼저 적을 기록으로 검사한다(막히면 아무것도 적지 않는다)
    const dry = await checkServerSend({ proposal: { ...p, status: "sent", message, sentVia: "server", sentAt: at }, mode: cfg.mode, session, purpose: pur.purpose, prior, now });
    if (!dry.ok) {
      refuse(p.id, pur.purpose, session.id, contentHashOf(message), dry.reason);
      continue;
    }
    append([{ op: "send", id: p.id, at, message, via: "server" }]);
    const stored = allProposals().find((x) => x.id === p.id);
    // 그 사이 다른 쪽(OCC)이 먼저 보냈으면 이 send는 적히지 않았다: 아무것도 하지 않는다
    if (!stored || stored.sentVia !== "server" || stored.timeline.sent !== at) {
      out.skipped++;
      continue;
    }
    const c = await checkServerSend({ proposal: { ...stored, sentAt: stored.timeline.sent ?? null }, mode: cfg.mode, session, purpose: pur.purpose, prior, now });
    if (!c.ok) {
      // 적은 send를 그대로 두지 않는다: undelivered로 approved에 돌린다
      append([{ op: "undelivered", id: p.id, at: iso(now), reason: `server send refused: ${c.reason}`, cause: "other" }]);
      refuse(p.id, pur.purpose, session.id, stored.message ? contentHashOf(stored.message) : null, c.reason);
      continue;
    }
    await deliverAndRecord(c.send, s, tp, deps, out);
  }
  return out;
}

// 설정 창 SERVER SEND 블록의 자료: 날마다의 수, 서버 job이 살아 있나, 멈춤(프로토콜 확인)
export function serverSendData(now = Date.now()) {
  const lines = readRecords(now - 8 * DAY) as unknown as AnyLine[];
  const h = suspensionNow(now);
  return { ...serverSendCountsOf(lines, now, 7), live: serverSendLive(now), lastPassAt: lastPassAt ? iso(lastPassAt) : null, suspended: h.suspended, suspendedWhy: h.why };
}
