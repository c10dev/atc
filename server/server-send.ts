import { READBACK_OVERDUE_MS, type SendPurpose } from "./send-checks.ts";

// SERVER SEND(ATC-562, docs/occ.md "Server send"): atc 서버가 FLIGHT PLAN을 AIRCRAFT 세션에 직접 보내는 판단. 순수 함수만(입출력은 server-send-run.ts).
// 세 길: first(승인된 카드의 첫 발송), resend(READBACK 없이 overdue가 지나면 한 번 더), retry(닿지 않아 approved로 돌아온 카드를 세션이 돌아오면 한 번 더).
// 스위치 셋(server-send.json, 기본 on, shadow 없음). 끄면 그 길은 OCC가 전처럼 한다. 보낼 수 있는지는 send-checks.ts의 같은 검사가 정한다.

export const SERVER_SEND_KEYS = ["first", "resend", "retry"] as const;
export type ServerSendKey = (typeof SERVER_SEND_KEYS)[number];
export const ON_OFF = ["off", "on"] as const;
export type OnOff = (typeof ON_OFF)[number];
export type ServerSendSwitch = Record<ServerSendKey, OnOff>;

// 꺼지는 것은 정확히 "off"뿐(읽을 수 없는 값은 기본 on)
export function parseServerSendSwitch(raw: unknown): ServerSendSwitch {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { first: o.first === "off" ? "off" : "on", resend: o.resend === "off" ? "off" : "on", retry: o.retry === "off" ? "off" : "on" };
}

export const RETRY_AFTER_MS = 60_000; // 실패 뒤 재시도까지(받는 쪽이 같은 글을 30초 안에 다시 받으면 duplicate로 버린다)
export const CRASH_AFTER_MS = 60_000; // send를 적고 발송·실패 줄이 없이 이만큼 지나면 서버가 그 사이에 멈춘 것
export const SERVER_LIVE_MS = 3 * 60_000; // job이 30초마다 돈다: 3분 안에 돌았으면 살아 있다(ATC-563과 같은 기준)
export const CONFIRM_WITHIN_MS = READBACK_OVERDUE_MS; // 쓴 뒤 이 안에 받는 세션의 대화 기록에 msg_id가 보여야 한다

export const serverLiveOf = (lastPassAt: number | null, now: number) => lastPassAt !== null && now - lastPassAt >= 0 && now - lastPassAt <= SERVER_LIVE_MS;

// 승인된 카드를 서버가 보낼 길(first·retry). 아니면 skip 사유. timing false면 재시도까지의 기다림을 보지 않는다(release 409가 쓴다: 곧 서버가 할 카드)
export interface ApprovedCard {
  kind: string;
  status: string;
  launch?: true;
  undelivered?: { at: string; n: number };
}
export function approvedPurposeOf(p: ApprovedCard, sw: ServerSendSwitch, now: number, timing = true): { purpose: SendPurpose } | { skip: string } {
  if (p.kind !== "ASSIGN" || p.status !== "approved") return { skip: "승인된 ASSIGN이 아님" };
  if (p.launch) return { skip: "LAUNCH 카드 — FLIGHT PLAN은 새 세션의 첫 프롬프트로 간다" };
  if (!p.undelivered) return sw.first === "on" ? { purpose: "first" } : { skip: "SERVER SEND first off — OCC가 보낸다" };
  if (p.undelivered.n >= 2) return { skip: `두 번 닿지 않음(${p.undelivered.n}) — OCC에게 넘김` };
  if (sw.retry !== "on") return { skip: "SERVER SEND retry off — OCC가 다시 보낸다" };
  if (timing && now - Date.parse(p.undelivered.at) < RETRY_AFTER_MS) return { skip: "재시도 대기(1분)" };
  return { purpose: "retry" };
}

// 쓴 뒤 다시 읽은 사실 → 잘못 보낸 사유(sent wrongly, 기대 0). 빈 목록이면 맞게 보낸 것이다.
// 검사와 따로 센다: 쓰고 나서 세션 파일·제안을 다시 읽어 비교한다(검사가 통과시킨 것을 그대로 믿지 않는다)
export function wrongOf(x: { sessionReg: string | null; proposalReg: string | null; sentHash: string; storedHash: string | null; status: string | null }): string[] {
  const out: string[] = [];
  if (!x.sessionReg || x.sessionReg !== x.proposalReg) out.push(`받은 세션(${x.sessionReg ?? "없음"})이 제안의 CAPTAIN(${x.proposalReg ?? "없음"})이 아님`);
  if (x.storedHash !== x.sentHash) out.push("보낸 글이 저장된 글과 다름");
  if (!x.status || !["sent", "accepted", "declined", "departed"].includes(x.status)) out.push(`보낼 수 없는 상태의 제안(${x.status ?? "없음"})`);
  return out;
}

