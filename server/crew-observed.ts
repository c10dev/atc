import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import type { CrewMember } from "./crew.ts";
import type { Session } from "./model.ts";
import { sessionDir } from "./sources/claude.ts";

// OBSERVED CREW: CAPTAIN 세션의 서브에이전트 기록으로 본 실제 CREW. 설계: docs/fleet.md 8.2.
// 세션 메타데이터만 읽는다 — subagents/agent-*.meta.json의 agentType·model과 파일 시각, custom-title.json의 세션 이름.
// 대화 기록(.jsonl 본문)과 meta의 description은 읽지도 저장하지도 않는다.

export const OBSERVED_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
const SCAN_MS = 30_000; // 폴더 훑기는 30초에 한 번(2초 루프·화면 폴링에 부담 없게)

export interface Spawn {
  agentType: string;
  model: string | null;
  at: number; // meta 파일 mtime(ms) = 부른 시각
}
export interface ObservedMember {
  agentType: string;
  position: string | null; // 선언된 POSITION에 맞춘 것. 못 맞추면 null
  model: string | null; // 부를 때 model을 줬을 때만
  count: number;
  lastAt: string;
}
export interface CrewDrift {
  undeclared: string[]; // 관측됐지만 선언에 없음(agentType, 모델이 있으면 "type (model)")
  unused: string[]; // 선언됐지만 기간 안에 안 보임(POSITION)
}

// 어떤 일이든 맡는 범용 타입. 모델로 POSITION을 가린다.
const GENERIC = new Set(["general-purpose", "claude"]);
const FAMILY = /(opus|sonnet|haiku|fable)/i;
// model 없이 부른 범용 서브에이전트는 CAPTAIN 모델을 물려받는다. vocado·atc CAPTAIN은 Opus라 opus로 본다.
const INHERITED_FAMILY = "opus";

// meta JSON에서 agentType·model만 꺼낸다(나머지 키는 버린다)
export function parseMeta(text: string): { agentType: string; model: string | null } | null {
  try {
    const m = JSON.parse(text);
    if (typeof m?.agentType !== "string" || !m.agentType.trim()) return null;
    return { agentType: m.agentType.trim(), model: typeof m.model === "string" && m.model.trim() ? m.model.trim() : null };
  } catch {
    return null;
  }
}

// 관측한 agentType(+model)을 선언된 COMPLEMENT의 POSITION에 맞춘다.
// 1) POSITION이나 agent가 agentType과 같으면 그 POSITION(ui-builder, ui-qa, flash-helper …)
// 2) general-purpose·claude는 모델 계열(opus …)이 agent에 든 팀원의 POSITION(claude-opus-5-5 → backend)
// 3) 그 밖(Explore, Plan, claude-code-guide …)은 null — 선언에 없음으로 남는다
export function positionOf(agentType: string, model: string | null, complement: CrewMember[]): string | null {
  const t = agentType.toLowerCase();
  const direct = complement.find((m) => m.position.toLowerCase() === t || m.agent.toLowerCase() === t);
  if (direct) return direct.position;
  if (!GENERIC.has(t)) return null;
  const family = model ? FAMILY.exec(model)?.[1]?.toLowerCase() : INHERITED_FAMILY;
  if (!family) return complement.find((m) => m.agent.toLowerCase() === model!.toLowerCase())?.position ?? null;
  return complement.find((m) => m.agent.toLowerCase().includes(family))?.position ?? null;
}

// 기간 안의 호출을 agentType·model별로 묶고, 선언과의 차이(drift)를 낸다
export function observeCrew(
  spawns: Spawn[],
  complement: CrewMember[],
  now = Date.now(),
  windowDays = OBSERVED_WINDOW_DAYS,
): { observedCrew: ObservedMember[]; crewDrift: CrewDrift } {
  const since = now - windowDays * DAY_MS;
  const groups = new Map<string, { agentType: string; model: string | null; count: number; last: number }>();
  for (const s of spawns) {
    if (s.at < since || s.at > now + 60_000) continue;
    const key = `${s.agentType}\u0000${s.model ?? ""}`;
    const g = groups.get(key) ?? { agentType: s.agentType, model: s.model, count: 0, last: 0 };
    g.count++;
    g.last = Math.max(g.last, s.at);
    groups.set(key, g);
  }
  const observedCrew = [...groups.values()]
    .sort((a, b) => b.last - a.last)
    .map((g) => ({
      agentType: g.agentType,
      position: positionOf(g.agentType, g.model, complement),
      model: g.model,
      count: g.count,
      lastAt: new Date(g.last).toISOString(),
    }));
  const seen = new Set(observedCrew.map((o) => o.position).filter(Boolean));
  const undeclared = [...new Set(observedCrew.filter((o) => !o.position).map((o) => (o.model ? `${o.agentType} (${o.model})` : o.agentType)))];
  const unused = [...new Set(complement.map((m) => m.position))].filter((p) => !seen.has(p));
  return { observedCrew, crewDrift: { undeclared, unused } };
}

