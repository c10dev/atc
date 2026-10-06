import { jobGoneWhyOf } from "../job-liveness.ts";
import { loadLivenessSwitch, proofOfSession, procAlive as isAlive } from "../job-liveness-io.ts";
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config.ts";
import { type AccountFolder, accountFolders, folderOfAccount, observedLabelsOn } from "../accounts.ts";
import { toolPaths } from "../../hooks/paths.mjs";
import { lastPushRecord, type PushRecord } from "../../hooks/health.mjs";
import type { Claim, Session, Workspace } from "../model.ts";
import { type TalkEvent, talkEventsOf } from "../briefs.ts";
import { type EndedSession, normalEndOf } from "../restarting.ts";
import { type Fact, factsOf, type Health, type HealthConfig, healthOf, mergeHealth } from "../health.ts";
import { sessionProcOf } from "../session-proc.ts";
import { attachDirOf } from "../session-origin.ts";
import { readJob, settleJob } from "../job-state.ts";
import { kanaAtOf, lastMessageOf } from "../judges/report.ts";
import { type Activity, type ActivityTrack, activityFromTrack, activityTrackOf } from "../activity.ts";

interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  procStart?: string;
  name?: string;
  status?: string;
  kind?: string; // bg·interactive
  jobId?: string; // kind가 bg일 때 ~/.claude/jobs/<jobId>(ATC-99)
  entrypoint?: string; // claude-desktop·cli
  account?: string; // 읽은 폴더의 ACCOUNT 라벨(ATC-146). 파일에는 없고 reader가 붙인다. 등록부가 없으면 없다
  configDir?: string; // 읽은 폴더(서버 안에서만 쓴다. 스냅샷에는 싣지 않는다. 기본이 아닌 폴더의 background 세션만 attachDir로 싣는다, ATC-301)
}

// background 세션이 기본이 아닌 폴더에서 읽혔으면 그 폴더(ATC-301, 순수). attach 명령이 CLAUDE_CONFIG_DIR로 붙인다
export function attachDirField(s: Pick<SessionFile, "kind" | "configDir">, defaultDir = config.claudeDir, home = config.home): { attachDir?: string } {
  const dir = s.kind === "bg" || s.kind === "background" ? attachDirOf(s.configDir, defaultDir, home) : undefined;
  return dir ? { attachDir: dir } : {};
}

// 세션 파일의 kind·jobId(ATC-98, 순수). bg는 background, interactive는 그대로, 없거나 모르는 값이면 아무것도 없다. jobId는 background에만
export function sessionKindOf(s: Pick<SessionFile, "kind" | "jobId">): Pick<Session, "kind" | "jobId"> {
  if (s.kind === "bg" || s.kind === "background") return { kind: "background", ...(typeof s.jobId === "string" && s.jobId ? { jobId: s.jobId } : {}) };
  if (s.kind === "interactive") return { kind: "interactive" };
  return {};
}

// 세션 폴더(~/.claude/projects/<cwd>/<sessionId>/). 대화 기록은 그 옆 <sessionId>.jsonl, 서브에이전트는 안의 subagents/
// account: 세션이 있는 ACCOUNT 라벨(ATC-146). 없거나 모르는 라벨이면 기본 폴더
export function sessionDir(cwd: string, sessionId: string, account?: string | null, folders: readonly AccountFolder[] = accountFolders()): string {
  const dir = folderOfAccount(account, folders)?.dir ?? config.claudeDir;
  return join(dir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), sessionId);
}

function transcriptPath(s: SessionFile): string {
  return `${join(s.configDir ?? config.claudeDir, "projects", s.cwd.replace(/[^a-zA-Z0-9]/g, "-"), s.sessionId)}.jsonl`;
}

function mtime(path: string): Date | null {
  try {
    return statSync(path).mtime;
  } catch {
    return null;
  }
}

