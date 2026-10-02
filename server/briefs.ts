import { findingSeverityOf, isCodexBot } from "./codex-bot.ts";
import type { GhThread, LandingReview } from "./landing.ts";

// DIRECT·VECTORS 지시서(ATC-32). 설계: docs/dispatch.md "DIRECT briefs".
// VECTORS: 지금까지의 지시서(번호 붙은 단계, 긴 템플릿, 모호하면 먼저 묻기).
// DIRECT: 목표, 완료 기준, 이 작업만의 제약만 담고 "끝까지 한 번에"를 적은 지시서. 모호한 것은 PILOT'S DISCRETION.
// 둘을 LOGBOOK 기록으로 비교한다: 중간 질문 수, READBACK → PR 시간, P0–P2 지적, PR 뒤 수정 커밋.

export type BriefKind = "DIRECT" | "VECTORS";
export const BRIEF_KINDS: BriefKind[] = ["VECTORS", "DIRECT"];
export const DIRECT_LINE = "BRIEF: DIRECT";
export const FINISH_LINE = "Carry it through to the end; stop and ask only for what needs a SUPERVISOR decision.";
export const DISCRETION_LINE = "Where it is ambiguous, use PILOT'S DISCRETION: pick a reasonable default and record it in the PR.";

// 지시서 머리 줄. `BRIEF: DIRECT`가 있으면 DIRECT, `BRIEF: VECTORS`면 VECTORS, 없으면 null
export function briefLineOf(text: string): BriefKind | null {
  const m = /^\s*BRIEF\s*[:：]\s*(DIRECT|VECTORS)\b/im.exec(text);
  return m ? (m[1].toUpperCase() as BriefKind) : null;
}

// ── 이슈 본문에서 목표·완료 기준·이 작업만의 제약 ──

export const GOAL_RE = /^(?:목표|goals?(?![a-z])|outcome|objective)/;
export const DONE_RE = /^(?:완료\s*(?:기준|조건)|(?:acceptance|done|exit)\s+criteria|acceptance|done\s+when|definition\s+of\s+done)/;
export const CONSTRAINT_RE = /^(?:이\s*작업만의\s*제약|필수\s*제약|제약|hard\s+constraints|constraints|금지|forbidden|invariants|not\s+in\s+scope|out\s+of\s+scope)/;
const KNOWN = [GOAL_RE, DONE_RE, CONSTRAINT_RE, /^(?:수정\s*허용\s*범위|허용\s*범위|allowed\s|scope|verification|context|why|배경)/];

interface Label {
  i: number;
  level: number; // 마크다운 제목은 # 수, 굵은 줄·평문 이름표는 7
  title: string; // 소문자, 앞 번호·끝 콜론 뗌
  rest: string; // 같은 줄에 이어 쓴 내용(`**Goal:** x`, `목표: x`)
}
const clean = (s: string) => s.replace(/^\d+[.)]\s*/, "").replace(/[:：]\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
// 칸 제목 줄: 마크다운 제목, 굵은 글씨로 시작하는 줄, 아는 칸 이름으로 시작하는 평문 이름표(`완료 기준: …`)
export function labelOf(line: string, i = 0): Label | null {
  const h = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (h) return { i, level: h[1].length, title: clean(h[2]), rest: "" };
  const b = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:：]?\s*(.*)$/.exec(line);
  if (b) return { i, level: 7, title: clean(b[1]), rest: b[2].trim() };
  const p = /^\s*([^\s:：#*\-|>`][^:：\n]{0,29}?)\s*[:：]\s*(.*)$/.exec(line);
  if (p && KNOWN.some((re) => re.test(clean(p[1])))) return { i, level: 7, title: clean(p[1]), rest: p[2].trim() };
  return null;
}

// 긴 칸은 줄 경계에서 자른다(나머지는 링크의 이슈 본문). 목표에만 쓴다 — 완료 기준·제약은 자르지 않는다(ATC-35)
export const GOAL_MAX = 600;
export function clip(text: string, max = GOAL_MAX): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max);
  return `${text.slice(0, cut > max / 2 ? cut : max).trimEnd()} …`;
}

