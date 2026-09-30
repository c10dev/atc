import { useEffect, useState } from "react";

// LAUNCH ACCOUNT APPLY NOW(ATC-244, docs/accounts.md): 설정 창 ACCOUNTS와 FLEET 머리글이 같이 쓴다.
// 눌러도 바로 옮기지 않는다: 지금 계획을 새로 읽어 행동별로 보이고, 확인해야 STOP → LAUNCH를 한다(SUPERVISOR만, 서버가 이 화면 Origin·JSON을 본다).
type Action = "move-now" | "after-flight" | "wait-safe" | "skip";
interface Row {
  kind: "aircraft" | "control";
  name: string;
  from: string | null;
  to: string;
  action: Action;
  reason: string;
}
interface Launch {
  aircraft: string | null;
  control: string | null;
}
interface PlanView {
  launchAccount: Launch;
  rows: Row[];
  pending: (Launch & { at: string | null }) | null;
  running: boolean;
}
interface Outcome {
  ok: boolean;
  error?: string;
  rows: Row[];
  results: Record<string, { ok: boolean; error?: string }>;
  stoppedAt: string | null;
  counts: { moved: number; failed: number; waiting: number; skipped: number };
}

const GROUPS: { action: Action; title: string; note: string }[] = [
  { action: "move-now", title: "지금 옮김", note: "쉬는 AIRCRAFT(FLIGHT·점유·PR 없음), 안전한 순간의 관제 세션" },
  { action: "after-flight", title: "FLIGHT 뒤에 옮김", note: "기다린다 — 끝나면 자동으로(설정이 바뀌거나 24시간이 지날 때까지)" },
  { action: "wait-safe", title: "안전한 순간을 기다림", note: "1분마다 다시 본다(24시간까지)" },
  { action: "skip", title: "옮기지 않음", note: "" },
];
const who = (r: Row) => `${r.kind === "control" ? "관제 " : ""}${r.name}`;

export function ApplyNow({ refreshKey, onDone, compact = false }: { refreshKey?: unknown; onDone?: () => void; compact?: boolean }) {
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<PlanView["pending"]>(null);
  const read = async () => {
    const r = await fetch("/api/fleet/apply-now");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as PlanView;
  };
  // 기다리는 APPLY만 가볍게 본다(계획은 누를 때 읽는다)
  useEffect(() => {
    let alive = true;
    read()
      .then((p) => alive && setPending(p.pending))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  const show = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const p = await read();
      setPlan(p);
      setPending(p.pending);
      setOpen(true);
    } catch (e) {
      setError(`계획을 읽지 못함: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fleet/apply-now", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true, launchAccount: plan.launchAccount }) });
      const body = (await res.json().catch(() => ({}))) as Outcome & { pending?: PlanView["pending"] };
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setOutcome(body);
        setPending(body.pending ?? null);
        onDone?.();
      }
    } catch {
      setError("서버에 연결할 수 없음");
    } finally {
      setBusy(false);
    }
  };
  const cancelPending = async () => {
    setBusy(true);
    try {
      await fetch("/api/fleet/apply-now/pending", { method: "DELETE", headers: { "Content-Type": "application/json" } });
      setPending(null);
    } finally {
      setBusy(false);
    }
  };
  const movable = plan?.rows.filter((r) => r.action === "move-now").length ?? 0;
  const waiting = plan?.rows.filter((r) => r.action === "after-flight" || r.action === "wait-safe").length ?? 0;
  return (
    <div className={`apply-now${compact ? " is-compact" : ""}`}>
      <button type="button" className="config-btn" disabled={busy} onClick={() => void show()} aria-expanded={open}>
        {busy && !open ? "읽는 중…" : "APPLY NOW"}
      </button>
      {pending && (
        <span className="settings-hint">
          {" "}
          기다리는 APPLY: {[pending.aircraft && `AIRCRAFT → ${pending.aircraft}`, pending.control && `관제 → ${pending.control}`].filter(Boolean).join(", ")}{" "}
          <button type="button" className="config-btn" disabled={busy} onClick={() => void cancelPending()}>
            취소
          </button>
        </span>
      )}
      {error && <span className="settings-hint acct-err"> {error}</span>}
      {open && plan && (
        <div className="apply-now-panel" role="group" aria-label="APPLY NOW 확인">
          {plan.rows.length === 0 ? (
            <p className="settings-hint">옮길 세션이 없다 — 돌고 있는 세션이 모두 LAUNCH ACCOUNT에 있거나, LAUNCH ACCOUNT가 “각 home”이다.</p>
          ) : (
            <>
              <p className="settings-hint">
                LAUNCH ACCOUNT(AIRCRAFT {plan.launchAccount.aircraft ?? "각 home"}, 관제 {plan.launchAccount.control ?? "각 home"})로 STOP → LAUNCH한다. 옮긴 세션은 <strong>캐시 없이</strong> 시작한다(FUEL 비용: ACCOUNT마다 캐시가 다르다). FLIGHT 중인 AIRCRAFT와 열린 PR이 있는 AIRCRAFT는 멈추지 않는다.
              </p>
              {GROUPS.map((g) => {
                const rows = plan.rows.filter((r) => r.action === g.action);
                if (!rows.length) return null;
                return (
                  <div key={g.action} className="apply-now-group">
                    <h5 className="label">
                      {g.title} <em>{rows.length}</em> <span className="faint">{g.note}</span>
                    </h5>
                    <ul>
                      {rows.map((r) => {
                        const res = outcome?.results[`${r.kind}|${r.name}`];
                        return (
                          <li key={`${r.kind}|${r.name}`}>
                            <span className="mono">{who(r)}</span> {r.from ?? "?"} → {r.to} <span className="faint">— {r.reason}</span>
                            {res && <span className={res.ok ? "" : "acct-err"}> · {res.ok ? "옮김" : `실패: ${res.error ?? "?"}`}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              <p className="settings-hint">DUTY는 멈추지 않는다 — DUTY의 ACCOUNT는 자기 블록에서 바꾼다(다음 SHIFT부터 적용).</p>
            </>
          )}
          {outcome && (
            <p className={`settings-hint${outcome.stoppedAt ? " acct-err" : ""}`}>
              {outcome.stoppedAt ? "첫 실패에서 멈췄다 — 나머지는 옛 ACCOUNT에서 그대로 돈다. " : ""}옮김 {outcome.counts.moved} · 실패 {outcome.counts.failed} · 기다림 {outcome.counts.waiting} · 건너뜀 {outcome.counts.skipped}
            </p>
          )}
          <div className="acct-edit">
            {!outcome && (
              <button type="button" className="config-btn is-primary" disabled={busy || plan.running || (movable === 0 && waiting === 0)} onClick={() => void apply()}>
                {busy ? "옮기는 중…(세션마다 한 번에 하나)" : `확인 — 지금 ${movable}개 옮기고 ${waiting}개는 기다린다`}
              </button>
            )}
            <button type="button" className="config-btn" disabled={busy} onClick={() => setOpen(false)}>
              {outcome ? "닫기" : "취소"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
