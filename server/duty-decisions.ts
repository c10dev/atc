// DUTY의 정해 둔 결정(ATC-231, docs/duty.md 3.3·5장 D4). `decisions.jsonl`(상태 폴더, 추가만)의 줄과 접기. 순수.
// 쓰는 것은 SUPERVISOR의 확정·해제 클릭(Origin 검사를 거치는 경로)뿐이다. DUTY와 atcctl은 쓰지 못한다: atcctl duty note는 제안(duty-drafts.jsonl)일 뿐이다.

export type DecisionLine =
  | { op: "note"; id: string; at: string; text: string; until?: string; from: string } // from: 제안한 초안 DD-n
  | { op: "retire"; id: string; at: string; why?: string };

export interface Decision {
  id: string;
  at: string;
  text: string;
  until: string | null;
  from: string;
}

export interface DecisionsView {
  active: Decision[]; // 오래된 것이 먼저
  retired: string[];
  expired: string[]; // until이 지나 저절로 꺼진 것
  confirmedDrafts: Record<string, string>; // 초안 DD-n → 결정 SD-n
}

// 다음 결정 번호: 있는 SD-n 가운데 가장 큰 것 + 1
export function nextDecisionId(lines: readonly DecisionLine[]): string {
  let max = 0;
  for (const l of lines) {
    const n = l.op === "note" ? /^SD-(\d+)$/.exec(l.id)?.[1] : undefined;
    if (n) max = Math.max(max, Number(n));
  }
  return `SD-${String(max + 1).padStart(4, "0")}`;
}

// 기록 줄을 지금 시각으로 접는다. retire는 그 id의 note를 끈다. until이 지난 note는 retire 없이도 꺼진다. 모르는 줄은 건너뛴다
export function decisionsOf(lines: readonly DecisionLine[], now: number): DecisionsView {
  const notes = new Map<string, Decision>();
  const retired = new Set<string>();
  for (const l of lines) {
    if (l.op === "note") {
      if (!notes.has(l.id)) notes.set(l.id, { id: l.id, at: l.at, text: l.text, until: l.until ?? null, from: l.from });
    } else if (l.op === "retire") {
      retired.add(l.id);
    }
  }
  const active: Decision[] = [];
  const expired: string[] = [];
  for (const d of notes.values()) {
    if (retired.has(d.id)) continue;
    const until = d.until ? Date.parse(d.until) : NaN;
    if (Number.isFinite(until) && until <= now) expired.push(d.id);
    else active.push(d);
  }
  active.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return {
    active,
    retired: [...retired].filter((id) => notes.has(id)),
    expired,
    confirmedDrafts: Object.fromEntries([...notes.values()].map((d) => [d.from, d.id])),
  };
}

// 확정: 초안(note)의 글을 그대로 결정으로. 이미 확정했거나 until이 지났으면 거절
export type ConfirmResult = { ok: true; line: DecisionLine } | { ok: false; error: string; status: 404 | 409 };
export function confirmOf(
  draft: { id: string; kind: string; text?: string; until?: string | null } | undefined,
  view: DecisionsView,
  dismissed: ReadonlySet<string>,
  lines: readonly DecisionLine[],
  now: number,
): ConfirmResult {
  if (!draft || draft.kind !== "note" || typeof draft.text !== "string") return { ok: false, error: "확정할 note 초안이 아닙니다", status: 404 };
  if (view.confirmedDrafts[draft.id]) return { ok: false, error: `${draft.id}는 이미 확정했습니다(${view.confirmedDrafts[draft.id]})`, status: 409 };
  if (dismissed.has(draft.id)) return { ok: false, error: `${draft.id}는 버린 초안입니다`, status: 409 };
  if (draft.until && Date.parse(draft.until) <= now) return { ok: false, error: `${draft.id}의 until이 이미 지났습니다`, status: 409 };
  return { ok: true, line: { op: "note", id: nextDecisionId(lines), at: new Date(now).toISOString(), text: draft.text, ...(draft.until ? { until: draft.until } : {}), from: draft.id } };
}

// 해제: 지금 켜져 있는 결정만
export function retireOf(id: string, view: DecisionsView, why: unknown, now: number): { ok: true; line: DecisionLine } | { ok: false; error: string; status: 404 } {
  if (!view.active.some((d) => d.id === id)) return { ok: false, error: `${id}는 지금 켜져 있는 결정이 아닙니다`, status: 404 };
  const w = typeof why === "string" ? why.trim().slice(0, 300) : "";
  return { ok: true, line: { op: "retire", id, at: new Date(now).toISOString(), ...(w ? { why: w } : {}) } };
}

// 줄 읽기(깨진 줄은 건너뛴다)
export function parseDecisionLines(raw: string): DecisionLine[] {
  const out: DecisionLine[] = [];
  for (const l of raw.split("\n")) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l) as Partial<DecisionLine> & Record<string, unknown>;
      if (j.op === "note" && typeof j.id === "string" && typeof j.at === "string" && typeof j.text === "string" && typeof j.from === "string") out.push(j as DecisionLine);
      else if (j.op === "retire" && typeof j.id === "string" && typeof j.at === "string") out.push(j as DecisionLine);
    } catch {}
  }
  return out;
}