// ── FLIGHT RECORDER 줄(server-send) ──
export type ServerSendLine =
  | { t: string; kind: "server-send"; op: "deliver"; id: string; purpose: SendPurpose; sessionId: string; session: string; pid: number; textHash: string; check: "pass"; msgId: string; transcript: string | null; wrong: string[] }
  | { t: string; kind: "server-send"; op: "refused"; id: string; purpose: SendPurpose; sessionId: string | null; textHash: string | null; check: string }
  | { t: string; kind: "server-send"; op: "failed"; id: string; purpose: SendPurpose; sessionId: string | null; textHash: string | null; check: "pass" | "n/a"; stage: string; why: string }
  | { t: string; kind: "server-send"; op: "confirm"; id: string; msgId: string; sessionId: string; seen: boolean; why?: "idle" | "timeout" | "gone" }
  | { t: string; kind: "server-send"; op: "handback"; id: string; why: string };
type Line = { t: string; kind: string; op?: string } & Record<string, unknown>;
const sendLines = (lines: readonly Line[]) => lines.filter((l): l is Line & ServerSendLine => l.kind === "server-send");

// 그 제안에 서버가 한 발송(검사 입력: 두 번 보내지 않음)
export const priorDeliveriesOf = (lines: readonly Line[], id: string) =>
  sendLines(lines).flatMap((l) => (l.op === "deliver" && l.id === id ? [{ at: l.t, sessionId: l.sessionId, purpose: l.purpose }] : []));

// 두 번 보냄(sent twice): 같은 FLIGHT PLAN이 같은 세션에 두 번 이상 간 수. overdue가 지난 뒤의 재송신(resend) 한 번은 빼고 센다
export function twiceOf(deliveries: readonly { t: string; id: string; sessionId: string; purpose: SendPurpose }[]): { t: string; id: string }[] {
  const by = new Map<string, typeof deliveries>();
  for (const d of deliveries) by.set(`${d.id}|${d.sessionId}`, [...(by.get(`${d.id}|${d.sessionId}`) ?? []), d]);
  const out: { t: string; id: string }[] = [];
  for (const list of by.values()) {
    const sorted = [...list].sort((a, b) => a.t.localeCompare(b.t));
    let resendUsed = false;
    for (let i = 1; i < sorted.length; i++) {
      const gap = Date.parse(sorted[i]!.t) - Date.parse(sorted[i - 1]!.t);
      if (sorted[i]!.purpose === "resend" && gap > READBACK_OVERDUE_MS && !resendUsed) resendUsed = true;
      else out.push({ t: sorted[i]!.t, id: sorted[i]!.id });
    }
  }
  return out;
}

// 처음 보는 거절인가(같은 제안·같은 사유를 30초마다 다시 적지 않는다)
export function freshRefusal(lines: readonly Line[], id: string, check: string): boolean {
  const last = sendLines(lines).filter((l) => l.id === id && (l.op === "refused" || l.op === "deliver" || l.op === "failed")).at(-1);
  return !(last?.op === "refused" && last.check === check);
}

// send를 적었는데 발송·실패·거절 줄이 없이 오래된 카드: 서버가 그 사이 멈췄다(크래시). 그 카드는 undelivered로 돌린다
export function crashedOf(p: { id: string; status: string; sentVia?: string; timeline: { sent?: string } }, lines: readonly Line[], now: number): boolean {
  if (p.status !== "sent" || p.sentVia !== "server" || !p.timeline.sent) return false;
  const sentAt = Date.parse(p.timeline.sent);
  if (now - sentAt < CRASH_AFTER_MS) return false;
  return !sendLines(lines).some((l) => l.id === p.id && (l.op === "deliver" || l.op === "failed" || l.op === "refused") && Date.parse(l.t) >= sentAt);
}

// 확인할 발송: confirm 줄이 아직 없는 deliver
export function unconfirmedOf(lines: readonly Line[]): (ServerSendLine & { op: "deliver" })[] {
  const done = new Set(sendLines(lines).flatMap((l) => (l.op === "confirm" ? [l.msgId] : [])));
  return sendLines(lines).filter((l): l is ServerSendLine & { op: "deliver" } => l.op === "deliver" && !done.has(l.msgId));
}

