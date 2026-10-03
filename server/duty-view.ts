// DUTY 대화를 읽기 좋게 보이는 순수 규칙(ATC-477, docs/duty-screen.md). 화면(web/src/DutyChat.tsx)과 시험이 같이 쓴다.
// 접기(leadOf), 블록 나누기(blocksOf), choices 블록(choicesOf), 도구 줄 접기(foldTools), SHIFT 목록, 맨 아래 붙기 규칙.
import type { ChatItem } from "./duty-chat.ts";

export interface Block {
  kind: "paragraph" | "list" | "table" | "code" | "heading";
  text: string;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const LIST = /^\s{0,3}([-*+]|\d+[.)])\s+/;
const TABLE = /^\s*\|/;
const HEADING = /^\s{0,3}#{1,6}\s/;

// Markdown을 블록으로 자른다: 펜스 코드, 표, 목록, 제목, 문단. 펜스 안은 빈 줄이 있어도 한 블록이고, 닫히지 않은 펜스는 끝까지다
export function blocksOf(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  const push = (kind: Block["kind"], from: number, to: number) => out.push({ kind, text: lines.slice(from, to).join("\n") });
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1][0];
      const min = fence[1].length;
      let j = i + 1;
      while (j < lines.length) {
        const m = FENCE.exec(lines[j]);
        if (m && m[1][0] === mark && m[1].length >= min && lines[j].trim().replace(/[`~]/g, "") === "") break;
        j++;
      }
      push("code", i, Math.min(j + 1, lines.length));
      i = j + 1;
      continue;
    }
    if (HEADING.test(line)) {
      push("heading", i, i + 1);
      i++;
      continue;
    }
    if (TABLE.test(line)) {
      let j = i + 1;
      while (j < lines.length && TABLE.test(lines[j])) j++;
      push("table", i, j);
      i = j;
      continue;
    }
    if (LIST.test(line)) {
      let j = i + 1;
      while (j < lines.length) {
        if (lines[j].trim() === "") {
          // 빈 줄 뒤에 항목이나 들여쓴 줄이 이어지면 같은 목록이다
          let k = j;
          while (k < lines.length && lines[k].trim() === "") k++;
          if (k < lines.length && (LIST.test(lines[k]) || /^\s{2,}\S/.test(lines[k]))) {
            j = k + 1;
            continue;
          }
          break;
        }
        if (FENCE.test(lines[j]) || HEADING.test(lines[j]) || TABLE.test(lines[j])) break;
        j++;
      }
      push("list", i, j);
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "" && !FENCE.test(lines[j]) && !HEADING.test(lines[j]) && !TABLE.test(lines[j]) && !LIST.test(lines[j])) j++;
    push("paragraph", i, j);
    i = j;
  }
  return out;
}

const countLines = (s: string) => s.split("\n").length;
export const LEAD_LINES = 3;

// 답을 머리(lead)와 나머지(rest)로 나눈다. 첫 블록부터 합쳐 3줄을 넘지 않을 때까지 담고, 표·목록·코드 안은 자르지 않는다.
// 첫 문단이 3줄보다 길면 그 문단만 3줄에서 자른다. 짧은 답(전체가 3줄 이하)은 나누지 않는다
export function leadOf(src: string): { lead: string; rest: string } {
  const text = src.trim();
  if (countLines(text) <= LEAD_LINES) return { lead: text, rest: "" };
  const blocks = blocksOf(text);
  if (blocks.length === 0) return { lead: text, rest: "" };
  const first = blocks[0];
  if (first.kind === "paragraph" && countLines(first.text) > LEAD_LINES) {
    const ls = first.text.split("\n");
    const lead = ls.slice(0, LEAD_LINES).join("\n");
    const rest = [ls.slice(LEAD_LINES).join("\n"), ...blocks.slice(1).map((b) => b.text)].join("\n\n");
    return { lead, rest };
  }
  let used = 0;
  let n = 0;
  for (const b of blocks) {
    const l = countLines(b.text);
    if (n > 0 && used + l > LEAD_LINES) break;
    used += l;
    n++;
  }
  // 제목으로 끝나면 바로 뒤 블록까지 담는다
  if (blocks[n - 1].kind === "heading" && n < blocks.length) n++;
  if (n >= blocks.length) return { lead: text, rest: "" };
  return { lead: blocks.slice(0, n).map((b) => b.text).join("\n\n"), rest: blocks.slice(n).map((b) => b.text).join("\n\n") };
}

export const CHOICE_MAX = 8;
export const CHOICE_LEN = 200;

// ```choices 펜스를 걷어 낸 본문과 선택지(한 줄에 하나, 목록 기호는 뗀다). 선택지는 입력창을 채울 뿐 보내지 않는다
export function choicesOf(src: string): { text: string; choices: string[] } {
  const choices: string[] = [];
  const blocks = blocksOf(src);
  const kept: string[] = [];
  for (const b of blocks) {
    const open = b.kind === "code" ? /^\s{0,3}(?:`{3,}|~{3,})\s*choices\s*$/i.exec(b.text.split("\n")[0]) : null;
    if (!open) {
      kept.push(b.text);
      continue;
    }
    const body = b.text.split("\n").slice(1);
    if (body.length > 0 && FENCE.test(body[body.length - 1]) && body[body.length - 1].trim().replace(/[`~]/g, "") === "") body.pop();
    for (const l of body) {
      const t = l.replace(LIST, "").trim();
      if (t) choices.push(t.slice(0, CHOICE_LEN));
    }
  }
  return { text: kept.join("\n\n"), choices: choices.slice(0, CHOICE_MAX) };
}

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;
export type Row = { kind: "item"; it: ChatItem } | { kind: "tools"; id: string; items: ToolItem[]; count: number; refused: number; running: string | null };

// 도구 줄을 턴마다 한 줄로 접는다: 이어진 tool 항목이 한 묶음이고, 글이나 사용자 메시지가 끼면 끊긴다.
// thinking 중이고 묶음이 맨 끝이면 마지막 도구가 돌고 있는 것이다(running). 거절 수는 접어도 보인다
export function foldTools(items: readonly ChatItem[], thinking: boolean): Row[] {
  const rows: Row[] = [];
  let group: ToolItem[] = [];
  const flush = (last: boolean) => {
    if (group.length === 0) return;
    rows.push({
      kind: "tools",
      id: group[0].id,
      items: group,
      count: group.length,
      refused: group.filter((t) => t.error).length,
      running: last && thinking ? group[group.length - 1].name : null,
    });
    group = [];
  };
  for (const it of items) {
    if (it.kind === "tool") {
      group.push(it);
      continue;
    }
    flush(false);
    rows.push({ kind: "item", it });
  }
  flush(true);
  return rows;
}

export const toolLabel = (r: { count: number; refused: number }) => `도구 ${r.count}${r.refused > 0 ? ` · 거절 ${r.refused}` : ""}`;

// 왼쪽 열의 SHIFT 목록: 구분선마다 시작 시각과 그 SHIFT의 메시지 수(사용자 + DUTY 글)
export function shiftsOf(items: readonly ChatItem[]): { id: string; t: string; count: number }[] {
  const out: { id: string; t: string; count: number }[] = [];
  for (const it of items) {
    if (it.kind === "shift") out.push({ id: it.id, t: it.t, count: 0 });
    else if ((it.kind === "user" || it.kind === "text") && out.length > 0) out[out.length - 1].count++;
  }
  return out;
}

// 불러온 줄을 거르는 검색(대소문자 무시). 도구 줄은 검색 대상이 아니다
export function itemText(it: ChatItem): string {
  switch (it.kind) {
    case "user":
    case "text":
    case "notice":
      return it.text;
    case "card":
      return `${it.queueKind} ${it.key}`;
    case "draft":
      return `${it.text} ${it.draft}`;
    default:
      return "";
  }
}
export const matchesQuery = (it: ChatItem, q: string): boolean => {
  const needle = q.trim().toLowerCase();
  return needle === "" || itemText(it).toLowerCase().includes(needle);
};

// ── 맨 아래에 붙어 있기 ──
// 로그가 맨 아래에서 이만큼 안에 있으면 붙어 있다고 본다
export const STICK_PX = 40;
export interface Geometry {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}
export const stuckToBottom = (g: Geometry): boolean => g.scrollHeight - g.scrollTop - g.clientHeight < STICK_PX;
// 스크롤 이벤트가 낳는 다음 붙임 상태. 창 크기가 바뀌어 브라우저가 scrollTop을 자른 스크롤은 사용자가 올린 것이 아니므로 이전 상태를 지킨다
export const nextStick = (prev: boolean, g: Geometry, resizing: boolean): boolean => (resizing ? prev : stuckToBottom(g));
// 크기가 바뀐 뒤 붙어 있으면 가야 할 scrollTop, 아니면 null(그대로 둔다)
export const scrollTopAfterResize = (stuck: boolean, g: Pick<Geometry, "scrollHeight" | "clientHeight">): number | null => (stuck ? Math.max(0, g.scrollHeight - g.clientHeight) : null);
