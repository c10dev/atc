import { WAKE_SLOTS, type Wake } from "./crew.ts";

// 파일 겹침(ATC-71): 곧 배정할 FLIGHT가 고칠 파일을 예측하고, 이미 날고 있는 FLIGHT가 고치는 파일과 맞춰 본다.
// 순수 함수만 둔다. git·gh 읽기는 overlap-run.ts. 설계는 docs/dispatch.md "File overlap".

// dispatch.json overlap 설정. hold는 SUPERVISOR 스위치(기본 꺼짐: 꺼져 있으면 무엇을 HOLD할지 보여 주기만 한다)
export interface OverlapConfig {
  hold: boolean;
  holdFiles: number; // 이만큼 이상 겹치면 무겁다
}
export const DEFAULT_OVERLAP: OverlapConfig = { hold: false, holdFiles: 2 };
export function overlapConfigOf(raw: unknown): OverlapConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = r.holdFiles;
  return {
    hold: r.hold === true, // true일 때만 켠다
    holdFiles: typeof n === "number" && Number.isInteger(n) && n > 0 ? n : DEFAULT_OVERLAP.holdFiles,
  };
}

// 날고 있는 FLIGHT가 고치는 파일: STAND(워크트리) diff와 열린 PR의 파일 목록
export interface Holder {
  flight: string;
  team: string | null; // 그 FLIGHT를 날고 있는 REGISTRATION. 모르면 null
  airport: string | null;
  wake: Wake;
  // 경로 → 어디서 읽었나("STAND", "PR #12")
  files: Map<string, string>;
}

// 예측한 경로(또는 glob)와 그 출처
export interface Predicted {
  pattern: string;
  from: string; // "본문", "ATC-70 본문"
}

const FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const TICK = /`([^`\n]+)`/g;
// 경로처럼 보이는 것: 공백 없는 토큰, 슬래시나 `*`가 있거나 알려진 확장자로 끝난다
const EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|jsonl|md|css|html|yml|yaml|sh|sql|toml|txt)$/i;
const PATHISH = /^[\w.@()[\]-][\w./@()[\]*{},-]*$/;

function pathOf(token: string): string | null {
  let t = token.trim().replace(/^\.\//, "").replace(/[:,;.]+$/, "");
  t = t.replace(/[:#]L?\d+(?:-L?\d+)?$/, ""); // path:123 · path#L10
  if (!t || t.length > 200 || /\s/.test(t) || /^[a-z]+:\/\//i.test(t) || t.startsWith("/") || t.startsWith("~") || t.includes("..")) return null;
  if (!PATHISH.test(t)) return null;
  if (t.includes("*") || EXT.test(t)) return t;
  // 확장자·glob이 없으면 디렉터리 경로(`server/sources`, `web/src/`)만. `1/2`·`and/or` 같은 낱말은 거른다
  if (!/^[\w.@()[\]-]+(?:\/[\w.@()[\]-]+)+\/?$/.test(t) || /^\d+(?:\/\d+)+\/?$/.test(t) || /^(?:and|or|yes|no)\//i.test(t)) return null;
  return t;
}

// 본문에서 저장소 경로를 읽는다: 백틱으로 감싼 경로와 glob(`server/fuel-*.ts`). 펜스 코드 블록은 예시·명령이 많아 건너뛴다(PILOT'S DISCRETION).
// `{a,b}` 묶음은 펼친다.
export function pathsOfBody(body: string | null | undefined): string[] {
  if (!body) return [];
  const out = new Set<string>();
  for (const m of body.replace(FENCE, " ").matchAll(TICK)) {
    const p = pathOf(m[1]);
    if (!p) continue;
    for (const x of expandBraces(p)) out.add(x);
  }
  return [...out];
}

function expandBraces(p: string): string[] {
  const m = /\{([^{}]+)\}/.exec(p);
  if (!m) return [p];
  return m[1].split(",").flatMap((alt) => expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
}

// FLIGHT 본문과 연결된 FLIGHT 본문에서 예측한 경로. 모델은 쓰지 않는다. 모든 경로에 출처가 붙는다.
export function predictedOf(
  flight: string,
  linked: readonly string[],
  bodies: ReadonlyMap<string, string | null>,
): Predicted[] {
  const out = new Map<string, Predicted>();
  const add = (key: string, from: string) => {
    for (const p of pathsOfBody(bodies.get(key))) if (!out.has(p)) out.set(p, { pattern: p, from });
  };
  add(flight, "본문");
  for (const k of linked) if (k !== flight) add(k, `${k} 본문`);
  return [...out.values()];
}

function globRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else re += c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

// 예측 경로가 실제 경로를 가리키나: 같은 경로, glob, 디렉터리(끝의 `/`나 그 아래 경로)
export function matches(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith("/")) return path.startsWith(pattern);
  if (pattern.includes("*")) return globRegex(pattern).test(path);
  // 확장자 없는 슬래시 경로는 디렉터리로도 본다(`server/sources`)
  return !EXT.test(pattern) && path.startsWith(`${pattern}/`);
}

export interface Hit {
  path: string;
  pattern: string;
  from: string; // 예측의 출처
  where: string; // 날고 있는 쪽의 출처(STAND·PR)
}
export interface HolderOverlap {
  holder: Holder;
  hits: Hit[];
  weight: number; // WAKE 곱: 양쪽 무게. 큰 FLIGHT(M·H)가 낄수록 크다
}

// 예측한 파일과 날고 있는 FLIGHT가 고치는 파일의 교집합(FLIGHT 자신은 뺀다)
export function overlapsOf(flight: string, wake: Wake, airport: string, predicted: readonly Predicted[], holders: readonly Holder[]): HolderOverlap[] {
  if (!predicted.length) return [];
  const out: HolderOverlap[] = [];
  for (const h of holders) {
    if (h.flight === flight || (h.airport && h.airport !== airport)) continue;
    const hits: Hit[] = [];
    for (const [path, where] of h.files) {
      const p = predicted.find((x) => matches(x.pattern, path));
      if (p) hits.push({ path, pattern: p.pattern, from: p.from, where });
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a.path.localeCompare(b.path));
    out.push({ holder: h, hits, weight: WAKE_SLOTS[wake] * (WAKE_SLOTS[h.wake] === Infinity ? 1 : WAKE_SLOTS[h.wake]) });
  }
  return out.sort((a, b) => a.holder.flight.localeCompare(b.holder.flight));
}

const HIT_CAP = 3; // 파일이 많이 겹쳐도 한 FLIGHT가 점수를 이만큼 이상 깎지는 않는다
export const overlapValueOf = (list: readonly HolderOverlap[]) => list.reduce((a, o) => a + Math.min(o.hits.length, HIT_CAP) * o.weight, 0);

const shown = (hits: readonly Hit[]) => hits.slice(0, 3).map((h) => h.path).join(", ") + (hits.length > 3 ? ` 외 ${hits.length - 3}건` : "");
export const holderLabel = (o: HolderOverlap) => `${o.holder.flight}${o.holder.team ? `(${o.holder.team})` : ""}`;
export function overlapDetail(list: readonly HolderOverlap[], holdNote = ""): string {
  if (!list.length) return "없음";
  return list.map((o) => `${holderLabel(o)}가 고치는 ${shown(o.hits)} (${o.hits[0].from} → ${o.hits[0].where})`).join(" · ") + holdNote;
}

// 같은 팀 이어가기: 겹치는 파일을 만지는 쪽이 모두 이 팀뿐이면 이 팀이 잇는 것이 충돌이 없다
export function splitByTeam(list: readonly HolderOverlap[], team: string): { others: HolderOverlap[]; mine: HolderOverlap[] } {
  return { others: list.filter((o) => o.holder.team !== team), mine: list.filter((o) => o.holder.team === team) };
}

// HOLD 대상: 많이 겹치고(holdFiles 이상) 양쪽 무게가 가벼운 것끼리(L·L)만은 아닌 FLIGHT
export const isHeavy = (o: HolderOverlap, cfg: OverlapConfig) => o.hits.length >= cfg.holdFiles && o.weight >= 1;
export const overlapHoldWhy = (flights: readonly string[]) => `파일 겹침 — ${flights.join(", ")}가 머지될 때까지`;
