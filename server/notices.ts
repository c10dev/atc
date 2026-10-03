import type { PullRequest } from "./model.ts";
import type { QueueItem } from "./supervisor-queue.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";

// NOTICES(ATC-447, docs/layout.md 7.2·E4): 사이드바 머리의 알림 세 개(Linear·GitHub·atc)가 그릴 목록. 무엇을 셀지는 여기서 정한다(design-language 원칙 4).
// 새 바깥 호출은 없다 — 스냅샷의 PR, 발권 화면의 READY 목록, SUPERVISOR QUEUE, 알림 목록을 그대로 읽는다. 순수 함수.
export const NOTICE_MAX = 30; // 한 묶음에 싣는 최대 줄 수. 넘치면 total이 실제 수를 말한다

export interface Notice {
  key: string; // 같은 일이면 늘 같은 key
  text: string; // 한 줄
  source: string; // 출처 줄(예: "Linear · READY for release")
  at: string | null; // 시각(ISO). 모르면 null
  link: string; // 바깥 주소(https) 또는 화면 주소(#hash)
  action?: boolean; // atc 묶음만: 조치가 필요한 항목(WARNING·CAUTION·SUPERVISOR 대기). 숫자는 이것만 센다
}
export interface NoticeGroup {
  total: number; // 줄이 잘렸어도 실제 수
  items: Notice[];
}
export interface Notices {
  v: 1;
  at: string;
  linear: NoticeGroup;
  github: NoticeGroup;
  atc: NoticeGroup;
}

export interface NoticesInput {
  now: number;
  ready: { key: string; title: string; priority: number }[]; // 발권할 수 있는 READY FLIGHT(GET /api/releases의 ready)
  tickets: { key: string; url: string | null }[];
  pulls: Pick<PullRequest, "number" | "title" | "url" | "draft" | "blocks" | "createdAt" | "head">[];
  queue: readonly Pick<QueueItem, "kind" | "key" | "since" | "title" | "hash">[];
  alerts: readonly SupervisorAlert[];
}

const group = (items: Notice[]): NoticeGroup => ({ total: items.length, items: items.slice(0, NOTICE_MAX) });
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// 조치가 필요한 것(web/src/supervisor-alerts.ts의 needsAction과 같은 규칙): WARNING·CAUTION이거나 SUPERVISOR를 기다리는 것
export const alertNeedsAction = (a: Pick<SupervisorAlert, "level" | "cue">) => a.level === "warning" || a.level === "caution" || a.cue === "call";

export function noticesOf(i: NoticesInput): Notices {
  const urlOf = new Map(i.tickets.map((t) => [t.key, t.url]));
  // 우선순위 순(1 긴급 … 4 낮음, 0 없음은 맨 뒤), 같으면 key 순
  const rank = (p: number) => (p === 0 ? 5 : p);
  const linear = [...i.ready]
    .sort((a, b) => rank(a.priority) - rank(b.priority) || a.key.localeCompare(b.key, "en", { numeric: true }))
    .map<Notice>((t) => ({ key: `linear|ready|${t.key}`, text: `${t.key} ${clip(t.title)}`, source: "Linear · READY for release", at: null, link: urlOf.get(t.key) ?? "#release" }));

  const pullOf = (key: string) => {
    const m = /#(\d+)@/.exec(key);
    return m ? i.pulls.find((p) => p.number === Number(m[1])) : undefined;
  };
  const waiting = i.queue
    .filter((q) => q.kind === "LANDING")
    .map((q) => {
      const p = pullOf(q.key);
      const n: Notice = { key: `github|merge|${q.key}`, text: p ? `PR #${p.number} ${clip(p.title)}` : q.title, source: "GitHub · waits for you to merge", at: p?.createdAt ?? q.since, link: p?.url ?? q.hash };
      return { n, pr: p?.number };
    });
  const waitingPrs = new Set(waiting.map((w) => w.pr));
  const failed = i.pulls
    .filter((p) => !p.draft && !waitingPrs.has(p.number) && p.blocks.some((b) => b.code === "checks-failed"))
    .map<Notice>((p) => ({ key: `github|checks|${p.number}@${p.head}`, text: `PR #${p.number} ${clip(p.title)}`, source: "GitHub · checks failed", at: p.createdAt, link: p.url }));
  const github = [...waiting.map((w) => w.n), ...failed];

  const atc = i.alerts.map<Notice>((a) => ({
    key: a.key,
    text: a.text,
    source: ["atc", a.level ? a.level.toUpperCase() : a.cue === "call" ? "CALL" : "INFO", [a.aircraft, a.flight].filter(Boolean).join(" · ")].filter(Boolean).join(" · "),
    at: a.since,
    link: a.link,
    action: alertNeedsAction(a),
  }));

  return { v: 1, at: new Date(i.now).toISOString(), linear: group(linear), github: group(github), atc: group(atc) };
}
