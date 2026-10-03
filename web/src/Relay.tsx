import { useState } from "react";
import { DEFAULT_NOTES, flightPlanNotesOf, type IssueComment } from "../../server/issue-notes.ts";
import { RELAY_KINDS, RELAY_MAX_CHARS, type Relay, type RelayKind, type RelayType, relayInputOf } from "../../server/relay.ts";
import "./Relay.css";
import { apiGet, apiSend } from "./api.ts";

// SUPERVISOR RELAY(ATC-271): AIRCRAFT에게 짧은 글을 보낸다. 글은 TOWER가 CLEARANCE로 그대로 보낸다(영어, ATC-126).
// 보내기 전에 받는 AIRCRAFT·종류·글을 한 번 더 보여 주고 묻는다. 닿지 못하면 SUPERVISOR QUEUE에 손으로 전하는 카드가 뜬다.
const KIND_LABEL: Record<RelayKind, string> = { info: "INFO", instruction: "INSTRUCTION" };
const KIND_HELP: Record<RelayKind, string> = {
  info: "알림. AIRCRAFT가 ROGER로 답한다",
  instruction: "지시. AIRCRAFT가 READBACK이나 UNABLE로 답한다",
};

const STATUS_TEXT: Record<Relay["status"], string> = {
  queued: "대기 중 — TOWER가 다음 tick에 CLEARANCE로 보낸다",
  issued: "보냄 — AIRCRAFT의 답을 기다린다",
  delivered: "닿음",
  undeliverable: "닿지 못함 — SUPERVISOR QUEUE에 손으로 전하는 카드가 떴다",
  hand: "손으로 전함",
};

