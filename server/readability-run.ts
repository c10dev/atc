import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { projectDirName } from "./control-recycle-run.ts";
import { projectsRoots } from "./fuel-run.ts";
import type { TrafficEvent } from "./model.ts";
import { readRadio } from "./radio-run.ts";
import type { Transmission } from "./radio.ts";
import { type Bucket, CHARS_PER_TOKEN, FIRST_LINE_MAX, headOf, readabilityOf, type Readability, replyOfEnvelope, type TranscriptReply, type Window } from "./readability.ts";
import { readRecords } from "./recorder.ts";
import { DEFAULT_TEAM_PATTERN, registrationOf } from "./registration.ts";
import { gitReadSync } from "./sources/git.ts";
import { ROLE_DIRS } from "./squelch-run.ts";
import { timed } from "./job-timing.ts";

// READABILITY R0(ATC-176, docs/readability.md): 하루에 한 번 어제의 교신 질을 readability.jsonl에 한 줄로 더한다(추가만).
// 처음 돌 때는 START_DAY부터 빠진 날을 모두 채운다. 대화 기록은 읽기만 하고 옮기거나 쓰지 않는다: 답마다 첫 줄(≤ 200자)과 길이만 남긴다.

export const START_DAY = "2026-09-26";
const DAY_MS = 86_400_000;
export const READABILITY_FILE = () => join(config.stateDir, "readability.jsonl");
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const MAX_REPLIES_PER_DAY = 500;
export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 60;

// ── 문구 변경 표지 ──
export interface Marker {
  at: string; // 머지 시각(UTC)
  pr: number | null;
  key: string | null; // ATC-n
  sha: string;
}
// 화법이 바뀌는 경로: 관제 세션 매뉴얼·skill, atc-task skill, 답·머리 규칙(response.ts), 착륙 막힘 영어 문구
const PHRASEOLOGY_PATHS = [
  ...["controller", "occ", "mcc", "crosscheck"].flatMap((d) => [`${d}/CLAUDE.md`, `${d}/CLAUDE.en.md`, `${d}/.claude/skills`]),
  "mcc/.claude/agents",
  ".claude/skills/atc-task",
  "server/response.ts",
  "server/landing-en.ts",
];
// FLIGHT PLAN·CLEARANCE·CREW CHANGE 문구를 만드는 파일. 큰 파일이라 경로만으로는 잡음이 많아, 화법 낱말이 든 줄이 바뀐 머지만 본다
const BUILDER_PATHS = ["server/proposals.ts", "server/crew-change.ts", "server/controller.ts", "server/go-around.ts"];
const BUILDER_WORDS = String.raw`\[DISPATCH|FLIGHT PLAN|RECALL|\[OCC CC|\[ATC C-|CREW CHANGE|LANDING sequence|GO AROUND|READBACK|UNABLE|STANDBY|ROGER`;
const SEP = "\x1f";
const END = "\x1e";

// git log 출력 → 표지. 순수
export function parseMarkers(out: string): Marker[] {
  const seen = new Set<string>();
  const markers: Marker[] = [];
  for (const rec of out.split(END)) {
    const [sha, at, subject = "", body = ""] = rec.trim().split(SEP);
    if (!sha || !at || seen.has(sha)) continue;
    seen.add(sha);
    const pr = /pull request #(\d+)/i.exec(subject)?.[1];
    const key = /\bATC-(\d+)\b/.exec(body)?.[1] ?? /\batc-(\d+)/i.exec(subject)?.[1] ?? null;
    markers.push({ at: new Date(at).toISOString(), pr: pr ? Number(pr) : null, key: key ? `ATC-${key}` : null, sha: sha.slice(0, 7) });
  }
  return markers.sort((a, b) => a.at.localeCompare(b.at));
}

// origin/main에서 창 안에 머지된 것 중 화법 경로를 건드린 것. git이 실패하면 던진다(빈 목록으로 하루를 굳히지 않으려고)
export function gitMarkers(fromMs: number, toMs: number, cwd = REPO_ROOT, git: (args: string[]) => string = (a) => gitReadSync(cwd, a)): Marker[] {
  const ref = (() => {
    try {
      git(["rev-parse", "--verify", "-q", "origin/main"]);
      return "origin/main";
    } catch {
      git(["rev-parse", "--verify", "-q", "HEAD"]);
      return "HEAD";
    }
  })();
  const base = ["log", ref, "--first-parent", "--merges", `--since=${new Date(fromMs).toISOString()}`, `--until=${new Date(toMs - 1).toISOString()}`, `--format=%H${SEP}%cI${SEP}%s${SEP}%b${END}`];
  const paths = git([...base, "--", ...PHRASEOLOGY_PATHS]);
  const builders = git([...base.slice(0, 4), "-m", ...base.slice(4), `-G${BUILDER_WORDS}`, "--", ...BUILDER_PATHS]);
  return parseMarkers(paths + END + builders);
}

