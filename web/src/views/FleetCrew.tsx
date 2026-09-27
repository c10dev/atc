import { useRef, useState } from "react";
import type { CrewFields, PendingCrewChange } from "../../../server/crew-change.ts";
import type { CrewDrift, ObservedMember } from "../../../server/crew-observed.ts";
import type { AircraftView } from "../../../server/fleet.ts";
import { timeAgo } from "../derive.ts";
import { formatClock, useSettings } from "../settings.ts";
import "./FleetCrew.css";

// FLEET 카드의 CREW 관측과 CREW CHANGE 대기. 설계: docs/fleet.md.
// 관측 CREW는 세션 메타데이터(agent type·시각)만 읽은 결과다. 대화 내용은 읽지 않는다.
// CREW CHANGE: 그림자 운용(shadow)이면 SUPERVISOR가 복사해 붙여 넣고 "전달함"을 누른다.
// 승인 운용(approval, 2b)이면 SUPERVISOR 승인 → OCC가 보냄(sent) → CAPTAIN의 READBACK CC-xxxx로 닫힌다.

// 옛 서버는 이 필드들을 주지 않는다(undefined). 그러면 해당 블록을 그리지 않는다.
type Crew = AircraftView & Partial<CrewFields>;
// 옛 서버엔 단계 필드가 없다 — 없으면 pending으로 본다
type Stage = "pending" | "approved" | "sent";
type Change = PendingCrewChange &
  Partial<{ status: Stage; message: string | null; approvedAt: string | null; sentAt: string | null; overdue: boolean; waitingFor: string | null }>;
// DISPATCH mode(GET /api/fleet의 dispatchMode). 옛 서버엔 없다 — approval이 아니면 shadow로 본다
type Mode = "shadow" | "approval";


export function FleetCrew({
  a,
  windowDays,
  dispatchMode,
  onChanged,
}: {
  a: AircraftView;
  windowDays?: number;
  dispatchMode?: string;
  onChanged: () => unknown;
}) {
  const x = a as Crew;
  const mode: Mode = dispatchMode === "approval" ? "approval" : "shadow";
  return (
    <>
      {x.observedCrew !== undefined && <Observed crew={x.observedCrew} drift={x.crewDrift ?? null} days={windowDays ?? 14} registration={a.registration} />}
      {x.pendingCrewChange && (
        <CrewChange key={x.pendingCrewChange.id} registration={a.registration} change={x.pendingCrewChange} mode={mode} onChanged={onChanged} />
      )}
    </>
  );
}

