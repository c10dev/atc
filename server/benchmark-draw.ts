// 벤치마크 이슈 추첨(docs/research/atc-vs-solo.md 3절, ATC-463): 후보 목록에서 10~12개를 시드로 고정해 뽑는다.
// 플래그가 붙은 후보는 빼고, 크기 × 종류 층을 가능한 한 고르게 채우고, 파일이 겹치는 쌍을 2~3개 넣는다.
// 전부 순수 함수이고 입출력은 benchmark-draw-run.ts가 한다.
import { seededRandom } from "./blind-pack.ts";

export type Size = "S" | "M";
export type Kind = "screen" | "server" | "docs";
export type Arm = "atc" | "solo";
export const SIZES: Size[] = ["S", "M"];
export const KINDS: Kind[] = ["screen", "server", "docs"];

export type Flags = { blocked?: boolean; needsDecision?: boolean; userTier?: boolean; hardToReverse?: boolean };
export type Candidate = { key: string; size: Size; kind: Kind; files: string[]; flags?: Flags };

export type Drawn = { key: string; size: Size; kind: Kind; stratum: string; armOrder: [Arm, Arm] };
export type OverlapPair = { a: string; b: string; shared: string[] };
export type StratumReport = { pool: number; target: number; drawn: number };
export type DrawResult = {
  seed: number;
  count: number;
  eligible: number;
  excluded: { key: string; reasons: string[] }[];
  drawn: Drawn[];
  overlapPairs: OverlapPair[];
  strata: Record<string, StratumReport>;
  warnings: string[];
};
export type DrawOptions = { seed: number; count?: number; pairs?: number };

const FLAG_NAMES: (keyof Flags)[] = ["blocked", "needsDecision", "userTier", "hardToReverse"];

// 입력 검사: 잘못된 후보는 조용히 넘기지 않고 던진다
export function parseCandidates(raw: unknown): Candidate[] {
  if (!Array.isArray(raw)) throw new Error("후보 목록은 배열이어야 한다");
  const seen = new Set<string>();
  return raw.map((c, i) => {
    const o = c as Record<string, unknown>;
    if (!o || typeof o.key !== "string" || !o.key) throw new Error(`후보 ${i}: key가 없다`);
    if (seen.has(o.key)) throw new Error(`후보 key가 겹친다: ${o.key}`);
    seen.add(o.key);
    if (!SIZES.includes(o.size as Size)) throw new Error(`${o.key}: size는 S 또는 M`);
    if (!KINDS.includes(o.kind as Kind)) throw new Error(`${o.key}: kind는 screen, server, docs 중 하나`);
    const files = o.files ?? [];
    if (!Array.isArray(files) || files.some((f) => typeof f !== "string")) throw new Error(`${o.key}: files는 문자열 배열`);
    const flags = (o.flags ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(flags)) if (!FLAG_NAMES.includes(k as keyof Flags)) throw new Error(`${o.key}: 모르는 flag ${k}`);
    return { key: o.key, size: o.size as Size, kind: o.kind as Kind, files: files as string[], flags: flags as Flags };
  });
}

