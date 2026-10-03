import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 경계 시험(ATC-335): 값 import 순환이 새로 생기거나, 화면(web/src)이 값 import로 Node 내장 모듈이나 @hono/*에 닿으면 실패한다.
// 파일을 읽어 import 구문만 해석하는 순수 시험이다(네트워크·상태 폴더 없음). 허용 목록은 줄이기만 한다: 순환을 풀면 항목을 지운다.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 오늘의 값 import 순환(SCC). 멤버를 정렬해 " <-> "로 잇는다. 새 항목을 더하지 않는다.
export const ALLOWED_CYCLES: string[] = [
];
// 오늘의 화면→Node 값 import 사슬. "web 파일 -> … -> node:xxx" 형식. 새 항목을 더하지 않는다.
export const ALLOWED_WEB_NODE_CHAINS: string[] = [
];

type Edge = { to: string; spec: string };

// 추적 중인 소스(.ts/.tsx/.mjs)만 본다: 작업 폴더의 추적 안 된 임시 파일이 결과를 바꾸지 않는다. 시험 파일과 .d.ts는 뺀다.
function trackedSources(): string[] {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" });
  return out
    .split("\0")
    .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.(ts|tsx|mjs)$/.test(f) && !f.endsWith(".d.ts"))
    .map((f) => join(root, f));
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");
}

// 값 import의 지정자(`import type`과 `export type`은 빼고, `{ type A }`만 있는 구문도 뺀다). 동적 import("./x.ts")는 값 간선으로 센다(순환을 우회한 자리가 보이게).
export function valueSpecifiers(src: string): string[] {
  const out: string[] = [];
  const text = stripComments(src);
  const re = /(?:^|[;\n}])\s*(import|export)\s+([^;'"`]*?)\s*(?:from\s*)?(['"])([^'"\n]+)\3/g;
  for (const m of text.matchAll(re)) {
    const kind = m[1];
    let clause = m[2].trim();
    const hasFrom = /from\s*$/.test(m[0].slice(0, m[0].length - m[4].length - 2)) || clause === "";
    if (kind === "export" && !/^(\*|\{)/.test(clause)) continue; // export const x = "…" 같은 것
    if (kind === "import" && clause !== "" && !hasFrom && !/^(\*|\{|[\w$])/.test(clause)) continue;
    if (/^type\b(?!\s*,)/.test(clause) && /^type\s+[\w${*]/.test(clause)) continue;
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named) {
      const names = named[1].split(",").map((s) => s.trim()).filter(Boolean);
      const defaultPart = clause.slice(0, clause.indexOf("{")).replace(/,\s*$/, "").trim();
      if (!defaultPart && names.length > 0 && names.every((n) => /^type\s/.test(n))) continue;
    }
    out.push(m[4]);
  }
  for (const m of text.matchAll(/\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g)) out.push(m[2]);
  return out;
}

function resolveRel(from: string, spec: string, files: Set<string>): string | null {
  const base = resolve(dirname(from), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (files.has(cand)) return cand;
  }
  return null;
}

export type Graph = { edges: Map<string, Edge[]>; builtins: Map<string, string[]> };

export function buildGraph(files: Map<string, string>): Graph {
  const set = new Set(files.keys());
  const edges = new Map<string, Edge[]>();
  const builtins = new Map<string, string[]>();
  for (const [file, src] of files) {
    const es: Edge[] = [];
    const bs: string[] = [];
    for (const spec of valueSpecifiers(src)) {
      if (spec.startsWith("node:") || spec.startsWith("@hono/")) bs.push(spec);
      else if (spec.startsWith(".")) {
        const to = resolveRel(file, spec, set);
        if (to) es.push({ to, spec });
      }
    }
    edges.set(file, es);
    builtins.set(file, bs);
  }
  return { edges, builtins };
}

// Tarjan SCC: 크기 2 이상이거나 제 자신을 가져오는 묶음이 순환이다.
export function findCycles(g: Graph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let i = 0;
  const visit = (v: string) => {
    index.set(v, i);
    low.set(v, i);
    i++;
    stack.push(v);
    onStack.add(v);
    for (const { to } of g.edges.get(v) ?? []) {
      if (!index.has(to)) {
        visit(to);
        low.set(v, Math.min(low.get(v)!, low.get(to)!));
      } else if (onStack.has(to)) low.set(v, Math.min(low.get(v)!, index.get(to)!));
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1 || (g.edges.get(v) ?? []).some((e) => e.to === v)) out.push(scc.sort());
    }
  };
  for (const v of g.edges.keys()) if (!index.has(v)) visit(v);
  return out;
}

// web 파일마다 값 import를 따라가 Node 내장 모듈에 닿는 가장 짧은 사슬 하나.
export function webNodeChains(g: Graph, isWeb: (f: string) => boolean): string[][] {
  const chains: string[][] = [];
  for (const start of [...g.edges.keys()].filter(isWeb).sort()) {
    const prev = new Map<string, string | null>([[start, null]]);
    const queue = [start];
    let hit: string[] | null = null;
    for (let q = 0; q < queue.length && !hit; q++) {
      const v = queue[q];
      const b = g.builtins.get(v) ?? [];
      if (b.length) {
        const path: string[] = [b[0]];
        for (let c: string | null = v; c; c = prev.get(c) ?? null) path.unshift(c);
        hit = path;
        break;
      }
      for (const { to } of g.edges.get(v) ?? []) {
        if (!prev.has(to)) {
          prev.set(to, v);
          queue.push(to);
        }
      }
    }
    if (hit) {
      // 화면 쪽 경유 파일은 접는다: 화면에서 server로 넘어가는 마지막 web 파일부터 적는다(같은 뿌리가 한 항목이 되게).
      let k = 0;
      for (let j = 0; j < hit.length; j++) if (isWeb(hit[j])) k = j;
      const tail = hit.slice(k);
      if (!chains.some((c) => c.join() === tail.join())) chains.push(tail);
    }
  }
  return chains;
}

const name = (f: string) => (f.startsWith("node:") || f.startsWith("@hono/") ? f : relative(root, f));
const cycleKey = (c: string[]) => c.map(name).join(" <-> ");
const chainKey = (c: string[]) => c.map(name).join(" -> ");

function loadRepo(): Graph {
  const files = new Map<string, string>();
  for (const f of trackedSources()) files.set(f, readFileSync(f, "utf8"));
  return buildGraph(files);
}

const webDir = join(root, "web", "src") + "/";
// 화면 묶음에 들어가는 파일: web/src의 .ts/.tsx. web/src의 .mjs는 빌드 전에 Node로 돌리는 생성 스크립트(globe-geo.gen.mjs)라 뺀다.
const isBundled = (f: string) => f.startsWith(webDir) && /\.tsx?$/.test(f);

test("값 import 순환은 허용 목록에 있는 것뿐이다", () => {
  const found = findCycles(loadRepo()).map(cycleKey);
  const fresh = found.filter((k) => !ALLOWED_CYCLES.includes(k));
  assert.deepEqual(fresh, [], `새 값 import 순환:\n  ${fresh.join("\n  ")}\n순환을 풀거나(type import로 바꾸거나 공통 모듈로 뺀다), 정말 필요하면 이유와 함께 사용자에게 묻는다. 허용 목록에 더하지 않는다.`);
  const gone = ALLOWED_CYCLES.filter((k) => !found.includes(k));
  assert.deepEqual(gone, [], `풀린 순환이 허용 목록에 남아 있다. 지운다(목록은 줄기만 한다):\n  ${gone.join("\n  ")}`);
});

test("화면(web/src)은 값 import로 Node 내장 모듈·@hono/*에 닿지 않는다(허용 목록 밖)", () => {
  const found = webNodeChains(loadRepo(), isBundled).map(chainKey);
  const fresh = found.filter((k) => !ALLOWED_WEB_NODE_CHAINS.includes(k));
  assert.deepEqual(fresh, [], `화면이 Node 입출력에 닿는 새 값 import 사슬:\n  ${fresh.join("\n  ")}\n순수 부분을 별도 모듈로 나누거나 \`import type\`을 쓴다. 허용 목록에 더하지 않는다.`);
  const gone = ALLOWED_WEB_NODE_CHAINS.filter((k) => !found.includes(k));
  assert.deepEqual(gone, [], `끊긴 사슬이 허용 목록에 남아 있다. 지운다:\n  ${gone.join("\n  ")}`);
});

// ── 층 지도(ATC-436, docs/design-system.md 원칙 1 "아래로만 쓴다") ─────────────────
// L1 부품은 web/src/kit/**. L3 화면은 web/src/views/** 와 web/src 맨 위의 화면급 파일(서랍, 설정, 머리글 조각)이고, 아래 목록에 이름으로 적는다.
// 그 밖의 맨 위 파일(api, aviation, badges, derive …)은 화면이 아니다. 검사 둘:
//   1. kit의 파일은 화면 파일을 값으로 가져오지 않고, kit 밖의 스타일시트도 가져오지 않는다.
//   2. 화면은 다른 화면에 속한 스타일시트를 가져오지 않는다(남의 클래스를 빌려 쓰지 않는다).
// 오늘의 위반은 허용 목록에 단위(그것을 없앨 화면 FLIGHT)와 함께 적고, 목록은 줄기만 한다.
const kitDir = join(webDir, "kit") + "/";
const viewsDir = join(webDir, "views") + "/";
export const TOP_SCREEN_FILES = [
  // 서랍(S7)
  "Drawer", "DutyDrawer", "DutyChat", "IdeasDrawer", "DutyCards", "FlightBrakes", "FlightDispatch", "FlightRadio", "FlightLink", "FollowNext", "Relay", "EffectVerdict", "SinceLook",
  // 설정 창(S6)
  "SettingsPanel", "SettingsAlerts", "SettingsAccounts", "SettingsAutomation", "SettingsServer", "SupervisorPairing",
  // 머리글·알림·갱신(S8)
  "App", "AlertLive", "AlertBell", "Notices", "HelpMenu", "Ticker", "UpdateBar", "NewVersion", "ControlPanel", "ApplyNow",
  // GLOBE 보기 모드
  "GlobeMode",
];
// 한 화면으로 치는 묶음: [화면 이름, 파일들]. web/src 기준 경로이고, 끝이 "/"면 폴더, 아니면 확장자 뺀 파일 이름이다.
// 묶음에 없는 화면 파일은 제 이름이 곧 화면이다.
const SCREEN_GROUPS: [string, string[]][] = [
  ["HOME", ["views/Home", "views/Atfm", "views/HumanCheck", "SinceLook"]],
  ["FLEET", ["views/fleet/", "views/FleetCrew", "views/FleetPlan", "views/Checkride"]],
  ["METRICS", ["views/Metrics", "views/MetricsFuel", "views/MetricsFuelTrend", "views/MetricsLeaks", "views/MetricsMisfire", "views/Network"]],
  ["GLOBE", ["views/Globe", "views/GlobeAirport", "views/GlobeFlights", "views/GlobeRadio", "views/GlobeSpace", "GlobeMode"]],
  ["DRAWERS", ["Drawer", "DutyDrawer", "DutyChat", "views/DutyScreen", "IdeasDrawer", "DutyCards", "FlightBrakes", "FlightDispatch", "FlightRadio", "FlightLink", "FollowNext", "Relay", "EffectVerdict"]],
  ["SETTINGS", ["SettingsPanel", "SettingsAlerts", "SettingsAccounts", "SettingsAutomation", "SettingsServer", "SupervisorPairing", "views/Airports"]],
  ["HEADER", ["App", "AlertLive", "AlertBell", "Notices", "HelpMenu", "Ticker", "UpdateBar", "NewVersion", "ControlPanel", "ApplyNow"]],
];
// 같은 이름의 소스 파일이 없는 스타일시트의 주인 화면
const STYLESHEET_OWNER: Record<string, string> = { "alerts.css": "HEADER" };

// 오늘의 위반 "가져오는 파일 -> 스타일시트": 그것을 없앨 화면 단위. 새 항목을 더하지 않는다.
export const ALLOWED_LAYER_VIOLATIONS: Record<string, string> = {
};

const rel = (f: string) => relative(root, f);
const relWeb = (f: string) => relative(webDir, f);
const stem = (f: string) => relWeb(f).replace(/\.[^./]+$/, "");

export function isScreenFile(file: string): boolean {
  if (file.startsWith(viewsDir)) return true;
  if (!file.startsWith(webDir) || file.startsWith(kitDir)) return false;
  const r = stem(file);
  return !r.includes("/") && TOP_SCREEN_FILES.includes(r);
}

// 화면 이름: 묶음이 있으면 그 이름, 없으면 확장자 뺀 파일 이름. 화면이 아니면 null
export function screenOf(file: string): string | null {
  if (!file.startsWith(webDir)) return null;
  const r = stem(file);
  for (const [name, members] of SCREEN_GROUPS) if (members.some((m) => (m.endsWith("/") ? r.startsWith(m) : r === m))) return name;
  return isScreenFile(file) ? r : null;
}

// 스타일시트의 주인 화면: 같은 폴더의 같은 이름 소스 파일의 화면, 없으면 STYLESHEET_OWNER, 그래도 없으면 null(공용)
export function stylesheetOwner(css: string, sources: ReadonlySet<string>): string | null {
  const base = css.replace(/\.css$/, "");
  for (const ext of [".tsx", ".ts"]) if (sources.has(base + ext)) return screenOf(base + ext);
  return STYLESHEET_OWNER[css.slice(css.lastIndexOf("/") + 1)] ?? null;
}

// `import "./x.css"` 지정자(side-effect import). 값 간선에는 들어가지 않아 따로 읽는다
export function cssSpecifiers(src: string): string[] {
  return [...stripComments(src).matchAll(/(?:^|[;\n}])\s*import\s+(['"])([^'"\n]+\.css)\1/g)].map((m) => m[2]);
}

export function layerViolations(files: Map<string, string>): string[] {
  const sources = new Set(files.keys());
  const g = buildGraph(files);
  const out: string[] = [];
  for (const [file, src] of files) {
    const inKit = file.startsWith(kitDir);
    const screen = screenOf(file);
    if (inKit) {
      for (const { to } of g.edges.get(file) ?? []) if (isScreenFile(to)) out.push(`${rel(file)} -> ${rel(to)} (kit이 화면 파일을 가져온다)`);
    }
    if (!inKit && screen === null) continue;
    for (const spec of cssSpecifiers(src)) {
      const css = resolve(dirname(file), spec);
      if (inKit) {
        if (!css.startsWith(kitDir)) out.push(`${rel(file)} -> ${rel(css)} (kit이 kit 밖 스타일시트를 가져온다)`);
        continue;
      }
      const owner = stylesheetOwner(css, sources);
      if (owner !== null && owner !== screen) out.push(`${rel(file)} -> ${rel(css)}`);
    }
  }
  return out.sort();
}

test("층 지도: kit은 화면에 기대지 않고, 화면은 남의 스타일시트를 가져오지 않는다(허용 목록 밖)", () => {
  const files = new Map<string, string>();
  for (const f of trackedSources()) if (f.startsWith(webDir)) files.set(f, readFileSync(f, "utf8"));
  const found = layerViolations(files);
  const allowed = Object.keys(ALLOWED_LAYER_VIOLATIONS);
  const fresh = found.filter((k) => !allowed.includes(k));
  assert.deepEqual(fresh, [], `층 규칙을 어긴 새 import:\n  ${fresh.join("\n  ")}\n화면은 자기 스타일시트와 kit, 공용 토큰만 쓴다. 필요한 클래스는 kit 부품으로 올리거나 그 화면 안으로 옮긴다. 허용 목록에 더하지 않는다.`);
  const gone = allowed.filter((k) => !found.includes(k));
  assert.deepEqual(gone, [], `없어진 위반이 허용 목록에 남아 있다. 지운다(목록은 줄기만 한다):\n  ${gone.join("\n  ")}`);
  const unitless = allowed.filter((k) => !ALLOWED_LAYER_VIOLATIONS[k].trim());
  assert.deepEqual(unitless, [], "허용 항목마다 그것을 없앨 화면 단위를 적는다");
});

// 해석기 자체의 시험(합성 소스)
const g = (o: Record<string, string>) => buildGraph(new Map(Object.entries(o).map(([k, v]) => [`/r/${k}`, v])));

test("해석기: type import는 간선이 아니고 동적 import는 간선이다", () => {
  const typeOnly = g({
    "a.ts": `import type { X } from "./b.ts";\nimport { type Y } from "./b.ts";`,
    "b.ts": `import { a } from "./a.ts";`,
  });
  assert.deepEqual(findCycles(typeOnly), []);
  const dynamic = g({
    "a.ts": `const m = () => import("./b.ts");`,
    "b.ts": `import { a } from "./a.ts";`,
  });
  assert.equal(findCycles(dynamic).length, 1);
});

test("해석기: 값 import 순환과 재수출 순환을 찾는다", () => {
  const graph = g({
    "a.ts": `import { b } from "./b.ts";\nexport const a = 1;`,
    "b.ts": `export { c } from "./c.ts";`,
    "c.ts": `import * as a from "./a.ts";\nimport type { Z } from "./z.ts";`,
    "z.ts": ``,
  });
  const cycles = findCycles(graph).map((c) => c.map((f) => f.slice(3)));
  assert.deepEqual(cycles, [["a.ts", "b.ts", "c.ts"]]);
});

test("해석기: web이 값 import로 node:fs에 닿는 사슬을 읽기 쉽게 보인다", () => {
  const graph = g({
    "web/src/v.tsx": `import { f } from "../../server/x.ts";`,
    "server/x.ts": `import { readFileSync } from "node:fs";`,
    "web/src/ok.tsx": `import type { f } from "../../server/x.ts";`,
  });
  const chains = webNodeChains(graph, (f) => f.startsWith("/r/web/")).map((c) => c.map((f) => (f.startsWith("node:") ? f : f.slice(3))).join(" -> "));
  assert.deepEqual(chains, ["web/src/v.tsx -> server/x.ts -> node:fs"]);
});

test("해석기: web이 값 import로 @hono/*에 닿는 것도 잡는다", () => {
  const graph = g({
    "web/src/v.tsx": `import { f } from "../../server/x.ts";`,
    "server/x.ts": `import { Hono } from "@hono/node-server";`,
  });
  assert.equal(webNodeChains(graph, (f) => f.startsWith("/r/web/")).length, 1);
});

const wf = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [join(root, "web/src", k), v]));

test("층 지도 해석기: 남의 스타일시트와 kit→화면 import를 잡고, 제 것·kit·공용은 통과시킨다", () => {
  const ok = layerViolations(
    wf({
      "views/Home.tsx": `import "./Home.css";\nimport "../kit/Fold.css";`,
      "views/Home.css": ``,
      "kit/Fold.tsx": `import "./Fold.css";\nimport { Icon } from "./Icon.tsx";`,
      "kit/Icon.tsx": ``,
      "badges.tsx": `import "./badges.css";`,
    }),
  );
  assert.deepEqual(ok, []);
  const bad = layerViolations(
    wf({
      "views/Release.tsx": `import "./Home.css";`,
      "views/Home.tsx": ``,
      "kit/Fold.tsx": `import "../views/Home.css";\nimport { Home } from "../views/Home.tsx";`,
    }),
  );
  assert.deepEqual(bad, [
    "web/src/kit/Fold.tsx -> web/src/views/Home.css (kit이 kit 밖 스타일시트를 가져온다)",
    "web/src/kit/Fold.tsx -> web/src/views/Home.tsx (kit이 화면 파일을 가져온다)",
    "web/src/views/Release.tsx -> web/src/views/Home.css",
  ]);
});

test("층 지도 해석기: 한 화면 묶음 안의 공유(HOME의 Atfm, FLEET 폴더)는 위반이 아니다", () => {
  const v = layerViolations(
    wf({
      "views/Home.tsx": `import "./Atfm.css";`,
      "views/Atfm.tsx": ``,
      "views/fleet/Fleet.tsx": `import "../FleetCrew.css";`,
      "views/FleetCrew.tsx": ``,
    }),
  );
  assert.deepEqual(v, []);
});
