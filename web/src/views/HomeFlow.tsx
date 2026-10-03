import { type KeyboardEvent, type ReactNode, useCallback, useRef, useState } from "react";
import type { FlowAirport, FlowCell, FlowFlight, FlowStage, FlowView } from "../../../server/home-flow.ts";
import { ageText } from "../flow-age.ts";
import { GLYPH, splitLine, STAGE_META, VERDICT_WORD } from "../flow-board.ts";
import { OpenFlight } from "../FlightLink.tsx";
import { SinceLook } from "../SinceLook.tsx";
import "./HomeFlow.css";

// HOME의 초점 판정 블록과 흐름판(ATC-502, docs/home-flow.md 3.2–3.4, 프로토타입 A3 "초점과 정렬").
// 판정·칸·주체·문구는 모두 서버가 정한다(GET /api/flow). 화면은 글자를 나누고 그린다(design-language 원칙 4).
// 데이터는 Home이 GET /api/flow에서 읽어 넘긴다(useFlow, HomeTodo.tsx). 색: 정상은 무채색이다(원칙 1의 HOME 예외). 정체 --amber ▲, 막힘 --alert ■ 뿐이고, 주체 태그는 중립 테두리·굵은 글이다.
// 초점: 가장 나쁜 AIRPORT 하나가 이긴다. 제목(크게)과 숫자·이유 줄, 할 일 링크, SINCE LAST LOOK 한 줄(예전 따로 선 줄을 흡수)
export function FocalVerdict({ view, sinceKey, onTodo }: { view: FlowView; sinceKey: string; onTodo: () => void }) {
  const { title, rest } = splitLine(view.line);
  const glyph = GLYPH[view.verdict];
  return (
    <header className="fb-focal" data-verdict={view.verdict} aria-label={`흐름 판정 ${VERDICT_WORD[view.verdict]}`}>
      <p className="fb-focal-title">
        {glyph && (
          <span className="fb-glyph" aria-hidden="true">
            {glyph}{" "}
          </span>
        )}
        {title}
      </p>
      <p className="fb-focal-rest">
        {rest && <span>{rest}</span>}
        {view.todo.length > 0 && (
          <button type="button" className="fb-todo-link" onClick={onTodo}>
            할 일 {view.todo.length} ↓
          </button>
        )}
      </p>
      <SinceLook refreshKey={sinceKey} />
    </header>
  );
}

type Pick = { airport: string; stage: FlowStage } | null;

export function FlowBoard({ view, onTodo }: { view: FlowView; onTodo: (todoKey: string) => void }) {
  const [pick, setPick] = useState<Pick>(null);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const cellKey = (code: string, stage: FlowStage) => `${code}/${stage}`;
  const toggle = (code: string, stage: FlowStage) => setPick((p) => (p && p.airport === code && p.stage === stage ? null : { airport: code, stage }));
  // Escape: 열린 목록을 닫고 눌렀던 칸으로 초점을 돌린다
  const close = useCallback(() => {
    setPick((p) => {
      if (p) requestAnimationFrame(() => cells.current.get(cellKey(p.airport, p.stage))?.focus());
      return null;
    });
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && pick) {
      e.stopPropagation();
      close();
    }
  };
  if (view.airports.length === 0) return null;
  return (
    <section className="fb" aria-label="흐름판" onKeyDown={onKey}>
      <div className="fb-head" aria-hidden="true">
        <span />
        <span className="fb-head-stages">
          {STAGE_META.map((s) => (
            <span key={s.stage} className="fb-head-cell">
              <b>{s.code}</b>
              <span>{s.ko}</span>
            </span>
          ))}
        </span>
        <span className="fb-head-cell is-spark">
          <b>ON</b>
          <span>12h</span>
        </span>
      </div>
      {view.airports.map((a) => (
        <AirportRow
          key={a.code}
          a={a}
          worst={view.worst}
          pick={pick?.airport === a.code ? pick.stage : null}
          onPick={(stage) => toggle(a.code, stage)}
          onClose={close}
          onTodo={onTodo}
          register={(stage, el) => {
            if (el) cells.current.set(cellKey(a.code, stage), el);
            else cells.current.delete(cellKey(a.code, stage));
          }}
        />
      ))}
    </section>
  );
}

const idle = (a: FlowAirport) => a.cells.every((c) => c.count === 0);

function AirportRow({
  a,
  worst,
  pick,
  onPick,
  onClose,
  onTodo,
  register,
}: {
  a: FlowAirport;
  worst: string | undefined;
  pick: FlowStage | null;
  onPick: (s: FlowStage) => void;
  onClose: () => void;
  onTodo: (todoKey: string) => void;
  register: (s: FlowStage, el: HTMLButtonElement | null) => void;
}) {
  const quiet = idle(a);
  const open = pick ? a.cells.find((c) => c.stage === pick) : undefined;
  return (
    <section className="fb-ap" data-verdict={a.verdict} aria-label={`${a.code} ${a.name} ${quiet && a.verdict === "normal" ? "비행 없음" : VERDICT_WORD[a.verdict]}`}>
      <div className={`fb-row${quiet ? " is-idle" : ""}`}>
        <div className="fb-name">
          <b>
            {GLYPH[a.verdict] && (
              <span className="fb-glyph" data-verdict={a.verdict} aria-hidden="true">
                {GLYPH[a.verdict]}{" "}
              </span>
            )}
            {a.code}
          </b>
          <span>{a.name}</span>
        </div>
        {quiet ? (
          <span className="fb-idle">비행 없음</span>
        ) : (
          <div className="fb-cells">
            {a.cells.map((c) => (
              <Cell key={c.stage} a={a} c={c} open={pick === c.stage} onPick={() => onPick(c.stage)} register={(el) => register(c.stage, el)} />
            ))}
          </div>
        )}
        <Spark a={a} />
        {a.reason && a.code !== worst && <p className="fb-reason">{a.reason}</p>}
      </div>
      {open && <CellList a={a} c={open} onClose={onClose} onTodo={onTodo} />}
    </section>
  );
}

