// SEND CHECKS(ATC-562): AIRCRAFT 세션에 가는 글의 검사 하나. OCC의 send-guard hook(occ/send-guard.mjs)과 서버(server-send-run.ts)가 같은 함수를 부른다.
// 규칙을 두 곳에 베끼지 않는다. 순수: input-binding.ts(node:crypto) 말고는 가져오지 않는다 — hook은 맨 Node 프로세스에서 이 파일을 읽고,
// config.ts(상태 폴더)를 읽으면 시험 가드(ATC-564)가 막는다.
// 검사: 머리 꼴([DISPATCH D-xxxx], [DISPATCH D-xxxx] RECALL, [OCC CC-xxxx]), 보낼 수 있는 상태(FLIGHT PLAN sent, RECALL recalling, CREW CHANGE sent),
// 본문이 저장된 글과 정확히 같음(머리만이면 저장된 글로 바꿔 넣음), 받는 이가 그 제안의 CAPTAIN(CREW CHANGE는 그 AIRCRAFT), 두 번 보내지 않음.
// 서버가 세션에 쓰는 함수(session-socket.ts deliverChecked)는 이 파일이 만든 CheckedSend만 받는다: 검사를 건너뛴 길은 타입 검사를 통과하지 못하고,
// 형 변환으로 속여도 이 파일이 만든 객체(WeakSet)가 아니면 쓰지 않는다.
// response.ts(CLEARANCE 끝줄)도 순수하다(타입만 가져온다): 서버가 지은 CLEARANCE의 끝줄을 TOWER의 것과 같은 함수로 다시 만들어 본다(ATC-557 b)
import { contentHashOf, workOrderSealOk } from "./input-binding.ts";
import { addressLine, closingLine, responseOf } from "./response.ts";

export interface SendInput {
  to?: unknown;
  message?: unknown;
}
export interface ProposalForSend {
  id: string;
  status: string;
  aircraftName: string | null;
  message?: string | null;
  recallMessage?: string | null;
  sentVia?: string;
}
export interface ChangeForSend {
  id: string;
  status: string;
  registration?: string | null;
  message?: string | null;
}
// D-xxxx → {proposal, mode}, CC-xxxx → {change, mode}. 없으면 null. 연결 실패는 던진다
export type Found = { proposal?: ProposalForSend; change?: ChangeForSend; mode?: string } | null;
export type Fetcher = (id: string) => Promise<Found>;
// 누가 보내나. occ: OCC 세션의 SendMessage(hook). server: atc 서버(ATC-562)
export type Caller = "occ" | "server";
export type Resolved = { reason: string } | { message: string };

// SendMessage의 to는 "TEAM_B" 또는 "TEAM_B [e698d1]"
export const bareName = (to: unknown) => String(to ?? "").replace(/\s*\[[0-9a-f]+\]\s*$/i, "").trim();

// 머리만 있는 본문(뒤에 공백만): 머리 문자열을 돌려준다. 아니면 null
const HEADER_ONLY = /^(\[DISPATCH D-\d{4,}\](?: RECALL)?|\[OCC CC-\d{4,}\])\s*$/;
export const headerOnlyOf = (message: string) => HEADER_ONLY.exec(message)?.[1] ?? null;

// 저장된 문구가 머리 다음에 오는지(머리만 보낼 때 그 문구로 바꿔 넣어도 되는지). 아니면 사유
function storedForHeader(header: string, stored: unknown): string {
  const text = String(stored ?? "").trim();
  if (!text.startsWith(header)) return "저장된 문구가 이 머리로 시작하지 않아 바꿔 넣지 않음";
  return text;
}

