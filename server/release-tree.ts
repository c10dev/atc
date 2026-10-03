import type { Ticket } from "./model.ts";
import { type Holder, matches, overlapsOf, type Predicted, pathsOfBody, predictedOf } from "./overlap.ts";
import { PRIORITY_VALUE } from "./dispatch.ts";

// RELEASE 화면의 순서(ATC-456): 상위 이슈마다 나무, 막는 이슈 밑에 막힌 이슈, 그룹마다 "다음 발권", 발권할 수 있는 줄의 한 순서, `Sequence:` 줄, 같은 파일.
// 순수 함수만. 자료 모으기와 K 줄·해시 같은 덧붙임은 release-run.ts. 새 사실은 없다: 스냅샷의 이슈·관계·본문과 DISPATCH가 이미 모으는 파일 겹침 자료를 읽을 뿐이다.

const FINISHED = new Set(["completed", "canceled", "duplicate"]);
const DONE = "completed";
export const OTHER_GROUP = "기타";

// 발권할 수 있는 줄: READY Backlog(막는 이슈가 모두 끝남)와 발권 없는 Todo. 이 순서가 "다음 발권"을 정한다
export interface FireCand {
  key: string;
  priority: number;
  unblocks: number; // 발권하면 풀리는 이슈 수(DISPATCH의 unblock 요인과 같은 셈: 이 이슈가 막고 있는 Todo·Backlog 이슈)
  createdAt: string | null; // 오래 기다린 것이 먼저
  after: string | null; // 읽힌 Sequence 대상
}

// 1 우선순위(DISPATCH와 같은 값: Urgent가 맨 앞, 없음은 Medium 아래·Low 위) 2 풀어 주는 이슈 수 3 오래 기다린 것. 같으면 key
export function baseOrderOf(c: readonly FireCand[]): FireCand[] {
  const pv = (x: FireCand) => PRIORITY_VALUE[x.priority] ?? 1.5;
  const at = (x: FireCand) => (x.createdAt ? Date.parse(x.createdAt) : Infinity);
  return [...c].sort((a, b) => pv(b) - pv(a) || b.unblocks - a.unblocks || at(a) - at(b) || a.key.localeCompare(b.key));
}

// Sequence: after X — X가 줄 안에 있으면 그 바로 뒤로 옮긴다(여럿이 같은 X 뒤면 기본 순서대로). X가 줄 밖이면(날고 있음·기다림·다른 그룹) 기본 순서를 지킨다.
// 고리(A after B, B after A)는 순서에 쓰지 않는다. 순수
export function fireOrderOf(cands: readonly FireCand[]): string[] {
  const base = baseOrderOf(cands);
  const inSet = new Set(base.map((x) => x.key));
  const target = new Map(base.map((x) => [x.key, x.after && inSet.has(x.after) && x.after !== x.key ? x.after : null]));
  // 고리 끊기: target을 따라가다 자기로 돌아오는 줄은 대상을 버린다
  for (const x of base) {
    const seen = new Set<string>([x.key]);
    let k = target.get(x.key) ?? null;
    while (k) {
      if (seen.has(k)) {
        target.set(x.key, null);
        break;
      }
      seen.add(k);
      k = target.get(k) ?? null;
    }
  }
  const out: string[] = [];
  const emitted = new Set<string>();
  const waiting = new Map<string, string[]>(); // 대상 → 그 뒤에 올 줄들
  const emit = (key: string) => {
    out.push(key);
    emitted.add(key);
    for (const k of waiting.get(key) ?? []) emit(k);
  };
  for (const x of base) {
    const t = target.get(x.key) ?? null;
    if (t && !emitted.has(t)) waiting.set(t, [...(waiting.get(t) ?? []), x.key]);
    else emit(x.key);
  }
  return out;
}

// ── 나무 ──
export type StateWord = { kind: "ready" } | { kind: "todo" } | { kind: "waiting"; on: string[] } | { kind: "stage"; word: string };

export interface TreeRowBase {
  key: string;
  title: string;
  priority: number;
  state: StateWord;
  fire: "fire" | "release" | null; // 발권 단추가 하는 일: READY Backlog를 Todo로 옮기며 발권 / 이미 Todo인 것의 발권. 없으면 단추 없음
  released: boolean; // Todo이고 이미 발권했다
  after: { key: string; reason: string; known: boolean } | null; // Sequence 줄이 읽혔다(known: 그 이슈를 안다)
  sequenceProblem: string | null; // 줄이 틀렸거나 모르는 이슈: 그대로 보이고 순서에는 쓰지 않았다
  sameFiles: string[]; // 같은 파일을 고치는 날고 있는 이슈, 또는 앞에 놓인 이슈
}
export type TreeRow<X> = TreeRowBase & X & { children: TreeRow<X>[] };

