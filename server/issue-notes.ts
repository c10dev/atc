// NOTES FROM THE ISSUE(ATC-271): FLIGHT PLAN과 DIRECT 지시서에 이슈 댓글 가운데 SUPERVISOR가 쓴 것을 싣는다. 순수 함수만.
// 이전에는 이슈 본문만 CAPTAIN에게 갔다. ENGINEERING이 이어받을 점을 Linear 댓글로 남겨도 팀은 그것을 몰랐다.

export interface IssueComment {
  body?: unknown;
  createdAt?: unknown;
  user?: { displayName?: unknown } | null;
}
export interface NotesConfig {
  users: string[]; // SUPERVISOR 대신 쓰는 Linear 사용자(displayName). 비면 봇·연동이 아닌 댓글 모두
  maxComments: number;
  maxChars: number;
}
export const DEFAULT_NOTES: NotesConfig = { users: [], maxComments: 3, maxChars: 2000 };

const BOT_NAME = /bot\b|\[bot\]|linear|integration|slack|sentry|vercel|^git ?hub/i;
// 연동이 다는 댓글: 링크백, 자동 문구
const LINKBACK = /linear-linkback|^\s*<!--|^\s*\[?\s*(?:pull request|pr)\s*#?\d+\s*\]?\(?https?:\S*\)?\s*$/i;

const textOf = (c: IssueComment) => (typeof c.body === "string" ? c.body.trim() : "");
const nameOf = (c: IssueComment) => (c.user && typeof c.user.displayName === "string" ? c.user.displayName : null);

// 이 댓글이 SUPERVISOR의 것인가. 사용자가 없으면(연동·앱이 쓴 댓글) 아니다
export function isSupervisorComment(c: IssueComment, cfg: NotesConfig = DEFAULT_NOTES): boolean {
  const name = nameOf(c);
  const text = textOf(c);
  if (!name || !text) return false;
  if (LINKBACK.test(text)) return false;
  if (cfg.users.length) return cfg.users.some((u) => u.toLowerCase() === name.toLowerCase());
  return !BOT_NAME.test(name);
}

// `NOTES FROM THE ISSUE` 줄들(없으면 빈 배열). 댓글은 쓴 그대로, 가장 새것이 맨 뒤.
// maxComments·maxChars를 넘으면 오래된 쪽부터 뺀다. 뺀 것이 있으면 마지막에 "more in the issue"
export function flightPlanNotesOf(comments: readonly IssueComment[] | null | undefined, cfg: NotesConfig = DEFAULT_NOTES, url?: string | null): string[] {
  const mine = (comments ?? [])
    .filter((c) => isSupervisorComment(c, cfg))
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  if (!mine.length) return [];
  const picked: string[] = [];
  let used = 0;
  for (let i = mine.length - 1; i >= 0 && picked.length < cfg.maxComments; i--) {
    const t = textOf(mine[i]);
    if (picked.length && used + t.length > cfg.maxChars) break;
    // 한 댓글이 한도를 넘으면 자르고 표시한다(가장 새 댓글은 늘 넣는다)
    const cut = t.length > cfg.maxChars ? `${t.slice(0, cfg.maxChars).trimEnd()}…` : t;
    picked.unshift(cut);
    used += cut.length;
  }
  const more = picked.length < mine.length || mine.some((c) => textOf(c).length > cfg.maxChars);
  return [
    "NOTES FROM THE ISSUE (comments by the SUPERVISOR, newest last):",
    ...picked.map((t) => `> ${t.replace(/\n/g, "\n> ")}`),
    ...(more ? [`(more in the issue${url ? `: ${url}` : ""})`] : []),
  ];
}
