import { Fragment, useEffect, useReducer } from "react";
import { useSettings } from "./settings.ts";

// Solari 안내판의 글자 드럼. 판은 이 순서로만 넘어간다.
const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-./";
// 한 칸이 넘기는 판은 최대 이만큼(목표 바로 앞 판부터). 멀리 도는 칸이 안내판 전체를 붙잡지 않게.
const MAX_FLIPS = 8;
// 왼쪽 칸부터 조금씩 늦게 시작해 물결처럼 넘어간다
const STAGGER_MS = 35;

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

interface Cell {
  cur: string; // 지금 걸려 있는 판
  path: string[]; // 앞으로 넘길 판들
  step: number; // 넘긴 횟수. 판 한 장마다 애니메이션을 새로 건다
  running: boolean;
}

type Action = { type: "aim"; to: string } | { type: "go" } | { type: "next" } | { type: "set"; to: string };

function reduce(s: Cell, a: Action): Cell {
  switch (a.type) {
    case "aim":
      return { ...s, path: route(s.cur, a.to), running: false };
    case "go":
      return { ...s, running: true };
    case "next":
      return { ...s, cur: s.path[0], path: s.path.slice(1), step: s.step + 1 };
    case "set":
      return { ...s, cur: a.to, path: [], running: false };
  }
}

// 글자가 바뀌면 한 칸씩 판을 넘겨 새긴다. 처음 나타날 때는 빈 판에서 넘어온다.
// 애니메이션을 끄면(설정·OS 동작 줄이기) 바로 바뀐다.
export function SplitFlap({ text, title, bare = false }: { text: string; title?: string; bare?: boolean }) {
  const { motion } = useSettings();
  return (
    <span className={bare ? "flap-bare" : "flap"} role="img" title={title} aria-label={title ?? text}>
      {[...text].map((c, i) => (
        <FlapCell key={i} char={c} delay={i * STAGGER_MS} motion={motion} />
      ))}
    </span>
  );
}

function FlapCell({ char, delay, motion }: { char: string; delay: number; motion: boolean }) {
  const [s, dispatch] = useReducer(reduce, motion ? " " : char, (cur): Cell => ({ cur, path: [], step: 0, running: false }));

  useEffect(() => {
    if (!motion) {
      dispatch({ type: "set", to: char });
      return;
    }
    dispatch({ type: "aim", to: char });
    const t = setTimeout(() => dispatch({ type: "go" }), delay);
    return () => clearTimeout(t);
  }, [char, motion, delay]);

  const next = s.path[0];
  if (!s.running || next === undefined) return <b aria-hidden>{s.cur}</b>;
  // 윗장(cur)이 앞으로 꺾여 떨어지면 뒤의 next 윗면이 드러나고, next 아랫장이 올라와 붙는다.
  // 폭은 최종 글자로 잡아 넘기는 동안 줄이 흔들리지 않게 한다.
  return (
    <b aria-hidden className="is-flipping">
      <span className="fl-sizer">{char}</span>
      <Fragment key={s.step}>
        <span className="fl-half fl-top fl-next">
          <i>{next}</i>
        </span>
        <span className="fl-half fl-bot fl-prev">
          <i>{s.cur}</i>
        </span>
        <span className="fl-half fl-top fl-out">
          <i>{s.cur}</i>
        </span>
        <span className="fl-half fl-bot fl-in" onAnimationEnd={() => dispatch({ type: "next" })}>
          <i>{next}</i>
        </span>
      </Fragment>
    </b>
  );
}