// ── 이슈 본문의 글을 쓴 그대로(ATC-58) ──
// Linear는 본문을 저장할 때 마크다운 문자를 역슬래시로 이스케이프하고(`~31 K` → `\~31 K`), 이슈 언급을 긴 URL 링크로 둔다.
// 지시서에는 쓴 그대로 싣는다: 이스케이프를 풀고, Linear 이슈 링크는 key만, PR 리뷰 링크는 링크 글만 남긴다(ATC-70). 코드(`…`, ``` 블록) 안은 건드리지 않는다.
const ISSUE_URL = String.raw`https?://linear\.app/[^/\s)>\]]+/issue/([A-Za-z][A-Za-z0-9]*-\d+)(?:[/?#][^\s)>\]]*)?`;
const ISSUE_LINK_RE = new RegExp(String.raw`(?<!\\)\[([^\]\n]*)\]\((${ISSUE_URL})\)`, "g"); // [텍스트](이슈 URL)
const ISSUE_AUTOLINK_RE = new RegExp(`<${ISSUE_URL}>`, "g"); // <이슈 URL>
const ISSUE_BARE_RE = new RegExp(`(?<![\\w/(<\\[])${ISSUE_URL}`, "g"); // 맨 URL
// Linear가 PR 언급을 자기 리뷰 쪽 링크로 둔 것(ATC-70): [chaehy5665/atc#134](https://linear.app/<워크스페이스>/review/<slug>)
const REVIEW_LINK_RE = /(?<!\\)\[([^\]\n]*)\]\(https?:\/\/linear\.app\/[^/\s)>\]]+\/review\/[^\s)>\]]+\)/g;
const ESCAPE_RE = /\\([!-/:-@[-`{-~])/g; // CommonMark 역슬래시 이스케이프(ASCII 구두점)

// 코드가 아닌 조각 하나: PR 리뷰 링크 → 링크 글, 이슈 링크 → key, 그다음 이스케이프 풀기
function plainPart(t: string): string {
  return t
    .replace(REVIEW_LINK_RE, (all, text: string) => (text.trim() ? text.trim() : all)) // 글이 없으면 링크를 그대로 둔다
    .replace(ISSUE_LINK_RE, (_all, text: string, _url: string, key: string) => {
      const label = text.replace(ESCAPE_RE, "$1").trim();
      // 언급(텍스트가 key나 URL)이면 key만, 따로 쓴 글이면 글 뒤에 key
      return !label || label.toUpperCase() === key.toUpperCase() || /^https?:\/\//.test(label) ? key : `${label} (${key})`;
    })
    .replace(ISSUE_AUTOLINK_RE, (_all, key: string) => key)
    .replace(ISSUE_BARE_RE, (all: string, key: string) => key + (/[.,;:!?]+$/.exec(all)?.[0] ?? "")) // 문장 끝 구두점은 남긴다
    .replace(ESCAPE_RE, "$1");
}

// from부터 백틱이 정확히 n개인 다음 묶음의 시작. 없으면 -1
function closingRun(line: string, from: number, n: number): number {
  for (let j = from; j < line.length; ) {
    if (line[j] !== "`") {
      j++;
      continue;
    }
    let k = j;
    while (line[k] === "`") k++;
    if (k - j === n) return j;
    j = k;
  }
  return -1;
}

// 한 줄(펜스 밖): 코드 스팬(같은 수의 백틱으로 닫힌 것)은 그대로, 나머지만 plainPart. `\``처럼 이스케이프된 백틱은 코드를 열지 않는다
function plainLine(line: string): string {
  let out = "";
  let text = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\" && i + 1 < line.length) {
      text += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (line[i] === "`") {
      let n = 1;
      while (line[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const j = closingRun(line, i + n, n);
      if (j !== -1) {
        out += plainPart(text) + line.slice(i, j + n);
        text = "";
        i = j + n;
        continue;
      }
      text += fence;
      i += n;
      continue;
    }
    text += line[i];
    i++;
  }
  return out + plainPart(text);
}

// 이슈 본문에서 뗀 글 → 지시서에 실을 글. 펜스 블록(``` · ~~~) 안의 줄은 그대로(순수)
export function briefTextOf(md: string): string {
  const lines = md.split("\n");
  let fence: { ch: string; n: number } | null = null;
  return lines
    .map((line) => {
      const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (m && m[1][0] === fence.ch && m[1].length >= fence.n && !/\S/.test(line.slice(line.indexOf(m[1]) + m[1].length))) fence = null;
        return line;
      }
      if (m) {
        fence = { ch: m[1][0]!, n: m[1].length };
        return line;
      }
      return plainLine(line);
    })
    .join("\n");
}

