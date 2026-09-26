import { useEffect, useLayoutEffect, useRef } from "react";
import { useSettings } from "./settings.ts";

// Solari 안내판의 글자 드럼. 판은 이 순서로만 넘어간다.
const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-./";
// 한 칸이 넘기는 판은 최대 이만큼(목표 바로 앞 판부터). 멀리 도는 칸이 안내판 전체를 붙잡지 않게.
const MAX_FLIPS = 8;
// 왼쪽 칸부터 조금씩 늦게 시작해 물결처럼 넘어간다
const STAGGER_MS = 35;
// 판 한 장의 절반: 윗장이 떨어지는 시간 = 아랫장이 올라오는 시간
const HALF_MS = 40;

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
  const stopWaiting = whenSeen(el, (visible) =>
    cells.forEach((c, i) => (visible ? stops.push(turn(c, chars[i], i * STAGGER_MS)) : settle(c, chars[i]))),
  );
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

function half(cls: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = `fl-half ${cls}`;
  s.append(document.createElement("i"));
  return s;
}

const hidden = [{ opacity: 0 }, { opacity: 0 }];
const fallOut = [{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }];
const riseIn = [{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }];

// 한 칸을 target까지 넘긴다. 멈추면 마지막으로 다 넘어간 판에 선다.
function turn(cell: HTMLElement, target: string, delay: number): () => void {
  const path = route(current.get(cell) ?? " ", target);
  if (path.length === 0) {
    settle(cell, target);
    return () => {};
  }
  let anims: Animation[] = [];
  const timer = setTimeout(() => {
    // 윗장(cur)이 앞으로 꺾여 떨어지면 뒤의 next 윗면이 드러나고, next 아랫장이 올라와 붙는다.
    // 폭은 최종 글자로 잡아 넘기는 동안 줄이 흔들리지 않게 한다.
    const sizer = document.createElement("span");
    sizer.className = "fl-sizer";
    sizer.textContent = target;
    const nextTop = half("fl-top");
    const prevBot = half("fl-bot");
    const out = half("fl-top");
    const inn = half("fl-bot");
    cell.replaceChildren(sizer, nextTop, prevBot, out, inn);
    cell.classList.add("is-flipping");

    const step = () => {
      const cur = current.get(cell)!;
      const next = path.shift()!;
      nextTop.firstChild!.textContent = next;
      prevBot.firstChild!.textContent = cur;
      out.firstChild!.textContent = cur;
      inn.firstChild!.textContent = next;
      anims = [
        nextTop.animate(hidden, { duration: HALF_MS }),
        prevBot.animate(hidden, { duration: HALF_MS, delay: HALF_MS, fill: "forwards" }),
        out.animate(fallOut, { duration: HALF_MS, easing: "ease-in", fill: "forwards" }),
        inn.animate(riseIn, { duration: HALF_MS, delay: HALF_MS, easing: "ease-out", fill: "both" }),
      ];
      anims[3].onfinish = () => {
        current.set(cell, next);
        for (const a of anims) a.cancel();
        if (path.length) step();
        else settle(cell, next);
      };
    };
    step();
  }, delay);

  return () => {
    clearTimeout(timer);
    for (const a of anims) {
      a.onfinish = null;
      a.cancel();
    }
    settle(cell, current.get(cell)!);
  };
}
