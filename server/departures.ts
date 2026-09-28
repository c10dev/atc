import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";

// DEPARTURE LOG(착수 기록): FLIGHT에 처음 STAND나 claim이 생긴 순간, AIRCRAFT가 바뀐 순간(HANDOFF)을 남긴다.
// PR이 머지될 때쯤이면 claim은 정리되거나 3시간 유휴로 다시 시작되고 워크트리도 지워지므로,
// LOGBOOK이 AIRCRAFT와 출발 시각을 찾을 때 이 기록을 본다(docs/fleet.md 7.1).
// ~/.local/state/atc/departures.jsonl에 추가만 한다. 스냅샷마다 비교하지만 바뀔 때만 쓴다.

export type DepartureVia = "stand" | "claim" | "handoff";
export interface Departure {
  t: string;
  flight: string | null; // 브랜치의 ticket key, 없으면 AD HOC
  aircraft: string | null; // REGISTRATION(대문자). "stand"는 아직 점유가 없으면 null
  stand: string; // 워크트리 경로
  branch: string | null;
  repo: string; // AIRPORT 본 체크아웃 경로
  via: DepartureVia;
}

// STAND마다 마지막으로 기록한 AIRCRAFT. 기록을 처음부터 접어 만든다(재시작해도 같은 줄을 다시 쓰지 않게).
export type DepartureState = Map<string, string | null>;
export function foldDepartures(lines: Departure[]): DepartureState {
  const state: DepartureState = new Map();
  for (const d of lines) {
    if (d.aircraft || !state.has(d.stand)) state.set(d.stand, d.aircraft);
  }
  return state;
}

type Input = Pick<Snapshot, "claims" | "workspaces" | "sessions">;

// 스냅샷 하나와 지금까지의 상태를 비교해 새로 쓸 줄을 돌려준다(순수 함수). state는 호출한 쪽이 갱신한다.
// - claim: STAND의 AIRCRAFT가 없음 → X. 시각은 그 AIRCRAFT 점유의 since
// - handoff: X → Y. X가 그 STAND를 더는 활발히 점유하지 않을 때만(동시 점유 중에는 X를 유지해 오락가락하지 않는다)
// - stand: 이번 실행 중에 새로 생긴 워크트리. 첫 스냅샷에 이미 있던 워크트리는 기준선이라 쓰지 않는다
export function diffDepartures(
  s: Input,
  state: DepartureState,
  opts: { teamPattern: string; now: string; baseline: boolean },
): Departure[] {
  const team = new RegExp(opts.teamPattern, "i");
  const nameOf = new Map(s.sessions.map((x) => [x.id, x.name]));
  const out: Departure[] = [];
  for (const w of s.workspaces) {
    if (w.isMain) continue;
    const base = { flight: w.ticketKey, stand: w.path, branch: w.branch, repo: w.repo };
    // 이 STAND를 활발히 점유 중인 TEAM 세션: AIRCRAFT → 가장 이른 since
    const holders = new Map<string, string>();
    for (const c of s.claims) {
      if (c.workspacePath !== w.path || c.state !== "active") continue;
      const name = nameOf.get(c.sessionId);
      if (!name || !team.test(name)) continue;
      const reg = name.toUpperCase();
      if (!holders.has(reg) || c.since < holders.get(reg)!) holders.set(reg, c.since);
    }
    const known = state.has(w.path);
    const prev = state.get(w.path) ?? null;
    if (!known && !holders.size) {
      if (!opts.baseline) out.push({ t: opts.now, ...base, aircraft: null, via: "stand" });
      state.set(w.path, null);
      continue;
    }
    if (!holders.size || (prev && holders.has(prev))) continue; // 점유가 없어졌거나 같은 AIRCRAFT가 계속 점유 중
    // 새 AIRCRAFT: 여럿이면 가장 먼저 잡은 쪽
    const [reg, since] = [...holders].sort((a, b) => a[1].localeCompare(b[1]))[0];
    if (!known && !opts.baseline) out.push({ t: opts.now, ...base, aircraft: null, via: "stand" });
    out.push({ t: since, ...base, aircraft: reg, via: prev ? "handoff" : "claim" });
    state.set(w.path, reg);
  }
  return out;
}

export interface DepartureMatch {
  aircraft: string | null; // 맞는 기록 중 마지막 AIRCRAFT
  firstAt: string | null; // 맞는 기록 중 가장 이른 시각
  stands: string[];
}

export interface DepartureQuery {
  repo: string | null;
  branch?: string | null;
  flight?: string | null;
  stands?: string[];
  before: string;
}

// LOGBOOK이 쓸 조회. 같은 저장소의 같은 브랜치 기록을 먼저 믿고, 없으면 FLIGHT나 STAND가 같은 기록.
// before(머지 시각) 뒤의 기록은 다음 작업이라 보지 않는다. 맞는 줄을 시각순으로(FUEL의 FLIGHT 구간도 쓴다)
export function departureHits(lines: Departure[], q: DepartureQuery): Departure[] {
  const upTo = lines.filter((d) => d.t <= q.before);
  const byBranch = q.repo && q.branch ? upTo.filter((d) => d.repo === q.repo && d.branch === q.branch) : [];
  const hits = byBranch.length
    ? byBranch
    : upTo.filter((d) => (q.flight && d.flight === q.flight) || (q.stands ?? []).includes(d.stand));
  return [...hits].sort((a, b) => a.t.localeCompare(b.t));
}

export function matchDepartures(lines: Departure[], q: DepartureQuery): DepartureMatch {
  const sorted = departureHits(lines, q);
  return {
    aircraft: sorted.filter((d) => d.aircraft).at(-1)?.aircraft ?? null,
    firstAt: sorted[0]?.t ?? null,
    stands: [...new Set(sorted.map((d) => d.stand))].sort(),
  };
}

// ── 입출력 ──

const file = () => join(config.stateDir, "departures.jsonl");

export function readDepartures(path = file()): Departure[] {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: Departure[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

function append(lines: Departure[], path = file()) {
  if (!lines.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

let state: DepartureState | null = null;

// 서버 tick마다. 처음 부를 때 기록을 접어 상태를 만들고, 그 스냅샷은 기준선이다(이미 있던 워크트리에 "stand"를 쓰지 않음).
export function recordDepartures(s: Input, now = new Date().toISOString()) {
  const baseline = state === null;
  state ??= foldDepartures(readDepartures());
  append(diffDepartures(s, state, { teamPattern: loadDispatchConfig().teamPattern, now, baseline }));
}