function Cell({ a, c, open, onPick, register }: { a: FlowAirport; c: FlowCell; open: boolean; onPick: () => void; register: (el: HTMLButtonElement | null) => void }) {
  const meta = STAGE_META.find((s) => s.stage === c.stage)!;
  if (c.count === 0) {
    return (
      <span className="fb-cell is-empty" role="img" aria-label={`${meta.code} 0건`}>
        <span className="fb-cell-code" aria-hidden="true">
          {meta.code}
        </span>
      </span>
    );
  }
  const stuck = c.stuck > 0;
  const label = `${a.code} ${meta.code} ${c.count}건, ${stuck ? `최장 ${ageText(c.oldestMin)} 막힘${c.holder ? `, ${c.holder}` : ""}` : `가장 오래된 ${ageText(c.oldestMin)}`}${c.note ? `, ${c.note}` : ""}`;
  return (
    <button type="button" ref={register} className="fb-cell" data-tone={c.tone ?? undefined} aria-expanded={open} aria-controls={`fb-list-${a.code}`} aria-label={label} title={c.note} onClick={onPick}>
      <span className="fb-cell-code" aria-hidden="true">
        {meta.code}
      </span>
      <span className="fb-cell-n tn" aria-hidden="true">
        {c.tone && <span className="fb-glyph">{c.tone === "warning" ? "■" : "▲"} </span>}
        {c.count}
      </span>
      <span className="fb-cell-age tn" aria-hidden="true">
        {stuck ? `최장 ${ageText(c.oldestMin)}` : ageText(c.oldestMin)}
      </span>
      {stuck && c.holder && <Holder full={c.holder} short={c.holderShort ?? c.holder} />}
    </button>
  );
}

// 주체 태그: 중립 테두리와 굵은 글. 좁은 칸은 서버가 준 짧은 꼴을 쓰고, 전체 이름은 접근 이름과 툴팁에 있다(4.4)
function Holder({ full, short }: { full: string; short: string }) {
  return (
    <span className="fb-holder" title={full} aria-hidden="true">
      <span className="fb-holder-full">{full}</span>
      <span className="fb-holder-short">{short}</span>
    </span>
  );
}

function Spark({ a }: { a: FlowAirport }) {
  const max = Math.max(6, ...a.landings12h);
  const total = a.landings12h.reduce((s, n) => s + n, 0);
  const since = a.sinceOnMin === null ? "—" : ageText(a.sinceOnMin);
  return (
    <div className="fb-spark" role="img" aria-label={`지난 12시간 착륙 ${total}건, 마지막 착륙 ${since === "—" ? "없음" : `${since} 전`}`}>
      <span className="fb-spark-bars" aria-hidden="true">
        {a.landings12h.map((n, i) => (
          <span key={i} className={n === 0 ? "is-zero" : undefined} style={n === 0 ? undefined : { height: `${Math.max(12, (n / max) * 100)}%` }} />
        ))}
      </span>
      <span className="fb-spark-cap tn" aria-hidden="true">
        <b>{total}</b> · 마지막 <span data-late={a.verdict === "stopped" || undefined}>{since}</span>
      </span>
    </div>
  );
}

// 고른 칸의 FLIGHT 목록: 그 AIRPORT 줄 바로 아래. 모두 할 일에 있으면 FLIGHT는 다시 적지 않고 그 할 일을 가리킨다(원칙 6)
function CellList({ a, c, onClose, onTodo }: { a: FlowAirport; c: FlowCell; onClose: () => void; onTodo: (todoKey: string) => void }) {
  const meta = STAGE_META.find((s) => s.stage === c.stage)!;
  let body: ReactNode;
  if (c.todoGroup && c.flights.length === 0) {
    const group = c.todoGroup;
    body = (
      <button type="button" className="fb-all-todo" onClick={() => onTodo(group)}>
        {c.count}건 모두 아래 할 일에 있다 ↓
      </button>
    );
  } else {
    body = (
      <ul className="fb-flights">
        {c.flights.map((f) => (
          <FlightLine key={f.key} f={f} onTodo={onTodo} />
        ))}
      </ul>
    );
  }
  return (
    <div id={`fb-list-${a.code}`} className="fb-list" role="group" aria-label={`${a.code} ${meta.code} FLIGHT`}>
      <p className="fb-list-head">
        <b>
          {a.code} · {meta.code}
        </b>
        <span>{c.count}건</span>
        {c.note && <span>{c.note}</span>}
        <button type="button" className="btn fb-list-close" onClick={onClose}>
          닫기
        </button>
      </p>
      {body}
    </div>
  );
}

function FlightLine({ f, onTodo }: { f: FlowFlight; onTodo: (todoKey: string) => void }) {
  return (
    <li className="fb-flight" data-stuck={f.stuck || undefined}>
      <span className="fb-flight-key">
        <OpenFlight k={f.key} />
      </span>
      <span className="fb-flight-title">{f.title}</span>
      <span className="fb-flight-sub">{f.stuck && f.why ? f.why : f.sub}</span>
      {f.stuck && f.holder && (
        <span className="fb-holder" title={f.holder}>
          {f.holder}
        </span>
      )}
      <span className="fb-flight-age tn">{ageText(f.ageMin)}</span>
      {f.todo ? (
        <button type="button" className="fb-todo-link" onClick={() => onTodo(f.todo!)}>
          할 일 ↓
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}
