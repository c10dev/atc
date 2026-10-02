// DUTY brief(ATC-219, docs/duty.md 3.3): DUTY가 한 턴을 시작할 때 읽는, atc가 아는 것의 한 장 요약. 순수 함수. 자료 모으기는 duty-api.ts.
// atc의 말(key·REGISTRATION·수)만 싣고 티켓·PR 본문이나 제목은 싣지 않는다. 글자 수 상한을 넘으면 자르고 잘렸다고 적는다.
// D4(ATC-231): 맨 위에 정해 둔 결정(decisions.jsonl의 켜져 있는 것, 가장 최근 briefDecisions개)을 싣는다. 자를 때는 결정을 맨 마지막에 덜어 내고 그렇게 적는다.

export const DEFAULT_BRIEF_MAX_CHARS = 6000;
const MIN_BRIEF_MAX_CHARS = 500;
const HARD_MAX_CHARS = 50_000;
const QUEUE_ROWS = 8;
const ALERT_ROWS = 10;
export const DEFAULT_BRIEF_DECISIONS = 20;
const DECISION_TEXT_MAX = 300;

export interface DutyBriefInput {
  at: string;
  queue: { count: number; counts: Record<string, number>; items: { kind: string; key: string; since: string | null; title: string }[] };
  // 조치가 필요한 알림만(WARNING·CAUTION). 등급을 나누는 것은 부르는 쪽
  alerts: { key: string; level: string | null; aircraft: string | null; flight: string | null; text: string; since: string | null }[];
  fleet: { registration: string; status: string; airport: string | null; account: string | null; flight: string | null; more: number; fuelHold: boolean }[];
  // 진행 중인 FLIGHT(started): key와 상태 이름만
  flights: { key: string; state: string }[];
  // ACCOUNT마다 가장 많이 쓴 FUEL 창
  fuel: { account: string; window: string; pct: number; resetsAt: string; level: string }[];
  // 이어받을 FLIGHT가 없는 PR(ATC-354): 브랜치 이름으로 이슈를 못 찾았고 GO AROUND·FIX가 기다린다. DUTY가 이슈를 만들거나 PR을 정리한다. 저장소 이름과 번호만
  orphanPrs?: { repo: string; pr: number }[];
  // 켜져 있는 정해 둔 결정 전체(오래된 것이 먼저). 싣는 수는 decisionsMax
  decisions?: { id: string; text: string; until: string | null }[];
  decisionsMax?: number;
  // 자동 되돌림(ATC-351, docs/autonomy.md C4): DUTY가 알림으로 받는 기록 줄(최근 것이 뒤). SUPERVISOR 알림이 아니다
  revert?: string[];
}

export interface DutyBrief {
  v: 1;
  at: string;
  chars: number;
  truncated: boolean;
  text: string;
}

// duty.briefMaxChars. 숫자가 아니거나 너무 작거나 크면 기본값
export function briefMaxCharsOf(raw: unknown): number {
  const n = typeof raw === "number" ? raw : NaN;
  return Number.isInteger(n) && n >= MIN_BRIEF_MAX_CHARS && n <= HARD_MAX_CHARS ? n : DEFAULT_BRIEF_MAX_CHARS;
}

// duty.briefDecisions. 정수 1~100만, 아니면 기본 20
export function briefDecisionsOf(raw: unknown): number {
  const n = typeof raw === "number" ? raw : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : DEFAULT_BRIEF_DECISIONS;
}

// 알림 key에는 worktree 경로가 들어 있을 수 있다: 절대 경로는 마지막 마디(STAND 이름)만 남긴다
export const shortKey = (key: string) => key.replace(/\/[^\s|:]+/g, (p) => p.replace(/\/+$/, "").split("/").pop() || p);

// 한 줄이 브리프를 밀어내지 않게 줄 하나를 자른다(알림 문구 등 밖에서 온 글)
const oneLine = (s: string, max = 160) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function ago(iso: string | null, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "?";
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  return min < 60 ? `${min}m` : min < 2880 ? `${Math.floor(min / 60)}h` : `${Math.floor(min / 1440)}d`;
}

interface Section {
  name: string;
  lines: string[];
}

