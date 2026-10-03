import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 백그라운드 세션 scope의 메모리 상한과 OOM 세기(ATC-505). 순수 함수(속성 목록, memory.events 읽기, 늘어난 수)와 읽는 길(cgroup 폴더)을 나눈다.
// LAUNCH가 만드는 임시 scope(`atc-claude-<ms>.scope`)에 MemoryHigh·MemoryMax를 걸어, 메모리를 너무 쓰면 커널이 그 scope 안의 프로세스를 죽이고
// 밖(데스크톱 세션, 운영 atc 서비스 7700, 로컬 DB 컨테이너)은 건드리지 않게 한다. 운영 서비스 unit은 바꾸지 않는다.

export interface ScopeMemory {
  high: string; // systemd 크기(예: 20G): 넘으면 회수가 느려진다
  max: string; // 넘으면 OOM kill
}

// `-p Key=Value` 인자. 상한이 없으면 빈 목록(옛 동작: OOMPolicy=continue만)
export const memoryArgsOf = (m: ScopeMemory | null | undefined): string[] => (m ? ["-p", `MemoryHigh=${m.high}`, "-p", `MemoryMax=${m.max}`] : []);

// cgroup v2 memory.events의 `oom_kill N` 줄. 없으면 0
export function oomKillOf(eventsText: string): number {
  const m = /^oom_kill\s+(\d+)\s*$/m.exec(eventsText);
  return m ? Number(m[1]) : 0;
}

export interface ScopeOom {
  unit: string; // atc-claude-<ms>.scope
  kills: number;
}

// 지난 관찰(unit별 합계)과 지금을 견줘 늘어난 수. 처음 보는 unit은 기록에 있던 합계(known)부터 센다: 서버를 다시 띄워도 두 번 세지 않는다
export function oomDeltasOf(now: readonly ScopeOom[], known: ReadonlyMap<string, number>): { unit: string; total: number; delta: number }[] {
  const out: { unit: string; total: number; delta: number }[] = [];
  for (const s of now) {
    const before = known.get(s.unit) ?? 0;
    if (s.kills > before) out.push({ unit: s.unit, total: s.kills, delta: s.kills - before });
  }
  return out;
}

const UNIT = /^atc-claude-\d+\.scope$/;

// cgroup 트리에서 atc-claude-*.scope 폴더(사용자 서비스 아래). 깊이를 제한하고 읽지 못하면 건너뛴다
export function scopeDirsOf(root = "/sys/fs/cgroup/user.slice", depth = 5): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    let ents: import("node:fs").Dirent[];
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (UNIT.test(e.name)) out.push(join(dir, e.name));
      else if (d > 0) walk(join(dir, e.name), d - 1);
    }
  };
  walk(root, depth);
  return out;
}

// 지금 떠 있는 scope들의 oom_kill(읽기만)
export function readScopeOom(root?: string): ScopeOom[] {
  return scopeDirsOf(root).map((dir) => {
    let text = "";
    try {
      text = readFileSync(join(dir, "memory.events"), "utf8");
    } catch {}
    return { unit: dir.split("/").at(-1)!, kills: oomKillOf(text) };
  });
}

// SUPERVISOR가 보는 수: 지난 7일에 기록된 OOM kill 합과, 지금 떠 있는 scope 수(GET /api/control/sessions의 scopeOom)
export interface ScopeOomView {
  kills7d: number;
  scopes: number;
}
// CONTROL 블록의 한 줄(서버가 정한다, 원칙 4). 상한이 켜져 있고 kill이 없으면 null(정상엔 줄이 없다)
export function scopeOomTextOf(v: ScopeOomView, cap: "on" | "off"): string | null {
  const parts: string[] = [];
  if (cap === "off") parts.push("SCOPE MEMORY CAP 꺼짐 — 새 LAUNCH의 scope에 메모리 상한이 없다");
  if (v.kills7d > 0) parts.push(`지난 7일 scope 안 OOM kill ${v.kills7d}건${cap === "on" ? " — 상한이 너무 낮은지 확인(설정 창 SCOPE MEMORY CAP, dispatch.json bgMemoryHigh·bgMemoryMax)" : ""}`);
  return parts.length ? parts.join(" · ") : null;
}

