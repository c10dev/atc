import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { type GateMode, type GateRun, gateDirOf, gateView, parseGateConfig, parseRuns } from "./verify-gate.ts";
import { readRemoteTarget } from "./verify-remote-run.ts";

// VERIFY GATE의 파일 입출력(ATC-517). 폴더는 gateDirOf(): 운영 상태 폴더와 따로다. 읽기는 늘 실패해도 기본값으로 돈다

const TAIL_BYTES = 2_000_000; // 기록이 커도 끝부분만 읽는다

const readRaw = (dir: string): unknown => {
  try {
    return JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  } catch {
    return {};
  }
};

export const loadGateConfig = (env: NodeJS.ProcessEnv = process.env) => parseGateConfig(readRaw(gateDirOf(env)), env);
export const loadGateMode = (env: NodeJS.ProcessEnv = process.env): GateMode => loadGateConfig(env).mode;

// mode만 바꿔 쓴다(다른 칸은 그대로). 원자적으로
export function setGateMode(mode: GateMode, env: NodeJS.ProcessEnv = process.env) {
  const dir = gateDirOf(env);
  mkdirSync(dir, { recursive: true });
  const cur = readRaw(dir);
  const base = cur && typeof cur === "object" ? (cur as Record<string, unknown>) : {};
  const file = join(dir, "config.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...base, mode }, null, 2) + "\n");
  renameSync(tmp, file);
}

// 원격 실행 스위치(ATC-518): config.json의 remote만 바꿔 쓴다
export const loadRemoteMode = (env: NodeJS.ProcessEnv = process.env): GateMode => loadGateConfig(env).remote;
export function setRemoteMode(mode: GateMode, env: NodeJS.ProcessEnv = process.env) {
  const dir = gateDirOf(env);
  mkdirSync(dir, { recursive: true });
  const cur = readRaw(dir);
  const base = cur && typeof cur === "object" ? (cur as Record<string, unknown>) : {};
  const file = join(dir, "config.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...base, remote: mode }, null, 2) + "\n");
  renameSync(tmp, file);
}

export function readGateRuns(env: NodeJS.ProcessEnv = process.env): GateRun[] {
  const file = join(gateDirOf(env), "runs.jsonl");
  try {
    const size = statSync(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - from);
      readSync(fd, buf, 0, buf.length, from);
      const text = buf.toString("utf8");
      return parseRuns(from > 0 ? text.slice(text.indexOf("\n") + 1) : text);
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
}

export const verifyGateData = (env: NodeJS.ProcessEnv = process.env, nowMs = Date.now()) =>
  gateView(readGateRuns(env), loadGateConfig(env), nowMs, readRemoteTarget(gateDirOf(env)) !== null);
