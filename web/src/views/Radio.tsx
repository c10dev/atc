import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Freq, Transmission } from "../../../server/radio.ts";
import { asOf, ageText, ALL_FILTER, type Filter, filterTx, FREQS, linksOf, loadFilter, mergeTx, openState, optionsOf, saveFilter, SPEEDS, type Speed, splitHead, threadsOf, WINDOW_MS } from "../radio-log.ts";
import { formatClock, useSettings } from "../settings.ts";
import { useNow } from "../useSnapshot.ts";
import "./Radio.css";

// RADIO 탭(ATC-171, docs/radio.md R2). atc가 이미 기록한 교신을 주파수별로 보여 주기만 한다.
// 읽기만: 보내기·ACK·승인 버튼이 없다. 소리는 R3. 서버는 R1(GET /api/radio, SSE 토픽 radio).

const storage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

type Mode = { kind: "live" } | { kind: "replay"; cursor: number; playing: boolean; speed: Speed };
const TICK_MS = 250;

// 교신 목록: 처음 받아 오고, SSE radio로 새것을 합친다. 연결이 (다시) 열리면 한 번 더 받아 빈틈을 메운다.
function useRadio(): { txs: Transmission[]; loaded: boolean; error: string | null } {
  const [txs, setTxs] = useState<Transmission[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/radio");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { transmissions: Transmission[] };
      setTxs((prev) => mergeTx(prev, body.transmissions, Date.now()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    const es = new EventSource("/api/events?topics=radio");
    es.onopen = () => void load();
    es.addEventListener("radio", (e) => {
      try {
        const { transmissions } = JSON.parse((e as MessageEvent<string>).data) as { transmissions: Transmission[] };
        setTxs((prev) => mergeTx(prev, transmissions, Date.now()));
      } catch {}
    });
    return () => es.close();
  }, [load]);
  return { txs, loaded, error };
}

export function Radio() {
  const settings = useSettings();
  const { txs, loaded, error } = useRadio();
  const nowTick = useNow(5_000);
  const [filter, setFilter] = useState<Filter>(() => loadFilter(storage()));
  const [mode, setMode] = useState<Mode>({ kind: "live" });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const change = (next: Filter) => {
    setFilter(next);
    saveFilter(storage(), next);
  };

  // 되감기 시계: TICK_MS마다 speed배로 나아가고, 지금에 닿으면 실시간으로 돌아간다
  const playing = mode.kind === "replay" && mode.playing;
  const speed = mode.kind === "replay" ? mode.speed : 1;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setMode((m) => {
        if (m.kind !== "replay" || !m.playing) return m;
        const cursor = m.cursor + TICK_MS * m.speed;
        return cursor >= Date.now() ? { kind: "live" } : { ...m, cursor };
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed]);

  const now = mode.kind === "replay" ? mode.cursor : nowTick;
  const shown = useMemo(() => (mode.kind === "replay" ? asOf(txs, mode.cursor) : txs), [txs, mode]);
  const visible = useMemo(() => filterTx(shown, filter), [shown, filter]);
  const threads = useMemo(() => threadsOf(visible), [visible]);
  const airports = useMemo(() => optionsOf(txs, "airport"), [txs]);
  const aircraft = useMemo(() => optionsOf(txs, "aircraft"), [txs]);
  const allOn = FREQS.every((f) => filter.freqs.has(f));

  const toggleFreq = (f: Freq) => {
    // 전부 듣는 중에 하나를 누르면 그 주파수만, 그다음부터는 켜고 끈다
    const next = allOn ? new Set<Freq>([f]) : new Set(filter.freqs);
    if (!allOn && !next.delete(f)) next.add(f);
    change({ ...filter, freqs: next.size ? next : ALL_FILTER.freqs }); // 전부 끄면 전부 보기
  };

  // 스크롤: 맨 아래를 보고 있으면 새 줄이 붙을 때 따라가고, 위로 올렸으면 그대로 두고 "N new"를 띄운다
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const total = visible.length;
  const [seen, setSeen] = useState(0);
  const atBottom = () => {
    const el = logRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  const toBottom = () => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stick.current = true;
    setSeen(total);
  };
  useLayoutEffect(() => {
    if (stick.current || mode.kind === "replay") toBottom();
  }, [total, mode.kind === "replay" ? mode.cursor : 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = Math.max(0, total - seen);

  const toggleBody = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const startReplay = () => setMode({ kind: "replay", cursor: nowTick - 60 * 60_000, playing: false, speed: 1 });
  const min = nowTick - WINDOW_MS;
  const clock = (t: number) => formatClock(t, settings.clock, true);

  return (
    <section className="radio" aria-label="RADIO">
      <div className="rd-bar">
        <div className="rd-freqs" role="group" aria-label="주파수">
          <button type="button" className="rd-chip" aria-pressed={allOn} onClick={() => change({ ...filter, freqs: ALL_FILTER.freqs })}>
            MONITOR ALL
          </button>
          {FREQS.map((f) => (
            <button key={f} type="button" className="rd-chip" aria-pressed={!allOn && filter.freqs.has(f)} onClick={() => toggleFreq(f)}>
              {f}
            </button>
          ))}
        </div>
        <label className="rd-select">
          <span>AIRPORT</span>
          <select value={filter.airport ?? ""} onChange={(e) => change({ ...filter, airport: e.target.value || null })}>
            <option value="">전체</option>
            {airports.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="rd-select">
          <span>AIRCRAFT</span>
          <select value={filter.aircraft ?? ""} onChange={(e) => change({ ...filter, aircraft: e.target.value || null })}>
            <option value="">전체</option>
            {aircraft.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rd-replay">
        {mode.kind === "live" ? (
          <>
            <span className="rd-mode">LIVE · 실시간</span>
            <button type="button" className="rd-btn" onClick={startReplay}>
              REPLAY
            </button>
          </>
        ) : (
          <>
            <span className="rd-mode">REPLAY · <span className="mono">{clock(mode.cursor)}</span></span>
            <button type="button" className="rd-btn" onClick={() => setMode({ ...mode, playing: !mode.playing })} aria-label={mode.playing ? "일시정지" : "재생"}>
              {mode.playing ? "PAUSE" : "PLAY"}
            </button>
            <div className="rd-speeds" role="group" aria-label="재생 속도">
              {SPEEDS.map((s) => (
                <button key={s} type="button" className="rd-chip" aria-pressed={mode.speed === s} onClick={() => setMode({ ...mode, speed: s })}>
                  {s}×
                </button>
              ))}
            </div>
            <button type="button" className="rd-btn" onClick={() => setMode({ kind: "live" })}>
              LIVE
            </button>
          </>
        )}
        <input
          className="rd-scrub"
          type="range"
          aria-label="시각"
          min={min}
          max={nowTick}
          step={60_000}
          value={mode.kind === "replay" ? Math.min(Math.max(mode.cursor, min), nowTick) : nowTick}
          onChange={(e) => setMode({ kind: "replay", cursor: Number(e.target.value), playing: mode.kind === "replay" ? mode.playing : false, speed })}
        />
        <span className="rd-range mono muted">{clock(min)} – {clock(nowTick)}</span>
      </div>

      {error && <p className="error" role="alert">교신 목록을 읽지 못함: {error}</p>}
      <div className="rd-wrap">
        <div className="rd-log" ref={logRef} onScroll={() => { stick.current = atBottom(); if (stick.current) setSeen(total); }} tabIndex={0} aria-label="교신 기록" role="log" aria-live="off">
          {!loaded ? (
            <p className="empty">불러오는 중…</p>
          ) : threads.length === 0 ? (
            <p className="empty">{txs.length ? "이 필터에 맞는 교신이 없음" : "지난 6시간 동안 기록된 교신이 없음"}</p>
          ) : (
            <ul className="rd-list">
              {threads.map((th) => (
                <li key={th.tx.id} className="rd-thread">
                  <Line t={th.tx} now={now} clock={clock} expanded={open.has(th.tx.id)} onToggle={toggleBody} />
                  {th.replies.length > 0 && (
                    <ul className="rd-replies">
                      {th.replies.map((r) => (
                        <li key={r.id}>
                          <Line t={r} now={now} clock={clock} expanded={open.has(r.id)} onToggle={toggleBody} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {fresh > 0 && mode.kind === "live" && (
          <button type="button" className="rd-new" onClick={toBottom}>
            {fresh} new ↓
          </button>
        )}
      </div>
    </section>
  );
}

function Line({ t, now, clock, expanded, onToggle }: { t: Transmission; now: number; clock: (t: number) => string; expanded: boolean; onToggle: (id: string) => void }) {
  const { stations, rest } = splitHead(t.head);
  const st = openState(t, now);
  const links = linksOf(t);
  const bodyId = `rd-body-${t.id.replace(/[^\w-]/g, "_")}`;
  return (
    <div className={`rd-line${st?.kind === "overdue" ? " is-overdue" : ""}${t.orphan ? " is-orphan" : ""}`}>
      <span className="rd-time mono">{clock(Date.parse(t.at))}</span>
      <span className="rd-freq mono">{t.freq}</span>
      <span className="rd-head">
        <span className="mono">{stations}</span>
        {rest && <span> · {rest}</span>}
      </span>
      {st?.kind === "open" && <span className="rd-state">답 대기 {ageText(st.ageMs)}</span>}
      {st?.kind === "overdue" && <span className="rd-state is-overdue">NO REPLY · {ageText(st.ageMs)}째 답 없음</span>}
      {t.orphan && <span className="rd-state is-orphan">호출 기록 없음</span>}
      {t.kind === "UNABLE" && <span className="rd-state is-unable">UNABLE</span>}
      {t.body && (
        <button type="button" className="rd-more" aria-expanded={expanded} aria-controls={bodyId} onClick={() => onToggle(t.id)}>
          {expanded ? "접기" : "본문"}
        </button>
      )}
      {links.map((l) => (
        <a key={l.href + l.label} className="rd-link mono" href={l.href} {...(l.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
          {l.label}
        </a>
      ))}
      {expanded && t.body && (
        <pre id={bodyId} className="rd-body">
          {t.body}
        </pre>
      )}
    </div>
  );
}
