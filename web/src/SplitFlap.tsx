import { useEffect, useLayoutEffect, useRef } from "react";
import { useSettings } from "./settings.ts";

// Solari 안내판의 글자 드럼. 판은 이 순서로만 넘어간다.
const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-./";
// 한 칸이 넘기는 판은 최대 이만큼(목표 바로 앞 판부터). 멀리 도는 칸이 안내판 전체를 붙잡지 않게.
const MAX_FLIPS = 6;
// 왼쪽 칸부터 조금씩 늦게 시작해 물결처럼 넘어간다
const STAGGER_MS = 35;
// 판 한 장이 넘어가는 시간. 판은 중력으로 떨어지듯 끝으로 갈수록 빨라져서
// 수평(90°)까지가 대부분(FALL)이고 수평에서 바닥까지는 금방이다(LAND).
const FALL_MS = 85;
const LAND_MS = 35;
// 판이 없는 글자(TIME·REMARKS, 판 없는 테마)는 드럼 순서대로 이 간격마다 한 글자씩 떨어져 바뀐다
const TICK_MS = 70;

// from → to로 가며 보이는 판들(to 포함). 드럼에 없는 글자는 한 번에 넘긴다.
function route(from: string, to: string): string[] {
  if (from === to) return [];
  const a = DRUM.indexOf(from.toUpperCase());
  const b = DRUM.indexOf(to.toUpperCase());
  if (a < 0 || b < 0) return [to];
  const path: string[] = [];
  for (let i = (a + 1) % DRUM.length; i !== b; i = (i + 1) % DRUM.length) path.push(DRUM[i]);
  path.push(to);
  return path.slice(-MAX_FLIPS);
}

// 글자가 바뀌면 한 칸씩 판을 넘겨 새긴다. 처음 나타날 때는 빈 판에서 넘어온다.
// 화면 밖에 있거나 애니메이션을 끄면(설정·OS 동작 줄이기) 바로 바뀐다.
// 안내판 전체가 한꺼번에 넘어가도 버티도록 칸은 React 밖에서 직접 그린다.
export function SplitFlap({ text, title, bare = false }: { text: string; title?: string; bare?: boolean }) {
  const { motion } = useSettings();
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => setFlap(ref.current!, text, motion), [text, motion]);
  useEffect(() => {
    const el = ref.current!;
    return () => {
      viewport()?.unobserve(el);
      waiting.delete(el);
    };
  }, []);

  return <span ref={ref} className={bare ? "flap-bare" : "flap"} role="img" title={title} aria-label={title ?? text} />;
}

// ── 화면 안에 있는지: 레이아웃을 읽지 않고 IntersectionObserver가 알려 준 값을 쓴다 ──
const onScreen = new WeakMap<Element, boolean>();
const waiting = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | null = null;

function viewport(): IntersectionObserver | null {
  if (!observer && typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        onScreen.set(e.target, e.isIntersecting);
        const cb = waiting.get(e.target);
        waiting.delete(e.target);
        cb?.(e.isIntersecting);
      }
    });
  }
  return observer;
}

// 보이는지 알게 되면 cb. 처음 나타난 판은 다음 프레임의 첫 보고를 기다린다.
function whenSeen(el: Element, cb: (visible: boolean) => void): () => void {
  const io = viewport();
  if (!io) {
    cb(true);
    return () => {};
  }
  io.observe(el);
  const known = onScreen.get(el);
  if (known !== undefined) {
    cb(known);
    return () => {};
  }
  waiting.set(el, cb);
  return () => waiting.delete(el);
}

// ── 칸 ──
const current = new WeakMap<Element, string>(); // 칸마다 지금 걸려 있는 판

// 이 테마의 FLIGHT 판에 판(타일)이 그려지는지. 판이 없으면 넘기는 판 뒤로 옛 글자를 가릴 수 없다.
let tileTheme: string | undefined;
let tileKnown = false;
function themeHasTiles(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme !== tileTheme) {
    tileTheme = theme;
    tileKnown = getComputedStyle(document.documentElement).getPropertyValue("--flap-tile").trim() !== "none";
  }
  return tileKnown;
}

function setFlap(el: HTMLElement, text: string, motion: boolean): () => void {
  const chars = [...text];
  while (el.children.length > chars.length) el.lastElementChild!.remove();
  while (el.children.length < chars.length) {
    const b = document.createElement("b");
    b.setAttribute("aria-hidden", "true");
    settle(b, motion ? " " : "");
    el.append(b);
  }
  const cells = [...el.children] as HTMLElement[];
  if (!motion) {
    cells.forEach((c, i) => settle(c, chars[i]));
    return () => {};
  }
  const stops: (() => void)[] = [];
  const stopWaiting = whenSeen(el, (visible) => {
    const run = el.classList.contains("flap") && themeHasTiles() ? flip : tick;
    cells.forEach((c, i) => (visible ? stops.push(turn(c, chars[i], i * STAGGER_MS, run)) : settle(c, chars[i])));
  });
  return () => {
    stopWaiting();
    for (const stop of stops) stop();
  };
}

