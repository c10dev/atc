// 호스트 메모리 압박과 OOM kill(ATC-203, docs/alerting.md "A1b as built"): 2026-09-30 08:54Z 사고에서 `node --test` 하나가 17.7 GB까지 커져 OOM killer에 죽었고
// 그 뒤 claude 데몬과 백그라운드 세션 12개가 모두 죽었는데, atc는 STAND별 orphan만 알렸다. 순수 함수만: /proc/meminfo·/proc/vmstat의 글을 읽는 것과 판정.
// 입출력(파일 읽기, 마지막 값 들고 있기)은 host-memory-run.ts. 새 상태 파일은 없다: 마지막 OOM 수와 시각은 메모리에만 둔다(서버를 다시 켜면 다시 기준을 잡는다).

export const MEM_AVAILABLE_MIN = 0.1; // MemAvailable이 MemTotal의 10% 아래
export const SWAP_USED_MAX = 0.8; // swap 80% 넘게 씀
export const OOM_WINDOW_MS = 30 * 60_000; // oom_kill이 이 안에 올랐으면 WARNING

export interface MemInfo {
  totalKb: number;
  availableKb: number;
  swapTotalKb: number;
  swapFreeKb: number;
}

const kb = (text: string, key: string): number | null => {
  const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m").exec(text);
  return m ? Number(m[1]) : null;
};

// /proc/meminfo의 글 → 값. MemTotal·MemAvailable이 없으면(옛 커널·다른 OS) null
export function parseMeminfo(text: string): MemInfo | null {
  const totalKb = kb(text, "MemTotal");
  const availableKb = kb(text, "MemAvailable");
  if (totalKb === null || availableKb === null || totalKb <= 0) return null;
  return { totalKb, availableKb, swapTotalKb: kb(text, "SwapTotal") ?? 0, swapFreeKb: kb(text, "SwapFree") ?? 0 };
}

// /proc/vmstat의 `oom_kill` 누적 수. 줄이 없으면 null(옛 커널)
export function parseOomKill(text: string): number | null {
  const m = /^oom_kill\s+(\d+)\s*$/m.exec(text);
  return m ? Number(m[1]) : null;
}

// OOM 수의 기억: 마지막으로 본 누적 수와, 최근 30분 안에 오른 만큼(시각별). 값이 줄면(재부팅) 다시 기준을 잡는다
export interface OomState {
  last: number | null;
  rises: { t: number; n: number }[];
}
export const NO_OOM: OomState = { last: null, rises: [] };

// 순수: 새로 읽은 누적 수 → 다음 기억. 처음 본 값은 기준일 뿐(서버를 켜기 전의 kill은 세지 않는다)
export function nextOomState(prev: OomState, count: number | null, now: number): OomState {
  const keep = prev.rises.filter((r) => now - r.t < OOM_WINDOW_MS);
  if (count === null) return { last: prev.last, rises: keep };
  if (prev.last === null || count < prev.last) return { last: count, rises: keep };
  return { last: count, rises: count > prev.last ? [...keep, { t: now, n: count - prev.last }] : keep };
}

export const oomInWindow = (s: OomState, now: number): number => s.rises.filter((r) => now - r.t < OOM_WINDOW_MS).reduce((a, r) => a + r.n, 0);

export interface HostMemory {
  level: "warning" | "caution";
  availableKb: number;
  swapPct: number | null; // 쓴 swap %(swap이 없으면 null)
  oom: number; // 30분 안의 OOM kill 수
  text: string;
}

const gb = (kbv: number) => `${(kbv / 1024 / 1024).toFixed(1)} GB`;

// 순수: 메모리 값과 OOM 기억 → 항목 하나나 null.
// CAUTION: MemAvailable < 10%이고 swap 사용 > 80%. swap이 아예 없는 호스트는 swap 조건을 따지지 않고 가용 메모리만 본다(PILOT'S DISCRETION).
// WARNING: 30분 안에 oom_kill이 올랐다. 둘 다면 WARNING이고 글에 모두 싣는다
export function hostMemoryOf(mem: MemInfo | null, oom: OomState, now: number): HostMemory | null {
  if (!mem) return null;
  const swapPct = mem.swapTotalKb > 0 ? Math.round(((mem.swapTotalKb - mem.swapFreeKb) / mem.swapTotalKb) * 100) : null;
  const low = mem.availableKb < mem.totalKb * MEM_AVAILABLE_MIN && (swapPct === null || swapPct > SWAP_USED_MAX * 100);
  const kills = oomInWindow(oom, now);
  if (!low && kills === 0) return null;
  const parts = [`가용 ${gb(mem.availableKb)}`, ...(swapPct === null ? [] : [`swap ${swapPct}%`]), `OOM kill ${kills}회(30분)`];
  return { level: kills > 0 ? "warning" : "caution", availableKb: mem.availableKb, swapPct, oom: kills, text: `메모리 부족: ${parts.join(" · ")}` };
}
