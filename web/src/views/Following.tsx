import { useCallback, useEffect, useState } from "react";
import { flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import { followingExceptions } from "../readiness-line.ts";
import "./Following.css";

// FLIGHT FOLLOWING(운항 추적, docs/occ.md 8장). 배정된 FLIGHT의 단계와 지연·불일치를 보여 주기만 한다.

type Stage = "readback" | "departed" | "prOpened" | "cleared" | "arrived";
interface FollowIssue {
  key: string;
  code: string;
  kind: "delay" | "mismatch";
  severity: "warn" | "info";
  text: string;
  since: string;
  fresh: boolean;
  reportedAt: string | null;
}
interface FollowItem {
  flight: string;
  title: string | null;
  url: string | null;
  state: string | null;
  aircraft: string | null;
  source: "dispatch" | "tail";
  standFree?: boolean; // STAND 없는 FLIGHT(SURVEY·CHECK): READBACK → DEPARTED → ARRIVED
  arrival?: { note: string; url: string | null } | null; // STAND 없는 FLIGHT의 ARRIVED 보고
  proposal: { id: string; status: string } | null;
  wake: "L" | "M" | "H" | "J";
  expectMin: number;
  stages: Record<Stage, string | null>;
  stage: Stage | null;
  stageAt: string | null;
  stand: string | null;
  pr: { repo: string; number: number; url: string; merged: boolean } | null;
  issues: FollowIssue[];
}
export interface FollowBrief {
  at: string;
  items: FollowItem[];
}

// 단계 이름: 넓을 때 전체, 좁을 때(390px) 약호
const STAGES: { id: Stage; name: string; short: string }[] = [
  { id: "readback", name: "READBACK", short: "RB" },
  { id: "departed", name: "DEPARTED", short: "DEP" },
  { id: "prOpened", name: "PR", short: "PR" },
  { id: "cleared", name: "CLEARED", short: "CLR" },
  { id: "arrived", name: "ARRIVED", short: "ARR" },
];
const KIND_TEXT: Record<FollowIssue["kind"], string> = { delay: "지연", mismatch: "불일치" };
const EMPTY_STAGES: Record<Stage, string | null> = { readback: null, departed: null, prOpened: null, cleared: null, arrived: null };

const clock = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 만드는 중인 서버가 필드를 빠뜨려도 그리게 기본값을 채운다
function normalize(raw: Partial<FollowBrief> | null): FollowBrief | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return null;
  return {
    at: raw.at ?? new Date().toISOString(),
    items: raw.items.map((f) => ({ ...f, stages: { ...EMPTY_STAGES, ...f.stages }, issues: f.issues ?? [] })),
  };
}

// FLIGHT FOLLOWING 상태 하나를 예외 줄(FollowingAlert)과 READINESS 안 전체 패널(FollowingPanel)이 함께 쓴다(ATC-113)
export function useFollowing(refreshKey: string): FollowBrief | null {
  const [brief, setBrief] = useState<FollowBrief | null>(null);

  // 서버에 FLIGHT FOLLOWING이 없거나(404) 실패하면 아무것도 그리지 않는다
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/following");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBrief(normalize(await res.json()));
    } catch {
      setBrief(null);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);
  return brief;
}

const ALERT_MAX = 3; // 예외 줄에 펴 두는 FLIGHT 수. 넘으면 개수만 적고 나머지는 전체 패널에서

// 예외: 지연·불일치가 있는 FLIGHT 줄만 맨 위에. 전체 패널은 READINESS 안에 그대로 있고, onOpenFull이 그리로 연다
export function FollowingAlert({ brief, now, onOpenFull }: { brief: FollowBrief | null; now: number; onOpenFull: () => void }) {
  const rows = followingExceptions(brief?.items);
  if (!brief || !rows.length) return null;
  return (
    <section className="ff ff-alert" aria-labelledby="ff-alert-title">
      <header className="ff-head">
        <h2 className="label" id="ff-alert-title">
          FLIGHT FOLLOWING <em>지연·불일치 {rows.length}건</em>
        </h2>
        <button type="button" className="dp-btn ff-full" onClick={onOpenFull}>
          전체 FLIGHT FOLLOWING ↓
        </button>
      </header>
      <ul className="ff-list">
        {rows.slice(0, ALERT_MAX).map((f) => (
          <li key={f.flight} className="ff-item ff-compact">
            <div className="ff-row">
              {f.url ? (
                <a className="mono ff-flight" href={f.url} target="_blank" rel="noreferrer">
                  {flightNumber(f.flight)}
                </a>
              ) : (
                <span className="mono ff-flight">{flightNumber(f.flight)}</span>
              )}
              <span className="ff-title" title={f.title ?? undefined}>
                {f.title ?? "—"}
              </span>
              <span className="ff-meta">
                <span className="mono">{f.aircraft ?? "—"}</span>
              </span>
            </div>
            <FollowIssues f={f} now={now} />
          </li>
        ))}
      </ul>
      {rows.length > ALERT_MAX && (
        <p className="faint ff-more">
          외 {rows.length - ALERT_MAX}건 — 위 버튼으로 전체를 본다
        </p>
      )}
    </section>
  );
}