// 등록된 모든 폴더의 sessions/를 읽는다(ATC-146). 세션의 ACCOUNT는 그 파일이 있는 폴더다. 폴더가 없거나 못 읽으면 그 폴더만 건너뛴다
export function readClaudeSessions(folders: readonly AccountFolder[] = accountFolders()): { sessions: Session[]; files: SessionFile[] } {
  const files: SessionFile[] = [];
  const labeled = observedLabelsOn(folders);
  const seen = new Set<string>();
  for (const folder of folders) {
    const dir = join(folder.dir, "sessions");
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = JSON.parse(readFileSync(join(dir, f), "utf8")) as SessionFile;
        if (seen.has(s.sessionId)) continue; // 같은 id가 두 폴더에 있으면 먼저 읽은 폴더
        seen.add(s.sessionId);
        files.push({ ...s, configDir: folder.dir, ...(labeled ? { account: folder.label } : {}) });
      } catch {}
    }
  }
  const livenessOn = loadLivenessSwitch() === "on";
  const sessions = files.map((s): Session => {
    const pidAlive = isAlive(s.pid, s.procStart);
    const lastActiveAt = mtime(transcriptPath(s))?.toISOString() ?? null;
    // JOB LIVENESS(ATC-534): bg 세션은 pid만으로 살았다고 하지 않는다. daemon roster에도 세션 pid의 procStart 확인에도 증거가 없으면 job이 없어진 것(absent). 스위치가 off면 지금 규칙
    const gone = pidAlive && livenessOn && proofOfSession(s, s.configDir ?? config.claudeDir) === "gone";
    const alive = pidAlive && !gone;
    const jobGone = gone ? jobGoneWhyOf(readJob(s.jobId, join(s.configDir ?? config.claudeDir, "jobs"))?.writtenAt ?? lastActiveAt) : null;
    // 출처(ATC-76): 살아 있는 세션만, pid마다 한 번 읽는다(session-origin.ts가 캐시)
    const proc = alive ? sessionProcOf(s.pid, s.kind, s.entrypoint) : null;
    return {
      id: s.sessionId,
      agent: "claude",
      name: s.name || s.sessionId.slice(0, 8),
      status: !alive ? "dead" : s.status === "busy" ? "busy" : "idle",
      pid: s.pid,
      cwd: s.cwd,
      startedAt: new Date(s.startedAt).toISOString(),
      lastActiveAt,
      repo: null,
      workspacePath: null,
      ...(proc ? { origin: proc.origin, permissionMode: proc.permissionMode } : {}),
      ...(s.account ? { account: s.account } : {}),
      ...sessionKindOf(s),
      ...(jobGone ? { jobGone } : {}),
      ...attachDirField(s),
      // 백그라운드 job 상태(ATC-99): 살아 있는 bg 세션만. 파일은 mtime으로 캐시하고 읽기만 한다
      ...(alive && s.kind === "bg" ? { job: settleJob(readJob(s.jobId, join(s.configDir ?? config.claudeDir, "jobs")), lastActiveAt) ?? null } : {}),
    };
  });
  return { sessions, files };
}

export function readHookClaims(): Claim[] {
  const root = join(config.stateDir, "claims");
  const claims: Claim[] = [];
  let sessionDirs: string[] = [];
  try {
    sessionDirs = readdirSync(root);
  } catch {
    return claims;
  }
  for (const sessionId of sessionDirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, sessionId));
    } catch {
      continue;
    }
    for (const f of entries) {
      const file = join(root, sessionId, f);
      try {
        const body = JSON.parse(readFileSync(file, "utf8"));
        claims.push({
          sessionId,
          workspacePath: body.workspace,
          since: body.since,
          lastAt: statSync(file).mtime.toISOString(),
          source: "hook",
          state: "active",
          handedOffTo: null,
          tool: body.tool ?? null,
        });
      } catch {}
    }
  }
  return claims;
}

const TAIL_BYTES = 1 << 20;
const inferCache = new Map<string, { key: string; claim: Claim | null }>();

