import type { FlowStage, Verdict } from "../../server/home-flow.ts";

// HOME 흐름판의 글자 규칙(순수). 판정·칸·주체는 서버가 정하고(GET /api/flow), 여기는 글자 나누기와 읽는 이름만 둔다.
export const STAGE_META: readonly { stage: FlowStage; code: string; ko: string }[] = [
  { stage: "queue", code: "QUEUE", ko: "대기" },
  { stage: "out", code: "OUT", ko: "출발" },
  { stage: "off", code: "OFF", ko: "비행" },
  { stage: "cleared", code: "CLEARED", ko: "착륙 대기" },
  { stage: "in", code: "ON·IN", ko: "배포" },
];
export const GLYPH: Record<Verdict, string> = { normal: "", congested: "▲", stopped: "■" };
export const VERDICT_WORD: Record<Verdict, string> = { normal: "정상", congested: "정체", stopped: "막힘" };

// 판정 줄 `정체 · ATCC 착륙 대기 …`을 첫 " · "에서 제목과 나머지로 나눈다. 글은 서버가 쓴 그대로다
export function splitLine(line: string): { title: string; rest: string } {
  const at = line.indexOf(" · ");
  return at < 0 ? { title: line, rest: "" } : { title: line.slice(0, at), rest: line.slice(at + 3) };
}

// 칸의 FLIGHT가 모두 가리키는 할 일: 묶음 열쇠(group)이거나 줄 하나의 key. 그 열쇠를 가진 줄의 key를 모두 돌려준다
export function todoKeysOf(todo: readonly { key: string; group?: string | undefined }[], group: string): string[] {
  return todo.filter((t) => t.key === group || t.group === group).map((t) => t.key);
}
