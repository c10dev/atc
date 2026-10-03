import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { PullRequest } from "../../../server/model.ts";
import type { FollowBundle, FollowNext, FollowRow, FollowStage } from "../../../server/follow.ts";
import { flightNumber } from "../aviation.ts";
import { OpenFlight } from "../FlightLink.tsx";
import { FlightBrakes } from "../FlightBrakes.tsx";
import { timeAgo } from "../derive.ts";
import { BlockList, LandingBadge } from "./Teams.tsx";
import "./Follow.css";
import { apiGet, apiSend } from "../api.ts";
import { Empty } from "../kit/Empty.tsx";

// FOLLOW(docs/follow.md 4장): 따라가는 상위 이슈마다 하위 이슈의 단계를 한 줄씩 보인다. 그리기만 한다 — 단계와 글은 서버가 센다.

export interface FollowData {
  next: number; // 따라가는 번들 전체의 다음 할 일 수(머리 NEXT n)
  at: string;
  linear: string | null;
  stages: FollowStage[];
  parents: string[];
  bundles: FollowBundle[];
  dispatchMode?: "shadow" | "approval"; // RECALL 안내 글이 가른다(ATC-377)
}

const SHORT: Record<FollowStage, string> = { todo: "TODO", proposed: "PROP", approved: "APPR", sent: "SENT", readback: "RB", pr: "PR", ci: "CLR", landed: "ON", deployed: "IN" };
const LONG: Record<FollowStage, string> = { todo: "Todo", proposed: "제안", approved: "승인", sent: "발송", readback: "READBACK", pr: "PR", ci: "CLEARED", landed: "착륙(ON)", deployed: "배포(IN)" };
const MIN_GAP_MS = 10_000; // 스냅샷 이벤트가 잦아도 10초에 한 번만 다시 읽는다

