import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { DemandRow, FleetPlanKind, FleetProposal, PlanReason, StepResult } from "../../../server/fleet-plan.ts";
import { accountViewOf, ACCOUNT_EFFECT } from "../../../server/control-view.ts";
import { type FuelRemaining, fuelLabel, fuelTitle } from "../../../server/fuel-remaining.ts";
import { flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import "./FleetPlan.css";
import { apiGet, apiSend } from "../api.ts";

// FLEET PLAN(docs/fleet.md 8.6·8.7): atc가 수요·활주로·예비를 보고 LAUNCH·ENTRY·STOP·RESTART·REFRESH·ACCOUNT CHANGE·AOG·RETIRE·RETURN을 제안한다.
// 그림자: SUPERVISOR는 동의·반대만 한다. 승인 운용: 승인(실행)하면 카드의 버튼과 같은 코드로 바로 실행한다.

type Open = FleetProposal & { now: PlanReason[] | null; stale: boolean };
interface PlanBrief {
  mode: "shadow" | "approval";
  approvalSince: string | null;
  background: { count: number | null; max: number };
  permissionModes: string[];
  config: { reserve: number; waitMin: number; idleHours: number; restartDays: number; retireDays: number; minDwellMin: number; refreshTokens?: number; refreshPct?: number };
  reposition?: { mode: "off" | "shadow" | "approval" | "auto"; dailyMax: number; movedToday: number }; // REPOSITION(ATC-179). 옛 서버면 없음
  ranAt: string | null;
  error: string | null;
  demand: DemandRow[];
  fuel?: FuelRemaining[]; // ACCOUNT마다 FUEL REMAINING(ATC-63, 옛 서버면 없음)
  open: Open[];
  waiting: { key: string; kind: FleetPlanKind; aircraft: string | null; airport: string | null; since: string | null }[];
  recent: FleetProposal[];
  gate: { decided: number; agreed: number; agreement: number | null; target: { decided: number; agreement: number }; ready: boolean };
  judges?: { report: { judged: number; marked: number; right: number; rate: number | null } }; // REPORT 판정(ATC-89, 그림자). 옛 서버면 없음
}

const KIND_HELP: Record<FleetPlanKind, string> = {
  LAUNCH: "운항하지 않는 등록 AIRCRAFT의 세션을 띄운다(예비 승무원 호출)",
  ENTRY: "맞는 AIRCRAFT가 없어 새로 들이고 띄운다(wet lease)",
  STOP: "쉬는 백그라운드 세션을 멈춘다(주기). 대화는 남는다",
  RESTART: "오래된 백그라운드 세션을 새 CREW BRIEFING으로 다시 띄운다(정기 점검)",
  REFRESH: "FLIGHT를 마치고 쉬는 AIRCRAFT의 큰 대화를 새로 시작한다(다음 cold wake의 캐시 쓰기를 아낌)",
  "ACCOUNT CHANGE": "FLIGHT 사이의 AIRCRAFT를 사용 한도가 남은 ACCOUNT로 옮긴다(멈추고 그 ACCOUNT에서 다시 띄움). 진행 중인 FLIGHT는 옮기지 않는다",
  REPOSITION: "쉬는 AIRCRAFT의 base를 FLIGHT가 기다리는데 AIRCRAFT가 없는 AIRPORT로 옮긴다(멈추고 base를 바꿔 그 AIRPORT 저장소에서 다시 띄움). 진행 중인 FLIGHT는 옮기지 않는다",
  AOG: "기한을 두고 배정을 멈춘다(MEL)",
  RETIRE: "퇴역(SUPERVISOR만, 자동 없음)",
  RETURN: "FLEET PLAN이 건 AOG를 푼다(기한이 지남)",
};
// 승인하면 하는 일(양식에 보인다)
export const WILL_DO: Record<FleetPlanKind, (p: FleetProposal) => string> = {
  LAUNCH: (p) => `${p.aircraft}를 ${p.airport ?? "base"} 저장소에서 백그라운드 세션으로 띄우고 CREW BRIEFING을 넣는다`,
  ENTRY: (p) => `${p.aircraft}를 ${p.configuration ?? ""} CONFIGURATION으로 ${p.airport ?? ""}에 들인 뒤 띄운다`,
  STOP: (p) => `${p.aircraft}의 백그라운드 세션을 멈춘다(대화는 남는다)`,
  RESTART: (p) => `${p.aircraft}의 백그라운드 세션을 멈추고 새 CREW BRIEFING으로 다시 띄운다`,
  REFRESH: (p) => `${p.aircraft}의 백그라운드 세션을 멈추고 새 CREW BRIEFING으로 다시 띄운다(대화를 새로 시작)`,
  "ACCOUNT CHANGE": (p) => `${p.aircraft}의 백그라운드 세션을 멈추고 ACCOUNT ${p.account ?? "?"}에서 CREW BRIEFING으로 다시 띄운다(home ACCOUNT는 그대로, 캐시는 새로 시작)`,
  REPOSITION: (p) => `${p.aircraft}의 백그라운드 세션을 멈추고 base를 ${p.from ?? "?"} → ${p.airport ?? "?"}로 바꾼 뒤 ${p.airport ?? "?"} 저장소에서 CREW BRIEFING으로 다시 띄운다(캐시는 새로 시작, 그 저장소의 CLAUDE.md)`,
  AOG: (p) => `${p.aircraft}를 AOG로 둔다(사유 FLEET PLAN ${p.id})`,
  RETIRE: (p) => `${p.aircraft}를 퇴역시킨다`,
  RETURN: (p) => `${p.aircraft}의 AOG를 푼다`,
};
const STATUS: Record<FleetProposal["status"], string> = {
  open: "열림",
  agreed: "동의",
  disagreed: "반대",
  expired: "조건 풀림",
  superseded: "바뀜",
  executing: "실행 중",
  executed: "실행함",
  failed: "실행 실패",
};

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
// 사유 안의 FLIGHT key를 FLIGHT NUMBER로
const withFlights = (text: string) => text.replace(/\b([A-Z]{2,5}-\d+)\b/g, (k) => flightNumber(k));
// 사람이 하는 제안: 데스크톱·터미널 세션의 REFRESH(/clear 뒤 CREW BRIEFING). 승인 운용에서도 "했음"(동의)으로 닫는다
export const isManual = (p: FleetProposal) => p.kind === "REFRESH" && p.reasons.some((r) => r.code === "session" && r.value === "interactive");
const kTokens = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`);
const stepText = (x: StepResult) => `${x.action} ${x.registration}${x.jobId ? ` (${x.jobId})` : ""}${x.ok ? "" : ` 실패: ${x.error ?? ""}`}`;

async function post(path: string, body: unknown) {
  const res = await apiSend("POST", path, body);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) {
    const failed = (data.steps as StepResult[] | undefined)?.find((x) => !x.ok);
    throw new Error(data.error ?? (failed ? stepText(failed) : `HTTP ${res.status}`));
  }
  return data;
}

// fleetAccounts: FLEET 응답의 fuelAccounts. ACCOUNT는 FLEET의 FUEL 블록 하나에서 보이고(ATC-132), 이 줄은 그 블록이 없는 옛 서버일 때만 대신 보인다
export function FleetPlan({ refreshKey, onChanged, fleetAccounts }: { refreshKey: string; onChanged?: () => void; fleetAccounts?: readonly unknown[] | null }) {
  const [brief, setBrief] = useState<PlanBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet("/api/fleet/plan");
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

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      await load();
    }
  };

  const judge = (p: Open, verdict: "agree" | "disagree") => {
    let reason = "";
    if (verdict === "disagree") {
      const r = prompt(`${p.id} ${p.kind} ${p.aircraft ?? ""}에 ${brief?.mode === "approval" ? "거절" : "반대"}합니다. 이유(선택)는?`);
      if (r === null) return;
      reason = r;
    }
    return run(p.id, () => post(`/api/fleet/plan/${encodeURIComponent(p.id)}/verdict`, { verdict, reason }));
  };

  // CREW BRIEFING을 클립보드로(데스크톱·터미널 세션의 REFRESH: /clear 뒤 붙여 넣는다)
  const [copied, setCopied] = useState<string | null>(null);
  const copyBriefing = (p: Open) =>
    run(p.id, async () => {
      const res = await apiGet(`/api/fleet/${encodeURIComponent(p.aircraft ?? "")}/briefing`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!navigator.clipboard) throw new Error("클립보드를 쓸 수 없음 — FLEET 카드의 CREW BRIEFING을 연다");
      await navigator.clipboard.writeText(data.briefing);
      setCopied(p.id);
    });

  const approve = (p: Open, input: Record<string, unknown>) =>
    run(p.id, async () => {
      await post(`/api/fleet/plan/${encodeURIComponent(p.id)}/approve`, input);
      setApproving(null);
      onChanged?.();
    });

  const switchMode = (mode: "shadow" | "approval") => {
    const ask =
      mode === "approval"
        ? "승인 운용을 켤까요?\n\n승인(실행)을 누르면 FLEET 탭 버튼과 같은 코드로 곧바로 세션을 띄우고 멈추거나 프로필을 바꿉니다. 제안마다 SUPERVISOR가 하나씩 승인합니다."
        : "그림자로 돌릴까요? 제안은 계속 나오고, 동의·반대만 합니다.";
    if (!confirm(ask)) return;
    return run("mode", () => post("/api/fleet/plan/mode", { mode }));
  };

  if (!brief) return error ? <p className="fl-error">FLEET PLAN을 불러오지 못함: {error}</p> : null;
  const g = brief.gate;
  const approval = brief.mode === "approval";
  const demand = brief.demand.filter((d) => d.served || d.unserved.length || d.blocked);

  return (
    <section className="fp" aria-labelledby="fp-title">
      <h2 className="label fp-title" id="fp-title">
        FLEET PLAN <span className={`fp-mode${approval ? " is-approval" : ""}`}>{approval ? "APPROVAL" : "SHADOW"}</span>
        <em>
          {approval
            ? "승인(실행)하면 카드의 버튼과 같은 코드로 바로 실행한다. 제안마다 하나씩"
            : "atc가 제안하고 SUPERVISOR는 동의·반대만 한다. 세션을 띄우거나 멈추는 것은 카드의 버튼으로"}
        </em>
      </h2>
      <p className="fp-meta faint">
        <span className={g.ready ? "fp-ready" : undefined} title="DISPATCH·SCHEDULE과 같은 그림자 게이트. 넘어야 승인 운용을 켤 수 있다">
          판정 {g.decided}/{g.target.decided} · 합의 {pct(g.agreement)} (목표 {pct(g.target.agreement)}){g.ready ? " · 게이트 통과" : ""}
        </span>
        {brief.judges && brief.judges.report.judged > 0 && (
          <span title="Jev가 CAPTAIN의 마지막 메시지를 분류한 것을 SUPERVISOR가 맞다·틀리다고 표시한 것(FLEET 카드의 JEV REPORT 줄). 게이트에 세지 않음">
            {" · "}JEV REPORT 맞음 {brief.judges.report.right}/{brief.judges.report.marked} {pct(brief.judges.report.rate)} (판정 {brief.judges.report.judged}턴)
          </span>
        )}
        {approval && brief.approvalSince && <> · 승인 운용 {timeAgo(brief.approvalSince, Date.now())}부터</>}
        {" · "}
        {brief.ranAt ? <>계산 {timeAgo(brief.ranAt, Date.now())}</> : "아직 계산 전(DISPATCH 주기 5분)"}
        {" · "}예비 {brief.config.reserve} · 대기 {brief.config.waitMin}분 · 유휴 {brief.config.idleHours}h · RESTART {brief.config.restartDays}일
        {brief.config.refreshTokens != null && <> · REFRESH {kTokens(brief.config.refreshTokens)} 또는 창의 {Math.round((brief.config.refreshPct ?? 0) * 100)}%</>} · 퇴역 {brief.config.retireDays}일
        {approval ? (
          <button className="fl-btn fp-switch" disabled={busy === "mode"} onClick={() => switchMode("shadow")}>
            그림자로 돌리기
          </button>
        ) : (
          <button
            className="fl-btn fp-switch"
            disabled={!g.ready || busy === "mode"}
            title={g.ready ? "승인 운용을 켠다" : `그림자 게이트를 넘어야 켤 수 있다(판정 ${g.target.decided}건, 합의 ${pct(g.target.agreement)})`}
            onClick={() => switchMode("approval")}
          >
            승인 운용 켜기
          </button>
        )}
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
      {accountViewOf(fleetAccounts, brief.fuel) === "plan" && <FuelLines accounts={brief.fuel ?? []} />}
      {brief.open.length ? (
        <ul className="fp-rows">
          {brief.open.map((p) => {
            // REPOSITION은 자기 스위치(approval·auto)로 승인한다(ATC-179), 나머지는 FLEET PLAN 모드
            const ap = p.kind === "REPOSITION" ? brief.reposition !== undefined && (brief.reposition.mode === "approval" || brief.reposition.mode === "auto") : approval;
            return (
            <li key={p.id} className={`fp-row k-${p.kind}`}>
              <div className="fp-head">
                <span className="fp-kind" title={KIND_HELP[p.kind]}>
                  {p.kind}
                </span>
                <b className="mono">{p.aircraft ?? "—"}</b>
                {p.configuration && <span className="faint">{p.configuration}</span>}
                {p.from && <span className="apt">{p.from} →</span>}
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
              {p.status === "executing" ? (
                <p className="fp-note">실행 중…</p>
              ) : approving === p.id ? (
                <ApproveForm p={p} brief={brief} busy={busy === p.id} onCancel={() => setApproving(null)} onApprove={(input) => approve(p, input)} />
              ) : (
                <>
                  {ap && p.stale && <p className="fp-note faint">조건이 바뀜 — 최근 주기가 이 제안을 더는 내지 않는다. 다음 주기를 기다린다</p>}
                  {ap && isManual(p) && (
                    <p className="fp-note">
                      atc는 실행하지 않는다. {p.aircraft} 세션에서 <code>/clear</code>하고 CREW BRIEFING을 붙여 넣은 뒤 "했음"
                    </p>
                  )}
                  <div className="fl-actions">
                    <button className="fl-btn" disabled={busy === p.id} onClick={() => judge(p, "disagree")}>
                      {ap ? "거절" : "반대"}
                    </button>
                    {isManual(p) && (
                      <button className="fl-btn" disabled={busy === p.id} onClick={() => copyBriefing(p)}>
                        {copied === p.id ? "복사함" : "CREW BRIEFING 복사"}
                      </button>
                    )}
                    {ap && isManual(p) ? (
                      <button className="fl-btn primary" disabled={busy === p.id} onClick={() => judge(p, "agree")}>
                        했음
                      </button>
                    ) : ap ? (
                      <button className="fl-btn primary" disabled={busy === p.id || p.stale} onClick={() => (setError(null), setApproving(p.id))}>
                        승인(실행)
                      </button>
                    ) : (
                      <button className="fl-btn primary" disabled={busy === p.id} onClick={() => judge(p, "agree")}>
                        동의
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
            );
          })}
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
                {p.execution && p.execution.steps.length > 0 && <span className="faint"> — {p.execution.steps.map(stepText).join(" → ")}</span>}
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

// 승인 양식: 무엇을 실행하는지와 종류별 선택지(8.7)
function ApproveForm({
  p,
  brief,
  busy,
  onCancel,
  onApprove,
}: {
  p: Open;
  brief: PlanBrief;
  busy: boolean;
  onCancel: () => void;
  onApprove: (input: Record<string, unknown>) => void;
}) {
  const relaunch = p.kind === "RESTART" || p.kind === "REFRESH" || p.kind === "ACCOUNT CHANGE" || p.kind === "REPOSITION";
  const launches = p.kind === "LAUNCH" || p.kind === "ENTRY" || relaunch;
  // RESTART·REFRESH는 비워 두면 서버가 마지막 LAUNCH의 값을 쓴다. 나머지는 auto(SUPERVISOR 결정)
  const [permissionMode, setPermissionMode] = useState(relaunch ? "" : (brief.permissionModes[0] ?? "auto"));
  const [model, setModel] = useState("");
  const [until, setUntil] = useState(String(p.reasons.find((r) => r.code === "until")?.value ?? ""));
  const [stopSession, setStopSession] = useState(true);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input: Record<string, unknown> = {};
    if (launches && permissionMode) input.permissionMode = permissionMode;
    if (launches && model.trim()) input.model = model.trim();
    if (p.kind === "AOG") input.until = until.trim() || null;
    if (p.kind === "RETIRE") input.stopSession = stopSession;
    onApprove(input);
  };
  return (
    <form className="fp-approve" onSubmit={submit} aria-label={`${p.id} 승인`}>
      <p className="fp-note">{WILL_DO[p.kind](p)}</p>
      {launches && (
        <>
          <label>
            permission mode{" "}
            <select className="fl-input" value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)} aria-label="permission mode">
              {relaunch && <option value="">마지막 LAUNCH와 같게</option>}
              {brief.permissionModes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            모델{" "}
            <input className="fl-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={relaunch ? "마지막 LAUNCH와 같게" : "기본값"} aria-label="모델" />
          </label>
          {brief.background.count !== null && (
            <p className="fp-note faint">
              백그라운드 세션 {brief.background.count}/{brief.background.max}. 세션은 사용량 한도를 쓴다.
            </p>
          )}
        </>
      )}
      {p.kind === "AOG" && (
        <label>
          해제 예정일{" "}
          <input className="fl-input" value={until} onChange={(e) => setUntil(e.target.value)} placeholder="YYYY-MM-DD" aria-label="해제 예정일" />
        </label>
      )}
      {p.kind === "RETIRE" && (
        <label className="fl-check">
          <input type="checkbox" checked={stopSession} onChange={(e) => setStopSession(e.target.checked)} /> 백그라운드 세션도 멈춤
        </label>
      )}
      <div className="fl-actions">
        <button type="button" className="fl-btn" onClick={onCancel}>
          취소
        </button>
        <button type="submit" className="fl-btn primary" disabled={busy}>
          {busy ? "실행하는 중…" : "승인(실행)"}
        </button>
      </div>
    </form>
  );
}

// FUEL(ATC-63, "weekly-usage line"): ACCOUNT마다 가장 많이 쓴 창과 reset, 구성원. hold 수준이면 그 ACCOUNT로는 LAUNCH·ENTRY를 내지 않는다
const FUEL_EFFECT = ACCOUNT_EFFECT;
function FuelLines({ accounts }: { accounts: FuelRemaining[] }) {
  if (!accounts.length) return null;
  const now = Date.now();
  return (
    <ul className="fp-fuel" aria-label="ACCOUNT별 FUEL">
      {accounts.map((f) => (
        <li key={f.group} title={fuelTitle(f, now)}>
          <span className="mono">{f.account ?? `${f.control.length ? "control" : "AIRCRAFT"} ${f.control[0] ?? f.aircraft[0] ?? ""}`}</span>{" "}
          <span className={`fp-fuel-pct lv-${f.level}`}>{fuelLabel(f, now)}</span>
          {FUEL_EFFECT[f.level] && <span className={`fp-fuel-effect lv-${f.level}`}> · {FUEL_EFFECT[f.level]}</span>}
          <span className="faint">
            {f.aircraft.length > 0 && <> · AIRCRAFT {f.aircraft.join(", ")}</>}
            {f.control.length > 0 && <> · control {f.control.join(", ")}</>}
          </span>
        </li>
      ))}
    </ul>
  );
}