// CREW CHANGE([OCC CC-xxxx] …). DISPATCH와 같은 순서로 확인한다
async function resolveCrewChange(toolInput: SendInput, message: string, id: string, fetcher: Fetcher): Promise<Resolved> {
  let found: Found;
  try {
    found = await fetcher(id);
  } catch (e) {
    return { reason: `atc에 연결할 수 없어 보내지 않음(${(e as Error).message})` };
  }
  if (!found?.change) return { reason: `${id} CREW CHANGE가 atc에 없음` };
  const { change, mode } = found;
  if (mode !== "approval") return { reason: "지금은 2a(shadow) — CREW CHANGE를 보내지 않는다(SUPERVISOR가 직접 붙여 넣는다)" };
  if (change.id !== id) return { reason: `${id} 조회 결과가 다른 CREW CHANGE(${change.id})임` };
  if (change.status !== "sent") return { reason: `${id}는 보낼 상태가 아님(${change.status}) — 먼저 crew-change send` };
  if (!change.registration || bareName(toolInput.to) !== change.registration) return { reason: `받는 사람이 ${id}의 AIRCRAFT(${change.registration})가 아님` };
  if (!change.message) return { reason: "문구가 crew-change send가 돌려준 CREW CHANGE와 다름 — 그대로 보내야 함" };
  const header = headerOnlyOf(message);
  if (header) {
    const stored = storedForHeader(header, change.message);
    return stored.startsWith(header) ? { message: stored } : { reason: stored };
  }
  if (message.trim() !== String(change.message).trim()) return { reason: "문구가 crew-change send가 돌려준 CREW CHANGE와 다름 — 그대로 보내야 함" };
  return { message };
}

// 한 번 보낸 FLIGHT PLAN을 다시 보내지 않는 규칙(ATC-73·562). 막으면 사유
export const FRESH_START_SENT_WHY = "FRESH START가 새 세션의 첫 프롬프트로 이미 보냄 — 다시 보내지 않는다";
export const SERVER_SENT_WHY = "atc 서버가 이미 보냄(sentVia server, ATC-562) — OCC는 다시 보내지 않는다";
function duplicateWhy(proposal: ProposalForSend, caller: Caller): string | null {
  if (proposal.sentVia === "fresh-start") return FRESH_START_SENT_WHY;
  if (caller === "occ" && proposal.sentVia === "server") return SERVER_SENT_WHY;
  return null;
}

// 보낼 글을 정한다: { reason }(막음) | { message }(실제로 보낼 글: 머리만 보냈으면 저장된 글, 전체 글이면 보낸 그대로)
export async function resolveSend(toolInput: SendInput | null | undefined, fetcher: Fetcher, caller: Caller = "occ"): Promise<Resolved> {
  const message = typeof toolInput?.message === "string" ? toolInput.message : null;
  if (!message) return { reason: "메시지가 문자열이 아님(구조화된 메시지는 보내지 않는다)" };
  const input = toolInput as SendInput;
  const cc = message.match(/^\[OCC (CC-\d{4,})\]/);
  if (cc) return resolveCrewChange(input, message, cc[1]!, fetcher);
  const m = message.match(/^\[DISPATCH (D-\d{4,})\]( RECALL\b)?/);
  if (!m) return { reason: "OCC는 FLIGHT PLAN([DISPATCH D-xxxx]로 시작)·RECALL과 CREW CHANGE([OCC CC-xxxx]로 시작)만 보낼 수 있음" };
  let found: Found;
  try {
    found = await fetcher(m[1]!);
  } catch (e) {
    return { reason: `atc에 연결할 수 없어 보내지 않음(${(e as Error).message})` };
  }
  if (!found) return { reason: `${m[1]} 제안이 atc에 없음` };
  const { proposal, mode } = found as { proposal: ProposalForSend; mode?: string };
  if (mode !== "approval") return { reason: "지금은 2a(shadow) — FLIGHT PLAN·RECALL을 보내지 않는다" };
  const recall = Boolean(m[2]);
  if (recall && proposal.status !== "recalling") return { reason: `${proposal.id}는 RECALL 요청된 제안이 아님(${proposal.status})` };
  if (!recall && proposal.status !== "sent") return { reason: `${proposal.id}는 보낼 상태가 아님(${proposal.status}) — 먼저 dispatch release` };
  if (!recall) {
    const dup = duplicateWhy(proposal, caller);
    if (dup) return { reason: dup };
  }
  if (bareName(input.to) !== proposal.aircraftName) return { reason: `받는 사람이 ${proposal.id}의 CAPTAIN(${proposal.aircraftName})이 아님` };
  const expected = recall ? proposal.recallMessage : proposal.message;
  const wrong = recall ? "문구가 dispatch recall-send가 돌려준 RECALL과 다름 — 그대로 보내야 함" : "문구가 dispatch release가 돌려준 FLIGHT PLAN과 다름 — 그대로 보내야 함";
  if (!expected) return { reason: wrong };
  if (!recall && workOrderSealOk(expected) === false) return { reason: "저장된 FLIGHT PLAN이 머리의 work-order 해시와 맞지 않음(문구가 바뀜) — 보내지 않음" };
  const header = headerOnlyOf(message);
  if (header) {
    const stored = storedForHeader(header, expected);
    return stored.startsWith(header) ? { message: stored } : { reason: stored };
  }
  if (message.trim() !== String(expected).trim()) return { reason: wrong };
  return { message };
}