export function RelayBox({
  to: toProp,
  type = null,
  stand = null,
  editableTo = false,
  flight = null,
  pr = null,
  text = null,
  kind = "info",
  btnClass,
  notesFlight = null,
  disabledWhy = null,
}: {
  to: string | null;
  type?: RelayType | null; // GO AROUND·FIX를 그대로 전한다(ATC-308): 종류 선택 없이 이 type의 CLEARANCE로 나간다
  stand?: string | null; // type과 함께 그 PR의 STAND에 묶는다
  editableTo?: boolean; // STAND를 쥔 AIRCRAFT가 없을 때: to는 제안이고 SUPERVISOR가 다른 REGISTRATION으로 고칠 수 있다
  flight?: string | null;
  pr?: number | null;
  text?: string | null; // 미리 채울 글(PR 서랍: 리뷰 지적의 FIX 본문)
  kind?: RelayKind;
  btnClass: string; // 이 화면의 버튼 클래스(btn, dr-btn)
  notesFlight?: string | null; // 있으면 "이슈 댓글 넣기"가 그 FLIGHT의 댓글을 불러온다
  disabledWhy?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(toProp ?? "");
  const to = editableTo ? picked.trim().toUpperCase() : (toProp ?? "");
  const [k, setK] = useState<RelayKind>(pr != null && text ? "instruction" : kind);
  const [body, setBody] = useState(text ?? "");
  const [step, setStep] = useState<"edit" | "confirm" | "done">("edit");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<Relay | null>(null);

  if (!editableTo && !to) return null;
  if (disabledWhy) {
    return <span className="faint rl-why">RELAY 없음 — {disabledWhy}</span>;
  }
  const check = body.trim() ? relayInputOf({ to, kind: type ? "instruction" : k, text: body, flight, pr, ...(type ? { type, stand } : {}) }) : { error: "" };
  const problem = "error" in check ? check.error : null;
  const reset = () => {
    setOpen(false);
    setStep("edit");
    setErr(null);
    setSent(null);
  };

  const loadNotes = async () => {
    if (!notesFlight) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiGet(`/api/dispatch/flight/${encodeURIComponent(notesFlight)}`);
      const d = (await res.json()) as { comments?: IssueComment[]; url?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      const lines = flightPlanNotesOf(d.comments, DEFAULT_NOTES, d.url ?? null);
      if (lines.length === 0) setErr("보낼 SUPERVISOR의 이슈 댓글이 없다");
      else setBody(lines.join("\n"));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiSend("POST", "/api/relay", { to, kind: type ? "instruction" : k, text: body.trim(), flight, pr, ...(type ? { type, stand } : {}) });
      const d = (await res.json().catch(() => ({}))) as { relay?: Relay; error?: string };
      if (!res.ok || !d.relay) throw new Error(d.error ?? `HTTP ${res.status}`);
      setSent(d.relay);
      setStep("done");
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setStep("edit");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={btnClass} onClick={() => setOpen(true)}>
        RELAY…
      </button>
    );
  }
  return (
    <div className="rl" role="group" aria-label={`${to || "AIRCRAFT"}에게 RELAY`}>
      {step === "done" && sent ? (
        <>
          <p className={sent.status === "undeliverable" ? "rl-bad" : "rl-ok"}>
            <b className="mono">{sent.id}</b> → {to}: {STATUS_TEXT[sent.status]}
            {sent.reason ? ` (${sent.reason})` : ""}
          </p>
          <button type="button" className={btnClass} onClick={reset}>
            닫기
          </button>
        </>
      ) : step === "confirm" ? (
        <>
          <p className="rl-sum">
            받는 AIRCRAFT <b className="mono">{to}</b> · <b>{type ?? KIND_LABEL[k]}</b>
            {flight ? <> · FLIGHT <b className="mono">{flight}</b></> : null}
            {pr != null ? <> · PR <b className="mono">#{pr}</b></> : null}. TOWER가 이 글을 고치지 않고 CLEARANCE로 보낸다.
          </p>
          <pre className="rl-text mono">{body.trim()}</pre>
          {err && <p className="rl-bad">{err}</p>}
          <div className="rl-actions">
            <button type="button" className={`${btnClass} primary is-primary`} disabled={busy} onClick={() => void send()}>
              {busy ? "보내는 중…" : "보내기 확인"}
            </button>
            <button type="button" className={btnClass} disabled={busy} onClick={() => setStep("edit")}>
              고치기
            </button>
          </div>
        </>
      ) : (
        <>
          {editableTo && (
            <>
              <label className="rl-label" htmlFor={`rl-to-${pr ?? ""}`}>
                받는 AIRCRAFT <span className="faint">{toProp ? "(그 FLIGHT를 난 AIRCRAFT. 다른 REGISTRATION으로 고칠 수 있다)" : "(그 FLIGHT를 난 AIRCRAFT를 모른다. REGISTRATION을 쓴다)"}</span>
              </label>
              <input id={`rl-to-${pr ?? ""}`} className="rl-input mono" value={picked} spellCheck={false} onChange={(e) => setPicked(e.target.value)} placeholder="TEAM_X" />
            </>
          )}
          {type ? (
            <p className="rl-label">
              종류 <b>{type}</b> <span className="faint">TOWER의 글을 그대로 보낸다. 이 PR의 STAND에 묶는다</span>
            </p>
          ) : (
            <fieldset className="rl-kind">
              <legend className="rl-label">종류</legend>
              {RELAY_KINDS.map((x) => (
                <label key={x} className="rl-opt">
                  <input type="radio" name={`rl-kind-${to}-${pr ?? ""}`} checked={k === x} onChange={() => setK(x)} /> {KIND_LABEL[x]} <span className="faint">{KIND_HELP[x]}</span>
                </label>
              ))}
            </fieldset>
          )}
          <label className="rl-label" htmlFor={`rl-text-${to}-${pr ?? ""}`}>
            글 <span className="faint">{type ? "(TOWER의 글. 고치지 않고 그대로 보낸다)" : "(영어로 쓴다. 세션끼리 주고받는 글은 영어, ATC-126)"}</span>
          </label>
          <textarea
            id={`rl-text-${to}-${pr ?? ""}`}
            className="rl-input mono"
            rows={6}
            value={body}
            maxLength={RELAY_MAX_CHARS + 200}
            spellCheck={false}
            readOnly={type !== null}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Short, plain English…"
          />
          <p className="rl-count mono faint">
            {body.trim().length}/{RELAY_MAX_CHARS}
          </p>
          {problem && <p className="rl-bad">{problem}</p>}
          {err && <p className="rl-bad">{err}</p>}
          <div className="rl-actions">
            <button type="button" className={`${btnClass} primary is-primary`} disabled={busy || !to || !body.trim() || problem !== null} onClick={() => setStep("confirm")}>
              보내기…
            </button>
            {notesFlight && (
              <button type="button" className={btnClass} disabled={busy} onClick={() => void loadNotes()} title={`${notesFlight}의 이슈 댓글 중 SUPERVISOR가 쓴 것을 글로 채운다`}>
                이슈 댓글 넣기
              </button>
            )}
            <button type="button" className={btnClass} disabled={busy} onClick={reset}>
              취소
            </button>
          </div>
        </>
      )}
    </div>
  );
}
