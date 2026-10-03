import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Freq, Transmission } from "../../../server/radio.ts";
import { resumeSound, radioQuietNow, speakRadio, stopRadioSpeech, useAlerts } from "../alerts-runtime.ts";
import { enqueue, type ListenPrefs, LISTEN_MODES, loadListen, RATES, saveListen, wantsToHear, wavUrlOf } from "../radio-listen.ts";
import { asOf, ageText, ALL_FILTER, type Filter, filterByStation, filterTx, FREQS, linksOf, loadFilter, mergeTx, openState, optionsOf, saveFilter, SPEEDS, type Speed, splitHead, stationOfHash, threadsOf, WINDOW_MS } from "../radio-log.ts";
import { formatClock, useSettings } from "../settings.ts";
import { useNow } from "../useSnapshot.ts";
import "./Radio.css";
import { apiGet } from "../api.ts";
import { Empty } from "../kit/Empty.tsx";
import { Loading } from "../kit/Loading.tsx";

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

// 교신 목록: 마운트하면 바로 받아 오고, SSE radio로 새것을 합친다. 연결이 (다시) 열리면 한 번 더 받아 빈틈을 메운다.
// onFresh: SSE로 처음 보는 교신이 들어왔을 때(RADIO 듣기가 큐에 넣는다). 처음 받아 온 목록은 새것이 아니다
function useRadio(onFresh: (txs: Transmission[]) => void): { txs: Transmission[]; loaded: boolean; error: string | null } {
  const [txs, setTxs] = useState<Transmission[]>([]);
  const known = useRef(new Set<string>());
  const fresh = useRef(onFresh);
  fresh.current = onFresh;
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await apiGet("/api/radio");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { transmissions: Transmission[] };
      for (const t of body.transmissions) known.current.add(t.id);
      setTxs((prev) => mergeTx(prev, body.transmissions, Date.now()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    // 마운트하자마자 한 번 받는다(ATC-210): 창(WKWebView)이 open을 첫 본문 바이트까지 미룰 수 있어서 onopen만 기다리지 않는다. 다시 연결될 때의 빈틈은 onopen이 메운다(mergeTx가 중복을 합친다)
    void load();
    const es = new EventSource("/api/events?topics=radio");
    es.onopen = () => void load();
    es.addEventListener("radio", (e) => {
      try {
        const { transmissions } = JSON.parse((e as MessageEvent<string>).data) as { transmissions: Transmission[] };
        const added = transmissions.filter((t) => !known.current.has(t.id));
        for (const t of transmissions) known.current.add(t.id);
        setTxs((prev) => mergeTx(prev, transmissions, Date.now()));
        if (added.length) fresh.current(added);
      } catch {}
    });
    return () => es.close();
  }, [load]);
  return { txs, loaded, error };
}