export function FollowingPanel({ brief, now }: { brief: FollowBrief | null; now: number }) {
  if (!brief) return null;
  const { items } = brief;
  const issues = items.flatMap((f) => f.issues);
  const delays = issues.filter((i) => i.kind === "delay").length;
  const mismatches = issues.filter((i) => i.kind === "mismatch").length;

  return (
    <section className="ff" aria-labelledby="ff-title">
      <header className="ff-head">
        <h2 className="label" id="ff-title">
          FLIGHT FOLLOWING <em>운항 추적</em>
        </h2>
        <span className="ff-counts">
          <span>
            FLIGHT <b>{items.length}</b>
          </span>
          <span className={delays ? "has-warn" : undefined}>
            지연 <b>{delays}</b>
          </span>
          <span className={mismatches ? "has-warn" : undefined}>
            불일치 <b>{mismatches}</b>
          </span>
        </span>
        <time className="faint ff-at" dateTime={brief.at} title={clock(brief.at)}>
          확인 {timeAgo(brief.at, now)}
        </time>
      </header>

      {items.length ? (
        <ul className="ff-list">
          {items.map((f) => (
            <FollowRow key={f.flight} f={f} now={now} />
          ))}
        </ul>
      ) : (
        <p className="empty">따라가는 FLIGHT 없음 (accepted·departed·recalling인 배정, tail: 라벨이 붙은 In Progress FLIGHT가 대상)</p>
      )}
    </section>
  );
}

function FollowRow({ f, now }: { f: FollowItem; now: number }) {
  const fn = flightNumber(f.flight);
  return (
    <li className="ff-item">
      <div className="ff-row">
        {f.url ? (
          <a className="mono ff-flight" href={f.url} target="_blank" rel="noreferrer">
            {fn}
          </a>
        ) : (
          <span className="mono ff-flight">{fn}</span>
        )}
        <span className="ff-title" title={f.title ?? undefined}>
          {f.title ?? "—"}
        </span>
        <span className="ff-meta">
          {f.state && <span className="faint">{f.state}</span>}
          <span className="mono">{f.aircraft ?? "—"}</span>
          {f.source === "dispatch" && f.proposal ? (
            <span className="ff-tag" title="DISPATCH 제안으로 배정">
              DISPATCH {f.proposal.id} {f.proposal.status}
            </span>
          ) : (
            <span className="ff-tag" title="tail: 라벨로 직접 배정(DISPATCH 제안 없음)">
              tail:
            </span>
          )}
          <span className="ff-tag" title={`WAKE ${f.wake} · 기대 ${f.expectMin}분`}>
            WAKE {f.wake}
          </span>
        </span>
      </div>

      <div className="ff-track">
        <StageBar f={f} now={now} />
        {f.arrival && (
          <span className="ff-pr" title={`ARRIVED 보고: ${f.arrival.note}`}>
            {f.arrival.url ? (
              <a href={f.arrival.url} target="_blank" rel="noreferrer">
                결과
              </a>
            ) : (
              <span className="faint">ARRIVED 보고</span>
            )}
          </span>
        )}
        {f.pr && (
          <span className="ff-pr">
            <a className="mono" href={f.pr.url} target="_blank" rel="noreferrer" title={`${f.pr.repo} #${f.pr.number}`}>
              #{f.pr.number}
            </a>
            {f.pr.merged && <span className="ff-tag t-merged">merged</span>}
          </span>
        )}
      </div>

      <FollowIssues f={f} now={now} />
    </li>
  );
}

function FollowIssues({ f, now }: { f: FollowItem; now: number }) {
  return (
    <>
      {f.issues.length > 0 && (
        <ul className="ff-issues">
          {f.issues.map((i) => (
            <li key={i.key} className={`k-${i.kind} s-${i.severity}`} title={`${clock(i.since)}부터`}>
              <span className="ff-kind">{KIND_TEXT[i.kind] ?? i.kind}</span>
              <span className="ff-text">{i.text}</span>
              {i.fresh ? (
                <span className="ff-tag t-new" title="OCC가 아직 보고하지 않음">
                  NEW
                </span>
              ) : (
                <span className="faint ff-reported">보고됨{i.reportedAt ? ` ${timeAgo(i.reportedAt, now)}` : ""}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// 단계 막대: 닿은 단계는 채우고, 지금 단계는 강조. tail:이면 READBACK은 해당 없음.
// STAND 없는 FLIGHT는 PR·CLEARED가 없어 READBACK → DEPARTED → ARRIVED 3단계
function StageBar({ f, now }: { f: FollowItem; now: number }) {
  const steps = f.standFree ? STAGES.filter((s) => s.id !== "prOpened" && s.id !== "cleared") : STAGES;
  return (
    <ol className={`ff-stages${f.standFree ? " is-short" : ""}`} aria-label={`${flightNumber(f.flight)} 단계${f.standFree ? " (STAND 없는 FLIGHT)" : ""}`}>
      {steps.map((s) => {
        const at = f.stages[s.id];
        const na = s.id === "readback" && f.source === "tail" && !at;
        const current = f.stage === s.id;
        const cls = na ? "is-na" : current ? "is-current" : at ? "is-reached" : "is-pending";
        const status = na ? "해당 없음(tail: 직접 배정)" : at ? `${current ? "지금 단계 · " : ""}${clock(at)} (${timeAgo(at, now)})` : "아직";
        return (
          <li key={s.id} className={cls} title={`${s.name}: ${status}`} aria-current={current ? "step" : undefined}>
            <span className="ff-st-long" aria-hidden="true">
              {na ? "—" : s.name}
            </span>
            <span className="ff-st-short" aria-hidden="true">
              {na ? "—" : s.short}
            </span>
            <span className="ff-sr">
              {s.name}: {status}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