export interface TreeGroup<X> {
  key: string | null; // 상위 이슈 key, 없으면 null(기타)
  title: string;
  done: number;
  total: number; // 취소·중복을 뺀 하위 이슈 수
  next: string | null; // 다음 발권: 이 그룹의 발권할 수 있는 줄 가운데 첫째
  rows: TreeRow<X>[];
}

export interface TreeInput<X> {
  tickets: readonly Ticket[];
  candidate: (t: Ticket) => boolean; // 이 화면이 다루는 이슈(후보 팀, 상위 이슈 아님)
  filed: ReadonlySet<string>; // atc가 올린 제안: 막는 이슈가 없어도 Backlog에서 발권한다
  released: (key: string) => boolean; // Todo가 이미 발권됐나(낡지 않은 발권)
  stageOf: (t: Ticket) => string | null; // 시작한 이슈의 FLIGHT 단계(PR 등). 모르면 상태 이름
  extra: (t: Ticket) => X; // 줄에 덧붙일 화면 자료(해시·K 줄 등)
  files?: { holders: readonly Holder[]; bodies: ReadonlyMap<string, string | null> } | null; // DISPATCH가 모은 파일 겹침 자료. 없으면 같은 파일 칸은 비어 있다
  wakeOf?: (t: Ticket) => Parameters<typeof overlapsOf>[1];
}

