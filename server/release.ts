// 발권 기록(ATC-362, docs/autonomy.md 원칙 1·10): SUPERVISOR가 FLIGHT의 "화살"을 쏜 기록. 순수 함수만 둔다. 파일 입출력과 경로는 release-run.ts.
// `releases.jsonl`(상태 폴더, 추가만). 한 줄은 하나의 발권이나 gate를 켠 표시다.
// - 화면(screen): SUPERVISOR의 클릭. Origin 검사를 거친 요청만 만든다(agent는 못 만든다)
// - DUTY 채팅(duty-chat): SUPERVISOR가 DUTY 채팅에 직접 쓴 글(서버가 그 글을 받을 때 읽는다)
// - attested: 다른 세션에 한 SUPERVISOR의 말을 그 세션이 증언한다. 서버는 확인할 수 없어 attested로 표시하고 세션마다 센다
import { createHash } from "node:crypto";

export type ReleaseChannel = "screen" | "duty-chat" | "attested";
export const CHANNELS: readonly ReleaseChannel[] = ["screen", "duty-chat", "attested"];

export type ReleaseLine =
  | {
      op: "release";
      flight: string;
      channel: ReleaseChannel;
      at: string;
      hash: string; // 승인한 내용(목표·완료 기준·선언한 K 효과)의 해시
      via?: "click" | "bulk"; // screen: 한 건 클릭 / 일괄 확인
      words?: string; // duty-chat: SUPERVISOR 글 앞부분, attested: 증언한 말
      session?: string; // attested: 증언한 세션 이름
    }
  | { op: "revoke"; flight: string; at: string; reason: string; by: string } // 발권을 거둔다(ATC-368: 마이그레이션 리허설이 멈추면 FLIGHT는 제안으로 돌아와 다시 발권해야 한다). 이후의 발권이 다시 세운다
  | { op: "arm"; at: string; flights: number }; // 일괄 확인: 이 줄부터 발권 없는 FLIGHT는 배정하지 않는다(설정 releaseGate "auto")

export interface ReleaseRecord {
  flight: string;
  channel: ReleaseChannel;
  at: string;
  hash: string;
  via?: "click" | "bulk";
  words?: string;
  session?: string;
}

export interface ReleaseView {
  armedAt: string | null;
  records: Record<string, ReleaseRecord>; // FLIGHT key → 가장 나중 발권(거두면 없음)
  revoked?: Record<string, { at: string; reason: string; by: string }>; // 거둔 발권의 이유. 다시 발권하면 지운다
}

export type ReleaseGateMode = "auto" | "on" | "off";

const SECTION = {
  goal: /^(?:goal|목표)$/i,
  doneWhen: /^(?:done when|exit criteria|완료 기준)$/i,
  k: /^(?:k effects?|k 효과)$/i,
};
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// 본문에서 `## 제목` 아래 글을 뽑는다(다음 `#` 제목 앞까지)
export function sectionsOf(description: string | null | undefined): { goal: string; doneWhen: string; k: string } {
  const out = { goal: "", doneWhen: "", k: "" };
  let cur: keyof typeof out | null = null;
  for (const line of (description ?? "").split("\n")) {
    const h = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (h) {
      const title = h[1]!.replace(/[:：]$/, "");
      cur = (Object.keys(SECTION) as (keyof typeof SECTION)[]).find((k) => SECTION[k].test(title)) ?? null;
      continue;
    }
    if (cur) out[cur] += `${line}\n`;
  }
  return { goal: squash(out.goal), doneWhen: squash(out.doneWhen), k: squash(out.k) };
}

