import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// 칩·태그·점의 기본(ATC-412, design-language 4.4, docs/design-system.md L1)이 kit에 있고, 화면 규칙이 그것을 다시 정의하지 않으며,
// 점은 이름 없이 혼자 서지 않고 ACTIVITY의 단계는 색만으로 구별되지 않는다.
const WEB = new URL("../web/src/", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(WEB, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test("kit/chips.css는 .chip·.tag·.dot 기본과 색을 나르지 않는 점 모양을 정의한다", () => {
  const css = read("kit/chips.css");
  for (const sel of [".chip {", ".tag {", ".dot {", '.dot[data-shape="ring"]', '.dot[data-shape="dash"]', '.tag[data-tone="alert"]']) assert.ok(css.includes(sel), `${sel} 없음`);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "kit/chips.css에 색 리터럴이 있다");
  assert.ok(!/--(?:paper|stamp|fids|flap|phase|series)-/.test(css), "kit은 도메인 토큰을 쓰지 않는다");
});

test('.tag[data-tone="inherit"]는 바깥 글자색을 그대로 받는다(color: inherit). 커스텀 속성에 inherit을 쓰면 --muted로 떨어진다', () => {
  const css = read("kit/chips.css");
  const body = /\.tag\[data-tone="inherit"\] \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(body, /(?:^|[\s;])color:\s*inherit\b/, "color: inherit이 없다");
  assert.ok(!/--tag-ink:\s*inherit/.test(body), "--tag-ink: inherit은 색을 잇지 않는다");
  assert.match(body, /--tag-line:\s*currentColor/);
});

test("옛 .code-chip·.dr-chip·.fl-chip·.tag의 자기 규칙은 기본 위에서 다른 점만 남았다", () => {
  const styles = read("styles.css");
  assert.ok(!/^\.code-chip \{/m.test(styles), ".code-chip 기본 규칙이 남았다");
  assert.ok(!/^\.tag \{/m.test(styles), "styles.css에 .tag 기본이 남았다");
  assert.ok(!/^\.dot \{/m.test(styles), "styles.css에 .dot 기본이 남았다");
  assert.ok(!/^\.fl-chip \{/m.test(read("views/fleet/Fleet.css")), ".fl-chip 기본 규칙이 남았다");
  const drawer = read("Drawer.css");
  const dr = /^\.dr-chip \{([^}]*)\}/m.exec(drawer);
  assert.ok(dr && !/border|padding|font/.test(dr[1]!), ".dr-chip이 모양을 다시 정의한다");
});

test("ActivityLine: 단계가 점의 모양과 낭독기 글로 나뉘고 툴팁에만 있지 않다", () => {
  const src = read("badges.tsx");
  const fn = src.slice(src.indexOf("export function ActivityLine"), src.indexOf("export function JobDetail"));
  assert.match(fn, /data-shape=\{PHASE_SHAPE\[activity\.phase\]\}/);
  assert.match(fn, /className="sr-only"/);
});

test("점 모양: ACTIVITY 단계 셋과 세션 상태 셋이 서로 다른 모양이다", async () => {
  const { dotShapeOf, PHASE_SHAPE } = await import("../web/src/kit/dot.ts");
  assert.equal(new Set(Object.values(PHASE_SHAPE).map((s) => s ?? "solid")).size, 3);
  assert.equal(new Set(["busy", "idle", "dead"].map((s) => dotShapeOf(s) ?? "solid")).size, 3);
  assert.equal(dotShapeOf("absent"), undefined);
});

test(".chip은 바탕을 칠하지 않는다(서랍·카드의 칩은 원래 투명이었다): 누르는 칩의 호버에서만 --layer-hover", () => {
  const css = read("kit/chips.css");
  const chip = /^\.chip \{([^}]*)\}/m.exec(css)?.[1] ?? "";
  assert.match(chip, /background:\s*transparent/);
  assert.ok(!/var\(--layer\b/.test(chip), ".chip 기본이 --layer로 칠한다");
});

test("점은 이름 없이 혼자 서지 않는다: .dot이 붙은 요소는 aria-label이나 aria-hidden을 가진다", () => {
  const bad: string[] = [];
  for (const f of walk(WEB).filter((p) => p.endsWith(".tsx"))) {
    for (const [i, line] of readFileSync(f, "utf8").split("\n").entries()) {
      if (/className=(?:"|\{`)(?:[^"`]*\s)?dot(?:\s|[-"`])/.test(line) && !/aria-label|aria-hidden/.test(line)) bad.push(`${f.slice(WEB.length)}:${i + 1}`);
    }
  }
  assert.deepEqual(bad, []);
});
