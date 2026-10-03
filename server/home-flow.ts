import type { FollowRow, FollowStage } from "./follow.ts";
import { type LandingBlockCode, type PullRequest } from "./model.ts";
import { type QueueItem } from "./supervisor-queue.ts";
import { waitsOnHuman } from "./human-check.ts";

// HOME 흐름판의 판정(ATC-499, docs/home-flow.md 3.2–3.6·4.2). 순수 함수 하나: 판정·칸·주체·판정 줄·묶은 할 일의 순서를 서버가 정하고 화면은 그리기만 한다(design-language 원칙 4).
// 새 사실은 없다: FLIGHT FOLLOWING 줄(단계·막힘 표시), PR, 착륙 기록(ON), ATFM 상태, SUPERVISOR QUEUE를 읽을 뿐이다. 읽고 모으는 일은 flow-run.ts.

export type FlowStage = "queue" | "out" | "off" | "cleared" | "in";
export const FLOW_STAGES: readonly FlowStage[] = ["queue", "out", "off", "cleared", "in"];
export type Holder = "SUPERVISOR" | "AIRCRAFT" | "ATC" | "EXTERNAL";
export type Verdict = "normal" | "congested" | "stopped";
export type Tone = "caution" | "warning" | null;

// 칸 하나가 묶는 follow.md 3.2 단계(docs/home-flow.md 3.3)
export const STAGE_OF: Record<FollowStage, FlowStage> = {
  todo: "queue",
  proposed: "queue",
  approved: "queue",
  sent: "out",
  readback: "out",
  pr: "off",
  ci: "cleared",
  landed: "in",
  deployed: "in",
};
const STAGE_GLOSS: Record<FlowStage, string> = { queue: "대기", out: "출발", off: "비행", cleared: "착륙 대기", in: "배포" };

export const HOLDER_SHORT: Record<Holder, string> = { SUPERVISOR: "SUP", AIRCRAFT: "AC", ATC: "ATC", EXTERNAL: "EXT" }; // 432px 줄은 줄인 꼴을 쓴다(4.4)
const HOLDER_TEXT: Record<Holder, string> = { SUPERVISOR: "SUPERVISOR 대기", AIRCRAFT: "팀이 멈춤", ATC: "atc 자동화가 밀림", EXTERNAL: "외부 요인" };

// PR 막힘 코드 → 주체의 표(4.2). 코드가 새로 생기면 LANDING_BLOCK_CODES와 이 표를 함께 고친다: 빠진 코드는 테스트가 잡고, 그때까지는 ATC로 센다(SUPERVISOR 뒤에 숨어 막힘을 가리지 않게)
export const BLOCK_HOLDER: Record<LandingBlockCode, Holder> = {
  stacked: "AIRCRAFT", // base PR이 먼저 들어가야 한다: 팀이 쌓은 PR
  draft: "AIRCRAFT",
  "checks-pending": "EXTERNAL", // GitHub CI
  "checks-failed": "AIRCRAFT", // 팀이 고친다
  "no-checks": "EXTERNAL",
  "no-review": "EXTERNAL", // Codex·DeepSeek 리뷰가 아직 없다
  "review-stale": "EXTERNAL",
  "review-findings": "AIRCRAFT", // 지적을 팀이 고친다
  "changes-requested": "AIRCRAFT",
  behind: "ATC", // MCC·AUTOLAND가 브랜치를 갱신한다
  dirty: "AIRCRAFT", // 충돌은 팀이 푼다
  blocked: "ATC",
  "merge-unknown": "EXTERNAL", // GitHub가 아직 모른다
  los: "AIRCRAFT", // 같은 파일을 만진 STAND의 분리 상실
};
// 표에 없는 코드는 ATC(분류 놓침). 놓친 수를 호출한 쪽이 세려고 miss를 함께 준다
export const holderOfBlock = (code: string): { holder: Holder; miss: boolean } => {
  const h = (BLOCK_HOLDER as Record<string, Holder | undefined>)[code];
  return h ? { holder: h, miss: false } : { holder: "ATC", miss: true };
};

export interface FlowPullIn extends PullRequest {
  landBy?: "mcc" | "supervisor" | "holder" | undefined; // land-by.ts의 판정(없으면 모름)
}

