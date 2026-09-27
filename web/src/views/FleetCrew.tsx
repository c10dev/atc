import { useRef, useState } from "react";
import type { CrewFields, PendingCrewChange } from "../../../server/crew-change.ts";
import type { CrewDrift, ObservedMember } from "../../../server/crew-observed.ts";
import type { AircraftView } from "../../../server/fleet.ts";
import { timeAgo } from "../derive.ts";
import "./FleetCrew.css";

// FLEET 카드의 CREW 관측과 CREW CHANGE 대기. 설계: docs/fleet.md.
// 관측 CREW는 세션 메타데이터(agent type·시각)만 읽은 결과다. 대화 내용은 읽지 않는다.
// CREW CHANGE는 atc가 보내지 않는다 — SUPERVISOR가 복사해 CAPTAIN에게 붙여 넣고 "전달함"을 누른다.

// 옛 서버는 이 필드들을 주지 않는다(undefined). 그러면 해당 블록을 그리지 않는다.
type Crew = AircraftView & Partial<CrewFields>;

export function FleetCrew({ a, windowDays, onChanged }: { a: AircraftView; windowDays?: number; onChanged: () => unknown }) {
  const x = a as Crew;
  return (
    <>
      {x.observedCrew !== undefined && <Observed crew={x.observedCrew} drift={x.crewDrift ?? null} days={windowDays ?? 14} registration={a.registration} />}
      {x.pendingCrewChange && <CrewChange key={x.pendingCrewChange.id} registration={a.registration} change={x.pendingCrewChange} onDelivered={onChanged} />}
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

function CrewChange({ registration, change, onDelivered }: { registration: string; change: PendingCrewChange; onDelivered: () => unknown }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [copy, setCopy] = useState<"idle" | "ok" | "select">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = change.text.split("\n").length;

  // 클립보드를 못 쓰는 창(비보안 origin 등)이면 본문을 선택해 execCommand로, 그것도 안 되면 선택만 해 둔다.
  const doCopy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(change.text);
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

  const delivered = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fleet/${encodeURIComponent(registration)}/crew-change/${encodeURIComponent(change.id)}/delivered`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      await onDelivered();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <section className="fc-change" aria-label={`${registration} CREW CHANGE 대기`}>
      <h3 className="fc-change-head">
        CREW CHANGE 대기 <em title={change.at}>{timeAgo(change.at, Date.now())}</em>
      </h3>
      <p className="fc-note faint">atc는 보내지 않는다 — SUPERVISOR가 복사해 {registration} CAPTAIN에게 붙여 넣은 뒤 전달함을 누른다.</p>
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
        value={change.text}
        rows={Math.min(12, lines + 1)}
        aria-label={`${registration} CREW CHANGE 본문`}
      />
      {error && (
        <p className="fl-error fc-error" role="alert">
          전달함 처리 못 함: {error}
        </p>
      )}
      <div className="fl-actions">
        <span className="fc-copy-state" role="status" aria-live="polite">
          {copy === "ok" ? "복사함" : copy === "select" ? "본문을 선택해 둠 — Ctrl+C로 복사" : ""}
        </span>
        <button type="button" className="fl-btn primary" onClick={doCopy}>
          복사
        </button>
        <button type="button" className="fl-btn" onClick={delivered} disabled={busy}>
          {busy ? "처리 중…" : "전달함"}
        </button>
      </div>
    </section>
  );
}
