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

const SIZE_UNIT: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
// systemd 크기(`20G`)를 바이트로. 모양이 틀리면 null
export function sizeBytes(s: string): number | null {
  const m = /^([1-9]\d*)([KMGT]?)$/.exec(s);
  return m ? Number(m[1]) * SIZE_UNIT[m[2]!]! : null;
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


// 기록한 OOM 합계의 상태(ATC-505): unit별 마지막 합계(기록 전체, 기간 제한 없음)와 늘어난 수의 시각 목록.
// 7일 창에서만 합계를 세면 오래 사는 scope의 옛 kill을 창이 지난 뒤 다시 센다. 그래서 합계는 보관된 기록 전체로 한 번 채우고 이후에는 메모리에서 이어 간다
export interface OomState {
  totals: Map<string, number>;
  events: { at: number; delta: number }[];
}
export interface OomLine {
  t: string;
  unit: string;
  total: number;
  delta: number;
}
export function oomStateOf(history: readonly OomLine[]): OomState {
  const totals = new Map<string, number>();
  const events: OomState["events"] = [];
  for (const r of history) {
    totals.set(r.unit, Math.max(totals.get(r.unit) ?? 0, r.total));
    events.push({ at: Date.parse(r.t), delta: r.delta });
  }
  return { totals, events };
}
// 지금 scope들을 보고 새로 늘어난 줄을 돌려준다. 상태도 함께 앞으로 간다(순수가 아니라 state를 바꾼다: 같은 줄을 두 번 만들지 않게)
export function oomStep(state: OomState, now: readonly ScopeOom[], at: number): OomLine[] {
  const lines = oomDeltasOf(now, state.totals).map((d) => ({ t: new Date(at).toISOString(), ...d }));
  for (const l of lines) {
    state.totals.set(l.unit, l.total);
    state.events.push({ at, delta: l.delta });
  }
  return lines;
}
export const oomKills7d = (state: OomState, at: number): number => state.events.filter((e) => at - e.at <= 7 * 86_400_000).reduce((n, e) => n + e.delta, 0);