// PR 하나의 지금 주체. SUPERVISOR는 막힘이 모두 풀려 CLEARED가 된 뒤의 머지(또는 HUMAN CHECK)뿐이다: 그 전에는 CI·리뷰·팀이 쥔다
export function holderOfPull(p: FlowPullIn): { holder: Holder; miss: boolean } {
  if (waitsOnHuman(p.humanCheck)) return { holder: "SUPERVISOR", miss: false };
  const first = p.blocks[0];
  if (first) return holderOfBlock(first.code);
  if (p.landBy === "supervisor") return { holder: "SUPERVISOR", miss: false };
  if (p.landBy === "holder") return { holder: "AIRCRAFT", miss: false };
  return { holder: "ATC", miss: false }; // MCC가 착륙시킬 차례(또는 등급을 모름)
}

// ── 입력·출력 ──
export interface FlowRowIn {
  row: FollowRow;
  airport: string | null;
  blockedBy: readonly string[]; // 이슈 관계(Linear blockedBy)
}

export interface FlowInput {
  now: number;
  airports: readonly { code: string; name: string }[];
  rows: readonly FlowRowIn[]; // 후보 팀의 열린 FLIGHT(Todo 이상, 끝나지 않음)
  pulls: readonly FlowPullIn[];
  landings: readonly { airport: string; at: string }[]; // 착륙(ON) 시각, AIRPORT별
  stops: readonly { airport: string; text: string }[]; // 막는 ground stop(kind stop, enforced, land 허용 안 함)
  mainRed: readonly string[]; // main CI가 빨간 AIRPORT
  queue: readonly QueueItem[]; // SUPERVISOR QUEUE(할 일)
  thresholds?: Readonly<Record<string, number>>; // AIRPORT별 "착륙 없음" 기준(분). 없으면 floor
  floorMin?: number; // 기본 30
  sinceLook?: { since: string; released: number; landed: number; deployed: number } | null;
}

export interface FlowFlight {
  key: string;
  title: string;
  sub: string;
  ageMin: number;
  stuck: boolean;
  holder?: Holder;
  why?: string;
  todo?: string; // 이미 할 일 목록에 있는 FLIGHT: 그 줄의 key
}
export interface FlowCell {
  stage: FlowStage;
  count: number;
  oldestMin: number | null;
  stuck: number;
  tone: Tone;
  holder?: Holder;
  holderShort?: string;
  note?: string;
  todoGroup?: string; // 칸의 FLIGHT가 모두 할 일에 있으면 flights 없이 이 묶음(또는 줄)을 열게 한다
  flights: FlowFlight[];
}
export interface FlowAirport {
  code: string;
  name: string;
  verdict: Verdict;
  reason?: string;
  holder?: Holder;
  thresholdMin: number;
  sinceOnMin: number | null;
  landings12h: number[]; // 오래된 시간부터 12칸
  cells: FlowCell[];
}
export interface FlowTodo {
  key: string;
  kind: string;
  tone: Tone;
  subject: string;
  need: string;
  ageMin: number;
  action: string;
  group?: string;
  groupNeed?: string;
}
export type FlowTodoLine = { type: "item"; item: FlowTodo } | { type: "group"; group: string; groupNeed: string; kind: string; tone: Tone; count: number; oldestMin: number; items: FlowTodo[] };
export interface FlowView {
  at: string;
  verdict: Verdict;
  line: string;
  holder?: Holder;
  worst?: string;
  sinceLook?: { sinceMin: number; released: number; landed: number; deployed: number };
  airports: FlowAirport[];
  todo: FlowTodo[]; // 순서대로 전부(묶음 열쇠가 붙는다)
  todoLines: FlowTodoLine[]; // 묶은 뒤 처음 5줄
  todoRest: { count: number; text: string } | null; // 접힌 나머지: `나머지 n건` 요약
}

export const TODO_LINES = 5;
const HOUR = 3_600_000;
const MIN = 60_000;

// 나이는 한 단위(design-language 원칙 9). 3시간 안은 분으로 둔다
export function ageText(min: number | null): string {
  if (min === null) return "—";
  if (min < 180) return `${min}m`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

const minSince = (iso: string | null | undefined, now: number): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / MIN)) : null;
};

