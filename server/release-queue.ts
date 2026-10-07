// RELEASE 화면의 발권 대기열과 순서 지도. 순수 함수만이고, 자료 모으기는 release-run.ts가 한다.
// 대기열은 SUPERVISOR가 이 화면에서 할 일이 있는 줄 전부를 한 순서로 늘어놓는다(발권 단추는 여기에만 있다).
// 지도는 상위 이슈와 사슬마다 남은 이슈를 순서대로 잇는다.
// 새 사실은 없다: 발권 나무(release-tree.ts), K 확인 목록, SCHEDULE NEW 제안, 발권 기록을 다시 묶을 뿐이다.
import type { K3Status } from "./k3-allow.ts";
import type { ReleaseChannel } from "./release.ts";
import type { MissingBlocker, TreeGroup, TreeRow } from "./release-tree.ts";

// 선언한 K 효과를 읽은 결과. none: "None"·"* None."·"K1: none K2: none"·None으로 시작하는 글.
// K1~K3: 실제로 선언한 가장 높은 효과(K3 줄이 있으면 K3). declared: 글은 있지만 K1~K3 이름이 없다. undeclared: `## K effects` 절이 없다
export type KLevel = "none" | "K1" | "K2" | "K3" | "declared" | "undeclared";

const NONE = /^none\b/i;
export function kLevelOf(kEffects: string | null | undefined, k3: Pick<K3Status, "lines"> | null | undefined): KLevel {
  if (k3 && k3.lines > 0) return "K3";
  if (kEffects == null) return "undeclared";
  // Linear가 저장한 꼴(글머리·굵게·백슬래시)을 걷어 낸다
  const text = kEffects.replace(/[*_`\\]/g, " ").replace(/\s+/g, " ").trim();
  if (text === "" || NONE.test(text)) return "none";
  const parts = [...text.matchAll(/\bK\s*([123])\s*(?:\[[^\]]*\])?\s*[:：]\s*(.*?)(?=\bK\s*[123]\s*(?:\[[^\]]*\])?\s*[:：]|$)/gi)];
  if (parts.length === 0) return "declared";
  const real = parts.filter(([, , v]) => !NONE.test(v.trim())).map(([, n]) => Number(n));
  return real.length === 0 ? "none" : (`K${Math.max(...real)}` as KLevel);
}

// 나무 줄에 release-run.ts가 덧붙이는 화면 자료(release-run.ts의 extra와 같은 꼴)
export interface RowExtra {
  hash: string | null;
  kEffects: string | null;
  k3: K3Status | null;
  filed: { by: string; at: string } | null;
  why: string | null;
  stale: boolean;
}

export type QueueSource = "ready" | "filed" | "todo" | "k-confirm" | "proposal";
// 줄의 단추가 하는 일: fire READY·제안을 Todo로 옮기며 발권, release 이미 Todo인 것의 발권, priority 우선순위가 없어 먼저 정해야 함,
// k-confirm attested 발권의 K 효과 확인, home 아직 이슈가 아닌 SCHEDULE NEW(HOME에서 승인)
export type QueueAction = "fire" | "release" | "priority" | "k-confirm" | "home";

export interface QueueRow {
  key: string; // 이슈 key, SCHEDULE NEW는 초안 id
  title: string;
  airport: string;
  source: QueueSource;
  action: QueueAction;
  priority: number;
  kLevel: KLevel;
  kEffects: string | null;
  k3: K3Status | null;
  hash: string | null;
  parent: { key: string; title: string } | null;
  unlocks: string[]; // 나무에서 이 줄 밑에 있는 이슈(끝나면 차례로 풀린다), 깊이 순
  after: { key: string; reason: string; known: boolean } | null;
  sequenceProblem: string | null;
  sameFiles: string[];
  filed: { by: string; at: string } | null;
  problem: string | null; // 줄에서 한 마디로 말하는 문제("괜찮은가"에 아니오인 것)
  why: string | null;
  stale: boolean;
  waitingOn: string[]; // 막는 이슈가 남은 제안(제안은 막혀 있어도 쏠 수 있다)
  kConfirm: { at: string; session: string | null; words: string | null } | null;
  proposal: { reason: string; status: string } | null;
}

export type MapKind = "fire" | "waiting" | "stage" | "released";
export interface MapNode {
  key: string;
  title: string;
  kind: MapKind;
  word: string; // 대기 ATC-n · PR · In Progress · 발권됨 · READY · TODO
  missing: MissingBlocker[]; // 기다리는 이슈의 막는 이슈가 이 화면에 없을 때 어디 있나(ATC-488)
}
export interface MapLane {
  id: string;
  airport: string;
  parent: { key: string; title: string } | null; // 없으면 상위 이슈 없는 사슬
  done: number;
  total: number;
  chains: MapNode[][]; // 맨 위 줄마다 하나, 그 밑의 줄이 순서대로 이어진다
  fire: number;
}

export interface ReleaseQueue {
  rows: QueueRow[];
  map: MapLane[];
  counts: { fire: number; byAirport: { airport: string; fire: number }[]; unlocks: number; waiting: number; flying: number };
  days: { day: string; screen: number; "duty-chat": number; attested: number }[];
}

export interface QueueInput {
  groups: readonly TreeGroup<RowExtra>[];
  order: readonly string[]; // 나무의 발권 순서(ATC-456: 우선순위, 풀어 주는 수, 기다린 시간, Sequence)
  kPending: readonly { key: string; title: string | null; hash: string; at: string; session: string | null; words: string | null; kEffects: string | null; k3?: K3Status | null }[];
  proposals: readonly { id: string; title: string; reason: string; status: string; kEffects: string | null; priority: number }[];
  airportOf: (key: string) => string | null;
  priorityOf?: (key: string) => number; // K 확인 줄의 우선순위(없으면 0)
  records: readonly { flight: string; channel: ReleaseChannel; at: string }[];
  now: number;
}

const teamOf = (key: string) => key.split("-")[0] ?? key;
const DAY = 86_400_000;

function problemOf(r: { action: QueueAction; k3: K3Status | null; stale: boolean; why: string | null }): string | null {
  if (r.action === "priority") return "우선순위 없음";
  if (r.k3 && !r.k3.parses) return "K3 줄이 읽히지 않음";
  if (r.stale) return "발권 뒤 내용이 바뀜";
  if (r.why) return "발권을 거둠";
  return null;
}

const flat = <X>(rows: readonly TreeRow<X>[]): TreeRow<X>[] => rows.flatMap((r) => [r, ...flat(r.children)]);

export function releaseQueueOf(inp: QueueInput): ReleaseQueue {
  const airport = (key: string) => inp.airportOf(key) ?? teamOf(key);
  const rank = new Map(inp.order.map((k, i) => [k, i]));
  const rows: QueueRow[] = [];
  let waiting = 0;
  let flying = 0;

  for (const g of inp.groups) {
    const parent = g.key ? { key: g.key, title: g.title } : null;
    for (const r of flat(g.rows)) {
      if (!r.fire) {
        if (r.state.kind === "waiting") waiting++;
        else flying++; // 날고 있는 이슈와 이미 발권한 Todo(DISPATCH를 기다림)
        continue;
      }
      const action: QueueAction = r.priority <= 0 ? "priority" : r.fire;
      const row: QueueRow = {
        key: r.key,
        title: r.title,
        airport: airport(r.key),
        source: r.filed ? "filed" : r.fire === "release" ? "todo" : "ready",
        action,
        priority: r.priority,
        kLevel: kLevelOf(r.kEffects, r.k3),
        kEffects: r.kEffects,
        k3: r.k3,
        hash: r.hash,
        parent,
        unlocks: flat(r.children).map((c) => c.key),
        after: r.after,
        sequenceProblem: r.sequenceProblem,
        sameFiles: r.sameFiles,
        filed: r.filed,
        problem: null,
        why: r.why,
        stale: r.stale,
        waitingOn: r.state.kind === "waiting" ? r.state.on : [],
        kConfirm: null,
        proposal: null,
      };
      row.problem = problemOf(row);
      rows.push(row);
    }
  }
  for (const k of inp.kPending) {
    const row: QueueRow = {
      key: k.key,
      title: k.title ?? k.key,
      airport: airport(k.key),
      source: "k-confirm",
      action: "k-confirm",
      priority: inp.priorityOf?.(k.key) ?? 0,
      kLevel: kLevelOf(k.kEffects, k.k3 ?? null),
      kEffects: k.kEffects,
      k3: k.k3 ?? null,
      hash: k.hash,
      parent: null,
      unlocks: [],
      after: null,
      sequenceProblem: null,
      sameFiles: [],
      filed: null,
      problem: null,
      why: null,
      stale: false,
      waitingOn: [],
      kConfirm: { at: k.at, session: k.session, words: k.words },
      proposal: null,
    };
    rows.push(row);
  }

  // 순서: K 확인 → 문제 있는 줄 → 나무의 발권 순서 → 순서 밖(막힌 제안 등)은 key 순. SCHEDULE NEW는 맨 뒤(여기서 쏠 수 없다)
  const tier = (r: QueueRow) => (r.action === "k-confirm" ? 0 : r.problem ? 1 : 2);
  const at = (r: QueueRow) => rank.get(r.key) ?? 1e6;
  rows.sort((a, b) => tier(a) - tier(b) || at(a) - at(b) || a.key.localeCompare(b.key, "en", { numeric: true }));
  for (const p of inp.proposals) {
    rows.push({
      key: p.id,
      title: p.title,
      airport: "",
      source: "proposal",
      action: "home",
      priority: p.priority,
      kLevel: kLevelOf(p.kEffects, null),
      kEffects: p.kEffects,
      k3: null,
      hash: null,
      parent: null,
      unlocks: [],
      after: null,
      sequenceProblem: null,
      sameFiles: [],
      filed: null,
      problem: null,
      why: null,
      stale: false,
      waitingOn: [],
      kConfirm: null,
      proposal: { reason: p.reason, status: p.status },
    });
  }

  // 지도: 상위 이슈마다 한 줄, 상위 이슈 없는 이슈는 밑에 이슈가 있는 사슬마다 한 줄. 홀로 있는 이슈는 대기열에만 있다
  const nodeOf = (r: TreeRow<RowExtra>): MapNode => {
    const kind: MapKind = r.fire ? "fire" : r.state.kind === "waiting" ? "waiting" : r.state.kind === "todo" ? "released" : "stage";
    const word = r.state.kind === "waiting" ? `대기 ${r.state.on.join(", ")}` : r.state.kind === "stage" ? r.state.word : r.state.kind === "todo" ? (r.released ? "발권됨" : "TODO") : "READY";
    return { key: r.key, title: r.title, kind, word, missing: r.missing };
  };
  const chainOf = (r: TreeRow<RowExtra>): MapNode[] => [nodeOf(r), ...flat(r.children).map(nodeOf)];
  const lane = (id: string, parent: MapLane["parent"], done: number, total: number, tops: readonly TreeRow<RowExtra>[]): MapLane => {
    const chains = tops.map(chainOf);
    const first = parent?.key ?? tops[0]!.key;
    return { id, airport: airport(first), parent, done, total, chains, fire: chains.flat().filter((n) => n.kind === "fire").length };
  };
  const map: MapLane[] = [];
  for (const g of inp.groups) {
    if (g.key) map.push(lane(g.key, { key: g.key, title: g.title }, g.done, g.total, g.rows));
    else for (const r of g.rows) if (r.children.length > 0) map.push(lane(`chain-${r.key}`, null, 0, 1 + flat(r.children).length, [r]));
  }
  // 쏠 것이 있는 줄이 먼저(그 줄의 첫 발권이 앞선 순), 그 뒤 키 순
  const firstFire = (l: MapLane) => Math.min(...l.chains.flat().filter((n) => n.kind === "fire").map((n) => rank.get(n.key) ?? 1e6), 1e7);
  map.sort((a, b) => firstFire(a) - firstFire(b) || a.id.localeCompare(b.id, "en", { numeric: true }));

  // 7일 막대: 오늘을 포함한 UTC 날짜 7개, 날마다 채널별 발권 수(기록은 FLIGHT마다 가장 나중 발권)
  const today = Math.floor(inp.now / DAY) * DAY;
  const days = Array.from({ length: 7 }, (_, i) => ({ day: new Date(today - (6 - i) * DAY).toISOString().slice(0, 10), screen: 0, "duty-chat": 0, attested: 0 }));
  for (const r of inp.records) {
    const t = Date.parse(r.at);
    const i = 6 - Math.floor((today - Math.floor(t / DAY) * DAY) / DAY);
    if (i >= 0 && i < 7 && t <= inp.now) days[i]![r.channel]++;
  }

  const fireRows = rows.filter((r) => r.action !== "home");
  const byAirport = new Map<string, number>();
  for (const r of fireRows) byAirport.set(r.airport, (byAirport.get(r.airport) ?? 0) + 1);
  return {
    rows,
    map,
    counts: {
      fire: fireRows.length,
      byAirport: [...byAirport].map(([a, n]) => ({ airport: a, fire: n })).sort((a, b) => b.fire - a.fire || a.airport.localeCompare(b.airport)),
      unlocks: new Set(fireRows.flatMap((r) => r.unlocks)).size,
      waiting,
      flying,
    },
    days,
  };
}