export interface DirectSections {
  goal: string | null;
  done: string | null;
  constraints: string | null;
}
// 칸 제목과 그 내용(제목 줄에 이어 쓴 것 + 다음 같은 급 이하 제목 전까지)
export function sectionsOfMd(md: string | null | undefined): { title: string; text: string }[] {
  const lines = (md ?? "").split("\n");
  const labels = lines.map((l, i) => labelOf(l, i)).filter((x) => x !== null);
  return labels.map((h) => {
    const next = labels.find((x) => x.i > h.i && x.level <= h.level);
    return { title: h.title, text: [h.rest, ...lines.slice(h.i + 1, next?.i ?? lines.length)].join("\n").trim() };
  });
}

export function directSectionsOf(md: string | null | undefined): DirectSections {
  const sections = sectionsOfMd(md);
  // 쓴 그대로(ATC-58) 풀어서 싣는다. 목표 600자는 푼 글로 잰다
  const take = (re: RegExp) => {
    const got = sections.filter((x) => re.test(x.title) && x.text).map((x) => briefTextOf(x.text));
    return got.length ? got.join("\n") : null;
  };
  const goal = take(GOAL_RE);
  return { goal: goal && clip(goal), done: take(DONE_RE), constraints: take(CONSTRAINT_RE) };
}

// 지시서 본문(목표·완료 기준·제약)의 상한. 보통 이슈(ATC-34 본문 약 3,200자)는 자르지 않고 들어간다.
// 넘으면 완료 기준·제약을 일부만 싣지 않는다 — 앞부분만 보이면 빠진 금지 항목을 놓친다(ATC-35).
// 대신 목표만 두고 FULL_TEXT_LINE 한 줄로 이슈 본문을 읽으라고 적는다
export const BRIEF_BODY_MAX = 4000;
export const FULL_TEXT_LINE = "Read the full done criteria and constraints in the issue body.";

// DIRECT 지시서의 본문 줄(머리 줄과 끝 줄 사이). 여러 줄이면 이름표 다음 줄부터
export function directLines(s: DirectSections): string[] {
  // 여러 줄이거나 한 줄이라도 목록 항목(`* x`, `- x`, `1. x`)이면 이름표 다음 줄부터(ATC-58)
  const field = (name: string, v: string) => (v.includes("\n") || /^\s*(?:[*+-]|\d+[.)])\s/.test(v) ? `${name}:\n${v}` : `${name}: ${v}`);
  const goal = s.goal ? field("Goal", s.goal) : null;
  const rest = [field("Done when", s.done ?? "Follow the done criteria in the issue body (link)."), s.constraints ? field("Constraints", s.constraints) : null].filter((x) => x !== null);
  if ((goal?.length ?? 0) + rest.reduce((n, x) => n + x.length + 1, 0) > BRIEF_BODY_MAX) return [goal, FULL_TEXT_LINE].filter((x) => x !== null);
  return [goal, ...rest].filter((x) => x !== null);
}