// 막는 사유(없으면 null). 머리만 보낸 경우도 통과하면 null이다: 바꿔 넣을 문구는 resolveSend가 준다
export async function checkSend(toolInput: SendInput | null | undefined, fetcher: Fetcher, caller: Caller = "occ"): Promise<string | null> {
  const r = await resolveSend(toolInput, fetcher, caller);
  return "reason" in r ? r.reason : null;
}

// ── 서버가 보내는 길(ATC-562) ──────────────────────────────────────

// first: 승인된 카드의 첫 발송. retry: 닿지 않아(undelivered) approved로 돌아온 카드의 재시도. resend: READBACK 없이 overdue가 지난 sent 카드를 한 번 더
export const SEND_PURPOSES = ["first", "retry", "resend"] as const;
export type SendPurpose = (typeof SEND_PURPOSES)[number];
export const READBACK_OVERDUE_MS = 10 * 60_000; // proposals.ts와 같은 값(OCC 매뉴얼의 overdue 재송신 규칙). 이 파일은 proposals.ts를 가져오지 않는다

// 그 제안에 서버가 이미 한 발송(FLIGHT RECORDER server-send deliver 줄)
export interface PriorDelivery {
  at: string;
  sessionId: string;
  purpose: SendPurpose;
}

// 서버의 받는 이: 보낼 때 살아 있는 세션 id로 찾은 세션(ATC-353). 이름은 send-guard처럼 제안의 CAPTAIN과 비교한다
export interface LiveRecipient {
  id: string;
  name: string;
}

export interface ServerSendInput {
  proposal: ProposalForSend & { sentAt?: string | null; standbyAt?: string | null; awaitSupervisor?: unknown };
  mode: string;
  session: LiveRecipient;
  purpose: SendPurpose;
  prior: readonly PriorDelivery[];
  now: number;
}

// 두 번 보내지 않음(서버 쪽). 지금 보낸 차례(sentAt 이후)에 이미 나간 발송을 본다. 막으면 사유
export function serverRepeatWhy(x: Pick<ServerSendInput, "proposal" | "purpose" | "prior" | "now">): string | null {
  const sentAt = x.proposal.sentAt ? Date.parse(x.proposal.sentAt) : NaN;
  // 서버가 적은 send(sentVia server)여야 서버가 쓴다: 그 사이 OCC가 먼저 보낸 카드(sentVia 없음)는 서버가 다시 보내지 않는다
  if (x.proposal.sentVia !== "server") return `${x.proposal.id}는 서버가 적은 발송(sentVia server)이 아님(${x.proposal.sentVia ?? "OCC"}) — 서버는 보내지 않는다`;
  const cycle = Number.isFinite(sentAt) ? x.prior.filter((d) => Date.parse(d.at) >= sentAt) : [...x.prior];
  if (x.purpose !== "resend") return cycle.length ? `${x.proposal.id}는 서버가 이미 보냄(${cycle.at(-1)!.at}) — 같은 FLIGHT PLAN을 다시 보내지 않는다` : null;
  if (!cycle.length) return `${x.proposal.id}는 서버가 보낸 기록이 없음 — 재송신하지 않는다`;
  if (cycle.some((d) => d.purpose === "resend")) return `${x.proposal.id}는 이미 한 번 다시 보냄 — 그다음은 SUPERVISOR 보고`;
  if (x.proposal.awaitSupervisor) return `${x.proposal.id}의 CAPTAIN이 SUPERVISOR를 기다림 — 다시 보내지 않는다`;
  const last = Math.max(...cycle.map((d) => Date.parse(d.at)));
  const standby = x.proposal.standbyAt ? Date.parse(x.proposal.standbyAt) : NaN;
  const base = Number.isFinite(standby) && standby > last ? standby : last;
  if (x.now - base <= READBACK_OVERDUE_MS) return `${x.proposal.id}는 아직 READBACK을 기다리는 중(overdue 전) — 다시 보내지 않는다`;
  return null;
}

