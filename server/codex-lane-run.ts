import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { loadRegistry } from "./airports.ts";
import { RECORD_FILE as AUTOLAND_FILE } from "./autoland.ts";
import { type LandedLine, type LaneOp, laneDaysOf, laneSilentSince, laneStepOf, type LanePull, type SingleLaneLine, singleLaneCauseOf } from "./codex-lane.ts";
import { config } from "./config.ts";
import type { PullRequest } from "./model.ts";
import { loadMcc, readMccRecords } from "./mcc.ts";
import { parseDays } from "./readability-run.ts";
import { readRecords as readFlightRecords } from "./recorder.ts";

// 조용한 리뷰 레인(ATC-386)의 기록과 읽기. 계산은 codex-lane.ts(순수).
//   codex-lane.jsonl — 저장소별 silent·speaks 전이(추가만). 지금 상태는 저장소의 마지막 줄이다.
//   lanes.jsonl — REVIEW 한 레인으로 CLEARED가 된 PR·head(추가만, 같은 PR·head는 한 번). 착륙한 PR과 이어 날짜별로 센다.
const LANE_FILE = () => join(config.stateDir, "codex-lane.jsonl");
const SINGLE_FILE = () => join(config.stateDir, "lanes.jsonl");
const SWITCH_FILE = () => join(config.stateDir, "codex-lane.json");

// 스위치(ATC-393): codex-lane.json의 `auto`(on·off, 없으면 on). off면 레인은 아무것도 하지 않는다: 기록도 새 판단도 없고, 지난 silent 상태도 쓰지 않아 PR별 6시간 규칙만 남는다. SUPERVISOR만(설정 창)
export type LaneSwitch = "off" | "on";
export const LANE_SWITCHES: readonly LaneSwitch[] = ["off", "on"];
export function loadLaneSwitch(file = SWITCH_FILE()): LaneSwitch {
  try {
    return JSON.parse(readFileSync(file, "utf8")).auto === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}
export function saveLaneSwitch(v: LaneSwitch, file = SWITCH_FILE()) {
  if (loadLaneSwitch(file) === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ auto: v }, null, 2)}\n`);
  renameSync(tmp, file);
  console.log(`[atc] codex lane switch ${v}`);
}

function readJsonl<T>(file: string): T[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const l of text.split("\n")) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l) as T);
    } catch {}
  }
  return out;
}
function append(file: string, line: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(line)}\n`);
}

export const readLaneOps = () => readJsonl<LaneOp>(LANE_FILE());
export const readSingleLanes = () => readJsonl<SingleLaneLine>(SINGLE_FILE());

// 저장소마다 한 단계를 돌리고 전이를 기록한다. 돌려주는 값: 저장소 → 조용해진 시각(조용한 저장소만). snapshot.ts가 GitHub을 읽은 뒤마다 부른다.
// usesCodex: Codex를 리뷰 레인으로 쓰는 저장소만 본다(MCC AIRPORT는 INSPECTION이 리뷰라서 뺀다). 스위치가 off면 아무것도 하지 않는다
export function laneStates(byRepo: ReadonlyMap<string, readonly LanePull[]>, now: number, thresholdMs = config.codexLaneSilentMs, usesCodex: (repo: string) => boolean = () => true, enabled = loadLaneSwitch() === "on"): Map<string, string> {
  const out = new Map<string, string>();
  if (!enabled) return out;
  const ops = readLaneOps();
  for (const [repo, pulls] of byRepo) {
    if (!usesCodex(repo)) continue;
    const step = laneStepOf(repo, laneSilentSince(ops, repo), pulls, now, thresholdMs);
    if (step.op) {
      append(LANE_FILE(), step.op);
      ops.push(step.op);
      console.log(`[atc] codex lane ${step.op.op} ${repo.split("/").pop()}${step.op.evidence ? ` (waiting ${step.op.evidence.map((n) => `#${n}`).join(" ")})` : ""}`);
    }
    if (step.silentAt) out.set(repo, step.silentAt);
  }
  return out;
}

// CLEARED가 된 PR 가운데 REVIEW 한 레인만으로 통과한 것을 기록한다(같은 PR·head는 한 번). 새로 더한 수를 돌려준다
let known: Set<string> | null = null;
export function recordSingleLanes(pulls: readonly Pick<PullRequest, "repo" | "number" | "head" | "landing" | "codexUnavailable" | "extReview">[], now = new Date().toISOString()): number {
  known ??= new Set(readSingleLanes().map((l) => `${l.repo}#${l.number}@${l.head}`));
  let n = 0;
  for (const p of pulls) {
    const cause = singleLaneCauseOf(p);
    const key = `${p.repo}#${p.number}@${p.head}`;
    if (!cause || known.has(key)) continue;
    known.add(key);
    append(SINGLE_FILE(), { t: now, repo: p.repo, number: p.number, head: p.head, cause } satisfies SingleLaneLine);
    n++;
  }
  return n;
}

// 착륙한 PR: MCC가 land한 것, AUTOLAND가 merge한 것, PR 서랍의 MERGE 버튼으로 머지한 것(성공 기록만)
export function landedLines(sinceMs: number): LandedLine[] {
  const out: LandedLine[] = [];
  const mccAirport = loadMcc().airport; // MCC의 land 기록에는 AIRPORT가 없다: MCC가 맡은 AIRPORT의 PR이다
  for (const r of readMccRecords()) if (r.op === "land" && r.result === "ok") out.push({ t: r.at, airport: mccAirport, number: r.pr, head: r.head });
  for (const r of readJsonl<{ at: string; op: string; result?: string; airport?: string; number?: number; head?: string }>(AUTOLAND_FILE())) {
    if (r.op === "merge" && r.result === "ok" && r.number && r.head) out.push({ t: r.at, airport: r.airport ?? "", number: r.number, head: r.head });
  }
  for (const r of readFlightRecords(sinceMs)) if (r.kind === "pr" && r.op === "merge" && r.ok) out.push({ t: r.t, airport: r.airport, number: r.number, head: r.head });
  return out;
}

// 저장소 경로 → AIRPORT 코드(단일 레인 기록은 저장소 경로로 남아 있다)
const airportOfRepo = (repo: string): string => loadRegistry().entries.find((e) => e.path === repo)?.code ?? repo;

export function laneView(days: number, now = Date.now()) {
  const ops = readLaneOps();
  const repos = [...new Set(ops.map((o) => o.repo))];
  return {
    v: 1 as const,
    at: new Date(now).toISOString(),
    days,
    silentRepos: repos.flatMap((repo) => {
      const since = laneSilentSince(ops, repo);
      return since ? [{ repo, since }] : [];
    }),
    daily: laneDaysOf(landedLines(now - days * 86_400_000), readSingleLanes(), days, now, airportOfRepo),
  };
}

// GET /api/landing/lanes?days=N: 날짜별 착륙 수와 그 가운데 REVIEW 한 레인으로 착륙한 수(까닭별), 지금 Codex가 조용한 저장소. 읽기만 한다
export function mountLanes(app: Hono) {
  app.get("/api/landing/lanes", (c) => {
    const p = parseDays(c.req.query("days") ?? "7");
    if (!p.ok) return c.json({ error: p.error }, 400);
    return c.json(laneView(p.days));
  });
}
