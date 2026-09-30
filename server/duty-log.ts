// duty.jsonl(상태 폴더)의 줄과 쪽 나누기(ATC-220). 순수. 사용자 글, 완성된 DUTY 글, 도구 이름+요약, 턴 사용량만 적는다. 도구의 입력·출력은 적지 않는다.
import type { DutyEvent, DutyTurnUsage } from "./duty-stream.ts";

export type DutyLogLine =
  | { t: string; kind: "user"; text: string; image?: string }
  | { t: string; kind: "text"; text: string }
  | { t: string; kind: "tool"; name: string; summary: string; error: boolean }
  | { t: string; kind: "notice"; text: string }
  | { t: string; kind: "usage"; turn: DutyTurnUsage }
  | { t: string; kind: "shift" } // NEW SHIFT: 여기부터 새 대화
  | { t: string; kind: "account"; from: string; to: string; by: string } // DUTY ACCOUNT가 바뀜(ATC-242): 다음 글부터 to에서 새 대화
  // D3: DUTY의 카드 요청이 받아들여진 자리(draft는 duty-drafts.jsonl의 DD-n). 카드의 내용은 그릴 때 지금의 큐에서 읽는다
  | { t: string; kind: "card"; queueKind: string; key: string; draft: string }
  // D3: note·charter 초안(읽기만 하는 흐린 카드). 확정은 D4·D5
  | { t: string; kind: "draft"; draftKind: "note" | "charter" | "retire"; draft: string; text: string; until?: string | null };

// 스트림 이벤트 → 적을 줄(적지 않는 것은 null). 조각·init·state·rate는 적지 않는다
export function logLineOf(e: DutyEvent, t: string): DutyLogLine | null {
  switch (e.type) {
    case "text":
      return e.final ? { t, kind: "text", text: e.text } : null;
    case "tool":
      return { t, kind: "tool", name: e.name, summary: e.summary, error: e.error };
    case "notice":
      return { t, kind: "notice", text: e.text };
    case "usage":
      return e.turn ? { t, kind: "usage", turn: e.turn } : null;
    default:
      return null;
  }
}

export const PAGE_SIZE = 200;

// 뒤에서부터 한 쪽. before는 줄 번호(0부터, 그 줄 앞의 것만). 없으면 맨 끝. 깨진 줄은 건너뛴다.
// 반환 next는 더 앞 쪽을 읽을 때 넣을 before(없으면 null)
export function pageOf(raw: string, before?: number, size = PAGE_SIZE): { lines: (DutyLogLine & { n: number })[]; next: number | null } {
  const all = raw.split("\n");
  if (all[all.length - 1] === "") all.pop();
  const end = before !== undefined && Number.isInteger(before) && before >= 0 ? Math.min(before, all.length) : all.length;
  const start = Math.max(0, end - size);
  const lines: (DutyLogLine & { n: number })[] = [];
  for (let n = start; n < end; n++) {
    try {
      const j = JSON.parse(all[n]!) as DutyLogLine;
      if (j && typeof j === "object" && typeof j.kind === "string") lines.push({ ...j, n });
    } catch {}
  }
  return { lines, next: start > 0 ? start : null };
}

export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// 붙인 그림 검사: 형식(PNG·JPEG·WebP)과 크기. base64 글자 수로 먼저 거른다
export function imageCheck(mediaType: unknown, base64: unknown): { ok: true; mediaType: string; ext: string; bytes: number } | { ok: false; error: string } {
  if (typeof mediaType !== "string" || !(mediaType in IMAGE_TYPES)) return { ok: false, error: "그림은 PNG, JPEG, WebP만 받습니다" };
  if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { ok: false, error: "그림 데이터가 base64가 아닙니다" };
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes > IMAGE_MAX_BYTES) return { ok: false, error: `그림이 너무 큽니다(최대 ${IMAGE_MAX_BYTES / 1024 / 1024}MB)` };
  return { ok: true, mediaType, ext: IMAGE_TYPES[mediaType]!, bytes };
}

export const TEXT_MAX = 20_000;
