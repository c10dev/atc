import { useCallback, useEffect, useState } from "react";
import { BULK_LABEL, type BulkOp, type BulkResult, type BulkRow, heldOf } from "../../../../server/control-bulk.ts";

// CONTROL SESSIONS 일괄 동작(ATC-255, docs/fleet.md 8.5.2). 계산은 server/control-bulk.ts(순수), 여기는 미리 보기·확인·결과를 그리기만 한다.
// 순서: 버튼 → 미리 보기(서버가 지금 사실로 계산, 읽기만) → 확인 한 번 → 실행. 실행은 화면이 미리 본 행동(expect)과 지금 계획이 같은 세션만 한다.

type Plan = { op: BulkOp; running: boolean; rows: BulkRow[]; drift: { name: string; from: string | null; to: string | null }[] };
type Done = { ok: boolean; done: number; failed: number; held: number; skipped: number; results: BulkResult[] };

const ACTION_TEXT: Record<string, string> = { launch: "LAUNCH", stop: "STOP", restart: "RESTART", skip: "—" };
const err = (x: unknown, fallback: string) => (x && typeof x === "object" && "error" in x && typeof (x as { error: unknown }).error === "string" ? (x as { error: string }).error : fallback);

export function BulkPanel({ op: first, onClose, onDone }: { op: BulkOp; onClose: () => void; onDone: () => Promise<void> | void }) {
  const [op, setOp] = useState<BulkOp>(first);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const preview = useCallback(async (o: BulkOp) => {
    setPlan(null);
    setError(null);
    setForce(false);
    try {
      const res = await fetch(`/api/control/bulk?op=${o}`);
      const body: unknown = await res.json().catch(() => ({}));
      if (res.ok) setPlan(body as Plan);
      else setError(err(body, `HTTP ${res.status}`));
    } catch {
      setError("서버에 연결할 수 없음");
    }
  }, []);
  useEffect(() => {
    void preview(op);
  }, [op, preview]);

  const todo = plan?.rows.filter((r) => r.action !== "skip") ?? [];
  const held = todo.filter(heldOf);
  const runnable = todo.filter((r) => force || !heldOf(r));

  const run = async () => {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      const expect = Object.fromEntries(plan.rows.map((r) => [r.name, r.action]));
      const res = await fetch("/api/control/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, expect, force }) });
      const body: unknown = await res.json().catch(() => ({}));
      if (res.status === 200 || (body && typeof body === "object" && "results" in body)) setDone(body as Done);
      else setError(err(body, `HTTP ${res.status}`));
    } catch {
      setError("서버에 연결할 수 없음");
    }
    await onDone();
    setBusy(false);
  };

  return (
    <section className="fl-bulk" aria-label={`${BULK_LABEL[op]} 미리 보기`}>
      <div className="fl-bulk-head">
        <h3 className="label">
          {BULK_LABEL[op]} <em>{done ? "결과" : "미리 보기"}</em>
        </h3>
        <button type="button" className="config-btn" onClick={onClose} disabled={busy}>
          닫기
        </button>
      </div>
      {error && (
        <p className="fl-c-warn is-error" role="alert">
          {error}
        </p>
      )}
      {!plan && !error && !done && <p className="settings-hint">불러오는 중…</p>}
      {done ? (
        <>
          <p className="fl-bulk-sum">
            <b>{done.ok ? "완료" : "실패 있음"}</b> · 한 것 {done.done} · 실패 {done.failed} · 안전 조건으로 보류 {done.held} · 건너뜀 {done.skipped} <span className="faint">— FLIGHT RECORDER에 control bulk 줄로 남았다</span>
          </p>
          <ul className="fl-bulk-rows">
            {done.results.map((r) => (
              <li key={r.name} className={`fl-bulk-row ${r.ok ? "is-ok" : r.held || r.skipped ? "is-held" : "is-fail"}`}>
                <b>{r.name}</b>
                <span className="mono">{ACTION_TEXT[r.action]}</span>
                <span>{r.ok ? `OK${r.jobId ? ` · ${r.jobId}` : ""}${r.to ? ` · ${r.to}` : ""}` : (r.skipped ?? r.error ?? "실패")}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        plan && (
          <>
            {plan.running && <p className="fl-c-warn is-error">다른 일괄 동작이 실행 중 — 끝난 뒤에 누른다</p>}
            {plan.drift.length > 0 && (
              <p className="fl-bulk-drift" role="status">
                <b>ACCOUNT drift</b> {plan.drift.map((d) => `${d.name} ${d.from} ≠ ${d.to}`).join(" · ")}{" "}
                {op !== "align" && (
                  <button type="button" className="config-btn" onClick={() => setOp("align")} disabled={busy}>
                    ALIGN만 보기
                  </button>
                )}
              </p>
            )}
            <ol className="fl-bulk-rows">
              {plan.rows.map((r) => (
                <li key={r.name} className={`fl-bulk-row${r.action === "skip" ? " is-skip" : heldOf(r) ? " is-held" : ""}`}>
                  <span className="mono faint">{r.order}</span>
                  <b>{r.name}</b>
                  <span className="mono">{ACTION_TEXT[r.action]}</span>
                  <span>
                    {r.reason}
                    {r.drift && <span className="fl-r-acct mono"> drift {r.from} → {r.to}</span>}
                    {heldOf(r) && <span className="is-error"> · 보류: {r.blocks.join("; ")}</span>}
                  </span>
                </li>
              ))}
            </ol>
            <p className="settings-hint">한 번에 한 세션씩 {op === "stop" ? "거꾸로(REVIEW → TOWER)" : "이 순서로(TOWER → REVIEW)"} 한다. 실패하면 {op === "stop" ? "나머지는 계속 내린다" : "나머지는 멈춘다"}.</p>
            {held.length > 0 && (
              <label className="fl-bulk-force">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={busy} /> 안전 조건을 알고도 진행({held.map((h) => h.name).join(", ")}) — 처리 중인 일을 잃을 수 있다
              </label>
            )}
            <div className="fl-c-actions">
              <button type="button" className={`config-btn ${op === "stop" ? "is-danger" : "is-primary"}`} onClick={() => void run()} disabled={busy || plan.running || runnable.length === 0}>
                {busy ? "실행 중…" : `${BULK_LABEL[op]} 실행 (${runnable.length}개)`}
              </button>
              {runnable.length === 0 && <span className="faint"> 할 것이 없다</span>}
            </div>
          </>
        )
      )}
    </section>
  );
}

// 그룹 머리 아래 버튼 줄. 눌러도 곧바로 하지 않고 미리 보기를 연다
export function BulkBar({ onOpen, disabled }: { onOpen: (op: BulkOp) => void; disabled: boolean }) {
  return (
    <div className="fl-bulk-bar" role="group" aria-label="CONTROL SESSIONS 일괄 동작">
      {(["launch", "restart", "stop"] as const).map((op) => (
        <button key={op} type="button" className={`config-btn${op === "stop" ? " is-danger" : ""}`} onClick={() => onOpen(op)} disabled={disabled}>
          {BULK_LABEL[op]}
        </button>
      ))}
      <button type="button" className="config-btn" onClick={() => onOpen("align")} disabled={disabled} title="ACCOUNT가 어긋난 세션만 intended ACCOUNT로 옮긴다">
        {BULK_LABEL.align}
      </button>
    </div>
  );
}

// 모든 관제 세션이 내려가 있을 때(호스트 재부팅 뒤 등)의 복구 배너
export function RecoveryBanner({ onLaunchAll }: { onLaunchAll?: () => void }) {
  return (
    <p className="fl-bulk-recovery" role="alert">
      <b>관제 세션이 하나도 떠 있지 않음</b> — 호스트가 재부팅됐거나 모두 멈췄다. TOWER → OCC → MCC → CROSSCHECK → REVIEW 순서로 띄운다.{" "}
      {onLaunchAll && (
        <button type="button" className="config-btn is-primary" onClick={onLaunchAll}>
          LAUNCH ALL 미리 보기
        </button>
      )}
    </p>
  );
}