// 사용자나 다른 세션이 팀에 붙여 넣을 DIRECT 배정 문구(GET /api/dispatch/flight/:key/brief). FLIGHT PLAN과 같은 모양
export function formatAssignment(t: { key: string; title: string | null; url: string | null }, description: string | null, to: string | null, notes: readonly string[] = []): string {
  return [
    to ? `[→ ${to}] ${t.key}` : t.key,
    DIRECT_LINE,
    t.title,
    t.url,
    ...directLines(directSectionsOf(description)),
    ...notes,
    DISCRETION_LINE,
    `— If you take it, answer "READBACK ${t.key}"; if you cannot, answer with the reason. Tell me the PR number when you open it.`,
    FINISH_LINE,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── 대화 기록에서 지시서·READBACK·질문 ──
// 팀 세션의 대화 기록(.jsonl)에서 필요한 사실만 뽑는다. 본문은 저장하지 않는다.
//   in:  받은 메시지(다른 세션의 cross-session 메시지, 사용자가 친 메시지) — 시각, 보낸 세션, FLIGHT key, D-xxxx, BRIEF 줄
//   out: 보낸 SendMessage — 시각, 받는 곳, FLIGHT key, D-xxxx, READBACK인지, PR 보고인지
//   ask: AskUserQuestion 호출 시각
//   write: 파일을 쓴 도구 호출(Edit·Write·MultiEdit·NotebookEdit) — 시각, 누가(leader·crew), 대상 경로(ATC-33)

export type CrewMode = "SOLO" | "CREW";
export const CREW_MODES: CrewMode[] = ["SOLO", "CREW"];

export interface TalkEvent {
  t: string;
  dir: "in" | "out" | "ask" | "write" | "post";
  from?: string | null; // in: cross-session from(주소). 사용자가 친 메시지면 null
  fromName?: string | null; // in: from-name(ENGINEERING, OCC …)
  to?: string; // out
  keys: string[]; // "ATC-32" 꼴
  ids: string[]; // DISPATCH 제안 id(D-0007)
  brief?: BriefKind | null; // in: BRIEF 줄
  readback?: boolean; // out
  report?: boolean; // out: PR 번호를 알림
  by?: "leader" | "crew"; // write: 본 대화 기록(CAPTAIN)이면 leader, 서브에이전트 기록이면 crew
  path?: string; // write: 쓴 파일(메모리에만 둔다)
  post?: PostTarget; // post: 세션이 GitHub·Linear에 남긴 리뷰·댓글(ATC-72 STAND 없는 FLIGHT의 ARRIVED 후보). 본문은 두지 않는다
}

// 세션이 밖에 남긴 글 하나(ATC-72). 계정이 하나라 GitHub·Linear 작성자로는 팀을 알 수 없어, 그 팀 세션의 도구 호출로 안다
export interface PostTarget {
  kind: "review" | "pr-comment" | "issue-comment" | "linear-comment";
  repo: string | null; // "owner/name"(명령에 적혔을 때만)
  number: number | null; // PR·이슈 번호(GitHub)
  issue: string | null; // Linear 이슈 key
  url: string | null; // 본문의 첫 링크(결과 링크)
}

// Bash 명령 하나 → 밖에 남긴 글. gh pr review|comment, gh issue comment, gh api …/pulls/N/reviews, …/issues/N/comments
export function ghPostOf(command: string): PostTarget | null {
  const repo = /(?:--repo|-R)[\s=]+['"]?([\w.-]+\/[\w.-]+)/.exec(command)?.[1] ?? null;
  const url = firstUrl(command.replace(/https:\/\/api\.github\.com\S*/g, ""));
  const cli = /\bgh\s+(pr|issue)\s+(review|comment)\s+(?:[^\s]*?\/pull\/|#)?(\d+)\b/.exec(command);
  if (cli) {
    const kind = cli[1] === "issue" ? "issue-comment" : cli[2] === "review" ? "review" : "pr-comment";
    return { kind, repo, number: Number(cli[3]), issue: null, url };
  }
  const api = /\bgh\s+api\b[^|;&]*?\brepos\/([\w.-]+\/[\w.-]+)\/(pulls|issues)\/(\d+)\/(reviews|comments)\b/.exec(command);
  // 읽기(GET)는 뺀다: -f/-F/--input/-X POST 중 하나가 있어야 쓰기
  if (api && /\s(-f|-F|--field|--raw-field|--input)\s|-X\s*POST|--method\s+POST/.test(command)) {
    const kind = api[4] === "reviews" ? "review" : api[2] === "pulls" ? "review" : "pr-comment";
    return { kind, repo: api[1], number: Number(api[3]), issue: null, url };
  }
  return null;
}
const firstUrl = (text: string) => /https?:\/\/[^\s'"`)<>\]]+/.exec(text)?.[0]?.replace(/[.,;:]+$/, "") ?? null;

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// Linear MCP의 댓글 쓰기 도구(이름 끝)
const LINEAR_COMMENT = /(^|__)(save_comment|create_comment)$/;

const keysIn = (text: string) => {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9})-(\d{1,6})(?!\d)/g)) out.add(`${m[1]}-${Number(m[2])}`);
  for (const m of text.matchAll(/\bFLIGHT\s+([A-Z]{2,10})(\d{1,6})\b/g)) out.add(`${m[1]}-${Number(m[2])}`);
  return [...out];
};
const idsIn = (text: string) => [...new Set([...text.matchAll(/\b(D-\d{4,})\b/g)].map((m) => m[1]))];
const attr = (head: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(head)?.[1] ?? null;

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text as string);
  return texts.length ? texts.join("\n") : null;
}