declare const checkedBrand: unique symbol;
// 검사를 통과한 발송 하나. 이 파일의 checkServerSend·checkControlWake·checkServerClearance만 만든다(brand와 WeakSet)
export type FlightPlanSend = Readonly<{
  kind: "flight-plan";
  id: string; // D-xxxx
  sessionId: string; // 보낼 때의 살아 있는 세션 id
  to: string; // 그 세션 이름(검사가 CAPTAIN과 비교한 것)
  text: string; // 저장된 글(그대로 쓴다)
  textHash: string; // contentHashOf(text)
  purpose: SendPurpose;
  checkedAt: string;
}> & { readonly [checkedBrand]: true };
// 관제 세션을 깨우는 글 하나(ATC-557). 같은 writer(session-socket.ts deliverChecked)가 쓴다
export type ControlWakeSend = Readonly<{
  kind: "control-wake";
  id: string; // W-xxxx
  role: "TOWER" | "OCC" | "MCC";
  sessionId: string;
  to: string; // 그 세션 이름(검사가 역할 이름과 비교한 것)
  text: string; // 서버가 지은 깨우는 글(그대로 쓴다)
  textHash: string;
  checkedAt: string;
}> & { readonly [checkedBrand]: true };
// 서버가 지어 보내는 CLEARANCE 하나(ATC-557 b). TOWER가 `atcctl issue`로 적고 SendMessage하던 글과 같은 글을 같은 writer가 쓴다
export type ClearanceSend = Readonly<{
  kind: "clearance";
  id: string; // C-xxxx
  purpose: ServerClearancePurpose;
  attempt: "first" | "retry";
  sessionId: string;
  to: string; // 그 세션 이름(검사가 CLEARANCE의 toName과 비교한 것)
  text: string; // formatClearance가 지은 글(그대로 쓴다)
  textHash: string;
  bodyHash: string; // CLEARANCE 본문(text 칸)의 해시: 두 번 보냄을 셀 때 쓴다
  checkedAt: string;
}> & { readonly [checkedBrand]: true };
export type CheckedSend = FlightPlanSend | ControlWakeSend | ClearanceSend;

const minted = new WeakSet<object>();
export const isChecked = (x: unknown): x is CheckedSend => typeof x === "object" && x !== null && minted.has(x);

export type ServerCheck = { ok: true; send: FlightPlanSend } | { ok: false; reason: string };

// 서버가 FLIGHT PLAN 하나를 보내도 되나. send-guard와 같은 resolveSend를 머리만으로 부르고(받는 이 = 보낼 때의 세션 이름), 두 번 보내지 않음을 더 본다
export async function checkServerSend(x: ServerSendInput): Promise<ServerCheck> {
  const header = `[DISPATCH ${x.proposal.id}]`;
  const r = await resolveSend({ to: x.session.name, message: header }, async (id) => (id === x.proposal.id ? { proposal: x.proposal, mode: x.mode } : null), "server");
  if ("reason" in r) return { ok: false, reason: r.reason };
  const repeat = serverRepeatWhy(x);
  if (repeat) return { ok: false, reason: repeat };
  const send = Object.freeze({
    kind: "flight-plan" as const,
    id: x.proposal.id,
    sessionId: x.session.id,
    to: x.session.name,
    text: r.message,
    textHash: contentHashOf(r.message),
    purpose: x.purpose,
    checkedAt: new Date(x.now).toISOString(),
  }) as FlightPlanSend;
  minted.add(send);
  return { ok: true, send };
}

