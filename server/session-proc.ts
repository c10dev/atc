import { readFileSync } from "node:fs";
import { originOf, permissionModeOf, type SessionOrigin } from "./session-origin.ts";

// 세션 출처 읽기(ATC-76): /proc/<pid>/cmdline과 부모의 cmdline을 읽기만 한다. 신호를 보내거나 붙지 않고, 계정 정보는 읽지 않는다.
// 판정은 session-origin.ts의 순수 함수. 설계: docs/fleet.md 8.5

// pid마다 한 번(pid와 시작 시각이 같으면 캐시)
export function procArgv(pid: number): string[] | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    const argv = raw.split("\0");
    if (argv.at(-1) === "") argv.pop();
    return argv.length ? argv : null;
  } catch {
    return null;
  }
}

function procStat(pid: number): { ppid: number | null; start: string | null } {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ppid = Number(f[1]);
    return { ppid: Number.isInteger(ppid) && ppid > 0 ? ppid : null, start: f[19] ?? null };
  } catch {
    return { ppid: null, start: null };
  }
}

export interface SessionProc {
  origin: SessionOrigin;
  permissionMode: string | null; // 명령줄에 있을 때만(백그라운드 세션은 LAUNCH 기록에서 채운다)
}

const cache = new Map<number, { start: string | null; value: SessionProc }>();

// 세션 하나의 출처와 permission mode. kind가 background면 프로세스를 읽지 않는다
export function sessionProcOf(pid: number | null | undefined, kind?: string | null, entrypoint?: string | null): SessionProc {
  if (kind === "background" || kind === "bg") return { origin: "background", permissionMode: null };
  if (!pid) return { origin: originOf({ kind, entrypoint, argv: null }), permissionMode: null };
  const { ppid, start } = procStat(pid);
  const hit = cache.get(pid);
  if (hit && hit.start === start) return hit.value;
  const argv = procArgv(pid);
  const parentArgv = ppid ? procArgv(ppid) : null;
  const value = { origin: originOf({ kind, entrypoint, argv, parentArgv }), permissionMode: permissionModeOf(argv) };
  if (argv) cache.set(pid, { start, value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