// 쓴 발송을 확인할 때(순수). seen이면 보임. 아니면: 받는 세션이 idle인데 10분이 지났으면 안 보임(idle 세션은 줄 선 글을 이미 받았어야 한다),
// 바쁜 세션은 턴이 끝날 때 받으므로 60분까지 기다린다, 세션이 끝났으면 gone(프로토콜 탓이 아니라 멈춤에 세지 않는다). null이면 아직 기다린다
export const CONFIRM_CAP_MS = 60 * 60_000;
export function confirmOf(x: { seen: boolean; ageMs: number; session: "idle" | "busy" | "gone" }): { seen: boolean; why?: "idle" | "timeout" | "gone" } | null {
  if (x.seen) return { seen: true };
  if (x.session === "gone") return x.ageMs > CONFIRM_WITHIN_MS ? { seen: false, why: "gone" } : null;
  if (x.session === "idle" && x.ageMs > CONFIRM_WITHIN_MS) return { seen: false, why: "idle" };
  if (x.ageMs > CONFIRM_CAP_MS) return { seen: false, why: "timeout" };
  return null;
}

// 프로토콜 확인(ATC-562): 스위치를 마지막으로 바꾼 뒤 마지막 확인이 "안 보임"이면 서버 발송을 멈추고 OCC에게 넘긴다.
// Claude Code가 소켓 길을 바꿔 쓰기는 되는데 글이 닿지 않는 경우를 잡는다. SUPERVISOR가 스위치를 껐다 켜면 다시 시도한다
export function suspendedOf(lines: readonly Line[]): { suspended: boolean; why: string | null } {
  let since = -1;
  lines.forEach((l, i) => {
    if (l.kind === "policy" && l.op === "server-send-mode") since = i;
  });
  const last = sendLines(lines.slice(since + 1)).filter((l) => l.op === "confirm" && l.why !== "gone").at(-1);
  if (last?.op === "confirm" && !last.seen) return { suspended: true, why: `${last.id}의 발송(확인 ${last.t})이 받는 세션의 대화 기록에 보이지 않음 — 서버 발송을 멈추고 OCC에게 넘김(스위치를 껐다 켜면 다시 시도)` };
  return { suspended: false, why: null };
}

// SUPERVISOR 화면의 숫자: 날마다(UTC) 보냄·잘못 보냄·두 번 보냄·거절·실패·안 보임·넘김. 0도 보인다
export interface ServerSendDay {
  day: string;
  delivered: number;
  wrong: number;
  twice: number;
  refused: number;
  failed: number;
  unseen: number;
  handback: number;
}
export interface ServerSendCounts {
  days: ServerSendDay[];
  total: Omit<ServerSendDay, "day">;
  reasons: { reason: string; n: number }[]; // 거절 사유별(가장 많은 것부터)
}
export function serverSendCountsOf(lines: readonly Line[], now: number, days = 7): ServerSendCounts {
  const dayKeys = Array.from({ length: days }, (_, i) => new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const since = dayKeys[0]!;
  const blank = (day: string): ServerSendDay => ({ day, delivered: 0, wrong: 0, twice: 0, refused: 0, failed: 0, unseen: 0, handback: 0 });
  const byDay = new Map(dayKeys.map((d) => [d, blank(d)]));
  const reasons = new Map<string, number>();
  const all = sendLines(lines);
  for (const l of all) {
    const d = byDay.get(l.t.slice(0, 10));
    if (!d) continue;
    if (l.op === "deliver") {
      d.delivered++;
      if (l.wrong.length) d.wrong++;
    } else if (l.op === "refused") {
      d.refused++;
      reasons.set(l.check, (reasons.get(l.check) ?? 0) + 1);
    } else if (l.op === "failed") d.failed++;
    else if (l.op === "confirm" && !l.seen && l.why !== "gone") d.unseen++;
    else if (l.op === "handback") d.handback++;
  }
  for (const x of twiceOf(all.flatMap((l) => (l.op === "deliver" ? [{ t: l.t, id: l.id, sessionId: l.sessionId, purpose: l.purpose }] : [])))) {
    if (x.t.slice(0, 10) >= since) {
      const d = byDay.get(x.t.slice(0, 10));
      if (d) d.twice++;
    }
  }
  const list = [...byDay.values()];
  const total = list.reduce((a, d) => ({ delivered: a.delivered + d.delivered, wrong: a.wrong + d.wrong, twice: a.twice + d.twice, refused: a.refused + d.refused, failed: a.failed + d.failed, unseen: a.unseen + d.unseen, handback: a.handback + d.handback }), { delivered: 0, wrong: 0, twice: 0, refused: 0, failed: 0, unseen: 0, handback: 0 });
  return { days: list, total, reasons: [...reasons].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n) };
}
