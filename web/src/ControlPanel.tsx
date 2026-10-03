import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONTROL_POLL_MS, type ControlList } from "../../server/control-view.ts";
import { brakesTabWord, CHIP_WORD, clampPanelHeight, controlRadioOf, narrowChipsOf, needingCount, nextPanelTab, PANEL_STEP, PANEL_TAB_LABEL, PANEL_TABS, type PanelTab, panelChipsOf, isPanelToggleKey, storedPanelHeight, storedPanelTab } from "../../server/control-panel.ts";
import { controlStripOf, type StripChip } from "../../server/control-strip.ts";
import { allControlDown } from "../../server/control-bulk.ts";
import type { Snapshot } from "../../server/model.ts";
import type { Transmission } from "../../server/radio.ts";
import { apiGet } from "./api.ts";
import { controlMemo, fetchControlList } from "./controlData.ts";
import { timeAgo } from "./derive.ts";
import { Icon } from "./kit/Icon.tsx";
import { threadsOf } from "./radio-log.ts";
import { formatClock, useSettings } from "./settings.ts";
import { useAtfm } from "./views/Atfm.tsx";
import { Brakes } from "./views/Brakes.tsx";
import { ControlSessions } from "./views/fleet/ControlSessions.tsx";
import "./ControlPanel.css";

// 아래 패널(ATC-445, docs/layout.md 7.2·Z5). 접힌 한 줄 머리가 옛 CONTROL 띠를 대신하고, 열면 CONTROL SESSIONS 표와 고른 세션의 최근 교신이 보인다.
// 머리에 탭이 둘이다(ATC-455, S1c): CONTROL과 BRAKES. BRAKES 탭의 몸통은 예전 HOME의 brake 줄(views/Brakes.tsx)이라 어느 화면에서든 한 번에 닿는다.
// 계산(칩 순서·OK n·높이 한계·단축키)은 server/control-panel.ts(순수). 여기는 그리기와 열고 닫기만 한다. 스스로 열지 않는다(design-language 원칙 1).
// 읽기: 머리의 칩은 CONTROL_POLL_MS마다(숨겨진 탭은 건너뜀). 표(ControlSessions)와 교신은 열려 있는 동안만 읽는다.

const HEIGHT_KEY = "atc.controlPanelHeight";
const TAB_KEY = "atc.controlPanelTab";
const NARROW = "(max-width: 860px)";
const RADIO_WINDOW_MS = 6 * 3_600_000;

function storedHeight(): number {
  try {
    return storedPanelHeight(localStorage.getItem(HEIGHT_KEY), window.innerHeight);
  } catch {
    return storedPanelHeight(null, window.innerHeight);
  }
}
function saveHeight(h: number) {
  try {
    localStorage.setItem(HEIGHT_KEY, String(h));
  } catch {
    // 저장소를 못 쓰면 이번 탭에서만 기억한다
  }
}

function storedTab(): PanelTab {
  try {
    return storedPanelTab(localStorage.getItem(TAB_KEY));
  } catch {
    return "control";
  }
}
function saveTab(t: PanelTab) {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // 저장소를 못 쓰면 이번 탭에서만 기억한다
  }
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const m = matchMedia(NARROW);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

// `MCC ● NEEDS 5m · 2분 전`: 점 옆에 상태 글자가 늘 붙는다(색만으로 알리지 않는다)
function Chip({ chip, now, selected, onPick }: { chip: StripChip; now: number; selected: boolean; onPick: (name: string) => void }) {
  const ago = chip.lastTickAt ? timeAgo(chip.lastTickAt, now) : null;
  return (
    <button type="button" className={`cp-chip cp-${chip.state}${selected ? " is-selected" : ""}`} title={chip.title} aria-label={`${chip.name} ${CHIP_WORD[chip.state]}\n${chip.title}`} aria-pressed={selected} onClick={() => onPick(chip.name)}>
      <b>{chip.code}</b>
      <i className="cp-dot" aria-hidden="true" />
      <span className="cp-word">{CHIP_WORD[chip.state]}</span>
      {chip.state !== "down" && ago && <span className="cp-ago">{ago}</span>}
    </button>
  );
}