// ── 대화 기록 읽기(읽기만) ──
// 관제 세션(TOWER·OCC)의 본 대화 기록이 받은 cross-session-message. 기록은 <계정 폴더>/projects/<cwd를 -로 바꾼 이름>/<sessionId>.jsonl
// (control-recycle-run의 projectDirName과 fuel-run의 projectsRoots를 그대로 쓴다)
const ROLE_OF: { role: "tower" | "occ"; to: TranscriptReply["to"] }[] = [{ role: "tower", to: "TOWER" }, { role: "occ", to: "OCC" }];

// 대화 기록 텍스트 → 팀이 관제 세션에 보낸 메시지들. 순수. 같은 시각·보낸이·길이는 한 번만(재개한 세션이 복사해 둔 것)
export function repliesOfTranscript(text: string, to: TranscriptReply["to"], teamPattern = DEFAULT_TEAM_PATTERN): TranscriptReply[] {
  const out: TranscriptReply[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.includes("cross-session-message") || !line.includes('"type":"user"')) continue;
    let o: { type?: string; timestamp?: string; message?: { content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const content = o.message?.content;
    if (o.type !== "user" || typeof content !== "string" || !o.timestamp) continue;
    const r = replyOfEnvelope(content, o.timestamp, to);
    if (!r || !registrationOf(r.from, teamPattern)) continue;
    const key = `${r.at}|${r.from}|${r.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

interface FileCache {
  size: number;
  mtimeMs: number;
  replies: TranscriptReply[];
}
const fileCache = new Map<string, FileCache>();
// sinceMs 뒤에 바뀐 대화 기록만 읽고, 파일마다 크기·mtime으로 캐시한다
export function readControlReplies(sinceMs: number, roots: readonly string[] = projectsRoots(), repoRoot = REPO_ROOT): TranscriptReply[] {
  const out: TranscriptReply[] = [];
  for (const { role, to } of ROLE_OF) {
    const name = projectDirName(join(repoRoot, ROLE_DIRS[role]));
    for (const root of roots) {
      const dir = join(root, name);
      let files: string[] = [];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of files) {
        const path = join(dir, f);
        try {
          const st = statSync(path);
          if (st.mtimeMs < sinceMs) continue;
          let hit = fileCache.get(path);
          if (!hit || hit.size !== st.size || hit.mtimeMs !== st.mtimeMs) {
            hit = { size: st.size, mtimeMs: st.mtimeMs, replies: repliesOfTranscript(readFileSync(path, "utf8"), to) };
            fileCache.set(path, hit);
          }
          out.push(...hit.replies);
        } catch {}
      }
    }
  }
  return out.filter((r) => Date.parse(r.at) >= sinceMs).sort((a, b) => a.at.localeCompare(b.at));
}

// ── 하루 한 줄 ──
export interface Segment {
  from: string;
  to: string;
  afterPr: number | null; // 이 구간을 연 표지의 PR(하루의 첫 구간은 null)
  total: Bucket;
  byFreq: Record<string, Bucket>;
}
export interface StoredReply {
  at: string;
  from: string;
  id: string | null;
  first: string; // ≤ 200자
  len: number; // 봉투 포함 전체 길이
}
export interface DayLine {
  v: 1;
  day: string;
  computedAt: string;
  window: Window;
  charsPerToken: number;
  metrics: Readability;
  segments: Segment[]; // 그날 문구 변경 표지가 있을 때만: 표지 시각에서 나눈 구간별 지표
  markers: Marker[];
  replies: StoredReply[];
  repliesTotal: number;
}

export interface Inputs {
  transmissions: readonly Transmission[];
  events: readonly TrafficEvent[];
  replies: readonly TranscriptReply[];
}
export interface Deps {
  now: () => number;
  load: (sinceMs: number) => Inputs;
  markers: (fromMs: number, toMs: number) => Marker[];
  file: () => string;
}
export const realDeps = (): Deps => ({
  now: Date.now,
  load: (sinceMs) => ({
    transmissions: readRadio(),
    events: readRecords(sinceMs).flatMap((r) => (r.kind === "event" ? [r.event] : [])),
    replies: readControlReplies(sinceMs),
  }),
  markers: (a, b) => gitMarkers(a, b),
  file: READABILITY_FILE,
});

const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const inRange = (iso: string, w: Window) => iso >= w.from && iso < w.to;

export function dayLineOf(day: string, inputs: Inputs, markers: readonly Marker[], computedAt: string): DayLine {
  const window: Window = { from: new Date(dayStartMs(day)).toISOString(), to: new Date(dayStartMs(day) + DAY_MS).toISOString() };
  const metrics = readabilityOf(inputs.transmissions, inputs.replies, inputs.events, window);
  // 표지 시각에서 나눈 구간: 문구가 바뀐 앞뒤를 따로 비교하려고
  const cuts = [...new Set(markers.map((m) => m.at).filter((at) => at > window.from && at < window.to))].sort();
  const segments: Segment[] = [];
  if (cuts.length) {
    const edges = [window.from, ...cuts, window.to];
    for (let i = 0; i < edges.length - 1; i++) {
      const w: Window = { from: edges[i]!, to: edges[i + 1]! };
      const r = readabilityOf(inputs.transmissions, inputs.replies, inputs.events, w);
      const opener = i === 0 ? null : (markers.filter((m) => m.at === edges[i]).at(-1)?.pr ?? null);
      segments.push({ from: w.from, to: w.to, afterPr: opener, total: r.total, byFreq: r.byFreq });
    }
  }
  const dayReplies = inputs.replies.filter((r) => inRange(r.at, window));
  const stored: StoredReply[] = dayReplies.slice(0, MAX_REPLIES_PER_DAY).map((r) => ({ at: r.at, from: r.from, id: headOf(r.first)?.id ?? null, first: r.first.slice(0, FIRST_LINE_MAX), len: r.length }));
  return {
    v: 1, day, computedAt, window, charsPerToken: CHARS_PER_TOKEN, metrics, segments,
    markers: markers.filter((m) => inRange(m.at, window)), replies: stored, repliesTotal: dayReplies.length,
  };
}

export function readDayLines(file: string): DayLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: DayLine[] = [];
  for (const l of text.split("\n")) {
    if (!l) continue;
    try {
      const o = JSON.parse(l) as DayLine;
      if (typeof o.day === "string") out.push(o);
    } catch {}
  }
  return out;
}

let running = false;
// 빠진 날(START_DAY부터 어제까지, UTC)을 오래된 것부터 채운다. 파일을 그때그때 다시 읽어 같은 날을 두 번 쓰지 않는다. 실패한 날은 쓰지 않고 다음에 다시 한다
export function runReadability(deps: Deps = realDeps()): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const skipped: string[] = [];
  if (running) return { written, skipped };
  running = true;
  try {
    const now = deps.now();
    const today = isoDay(now);
    const have = new Set(readDayLines(deps.file()).map((l) => l.day));
    const missing: string[] = [];
    for (let ms = dayStartMs(START_DAY); isoDay(ms) < today; ms += DAY_MS) if (!have.has(isoDay(ms))) missing.push(isoDay(ms));
    if (!missing.length) return { written, skipped };
    const inputs = deps.load(dayStartMs(missing[0]!));
    for (const day of missing) {
      try {
        const from = dayStartMs(day);
        const line = dayLineOf(day, inputs, deps.markers(from, from + DAY_MS), new Date(deps.now()).toISOString());
        if (readDayLines(deps.file()).some((l) => l.day === day)) continue; // 다른 실행이 먼저 씀
        mkdirSync(dirname(deps.file()), { recursive: true });
        appendFileSync(deps.file(), JSON.stringify(line) + "\n");
        written.push(day);
      } catch {
        skipped.push(day);
      }
    }
    return { written, skipped };
  } finally {
    running = false;
  }
}

// GET /api/readability?days=N: 저장된 줄(최근 N일) + 오늘의 부분 지표(요청 때 계산)
export function parseDays(q: string | undefined): { ok: true; days: number } | { ok: false; error: string } {
  if (q === undefined || q === "") return { ok: true, days: DEFAULT_DAYS };
  const n = Number(q);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) return { ok: false, error: `days는 1~${MAX_DAYS}의 정수` };
  return { ok: true, days: n };
}
export function readabilityView(days: number, deps: Deps = realDeps()) {
  const now = deps.now();
  const today = isoDay(now);
  const stored = readDayLines(deps.file())
    .filter((l) => l.day < today)
    .slice(-days);
  const from = dayStartMs(today);
  const inputs = deps.load(from);
  const window: Window = { from: new Date(from).toISOString(), to: new Date(now + 1).toISOString() };
  let markers: Marker[] = [];
  try {
    markers = deps.markers(from, now + 1);
  } catch {}
  return {
    at: new Date(now).toISOString(),
    days: stored,
    today: { day: today, partial: true, window, metrics: readabilityOf(inputs.transmissions, inputs.replies, inputs.events, window), markers },
  };
}

export function mountReadability(app: Hono, deps: Deps = realDeps()) {
  app.get("/api/readability", (c) => {
    const p = parseDays(c.req.query("days"));
    if (!p.ok) return c.json({ error: p.error }, 400);
    return c.json(readabilityView(p.days, deps));
  });
}

// 시작 20초 뒤에 한 번(빠진 날 채우기), 그 뒤 한 시간에 한 번. 채울 날이 없으면 파일 하나 읽고 끝난다
export function startReadability(deps: Deps = realDeps()) {
  const tick = () => {
    try {
      const r = runReadability(deps);
      if (r.written.length) console.log(`[atc] readability: ${r.written.join(", ")}`);
    } catch (e) {
      console.warn(`[atc] readability: ${e instanceof Error ? e.message : e}`);
    }
  };
  setTimeout(tick, 20_000).unref();
  setInterval(() => timed("tick:readability", tick), 3_600_000).unref();
}