function Observed({ crew, drift, days, registration }: { crew: ObservedMember[] | null; drift: CrewDrift | null; days: number; registration: string }) {
  const now = Date.now();
  const undeclared = drift?.undeclared ?? [];
  const unused = drift?.unused ?? [];
  return (
    <>
      <h3 className="fl-sub">
        OBSERVED CREW <em>최근 {days}일</em>
      </h3>
      {crew?.length ? (
        <ul className="fc-obs" aria-label={`${registration} 최근 ${days}일 관측 CREW`}>
          {crew.map((m) => (
            <li key={`${m.agentType}/${m.model}`}>
              <span className="fl-pos">{m.position ?? "—"}</span>
              <span className="mono">{m.agentType}</span>
              {m.model && <span className="faint fc-model">{m.model}</span>}
              <span className="fc-count" title={`최근 ${days}일 ${m.count}회`}>
                ×{m.count}
              </span>
              <span className="faint fc-last" title={m.lastAt ?? undefined}>
                {timeAgo(m.lastAt, now)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fl-line faint">관측 없음</p>
      )}
      {undeclared.length > 0 && (
        <p className="fc-drift">
          <span className="fc-drift-mark">선언에 없음</span> <span className="mono">{undeclared.join(", ")}</span>
        </p>
      )}
      {unused.length > 0 && (
        <p className="fc-drift is-unused">
          <span className="fc-drift-mark">최근 {days}일 안 씀</span> <span className="mono">{unused.join(", ")}</span>
        </p>
      )}
      <p className="fc-note faint">세션 메타데이터(agent type·시각)만 읽음 — 대화 내용은 읽지 않는다</p>
    </>
  );
}

const HEAD: Record<Stage, string> = {
  pending: "CREW CHANGE 대기",
  approved: "CREW CHANGE 승인됨 — OCC 발부 대기",
  sent: "CREW CHANGE SENT — READBACK 대기",
};

function CrewChange({ registration, change, mode, onChanged }: { registration: string; change: Change; mode: Mode; onChanged: () => unknown }) {
  const { clock } = useSettings();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const [copy, setCopy] = useState<"idle" | "ok" | "select">("idle");
  const [busy, setBusy] = useState<"approve" | "delivered" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stage: Stage = change.status === "approved" || change.status === "sent" ? change.status : "pending";
  const approval = mode === "approval";
  // 보낸 뒤에는 OCC가 실제로 보낸 본문(message)을 그대로 보인다
  const body = stage === "sent" && change.message ? change.message : change.text;
  const lines = body.split("\n").length;
  const stamp = stage === "sent" ? change.sentAt : stage === "approved" ? change.approvedAt : change.at;
  const overdue = stage === "sent" && change.overdue === true;
  // 전달함(손으로 붙여 넣음)은 OCC가 보내기 전(pending·approved)까지만. 서버도 sent에는 409
  const canDeliver = stage !== "sent";
  const now = Date.now();

  // 클립보드를 못 쓰는 창(비보안 origin 등)이면 본문을 선택해 execCommand로, 그것도 안 되면 선택만 해 둔다.
  const doCopy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(body);
      setCopy("ok");
    } catch {
      const el = textRef.current;
      const back = document.activeElement as HTMLElement | null;
      el?.focus();
      el?.select();
      const ok = !!el && document.execCommand?.("copy");
      // 복사됐으면 포커스를 버튼으로 돌린다. 못 했으면 선택된 본문에 둬서 Ctrl+C로 바로 복사하게 한다
      if (ok) {
        el.setSelectionRange(0, 0);
        back?.focus();
      }
      setCopy(ok ? "ok" : "select");
    }
  };

  // approve·delivered 공통. 409·404는 서버 문구를 그대로 블록 안에 보인다
  const post = async (op: "approve" | "delivered") => {
    setBusy(op);
    setError(null);
    try {
      const res = await fetch(`/api/fleet/${encodeURIComponent(registration)}/crew-change/${encodeURIComponent(change.id)}/${op}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      await onChanged();
      // 승인하면 누른 버튼이 사라진다 — 초점을 바뀐 단계 제목으로 옮긴다
      if (op === "approve") headRef.current?.focus();
    } catch (e) {
      setError(`${op === "approve" ? "승인" : "전달함 처리"} 못 함: ${(e as Error).message}`);
    }
    setBusy(null);
  };

  const approve = () => {
    const ok = confirm(
      `${change.id} CREW CHANGE를 승인할까요?\n\n승인하면 OCC가 이 본문에 [OCC ${change.id}] 머리말과 READBACK 요청을 붙여 ${registration} CAPTAIN에게 보내고 "READBACK ${change.id}" 답을 기다립니다.\n직접 붙여 넣을 거라면 취소하고 복사·전달함을 쓰세요.`,
    );
    if (ok) post("approve");
  };

  return (
    <section className={`fc-change is-${stage}${overdue ? " is-overdue" : ""}`} aria-label={`${registration} ${HEAD[stage]}`}>
      <h3 ref={headRef} className="fc-change-head" tabIndex={-1}>
        {HEAD[stage]} <span className="fc-change-id">{change.id}</span>
        <em title={stamp ?? undefined}>
          {stage !== "pending" && stamp ? `${formatClock(stamp, clock)} · ` : ""}
          {timeAgo(stamp ?? change.at, now)}
        </em>
      </h3>
      {overdue && (
        <p className="fc-overdue" role="alert">
          READBACK 없음 10분+
        </p>
      )}
      {stage === "pending" && !approval && (
        <>
          <p className="fc-note faint">atc는 보내지 않는다 — SUPERVISOR가 복사해 {registration} CAPTAIN에게 붙여 넣은 뒤 전달함을 누른다.</p>
          <p className="fc-note faint">OCC가 보내게 하려면 DISPATCH 2b(승인 운용)가 필요하다.</p>
        </>
      )}
      {stage === "pending" && approval && (
        <p className="fc-note faint">
          승인하면 OCC가 {registration} CAPTAIN에게 보내고 "READBACK {change.id}" 답을 기다린다. 직접 붙여 넣었으면 전달함을 누른다.
        </p>
      )}
      {stage === "approved" && (
        <p className="fc-note faint">SUPERVISOR가 승인함 — OCC가 {registration} CAPTAIN에게 보내기를 기다린다. 그 전에 직접 붙여 넣었으면 전달함을 누른다.</p>
      )}
      {stage === "sent" && (
        <p className="fc-note faint">
          OCC가 보냄 — {registration} CAPTAIN의 "READBACK {change.id}" 답을 기다린다. 아래는 보낸 본문 그대로.
        </p>
      )}
      {stage !== "sent" && change.waitingFor && (
        <p className="fc-note">앞서 보낸 {change.waitingFor}의 READBACK을 받은 뒤에 OCC가 보낸다.</p>
      )}
      {(change.added.length > 0 || change.removed.length > 0) && (
        <p className="fc-diff">
          {change.added.map((p) => (
            <span key={`+${p}`} className="fc-add">
              + {p}
            </span>
          ))}
          {change.removed.map((p) => (
            <span key={`-${p}`} className="fc-remove">
              − {p}
            </span>
          ))}
        </p>
      )}
      {change.ratingImpact.length > 0 && (
        <ul className="fc-impact" aria-label="TYPE RATING 영향">
          {change.ratingImpact.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <textarea
        ref={textRef}
        className="fl-briefing-text"
        readOnly
        value={body}
        rows={Math.min(12, lines + 1)}
        aria-label={`${registration} CREW CHANGE ${stage === "sent" ? "보낸 본문" : "본문"}`}
      />
      {error && (
        <p className="fl-error fc-error" role="alert">
          {error}
        </p>
      )}
      <div className="fl-actions">
        <span className="fc-copy-state" role="status" aria-live="polite">
          {copy === "ok" ? "복사함" : copy === "select" ? "본문을 선택해 둠 — Ctrl+C로 복사" : ""}
        </span>
        {stage === "pending" && approval && (
          <button type="button" className="fl-btn primary" onClick={approve} disabled={busy !== null}>
            {busy === "approve" ? "처리 중…" : "승인 — OCC가 보냄"}
          </button>
        )}
        <button type="button" className={`fl-btn${approval && stage === "pending" ? "" : " primary"}`} onClick={doCopy}>
          복사
        </button>
        {canDeliver && (
          <button type="button" className="fl-btn" onClick={() => post("delivered")} disabled={busy !== null}>
            {busy === "delivered" ? "처리 중…" : "전달함"}
          </button>
        )}
      </div>
    </section>
  );
}