const clock = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function postFollow(parent: string, on: boolean): Promise<string | null> {
  try {
    const res = await apiSend("POST", "/api/follow", { parent, on });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return String(body.error ?? `HTTP ${res.status}`);
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

// release 칩: 기존 FLIGHT 상태 길(서랍의 상태 버튼과 같은 길). 서버가 from을 확인하고 옮겨졌으면 409. 한 번에 한 줄, 일괄 없음
async function releaseFlight(key: string, from: string): Promise<string | null> {
  try {
    const res = await apiSend("POST", `/api/flight/${encodeURIComponent(key)}/state`, { from, to: "Todo" });
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
      const res = await apiGet("/api/follow");
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
  const stuck = row.stuck?.stage ?? null;
  return (
    <span className="fw-dots" role="img" aria-label={`단계 ${row.current ? LONG[row.current] : "없음"}${row.stuck ? ` · 막힘: ${row.stuck.text}` : ""}`}>
      {stages.map((s) => {
        const c = row.stages[s];
        const cls = c.na ? "is-na" : s === row.current ? (row.finished ? "is-done is-now" : "is-now") : c.done ? "is-done" : "";
        return (
          <span key={s} className={`fw-dot ${cls}${s === stuck ? " is-stuck" : ""}`} title={`${LONG[s]}${c.na ? " — 없음" : c.at ? ` ${clock(c.at)}` : c.done ? " ✓" : ""}`}>
            {c.na ? <i className="fw-na" aria-hidden="true">—</i> : <i className="dot" data-shape={cls ? undefined : "ring"} aria-hidden="true" />}
            <small>{SHORT[s]}</small>
          </span>
        );
      })}
    </span>
  );
}

// 다음 할 일 칩: release만 버튼(기존 상태 길), 나머지는 이미 있는 화면으로 가는 링크
function NextChip({ row, next, busy, moved, onRelease }: { row: FollowRow; next: FollowNext; busy: boolean; moved: boolean; onRelease: (row: FollowRow) => void }) {
  // 옮겼는데 Linear 읽기가 아직 Backlog이면 칩을 되살리지 않는다(다시 누르면 서버가 409로 막는다)
  if (next.kind === "release" && moved) return <span className="tag fw-moved">Todo로 옮김</span>;
  if (next.kind === "release")
    return (
      <button type="button" className="btn fw-next" disabled={busy} onClick={() => onRelease(row)} aria-label={`${row.key}를 Todo로 옮기기`}>
        {next.label}
      </button>
    );
  return (
    <a className="btn fw-next" href={next.href ?? undefined} aria-label={`${row.key} ${next.label}`}>
      {next.label}
    </a>
  );
}

function Row({ row, stages, busy, error, moved, onRelease, onChanged, mode, pull }: { pull?: PullRequest; mode?: "shadow" | "approval"; row: FollowRow; stages: FollowStage[]; busy: boolean; error: string | null; moved: boolean; onRelease: (row: FollowRow) => void; onChanged: () => void }) {
  const applicable = stages.filter((s) => !row.stages[s].na);
  const at = row.current ? applicable.indexOf(row.current) + 1 : 0;
  return (
    <li className={`fw-row${row.finished ? " is-finished" : ""}${row.unreadable ? " is-unread" : ""}${row.stuck ? " is-stuck" : ""}`}>
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
        <span className={row.stuck ? "fw-stuck" : undefined}>
          {row.now}
        </span>
        {row.stuck && (
          <details className="fw-issue-det">
            <summary className="tag" data-tone="amber">막힘</summary>
            <span className="fw-issue-text is-warn">{row.stuck.text}</span>
          </details>
        )}
        {row.issues.map((i) => (
          <details key={i.code} className="fw-issue-det">
            <summary className="tag" data-tone={i.severity === "warn" ? "amber" : "cyan"}>{i.code}</summary>
            <span className={`fw-issue-text is-${i.severity}`}>{i.text}</span>
          </details>
        ))}
        {pull && <LandingBadge pr={pull} />}
        {pull && <BlockList pr={pull} />}
        {row.next && <NextChip row={row} next={row.next} busy={busy} moved={moved} onRelease={onRelease} />}
        {row.proposalInfo && <FlightBrakes p={{ ...row.proposalInfo, flight: row.key }} mode={mode} onDone={onChanged} />}
      </div>
      {error && (
        <p className="fw-error fw-row-error" role="alert">
          {error}
        </p>
      )}
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

function Bundle({ b, stages, now, onUnfollow, busy, rowBusy, rowError, moved, onRelease, onChanged, mode, pullOf }: { pullOf: (key: string) => PullRequest | undefined; mode?: "shadow" | "approval"; b: FollowBundle; stages: FollowStage[]; now: number; onUnfollow: () => void; busy: boolean; rowBusy: string | null; rowError: Record<string, string>; moved: ReadonlySet<string>; onRelease: (row: FollowRow) => void; onChanged: () => void }) {
  return (
    <details className="fw-bundle" open={!b.folded}>
      <summary>
        {b.arrows ? <span className="fw-parent mono">ARROWS</span> : <span className="fw-parent mono">{flightNumber(b.parent)}</span>}
        <span className="fw-btitle">{b.title ?? (b.missing ? "Linear에서 못 읽음" : "—")}</span>
        <span className="fw-sum">
          {b.done ? `완료${b.doneAt ? ` · ${timeAgo(b.doneAt, now)}` : ""}` : `${b.finished} / ${b.total} 완료 · ${b.flying} 비행 중`}
          {b.next > 0 && ` · 다음 할 일 ${b.next}`}
          {b.stuck > 0 && <span className="fw-stuck"> · 막힘 {b.stuck}</span>}
        </span>
      </summary>
      <div className="fw-bbody">
        {b.rows.length === 0 ? <Empty>{b.missing ? `${b.parent}을 스냅샷에서 찾지 못함(45일 안에 바뀐 이슈만 읽는다).` : "줄이 없음"}</Empty> : (
          <ul className="fw-rows">
            {b.rows.map((r) => (
              <Row key={r.key} row={r} stages={stages} busy={busy || rowBusy === r.key} error={rowError[r.key] ?? null} moved={moved.has(r.key)} onRelease={onRelease} onChanged={onChanged} mode={mode} pull={pullOf(r.key)} />
            ))}
          </ul>
        )}
        {!b.arrows && (
          <div className="fw-actions">
            <button type="button" className="btn" disabled={busy} onClick={onUnfollow}>
              따라가기 끝내기
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

export function Follow({ refreshKey, now, pulls = [] }: { refreshKey: string; now: number; pulls?: PullRequest[] }) {
  // 이 FLIGHT의 PR(착륙 상태 칩, ATC-379): 스냅샷의 열린 PR을 FLIGHT key로 찾는다. 상태 글은 서버가 정한 PR의 landing·blocks 그대로다
  const pullOf = (key: string) => pulls.find((p) => p.ticketKey === key && !p.draft);
  const { data, error, reload } = useFollowBoard(refreshKey);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [moved, setMoved] = useState<ReadonlySet<string>>(new Set());
  // release: 한 줄씩. 실패하면 서버의 글을 그 줄 아래에 그대로 보인다
  const release = async (row: FollowRow) => {
    setRowBusy(row.key);
    const err = await releaseFlight(row.key, row.state ?? "Backlog");
    setRowError((m) => {
      const { [row.key]: _gone, ...rest } = m;
      return err ? { ...rest, [row.key]: err } : rest;
    });
    if (!err) setMoved((m) => new Set(m).add(row.key));
    setRowBusy(null);
    await reload();
  };
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
        <h2 className="label">따라가는 FLIGHT</h2>
        <form className="fw-form" onSubmit={submit}>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="상위 이슈 key (예: ATC-253)" aria-label="따라갈 이슈 key" spellCheck={false} autoCapitalize="characters" />
          <button type="submit" className="btn is-primary" disabled={busy || !key.trim()}>
            따라가기
          </button>
        </form>
        {data && <span className="fw-at faint">{clock(data.at)} 기준{data.linear ? ` · Linear ${timeAgo(data.linear, now)}` : ""}</span>}
      </header>
      {msg && <p className="fw-error" role="alert">{msg}</p>}
      {error && !data && <p className="fw-error" role="alert">불러오지 못함: {error}</p>}
      {data && data.bundles.length === 0 && <Empty>따라가는 일이 없다. 발권(RELEASE)한 FLIGHT는 여기에 저절로 나타난다. 상위 이슈 key를 넣거나 FLIGHT 서랍의 FOLLOW 버튼을 누르면 번들도 따라간다.</Empty>}
      {data?.bundles.map((b) => (
        <Bundle key={b.parent} b={b} stages={data.stages} now={now} busy={busy} rowBusy={rowBusy} rowError={rowError} moved={moved} onRelease={release} onChanged={() => void reload()} mode={data.dispatchMode} pullOf={pullOf} onUnfollow={() => void change(b.parent, false)} />
      ))}
    </section>
  );
}
