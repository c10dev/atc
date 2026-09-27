import { type ReactNode, useState } from "react";
import type { Proposal } from "../../../server/proposals.ts";
import { flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import "./DispatchBriefing.css";

// BRIEFING(ATC-4): 티켓 내용을 기억하지 못해도 카드만 보고 판정하게.
// 맨 위 세 줄은 OCC가 쓰고(없으면 제목과 본문 첫 문장), 사실 줄은 서버가 계산한다. 자세한 것은 접어 둔다.

export interface Facts {
  priority: number | null;
  waitDays: number | null;
  route: string | null;
  waypoint: { name: string; state: "passed" | "active" | "planned"; remaining: number } | null;
  blockers: { key: string; state: string | null; done: boolean }[];
  recent: { key: string; title: string | null; at: string; how: "ARRIVED" | "ENROUTE" }[];
  crosscheck: { verdict: "agree" | "disagree"; reason: string } | null;
}
export interface CardBrief {
  facts: Facts;
  lead: string | null; // BRIEFING이 없을 때 본문 첫 문장(서버가 읽는 중이면 null)
  blind?: boolean; // blind 표본: 판정 전까지 CROSSCHECK mark를 숨긴다(ATC-6, 옛 서버면 없음)
}

const PRIORITY = ["없음", "긴급", "높음", "보통", "낮음"];
const WP_STATE = { passed: "지난", active: "지금 구간", planned: "앞으로 갈" } as const;

export function BriefingLines({ p, title, info }: { p: Proposal; title: string | null; info: CardBrief | undefined }) {
  const b = p.briefing;
  if (b)
    return (
      <dl className="dp-brief" aria-label="BRIEFING">
        <dt>무슨 일</dt>
        <dd>{b.what}</dd>
        <dt>왜 이 AIRCRAFT</dt>
        <dd>{b.why}</dd>
        <dt>걸리는 점</dt>
        <dd>{b.risk}</dd>
      </dl>
    );
  return (
    <div className="dp-brief is-waiting" aria-label="BRIEFING 대기">
      <span className="dp-brief-tag">BRIEFING 대기</span>
      <p>
        {title && <b>{title}</b>}
        {title && info?.lead ? " — " : ""}
        {info?.lead ?? (title ? "" : p.flight)}
        {!info?.lead && <span className="faint"> (본문 첫 문장을 읽는 중)</span>}
      </p>
    </div>
  );
}

// 사실 줄: 모델 없이 서버가 계산한 것. 열린 카드의 CROSSCHECK는 칩에 있으니 HELD 카드에서만 줄에 넣는다
export function FactsLine({ info, now, aircraft, showCrosscheck }: { info: CardBrief | undefined; now: number; aircraft: string | null; showCrosscheck: boolean }) {
  if (!info) return null;
  const f = info.facts;
  const items: ReactNode[] = [];
  if (f.priority !== null) items.push(<span key="p">PRIORITY {f.priority ? `${f.priority} ${PRIORITY[f.priority] ?? ""}` : PRIORITY[0]}</span>);
  if (f.waitDays !== null) items.push(<span key="w">대기 {f.waitDays}일</span>);
  if (f.route)
    items.push(
      <span key="r">
        ROUTE {f.route}
        {f.waypoint &&
          ` · ${f.waypoint.name} WAYPOINT(${WP_STATE[f.waypoint.state]})${f.waypoint.remaining ? ` · 남은 ${f.waypoint.remaining}건 중 하나` : ""}`}
      </span>,
    );
  else items.push(<span key="r" className="faint">ROUTE 없음</span>);
  for (const b of f.blockers)
    items.push(
      <span key={`b-${b.key}`} className={b.done ? "dp-fact-ok" : "dp-fact-warn"}>
        선행 {flightNumber(b.key)} {b.state ?? "상태 모름"}
        {b.done ? " ✓" : ""}
      </span>,
    );
  if (aircraft)
    items.push(
      f.recent.length ? (
        <span key="h">
          {aircraft} 같은 ROUTE 최근: {f.recent.map((r) => `${flightNumber(r.key)} ${r.how} ${timeAgo(r.at, now)}`).join(", ")}
        </span>
      ) : (
        <span key="h" className="faint">
          {aircraft} 같은 ROUTE 최근 FLIGHT 없음
        </span>
      ),
    );
  if (showCrosscheck && f.crosscheck)
    items.push(
      <span key="x" className={f.crosscheck.verdict === "agree" ? "dp-fact-ok" : "dp-fact-warn"}>
        CROSSCHECK {f.crosscheck.verdict === "agree" ? "동의" : "반대"}: {f.crosscheck.reason}
      </span>,
    );
  return (
    <p className="dp-facts" aria-label="사실">
      {items.map((x, i) => (
        <span key={i} className="dp-fact">
          {x}
        </span>
      ))}
    </p>
  );
}

// 접어 둔 자세히: 점수 요소, 메모, FLIGHT 본문(열 때 Linear에서 읽는다)
export function CardDetails({ flight, children }: { flight: string; children: ReactNode }) {
  const [body, setBody] = useState<{ text: string | null; error: string | null } | null>(null);
  const load = () => {
    if (body) return;
    setBody({ text: null, error: null });
    fetch(`/api/dispatch/flight/${encodeURIComponent(flight)}`)
      .then((r) => r.json())
      .then((d) => setBody(d.error ? { text: null, error: String(d.error) } : { text: typeof d.description === "string" ? d.description : "", error: null }))
      .catch((e) => setBody({ text: null, error: String(e.message ?? e) }));
  };
  return (
    <details className="dp-more" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
      <summary>점수 요소 · 본문 · 메모</summary>
      {children}
      <h4 className="dp-more-h">본문</h4>
      {!body || (body.text === null && !body.error) ? (
        <p className="faint">읽는 중…</p>
      ) : body.error ? (
        <p className="faint">본문을 읽지 못함: {body.error}</p>
      ) : body.text ? (
        <div className="dp-body">{body.text}</div>
      ) : (
        <p className="faint">본문 없음</p>
      )}
    </details>
  );
}
