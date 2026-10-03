import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// 기다림 표시(ATC-453, design-language 원칙 10): 접근등 "토끼"(kit/Loading)와 첫 불러오기 장면(ApproachScene).
// 색·시간은 토큰만, 움직임이 꺼지면 불빛이 멈추고, 늦을 때만 보이고, 글(role="status")은 그대로 남는다.
const WEB = new URL("../web/src/", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(WEB, p), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test("지연: 300 ms 안에 끝나는 불러오기에는 아무것도 더 보이지 않는다(불빛은 늦을 때만 그린다)", () => {
  assert.match(read("kit/loading.ts"), /LOADING_DELAY_MS = 300\b/);
  const tsx = read("kit/Loading.tsx");
  assert.match(tsx, /useLate\(/);
  assert.match(tsx, /\{late && \(/, "불빛은 late일 때만 그린다");
  assert.match(tsx, /role="status"/, "글은 role=status로 남는다");
  assert.match(tsx, /aria-hidden="true"/, "불빛은 장식이다");
  const scene = read("ApproachScene.tsx");
  assert.match(scene, /if \(!late\) return null;/, "장면은 늦을 때만 그린다");
  assert.match(scene, /if \(!late\) return onGone\(\)/, "빨리 오면 장면을 그린 적 없이 내린다");
  assert.match(scene, /role="status"/);
});

test("kit/Loading.css: 글·선 계열 토큰만, 한 바퀴 1초, 움직임이 꺼지면 멈춘 채 어슴푸레 켜져 있다", () => {
  const css = strip(read("kit/Loading.css"));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), "색 리터럴");
  assert.ok(!/--radar|--amber|--alert|--cyan|--blue/.test(css), "인라인 표시는 신호색을 쓰지 않는다(중립)");
  assert.match(css, /color:\s*var\(--text\)/);
  assert.match(css, /border-top:\s*2px solid var\(--line-strong\)/);
  assert.match(css, /animation:\s*kit-light 1s var\(--ease\) infinite/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.kit-lights i \{\s*animation: none;/);
  assert.match(css, /:root\[data-motion="off"\] \.kit-lights i \{\s*animation: none;/);
  assert.match(css, /\.kit-lights i \{[^}]*opacity: 0\.35;/, "기본(움직임 없음)은 어슴푸레 켜져 있다");
});

test("ApproachScene.css: --radar는 준비됨(.is-ready)의 문턱 불빛에만, 사라짐은 --dur-base·--ease, 움직임이 꺼지면 멈춘다", () => {
  const css = strip(read("ApproachScene.css"));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), "색 리터럴");
  const radar = [...css.matchAll(/([^{}]+)\{[^}]*--radar[^}]*\}/g)].map((m) => m[1]!.trim());
  assert.deepEqual(radar, [".approach.is-ready .ap-threshold"], "--radar를 쓰는 곳");
  assert.match(css, /transition:\s*opacity var\(--dur-base\) var\(--ease\)/);
  assert.match(css, /animation:\s*approach-enter var\(--dur-base\) var\(--ease\)/);
  assert.match(css, /:root\[data-motion="off"\] \.ap-lights circle \{\s*animation: none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ap-lights circle \{\s*animation: none;/);
  assert.match(css, /:root\[data-motion="off"\] \.main-enter \{\s*animation: none;/);
});

test("App: 첫 스냅샷 전에는 ApproachScene, 연결이 끊기면 글만, 장면이 있었을 때만 화면이 들어오는 애니메이션", () => {
  const app = read("App.tsx");
  assert.match(app, /<ApproachScene ready=\{Boolean\(snapshot && idx\)\}/);
  assert.match(app, /connection === "lost" \? <Empty>서버에 연결할 수 없음<\/Empty>/);
  assert.match(app, /sceneSeen && !introDone \? "main-enter" : undefined/);
});

test("불러오는 줄은 Loading으로: Empty에 불러오는 글이 남지 않고, TabLoading·DUTY 답하는 중·LAUNCH가 불빛을 쓴다", () => {
  const bad: string[] = [];
  for (const p of walk(WEB).filter((f) => f.endsWith(".tsx"))) {
    const t = readFileSync(p, "utf8");
    if (/<Empty[^>]*>\s*(?:[^<]*)불러오는 중…\s*<\/Empty>/.test(t) || /<Empty>\{[^}]*"[^"]*불러오는 중…"[^}]*\}<\/Empty>/.test(t)) bad.push(p.replace(WEB, ""));
  }
  assert.deepEqual(bad, [], "Empty에 불러오는 글");
  assert.match(read("lazyTab.tsx"), /<Loading className="tab-loading">화면 불러오는 중…<\/Loading>/);
  assert.match(read("DutyDrawer.tsx"), /<Loading className="du-thinking">DUTY가 답하는 중…<\/Loading>/);
  assert.match(read("views/fleet/LaunchPanel.tsx"), /<Lights \/>/);
  assert.match(read("views/fleet/Card.tsx"), /<Lights \/>/);
  // 글은 그대로: 버튼의 "띄우는 중…" 라벨과 UpdateBar 점은 바뀌지 않았다
  assert.match(read("views/fleet/Card.tsx"), /띄우는 중…/);
});