export function Radio() {
  const settings = useSettings();
  const listen = useListen();
  const { txs, loaded, error } = useRadio(listen.onFresh);
  const nowTick = useNow(5_000);
  // AIRCRAFT·관제 거르기는 사이드바의 스테이션이 맡는다(ATC-446): 주소 #radio/<스테이션>. 예전에 저장된 AIRCRAFT 값은 쓰지 않는다
  const [filter, setFilter] = useState<Filter>(() => ({ ...loadFilter(storage()), aircraft: null }));
  const [station, setStation] = useState<string | null>(() => stationOfHash(location.hash));
  useEffect(() => {
    const f = () => setStation(stationOfHash(location.hash));
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
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

  listen.replaying.current = mode.kind === "replay"; // 되감기 중에는 듣지 않는다
  const now = mode.kind === "replay" ? mode.cursor : nowTick;
  const shown = useMemo(() => (mode.kind === "replay" ? asOf(txs, mode.cursor) : txs), [txs, mode]);
  const visible = useMemo(() => filterByStation(filterTx(shown, filter), station), [shown, filter, station]);
  const threads = useMemo(() => threadsOf(visible), [visible]);
  const airports = useMemo(() => optionsOf(txs, "airport"), [txs]);
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
      </div>

      <ListenBar l={listen} replaying={mode.kind === "replay"} />

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
            <Loading>불러오는 중…</Loading>
          ) : threads.length === 0 ? (
            <Empty>{txs.length ? "이 필터에 맞는 교신이 없음" : "지난 6시간 동안 기록된 교신이 없음"}</Empty>
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
      {st?.kind === "overdue" && t.reason && <span className="rd-reason">{t.reason}</span>}
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

// ── 듣기(ATC-172) ──
// 꺼짐이 기본이고 이 브라우저에만 기억한다. 새로 들어온 교신만 큐에 넣고(과거 목록은 읽지 않는다), 한 번에 하나를 무전 체인으로 읽는다.
// 문구는 서버가 필드로 만든 틀이고 본문은 읽지 않는다. WARNING·CALL 톤이 울리면 양보하고, 조용한 시간에는 큐에 넣지 않는다.
function useListen() {
  const [prefs, setPrefs] = useState<ListenPrefs>(() => loadListen(storage()));
  const { audio } = useAlerts();
  const [playingNow, setPlayingNow] = useState<Transmission | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [missed, setMissed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Transmission[]>([]);
  const busy = useRef(false);
  const cur = useRef(prefs);
  cur.current = prefs;
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const replaying = useRef(false);
  const generation = useRef(0); // 끄면 진행 중인 펌프를 그만두게
  const skipId = useRef<string | null>(null); // SKIP한 교신(받는 중이었어도 내지 않게)

  const update = (patch: Partial<ListenPrefs>) => {
    const next = { ...cur.current, ...patch };
    cur.current = next;
    setPrefs(next);
    saveListen(storage(), next);
  };

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const mine = generation.current;
    try {
      while (queue.current.length && cur.current.on && generation.current === mine) {
        const t = queue.current[0];
        setPlayingNow(t);
        setWaiting(queue.current.length - 1);
        const r = await speakRadio(wavUrlOf(t.id, cur.current.voices), cur.current.rate, () => skipId.current === t.id);
        if (generation.current !== mine) break;
        if (!r.ok && r.error === "alert") {
          await new Promise((res) => setTimeout(res, 1000)); // 알림 톤이 끝나길 기다린다(양보)
          continue;
        }
        queue.current.shift();
        if (!r.ok) {
          if (r.error === "소리가 꺼져 있음") {
            setMissed((m) => m + 1 + queue.current.length);
            queue.current = [];
          } else setError(r.error); // 엔진 없음·목소리 없음·문구 없음 등. 이 교신만 건너뛰고 계속
        } else setError(null);
      }
    } finally {
      busy.current = false;
      if (generation.current === mine) {
        setPlayingNow(null);
        setWaiting(queue.current.length);
      }
    }
  }, []);

  const onFresh = useCallback(
    (txs: Transmission[]) => {
      const p = cur.current;
      if (!p.on || replaying.current) return;
      const heard = txs.filter((t) => wantsToHear(t, p.mode));
      if (!heard.length || radioQuietNow()) return;
      if (audioRef.current !== "running") {
        setMissed((m) => m + heard.length); // 브라우저가 소리를 잠갔다: 읽지 못한 교신은 세기만 한다(글 로그에 있다)
        return;
      }
      const r = enqueue(queue.current, heard);
      queue.current = r.queue;
      if (r.skipped) setSkipped((n) => n + r.skipped);
      setWaiting(queue.current.length);
      void pump();
    },
    [pump],
  );

  const stopAll = () => {
    generation.current++;
    queue.current = [];
    stopRadioSpeech();
    setPlayingNow(null);
    setWaiting(0);
  };

  const toggle = async () => {
    if (prefs.on) {
      stopAll();
      update({ on: false });
      return;
    }
    await resumeSound(); // 이 클릭이 AudioContext를 푼다(브라우저 자동재생 규칙). 알림 소리 설정은 바꾸지 않는다
    setSkipped(0);
    setMissed(0);
    setError(null);
    update({ on: true });
  };

  return {
    prefs,
    audio,
    playingNow,
    waiting,
    skipped,
    missed,
    error,
    replaying,
    onFresh,
    toggle,
    update,
    skip: () => {
      skipId.current = playingNow?.id ?? null; // 지금 읽는(또는 받는 중인) 것을 그치면 펌프가 다음으로 넘어간다
      stopRadioSpeech();
    },
    clearNotes: () => {
      setSkipped(0);
      setMissed(0);
    },
    quiet: radioQuietNow(),
  };
}

function ListenBar({ l, replaying }: { l: ReturnType<typeof useListen>; replaying: boolean }) {
  const { prefs } = l;
  const [voices, setVoices] = useState<string[] | null>(null);
  const [showVoices, setShowVoices] = useState(false);
  useEffect(() => {
    if (!showVoices || voices) return;
    void apiGet("/api/voice/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { voices?: string[] } | null) => setVoices(j?.voices ?? []))
      .catch(() => setVoices([]));
  }, [showVoices, voices]);
  const locked = prefs.on && l.audio !== "running";
  const roles: { role: string; label: string }[] = [
    { role: "TOWER", label: "TOWER" },
    { role: "DELIVERY", label: "OCC · DELIVERY" },
    { role: "GROUND", label: "MCC · GROUND" },
    { role: "COMPANY", label: "OCC · COMPANY" },
  ];
  return (
    <div className="rd-listen">
      <div className="rd-listen-row">
        <button type="button" role="switch" aria-checked={prefs.on} className="rd-switch" onClick={() => void l.toggle()}>
          LISTEN <b>{prefs.on ? "ON" : "OFF"}</b>
        </button>
        <div className="rd-freqs" role="group" aria-label="들을 교신">
          {LISTEN_MODES.map((m) => (
            <button key={m.id} type="button" className="rd-chip" aria-pressed={prefs.mode === m.id} onClick={() => l.update({ mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="rd-speeds" role="group" aria-label="읽는 속도">
          {RATES.map((r) => (
            <button key={r} type="button" className="rd-chip" aria-pressed={prefs.rate === r} onClick={() => l.update({ rate: r })}>
              {r}×
            </button>
          ))}
        </div>
        <button type="button" className="rd-btn" disabled={!l.playingNow} onClick={l.skip}>
          SKIP
        </button>
        <button type="button" className="rd-btn" aria-expanded={showVoices} onClick={() => setShowVoices((v) => !v)}>
          목소리
        </button>
      </div>
      <p className="rd-listen-status muted" role="status" aria-live="polite">
        {!prefs.on
          ? "듣기 꺼짐 — 켜면 새로 오는 교신만 무전 소리로 읽습니다(기록에 있던 것은 읽지 않음)."
          : replaying
            ? "되감기 중에는 읽지 않습니다."
            : l.playingNow
              ? `읽는 중: ${l.playingNow.head}${l.waiting ? ` · 대기 ${l.waiting}건` : ""}`
              : l.quiet
                ? "조용한 시간 — 읽지 않습니다."
                : "대기 중"}
        {l.skipped > 0 && <em className="rd-skipped"> · 밀려서 {l.skipped}건 건너뜀</em>}
        {l.missed > 0 && <em className="rd-skipped"> · 소리가 잠겨 {l.missed}건 못 읽음</em>}
        {(l.skipped > 0 || l.missed > 0) && (
          <button type="button" className="rd-more" onClick={l.clearNotes}>
            지우기
          </button>
        )}
        {l.error && <span className="error"> · 읽지 못함: {l.error}</span>}
      </p>
      {locked && (
        <button type="button" className="rd-btn rd-lock" onClick={() => void resumeSound()}>
          🔇 소리 잠김 — 클릭하면 켜짐
        </button>
      )}
      {showVoices && (
        <div className="rd-voices">
          {voices === null ? (
            <span className="muted">불러오는 중…</span>
          ) : voices.length === 0 ? (
            <span className="muted">쓸 수 있는 TTS 목소리가 없음(설정의 음성 콜아웃을 확인)</span>
          ) : (
            roles.map(({ role, label }) => (
              <label key={role} className="rd-select">
                <span>{label}</span>
                <select
                  value={prefs.voices[role] ?? ""}
                  onChange={(e) => {
                    const next = { ...prefs.voices };
                    if (e.target.value) next[role] = e.target.value;
                    else delete next[role];
                    l.update({ voices: next });
                  }}
                >
                  <option value="">기본</option>
                  {voices.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            ))
          )}
          <span className="muted rd-voices-note">AIRCRAFT의 목소리는 콜사인에서 정해집니다.</span>
        </div>
      )}
    </div>
  );
}