// 고른 세션의 최근 교신(읽기만). 패널이 열려 있는 동안 60초마다
function Radio({ name }: { name: string | null }) {
  const [txs, setTxs] = useState<Transmission[] | null>(null);
  const { clock } = useSettings();
  useEffect(() => {
    let live = true;
    const go = () => {
      if (document.hidden) return;
      apiGet(`/api/radio?since=${encodeURIComponent(new Date(Date.now() - RADIO_WINDOW_MS).toISOString())}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => live && setTxs(d && Array.isArray(d.transmissions) ? d.transmissions : []))
        .catch(() => live && setTxs([]));
    };
    go();
    const t = setInterval(go, CONTROL_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  const mine = useMemo(() => (name && txs ? controlRadioOf(txs, name) : []), [txs, name]);
  const threads = useMemo(() => threadsOf(mine), [mine]);
  return (
    <aside className="cp-radio" aria-label="최근 교신">
      <h3 className="label">RADIO{name ? <em> {name}</em> : null}</h3>
      {!name ? (
        <p className="faint">세션을 고르면 그 세션의 최근 교신이 보인다.</p>
      ) : !txs ? (
        <p className="faint">불러오는 중…</p>
      ) : mine.length === 0 ? (
        <p className="faint">최근 6시간 교신 없음</p>
      ) : (
        <ul className="cp-radio-list">
          {threads.map((th) => (
            <li key={th.tx.id}>
              {[th.tx, ...th.replies].map((t) => (
                <p key={t.id} className={`cp-radio-line${t.replyTo ? " is-reply" : ""}`}>
                  <time className="mono faint" dateTime={t.at}>
                    {formatClock(Date.parse(t.at), clock, false)}
                  </time>{" "}
                  <span className="mono faint">{t.freq}</span> {t.head}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      <p className="faint cp-radio-all">
        <a href="#radio">전체 RADIO 기록</a>
      </p>
    </aside>
  );
}

export function ControlPanel({ snapshot, now, openSignal, onOpenSettings }: { snapshot: Snapshot | null; now: number; openSignal: number; onOpenSettings: () => void }) {
  const [list, setList] = useState<ControlList | null>(controlMemo.list);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTabState] = useState<PanelTab>(storedTab);
  const refreshKey = snapshot?.at.slice(0, 16) ?? "";
  // 접힌 머리의 BRAKES 글자(걸린 정지 수)도 이 읽기에서 온다. 몸통의 ATFM 패널도 같은 것을 쓴다
  const atfm = useAtfm(refreshKey);
  const tabRefs = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({});
  const [height, setHeight] = useState(storedHeight);
  const narrow = useNarrow();
  const bodyRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // 처음과 CONTROL_POLL_MS마다(숨겨진 탭은 건너뛴다). 머리의 칩은 늘 보이므로 늘 읽는다
  useEffect(() => {
    let live = true;
    const go = () => void fetchControlList().then((l) => live && l && setList(l));
    go();
    const t = setInterval(() => {
      if (!document.hidden) go();
    }, CONTROL_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  const chips = useMemo(() => panelChipsOf(controlStripOf(list?.sessions, snapshot?.sessions, now)), [list, snapshot, now]);

  const setTab = useCallback((t: PanelTab) => {
    setTabState(t);
    saveTab(t);
  }, []);
  // 주소(#fleet/control, #control)가 열라고 하면 CONTROL 탭으로 연다. App이 신호를 올린다
  useEffect(() => {
    if (openSignal > 0) {
      setTab("control");
      setOpen(true);
    }
  }, [openSignal, setTab]);
  // Ctrl+`: 열고 닫는다
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!isPanelToggleKey(e)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
  // Escape는 열린 패널을 접고 초점을 화살표로 돌린다(좁은 화면의 시트 포함)
  const onKeyDown = (e: React.KeyboardEvent) => {
    // 입력 칸·선택 칸에서 누른 Escape는 그 칸(편집 취소)의 것이다
    if (e.key === "Escape" && open && !e.defaultPrevented && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
      e.stopPropagation();
      setOpen(false);
      toggleRef.current?.focus();
    }
  };

  const pick = useCallback(
    (name: string) => {
      setSelected(name);
      setTab("control");
      setOpen(true);
    },
    [setTab],
  );
  // 탭: 닫혀 있으면 그 탭으로 열고, 열려 있는 탭을 다시 누르면 접는다(VS Code의 패널처럼)
  const pickTab = (t: PanelTab) => {
    if (open && t === tab) setOpen(false);
    else {
      setTab(t);
      setOpen(true);
    }
  };
  // 탭 줄: ←→ Home End로 옮기고 초점도 따라간다(탭 줄에는 Tab이 한 번만 선다)
  const onTabKey = (e: React.KeyboardEvent) => {
    const next = nextPanelTab(tab, e.key);
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  // 높이: 위쪽 가장자리를 끌거나(마우스·손가락) 화살표 키로. 바꿀 때마다 이 브라우저에 기억한다
  const resize = (h: number, save = true) => {
    const v = clampPanelHeight(h, window.innerHeight);
    setHeight(v);
    if (save) saveHeight(v);
  };
  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = e.clientY;
    const startH = height;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => resize(startH + (startY - m.clientY), false);
    const up = (u: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      saveHeight(clampPanelHeight(startH + (startY - u.clientY), window.innerHeight));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") (e.preventDefault(), resize(height + PANEL_STEP));
    else if (e.key === "ArrowDown") (e.preventDefault(), resize(height - PANEL_STEP));
  };

  const needing = needingCount(chips);
  const nar = narrowChipsOf(chips);
  const shown = narrow ? nar.shown : chips;
  const recovery = allControlDown(list?.sessions);
  // 머리는 늘 그린다: 세션을 못 읽었어도 BRAKES 탭은 어느 화면에서든 닿아야 한다(ATC-455)
  const brakesWord = brakesTabWord(atfm.brief ? atfm.brief.groundStops.filter((x) => x.enforced).length : 0, atfm.brief ? atfm.brief.config.manualStops.length : 0);
  const bodyId = "control-panel-body";
  return (
    <div className={`cp${open ? " is-open" : ""}`} role="region" aria-label="아래 패널" onKeyDown={onKeyDown}>
      {open && !narrow && (
        <div className="cp-grip" role="separator" aria-orientation="horizontal" aria-label="패널 높이" aria-valuemin={0} aria-valuenow={height} tabIndex={0} onPointerDown={onDrag} onKeyDown={onResizeKey} />
      )}
      <div className="cp-head">
        <button ref={toggleRef} type="button" className="cp-toggle" aria-expanded={open} aria-controls={bodyId} aria-label={open ? "패널 접기" : "패널 열기"} title="Ctrl+`" onClick={() => setOpen((v) => !v)}>
          <Icon icon={open ? ChevronDown : ChevronUp} />
        </button>
        <div className="cp-tabs" role="tablist" aria-label="패널 탭" onKeyDown={onTabKey}>
          {PANEL_TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={`cp-tab-${t}`}
              className={`cp-tab${tab === t ? " is-active" : ""}`}
              aria-selected={tab === t}
              aria-controls={open && tab === t ? bodyId : undefined}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => pickTab(t)}
            >
              <span className="cp-label">{PANEL_TAB_LABEL[t]}</span>
              {t === "control" && (
                <span className={`cp-count${needing > 0 ? " is-needs" : ""}`} aria-label={needing > 0 ? `${needing}개 세션이 SUPERVISOR를 기다림` : "기다리는 세션 없음"}>
                  {needing}
                </span>
              )}
              {t === "brakes" && brakesWord && <span className="cp-count is-needs">{brakesWord}</span>}
            </button>
          ))}
        </div>
        <div className="cp-chips">
          {shown.map((c) => (
            <Chip key={c.name} chip={c} now={now} selected={selected === c.name} onPick={pick} />
          ))}
          {narrow && chips.length > 0 && (
            <button type="button" className="cp-chip cp-ok cp-okn" onClick={() => setOpen(true)} aria-label={`정상 세션 ${nar.ok}개. 눌러서 목록 열기`}>
              <i className="cp-dot" aria-hidden="true" />
              <span className="cp-word">OK {nar.ok}</span>
            </button>
          )}
        </div>
        {recovery && (
          <button type="button" className="cp-recovery" onClick={() => setOpen(true)}>
            모두 내려감 · LAUNCH ALL
          </button>
        )}
      </div>
      {open && tab === "control" && snapshot && (
        <div id={bodyId} ref={bodyRef} role="tabpanel" aria-labelledby="cp-tab-control" className="cp-body" style={narrow ? undefined : { height }}>
          <div className="cp-table fl-list">
            <ControlSessions snapshot={snapshot} attached={false} selected={selected} onSelect={setSelected} />
          </div>
          <Radio name={selected ?? chips[0]?.name ?? null} />
        </div>
      )}
      {open && tab === "brakes" && (
        <div id={bodyId} ref={bodyRef} role="tabpanel" aria-labelledby="cp-tab-brakes" className="cp-body cp-body-brakes" style={narrow ? undefined : { height }}>
          <Brakes atfm={atfm} refreshKey={refreshKey} now={now} onOpenSettings={onOpenSettings} />
        </div>
      )}
    </div>
  );
}
