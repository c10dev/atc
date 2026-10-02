import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { accountFolders } from "./accounts.ts";
import { attachCommandOf } from "./session-origin.ts";

// 백그라운드 job 상태(ATC-99, docs/fleet.md 8.5.2): Claude Code가 ~/.claude/jobs/<jobId>/state.json에 적는 job의 state·detail·needs.
// 읽기만 한다(쓰기·삭제·잠금 없음). Claude Code 내부 파일이라 모르는 모양은 null로 물러난다(2.1.284 기준).
// intent(팀은 CREW BRIEFING 전체)·output·providerEnv·linkScanPath는 읽지도 내보내지도 않는다: parseJob은 아래 필드만 고른다.

export const JOB_STATES = ["working", "blocked", "done", "stopped", "failed"] as const;
export type JobStateName = (typeof JOB_STATES)[number];

export interface Job {
  state: JobStateName;
  detail: string; // Claude Code가 적은 한 줄
  needs: string | null; // blocked일 때 사람에게 필요한 것
  suggestedReply: string | null; // 보여 주고 복사만 한다. atc는 어디에도 보내지 않는다
  pendingNeeds?: string | null; // state가 working인데 needs가 있는 것("approve Write: …", ATC-327). health가 PENDING일 때만 보인다(pendingNeedsOf). blocked의 needs 규칙(ATC-133·138)과 따로 둔다
  since: string | null; // 지금 state가 시작된 시각(timeline.jsonl), 없으면 state.json의 updatedAt
  tempo?: string | null; // state.json의 tempo(active·idle·blocked …). blocked가 끝났는지 가리는 데 쓴다(ATC-133)
  writtenAt?: string | null; // state.json을 마지막으로 쓴 시각(updatedAt, 없으면 파일 mtime). 지금 needs·detail이 적힌 때라서 "가장 최근의 기다림"을 가린다(ATC-138)
  // blocked인 채 남은 job 파일을 working으로 고쳐 보인 것(settleJob). 툴팁이 파일의 원래 모습을 말한다. 고치지 않았으면 없다
  settled?: { from: "blocked"; since: string | null; reason: "tempo" | "turn"; resumedAt: string | null };
}

const DETAIL_MAX = 300;
const REPLY_MAX = 600;
// 제어 문자를 지우고 공백을 줄여 자른다. 빈 문자열은 null
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const isoOf = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

// timeline.jsonl 끝에서 지금 state가 시작된 시각: 끝에서부터 같은 state가 이어진 줄들의 첫 줄. 줄이 없거나 state가 다르면 null
export function sinceOf(timelineTail: string | null | undefined, state: string): string | null {
  if (!timelineTail) return null;
  const lines: { at: string; state: string }[] = [];
  for (const raw of timelineTail.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const d = JSON.parse(raw) as { at?: unknown; state?: unknown };
      const at = isoOf(d.at);
      if (at && typeof d.state === "string") lines.push({ at, state: d.state });
    } catch {} // 꼬리를 잘라 읽으면 첫 줄이 깨진다
  }
  if (!lines.length || lines[lines.length - 1]!.state !== state) return null;
  let i = lines.length - 1;
  while (i > 0 && lines[i - 1]!.state === state) i--;
  return lines[i]!.at;
}

// state.json(파싱한 값)과 timeline 꼬리 → Job. state가 모르는 값이면 null
export function parseJob(raw: unknown, timelineTail?: string | null, mtimeMs?: number | null): Job | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const state = r.state;
  if (typeof state !== "string" || !(JOB_STATES as readonly string[]).includes(state)) return null;
  return {
    state: state as JobStateName,
    detail: clean(r.detail, DETAIL_MAX) ?? "",
    needs: state === "blocked" ? clean(r.needs, DETAIL_MAX) : null,
    suggestedReply: state === "blocked" ? clean(r.suggestedReply, REPLY_MAX) : null,
    pendingNeeds: state === "working" ? clean(r.needs, DETAIL_MAX) : null,
    since: sinceOf(timelineTail, state) ?? isoOf(r.updatedAt),
    tempo: clean(r.tempo, 20),
    writtenAt: isoOf(r.updatedAt) ?? (mtimeMs != null && Number.isFinite(mtimeMs) ? new Date(mtimeMs).toISOString() : null),
  };
}

// blocked인데 이미 일하는 job(ATC-133, ATC-138): SUPERVISOR가 답한 뒤에도 파일이 blocked로 남는다.
// 끝난 것으로 보는 것은 다음 둘뿐이다:
//  - tempo가 active
//  - 세션의 마지막 활동(대화 기록 mtime — atc가 이미 읽는 값)이 "지금 needs·detail이 적힌 때"(writtenAt, 없으면 since)보다 나중이고 tempo가 blocked가 아님
// since는 blocked가 처음 시작된 순간이라, working을 거치지 않고 다시 blocked가 되면 옛 기다림이다. 그래서 가장 최근에 쓴 때와 견준다.
// tempo가 blocked이고 needs가 있으면 그 사이 턴이 있었어도 끝난 것이 아니다(다시 사람을 기다림). blocked가 적힐 때 마지막 턴이 함께 기록되므로 GRACE 안의 활동은 그 턴으로 본다. 읽기만 한다
const SETTLE_GRACE_MS = 30_000;
export function settleJob(job: Job | null | undefined, lastActiveAt?: string | null): Job | null | undefined {
  if (!job || job.state !== "blocked" || job.settled) return job;
  const active = job.tempo === "active";
  if (!active && job.tempo === "blocked" && job.needs) return job; // 다시 기다리는 중
  const wait = Date.parse(job.writtenAt ?? job.since ?? "");
  const last = lastActiveAt ? Date.parse(lastActiveAt) : NaN;
  const turn = Number.isFinite(wait) && Number.isFinite(last) && last > wait + SETTLE_GRACE_MS;
  if (!active && !(turn && job.tempo !== "blocked")) return job;
  // detail은 답한 글이거나 blocked 때의 옛 글이라 working의 한 줄로 보이지 않는다
  return { ...job, state: "working", detail: "", needs: null, suggestedReply: null, settled: { from: "blocked", since: job.since, reason: active ? "tempo" : "turn", resumedAt: turn ? new Date(last).toISOString() : null } };
}