// 대화 기록 조각(여러 줄) → 사건. 도구 결과는 뺀다.
// leader: CAPTAIN의 본 대화 기록 — 서브에이전트 줄(isSidechain)은 빼고 모든 사건.
// crew: 서브에이전트 기록(subagents/agent-*.jsonl) — 파일 쓰기(write)만
export function talkEventsOf(text: string, source: "leader" | "crew" = "leader"): TalkEvent[] {
  const out: TalkEvent[] = [];
  const crew = source === "crew";
  for (const line of text.split("\n")) {
    if (!line || !(line.includes('"tool_use"') || (!crew && (line.includes('"type":"user"') || line.includes("READBACK"))))) continue;
    let d: { type?: string; timestamp?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if ((d.isSidechain && !crew) || typeof d.timestamp !== "string") continue;
    const t = d.timestamp;
    if (d.type === "user" && !crew) {
      const body = textOf(d.message?.content);
      if (!body) continue;
      const cross = /<cross-session-message\b([^>]*)>/.exec(body);
      // skill 본문·시스템 알림(isMeta)은 받은 지시가 아니다. cross-session 메시지는 isMeta여도 받는다
      if (!cross && d.isMeta) continue;
      const keys = keysIn(body);
      const ids = idsIn(body);
      if (!keys.length && !ids.length) continue;
      out.push({ t, dir: "in", from: cross ? attr(cross[1], "from") : null, fromName: cross ? attr(cross[1], "from-name") : null, keys, ids, brief: briefLineOf(body) });
    } else if (d.type === "assistant" && Array.isArray(d.message?.content)) {
      for (const b of d.message.content as { type?: string; name?: string; input?: { to?: unknown; message?: unknown; file_path?: unknown; notebook_path?: unknown } }[]) {
        // 지시서가 사용자 붙여넣기로 오면 READBACK도 SendMessage가 아닌 답 글로 나간다(ATC-72: 직접 배정의 착수)
        if (b?.type === "text" && !crew) {
          const text = (b as { text?: unknown }).text;
          const rb = typeof text === "string" ? /^\s*READBACK\s+((?:[A-Z][A-Z0-9]{1,9}-\d{1,6}|D-\d{4,})(?:[,\s]+(?:[A-Z][A-Z0-9]{1,9}-\d{1,6}|D-\d{4,}))*)/m.exec(text) : null;
          if (rb) out.push({ t, dir: "out", to: "", keys: keysIn(rb[1]), ids: idsIn(rb[1]), readback: true, report: false });
          continue;
        }
        if (b?.type !== "tool_use") continue;
        // 밖에 남긴 리뷰·댓글(ATC-72). CREW(서브에이전트)가 단 것도 그 팀의 것이다
        const input = b.input as Record<string, unknown> | undefined;
        if (b.name === "Bash" && typeof input?.command === "string") {
          const post = ghPostOf(input.command);
          if (post) out.push({ t, dir: "post", by: source, post, keys: keysIn(input.command), ids: [] });
        }
        if (LINEAR_COMMENT.test(b.name ?? "") && input) {
          const body = typeof input.body === "string" ? input.body : "";
          const issue = [input.issueId, input.issue, input.id].find((v): v is string => typeof v === "string" && /^[A-Z][A-Z0-9]*-\d+$/.test(v)) ?? null;
          if (issue) out.push({ t, dir: "post", by: source, post: { kind: "linear-comment", repo: null, number: null, issue, url: firstUrl(body) }, keys: keysIn(`${issue} ${body}`), ids: [] });
        }
        if (WRITE_TOOLS.has(b.name ?? "")) {
          const path = b.input?.file_path ?? b.input?.notebook_path;
          if (typeof path === "string" && path.startsWith("/")) out.push({ t, dir: "write", by: source, path, keys: [], ids: [] });
          continue;
        }
        if (crew) continue;
        // CAPTAIN이 Bash(python·sed 등)로 고친 것도 잡으려고, 명령에 적힌 /home/… 경로를 CAPTAIN 작업으로 센다. 명령 본문은 두지 않는다
        if (b.name === "Bash" && typeof (b.input as { command?: unknown })?.command === "string") {
          const paths = new Set(((b.input as { command: string }).command.match(/\/home\/[^\s'"`;|&()<>]+/g) ?? []).map((x) => x.replace(/[,.:]+$/, "")));
          for (const path of paths) out.push({ t, dir: "write", by: "leader", path, keys: [], ids: [] });
          continue;
        }
        if (b.name === "AskUserQuestion") out.push({ t, dir: "ask", keys: [], ids: [] });
        if (b.name !== "SendMessage") continue;
        const msg = typeof b.input?.message === "string" ? b.input.message : JSON.stringify(b.input?.message ?? "");
        out.push({
          t,
          dir: "out",
          to: String(b.input?.to ?? ""),
          keys: keysIn(msg),
          ids: idsIn(msg),
          readback: /\bREADBACK\b/.test(msg),
          report: /\bPR\s*#\d+|\/pull\/\d+/.test(msg),
        });
      }
    }
  }
  return out;
}

export interface BriefFacts {
  kind: BriefKind;
  at: string; // 지시서를 받은 시각
  by: string | null; // 보낸 세션 이름(ENGINEERING, OCC …). 사용자가 쳤으면 null
  readbackAt: string | null;
  questions: number; // READBACK(없으면 지시서) 뒤 PR을 열기 전까지, 지시한 쪽에 보낸 메시지와 AskUserQuestion
}
const BRIEF_LOOKBACK_MS = 14 * 86_400_000;
const NO_READBACK_SLACK_MS = 12 * 3_600_000;

// FLIGHT 하나의 지시서. 지시서 = 그 FLIGHT를 언급한 받은 메시지 중
//   READBACK이 있으면 그 READBACK 직전의 것, 없으면 착수 12시간 전 이후의 첫 것(그것도 없으면 마지막 것).
// READBACK = 첫 언급 뒤 보낸 READBACK 중 그 FLIGHT key나 받은 D-xxxx를 담은 첫 것. 못 찾으면 null(모름)
export function briefFactsOf(events: TalkEvent[], flight: string, openedAt: string, departedAt: string): BriefFacts | null {
  const open = Date.parse(openedAt);
  const ins = events.filter((e) => e.dir === "in" && e.keys.includes(flight) && Date.parse(e.t) <= open && Date.parse(e.t) >= open - BRIEF_LOOKBACK_MS);
  if (!ins.length) return null;
  const ids = new Set(ins.flatMap((e) => e.ids));
  const rb = events.find((e) => e.dir === "out" && e.readback && e.t >= ins[0].t && Date.parse(e.t) <= open && (e.keys.includes(flight) || e.ids.some((id) => ids.has(id))));
  const dep = Date.parse(departedAt) - NO_READBACK_SLACK_MS;
  const brief = rb ? ins.filter((e) => e.t <= rb.t).at(-1)! : (ins.find((e) => Date.parse(e.t) >= dep) ?? ins.at(-1)!);
  const from = (rb ?? brief).t;
  const toBriefer = (to: string | undefined) => Boolean(to && ((brief.from && to === brief.from) || (brief.fromName && to === brief.fromName)));
  const questions = events.filter(
    (e) => e.t > from && Date.parse(e.t) < open && (e.dir === "ask" || (e.dir === "out" && !e.readback && !e.report && toBriefer(e.to))),
  ).length;
  return { kind: brief.brief === "DIRECT" ? "DIRECT" : "VECTORS", at: brief.t, by: brief.fromName ?? null, readbackAt: rb?.t ?? null, questions };
}

// ── SOLO·CREW(ATC-33): FLIGHT를 CAPTAIN 혼자 구현했나, 팀원에게 나눴나 ──
// 신호: FLIGHT의 STAND 안 파일을 쓴 도구 호출. 서브에이전트(crew)가 Edit·Write 등으로 문서 밖 파일을 하나라도 썼으면
// CREW, 아니고 CAPTAIN(leader)이 STAND 안에서 일했으면(쓰기, 또는 STAND 경로를 적은 Bash) SOLO.
// 문서(.md·.mdx·.txt)만 쓴 서브에이전트는 도움으로 본다. 서브에이전트의 Bash는 세지 않는다(대개 시험 실행).
// STAND 안 흔적이 하나도 없으면(다른 세션이 했거나 기록이 없음) null — 모름.
const DOC_FILE = /\.(?:md|mdx|txt)$/i;
export function crewModeOf(events: TalkEvent[], stands: string[], from: string, to: string): CrewMode | null {
  if (!stands.length) return null;
  const inStand = (p: string) => stands.some((s) => p === s || p.startsWith(`${s}/`));
  const [lo, hi] = [Date.parse(from), Date.parse(to)];
  const writes = events.filter((e) => e.dir === "write" && e.path && Date.parse(e.t) >= lo && Date.parse(e.t) <= hi && inStand(e.path) && !DOC_FILE.test(e.path));
  if (writes.some((e) => e.by === "crew")) return "CREW";
  if (writes.some((e) => e.by === "leader")) return "SOLO";
  return null;
}

// ── GitHub 쪽: P0–P2 지적, PR 뒤 수정 커밋 ──

export interface Findings {
  p0: number;
  p1: number;
  p2: number;
}
// Codex 인라인 지적(스레드 첫 댓글이 Codex, 배지가 없으면 P2) + 착륙 리뷰(head마다 마지막 리뷰의 P0–P2)
export function findingsOf(threads: Pick<GhThread, "comments">[], reviews: LandingReview[], repo: string, number: number): Findings {
  const out: Findings = { p0: 0, p1: 0, p2: 0 };
  for (const t of threads) {
    const first = t.comments[0];
    if (!first || !isCodexBot(first.author)) continue;
    const sev = findingSeverityOf(first.body) ?? 2;
    if (sev <= 2) out[`p${sev}` as keyof Findings]++;
  }
  const byHead = new Map<string, LandingReview>();
  for (const r of reviews) if (r.repo === repo && r.number === number) byHead.set(r.head, r);
  for (const r of byHead.values()) {
    out.p0 += r.p0;
    out.p1 += r.p1;
    out.p2 += r.p2;
  }
  return out;
}

export interface GhCommit {
  authoredDate: string;
  messageHeadline: string;
}
// PR을 연 뒤 새로 쓴 커밋 수(병합 커밋 제외). rebase해도 authoredDate는 그대로라 다시 세지 않는다
export function reworkOf(commits: GhCommit[], openedAt: string): number {
  const open = Date.parse(openedAt);
  return commits.filter((c) => Date.parse(c.authoredDate) > open && !/^Merge\b/.test(c.messageHeadline)).length;
}

// ── VECTORS 대 DIRECT 비교 ──

export interface Measured {
  brief?: BriefFacts | null; // null: 지시서를 찾지 못함(AD HOC 포함). 없으면 아직 안 잼
  findings?: Findings;
  rework?: number;
  crew?: CrewMode | null; // SOLO·CREW(ATC-33). null: 모름. 없으면 아직 안 잼
}
export interface BriefRow {
  key: string;
  flight: string | null;
  aircraft: string | null;
  arrivedAt: string;
  kind: BriefKind;
  crew: CrewMode | null;
  by: string | null;
  questions: number;
  readbackToPrMin: number;
  findings: number | null; // P0+P1+P2
  rework: number | null;
}
export interface BriefStats {
  flights: number;
  questionsPerFlight: number | null;
  oneShot: number | null; // 질문 없이 PR까지 간 비율
  readbackToPrMedianMin: number | null;
  findingsPerFlight: number | null; // P0–P2
  findingsMeasured: number;
  reworkPerFlight: number | null;
  reworkMeasured: number;
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

export function briefRowOf(e: { key: string; flight: string | null; aircraft: string | null; arrivedAt: string; landingWaitMin: number; measured?: Measured }): BriefRow | null {
  const b = e.measured?.brief;
  if (!b) return null;
  const opened = Date.parse(e.arrivedAt) - e.landingWaitMin * 60_000;
  const f = e.measured?.findings;
  return {
    key: e.key,
    flight: e.flight,
    aircraft: e.aircraft,
    arrivedAt: e.arrivedAt,
    kind: b.kind,
    crew: e.measured?.crew ?? null,
    by: b.by,
    questions: b.questions,
    readbackToPrMin: Math.max(0, Math.round((opened - Date.parse(b.readbackAt ?? b.at)) / 60_000)),
    findings: f ? f.p0 + f.p1 + f.p2 : null,
    rework: e.measured?.rework ?? null,
  };
}

export function briefStatsOf(rows: BriefRow[]): BriefStats {
  const f = rows.flatMap((r) => (r.findings === null ? [] : [r.findings]));
  const w = rows.flatMap((r) => (r.rework === null ? [] : [r.rework]));
  return {
    flights: rows.length,
    questionsPerFlight: mean(rows.map((r) => r.questions)),
    oneShot: rows.length ? Math.round((rows.filter((r) => r.questions === 0).length / rows.length) * 100) / 100 : null,
    readbackToPrMedianMin: median(rows.map((r) => r.readbackToPrMin)),
    findingsPerFlight: mean(f),
    findingsMeasured: f.length,
    reworkPerFlight: mean(w),
    reworkMeasured: w.length,
  };
}

// 기간 안에 도착한 FLIGHT를 지시서 종류별로, SOLO·CREW별로, 둘을 겹쳐(2×2) 나눈다.
// unmeasured: 아직 재지 않았거나 지시서를 못 찾은 수. crewUnknown: 행 중 SOLO·CREW를 모르는 수
export type GridKey = `${BriefKind}·${CrewMode}`;
export function compareBriefs(
  entries: Parameters<typeof briefRowOf>[0][],
  now: number,
  days: number,
): { rows: BriefRow[]; stats: Record<BriefKind, BriefStats>; crewStats: Record<CrewMode, BriefStats>; grid: Record<GridKey, BriefStats>; unmeasured: number; crewUnknown: number } {
  const since = now - days * 86_400_000;
  const inWindow = entries.filter((e) => Date.parse(e.arrivedAt) >= since && Date.parse(e.arrivedAt) <= now);
  const rows = inWindow.map(briefRowOf).filter((r) => r !== null).sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
  const grid = {} as Record<GridKey, BriefStats>;
  for (const k of BRIEF_KINDS) for (const c of CREW_MODES) grid[`${k}·${c}`] = briefStatsOf(rows.filter((r) => r.kind === k && r.crew === c));
  return {
    rows,
    stats: { VECTORS: briefStatsOf(rows.filter((r) => r.kind === "VECTORS")), DIRECT: briefStatsOf(rows.filter((r) => r.kind === "DIRECT")) },
    crewStats: { SOLO: briefStatsOf(rows.filter((r) => r.crew === "SOLO")), CREW: briefStatsOf(rows.filter((r) => r.crew === "CREW")) },
    grid,
    unmeasured: inWindow.length - rows.length,
    crewUnknown: rows.filter((r) => r.crew === null).length,
  };
}