// ── 관제 세션 깨우기(ATC-557) ──
// 서버가 TOWER·OCC·MCC 세션에 판단할 일 하나를 알리는 글. FLIGHT PLAN과 다른 검사(받는 이는 AIRCRAFT가 아니라 관제 역할)이지만 같은 brand로 같은 writer가 쓴다.
// 검사: 역할 이름, 받는 세션의 이름이 그 역할(시험 opt-in은 run이 정한 이름), 스위치가 wake(또는 그 세션이 깨움 모드로 떴다), 머리 꼴과 id, 결과 줄 지시, 길이,
// 팀에 가는 머리([DISPATCH …]·[OCC CC-…]·[ATC C-…])가 아님
export const CONTROL_WAKE_ROLES = ["TOWER", "OCC", "MCC"] as const;
const WAKE_HEADER = /^\[ATC WAKE (W-\d{4,})\] (TOWER|OCC|MCC)\n/;
export const CONTROL_WAKE_MAX = 8000;
export interface ControlWakeInput {
  wakeId: string;
  role: string;
  session: LiveRecipient;
  expectedName: string; // 운영: 역할 이름(TOWER …). 시험 opt-in: run이 정한 버리는 세션 이름
  text: string;
  mode: string; // 그 역할의 스위치(loop | wake)
  launchedWake: boolean; // 지금 세션이 깨움 모드로 떴다(스위치가 loop로 돌아가 옮겨지기 전까지는 깨운다)
  now: number;
}
export function controlWakeWhy(x: ControlWakeInput): string | null {
  if (!(CONTROL_WAKE_ROLES as readonly string[]).includes(x.role)) return `관제 깨움을 받을 역할이 아님(${x.role})`;
  if (x.mode !== "wake" && !x.launchedWake) return `${x.role}의 스위치가 ${x.mode} — 깨우지 않는다(/loop)`;
  if (!x.expectedName || x.session.name !== x.expectedName) return `받는 세션 이름(${x.session.name})이 ${x.expectedName || x.role}이 아님`;
  const m = WAKE_HEADER.exec(x.text);
  if (!m) return "깨우는 글의 머리가 [ATC WAKE W-xxxx] <역할>이 아님";
  if (m[1] !== x.wakeId || m[2] !== x.role) return `머리(${m[1]} ${m[2]})가 이 깨움(${x.wakeId} ${x.role})과 다름`;
  if (x.text.length > CONTROL_WAKE_MAX) return `깨우는 글이 너무 김(${x.text.length} > ${CONTROL_WAKE_MAX})`;
  if (!x.text.includes("WAKE RESULT: acted") || !x.text.includes("WAKE RESULT: nothing")) return "결과 줄(WAKE RESULT) 지시가 없음";
  if (/^\[(?:DISPATCH D-|OCC CC-|ATC C-)/m.test(x.text)) return "팀에 가는 머리가 글 안에 있음 — 관제 깨움에 싣지 않는다";
  return null;
}
export type WakeCheck = { ok: true; send: ControlWakeSend } | { ok: false; reason: string };
export function checkControlWake(x: ControlWakeInput): WakeCheck {
  const why = controlWakeWhy(x);
  if (why) return { ok: false, reason: why };
  const send = Object.freeze({
    kind: "control-wake" as const,
    id: x.wakeId,
    role: x.role as ControlWakeSend["role"],
    sessionId: x.session.id,
    to: x.session.name,
    text: x.text,
    textHash: contentHashOf(x.text),
    checkedAt: new Date(x.now).toISOString(),
  }) as ControlWakeSend;
  minted.add(send);
  return { ok: true, send };
}

// ── 서버가 지은 CLEARANCE(ATC-557 b) ──
// TOWER가 브리핑의 글을 그대로 옮기던 CLEARANCE(LAND·APPROACH INFO·GO AROUND·FIX, 첫 RESEND, SUPERVISOR RELAY)를 서버가 같은 기록(POST /api/clearances)으로 적고 보낸다.
// 검사: 목적과 종류가 맞음, CLEARANCE가 열려 있음, 받는 세션 id·이름이 CLEARANCE의 to·toName, 본문이 출처 글 그대로(RESEND는 "RESEND " + 원래 글),
// 머리 [ATC C-xxxx] … · <종류>, 끝줄이 그 종류가 청하는 답과 TOWER 이름으로 답하라는 줄, 다른 머리가 없음, 길이, 이 CLEARANCE를 서버가 이미 보내지 않았음
export const SERVER_CLEARANCE_PURPOSES = ["land", "info", "goAround", "fix", "resend", "relay"] as const;
export type ServerClearancePurpose = (typeof SERVER_CLEARANCE_PURPOSES)[number];
const ALL_TYPES = ["TRAFFIC", "HOLD", "CONTINUE", "LAND", "GO AROUND", "FIX", "REPORT", "INFO"]; // clearances.ts CLEARANCE_TYPES(그 파일은 config.ts를 읽어 가져오지 않는다)
const TYPES_OF: Record<ServerClearancePurpose, readonly string[]> = {
  land: ["LAND"],
  info: ["INFO"],
  goAround: ["GO AROUND"],
  fix: ["FIX"],
  resend: ALL_TYPES, // 첫 RESEND는 원래 CLEARANCE의 종류 그대로
  relay: ["INFO", "FIX", "CONTINUE", "GO AROUND"], // relay.ts clearanceTypeOf
};
export const SERVER_CLEARANCE_MAX = 12_000;
export interface ClearanceForSend {
  id: string;
  to: string; // 세션 id
  toName: string;
  type: string;
  text: string;
  open: boolean; // READBACK·ROGER·UNABLE·취소 전
}
export interface ClearanceSendInput {
  purpose: string;
  attempt: "first" | "retry";
  clearance: ClearanceForSend;
  source: string; // 브리핑·relay의 글(RESEND면 원래 CLEARANCE의 글)
  message: string; // 보낼 글(formatClearance)
  session: LiveRecipient; // 보낼 때 세션 파일에서 읽은 id·이름
  prior: readonly { at: string; sessionId: string }[]; // 이 CLEARANCE를 서버가 이미 보낸 기록(deliver 줄)
  now: number;
}
export const resendBodyOf = (original: string) => `RESEND ${original.trim()}`;
export function clearanceSendWhy(x: ClearanceSendInput): string | null {
  if (!(SERVER_CLEARANCE_PURPOSES as readonly string[]).includes(x.purpose)) return `서버가 짓는 CLEARANCE가 아님(${x.purpose})`;
  const c = x.clearance;
  if (!/^C-\d{4,}$/.test(c.id)) return `CLEARANCE id 꼴이 아님(${c.id})`;
  if (!TYPES_OF[x.purpose as ServerClearancePurpose].includes(c.type)) return `${x.purpose}에 맞지 않는 종류(${c.type})`;
  if (!c.open) return `${c.id}는 이미 닫힘 — 보내지 않는다`;
  if (x.session.id !== c.to) return `받는 세션(${x.session.id.slice(0, 8)})이 ${c.id}의 받는 이가 아님`;
  if (!x.session.name || x.session.name !== c.toName) return `받는 세션 이름(${x.session.name || "없음"})이 ${c.id}의 toName(${c.toName})이 아님`;
  const source = x.source.trim();
  if (!source) return "출처 글이 비어 있음";
  const body = x.purpose === "resend" ? resendBodyOf(source) : source;
  if (c.text !== body) return x.purpose === "resend" ? `${c.id}의 본문이 "RESEND " + 원래 글이 아님` : `${c.id}의 본문이 브리핑·relay의 글과 다름 — 그대로 보내야 함`;
  if (x.message.length > SERVER_CLEARANCE_MAX) return `글이 너무 김(${x.message.length} > ${SERVER_CLEARANCE_MAX})`;
  const lines = x.message.split("\n");
  const head = new RegExp(`^\\[ATC ${c.id}\\] .+ · ${c.type}$`);
  if (!head.test(lines[0] ?? "")) return `머리가 [ATC ${c.id}] … · ${c.type}가 아님`;
  if (!x.message.includes(`\n${body}\n`)) return "본문이 글 안에 그대로 없음";
  const closing = closingLine("clearance", responseOf("clearance", c.type as never), c.id);
  if (!x.message.endsWith(`\n${closing}`)) return "끝줄이 이 종류가 청하는 답이 아님";
  if (!x.message.includes(addressLine("clearance")) || !x.message.includes('session name "TOWER"')) return "답을 TOWER 이름으로 보내라는 줄이 없음";
  if (/^\[(?:DISPATCH D-|OCC CC-|ATC WAKE )/m.test(x.message) || lines.slice(1).some((l) => /^\[ATC C-\d+\]/.test(l))) return "다른 머리가 글 안에 있음";
  if (x.prior.length) return `${c.id}는 서버가 이미 보냄(${x.prior.at(-1)!.at}) — 다시 보내지 않는다`;
  return null;
}
export type ClearanceCheck = { ok: true; send: ClearanceSend } | { ok: false; reason: string };
export function checkServerClearance(x: ClearanceSendInput): ClearanceCheck {
  const why = clearanceSendWhy(x);
  if (why) return { ok: false, reason: why };
  const send = Object.freeze({
    kind: "clearance" as const,
    id: x.clearance.id,
    purpose: x.purpose as ServerClearancePurpose,
    attempt: x.attempt,
    sessionId: x.session.id,
    to: x.session.name,
    text: x.message,
    textHash: contentHashOf(x.message),
    bodyHash: contentHashOf(x.clearance.text),
    checkedAt: new Date(x.now).toISOString(),
  }) as ClearanceSend;
  minted.add(send);
  return { ok: true, send };
}