// ── 입출력: 세션 폴더 찾기와 meta 읽기(캐시) ──

const mtimeMs = (path: string): number | null => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
};

// custom-title.json의 세션 이름. 파일 mtime으로 캐시
const titleCache = new Map<string, { mtime: number; title: string | null }>();
function titleOf(dir: string): string | null {
  const file = join(dir, "custom-title.json");
  const m = mtimeMs(file);
  if (m === null) return null;
  const hit = titleCache.get(dir);
  if (hit?.mtime === m) return hit.title;
  let title: string | null = null;
  try {
    const t = JSON.parse(readFileSync(file, "utf8"))?.customTitle;
    title = typeof t === "string" && t.trim() ? t.trim().toUpperCase() : null;
  } catch {}
  titleCache.set(dir, { mtime: m, title });
  return title;
}

// 한 세션의 서브에이전트 호출. subagents/ 폴더 mtime(파일이 생기면 바뀐다)으로 캐시
const spawnCache = new Map<string, { mtime: number; spawns: Spawn[] }>();
function spawnsIn(dir: string): Spawn[] {
  const sub = join(dir, "subagents");
  const m = mtimeMs(sub);
  if (m === null) return [];
  const hit = spawnCache.get(dir);
  if (hit?.mtime === m) return hit.spawns;
  const spawns: Spawn[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(sub);
  } catch {}
  for (const f of names) {
    if (!f.endsWith(".meta.json")) continue; // .jsonl(대화 기록)은 열지 않는다
    const file = join(sub, f);
    try {
      const meta = parseMeta(readFileSync(file, "utf8"));
      if (meta) spawns.push({ ...meta, at: statSync(file).mtimeMs });
    } catch {}
  }
  spawnCache.set(dir, { mtime: m, spawns });
  return spawns;
}

// 세션 이름(대문자) → 세션 폴더들. custom-title.json이 있는 폴더를 30초마다 다시 훑는다
let titled: { at: number; byName: Map<string, string[]> } | null = null;
function titledDirs(now: number): Map<string, string[]> {
  if (titled && now - titled.at < SCAN_MS) return titled.byName;
  const byName = new Map<string, string[]>();
  const root = join(config.claudeDir, "projects");
  let projects: string[] = [];
  try {
    projects = readdirSync(root);
  } catch {}
  for (const p of projects) {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(join(root, p), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(root, p, e.name);
      const title = titleOf(dir);
      if (title) byName.set(title, [...(byName.get(title) ?? []), dir]);
    }
  }
  titled = { at: now, byName };
  return byName;
}

// 기간 안에 움직인 세션인가(폴더·subagents·대화 기록 파일의 mtime만 본다)
function activeWithin(dir: string, since: number): boolean {
  return [dir, join(dir, "subagents"), `${dir}.jsonl`].some((p) => (mtimeMs(p) ?? 0) >= since);
}

// 이 REGISTRATION에 이어진 세션들의 서브에이전트 호출. 이어진 세션이 없으면 null.
// 잇는 규칙: 살아 있는 세션 이름(atc가 지금 잇는 방식) 또는 custom-title.json의 세션 이름이 REGISTRATION과 같다.
export function spawnsFor(
  registration: string,
  sessions: Pick<Session, "id" | "name" | "cwd" | "agent" | "status">[],
  now = Date.now(),
  windowDays = OBSERVED_WINDOW_DAYS,
): Spawn[] | null {
  const reg = registration.toUpperCase();
  const since = now - windowDays * DAY_MS;
  const dirs = new Set<string>();
  for (const s of sessions) {
    if (s.agent === "claude" && s.status !== "dead" && s.name.toUpperCase() === reg) dirs.add(sessionDir(s.cwd, s.id));
  }
  const live = new Set(dirs);
  for (const d of titledDirs(now).get(reg) ?? []) if (activeWithin(d, since)) dirs.add(d);
  const linked = [...dirs].filter((d) => live.has(d) || activeWithin(d, since));
  if (!linked.length) return null;
  return linked.flatMap(spawnsIn);
}
