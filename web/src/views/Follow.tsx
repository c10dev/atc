import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { FollowBundle, FollowRow, FollowStage } from "../../../server/follow.ts";
import { flightNumber } from "../aviation.ts";
import { OpenFlight } from "../FlightLink.tsx";
import { timeAgo } from "../derive.ts";
import "./Follow.css";

// FOLLOW(docs/follow.md 4장): 따라가는 상위 이슈마다 하위 이슈의 단계를 한 줄씩 보인다. 그리기만 한다 — 단계와 글은 서버가 센다.

interface FollowData {
  at: string;
  linear: string | null;
  stages: FollowStage[];
  parents: string[];
  bundles: FollowBundle[];
}

const SHORT: Record<FollowStage, string> = { todo: "TODO", proposed: "PROP", approved: "APPR", sent: "SENT", readback: "RB", pr: "PR", ci: "CLR", landed: "ON", deployed: "IN" };
const LONG: Record<FollowStage, string> = { todo: "Todo", proposed: "제안", approved: "승인", sent: "발송", readback: "READBACK", pr: "PR", ci: "CLEARED", landed: "착륙(ON)", deployed: "배포(IN)" };
const MIN_GAP_MS = 10_000; // 스냅샷 이벤트가 잦아도 10초에 한 번만 다시 읽는다

const clock = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function postFollow(parent: string, on: boolean): Promise<string | null> {
  try {
    const res = await fetch("/api/follow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parent, on }) });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return String(body.error ?? `HTTP ${res.status}`);
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

// 스냅샷이 바뀌면(refreshKey) 다시 읽되 10초 안에는 한 번만
export function useFollowBoard(refreshKey: string) {
  const [data, setData] = useState<FollowData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    last.current = Date.now();
    try {
      const res = await fetch("/api/follow");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, []);
  useEffect(() => {
    const wait = Math.max(0, last.current + MIN_GAP_MS - Date.now());
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), wait);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refreshKey, load]);
  return { data, error, reload: load };
}

function Dots({ row, stages }: { row: FollowRow; stages: FollowStage[] }) {
  return (
    <span className="fw-dots" role="img" aria-label={`단계 ${row.current ? LONG[row.current] : "없음"}`}>
      {stages.map((s) => {
        const c = row.stages[s];
        const cls = c.na ? "is-na" : s === row.current ? (row.finished ? "is-done is-now" : "is-now") : c.done ? "is-done" : "";
        return (
          <span key={s} className={`fw-dot ${cls}`} title={`${LONG[s]}${c.na ? " — 없음" : c.at ? ` ${clock(c.at)}` : c.done ? " ✓" : ""}`}>
            <i aria-hidden="true">{c.na ? "—" : ""}</i>
            <small>{SHORT[s]}</small>
          </span>
        );
      })}
    </span>
  );
}

function Row({ row, stages }: { row: FollowRow; stages: FollowStage[] }) {
  const applicable = stages.filter((s) => !row.stages[s].na);
  const at = row.current ? applicable.indexOf(row.current) + 1 : 0;
  return (
    <li className={`fw-row${row.finished ? " is-finished" : ""}${row.unreadable ? " is-unread" : ""}`}>
      <div className="fw-key">
        <OpenFlight k={row.key} label={flightNumber(row.key)} />
        <span className="fw-title">{row.title ?? "—"}</span>
        {row.state && <span className="fw-state faint">{row.state}</span>}
      </div>
      <Dots row={row} stages={stages} />
      <span className="fw-step mono faint" aria-hidden="true">
        {at}/{applicable.length}
      </span>
      <div className="fw-now">
        <span>{row.now}</span>
        {row.issues.map((i) => (
          <span key={i.code} className={`fw-issue is-${i.severity}`} title={i.text}>
            {i.code}
          </span>
        ))}
      </div>
      {row.history.length > 0 && (
        <details className="fw-hist">
          <summary>기록 {row.history.length}</summary>
          <ol>
            {row.history.map((h, i) => (
              <li key={i}>
                <span className="mono faint">{clock(h.at)}</span> {h.text}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function Bundle({ b, stages, now, onUnfollow, busy }: { b: FollowBundle; stages: FollowStage[]; now: number; onUnfollow: () => void; busy: boolean }) {
  return (
    <details className="fw-bundle" open={!b.folded}>
      <summary>
        <span className="fw-parent mono">{flightNumber(b.parent)}</span>
        <span className="fw-btitle">{b.title ?? (b.missing ? "Linear에서 못 읽음" : "—")}</span>
        <span className="fw-sum">
          {b.done ? `완료${b.doneAt ? ` · ${timeAgo(b.doneAt, now)}` : ""}` : `${b.finished} / ${b.total} 완료 · ${b.flying} 비행 중`}
        </span>
      </summary>
      <div className="fw-bbody">
        {b.rows.length === 0 ? <p className="empty">{b.missing ? `${b.parent}을 스냅샷에서 찾지 못함(45일 안에 바뀐 이슈만 읽는다).` : "줄이 없음"}</p> : (
          <ul className="fw-rows">
            {b.rows.map((r) => (
              <Row key={r.key} row={r} stages={stages} />
            ))}
          </ul>
        )}
        <div className="fw-actions">
          <button type="button" className="fw-btn" disabled={busy} onClick={onUnfollow}>
            따라가기 끝내기
          </button>
        </div>
      </div>
    </details>
  );
}

export function Follow({ refreshKey, now }: { refreshKey: string; now: number }) {
  const { data, error, reload } = useFollowBoard(refreshKey);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const change = async (parent: string, on: boolean) => {
    setBusy(true);
    setMsg(await postFollow(parent, on));
    setBusy(false);
    await reload();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const k = key.trim().toUpperCase();
    if (!k) return;
    void change(k, true).then(() => setKey(""));
  };
  return (
    <section className="follow" aria-label="FOLLOW">
      <header className="fw-head">
        <h2 className="label">FOLLOW</h2>
        <form className="fw-form" onSubmit={submit}>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="상위 이슈 key (예: ATC-253)" aria-label="따라갈 이슈 key" spellCheck={false} autoCapitalize="characters" />
          <button type="submit" className="fw-btn is-primary" disabled={busy || !key.trim()}>
            따라가기
          </button>
        </form>
        {data && <span className="fw-at faint">{clock(data.at)} 기준{data.linear ? ` · Linear ${timeAgo(data.linear, now)}` : ""}</span>}
      </header>
      {msg && <p className="fw-error" role="alert">{msg}</p>}
      {error && !data && <p className="fw-error" role="alert">불러오지 못함: {error}</p>}
      {data && data.bundles.length === 0 && <p className="empty">따라가는 일이 없다. 상위 이슈 key를 넣거나 FLIGHT 서랍의 FOLLOW 버튼을 누른다.</p>}
      {data?.bundles.map((b) => (
        <Bundle key={b.parent} b={b} stages={data.stages} now={now} busy={busy} onUnfollow={() => void change(b.parent, false)} />
      ))}
    </section>
  );
}
