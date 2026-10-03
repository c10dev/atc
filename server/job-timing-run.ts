import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { type JobTimingSwitch, jobTimer, parseJobTimingSwitch, sumTimings, type TimingLine } from "./job-timing.ts";
import { record } from "./recorder.ts";

// JOB TIMING의 읽고 쓰기(ATC-525). 시간을 재는 것은 job-timing.ts(순수). 스위치는 job-timing.json(원자적 JSON, 기본 on)이고 설정 창(fromThisApp)에서만 바꾼다 — atcctl 명령은 없다(K3).
// 구간(FLUSH_MS)마다 job-timing/<날짜>.jsonl에 한 줄을 더한다(추가만). 일이 없는 구간은 쓰지 않는다. 쓰기를 못 하면 그 구간의 시간 수를 dropped에 더한다.
const FLUSH_MS = 5 * 60_000;
const RETENTION_DAYS = 14;
const SWITCH_FILE = () => join(config.stateDir, "job-timing.json");
const DIR = () => join(config.stateDir, "job-timing");

export function loadJobTimingSwitch(file = SWITCH_FILE()): JobTimingSwitch {
  try {
    return parseJobTimingSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다. 타이머는 바로 켜고 끈다
export function saveJobTimingSwitch(v: JobTimingSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadJobTimingSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) {
    jobTimer.setEnabled(v === "on");
    record({ t: new Date().toISOString(), kind: "policy", op: "job-timing-mode", by, from, to: v });
  }
}

export function readTimingLines(sinceMs: number, dir = DIR()): TimingLine[] {
  const first = new Date(sinceMs).toISOString().slice(0, 10);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) >= first).sort();
  } catch {
    return [];
  }
  const out: TimingLine[] = [];
  for (const f of files)
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as TimingLine;
        if (Date.parse(r.t) >= sinceMs) out.push(r);
      } catch {}
    }
  return out;
}

function pruneTimings(now: number, dir = DIR()) {
  const cutoff = new Date(now - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  try {
    for (const f of readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cutoff) rmSync(join(dir, f));
  } catch {}
}

// 지금 구간을 줄로 적는다. 꺼져 있거나 잰 것이 없으면 쓰지 않는다
export function flushTimings(now = Date.now(), dir = DIR()): boolean {
  if (!jobTimer.enabled) return false;
  const n = jobTimer.runsInWindow();
  const w = jobTimer.take();
  if (n === 0) return false;
  const t = new Date(now).toISOString();
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${t.slice(0, 10)}.jsonl`), JSON.stringify({ t, kind: "job-timing", ...w }) + "\n");
    return true;
  } catch {
    jobTimer.drop(n);
    return false;
  }
}

export function mountJobTiming(app: Hono) {
  const sw = loadJobTimingSwitch();
  jobTimer.setEnabled(sw === "on");
  setInterval(() => {
    try {
      flushTimings();
      pruneTimings(Date.now());
    } catch {}
  }, FLUSH_MS).unref();

  // 스위치와 합친 시간(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/job-timing", (c) => {
    const hours = Math.min(24 * RETENTION_DAYS, Math.max(0.1, Number(c.req.query("hours")) || 1));
    const lines = readTimingLines(Date.now() - hours * 3_600_000);
    return c.json({ switch: loadJobTimingSwitch(), hours, windows: lines.length, ...sumTimings(lines) });
  });
}
