// 입력 묶기(ATC-555, docs/autonomy.md 원칙 7·WO-23). 순수 함수만 두고 node:crypto 말고는 가져오지 않는다:
// occ/send-guard.mjs(hook)와 서버가 같이 쓰고, ATC-562의 공유 검사 모듈도 이 파일을 가져간다(config·상태 폴더를 읽지 않는다).
// - FLIGHT PLAN의 work-order 해시: 저장된 FLIGHT PLAN 글의 짧은 해시(@ + 6자). 머리 줄과 끝줄의 답 문구에 들어간다
// - READBACK이 그 해시를 인용하는지(없거나 틀리면 거절 사유)
// - 기록 줄의 내용 해시(제안·SCHEDULE 초안·판정·FLEET PLAN 제안이 무엇을 판단했나)와 CLEARANCE의 head
import { createHash } from "node:crypto";

export const WO_HASH_LEN = 6;
// FLIGHT PLAN을 만들 때 해시 자리. 해시는 이 자리를 그대로 둔 글에서 계산하고, 그 뒤 자리를 @<해시>로 바꾼다
export const WO_SLOT = "@WOHASH";
const HEX6 = /^[0-9a-f]{6}$/;
// 머리 줄의 해시: `[DISPATCH D-0123] FLIGHT PLAN @a1b2c3 · …`
const HEADER_HASH = /^\[DISPATCH D-\d{4,}\] FLIGHT PLAN @([0-9a-f]{6})(?=\s|$)/;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

// 자리(@WOHASH)를 둔 글의 해시와, 자리를 그 해시로 바꾼 글
export function sealWorkOrder(draft: string): { text: string; hash: string } {
  const body = norm(draft);
  const hash = sha(body).slice(0, WO_HASH_LEN);
  return { text: body.replaceAll(WO_SLOT, `@${hash}`), hash };
}

// 머리 줄에 적힌 해시(없으면 null: 해시 전의 옛 FLIGHT PLAN이거나 RECALL)
export function workOrderHashIn(text: string | null | undefined): string | null {
  const first = norm(String(text ?? "")).split("\n")[0] ?? "";
  return HEADER_HASH.exec(first)?.[1] ?? null;
}

// 저장된 글에서 다시 계산한 해시. 머리 줄에 해시가 없으면 null. 글이 한 자라도 바뀌면 머리의 해시와 달라진다
export function workOrderHashOf(text: string | null | undefined): string | null {
  const h = workOrderHashIn(text);
  if (!h) return null;
  return sha(norm(String(text)).replaceAll(`@${h}`, WO_SLOT)).slice(0, WO_HASH_LEN);
}

// 저장된 FLIGHT PLAN이 제 해시와 맞나. 해시가 없는 옛 글은 null(검사하지 않는다), 맞으면 true, 틀리면 false
export function workOrderSealOk(text: string | null | undefined): boolean | null {
  const h = workOrderHashIn(text);
  return h ? workOrderHashOf(text) === h : null;
}

// CAPTAIN의 답에서 인용한 해시: "@a1b2c3", "a1b2c3", 또는 "READBACK D-0123 @a1b2c3" 같은 답 한 줄. 없으면 null
export function quotedHashOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (HEX6.test(s)) return s;
  return /(?:^|\s)@([0-9a-f]{6})(?=\s|$|["'.,)])/.exec(s)?.[1] ?? null;
}

// CAPTAIN이 보낼 READBACK 한 줄
export const readbackLineOf = (id: string, hash: string) => `READBACK ${id} @${hash}`;

// READBACK을 거절할 사유(영어, 정확한 답 한 줄을 담는다). 저장된 FLIGHT PLAN에 해시가 없으면(옛 글) null — 전처럼 받는다
export function readbackHashWhy(id: string, storedMessage: string | null | undefined, quoted: string | null): { why: string; expected: string; reason: "missing" | "mismatch" } | null {
  const expected = workOrderHashIn(storedMessage);
  if (!expected) return null;
  if (quoted === expected) return null;
  const reason = quoted ? "mismatch" : "missing";
  const said = quoted ? `quoted @${quoted}, which is not the hash of the FLIGHT PLAN atc stored` : "quoted no work-order hash";
  return { why: `READBACK ${id} refused — ${said}. quote the work-order hash @${expected}: the CAPTAIN's reply must be "${readbackLineOf(id, expected)}"`, expected, reason };
}

// 거절 기록(readback-hash-events.jsonl, 추가만) 한 줄
export interface ReadbackHashEvent {
  t: string;
  id: string; // D-xxxx
  flight: string | null;
  reason: "missing" | "mismatch";
  quoted: string | null;
  expected: string;
}

// 최근 days일의 거절 수. 0도 보인다
export function readbackHashCounterOf(events: readonly ReadbackHashEvent[], now: number, days: number) {
  const since = now - days * 86_400_000;
  const inWin = events.filter((e) => Date.parse(e.t) >= since);
  return { refused: inWin.length, missing: inWin.filter((e) => e.reason === "missing").length, mismatch: inWin.filter((e) => e.reason === "mismatch").length, days };
}

export const READBACK_HASH_SWITCHES = ["off", "on"] as const;
export type ReadbackHashSwitch = (typeof READBACK_HASH_SWITCHES)[number];
export const parseReadbackHashSwitch = (raw: unknown): ReadbackHashSwitch => (raw === "off" ? "off" : "on");

// ── 기록 줄의 내용 해시(WO-23) ──

// 키 순서와 상관없는 JSON(같은 내용이면 같은 글)
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

// 판단한 입력의 해시(16자, release.ts releaseHashOf와 같은 길이)
export const contentHashOf = (v: unknown): string => sha(typeof v === "string" ? v : canonical(v)).slice(0, 16);

// 줄에 hash·release를 붙인다. 값이 없으면 칸을 넣지 않는다(옛 줄과 같은 모양)
export function bound<T extends object>(line: T, hash: string | null | undefined, release: string | null | undefined): T & { hash?: string; release?: string } {
  return { ...line, ...(hash ? { hash } : {}), ...(release ? { release } : {}) };
}

// CLEARANCE의 head(WO-23): 글에 적힌 `head <sha>`가 먼저, 다음은 글의 #PR 번호 하나가 가리키는 PR의 head,
// 다음은 그 STAND를 체크아웃한 열린 PR의 head. 못 정하면 null(옛 기록과 같다)
export function clearanceHeadOf(text: string, stand: string | null, pulls: readonly { number: number; head: string; standPath: string | null }[]): string | null {
  const inText = /\bhead\s+([0-9a-f]{7,40})\b/i.exec(text)?.[1];
  if (inText) {
    const full = pulls.find((p) => p.head.startsWith(inText.toLowerCase()));
    return full ? full.head : inText.toLowerCase();
  }
  const nums = [...new Set([...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))];
  if (nums.length === 1) {
    const byNum = pulls.filter((p) => p.number === nums[0]);
    if (byNum.length === 1 && byNum[0]!.head) return byNum[0]!.head;
  }
  if (stand) {
    const byStand = pulls.filter((p) => p.standPath === stand);
    if (byStand.length === 1 && byStand[0]!.head) return byStand[0]!.head;
  }
  return null;
}
