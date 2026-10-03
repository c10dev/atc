// 지우기 규칙(ATC-495): PR은 작업 지시서가 이름 붙이지 않은 사용자에게 보이는 기능을 조용히 지우지 않는다.
// 이 파일은 MCC INSPECTION 자료에 싣는 사실(PR 본문의 `Removed:` 줄, 지운 파일), 끄는 스위치의 뜻, 오작동 수를 순수 함수로 계산한다.
// 판단(이 PR이 기능을 지우는가)은 inspector가 하고, 여기는 그 판단에 쓸 사실과 규칙 상태만 준다.

export type RemovalRule = "on" | "off";

// PR 본문 `Removed:` 줄. absent: 줄이 없다, none: `Removed: none`, list: 지운 것의 목록
export type RemovedLine = { state: "absent" } | { state: "none" } | { state: "list"; items: string[] };

// 줄 머리: 목록 표시(`- `, `* `, `> `)와 굵게(`**`)는 봐 준다. 같은 줄 안의 항목은 `;`로 나눈다.
// `Removed:` 뒤가 비어 있으면 바로 아래 목록 줄(`- …`)이 항목이다. `Removed:` 줄이 둘이면 합친다.
const HEAD = /^\s*(?:[-*>]\s+)?\*{0,2}Removed:\*{0,2}\s*(.*?)\s*$/i;
const BULLET = /^\s*[-*]\s+(.+?)\s*$/;

export function removedLineOf(body: string): RemovedLine {
  const lines = body.split("\n");
  let seen = false;
  let none = false;
  const items: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEAD.exec(lines[i]!);
    if (!m) continue;
    seen = true;
    const rest = m[1]!.replace(/\*+$/, "").trim();
    if (rest === "") {
      for (let j = i + 1; j < lines.length; j++) {
        const b = BULLET.exec(lines[j]!);
        if (!b) break;
        items.push(b[1]!);
      }
    } else if (/^none\.?$/i.test(rest)) none = true;
    else for (const x of rest.split(";")) if (x.trim()) items.push(x.trim());
  }
  if (!seen) return { state: "absent" };
  if (items.length) return { state: "list", items };
  return none ? { state: "none" } : { state: "absent" }; // `Removed:`만 있고 비어 있으면 없는 것과 같다
}

export interface FileChange {
  filename: string;
  status: string; // GitHub files API: added, modified, removed, renamed …
}

// 지운 파일 가운데 화면(web/src, menubar)이나 문서 화면 쪽의 것. 기능을 지웠는지 보게 하는 단서일 뿐이다
const UI_PATH = /^(?:web\/src|menubar)\/.+\.(?:tsx|ts|css)$/;
export const deletedFilesOf = (files: readonly FileChange[]): string[] => files.filter((f) => f.status === "removed").map((f) => f.filename);
export const deletedUiFilesOf = (files: readonly FileChange[]): string[] => deletedFilesOf(files).filter((f) => UI_PATH.test(f));

export type RemovalHint = "missing-removed-line" | "none-but-deleted-ui-files";

export interface RemovalPacket {
  rule: RemovalRule;
  note: string; // inspector가 읽는 한 줄: 규칙이 켜졌는지와 무엇을 하는지
  removedLine: RemovedLine;
  deletedFiles: string[];
  deletedUiFiles: string[];
  workOrder: "present" | "missing"; // 패킷이 이 FLIGHT의 작업 지시서 글을 싣고 있나. missing이면 이 점은 pass하지 않는다
  hints: RemovalHint[]; // 규칙이 켜졌을 때만. 단서이고 판정은 inspector가 한다
}

export const RULE_ON_NOTE =
  "removal rule ON: a PR whose diff removes a user-visible feature (screen section, view, button, drawn field, or a stylesheet or component only that feature used) that the work order does not name is `escalate` (ESCALATE: removes <thing>, not named in the work order). " +
  "The PR body needs a `Removed:` line (a list, or `Removed: none`); a missing line, or `none` while the diff deletes such a thing, is P1. If workOrder is missing, say so and do not pass on this point.";