// 판을 멈추고 글자만 남긴다
function settle(cell: HTMLElement, ch: string) {
  current.set(cell, ch);
  cell.classList.remove("is-flipping");
  if (cell.firstElementChild || cell.textContent !== ch) cell.textContent = ch;
}

function span(cls: string, ...children: Node[]): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.append(...children);
  return s;
}

// 한 판을 넘기는 방법: path를 다 넘기면 done. 돌려주는 함수는 진행 중인 애니메이션을 멈춘다.
type Run = (cell: HTMLElement, target: string, path: string[], done: () => void) => () => void;

// 한 칸을 target까지 넘긴다. 멈추면 마지막으로 다 넘어간 판에 선다.
function turn(cell: HTMLElement, target: string, delay: number, run: Run): () => void {
  const path = route(current.get(cell) ?? " ", target);
  if (path.length === 0) {
    settle(cell, target);
    return () => {};
  }
  let stopRun = () => {};
  const timer = setTimeout(() => {
    stopRun = run(cell, target, path, () => settle(cell, target));
  }, delay);
  return () => {
    clearTimeout(timer);
    stopRun();
    settle(cell, current.get(cell)!);
  };
}

// 판이 있는 칸: 실제 split-flap처럼.
// 윗장(cur)이 앞으로 떨어지는 동안 뒤에는 next 윗면이 이미 걸려 있고, 아래에는 cur 아랫면이 그대로 있다가
// 떨어진 판의 뒷면(next 아랫면)이 그 위를 덮는다. 판은 기울수록 어두워진다.
// 떨어지는 각도 ∝ 시간², 수평까지의 구간과 그 뒤 구간을 각각 잘라 낸 곡선
const FALL_EASE = "cubic-bezier(0.33, 0, 0.67, 0.33)";
const LAND_EASE = "cubic-bezier(0.33, 0.28, 0.67, 0.61)";
const fallOut = [{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }];
const landIn = [{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }];
const darken = [{ opacity: 0 }, { opacity: 0.5 }];
const lighten = [{ opacity: 0.5 }, { opacity: 0 }];

const flip: Run = (cell, target, path, done) => {
  const face = () => document.createElement("i");
  const shade = () => span("fl-shade");
  const nextTop = span("fl-half fl-top", face());
  const prevBot = span("fl-half fl-bot", face());
  const out = span("fl-half fl-top", face(), shade());
  const inn = span("fl-half fl-bot", face(), shade());
  // 폭은 최종 글자로 잡아 넘기는 동안 줄이 흔들리지 않게 한다
  cell.replaceChildren(span("fl-sizer", document.createTextNode(target)), nextTop, prevBot, out, inn);
  cell.classList.add("is-flipping");

  let anims: Animation[] = [];
  const step = () => {
    const cur = current.get(cell)!;
    const next = path.shift()!;
    nextTop.firstChild!.textContent = next;
    prevBot.firstChild!.textContent = cur;
    out.firstChild!.textContent = cur;
    inn.firstChild!.textContent = next;
    anims = [
      out.animate(fallOut, { duration: FALL_MS, easing: FALL_EASE, fill: "forwards" }),
      out.lastElementChild!.animate(darken, { duration: FALL_MS, easing: FALL_EASE, fill: "forwards" }),
      inn.lastElementChild!.animate(lighten, { duration: LAND_MS, delay: FALL_MS, easing: LAND_EASE, fill: "both" }),
      inn.animate(landIn, { duration: LAND_MS, delay: FALL_MS, easing: LAND_EASE, fill: "both" }),
    ];
    anims[3].onfinish = () => {
      current.set(cell, next);
      for (const a of anims) a.cancel();
      if (path.length) step();
      else done();
    };
  };
  step();
  return () => {
    for (const a of anims) {
      a.onfinish = null;
      a.cancel();
    }
  };
};

// 판이 없는 칸: 넘기는 판 뒤로 옛 글자를 가릴 수 없으니 반쪽 글자를 보이지 않고,
// 드럼 순서대로 한 글자씩 위에서 떨어져 앉는다.
const drop = [
  { transform: "translateY(-0.15em)", opacity: 0.55 },
  { transform: "translateY(0)", opacity: 1 },
];

const tick: Run = (cell, target, path, done) => {
  const face = span("fl-tick");
  cell.replaceChildren(span("fl-sizer", document.createTextNode(target)), face);
  cell.classList.add("is-flipping");
  let anim: Animation | null = null;
  const step = () => {
    const next = path.shift()!;
    face.textContent = next;
    current.set(cell, next);
    anim = face.animate(drop, { duration: TICK_MS, easing: "ease-in" });
    anim.onfinish = () => (path.length ? step() : done());
  };
  step();
  return () => {
    if (anim) {
      anim.onfinish = null;
      anim.cancel();
    }
  };
};
