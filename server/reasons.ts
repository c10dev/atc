// DISPATCH 거절 사유 칩. SUPERVISOR가 disagree·reject할 때 고르고, 화면은 /api/dispatch/brief의 reasonCodes를 그대로 쓴다.
// 목록은 지금까지 proposals.jsonl에 남은 실제 거절·HOLD 사유에서 골랐다. code는 기록에 남으니 바꾸지 않는다(label만 고칠 수 있다).

export interface ReasonCode {
  code: string;
  label: string;
}

export const REASON_CODES: readonly ReasonCode[] = [
  { code: "already-done", label: "이미 완료됨" },
  { code: "parent-issue", label: "상위 이슈(하위로 나뉨)" },
  { code: "waiting-on-prior", label: "선행 FLIGHT·PR 대기" },
  { code: "needs-human", label: "사람 결정 필요" },
  { code: "no-priority", label: "우선순위 미정" },
  { code: "out-of-repo", label: "저장소 밖 작업" },
  { code: "wrong-aircraft", label: "AIRCRAFT 부적합" },
  { code: "other", label: "기타" },
];

export class ReasonCodeError extends Error {}

// API 입력 검사. 없으면 빈 목록. 모르는 code는 오류. 중복을 빼고 목록 순서로 돌려준다.
export function parseReasonCodes(raw: unknown, list: readonly ReasonCode[] = REASON_CODES): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) throw new ReasonCodeError("reasonCodes는 문자열 배열");
  const known = new Set(list.map((r) => r.code));
  const bad = raw.find((x) => !known.has(x));
  if (bad !== undefined) throw new ReasonCodeError(`모르는 사유 code: ${bad} (가능: ${[...known].join(", ")})`);
  const want = new Set(raw as string[]);
  return list.filter((r) => want.has(r.code)).map((r) => r.code);
}

// 기록할 reason 한 줄: "<label1> · <label2> — <자유 사유>", 칩만 있으면 label만, 자유 사유만 있으면 그것만, 둘 다 없으면 null.
// CROSSCHECK 예시와 OCC는 reason만 읽으니 칩 이름이 글에 들어가야 한다.
export function composeReason(codes: string[], free: string | null, list: readonly ReasonCode[] = REASON_CODES): string | null {
  const labels = codes.map((c) => list.find((r) => r.code === c)?.label ?? c).join(" · ");
  const text = free?.trim() || "";
  if (labels && text) return `${labels} — ${text}`;
  return labels || text || null;
}

// 칩별 건수: 사람이 거절(disagree·reject)한 것 중 칩이 기록된 것만. 목록의 모든 code를 0부터 센다.
export function reasonCountsOf(items: { reasonCodes?: string[] }[], list: readonly ReasonCode[] = REASON_CODES): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(list.map((r) => [r.code, 0]));
  for (const x of items) for (const c of x.reasonCodes ?? []) if (c in counts) counts[c]++;
  return counts;
}
