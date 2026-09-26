import { useCallback, useEffect, useState } from "react";
import type { DispatchConfig, Plan } from "../../../server/dispatch.ts";
import type { Proposal } from "../../../server/proposals.ts";
import { flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import { PriorityMark } from "../ui.tsx";
import "./Dispatch.css";

// 2단계 DISPATCH — 2a 그림자 운용. 제안은 화면에만 보이고 아무에게도 보내지 않는다.

interface FlightInfo {
  title: string;
  state: string;
  priority: number;
  project: string | null;
  url: string | null;
}

interface Brief {
  mode: DispatchConfig["mode"];
  at: string;
  plan: Plan;
  open: Proposal[];
  recent: Proposal[];
  flights: Record<string, FlightInfo>;
  gate: { decided: number; agreed: number; agreement: number | null; target: { decided: number; agreement: number }; ready: boolean };
  config: DispatchConfig;
}

const statusText: Record<Proposal["status"], string> = {
  proposed: "PROPOSED",
  agreed: "승인했을 것",
  disagreed: "거절했을 것",
  superseded: "SUPERSEDED",
  expired: "EXPIRED",
};

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function Dispatch({ refreshKey, now }: { refreshKey: string; now: number }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dispatch/brief");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBrief(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const verdict = async (p: Proposal, v: "agree" | "disagree") => {
    let reason: string | null = null;
    if (v === "disagree") {
      reason = prompt(`${p.id} 거절 사유(선택)`) ?? null;
      if (reason === null && !confirm("사유 없이 거절로 기록할까요?")) return;
    }
    try {
      await post(`/api/dispatch/proposals/${p.id}/verdict`, { verdict: v, reason });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!brief) return <p className="empty">{error ? `불러오지 못함: ${error}` : "불러오는 중…"}</p>;
  const { plan, gate, flights } = brief;
  const assign = brief.open.filter((p) => p.kind === "ASSIGN");
  const release = brief.open.filter((p) => p.kind === "RELEASE");

  return (
    <section className="dispatch">
      <div className="toolbar">
        <span className="muted">
          <span className={`dp-mode m-${brief.mode}`}>{brief.mode === "shadow" ? "SHADOW" : "APPROVAL"}</span> 5분마다 계획
          {brief.mode === "shadow" && " · 아무에게도 보내지 않음"} · 계산 {timeAgo(brief.at, now)}
        </span>
      </div>
      {error && (
        <p className="dp-error" role="alert">
          {error}
        </p>
      )}

      <Gate gate={gate} />

      <div className="dp-slots" aria-label="슬롯">
        {plan.slots.map((s) => (
          <span key={s.airport} className="dp-slot">
            <b>{s.airport}</b> AIRBORNE {s.airborne} + 계획 {s.planned} / {s.limit}
          </span>
        ))}
        <span className="dp-slot">
          열린 ASSIGN {assign.length} / {brief.config.slots.openProposals}
        </span>
        <span className="dp-slot">
          열린 RELEASE {release.length} / {brief.config.slots.openReleases}
        </span>
      </div>

      <h2 className="label">
        ASSIGN <em>FLIGHT → AIRCRAFT</em>
      </h2>
      {assign.length ? (
        <div className="dp-cards">
          {assign.map((p) => (
            <Card key={p.id} p={p} flight={flights[p.flight]} now={now} onVerdict={verdict} />
          ))}
        </div>
      ) : (
        <p className="empty">열린 ASSIGN 제안 없음 — 배정할 수 있는 AIRCRAFT나 FLIGHT가 없거나 슬롯이 찼다.</p>
      )}

      <h2 className="label">
        RELEASE <em>STAND 없이 {brief.config.releaseDays}일 넘게 ENROUTE</em>
      </h2>
      {release.length ? (
        <div className="dp-cards">
          {release.map((p) => (
            <Card key={p.id} p={p} flight={flights[p.flight]} now={now} onVerdict={verdict} />
          ))}
        </div>
      ) : (
        <p className="empty">열린 RELEASE 제안 없음</p>
      )}

      <div className="dp-grid">
        <div>
          <h2 className="label">AIRCRAFT</h2>
          <ul className="dp-list">
            {[...plan.aircraft].sort((a, b) => Number(b.available) - Number(a.available) || a.callsign.localeCompare(b.callsign)).map((a) => (
              <li key={a.id} className={a.available ? "is-available" : ""}>
                <b>{a.callsign}</b> <span className="faint">{a.name}</span>
                <span className="dp-list-note">{a.available ? `가능 · ${a.reason}` : a.reason}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="label">HOLD_DEPARTURE · 제외</h2>
          <ul className="dp-list">
            {plan.hold.map((h) => (
              <li key={h.flight}>
                <b>{flightNumber(h.flight)}</b>
                <span className="dp-list-note">HOLD_DEPARTURE — {h.blockedBy.map(flightNumber).join(", ")}에 막힘</span>
              </li>
            ))}
            {plan.excluded.map((e) => (
              <li key={e.flight}>
                <b>{flightNumber(e.flight)}</b>
                <span className="dp-list-note">{e.reason}</span>
              </li>
            ))}
            {!plan.hold.length && !plan.excluded.length && <li className="faint">없음</li>}
          </ul>
        </div>
      </div>

      <h2 className="label">
        RECENT <em>최근 7일</em>
      </h2>
      {brief.recent.length ? (
        <table className="dp-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>종류</th>
              <th>FLIGHT</th>
              <th>AIRCRAFT</th>
              <th>결과</th>
              <th>사유</th>
              <th>언제</th>
            </tr>
          </thead>
          <tbody>
            {brief.recent.map((p) => (
              <tr key={p.id} className={`s-${p.status}`}>
                <td className="mono">{p.id}</td>
                <td className="mono">{p.kind}</td>
                <td className="mono">{flightNumber(p.flight)}</td>
                <td>{p.aircraftName ?? "—"}</td>
                <td className="dp-result">{statusText[p.status]}</td>
                <td className="dp-reason">{p.reason ?? "—"}</td>
                <td className="faint">{timeAgo(p.decidedAt ?? p.at, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty">아직 결정된 제안 없음</p>
      )}
    </section>
  );
}

function Gate({ gate }: { gate: Brief["gate"] }) {
  const enough = gate.decided >= gate.target.decided;
  const rateOk = gate.agreement !== null && gate.agreement >= gate.target.agreement;
  const rows = [
    {
      label: "결정한 제안",
      value: `${gate.decided}건`,
      target: `≥ ${gate.target.decided}건`,
      state: enough ? "pass" : "fail",
    },
    {
      label: "합의율(승인했을 것 비율)",
      value: gate.agreement === null ? "—" : `${Math.round(gate.agreement * 100)}%`,
      target: `≥ ${gate.target.agreement * 100}%`,
      state: gate.decided < 5 ? "insufficient" : rateOk ? "pass" : "fail",
    },
  ] as const;
  const mark = { pass: "✓ 충족", fail: "✗ 미달", insufficient: "○ 데이터 부족" } as const;
  return (
    <div className="dp-gate">
      <h2 className="label">
        STAGE 2b <em>승인 운용 진입 점검 · {gate.ready ? "준비됨" : "아직"}</em>
      </h2>
      <ul>
        {rows.map((r) => (
          <li key={r.label} className={`s-${r.state}`}>
            <span className="dp-gate-label">{r.label}</span>
            <span className="dp-gate-value">{r.value}</span>
            <span className="dp-gate-target">기준 {r.target}</span>
            <span className="dp-gate-state">{mark[r.state]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({
  p,
  flight,
  now,
  onVerdict,
}: {
  p: Proposal;
  flight: FlightInfo | undefined;
  now: number;
  onVerdict: (p: Proposal, v: "agree" | "disagree") => void;
}) {
  const max = Math.max(1, ...p.factors.map((f) => Math.abs(f.points)));
  return (
    <article className={`dp-card k-${p.kind}${p.caution ? " is-caution" : ""}`}>
      <header className="dp-card-head">
        <span className="dp-kind">{p.kind}</span>
        <span className="mono faint">{p.id}</span>
        <span className="faint dp-age">{timeAgo(p.at, now)}</span>
      </header>
      <div className="dp-flight">
        <a className="mono dp-fn" href={flight?.url ?? undefined} target="_blank" rel="noreferrer" title={p.flight}>
          {flightNumber(p.flight)}
        </a>
        {flight && <PriorityMark priority={flight.priority} />}
        <span className="dp-title">{flight?.title ?? p.flight}</span>
      </div>
      <div className="dp-target">
        {p.kind === "ASSIGN" ? (
          <>
            → <b>{p.aircraftName}</b> <span className="apt">{p.airport}</span>
          </>
        ) : (
          <>Todo로 되돌릴지 확인 {flight && <span className="faint">· 지금 {flight.state}</span>}</>
        )}
        <span className="dp-score" title="점수">
          {p.score}
        </span>
      </div>
      <table className="dp-factors">
        <tbody>
          {p.factors.map((f) => (
            <tr key={f.id}>
              <td>{f.label}</td>
              <td className="dp-factor-detail">{f.detail}</td>
              <td className="dp-factor-bar" aria-hidden>
                <span className={f.points < 0 ? "neg" : ""} style={{ width: `${(Math.abs(f.points) / max) * 100}%` }} />
              </td>
              <td className="num">{f.points > 0 ? `+${f.points}` : f.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(p.note || p.caution) && (
        <p className="dp-note">
          {p.caution && <span className="dp-caution">CAUTION</span>} {p.note}
        </p>
      )}
      <div className="dp-actions">
        <button className="dp-btn agree" onClick={() => onVerdict(p, "agree")}>
          승인했을 것
        </button>
        <button className="dp-btn disagree" onClick={() => onVerdict(p, "disagree")}>
          거절했을 것
        </button>
      </div>
    </article>
  );
}
