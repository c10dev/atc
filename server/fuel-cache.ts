import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMeta, Compaction, FuelRecord, ModelCommand } from "./fuel.ts";

// FUEL 읽기 캐시(ATC-83, docs/fuel.md 4.1): 대화 기록 파일마다 읽은 자리(inode·바이트 위치·앞머리 지문)와 파싱한 결과를 ~/.cache/atc/fuel/에 둔다.
// 버려도 되는 캐시라서 상태 폴더(~/.local/state/atc/)에 두지 않는다. 지우면 한 번 처음부터 읽을 뿐이고, 못 읽거나 낡았거나 다른 형식이면 무시하고 다시 만든다.
// 담는 것은 FileState가 이미 가진 것뿐이다: FuelRecord 필드(숫자·모델·시각), compact_boundary·/model 요약, 세션 이름, 서브에이전트 종류. 대화 본문은 넣지 않는다.

// FuelRecord·Compaction·ModelCommand에 남기는 필드나 파서가 바뀌면 올린다(올리면 옛 캐시는 무시되고 한 번 처음부터 읽는다)
export const FUEL_CACHE_FORMAT = 1;
const HEAD_BYTES = 512;

export interface ShardState {
  ino: number;
  size: number; // 읽은 데까지(마지막 줄바꿈 뒤)
  records: Map<string, FuelRecord>;
  compactions: Compaction[];
  modelCommands: ModelCommand[];
  unknown: number;
  name: string | null;
  meta: AgentMeta | null;
}

interface Shard {
  format: number;
  path: string;
  ino: number;
  size: number;
  headLen: number;
  head: string; // 처음 headLen바이트의 sha1. 앞머리가 바뀐 파일(다시 쓴 파일)을 걸러 낸다
  records: FuelRecord[]; // 파일 안 중복을 없앤 순서 그대로
  compactions: Compaction[];
  modelCommands: ModelCommand[];
  unknown: number;
  name: string | null;
  meta: AgentMeta | null;
}

export const shardName = (path: string) => `${createHash("sha1").update(path).digest("hex")}.json`;

// 파일 앞머리 지문. 못 읽으면 null
export function headOf(path: string, len: number): string | null {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(len);
      const n = readSync(fd, buf, 0, len, 0);
      return n === len ? createHash("sha1").update(buf).digest("hex") : null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function saveShard(dir: string, path: string, s: ShardState): boolean {
  const headLen = Math.min(HEAD_BYTES, s.size);
  const head = headOf(path, headLen);
  if (head === null) return false;
  const shard: Shard = {
    format: FUEL_CACHE_FORMAT,
    path,
    ino: s.ino,
    size: s.size,
    headLen,
    head,
    records: [...s.records.values()],
    compactions: s.compactions,
    modelCommands: s.modelCommands,
    unknown: s.unknown,
    name: s.name,
    meta: s.meta,
  };
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, shardName(path));
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(shard));
    renameSync(tmp, file);
    return true;
  } catch {
    return false; // 캐시를 못 써도 읽기는 그대로다
  }
}

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

// 캐시가 지금 파일과 맞으면 그 상태, 아니면 null(못 읽음·다른 형식·다른 파일·줄어든 파일·앞머리가 다름·모양이 이상함)
export function loadShard(dir: string, path: string, st: { ino: number; size: number }): ShardState | null {
  let d: Shard;
  try {
    d = JSON.parse(readFileSync(join(dir, shardName(path)), "utf8")) as Shard;
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || d.format !== FUEL_CACHE_FORMAT || d.path !== path) return null;
  if (!isNum(d.ino) || !isNum(d.size) || !isNum(d.headLen) || typeof d.head !== "string") return null;
  if (d.ino !== st.ino || d.size > st.size || d.headLen > d.size) return null;
  if (!Array.isArray(d.records) || !Array.isArray(d.compactions) || !Array.isArray(d.modelCommands) || !isNum(d.unknown)) return null;
  if (d.records.some((r) => !r || typeof r.key !== "string" || typeof r.t !== "string" || typeof r.model !== "string")) return null;
  if (headOf(path, d.headLen) !== d.head) return null;
  return {
    ino: d.ino,
    size: d.size,
    records: new Map(d.records.map((r) => [r.key, r])),
    compactions: d.compactions,
    modelCommands: d.modelCommands,
    unknown: d.unknown,
    name: typeof d.name === "string" ? d.name : null,
    meta: d.meta && typeof d.meta === "object" ? { agentType: typeof d.meta.agentType === "string" ? d.meta.agentType : null, spawnDepth: isNum(d.meta.spawnDepth) ? d.meta.spawnDepth : null } : null,
  };
}

// 더는 없는 대화 기록의 캐시 파일과 옛 임시 파일을 지운다. keep은 지금 있는 기록 파일들의 shardName
export function pruneShards(dir: string, keep: ReadonlySet<string>): number {
  let removed = 0;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const n of names) {
    if (keep.has(n) || !(n.endsWith(".json") || n.endsWith(".tmp"))) continue;
    try {
      rmSync(join(dir, n));
      removed++;
    } catch {}
  }
  return removed;
}