function readTail(path: string, size: number): string {
  const fd = openSync(path, "r");
  try {
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const text = buf.toString("utf8");
    // 잘린 첫 줄은 버린다
    return len < size ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

// 경로를 가장 깊이 포함하는 linked worktree
function workspaceOf(path: string, deepestFirst: Workspace[]): Workspace | undefined {
  const ws = deepestFirst.find((w) => path === w.path || path.startsWith(w.path + "/"));
  return ws && !ws.isMain ? ws : undefined;
}

interface Touch {
  workspacePath: string;
  at: number;
}

// 대화 기록 JSONL에서 도구 호출(tool_use)만 읽어 hook과 같은 규칙(toolPaths)으로 워크트리 접촉을 뽑는다.
// 도구 결과(ls 출력, JSON 등)나 메시지 본문에 경로가 나온 것은 세지 않는다.
export function touchesFromTranscript(text: string, workspaces: Workspace[]): Touch[] {
  const deepestFirst = [...workspaces].sort((a, b) => b.path.length - a.path.length);
  const touches: Touch[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
    const at = Date.parse(entry.timestamp);
    if (Number.isNaN(at)) continue;
    for (const block of entry.message.content) {
      if (block?.type !== "tool_use") continue;
      for (const p of toolPaths(block.name, block.input, entry.cwd)) {
        const ws = workspaceOf(p, deepestFirst);
        if (ws) touches.push({ workspacePath: ws.path, at });
      }
    }
  }
  return touches;
}

// 본 대화 기록과, 점유 TTL 안에 갱신된 서브에이전트 기록
function transcriptFiles(s: SessionFile): { path: string; size: number; mtimeMs: number }[] {
  const main = transcriptPath(s);
  const candidates = [main];
  const subDir = join(main.replace(/\.jsonl$/, ""), "subagents");
  try {
    for (const f of readdirSync(subDir)) if (f.endsWith(".jsonl")) candidates.push(join(subDir, f));
  } catch {}
  const files = [];
  for (const path of candidates) {
    try {
      const st = statSync(path);
      if (path === main || Date.now() - st.mtimeMs < config.claimTtlMs) files.push({ path, size: st.size, mtimeMs: st.mtimeMs });
    } catch {}
  }
  return files;
}

// hook 기록이 없는 세션용: 가장 최근에 작업하러 들어간 워크트리 하나를 ESTIMATED TRACK으로 돌려준다.
export function inferTranscriptClaim(s: SessionFile, workspaces: Workspace[]): Claim | null {
  const files = transcriptFiles(s);
  if (!files.length) return null;
  const key = files.map((f) => `${f.path}:${f.size}:${f.mtimeMs}`).join("|");
  const cached = inferCache.get(s.sessionId);
  if (cached?.key === key) return cached.claim;

  const touches = files.flatMap((f) => touchesFromTranscript(readTail(f.path, f.size), workspaces));
  const latest = touches.reduce<Touch | null>((a, b) => (!a || b.at > a.at ? b : a), null);
  const claim: Claim | null = latest && {
    sessionId: s.sessionId,
    workspacePath: latest.workspacePath,
    since: new Date(
      Math.min(...touches.filter((t) => t.workspacePath === latest.workspacePath).map((t) => t.at)),
    ).toISOString(),
    lastAt: new Date(latest.at).toISOString(),
    source: "transcript",
    state: "active",
    handedOffTo: null,
    tool: null,
  };
  inferCache.set(s.sessionId, { key, claim });
  return claim;
}

// 대화 기록의 지시서·READBACK·질문 사건(ATC-32 LOGBOOK 측정). 파일은 추가만 되므로 지난번 크기 뒤만 읽는다.
// 사건에는 본문을 두지 않는다(briefs.ts talkEventsOf). 돌려주는 배열은 캐시 자체라 고치지 말고 복사해서 쓴다
const talkCache = new Map<string, { size: number; events: TalkEvent[] }>();
const TALK_CHUNK = 4 * 1024 * 1024;
export function talkEventsFile(path: string, source: "leader" | "crew" = "leader"): TalkEvent[] {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return [];
  }
  let hit = talkCache.get(path);
  if (!hit || size < hit.size) hit = { size: 0, events: [] }; // 줄었으면 처음부터
  if (size === hit.size) return hit.events;
  const fd = openSync(path, "r");
  try {
    // size는 마지막 줄바꿈 뒤까지(쓰다 만 줄은 다음에). 바이트로 잘라 여러 바이트 글자가 쪼개지지 않게
    let pos = hit.size;
    const events = [...hit.events];
    const buf = Buffer.alloc(TALK_CHUNK);
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(TALK_CHUNK, size - pos), pos);
      if (n <= 0) break;
      const cut = buf.lastIndexOf(0x0a, n - 1);
      if (cut < 0) {
        if (n === TALK_CHUNK) pos += n; // 4MB를 넘는 한 줄은 건너뛴다
        break;
      }
      events.push(...talkEventsOf(buf.toString("utf8", 0, cut), source));
      pos += cut + 1;
    }
    hit = { size: pos, events };
    talkCache.set(path, hit);
    return events;
  } finally {
    closeSync(fd);
  }
}

