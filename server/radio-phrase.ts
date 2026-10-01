import { callsign } from "./callsign.ts";
import type { Transmission } from "./radio.ts";
import { flightWords, PHRASE_CHARS, PHRASE_MAX, whoWords } from "./voice-phrase.ts";

// RADIO 음성(ATC-172, docs/radio.md R3): 교신 하나를 읽을 짧은 영어 문구와 목소리 고르기. 순수 함수.
// 문구는 필드(스테이션, 콜사인, kind, FLIGHT, 짧은 동사)로만 만든다. body·text·message 같은 자유 글은 절대 읽지 않는다(ATC-140의 규칙).
// 글자 집합과 길이는 알림 음성과 같다(PHRASE_CHARS, PHRASE_MAX).

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner"];
const clean = (s: string) => s.replace(PHRASE_CHARS, " ").replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").trim();

// 호출의 kind → 읽을 동사구. 알려진 것만(모르는 kind는 문구 없음)
const CALL_VERB: Record<string, string> = {
  LAND: "land",
  "GO AROUND": "go around",
  FIX: "fix",
  HOLD: "hold",
  CONTINUE: "continue",
  INFO: "information",
  TRAFFIC: "traffic",
  REPORT: "report",
  "FLIGHT PLAN": "flight plan",
  RECALL: "recall",
  "CREW CHANGE": "crew change",
};
const REPLY_VERB: Record<string, string> = { READBACK: "readback", ROGER: "roger", UNABLE: "unable", STANDBY: "standby" };

const INSPECTION: Record<string, string> = { pass: "inspection pass", findings: "inspection findings" };
const LAND: Record<string, string> = { ok: "landed", rejected: "landing rejected", failed: "landing failed" };
const RTS: Record<string, string> = {
  started: "return to service started",
  running: "return to service running",
  ok: "return to service complete",
  refused: "return to service refused",
  rollback: "return to service rolled back",
  failed: "return to service failed",
};

// PR 번호 → "pull request two five four"
const prWords = (pr: number | undefined) => (Number.isInteger(pr) && pr! > 0 ? `pull request ${[...String(pr)].map((d) => DIGITS[Number(d)]).join(" ")}` : null);

// 스테이션 이름을 말로: TOWER → Tower, OCC → 주파수에 따라 Delivery·Company, MCC → Ground, AIRCRAFT → 콜사인
function stationWord(station: string, freq: string, aircraft: string | undefined): string | null {
  if (station === "TOWER") return "Tower";
  if (station === "MCC") return "Ground";
  if (station === "OCC") return freq === "COMPANY" ? "Company" : "Delivery";
  if (station === "ALL") return null;
  const who = whoWords(aircraft) || clean(station.replace(/ \(.*\)$/, ""));
  return who || null;
}

const finish = (parts: (string | null | undefined)[]): string | null => {
  const out = clean(`${parts.filter(Boolean).join(", ")}.`).slice(0, PHRASE_MAX);
  return out || null;
};

// 교신 하나의 문구. 틀이 없는 kind는 null(그 교신은 소리가 없다)
export function radioPhraseOf(t: Pick<Transmission, "freq" | "from" | "to" | "aircraft" | "kind" | "flight" | "replyTo" | "re" | "pr" | "result">): string | null {
  const flight = flightWords(t.flight);
  const speaker = stationWord(t.from, t.freq, t.aircraft);
  const addressee = stationWord(t.to, t.freq, t.aircraft);
  if (!speaker) return null;
  if (t.freq === "GROUND") {
    const what = t.kind === "INSPECTION" ? INSPECTION[t.result ?? ""] : t.kind === "LAND" ? LAND[t.result ?? ""] : t.kind === "ESCALATE" ? "escalate" : t.kind === "RTS" ? RTS[t.result ?? ""] : undefined;
    if (!what) return null;
    return finish([speaker, what, t.kind === "RTS" ? null : prWords(t.pr)]);
  }
  if (t.replyTo) {
    const verb = REPLY_VERB[t.kind];
    if (!verb) return null;
    const re = t.re ? CALL_VERB[t.re] : undefined;
    if (t.re && !re) return null; // 모르는 호출의 답은 읽지 않는다
    return finish([addressee, speaker, verb, re, flight]);
  }
  if (t.kind === "ARRIVED") return finish([addressee, speaker, "arrived", flight]);
  const verb = CALL_VERB[t.kind];
  if (!verb) return null;
  return finish([addressee, speaker, verb, flight]);
}

// ── 목소리 ──
// TOWER, OCC(DELIVERY), MCC(GROUND), COMPANY는 자리마다 고정 목소리, AIRCRAFT는 콜사인에서 안정적으로 고른다.
export const ROLES = ["TOWER", "DELIVERY", "GROUND", "COMPANY"] as const;
export type Role = (typeof ROLES)[number];

// 말하는 쪽이 관제 스테이션이면 그 자리(OCC는 DELIVERY 또는 COMPANY 주파수), AIRCRAFT면 null
export function roleOf(t: Pick<Transmission, "freq" | "from">): Role | null {
  if (t.from === "TOWER") return "TOWER";
  if (t.from === "MCC") return "GROUND";
  if (t.from === "OCC") return t.freq === "COMPANY" ? "COMPANY" : "DELIVERY";
  return null;
}

// FNV-1a 32비트. 같은 글은 늘 같은 값
export function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

// 설치된 목소리(voices) 안에서 이 교신의 목소리. 없으면 null. 하나뿐이면 늘 그것.
// overrides에 든 자리는 그 목소리(설치된 것일 때만). 자리 기본은 ROLES 순서대로 목소리 목록을 돌려 쓴다
export function voiceOf(t: Pick<Transmission, "freq" | "from" | "aircraft">, voices: readonly string[], overrides: Partial<Record<Role, string>> = {}): string | null {
  const list = [...new Set(voices)].sort();
  if (!list.length) return null;
  const role = roleOf(t);
  if (role) {
    const own = overrides[role];
    if (own && list.includes(own)) return own;
    return list[ROLES.indexOf(role) % list.length];
  }
  const key = (t.aircraft ? callsign({ name: t.aircraft }) : t.from).toUpperCase();
  return list[hashOf(key) % list.length];
}

// ?voices=TOWER:name,GROUND:name → 자리별 지정. 모르는 자리나 잘못된 이름은 버린다
export function parseVoiceOverrides(raw: string | undefined, valid: (name: string) => boolean): Partial<Record<Role, string>> {
  const out: Partial<Record<Role, string>> = {};
  for (const part of (raw ?? "").split(",")) {
    const [role, name] = part.split(":").map((s) => s.trim());
    if ((ROLES as readonly string[]).includes(role) && name && valid(name)) out[role as Role] = name;
  }
  return out;
}
