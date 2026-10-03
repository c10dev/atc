import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { type BrowserMode, type BrowserRun, browserDirOf, browserGateView, parseBrowserGateConfig, parseBrowserRuns } from "./browser-gate.ts";

// BROWSER GATE의 파일 입출력(ATC-520). 폴더는 browserDirOf(): 운영 상태 폴더와 따로다. 읽기는 늘 실패해도 기본값으로 돈다

const TAIL_BYTES = 2_000_000; // 기록이 커도 끝부분만 읽는다

const readRaw = (dir: string): unknown => {
  try {
    return JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  } catch {
    return {};
  }
};

export const loadBrowserConfig = (env: NodeJS.ProcessEnv = process.env) => parseBrowserGateConfig(readRaw(browserDirOf(env)), env);
export const loadBrowserMode = (env: NodeJS.ProcessEnv = process.env): BrowserMode => loadBrowserConfig(env).mode;

// mode만 바꿔 쓴다(다른 칸은 그대로). 원자적으로
export function setBrowserMode(mode: BrowserMode, env: NodeJS.ProcessEnv = process.env) {
  const dir = browserDirOf(env);
  mkdirSync(dir, { recursive: true });
  const cur = readRaw(dir);
  const base = cur && typeof cur === "object" ? (cur as Record<string, unknown>) : {};
  const file = join(dir, "config.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...base, mode }, null, 2) + "\n");
  renameSync(tmp, file);
}

export function readBrowserRuns(env: NodeJS.ProcessEnv = process.env): BrowserRun[] {
  const file = join(browserDirOf(env), "runs.jsonl");
  try {
    const size = statSync(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - from);
      readSync(fd, buf, 0, buf.length, from);
      const text = buf.toString("utf8");
      return parseBrowserRuns(from > 0 ? text.slice(text.indexOf("\n") + 1) : text);
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
}

export const browserGateData = (env: NodeJS.ProcessEnv = process.env, nowMs = Date.now()) => browserGateView(readBrowserRuns(env), loadBrowserConfig(env), nowMs);