const norm = (p: string) => p.replace(/^\.\//, "");
// 겹침: 같은 경로이거나, 한쪽이 `/`로 끝나는 폴더이고 다른 쪽이 그 안에 있다
function overlaps(x: string, y: string): boolean {
  if (x === y) return true;
  return (x.endsWith("/") && y.startsWith(x)) || (y.endsWith("/") && x.startsWith(y));
}
export function sharedFiles(a: Candidate, b: Candidate): string[] {
  const out = new Set<string>();
  for (const f of a.files)
    for (const g of b.files) {
      const x = norm(f);
      const y = norm(g);
      if (overlaps(x, y)) out.add(x.length >= y.length ? x : y);
    }
  return [...out].sort();
}

export const stratumOf = (c: { size: Size; kind: Kind }) => `${c.size}-${c.kind}`;

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function draw(candidates: Candidate[], { seed, count = 12, pairs = 2 }: DrawOptions): DrawResult {
  if (!Number.isInteger(count) || count < 10 || count > 12) throw new Error("count는 10~12");
  if (!Number.isInteger(pairs) || pairs < 2 || pairs > 3) throw new Error("pairs는 2~3");
  const rnd = seededRandom(seed);
  const warnings: string[] = [];
  // 입력 순서에 결과가 기대지 않도록 key로 정렬
  const sorted = [...candidates].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const excluded: DrawResult["excluded"] = [];
  const pool: Candidate[] = [];
  for (const c of sorted) {
    const reasons = FLAG_NAMES.filter((f) => c.flags?.[f]);
    if (reasons.length) excluded.push({ key: c.key, reasons });
    else pool.push(c);
  }

  // 1) 겹치는 쌍: 서로 다른 이슈로 pairs개
  const pairCands: OverlapPair[] = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      const shared = sharedFiles(pool[i], pool[j]);
      if (shared.length) pairCands.push({ a: pool[i].key, b: pool[j].key, shared });
    }
  const used = new Set<string>();
  const overlapPairs: OverlapPair[] = [];
  for (const p of shuffle(pairCands, rnd)) {
    if (overlapPairs.length >= pairs) break;
    if (used.has(p.a) || used.has(p.b)) continue;
    used.add(p.a).add(p.b);
    overlapPairs.push(p);
  }
  if (overlapPairs.length < pairs) warnings.push(`겹치는 쌍이 ${overlapPairs.length}개뿐이다(요청 ${pairs}, 서로 다른 이슈로 겹치는 후보 쌍이 모자란다)`);
  if (overlapPairs.length < 2) warnings.push("겹치는 쌍이 2개 미만이라 프로토콜의 하한(2~3쌍)을 못 채웠다");

  // 2) 층 채우기: 가장 덜 찬 층에서 하나씩(동률은 시드로 섞은 층 순서)
  const strata = SIZES.flatMap((s) => KINDS.map((k) => `${s}-${k}`));
  const order = shuffle(strata, rnd);
  const byKey = new Map(pool.map((c) => [c.key, c]));
  const chosen = new Set<string>(used);
  const left = new Map<string, Candidate[]>(strata.map((s) => [s, shuffle(pool.filter((c) => stratumOf(c) === s && !chosen.has(c.key)), rnd)]));
  const got = new Map<string, number>(strata.map((s) => [s, 0]));
  for (const k of chosen) {
    const s = stratumOf(byKey.get(k)!);
    got.set(s, got.get(s)! + 1);
  }
  while (chosen.size < count) {
    const open = order.filter((s) => left.get(s)!.length > 0);
    if (!open.length) break;
    const s = open.reduce((best, x) => (got.get(x)! < got.get(best)! ? x : best));
    chosen.add(left.get(s)!.pop()!.key);
    got.set(s, got.get(s)! + 1);
  }
  if (chosen.size < count) warnings.push(`후보 풀이 작다: 걸러진 뒤 ${pool.length}개 중 ${chosen.size}개만 뽑았다(요청 ${count}). 채우지 않았다`);

  // 3) 층별 보고와 팔 순서(층 안에서 번갈아, 첫 팔은 층마다 시드로)
  const report: Record<string, StratumReport> = {};
  const drawn: Drawn[] = [];
  const base = Math.floor(count / strata.length);
  const extra = new Set(order.slice(0, count - base * strata.length));
  for (const s of strata) {
    const members = shuffle(
      [...chosen].map((k) => byKey.get(k)!).filter((c) => stratumOf(c) === s),
      rnd,
    );
    let first: Arm = rnd() < 0.5 ? "atc" : "solo";
    for (const c of members) {
      drawn.push({ key: c.key, size: c.size, kind: c.kind, stratum: s, armOrder: first === "atc" ? ["atc", "solo"] : ["solo", "atc"] });
      first = first === "atc" ? "solo" : "atc";
    }
    const target = base + (extra.has(s) ? 1 : 0);
    const poolN = pool.filter((c) => stratumOf(c) === s).length;
    report[s] = { pool: poolN, target, drawn: members.length };
    if (members.length < target) warnings.push(`층 ${s}: 목표 ${target}, 뽑힌 ${members.length}(풀 ${poolN})`);
  }
  drawn.sort((a, b) => (a.stratum < b.stratum ? -1 : a.stratum > b.stratum ? 1 : a.key < b.key ? -1 : 1));
  return { seed, count, eligible: pool.length, excluded, drawn, overlapPairs, strata: report, warnings };
}

// 사람이 읽는 요약(영어: PR·보고에 붙인다)
export function formatDraw(r: DrawResult): string {
  const lines = [`seed ${r.seed} · drew ${r.drawn.length}/${r.count} from ${r.eligible} eligible (${r.excluded.length} excluded)`];
  for (const d of r.drawn) lines.push(`${d.key}\t${d.stratum}\t${d.armOrder[0]}-first`);
  for (const p of r.overlapPairs) lines.push(`overlap ${p.a} + ${p.b}: ${p.shared.join(", ")}`);
  for (const w of r.warnings) lines.push(`WARNING ${w}`);
  return lines.join("\n") + "\n";
}