// 승인한 내용의 해시. 세 절 가운데 하나라도 있으면 세 절로, 없으면 본문 전체로(제목 없는 이슈도 바뀌면 해시가 바뀐다).
// 본문이 없으면 null: 해시를 비교할 수 없다
export function releaseHashOf(description: string | null | undefined): string | null {
  const text = squash(description ?? "");
  if (!text) return null;
  const s = sectionsOf(description);
  const body = s.goal || s.doneWhen || s.k ? JSON.stringify([s.goal, s.doneWhen, s.k]) : text;
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

// 발권 화면이 클릭 전에 보이는 선언한 K 효과(ATC-376). 절이 없으면 null
export const K_EFFECTS_MAX = 400;
export function kEffectsOf(description: string | null | undefined): string | null {
  const k = sectionsOf(description).k;
  return k ? k.slice(0, K_EFFECTS_MAX) : null;
}

export function foldReleases(lines: readonly ReleaseLine[]): ReleaseView {
  const records: Record<string, ReleaseRecord> = {};
  const revoked: NonNullable<ReleaseView["revoked"]> = {};
  let armedAt: string | null = null;
  for (const l of lines) {
    if (l.op === "arm") armedAt ??= l.at;
    else if (l.op === "revoke") {
      delete records[l.flight];
      revoked[l.flight] = { at: l.at, reason: l.reason, by: l.by };
    } else if (l.op === "release") {
      const { op: _op, ...r } = l;
      records[l.flight] = r;
      delete revoked[l.flight];
    }
  }
  return { armedAt, records, revoked };
}

// gate가 켜졌나. auto(기본): 일괄 확인(arm)을 한 뒤부터. on: 항상. off: 끔(발권 없이도 배정)
export const releaseGateOn = (mode: ReleaseGateMode, armedAt: string | null | undefined): boolean => mode === "on" || (mode === "auto" && Boolean(armedAt));

export type ReleaseState = "released" | "unreleased" | "stale";

// 발권 기록과 지금 이슈 본문의 해시. 지금 해시를 모르면(본문 없음) 기록이 있는 것으로 본다
export function releaseStateOf(flight: string, hash: string | null | undefined, view: ReleaseView | null | undefined): ReleaseState {
  const r = view?.records[flight];
  if (!r) return "unreleased";
  return hash && hash !== r.hash ? "stale" : "released";
}

// 배정 후보에서 빠지는 이유(dispatch.ts가 이 문구를 쓴다)
export const NOT_RELEASED_WHY = "발권 기록 없음 — 제안 상태, SUPERVISOR가 발권(RELEASE)해야 배정";
export const STALE_RELEASE_WHY = "발권 뒤 목표·완료 기준이 바뀜 — 다시 발권(RELEASE)해야 배정";

const KEY = /^[A-Z][A-Z0-9]*-\d+$/;
const WORDS_MAX = 500;

export type Verdict<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

interface Flight {
  key: string;
  stateType: string;
  releaseHash?: string | null;
}

// 발권할 수 있는 FLIGHT: 알려져 있고 아직 시작하지 않은 것(Todo 등)
export function releasable(f: Flight | undefined, key: string): Verdict<Flight> {
  if (!f) return { ok: false, status: 404, error: `${key}를 찾을 수 없음` };
  if (f.stateType !== "unstarted") return { ok: false, status: 409, error: `${key}는 시작 전(Todo)이 아님` };
  return { ok: true, value: f };
}

const now = (at: Date) => at.toISOString();

// 화면 클릭 한 건. hash는 화면이 보여 준 내용의 해시: 그 사이 이슈가 바뀌었으면 거절한다(승인한 것과 날 것이 같도록)
export function screenRelease(f: Flight | undefined, key: string, shownHash: unknown, via: "click" | "bulk", at: Date): Verdict<ReleaseLine> {
  if (!KEY.test(key)) return { ok: false, status: 400, error: "FLIGHT key 형식이 아님" };
  const r = releasable(f, key);
  if (!r.ok) return r;
  const hash = r.value.releaseHash ?? null;
  if (!hash) return { ok: false, status: 409, error: `${key}의 본문을 읽지 못해 해시를 만들 수 없음` };
  if (typeof shownHash === "string" && shownHash !== hash) return { ok: false, status: 409, error: `${key}가 화면에 보인 뒤 바뀜 — 새로 고쳐 다시 확인` };
  return { ok: true, value: { op: "release", flight: key, channel: "screen", at: now(at), hash, via } };
}

// DUTY 채팅의 SUPERVISOR 글에서 발권할 FLIGHT: `RELEASE ATC-1 ATC-2`나 `발권 ATC-1`처럼 글머리(줄 맨 앞) 낱말 뒤에 key가 오는 줄
const CHAT_CMD = /^\s*(?:release\b|발권)[:\s]+((?:[A-Z][A-Z0-9]*-\d+[\s,]*)+)\s*$/im;
export function chatReleaseKeys(text: string): string[] {
  const m = CHAT_CMD.exec(text);
  return m ? [...new Set(m[1]!.match(/[A-Z][A-Z0-9]*-\d+/g) ?? [])] : [];
}

export function chatRelease(f: Flight | undefined, key: string, text: string, at: Date): Verdict<ReleaseLine> {
  const r = releasable(f, key);
  if (!r.ok) return r;
  const hash = r.value.releaseHash ?? null;
  if (!hash) return { ok: false, status: 409, error: `${key}의 본문을 읽지 못해 해시를 만들 수 없음` };
  return { ok: true, value: { op: "release", flight: key, channel: "duty-chat", at: now(at), hash, words: squash(text).slice(0, WORDS_MAX) } };
}

// 다른 세션의 증언. 서버는 말을 확인할 수 없다(agent가 쓴 글이라 거짓일 수 있다): attested로 표시하고 세션 이름을 남긴다
export function attestedRelease(f: Flight | undefined, body: unknown, at: Date): Verdict<ReleaseLine> {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const key = typeof b.flight === "string" ? b.flight : "";
  if (!KEY.test(key)) return { ok: false, status: 400, error: "flight(FLIGHT key)가 필요함" };
  const session = typeof b.session === "string" ? squash(b.session).slice(0, 80) : "";
  const words = typeof b.words === "string" ? squash(b.words).slice(0, WORDS_MAX) : "";
  if (!session) return { ok: false, status: 400, error: "session(증언하는 세션 이름)이 필요함" };
  if (!words) return { ok: false, status: 400, error: "words(SUPERVISOR가 한 말 그대로)가 필요함" };
  const r = releasable(f, key);
  if (!r.ok) return r;
  const hash = r.value.releaseHash ?? null;
  if (!hash) return { ok: false, status: 409, error: `${key}의 본문을 읽지 못해 해시를 만들 수 없음` };
  return { ok: true, value: { op: "release", flight: key, channel: "attested", at: now(at), hash, session, words } };
}

// 세션마다 attested 발권 수(SUPERVISOR가 표본으로 확인하도록, 원칙 6·7)
export function attestedCounts(lines: readonly ReleaseLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) if (l.op === "release" && l.channel === "attested") out[l.session ?? "(이름 없음)"] = (out[l.session ?? "(이름 없음)"] ?? 0) + 1;
  return out;
}

// 일괄 확인 대상: 시작 전이고 발권이 없거나 낡은 FLIGHT 가운데 화면이 보여 준 것
export function bulkTargets(tickets: readonly (Flight & { priority?: number })[], view: ReleaseView | null | undefined): Flight[] {
  return tickets.filter((t) => t.stateType === "unstarted" && releaseStateOf(t.key, t.releaseHash, view) !== "released");
}
