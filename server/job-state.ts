import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";

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
  since: string | null; // 지금 state가 시작된 시각(timeline.jsonl), 없으면 state.json의 updatedAt
  tempo?: string | null; // state.json의 tempo(active·idle·blocked …). blocked가 끝났는지 가리는 데 쓴다(ATC-133)
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
export function parseJob(raw: unknown, timelineTail?: string | null): Job | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const state = r.state;
  if (typeof state !== "string" || !(JOB_STATES as readonly string[]).includes(state)) return null;
  return {
    state: state as JobStateName,
    detail: clean(r.detail, DETAIL_MAX) ?? "",
    needs: state === "blocked" ? clean(r.needs, DETAIL_MAX) : null,
    suggestedReply: state === "blocked" ? clean(r.suggestedReply, REPLY_MAX) : null,
    since: sinceOf(timelineTail, state) ?? isoOf(r.updatedAt),
    tempo: clean(r.tempo, 20),
  };
}

// blocked인데 이미 일하는 job(ATC-133): SUPERVISOR가 답한 뒤에도 파일이 blocked로 남는다.
// tempo가 active이거나, 세션의 마지막 활동(대화 기록 mtime — atc가 이미 읽는 값)이 since보다 나중이면 blocked는 끝난 것이다.
// blocked가 시작될 때 마지막 턴이 함께 기록되므로 GRACE 안의 활동은 그 턴으로 본다. 읽기만 한다
const SETTLE_GRACE_MS = 30_000;
export function settleJob(job: Job | null | undefined, lastActiveAt?: string | null): Job | null | undefined {
  if (!job || job.state !== "blocked" || job.settled) return job;
  const since = job.since ? Date.parse(job.since) : NaN;
  const last = lastActiveAt ? Date.parse(lastActiveAt) : NaN;
  const turn = Number.isFinite(since) && Number.isFinite(last) && last > since + SETTLE_GRACE_MS;
  if (job.tempo !== "active" && !turn) return job;
  // detail은 답한 글이거나 blocked 때의 옛 글이라 working의 한 줄로 보이지 않는다
  return { ...job, state: "working", detail: "", needs: null, suggestedReply: null, settled: { from: "blocked", since: job.since, reason: job.tempo === "active" ? "tempo" : "turn", resumedAt: turn ? new Date(last).toISOString() : null } };
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

export function readJob(jobId: string | null | undefined, dir = join(config.claudeDir, "jobs")): Job | null {
  if (!jobId || !JOB_ID.test(jobId)) return null;
  const stateFile = join(dir, jobId, "state.json");
  const timeline = join(dir, jobId, "timeline.jsonl");
  const key = `${statOf(stateFile)}|${statOf(timeline)}`;
  const ck = `${dir}|${jobId}`;
  const hit = cache.get(ck);
  if (hit?.key === key) return hit.job;
  let job: Job | null = null;
  try {
    job = parseJob(JSON.parse(readFileSync(stateFile, "utf8")), tailOf(timeline));
  } catch {} // 없음·깨짐·바뀐 모양: null
  cache.set(ck, { key, job });
  return job;
}

// ── 알림: blocked가 minMin분 넘게 이어짐 ──
export interface BlockedAlert {
  key: string;
  message: string;
  sessionIds: string[];
}
export const BLOCKED_NEXT = "SUPERVISOR가 `claude attach <id>`로 붙어 답하거나 메시지를 보낸다";
export function blockedAlerts(xs: { id: string; name: string; job?: Job | null; jobId?: string | null; lastActiveAt?: string | null }[], now: number, minMin: number): BlockedAlert[] {
  const out: BlockedAlert[] = [];
  for (const x of xs) {
    const j = settleJob(x.job, x.lastActiveAt);
    if (!j || j.state !== "blocked") continue;
    const since = j.since ? Date.parse(j.since) : NaN;
    if (!Number.isFinite(since) || now - since < minMin * 60_000) continue;
    const min = Math.floor((now - since) / 60_000);
    out.push({
      key: `health|BLOCKED|${x.id}`,
      sessionIds: [x.id],
      message: `BLOCKED — ${x.name}이 ${min}분째 사람을 기다림: ${j.needs ?? "(내용 없음)"} — ${BLOCKED_NEXT}`,
    });
  }
  return out;
}
