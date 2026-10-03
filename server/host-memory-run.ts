import { readFileSync } from "node:fs";
import { type HostMemory, hostMemoryOf, NO_OOM, nextOomState, type OomState, parseMeminfo, parseOomKill } from "./host-memory.ts";

// 호스트 메모리의 읽기(ATC-203): /proc/meminfo와 /proc/vmstat만 읽는다(저널·sudo 없음). 파일에 아무것도 쓰지 않는다.
// 마지막 OOM 수와 시각은 이 모듈의 메모리에만 있다: 서버를 다시 켜면 첫 읽기가 기준이 되고, 켜기 전의 kill은 세지 않는다.
let oom: OomState = NO_OOM;

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null; // /proc이 없는 OS: 항목이 없다
  }
};

// 알림을 셀 때마다 부른다(5초 간격). 읽을 수 없으면 null
export function hostMemoryNow(now: number, files: { meminfo: string | null; vmstat: string | null } = { meminfo: readText("/proc/meminfo"), vmstat: readText("/proc/vmstat") }): HostMemory | null {
  oom = nextOomState(oom, files.vmstat === null ? null : parseOomKill(files.vmstat), now);
  return hostMemoryOf(files.meminfo === null ? null : parseMeminfo(files.meminfo), oom, now);
}

// 시험이 기억을 비운다
export const resetHostMemory = () => {
  oom = NO_OOM;
};
