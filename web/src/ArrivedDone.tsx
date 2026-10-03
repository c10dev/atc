import { useState } from "react";
import type { QueueItem } from "../../server/supervisor-queue.ts";
import { apiSend } from "./api.ts";
import { OpenFlight } from "./FlightLink.tsx";

// HOME의 ARRIVED 줄 상세(ATC-473): STAND 없는 FLIGHT가 LOGBOOK ARRIVED인데 Linear는 아직 In Progress일 때, 도착 보고를 보이고 확인한 클릭 하나로 Done으로 옮긴다.
// 길은 FLIGHT 상태 버튼 그대로(POST /api/flight/:key/state, 이 화면에서 온 요청만): {from, toType: "completed"}. 서버가 이 FLIGHT가 그 목록에 있을 때만 옮긴다.
const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function ArrivedDone({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const a = item.arrived;
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!a) return null;
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiSend("POST", `/api/flight/${encodeURIComponent(a.flight)}/state`, { from: a.state, toType: "completed" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setAsk(false);
      onDone();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
    setBusy(false);
  };
  return (
    <>
      <p>
        <OpenFlight k={a.flight} label={`${a.flight} ${a.title}`} />
        {a.issueUrl && (
          <>
            {" · "}
            <a href={a.issueUrl} target="_blank" rel="noreferrer">
              Linear에서 열기
            </a>
          </>
        )}
      </p>
      <p>
        {a.aircraft ?? "AIRCRAFT 모름"} · ARRIVED <span className="mono">{clock(a.arrivedAt)}</span> · Linear 상태 {a.state}
      </p>
      {a.note && <p>{a.note}</p>}
      {a.result && (
        <p>
          <a href={a.result} target="_blank" rel="noreferrer">
            결과 링크
          </a>
        </p>
      )}
      {ask ? (
        <div role="group" aria-label={`${a.flight} Done 확인`}>
          <p>
            {a.flight}를 Linear에서 {a.state}에서 Done으로 옮깁니다. 이슈 하나의 상태만 바뀌고, 되돌리려면 Linear에서 직접 바꿉니다.
          </p>
          <span className="du-actions">
            <button type="button" className="btn is-primary" disabled={busy} onClick={() => void run()}>
              확인
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => (setAsk(false), setErr(null))}>
              취소
            </button>
          </span>
        </div>
      ) : (
        <span className="du-actions">
          <button type="button" className="btn is-primary" onClick={() => setAsk(true)}>
            Done…
          </button>
        </span>
      )}
      {err && <p className="du-err">{err}</p>}
    </>
  );
}
