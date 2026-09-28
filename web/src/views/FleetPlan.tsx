import { useCallback, useEffect, useState } from "react";
import type { DemandRow, FleetPlanKind, FleetProposal, PlanReason } from "../../../server/fleet-plan.ts";
import { flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import "./FleetPlan.css";

// FLEET PLAN(docs/fleet.md 8.6): atc가 수요·활주로·예비를 보고 LAUNCH·ENTRY·STOP·RESTART·AOG·RETIRE를 제안한다.
// 그림자: SUPERVISOR는 동의·반대만 하고, 세션을 띄우거나 멈추는 것은 카드의 버튼으로 따로 한다.

type Open = FleetProposal & { now: PlanReason[] | null };
interface PlanBrief {
  mode: "shadow";
  config: { reserve: number; waitMin: number; idleHours: number; restartDays: number; retireDays: number; minDwellMin: number };
  ranAt: string | null;
  error: string | null;
  demand: DemandRow[];
  open: Open[];
  waiting: { key: string; kind: FleetPlanKind; aircraft: string | null; airport: string | null; since: string | null }[];
  recent: FleetProposal[];
  gate: { decided: number; agreed: number; agreement: number | null; target: { decided: number; agreement: number }; ready: boolean };
}

const KIND_HELP: Record<FleetPlanKind, string> = {
  LAUNCH: "운항하지 않는 등록 AIRCRAFT의 세션을 띄운다(예비 승무원 호출)",
  ENTRY: "맞는 AIRCRAFT가 없어 새로 들이고 띄운다(wet lease)",
  STOP: "쉬는 백그라운드 세션을 멈춘다(주기). 대화는 남는다",
  RESTART: "오래된 백그라운드 세션을 새 CREW BRIEFING으로 다시 띄운다(정기 점검)",
  AOG: "기한을 두고 배정을 멈춘다(MEL)",
  RETIRE: "퇴역(SUPERVISOR만, 자동 없음)",
};
const STATUS: Record<FleetProposal["status"], string> = { open: "열림", agreed: "동의", disagreed: "반대", expired: "조건 풀림", superseded: "바뀜" };

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
// 사유 안의 FLIGHT key를 FLIGHT NUMBER로
const withFlights = (text: string) => text.replace(/\b([A-Z]{2,5}-\d+)\b/g, (k) => flightNumber(k));

export function FleetPlan({ refreshKey }: { refreshKey: string }) {
  const [brief, setBrief] = useState<PlanBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/plan");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBrief(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const judge = async (p: Open, verdict: "agree" | "disagree") => {
    let reason = "";
    if (verdict === "disagree") {
      const r = prompt(`${p.id} ${p.kind} ${p.aircraft ?? ""}에 반대합니다. 이유(선택)는?`);
      if (r === null) return;
      reason = r;
    }
    setBusy(p.id);
    try {
      const res = await fetch(`/api/fleet/plan/${encodeURIComponent(p.id)}/verdict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, reason }),
      });
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!brief) return error ? <p className="fl-error">FLEET PLAN을 불러오지 못함: {error}</p> : null;
  const g = brief.gate;
  const demand = brief.demand.filter((d) => d.served || d.unserved.length || d.blocked);

  return (
    <section className="fp" aria-labelledby="fp-title">
      <h2 className="label fp-title" id="fp-title">
        FLEET PLAN <span className="fp-mode">SHADOW</span>
        <em>atc가 제안하고 SUPERVISOR는 동의·반대만 한다. 세션을 띄우거나 멈추는 것은 카드의 버튼으로</em>
      </h2>
      <p className="fp-meta faint">
        <span className={g.ready ? "fp-ready" : undefined} title="DISPATCH·SCHEDULE과 같은 그림자 게이트. 넘으면 승인 운용(3단계)을 켤 수 있다">
          판정 {g.decided}/{g.target.decided} · 합의 {pct(g.agreement)} (목표 {pct(g.target.agreement)}){g.ready ? " · 게이트 통과" : ""}
        </span>
        {" · "}
        {brief.ranAt ? <>계산 {timeAgo(brief.ranAt, Date.now())}</> : "아직 계산 전(DISPATCH 주기 5분)"}
        {" · "}예비 {brief.config.reserve} · 대기 {brief.config.waitMin}분 · 유휴 {brief.config.idleHours}h · RESTART {brief.config.restartDays}일 · 퇴역 {brief.config.retireDays}일
      </p>
      {(error || brief.error) && (
        <p className="fl-error" role="alert">
          {error ?? `계산 실패: ${brief.error}`}
        </p>
      )}
      {demand.length > 0 && (
        <ul className="fp-demand" aria-label="AIRPORT별 수요">
          {demand.map((d) => (
            <li key={d.airport}>
              <span className="apt">{d.airport}</span> 배정 {d.served} · 받을 곳 없음 <b className={d.unserved.length ? "fp-short" : undefined}>{d.unserved.length}</b> · PARKED {d.parked}
              {d.unserved.length > 0 && <span className="faint"> ({d.unserved.map(flightNumber).join(", ")})</span>}
              {d.blocked && <span className="fp-blocked"> — {d.blocked}</span>}
            </li>
          ))}
        </ul>
      )}
      {brief.open.length ? (
        <ul className="fp-rows">
          {brief.open.map((p) => (
            <li key={p.id} className={`fp-row k-${p.kind}`}>
              <div className="fp-head">
                <span className="fp-kind" title={KIND_HELP[p.kind]}>
                  {p.kind}
                </span>
                <b className="mono">{p.aircraft ?? "—"}</b>
                {p.configuration && <span className="faint">{p.configuration}</span>}
                {p.airport && <span className="apt">{p.airport}</span>}
                <span className="faint mono">{p.id}</span>
                <span className="faint fp-age">{timeAgo(p.at, Date.now())}</span>
              </div>
              <ul className="fp-reasons">
                {(p.now ?? p.reasons).map((r, n) => (
                  <li key={n}>
                    <span className="fp-code">{r.code}</span> {withFlights(r.detail)}
                  </li>
                ))}
              </ul>
              <div className="fl-actions">
                <button className="fl-btn" disabled={busy === p.id} onClick={() => judge(p, "disagree")}>
                  반대
                </button>
                <button className="fl-btn primary" disabled={busy === p.id} onClick={() => judge(p, "agree")}>
                  동의
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="faint fp-empty">열린 제안 없음</p>
      )}
      {brief.waiting.length > 0 && (
        <p className="fp-waiting faint">
          지켜보는 중:{" "}
          {brief.waiting.map((w, n) => {
            const need = w.kind === "LAUNCH" || w.kind === "ENTRY" ? brief.config.waitMin : null;
            return (
              <span key={w.key}>
                {n > 0 && " · "}
                {w.kind} {w.aircraft ?? ""}
                {w.since && (need ? ` ${minutesSince(w.since)}/${need}분` : " 다음 주기에")}
              </span>
            );
          })}
        </p>
      )}
      {brief.recent.length > 0 && (
        <details className="fp-recent">
          <summary>최근 {brief.recent.length}건</summary>
          <ul>
            {brief.recent.map((p) => (
              <li key={p.id}>
                <span className="faint mono">{p.id}</span> <span className="fp-kind">{p.kind}</span> <span className="mono">{p.aircraft ?? "—"}</span>{" "}
                <span className={`fp-status st-${p.status}`}>{STATUS[p.status]}</span>
                {p.verdict?.reason && <span className="faint"> — {p.verdict.reason}</span>}
                {p.status === "superseded" && p.closeReason && <span className="faint"> → {p.closeReason}</span>}
                <span className="faint fp-age">{p.closedAt ? timeAgo(p.closedAt, Date.now()) : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
