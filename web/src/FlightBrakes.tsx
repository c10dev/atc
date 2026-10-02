import { type KeyboardEvent, useRef, useState } from "react";
import { apiSend } from "./api.ts";
import { flightNumber } from "./aviation.ts";
import "./FlightBrakes.css";

// FLIGHT의 brake(ATC-377, docs/autonomy.md 원칙 9): CANCEL(승인했지만 아직 안 보낸 카드)과 RECALL(보낸 FLIGHT PLAN), 그리고 FRESH START.
// FOLLOW 줄과 FLIGHT 서랍이 같은 이 컴포넌트를 쓴다(DISPATCH 탭의 IN FLIGHT 표에 있던 것). 길(POST /api/dispatch/proposals/<id>/…)은 그대로다.

export interface BrakeCard {
  id: string;
  flight: string;
  aircraftName: string | null;
  status: string;
  departedStand?: string | null;
  departedVia?: string | null;
}
export interface FreshVerdict {
  ok: boolean;
  why?: string;
}

const RECALL_MAX = 300;
// RECALL은 보냈거나(sent) READBACK 받은(accepted) FLIGHT PLAN, 그리고 STAND 없이 DEPARTED한 것에만
export const canRecall = (p: Pick<BrakeCard, "status" | "departedStand" | "departedVia">) => p.status === "sent" || p.status === "accepted" || (p.status === "departed" && !p.departedStand && p.departedVia === "readback");
export const canCancel = (p: Pick<BrakeCard, "status">) => p.status === "approved";

async function post(path: string, body: unknown): Promise<string | null> {
  try {
    const res = await apiSend("POST", path, body);
    const data = await res.json().catch(() => ({}));
    return res.ok && !data.error ? null : String(data.error ?? `HTTP ${res.status}`);
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

type Open = "recall" | "cancel" | "fresh" | null;

export function FlightBrakes({ p, mode = "approval", fresh, onDone }: { p: BrakeCard; mode?: "shadow" | "approval"; fresh?: FreshVerdict; onDone: () => void }) {
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const last = useRef<HTMLButtonElement | null>(null);
  const recall = canRecall(p);
  const cancel = canCancel(p);
  const freshOk = p.status === "approved" && fresh?.ok;
  if (!recall && !cancel && !freshOk) return null;
  const close = () => {
    setOpen(null);
    setReason("");
    requestAnimationFrame(() => last.current?.focus());
  };
  const run = async (path: string, body: unknown) => {
    setBusy(true);
    setErr(null);
    const e = await post(path, body);
    setBusy(false);
    if (e) setErr(e);
    else {
      setOpen(null);
      setReason("");
    }
    onDone(); // 서버가 카드를 닫았을 수도 있어(오류 때도) 다시 읽는다
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const text = reason.trim();
  const fn = flightNumber(p.flight);
  const btn = (kind: Exclude<Open, null>, label: string, aria: string, cls: string, title?: string) => (
    <button type="button" className={`btn ${cls}`} disabled={busy} aria-label={aria} title={title} aria-expanded={open === kind} onClick={(e) => { last.current = e.currentTarget; setOpen(open === kind ? null : kind); }}>
      {label}
    </button>
  );
  return (
    <span className="fb" role="group" aria-label={`${p.id} ${fn} brake`}>
      <span className="fb-btns">
        {recall && btn("recall", "RECALL…", `${p.id} ${fn} RECALL — 사유 입력`, "is-recall")}
        {freshOk && btn("fresh", "FRESH START…", `${p.id} ${fn} FRESH START — 확인`, "is-fresh", "대화가 큰 세션을 멈추고, CREW BRIEFING + FLIGHT PLAN을 첫 프롬프트로 새로 띄운다")}
        {cancel && btn("cancel", "CANCEL…", `${p.id} ${fn} CANCEL — 확인`, "is-recall")}
      </span>
      {p.status === "approved" && fresh && !fresh.ok && (
        <span className="fb-note faint" title="FRESH START를 할 수 없는 이유">
          FRESH START 불가 — {fresh.why}
        </span>
      )}
      {open === "recall" && recall && (
        <form
          className="fb-form"
          aria-label={`${p.id} RECALL 사유`}
          onKeyDown={onKey}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && text) void run(`/api/dispatch/proposals/${p.id}/recall`, { reason: text });
          }}
        >
          <p className="fb-help">
            {mode === "approval" ? "OCC가 CAPTAIN에게 RECALL 문구를 보내고, " : "지금은 2a라 OCC가 보내지 않는다 — CAPTAIN에게 직접 알린다. "}
            CAPTAIN은 작업을 멈추고 {p.status === "departed" && !p.departedStand ? "그때까지의 결과를 남긴다" : "STAND를 그대로 둔다"}. RECALL을 READBACK하면 {fn}는 다시 후보가 된다.
          </p>
          <label className="fb-label" htmlFor={`fb-${p.id}-reason`}>
            RECALL 사유 <span className="faint">(필수 · CAPTAIN에게 그대로 전달)</span>
          </label>
          <textarea id={`fb-${p.id}-reason`} className="fb-input" value={reason} autoFocus required rows={2} maxLength={RECALL_MAX} placeholder="예: 우선순위가 바뀌어 다른 AIRCRAFT에 맡김" onChange={(e) => setReason(e.target.value)} />
          <div className="fb-actions">
            <span className="faint fb-count" aria-live="polite">
              {reason.length}/{RECALL_MAX}
            </span>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              취소
            </button>
            <button type="submit" className="btn is-recall is-confirm" disabled={busy || !text}>
              RECALL 요청
            </button>
          </div>
        </form>
      )}
      {open === "cancel" && cancel && (
        <form
          className="fb-form"
          aria-label={`${p.id} CANCEL 확인`}
          onKeyDown={onKey}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void run(`/api/dispatch/proposals/${p.id}/cancel`, {});
          }}
        >
          <p className="fb-help">
            {p.id}({fn})는 아직 {p.aircraftName}에 보내지 않았다. CANCEL하면 카드가 SUPERVISOR 취소로 닫히고 AIRCRAFT와 FLIGHT가 풀린다. 같은 짝은 24시간 다시 제안하지 않는다.
          </p>
          <div className="fb-actions">
            <button type="button" className="btn" autoFocus onClick={close} disabled={busy}>
              취소
            </button>
            <button type="submit" className="btn is-recall is-confirm" disabled={busy}>
              CANCEL 확인
            </button>
          </div>
        </form>
      )}
      {open === "fresh" && freshOk && (
        <form
          className="fb-form"
          aria-label={`${p.id} FRESH START 확인`}
          onKeyDown={onKey}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void run(`/api/dispatch/proposals/${p.id}/fresh-start`, {});
          }}
        >
          <p className="fb-help">
            {p.aircraftName}의 백그라운드 세션을 STOP하고 새 세션을 LAUNCH합니다. 새 세션의 첫 프롬프트가 CREW BRIEFING에 이어 {p.id}({fn})의 FLIGHT PLAN이라 OCC는 다시 보내지 않습니다. 이전 대화는 남지만(claude attach) 새 세션은 이어받지 않습니다.
          </p>
          <div className="fb-actions">
            <button type="button" className="btn" autoFocus onClick={close} disabled={busy}>
              취소
            </button>
            <button type="submit" className="btn is-fresh is-confirm" disabled={busy}>
              FRESH START 확인
            </button>
          </div>
        </form>
      )}
      {err && (
        <span className="fb-error" role="alert">
          {err}
        </span>
      )}
    </span>
  );
}
