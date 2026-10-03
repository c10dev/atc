import { useCallback, useEffect, useState } from "react";
import { barKindOf, type UpdateStatus } from "../../server/update.ts";
import type { Connection } from "./useSnapshot.ts";
import { apiGet, apiSend } from "./api.ts";

const POLL_MS = 15_000;
const BUSY_POLL_MS = 2_000;
const short = (sha: string | null) => sha?.slice(0, 7) ?? "?";
const ciLabel = { ok: "CI ✓", pending: "CI 진행 중", failed: "CI ✗", none: "CI 없음" } as const;

// UPDATE bar(ATC-82): 서비스가 origin/main보다 뒤면 알리고, SUPERVISOR가 이 화면에서 RETURN TO SERVICE를 시작한다.
// 재시작 동안 SSE가 끊겨도 "연결 끊김"이 아니라 "재시작 중"으로 보인다. 끝나면 NewVersionBar가 이어받는다.
export function useUpdate(connection: Connection) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [clicked, setClicked] = useState(false);
  const [seenBusy, setSeenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet("/api/update");
      if (r.ok) setStatus((await r.json()) as UpdateStatus);
    } catch {
      // 재시작 중이면 서버가 없다: 옛 상태를 둔다
    }
  }, []);

  const busy = status?.kind === "starting" || status?.kind === "running" || clicked;
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), busy ? BUSY_POLL_MS : POLL_MS);
    return () => clearInterval(id);
  }, [load, busy]);
  useEffect(() => {
    if (connection === "live") void load();
  }, [connection, load]);

  const kind = barKindOf({ status, connection, clicked, seenBusy });
  useEffect(() => {
    if (kind === "starting" || kind === "running" || kind === "restarting") {
      setSeenBusy(true);
      setClosed(false);
    }
    // 서버가 available 밖으로 나가면 눌렀다는 표시는 서버 상태가 이어받는다
    if (clicked && status && status.kind !== "available") setClicked(false);
  }, [kind, clicked, status]);

  const start = useCallback(async () => {
    setError(null);
    setClicked(true);
    try {
      const r = await apiSend("POST", "/api/update/start", {});
      const body = (await r.json().catch(() => ({}))) as { started?: boolean; why?: string };
      if (!r.ok || !body.started) {
        setClicked(false);
        setError(body.why ?? `시작하지 못함(${r.status})`);
      } else void load();
    } catch {
      // 요청이 가기 전에 서버가 재시작한 경우도 있다: 서버 상태가 알려 준다
      void load();
    }
  }, [load]);

  const close = useCallback(() => {
    setSeenBusy(false);
    setClosed(true);
  }, []);

  return { status, kind: closed ? null : kind, error, start, close };
}

export function UpdateBar({ update }: { update: ReturnType<typeof useUpdate> }) {
  const { status, kind, error, start, close } = update;
  const [listOpen, setListOpen] = useState(false);
  const range = status ? `${short(status.deployed)} → ${short(status.main)}` : "";
  const prs = status?.prs ?? null;
  const ci = status ? ciLabel[status.mainCi] : "";

  let text: string | null = null;
  let button: { label: string; on: () => void } | null = null;
  switch (kind) {
    case "available":
      text = `업데이트 있음 · ${range}`;
      button = { label: "업데이트", on: start };
      break;
    case "waiting":
      text = `업데이트 대기 · ${range}`;
      break;
    case "manual":
      text = `업데이트 있음 · ${range} · 사람이 배포`;
      break;
    case "starting":
      text = "업데이트 시작하는 중…";
      break;
    case "running":
      text = `업데이트 중 · ${range}`;
      break;
    case "restarting":
      text = "재시작 중 — 곧 새 버전으로 돌아옵니다";
      break;
    case "done":
      text = `업데이트 완료 · ${short(status?.deployed ?? null)}`;
      break;
    case "refused":
      text = `업데이트 거절됨 · ${range}`;
      button = { label: "다시 시도", on: start };
      break;
    case "failed":
      text = `업데이트 실패 · ${range}`;
      button = { label: "다시 시도", on: start };
      break;
    case "rollback":
      text = "RTS 중지 — ROLLBACK 뒤";
      break;
  }
  const showMeta = kind === "available" || kind === "waiting" || kind === "manual" || kind === "refused" || kind === "failed";
  const reason = kind === "waiting" || kind === "manual" || kind === "refused" || kind === "failed" || kind === "rollback" ? status?.why : null;

  // 자동 배포(ATC-84, mcc 모드 rts·land+rts): 켜져 있으면 한 줄로 알리고, 5분 간격을 기다리는 중이면 다음 시각
  const auto = status?.auto?.on && (kind === "available" || kind === "waiting" || kind === "starting" || kind === "running") ? `자동 배포 켜짐${status.auto.nextAt ? ` · 다음 ${new Date(status.auto.nextAt).toTimeString().slice(0, 5)}` : ""}` : null;

  // 알림 영역은 늘 두고 안만 바꾼다(화면 읽기 프로그램이 새로 뜬 것을 읽는다)
  return (
    <div className="update-wrap" role="status">
      {kind && text && (
        <div className="update-bar" data-kind={kind}>
          <div className="update-row">
            <span className="update-text">
              <i aria-hidden className={`update-dot${kind === "running" || kind === "starting" || kind === "restarting" ? " is-busy" : ""}`} />
              {text}
            </span>
            {showMeta && prs && prs.length > 0 && (
              <button type="button" className="btn update-pr" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)}>
                PR {prs.length}
              </button>
            )}
            {showMeta && <span className="update-ci">{ci}</span>}
            {button && (
              <button type="button" className="btn is-primary update-go" onClick={button.on}>
                {button.label}
              </button>
            )}
            {kind === "done" && (
              <button type="button" className="btn update-close" onClick={close} aria-label="업데이트 알림 닫기">
                닫기
              </button>
            )}
          </div>
          {auto && <p className="update-why">{auto}</p>}
          {reason && <p className="update-why">{reason}</p>}
          {error && <p className="update-why is-error">{error}</p>}
          {listOpen && showMeta && prs && (
            <ul className="update-list">
              {prs.map((p) => (
                <li key={p.number}>
                  <b>#{p.number}</b> {p.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