export function dutyBriefOf(inp: DutyBriefInput, maxChars: number = DEFAULT_BRIEF_MAX_CHARS): DutyBrief {
  const now = Date.parse(inp.at);
  const cap = briefMaxCharsOf(maxChars);
  const head = `DUTY BRIEF ${inp.at} (atc state: keys and counts only, no ticket or PR text)`;

  const counts = Object.entries(inp.queue.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
  const oldest = [...inp.queue.items]
    .sort((a, b) => (a.since ?? "￿").localeCompare(b.since ?? "￿"))
    .slice(0, QUEUE_ROWS)
    .map((i) => `  ${i.kind} ${i.key} — ${oneLine(i.title, 100)} (waiting ${ago(i.since, now)})`);
  const alertRows = inp.alerts.slice(0, ALERT_ROWS).map((a) => `  ${(a.level ?? "?").toUpperCase()} ${shortKey(a.key)}${a.aircraft ? ` ${a.aircraft}` : ""}${a.flight ? ` ${a.flight}` : ""} — ${oneLine(a.text)}`);
  const fleetRows = inp.fleet.map((a) => `  ${a.registration} ${a.status}${a.airport ? ` ${a.airport}` : ""}${a.flight ? ` ${a.flight}${a.more ? ` +${a.more}` : ""}` : ""}${a.account ? ` ${a.account}` : ""}${a.fuelHold ? " FUEL-HOLD" : ""}`);
  const flightRows = inp.flights.map((f) => `  ${f.key} ${oneLine(f.state, 30)}`);
  const fuelRows = inp.fuel.map((f) => `  ${f.account} ${f.window} ${Math.round(f.pct)}% resets ${f.resetsAt} (${f.level})`);

  // 정해 둔 결정: 가장 최근 N개, 오래된 것이 먼저. 글은 SUPERVISOR의 것이라 그대로 싣고 한 줄 300자로만 자른다
  const all = inp.decisions ?? [];
  const max = briefDecisionsOf(inp.decisionsMax);
  const shown = all.slice(Math.max(0, all.length - max));
  const decisionRows = shown.map((d) => `  ${d.id} — ${oneLine(d.text, DECISION_TEXT_MAX)}${d.until ? ` (until ${d.until})` : ""}`);
  if (all.length > shown.length) decisionRows.unshift(`  … ${all.length - shown.length} older decisions not shown (briefDecisions ${max})`);

  // 자를 때는 뒤쪽 구역부터 줄을 덜어 낸다(결정은 맨 위라 맨 마지막에)
  const sections: Section[] = [
    { name: "DECISIONS", lines: [`STANDING DECISIONS ${all.length} (set by the SUPERVISOR; the only rules in force)`, ...decisionRows] },
    { name: "QUEUE", lines: [`QUEUE ${inp.queue.count}${counts ? ` · ${counts}` : ""}`, ...oldest, ...(inp.queue.count > oldest.length ? [`  … ${inp.queue.count - oldest.length} more in GET /api/supervisor/queue`] : [])] },
    { name: "ALERTS", lines: [`ALERTS ${inp.alerts.length} needing action`, ...alertRows, ...(inp.alerts.length > alertRows.length ? [`  … ${inp.alerts.length - alertRows.length} more`] : [])] },
    { name: "ORPHAN PRS", lines: [`PRs WITHOUT A FLIGHT ${(inp.orphanPrs ?? []).length} (no issue linked by branch name; a GO AROUND or FIX is waiting)`, ...(inp.orphanPrs ?? []).map((o) => `  ${o.repo}#${o.pr}`)] },
    { name: "REVERT", lines: [`AUTO-REVERT ${(inp.revert ?? []).length} recent`, ...(inp.revert ?? []).map((l) => `  ${oneLine(l, 200)}`)] },
    { name: "FLEET", lines: [`FLEET ${inp.fleet.length} AIRCRAFT`, ...fleetRows] },
    { name: "FUEL", lines: [`FUEL ${inp.fuel.length} ACCOUNT`, ...fuelRows] },
    { name: "FLIGHTS", lines: [`FLIGHTS in progress ${inp.flights.length}`, ...flightRows] },
  ];
  const render = (note: string | null) => [head, ...sections.flatMap((s) => s.lines), ...(note ? [note] : [])].join("\n");

  let text = render(null);
  let truncated = false;
  const dropped: string[] = [];
  const NOTE = (extra: string) => `[brief cut at ${cap} chars: ${extra}]`;
  while (text.length > cap) {
    truncated = true;
    const last = [...sections].reverse().find((s) => s.lines.length > 1);
    if (!last) break;
    last.lines.pop();
    if (!dropped.includes(last.name)) dropped.push(last.name);
    text = render(NOTE(`rows dropped from ${dropped.join(", ")}`));
  }
  if (truncated && text.length > cap) text = `${text.slice(0, cap - 1)}…`;
  return { v: 1, at: inp.at, chars: text.length, truncated, text };
}