// ── 읽기: mtime·크기로 캐시 ──
const JOB_ID = /^[0-9a-f]{6,}$/;
const TIMELINE_TAIL = 16 * 1024;
const cache = new Map<string, { key: string; job: Job | null }>();

const statOf = (p: string) => {
  try {
    const st = statSync(p);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "-";
  }
};

const mtimeOf = (p: string): number | null => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
};

function tailOf(path: string): string | null {
  try {
    const fd = openSync(path, "r");
    try {
      const size = statSync(path).size;
      const len = Math.min(size, TIMELINE_TAIL);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      return buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

// dir가 없으면 등록된 모든 폴더의 jobs/를 차례로 본다(ATC-146). 세션 파일을 읽은 쪽은 그 폴더의 jobs/를 넘긴다
export function readJob(jobId: string | null | undefined, dir?: string): Job | null {
  if (!jobId || !JOB_ID.test(jobId)) return null;
  if (dir === undefined) {
    for (const f of accountFolders()) {
      const job = readJobIn(jobId, join(f.dir, "jobs"));
      if (job) return job;
    }
    return null;
  }
  return readJobIn(jobId, dir);
}

function readJobIn(jobId: string, dir: string): Job | null {
  const stateFile = join(dir, jobId, "state.json");
  const timeline = join(dir, jobId, "timeline.jsonl");
  const key = `${statOf(stateFile)}|${statOf(timeline)}`;
  const ck = `${dir}|${jobId}`;
  const hit = cache.get(ck);
  if (hit?.key === key) return hit.job;
  let job: Job | null = null;
  try {
    job = parseJob(JSON.parse(readFileSync(stateFile, "utf8")), tailOf(timeline), mtimeOf(stateFile));
  } catch {} // 없음·깨짐·바뀐 모양: null
  cache.set(ck, { key, job });
  return job;
}

// ── 알림: blocked가 minMin분 넘게 이어짐 ──
// 관제 세션(ATC-352): 사람의 결정이 필요해도 blocked로 턴을 끝내면 안 된다(DECISION 카드를 올린다). 이름으로만 안다
export const CONTROL_SESSION_NAMES = ["TOWER", "OCC", "MCC", "CROSSCHECK", "DUTY"] as const;
export const isControlSessionName = (name: string) => (CONTROL_SESSION_NAMES as readonly string[]).includes(name.trim().toUpperCase());
export const CONTROL_BLOCKED_NEXT = "규칙 위반: 관제 세션은 SUPERVISOR를 기다리며 턴을 끝내지 않는다. `atcctl decision`으로 카드를 올리고 턴을 끝내게 한다(세션을 다시 돌려 규칙을 읽힌다)";
export interface BlockedAlert {
  key: string;
  message: string;
  sessionIds: string[];
}
export const BLOCKED_NEXT = "SUPERVISOR가 `claude attach <id>`로 붙어 답하거나 메시지를 보낸다";
// 기본이 아닌 폴더(attachDir)의 세션이면 카드가 복사하는 것과 같은 명령을 적는다(ATC-301). 기본 폴더면 전과 같은 글
export function blockedNextOf(jobId?: string | null, attachDir?: string | null): string {
  if (!attachDir) return BLOCKED_NEXT;
  return BLOCKED_NEXT.replace("claude attach <id>", attachCommandOf(jobId || "<id>", attachDir));
}
export function blockedAlerts(xs: { id: string; name: string; job?: Job | null; jobId?: string | null; attachDir?: string | null; lastActiveAt?: string | null }[], now: number, minMin: number): BlockedAlert[] {
  const out: BlockedAlert[] = [];
  for (const x of xs) {
    const j = settleJob(x.job, x.lastActiveAt);
    if (!j || j.state !== "blocked") continue;
    const since = j.since ? Date.parse(j.since) : NaN;
    if (!Number.isFinite(since) || now - since < minMin * 60_000) continue;
    const min = Math.floor((now - since) / 60_000);
    if (isControlSessionName(x.name)) {
      out.push({ key: `health|CONTROL-BLOCKED|${x.id}`, sessionIds: [x.id], message: `RULE BREACH — 관제 세션 ${x.name}이 ${min}분째 사람을 기다리며 blocked: ${j.needs ?? "(내용 없음)"} — ${CONTROL_BLOCKED_NEXT}` });
      continue;
    }
    out.push({
      key: `health|BLOCKED|${x.id}`,
      sessionIds: [x.id],
      message: `BLOCKED — ${x.name}이 ${min}분째 사람을 기다림: ${j.needs ?? "(내용 없음)"} — ${blockedNextOf(x.jobId, x.attachDir)}`,
    });
  }
  return out;
}