// 줄 하나의 주체. 막힘 코드(follow.md 3.3)와 단계에서 정한다. 표에 없는 막힘 코드는 ATC(분류 놓침)
const STUCK_HOLDER: Record<string, Holder> = {
  "todo-no-proposal": "ATC",
  "approved-not-sent": "ATC",
  "sent-no-readback": "AIRCRAFT",
  undelivered: "ATC",
  "no-pr": "AIRCRAFT",
  "pr-not-cleared": "AIRCRAFT",
  "landing-wait": "ATC",
  "landed-not-deployed": "ATC",
};

interface Placed {
  key: string;
  title: string;
  airport: string;
  stage: FlowStage;
  sub: string;
  ageMin: number;
  stuck: boolean;
  holder: Holder;
  why: string | null;
  blockedBy: string | null; // 상속한 막는 FLIGHT
  todo: string | null;
}

function ownHolder(r: FlowRowIn, pull: FlowPullIn | undefined): { holder: Holder; why: string | null } {
  const row = r.row;
  const stage = row.current ? STAGE_OF[row.current] : "queue";
  // SUPERVISOR가 머지하거나 확인할 차례
  if (row.next?.kind === "merge" || row.next?.kind === "human-check") return { holder: "SUPERVISOR", why: row.next.label };
  if (stage === "off" || stage === "cleared") {
    if (pull) {
      const h = holderOfPull(pull);
      return { holder: h.holder, why: pull.blocks[0]?.text ?? (h.holder === "SUPERVISOR" ? "SUPERVISOR 머지 대기" : null) };
    }
    if (row.stuck) return { holder: STUCK_HOLDER[row.stuck.code] ?? "ATC", why: row.stuck.text };
    return { holder: "AIRCRAFT", why: null };
  }
  if (row.stuck) return { holder: STUCK_HOLDER[row.stuck.code] ?? "ATC", why: row.stuck.text };
  if (stage === "queue") return { holder: row.current === "proposed" && row.next?.kind === "approve" ? "SUPERVISOR" : "ATC", why: null };
  if (stage === "out") return { holder: "AIRCRAFT", why: null };
  return { holder: "ATC", why: null }; // 착륙 뒤 RTS·배포
}

const TODO_RANK = (it: QueueItem, supervisorFlights: ReadonlySet<string>, flightOf: (i: QueueItem) => string | null): 0 | 1 | 2 | 3 => {
  if (it.kind === "ALERT" && it.level === "warning") return 0;
  const f = flightOf(it);
  if ((it.kind === "STUCK" || it.kind === "LANDING" || it.kind === "HUMAN CHECK") && f && supervisorFlights.has(f)) return 1;
  if (it.kind === "STUCK" || (it.kind === "ALERT" && it.level === "caution")) return 2;
  return 3;
};

const GROUP_NEED: Record<string, string> = {
  LANDING: "SUPERVISOR 머지 필요",
  PROPOSAL: "승인 필요",
  BACKLOG: "발권하거나 버리기",
  "HUMAN CHECK": "화면 확인 필요",
  STUCK: "막힌 FLIGHT 확인",
};