// 세션 폴더 하나의 사건: 본 대화 기록(leader)과 서브에이전트 기록의 파일 쓰기(crew, ATC-33).
// talkEventsFile은 캐시 배열을 돌려주므로 복사해서 합친다(그대로 push하면 leader 캐시에 crew 사건이 쌓인다)
export function sessionEventsOf(dir: string): TalkEvent[] {
  const out = [...talkEventsFile(`${dir}.jsonl`, "leader")];
  let subs: string[] = [];
  try {
    subs = readdirSync(join(dir, "subagents")).filter((f) => f.endsWith(".jsonl"));
  } catch {}
  for (const f of subs) out.push(...talkEventsFile(join(dir, "subagents", f), "crew"));
  return out;
}

// AIRCRAFT health(ATC-45): 살아 있는 세션의 대화 기록 끝(64KB)만 읽는다. 사실은 파일 크기·시각이 같으면 다시 읽지 않는다
const HEALTH_TAIL = 64 * 1024;
// ACTIVITY(ATC-97)도 같은 끝·같은 캐시에서 읽는다(두 번 읽지 않는다)
const factsCache = new Map<string, { key: string; facts: Fact[]; track: ActivityTrack | null }>();
// LANGUAGE(ATC-150): 같은 끝에서 가나를 찾는다. 끝(64KB)이 지나가도 사라지지 않게 세션마다 처음 걸린 시각을 기억한다(서버가 사는 동안, 세션당 한 번)
const kanaSeen = new Map<string, number>();

// push hook(ATC-47, hooks/health.mjs)이 남긴 health/<sessionId>.jsonl의 마지막 줄. 파일 끝 4KB만 본다.
// hook이 없거나 파일이 없으면 null — pull만으로 판정한다. 파일 크기·시각이 같으면 다시 읽지 않는다
const PUSH_TAIL = 4 * 1024;
const pushCache = new Map<string, { key: string; rec: PushRecord | null }>();
export function readPushRecord(sessionId: string): PushRecord | null {
  const path = join(config.stateDir, "health", `${sessionId}.jsonl`);
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = pushCache.get(sessionId);
  if (hit?.key === key) return hit.rec;
  const fd = openSync(path, "r");
  let rec: PushRecord | null = null;
  try {
    const len = Math.min(st.size, PUSH_TAIL);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, st.size - len);
    const text = buf.toString("utf8");
    rec = lastPushRecord(len < st.size ? text.slice(text.indexOf("\n") + 1) : text);
  } finally {
    closeSync(fd);
  }
  pushCache.set(sessionId, { key, rec });
  return rec;
}

export function healthOfSession(
  s: SessionFile,
  status: Session["status"],
  now: number,
  cfg?: HealthConfig,
): { health: Health | null; activity: Activity | null; languageAt?: number } {
  if (status === "dead") return { health: null, activity: null };
  const path = transcriptPath(s);
  let st;
  try {
    st = statSync(path);
  } catch {
    return { health: null, activity: null };
  }
  const key = `${st.size}:${st.mtimeMs}`;
  let hit = factsCache.get(s.sessionId);
  if (hit?.key !== key) {
    const fd = openSync(path, "r");
    try {
      const len = Math.min(st.size, HEALTH_TAIL);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, st.size - len);
      const text = buf.toString("utf8");
      const tail = len < st.size ? text.slice(text.indexOf("\n") + 1) : text;
      hit = { key, facts: factsOf(tail), track: activityTrackOf(tail) };
      if (!kanaSeen.has(s.sessionId)) {
        const at = kanaAtOf(tail);
        if (at !== null) kanaSeen.set(s.sessionId, at);
      }
    } finally {
      closeSync(fd);
    }
    factsCache.set(s.sessionId, hit);
  }
  const pull = healthOf(hit.facts, { status, lastWriteAt: st.mtimeMs }, now, cfg);
  // push가 대화 기록의 마지막 사실보다 새로우면 push가 이긴다(ATC-47)
  return { health: mergeHealth(readPushRecord(s.sessionId), pull, hit.facts, now), activity: activityFromTrack(hit.track, status), ...(kanaSeen.has(s.sessionId) ? { languageAt: kanaSeen.get(s.sessionId)! } : {}) };
}

// 턴이 끝난 세션의 마지막 CAPTAIN 메시지(ATC-89 REPORT 판정). 대화 기록 끝만 읽고 저장하지 않는다 — 부르는 쪽이 ATCC 확인을 먼저 한다.
const REPORT_TAIL = 128 * 1024;
export function lastMessageOfSession(cwd: string, sessionId: string, account?: string): { text: string; at: number; cut?: true } | null {
  const path = `${sessionDir(cwd, sessionId, account)}.jsonl`;
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  const fd = openSync(path, "r");
  try {
    const len = Math.min(st.size, REPORT_TAIL);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, st.size - len);
    const text = buf.toString("utf8");
    return lastMessageOf(len < st.size ? text.slice(text.indexOf("\n") + 1) : text);
  } finally {
    closeSync(fd);
  }
}