export function releaseTreeOf<X>(inp: TreeInput<X>): { groups: TreeGroup<X>[]; order: string[] } {
  const byKey = new Map(inp.tickets.map((t) => [t.key, t]));
  const typeOf = (k: string) => byKey.get(k)?.stateType ?? null;
  const finished = (k: string) => FINISHED.has(typeOf(k) ?? "");
  const members = inp.tickets.filter((t) => inp.candidate(t));

  // 줄 하나의 상태와 발권 단추. Backlog에 막는 이슈가 없고 제안도 아니면 줄이 아니다(이 화면에 오르지 않던 것)
  const wordOf = (t: Ticket): { state: StateWord; fire: TreeRowBase["fire"]; released: boolean; fireable: boolean } | null => {
    if (FINISHED.has(t.stateType)) return null;
    if (t.stateType === "started") return { state: { kind: "stage", word: inp.stageOf(t) ?? t.state }, fire: null, released: false, fireable: false };
    if (t.stateType === "unstarted") {
      const released = inp.released(t.key);
      return { state: { kind: "todo" }, fire: released ? null : "release", released, fireable: !released };
    }
    if (t.stateType === "backlog") {
      const pending = t.blockedBy.filter((k) => !finished(k));
      const filed = inp.filed.has(t.key);
      if (pending.length === 0) {
        if (t.blockedBy.length === 0 && !filed) return null;
        return { state: { kind: "ready" }, fire: "fire", released: false, fireable: true };
      }
      return { state: { kind: "waiting", on: pending }, fire: filed ? "fire" : null, released: false, fireable: false };
    }
    return null;
  };
  const words = new Map(members.map((t) => [t.key, wordOf(t)] as const));

  // 한 순서: 발권할 수 있는 줄 전부(그룹을 가로질러). 그룹마다 첫 줄이 "다음 발권"
  const cands: FireCand[] = members.filter((t) => words.get(t.key)?.fireable).map((t) => ({
    key: t.key,
    priority: t.priority,
    unblocks: t.blocks.filter((k) => typeOf(k) === "unstarted" || typeOf(k) === "backlog").length,
    createdAt: t.createdAt,
    after: t.sequence && !t.sequence.problem && t.sequence.after && byKey.has(t.sequence.after) ? t.sequence.after : null,
  }));
  const order = fireOrderOf(cands);
  const rank = new Map(order.map((k, i) => [k, i]));

  // 같은 파일(DISPATCH의 겹침 자료): 날고 있는 이슈, 그리고 순서에서 앞에 놓인 이슈. 자료가 없으면(본문을 아직 못 읽음) 비어 있다
  const files = inp.files && (inp.files.bodies.size > 0 || inp.files.holders.length > 0) ? inp.files : null;
  const own = (k: string): string[] => (files ? pathsOfBody(files.bodies.get(k)) : []);
  const share = (a: readonly string[], b: readonly string[]) => a.some((x) => b.some((y) => matches(x, y) || matches(y, x)));
  const sameFilesOf = (t: Ticket): string[] => {
    if (!files) return [];
    const out = new Set<string>();
    const predicted: Predicted[] = predictedOf(t.key, [...new Set([...t.related, ...t.blocks, ...t.blockedBy])], files.bodies);
    for (const o of overlapsOf(t.key, inp.wakeOf ? inp.wakeOf(t) : "M", t.airport ?? "", predicted, files.holders)) out.add(o.holder.flight);
    const mine = own(t.key);
    if (mine.length) for (const k of order) if ((rank.get(k) ?? 0) < (rank.get(t.key) ?? 0) && share(mine, own(k))) out.add(k);
    return [...out].sort();
  };

  // 줄 만들기
  const rowOf = (t: Ticket): TreeRow<X> => {
    const w = words.get(t.key)!;
    const seq = t.sequence;
    const known = Boolean(seq?.after && byKey.has(seq.after));
    const problem = seq ? (seq.problem ?? (seq.after && !known ? `${seq.after}는 알 수 없는 이슈 — 순서에 쓰지 않음` : null)) : null;
    return {
      ...(inp.extra(t) as X),
      key: t.key,
      title: t.title,
      priority: t.priority,
      state: w.state,
      fire: w.fire,
      released: w.released,
      after: seq && !seq.problem && seq.after && seq.reason ? { key: seq.after, reason: seq.reason, known } : null,
      sequenceProblem: problem,
      sameFiles: w.fireable ? sameFilesOf(t) : [],
      children: [],
    } as TreeRow<X>;
  };

  // 그룹: 상위 이슈마다. 상위 이슈가 없으면 기타. 줄이 하나도 없는 그룹(다 끝남)은 그리지 않는다
  const groupsBy = new Map<string | null, Ticket[]>();
  for (const t of members) {
    const g = t.parent ?? null;
    groupsBy.set(g, [...(groupsBy.get(g) ?? []), t]);
  }
  const groups: TreeGroup<X>[] = [];
  for (const [g, list] of groupsBy) {
    const open = list.filter((t) => words.get(t.key));
    if (open.length === 0) continue;
    const counted = list.filter((t) => t.stateType !== "canceled" && t.stateType !== "duplicate");
    const done = counted.filter((t) => t.stateType === DONE).length;
    const rows = new Map(open.map((t) => [t.key, rowOf(t)] as const));
    // 막는 이슈 밑에: 그룹 안의 끝나지 않은 막는 이슈 가운데 첫째(키 순). 없으면 맨 위. 고리는 맨 위로 푼다
    const parentOf = new Map<string, string>();
    for (const t of open) {
      const blocker = [...t.blockedBy].sort().find((k) => rows.has(k) && k !== t.key);
      if (blocker) parentOf.set(t.key, blocker);
    }
    for (const t of open) {
      const seen = new Set<string>([t.key]);
      let k = parentOf.get(t.key);
      while (k) {
        if (seen.has(k)) {
          parentOf.delete(t.key);
          break;
        }
        seen.add(k);
        k = parentOf.get(k);
      }
    }
    // 줄 순서: 발권할 수 있는 줄이 한 순서대로, 그 뒤 기다리는 줄·날고 있는 줄은 key 순
    const at1 = (r: TreeRow<X>) => rank.get(r.key) ?? 1e6;
    const cmp = (a: TreeRow<X>, b: TreeRow<X>) => at1(a) - at1(b) || a.key.localeCompare(b.key, undefined, { numeric: true });
    const top: TreeRow<X>[] = [];
    for (const t of open) {
      const row = rows.get(t.key)!;
      const p = parentOf.get(t.key);
      if (p) rows.get(p)!.children.push(row);
      else top.push(row);
    }
    const sortTree = (xs: TreeRow<X>[]) => {
      xs.sort(cmp);
      for (const x of xs) sortTree(x.children);
    };
    sortTree(top);
    const next = order.find((k) => rows.has(k)) ?? null;
    const parent = g ? byKey.get(g) : null;
    groups.push({ key: g, title: g ? (parent?.title ?? g) : OTHER_GROUP, done, total: counted.length, next, rows: top });
  }
  // 그룹 순서: 다음 발권이 앞선 그룹이 먼저, 발권할 것이 없는 그룹은 뒤(키 순), 기타는 맨 끝
  const at = (g: TreeGroup<X>) => (g.next ? (rank.get(g.next) ?? 1e6) : 1e7);
  groups.sort((a, b) => (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || at(a) - at(b) || (a.key ?? "").localeCompare(b.key ?? "", undefined, { numeric: true }));
  return { groups, order };
}