export function flowViewOf(inp: FlowInput): FlowView {
  const { now } = inp;
  const floor = inp.floorMin ?? 30;
  const pullOf = new Map<string, FlowPullIn>();
  for (const p of [...inp.pulls].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (p.ticketKey && !pullOf.has(p.ticketKey)) pullOf.set(p.ticketKey, p);

  // 1) 줄을 자리에 놓는다(주체는 자기 것부터)
  const onBoard = new Map<string, FlowRowIn>();
  for (const r of inp.rows) if (!r.row.finished && r.airport && r.row.current && !r.row.unreadable) onBoard.set(r.row.key, r);
  const placed = new Map<string, Placed>();
  for (const r of onBoard.values()) {
    const row = r.row;
    const h = ownHolder(r, pullOf.get(row.key));
    const at = row.current ? row.stages[row.current]?.at : null;
    const ageMin = minSince(at ?? row.stuck?.since, now) ?? 0;
    const pull = pullOf.get(row.key);
    placed.set(row.key, {
      key: row.key,
      title: row.title ?? row.key,
      airport: r.airport!,
      stage: STAGE_OF[row.current!],
      sub: `${row.current}${pull?.blocks[0] ? ` · ${pull.blocks[0].code}` : ""}${row.stuck ? ` · ${row.stuck.code}` : ""}`,
      ageMin,
      stuck: Boolean(row.stuck),
      holder: h.holder,
      why: h.why,
      blockedBy: null,
      todo: null,
    });
  }
  // 2) 막는 FLIGHT가 보드에 있으면 그 주체를 물려받고, 그 FLIGHT가 막혔으면 이 줄도 막힌 것이다(깊이 따라 고정점까지, 고리는 한 바퀴에서 멈춘다)
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const r of onBoard.values()) {
      const me = placed.get(r.row.key)!;
      if (me.blockedBy) continue;
      const open = [...r.blockedBy].sort().map((k) => placed.get(k)).filter((b): b is Placed => Boolean(b) && b!.key !== me.key);
      const blocker = open.find((b) => b.stuck) ?? open[0];
      if (!blocker) continue;
      if (me.stuck && !blocker.stuck) continue; // 스스로 막힌 줄은 막지 않은 FLIGHT에서 물려받지 않는다
      if (!blocker.stuck && blocker.holder === me.holder) continue;
      placed.set(me.key, { ...me, holder: blocker.holder, stuck: me.stuck || blocker.stuck, blockedBy: blocker.key, why: `${blocker.key}에 막힘` });
      changed = true;
    }
    if (!changed) break;
  }

  // 3) 할 일: 서버 순서와 묶음. 칸이 그 줄을 가리키려고 FLIGHT → 할 일 key도 만든다
  const pullByHead = (it: QueueItem): FlowPullIn | undefined => {
    const m = /#(\d+)@([^@]+)$/.exec(it.key);
    return m ? inp.pulls.find((p) => String(p.number) === m[1] && p.head === m[2]) : undefined;
  };
  const flightOf = (it: QueueItem): string | null => it.flight ?? pullByHead(it)?.ticketKey ?? null;
  const sinceOf = (it: QueueItem): string | null => it.since ?? (it.kind === "LANDING" || it.kind === "HUMAN CHECK" ? (pullByHead(it)?.readyAt ?? pullByHead(it)?.createdAt ?? null) : null);
  const supervisorFlights = new Set([...placed.values()].filter((p) => p.holder === "SUPERVISOR").map((p) => p.key));
  const ranked = inp.queue
    .map((it) => ({ it, rank: TODO_RANK(it, supervisorFlights, flightOf), age: minSince(sinceOf(it), now), flight: flightOf(it) }))
    .sort((a, b) => a.rank - b.rank || (a.age === null ? 1 : 0) - (b.age === null ? 1 : 0) || (b.age ?? 0) - (a.age ?? 0) || a.it.key.localeCompare(b.it.key));
  const todo: FlowTodo[] = [];
  const groupSizes = new Map<string, number>();
  // 같은 종류에 같은 필요(단추)만 묶는다. 알림·막힘 같은 종류는 줄마다 필요가 달라(need 글, 등급) 글과 등급까지 같을 때만
  const PER_ITEM = new Set(["ALERT", "STUCK", "EFFECT", "CLOSE", "ARRIVED"]);
  const groupKey = (it: QueueItem) => `${it.kind}/${it.primary.label}${PER_ITEM.has(it.kind) ? `/${it.level ?? ""}/${it.need ?? ""}` : ""}`;
  for (const x of ranked) groupSizes.set(groupKey(x.it), (groupSizes.get(groupKey(x.it)) ?? 0) + 1);
  const todoOfFlight = new Map<string, string>();
  for (const x of ranked) {
    const key = `${x.it.kind}/${x.it.key}`;
    const grouped = (groupSizes.get(groupKey(x.it)) ?? 0) > 1;
    todo.push({
      key,
      kind: x.it.kind === "ALERT" ? (x.it.level === "warning" ? "WARNING" : "CAUTION") : x.it.kind,
      tone: x.rank === 0 ? "warning" : x.rank === 3 ? null : "caution",
      subject: x.it.title,
      need: x.it.need ?? x.it.primary.label,
      ageMin: x.age ?? 0,
      action: x.it.primary.label,
      ...(grouped ? { group: groupKey(x.it), groupNeed: GROUP_NEED[x.it.kind] ?? `${x.it.primary.label} 필요` } : {}),
    });
    if (x.flight && !todoOfFlight.has(x.flight)) todoOfFlight.set(x.flight, grouped ? groupKey(x.it) : key);
  }
  // 5줄 접기: 묶음은 첫 항목 자리에 한 줄
  const lines: FlowTodoLine[] = [];
  const seen = new Set<string>();
  for (const t of todo) {
    if (!t.group) {
      lines.push({ type: "item", item: t });
    } else if (!seen.has(t.group)) {
      seen.add(t.group);
      const items = todo.filter((y) => y.group === t.group);
      lines.push({ type: "group", group: t.group, groupNeed: t.groupNeed!, kind: t.kind, tone: items.reduce<Tone>((a, y) => (a === "warning" || y.tone === "warning" ? "warning" : a === "caution" || y.tone === "caution" ? "caution" : null), null), count: items.length, oldestMin: Math.max(...items.map((y) => y.ageMin)), items });
    }
  }
  const shown = lines.slice(0, TODO_LINES);
  const hidden = lines.slice(TODO_LINES);
  const hiddenItems = hidden.flatMap((l) => (l.type === "item" ? [l.item] : l.items));
  const restKinds = new Map<string, number>();
  for (const i of hiddenItems) restKinds.set(i.kind, (restKinds.get(i.kind) ?? 0) + 1);
  const todoRest = hiddenItems.length ? { count: hiddenItems.length, text: `나머지 ${hiddenItems.length}건 ${[...restKinds].map(([k, n]) => `${k} ${n}`).join(" · ")}` } : null;

  // 4) AIRPORT마다 칸과 판정
  const airports: (FlowAirport & { waitMin: number })[] = inp.airports.map((a) => {
    const mine = [...placed.values()].filter((p) => p.airport === a.code);
    const lands = inp.landings.filter((l) => l.airport === a.code).map((l) => Date.parse(l.at)).filter((t) => Number.isFinite(t) && t <= now);
    const last = lands.length ? Math.max(...lands) : null;
    const sinceOnMin = last === null ? null : Math.round((now - last) / MIN);
    const l12 = Array.from({ length: 12 }, () => 0);
    for (const t of lands) {
      const back = Math.floor((now - t) / HOUR);
      if (back < 12) l12[11 - back]++;
    }
    const thresholdMin = Math.max(floor, inp.thresholds?.[a.code] ?? floor);
    const cells: FlowCell[] = FLOW_STAGES.map((stage) => {
      const fs = mine.filter((p) => p.stage === stage).sort((x, y) => y.ageMin - x.ageMin);
      if (!fs.length) return { stage, count: 0, oldestMin: null, stuck: 0, tone: null, flights: [] };
      const stuckFs = fs.filter((f) => f.stuck);
      const lead = stuckFs[0]; // 가장 오래 막힌 FLIGHT의 주체가 칸의 주체
      const inherited = new Map<string, number>();
      for (const f of fs) if (f.blockedBy) inherited.set(f.blockedBy, (inherited.get(f.blockedBy) ?? 0) + 1);
      const topInherited = [...inherited].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
      const flights: FlowFlight[] = fs.map((f) => ({ key: f.key, title: f.title, sub: f.sub, ageMin: f.ageMin, stuck: f.stuck, ...(f.stuck ? { holder: f.holder } : {}), ...(f.why && f.stuck ? { why: f.why } : {}), ...(todoOfFlight.has(f.key) ? { todo: todoOfFlight.get(f.key)! } : {}) }));
      const allOnTodo = flights.every((f) => f.todo);
      return {
        stage,
        count: fs.length,
        oldestMin: Math.max(...fs.map((f) => f.ageMin)),
        stuck: stuckFs.length,
        tone: stuckFs.length ? "caution" : null,
        ...(lead ? { holder: lead.holder, holderShort: HOLDER_SHORT[lead.holder] } : {}),
        ...(topInherited ? { note: `${topInherited[0]}에 막힘 ${topInherited[1]}` } : lead?.why ? { note: lead.why } : {}),
        ...(allOnTodo ? { todoGroup: flights[0]!.todo! } : {}),
        flights: allOnTodo ? [] : flights,
      };
    });
    // 판정
    const moving = mine.filter((p) => p.stage !== "in" && p.holder !== "SUPERVISOR"); // 시스템이 움직여야 할 일(SUPERVISOR 몫은 뺀다, 4.2)
    const stalled = mine.filter((p) => p.stuck).sort((x, y) => y.ageMin - x.ageMin);
    const leadMoving = [...moving].sort((x, y) => y.ageMin - x.ageMin)[0];
    let verdict: Verdict = "normal";
    let reason: string | undefined;
    let holder: Holder | undefined;
    let waitMin = 0;
    const stop = inp.stops.find((s) => s.airport === a.code);
    if (stop) {
      verdict = "stopped";
      reason = `ground stop · ${stop.text}`;
      holder = "ATC";
    } else if (inp.mainRed.includes(a.code)) {
      verdict = "stopped";
      reason = "main CI 빨강";
      holder = "EXTERNAL";
    } else if (sinceOnMin !== null && sinceOnMin > thresholdMin && moving.length > 0) {
      verdict = "stopped";
      holder = (stalled.find((p) => p.holder !== "SUPERVISOR") ?? leadMoving)?.holder;
      reason = `착륙 없음 ${ageText(sinceOnMin)} (기준 ${thresholdMin}m)${holder ? ` · ${HOLDER_TEXT[holder]}` : ""}`;
      waitMin = sinceOnMin;
    } else if (stalled.length) {
      verdict = "congested";
      const cell = [...cells].filter((c) => c.stuck > 0).sort((x, y) => (y.oldestMin ?? 0) - (x.oldestMin ?? 0))[0]!;
      holder = cell.holder;
      reason = `${STAGE_GLOSS[cell.stage]} ${cell.count}건 · 최장 ${ageText(cell.oldestMin)}${holder ? ` · ${holder === "SUPERVISOR" && cell.stage === "cleared" ? "SUPERVISOR 머지 대기" : HOLDER_TEXT[holder]}` : ""}`;
      waitMin = cell.oldestMin ?? 0;
    }
    if (verdict === "stopped" && waitMin === 0) waitMin = sinceOnMin ?? 0;
    // 막힌 AIRPORT의 시스템 몫 칸은 경고 톤
    if (verdict === "stopped") for (const c of cells) if (c.stuck && c.holder !== "SUPERVISOR") c.tone = "warning";
    return { code: a.code, name: a.name, verdict, ...(reason ? { reason } : {}), ...(holder ? { holder } : {}), thresholdMin, sinceOnMin, landings12h: l12, cells, waitMin };
  });

  // 5) 가장 나쁜 AIRPORT가 판정 한 줄을 정한다
  const rank = { normal: 0, congested: 1, stopped: 2 } as const;
  const worst = [...airports].sort((x, y) => rank[y.verdict] - rank[x.verdict] || y.waitMin - x.waitMin)[0];
  const verdict: Verdict = worst?.verdict ?? "normal";
  const landed6h = inp.landings.filter((l) => now - Date.parse(l.at) <= 6 * HOUR && Date.parse(l.at) <= now).length;
  const flying = [...placed.values()].filter((p) => p.stage === "out" || p.stage === "off" || p.stage === "cleared").length;
  const line =
    verdict === "normal" || !worst
      ? `흐름 정상 · 지난 6h 착륙 ${landed6h} · ${flying ? `비행 중 ${flying}` : "비행 중 없음"}`
      : `${verdict === "stopped" ? "막힘" : "정체"} · ${worst.code} ${worst.reason ?? ""}`.trim();
  const sinceLook = inp.sinceLook ? { sinceMin: minSince(inp.sinceLook.since, now) ?? 0, released: inp.sinceLook.released, landed: inp.sinceLook.landed, deployed: inp.sinceLook.deployed } : undefined;
  return {
    at: new Date(now).toISOString(),
    verdict,
    line,
    ...(verdict !== "normal" && worst?.holder ? { holder: worst.holder } : {}),
    ...(verdict !== "normal" && worst ? { worst: worst.code } : {}),
    ...(sinceLook ? { sinceLook } : {}),
    airports: airports.map(({ waitMin: _w, ...a }) => a),
    todo,
    todoLines: shown,
    todoRest,
  };
}