// 세션 파일이 없는 대화 기록 중 maxAgeMs 안에 쓴 것(ATC-91 RESTARTING). 데스크톱 /clear는 세션을 끝내고 새 id를 받는데, 새 대화 기록은
// 다음 지시가 와야 생긴다. 이름은 대화 기록의 마지막 custom-title, 정상 종료인지는 끝의 사실로 본다. 본문은 남기지 않는다
const ENDED_TAIL = 96 * 1024;
export function readEndedSessions(knownIds: ReadonlySet<string>, now: number, maxAgeMs: number, roots: readonly string[] = accountFolders().map((f) => join(f.dir, "projects"))): EndedSession[] {
  return roots.flatMap((root) => readEndedIn(root, knownIds, now, maxAgeMs));
}

// 대화 기록 끝에서 timestamp가 있는 마지막 줄의 시각. 종료 때 붙는 mode·permission-mode·worktree-state·cost-state 같은 줄은 timestamp가 없어 건너뛴다(ATC-511)
export function lastTimestampOf(tailText: string): number | null {
  const lines = tailText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\{.*?"timestamp":"([^"]+)"/.exec(lines[i]!);
    const t = m ? Date.parse(m[1]!) : NaN;
    if (Number.isFinite(t)) return t;
  }
  return null;
}

// 데몬 job(--bg)이 호스트한 세션 id. bg 세션은 /clear로 끝나지 않는다: idle 퇴역·atc STOP·done·killed 모두 RESTARTING이 아니다(ATC-511)
function bgSessionIds(jobsDir: string): Set<string> {
  const ids = new Set<string>();
  let jobs: string[] = [];
  try {
    jobs = readdirSync(jobsDir);
  } catch {
    return ids;
  }
  for (const j of jobs) {
    try {
      const text = readFileSync(join(jobsDir, j, "state.json"), "utf8");
      const m = /"sessionId"\s*:\s*"([^"]+)"/.exec(text);
      if (m) ids.add(m[1]!);
      const l = /"linkScanPath"\s*:\s*"([^"]+?)([0-9a-f-]{36})\.jsonl"/.exec(text);
      if (l) ids.add(l[2]!);
    } catch {}
  }
  return ids;
}

function readEndedIn(root: string, knownIds: ReadonlySet<string>, now: number, maxAgeMs: number): EndedSession[] {
  const out: EndedSession[] = [];
  let bg: Set<string> | null = null; // 후보가 생길 때만 한 번 읽는다
  let projects: string[] = [];
  try {
    projects = readdirSync(root);
  } catch {
    return out;
  }
  for (const proj of projects) {
    let names: string[] = [];
    try {
      names = readdirSync(join(root, proj));
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".jsonl")) continue;
      const sessionId = f.slice(0, -6);
      if (knownIds.has(sessionId)) continue;
      const path = join(root, proj, f);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (now - st.mtimeMs >= maxAgeMs) continue;
      let text = "";
      try {
        const fd = openSync(path, "r");
        try {
          const len = Math.min(st.size, ENDED_TAIL);
          const buf = Buffer.alloc(len);
          readSync(fd, buf, 0, len, st.size - len);
          text = buf.toString("utf8");
          if (len < st.size) text = text.slice(text.indexOf("\n") + 1);
        } finally {
          closeSync(fd);
        }
      } catch {
        continue;
      }
      const title = /"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g;
      let name: string | null = null;
      for (let m = title.exec(text); m; m = title.exec(text)) name = m[1]!;
      if (!name) continue;
      bg ??= bgSessionIds(join(dirname(root), "jobs"));
      if (bg.has(sessionId)) continue;
      // 끝난 때는 파일 mtime이 아니라 대화의 마지막 timestamp. mtime은 퇴역 때 붙는 줄로 늦춰진다. timestamp가 없으면 mtime으로
      const endedAt = lastTimestampOf(text) ?? st.mtimeMs;
      if (now - endedAt >= maxAgeMs) continue;
      out.push({ sessionId, name: JSON.parse(`"${name}"`) as string, endedAt, normalEnd: normalEndOf(text) });
    }
  }
  return out;
}
