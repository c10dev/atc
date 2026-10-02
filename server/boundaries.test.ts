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
  "server/dispatch-launch.ts <-> server/dispatch.ts",
  "server/autoland-run.ts <-> server/landing-review.ts",
  "server/fleet-plan.ts <-> server/fresh-start.ts <-> server/session-control.ts", // 동적 import()로 이어지는 순환
  "server/atfm-run.ts <-> server/following.ts <-> server/milestones-run.ts <-> server/network-drafts.ts <-> server/network.ts <-> server/proposals.ts <-> server/routes.ts <-> server/schedule-waypoint.ts <-> server/schedule.ts <-> server/standfree-run.ts <-> server/waypoint-gaps.ts <-> server/waypoint-slips.ts",
];
// 오늘의 화면→Node 값 import 사슬. "web 파일 -> … -> node:xxx" 형식. 새 항목을 더하지 않는다.
export const ALLOWED_WEB_NODE_CHAINS: string[] = [
  "web/src/views/fleet/ReportMark.tsx -> server/judges/report.ts -> server/judges/classify.ts -> server/briefs.ts -> server/landing.ts -> server/human-check.ts -> node:path",
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