export const RULE_OFF_NOTE = "removal rule OFF (SUPERVISOR switch removalGuard): do not escalate for removal and do not P1 a missing `Removed:` line.";

export function removalPacketOf(input: { rule: RemovalRule; body: string; files: readonly FileChange[]; workOrderText: string | null }): RemovalPacket {
  const removedLine = removedLineOf(input.body);
  const deletedFiles = deletedFilesOf(input.files);
  const deletedUiFiles = deletedUiFilesOf(input.files);
  const hints: RemovalHint[] = [];
  if (input.rule === "on") {
    if (removedLine.state === "absent") hints.push("missing-removed-line");
    if (removedLine.state !== "list" && deletedUiFiles.length > 0) hints.push("none-but-deleted-ui-files");
  }
  return {
    rule: input.rule,
    note: input.rule === "on" ? RULE_ON_NOTE : RULE_OFF_NOTE,
    removedLine,
    deletedFiles,
    deletedUiFiles,
    workOrder: input.workOrderText && input.workOrderText.trim() ? "present" : "missing",
    hints,
  };
}

// ── 오작동 수 ──
// 지우기 때문에 ESCALATE한 기록인가: inspector가 정한 문구 `removes <thing>, not named in the work order`
export const isRemovalEscalation = (reason: string): boolean => /\bremoves\b.+,\s*not named in the work order/i.test(reason);

// mcc.jsonl의 줄(종류마다 칸이 다르다). ESCALATE 줄만 쓴다
export interface EscalationRecord {
  op: string;
  at?: string;
  pr?: number;
  head?: string;
  reason?: string;
}
export interface RemovalEscalation {
  pr: number;
  head: string;
  at: string;
}

// 같은 PR·같은 head의 지우기 ESCALATE는 하나로 센다
export function removalEscalationsOf(records: readonly EscalationRecord[]): RemovalEscalation[] {
  const seen = new Map<string, RemovalEscalation>();
  for (const r of records) {
    if (r.op !== "escalate" || !r.reason || r.pr === undefined || !r.head || !r.at || !isRemovalEscalation(r.reason)) continue;
    const k = `${r.pr}@${r.head}`;
    if (!seen.has(k)) seen.set(k, { pr: r.pr, head: r.head, at: r.at });
  }
  return [...seen.values()];
}

export interface RemovalStats {
  total: number; // 지금까지 지우기로 ESCALATE한 수(0이 "한 번도 안 울렸다"로 읽히지 않게 늘 함께 보인다)
  last7d: number;
  misfires: number; // 최근 7일의 ESCALATE 가운데 SUPERVISOR가 같은 head 그대로 착륙시킨 수
  changed: number; // 최근 7일: head가 바뀐 뒤 머지(오작동이 아니다: 지적이 PR을 바꿨다)
  waiting: number; // 최근 7일: 아직 머지되지 않았거나 머지된 head를 아직 모른다
  landedByMcc: number; // 최근 7일: MCC가 착륙시켰다(SUPERVISOR의 착륙이 아니라 오작동으로 세지 않는다)
}

// mergedHeads: PR 번호 → 머지된 head(머지된 것만 안다). mccLanded: MCC가 착륙시킨 PR의 head들(`pr@head`) — SUPERVISOR가 한 착륙이 아니다
export function removalStatsOf(
  escalations: readonly RemovalEscalation[],
  mergedHeads: ReadonlyMap<number, string>,
  mccLanded: ReadonlySet<string>,
  now: number,
  days = 7,
): RemovalStats {
  const since = now - days * 86_400_000;
  const out: RemovalStats = { total: escalations.length, last7d: 0, misfires: 0, changed: 0, waiting: 0, landedByMcc: 0 };
  for (const e of escalations) {
    if (Date.parse(e.at) < since) continue;
    out.last7d++;
    const merged = mergedHeads.get(e.pr);
    if (merged === undefined) out.waiting++;
    else if (!merged.startsWith(e.head) && !e.head.startsWith(merged)) out.changed++;
    else if (mccLanded.has(`${e.pr}@${e.head}`)) out.landedByMcc++;
    else out.misfires++;
  }
  return out;
}
