import { type FormEvent, useCallback, useEffect, useState } from "react";
import { flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import { atfmAlertOf } from "../readiness-line.ts";
import { StateMark } from "./Mark.tsx";
import "./Atfm.css";
import { apiGet, apiSend } from "../api.ts";
import { Empty } from "../kit/Empty.tsx";

// ATFM 3단계(docs/atfm.md). 대부분 그림자 운용: 계산해서 보여 주기만 한다.
// 켤 수 있는 것은 GROUND STOP 두 가지(main 깨짐, 수동)와 머지 슬롯(7단계: 켜면 TOWER가 in-slot PR에만 LAND)이다.

type StopMode = "off" | "shadow" | "on";
type ShadowMode = "off" | "shadow";
type Trigger = "main-broken" | "failure-wave" | "congestion" | "los" | "manual";
type TurnState = "pass" | "fail" | "insufficient" | "check";

interface AtfmConfig {
  groundStop: { mainBroken: StopMode; manual: "off" | "on"; failureWave: StopMode; congestion: StopMode; los: StopMode };
  slots: StopMode;
  autoAssign: ShadowMode;
  s3: ShadowMode;
  slotLimits: Record<string, number | null>;
  manualStops: { airport: string; reason: string; at: string }[];
}
interface MainView {
  repo: string;
  slug: string;
  branch: string;
  sha: string | null;
  state: "success" | "failure" | "pending" | "none";
  failing: string[];
  checks: number;
  at: string;
  airport: string | null;
}
interface GroundStopView {
  airport: string;
  repo: string | null;
  trigger: Trigger;
  kind: "stop" | "delay";
  land?: boolean; // 켜졌을 때 LAND도 막는가. LOS는 새 ASSIGN만(ATC-62)
  enforced: boolean;
  text: string;
  evidence: string[];
  since: string;
  releasing?: string | null; // 트리거가 풀려 해제 규칙을 기다리는 중(ATC-62)
}
interface SlotRow {
  airport: string | null;
  pr: number;
  title: string;
  url: string;
  slot: "in-slot" | "waiting-slot";
  lanePos: number;
  limit: number | null;
  urgent: boolean;
  landAt: string | null;
  landTimedOut: boolean;
}
interface OpenItem {
  id: string;
  flight: string | null;
  aircraft: string | null;
  eligible: boolean;
  failed: { code: string; text: string }[];
}
interface Precision {
  eligible: number;
  decided: number;
  approved: number;
  rate: number | null;
  bad: number;
}
interface TurnOn {
  id: string;
  label: string;
  value: string;
  target: string;
  status: TurnState;
}
interface AutoView {
  mode: ShadowMode;
  open: OpenItem[];
  precision: Precision;
  turnOn: TurnOn[];
}
interface AtfmBrief {
  config: AtfmConfig;
  mains: MainView[];
  groundStops: GroundStopView[];
  slots: SlotRow[];
  auto: AutoView;
  s3: AutoView;
  data: {
    ci: { airport: string | null; samples: number; medianMin: number | null }[];
    behind: { airport: string | null; merges: number; behind: number; perMerge: number | null }[];
    // 7일 동안 DIRTY가 된 PR과 그중 그때 파일이 겹치는 열린 PR이 있던 수(파일 겹침 지표, ATC-71). 옛 서버면 없음
    dirty?: { airport: string; dirty: number; seen: number }[];
    undone: number;
    // 머지 슬롯 켜기 판단(7일, docs/atfm.md 5장). 옛 서버면 없음
    lands: { airport: string; lands: number; concurrent: number; mergedMedianMin: number | null; timeouts: number }[];
  };
  caps: { assignPerDay: number; s3PerDay: number; inFlightPerAircraft: number };
  thresholds: { precision: number; precisionN: number; crosscheck: number; crosscheckN: number; trip: number };
}

const TRIGGER_TEXT: Record<Trigger, string> = {
  "main-broken": "main 깨짐",
  "failure-wave": "CI 실패 몰림",
  congestion: "CI 혼잡(GROUND DELAY)",
  los: "LOS 증가",
  manual: "수동",
};
const MAIN_TEXT: Record<MainView["state"], string> = { success: "success", failure: "failure", pending: "pending", none: "CI 없음" };
const MODE_TEXT: Record<StopMode, string> = { off: "꺼짐", shadow: "그림자", on: "켜짐" };
const TURN_TEXT: Record<TurnState, string> = { pass: "충족", fail: "미달", insufficient: "데이터 부족", check: "확인 필요" };
// 켜면 멈추는 것(확인 문구에 씀)
const ON_EFFECT = "켜면 해당 AIRPORT에 새 ASSIGN과 LAND가 멈춘다.";
const WAVE_ON_EFFECT = "켜면 해당 AIRPORT에 새 ASSIGN과 LAND가 멈춘다. 실패가 몰린 체크가 그 뒤 PR 2개에서 통과해야 풀린다.";
const CONGESTION_ON_EFFECT = "켜면 해당 AIRPORT의 AIRBORNE 슬롯이 하나 준다(GROUND DELAY). LAND는 계속 나간다. 기준 아래로 30분 이어져야 풀린다.";
const LOS_ON_EFFECT = "켜면 해당 AIRPORT에 새 ASSIGN이 멈춘다. LAND는 계속 나간다. 기준 아래로 30분 이어져야 풀린다.";
const SLOTS_ON_EFFECT = "켜면 TOWER가 저장소마다 in-slot PR에만 LAND를 낸다(vocado_nextjs는 한 번에 1개). waiting-slot PR은 앞 PR이 머지되거나 LAND 뒤 30분이 지날 때까지 LAND를 기다린다.";

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const aptOf = (a: string | null) => a ?? "—";

async function post(path: string, body: unknown) {
  const res = await apiSend("POST", path, body);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// 옛 서버·만드는 중인 서버가 필드를 빠뜨려도 그리게 기본값을 채운다
const EMPTY_AUTO: AutoView = { mode: "shadow", open: [], precision: { eligible: 0, decided: 0, approved: 0, rate: null, bad: 0 }, turnOn: [] };
function normalize(raw: Partial<AtfmBrief> | null): AtfmBrief | null {
  if (!raw || typeof raw !== "object" || !raw.config?.groundStop) return null;
  const auto = (a: Partial<AutoView> | undefined): AutoView => ({ ...EMPTY_AUTO, ...a, open: a?.open ?? [], turnOn: a?.turnOn ?? [], precision: { ...EMPTY_AUTO.precision, ...a?.precision } });
  return {
    config: { ...raw.config, manualStops: raw.config.manualStops ?? [], slotLimits: raw.config.slotLimits ?? {} },
    mains: raw.mains ?? [],
    groundStops: raw.groundStops ?? [],
    slots: raw.slots ?? [],
    auto: auto(raw.auto),
    s3: auto(raw.s3),
    data: { ci: raw.data?.ci ?? [], behind: raw.data?.behind ?? [], undone: raw.data?.undone ?? 0, lands: raw.data?.lands ?? [] },
    caps: raw.caps ?? { assignPerDay: 0, s3PerDay: 0, inFlightPerAircraft: 0 },
    thresholds: raw.thresholds ?? { precision: 0, precisionN: 0, crosscheck: 0, crosscheckN: 0, trip: 0 },
  };
}

// ATFM 상태 하나를 예외 블록(AtfmAlert)과 READINESS 안 패널(AtfmPanel)이 함께 쓴다(ATC-113)
export interface AtfmState {
  brief: AtfmBrief | null;
  error: string | null;
  busy: boolean;
  act: (path: string, body: unknown) => Promise<boolean>;
}

export function useAtfm(refreshKey: string): AtfmState {
  const [brief, setBrief] = useState<AtfmBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 서버에 ATFM이 없거나(404) 실패하면 아무것도 그리지 않는다
  const load = useCallback(async () => {
    try {
      const res = await apiGet("/api/atfm");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBrief(normalize(await res.json()));
    } catch {
      setBrief(null);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      await post(path, body);
      setError(null);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { brief, error, busy, act };
}

// 예외: 실제로 걸린 GROUND STOP·GROUND DELAY나 main CI 실패가 있을 때만 맨 위에 펴 둔다. GROUND STOP 스위치와 ATFM OFF도 여기로 온다
export function AtfmAlert({ atfm, now }: { atfm: AtfmState; now: number }) {
  const { brief, error, busy, act } = atfm;
  if (!brief || !atfmAlertOf(brief).active) return null;
  const enforced = brief.groundStops.filter((s) => s.enforced).length;
  const allOff = () => {
    if (!confirm("ATFM OFF\n\n모든 스위치를 그림자 운용으로 되돌리고 수동 GROUND STOP을 끕니다.\n멈춰 있던 ASSIGN과 LAND가 다시 나갑니다. 계속할까요?")) return;
    act("/api/atfm/off", {});
  };
  return (
    <section className="atfm atfm-alert" aria-labelledby="atfm-alert-title">
      <header className="atfm-head">
        <h2 className="label" id="atfm-alert-title">
          ATFM <em>{enforced ? `실제 GROUND STOP ${enforced}` : "main CI 실패"}</em>
        </h2>
        <button className="dp-btn atfm-off" onClick={allOff} disabled={busy} title="모든 스위치를 그림자로, 수동 GROUND STOP은 끔">
          ATFM OFF
        </button>
      </header>
      {error && (
        <p className="dp-error atfm-error" role="alert">
          {error}
        </p>
      )}
      <GroundStopSection atfm={atfm} now={now} />
    </section>
  );
}

// alertShown: 예외 블록이 GROUND STOP 절과 ATFM OFF를 맨 위로 가져갔다. 아니면 이 패널이 그대로 갖는다
export function AtfmPanel({ atfm, now, alertShown }: { atfm: AtfmState; now: number; alertShown: boolean }) {
  const { brief, error, busy, act } = atfm;
  if (!brief) return null;
  const { config } = brief;

  const allOff = () => {
    if (!confirm("ATFM OFF\n\n모든 스위치를 그림자 운용으로 되돌리고 수동 GROUND STOP을 끕니다.\n멈춰 있던 ASSIGN과 LAND가 다시 나갑니다. 계속할까요?")) return;
    act("/api/atfm/off", {});
  };
  const enforced = brief.groundStops.filter((s) => s.enforced).length;

  return (
    <section className="atfm" aria-labelledby="atfm-title">
      <header className="atfm-head">
        <h2 className="label" id="atfm-title">
          ATFM <em>3단계 · 그림자 운용{enforced ? ` · 실제 GROUND STOP ${enforced}` : ""}</em>
        </h2>
        {!alertShown && (
          <button className="dp-btn atfm-off" onClick={allOff} disabled={busy} title="모든 스위치를 그림자로, 수동 GROUND STOP은 끔">
            ATFM OFF
          </button>
        )}
      </header>
      {error && !alertShown && (
        <p className="dp-error atfm-error" role="alert">
          {error}
        </p>
      )}

      {alertShown ? null : <GroundStopSection atfm={atfm} now={now} />}

      <details className="atfm-sec">
        <summary>
          머지 슬롯 <em>{config.slots === "on" ? "ENFORCED" : MODE_TEXT[config.slots]} · CLEARED PR {brief.slots.length}</em>
        </summary>
        <div className="atfm-switches">
          <Segmented
            label="머지 슬롯"
            value={config.slots}
            options={["off", "shadow", "on"]}
            disabled={busy}
            onPick={(v) => {
              if (v === "on" && !confirm(`머지 슬롯을 켤까요?\n\n${SLOTS_ON_EFFECT}`)) return;
              act("/api/atfm/switch", { key: "slots", value: v });
            }}
          />
          <span className="faint atfm-note">{config.slots === "on" ? "TOWER가 waiting-slot PR에는 LAND를 내지 않는다" : "그림자: 계산해서 보여 주기만, TOWER는 따르지 않는다"}</span>
        </div>
        <SlotFigures lands={brief.data.lands} behind={brief.data.behind} />
        {brief.slots.length ? (
          <ul className="atfm-list">
            {brief.slots.map((s) => (
              <li key={`${s.airport}#${s.pr}`} className={`sl-${s.slot}`}>
                <span className="apt">{aptOf(s.airport)}</span>
                <a className="mono" href={s.url} target="_blank" rel="noreferrer" title={s.title}>
                  #{s.pr}
                </a>
                <span className="atfm-slot">{s.slot === "in-slot" ? "in-slot" : "waiting-slot"}</span>
                {config.slots === "on" && s.slot === "waiting-slot" && <span className="atfm-tag t-on">LAND 보류</span>}
                <span className="mono faint" title="저장소 안 슬롯 순서 / 동시 LAND 수(∞는 제한 없음)">
                  {s.lanePos}/{s.limit ?? "∞"}
                </span>
                {s.urgent && <span className="atfm-tag t-warn">URGENT</span>}
                {s.landTimedOut && (
                  <span className="atfm-tag t-on" title="LAND가 나간 뒤 30분이 지나도 머지되지 않음">
                    LAND 30분 초과{s.landAt && ` · ${s.landAt.slice(11, 16)}Z`}
                  </span>
                )}
                <span className="atfm-text faint">{s.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>CLEARED PR 없음</Empty>
        )}
      </details>

      <AutoSection
        title="자동 배정 대상"
        view={brief.auto}
        caps={`하루 ${brief.caps.assignPerDay}건 · AIRCRAFT당 IN FLIGHT ${brief.caps.inFlightPerAircraft}`}
        withAircraft
      />
      <AutoSection title="S3 대상" view={brief.s3} caps={`하루 ${brief.caps.s3PerDay}건`} />

      <details className="atfm-sec">
        <summary>
          데이터 <em>그림자 판단의 근거</em>
        </summary>
        <ul className="atfm-data">
          <li>
            <span className="atfm-head-mini">CI 중앙값</span>
            {brief.data.ci.length
              ? brief.data.ci.map((c, i) => (
                  <span key={c.airport ?? i} title={`표본 ${c.samples}`}>
                    {i > 0 && <span className="faint"> · </span>}
                    {aptOf(c.airport)} <b>{c.medianMin === null ? "—" : `${c.medianMin}분`}</b>
                  </span>
                ))
              : "—"}
          </li>
          <li>
            <span className="atfm-head-mini">BEHIND/머지</span>
            {brief.data.behind.length
              ? brief.data.behind.map((b, i) => (
                  <span key={b.airport ?? i} title={`머지 ${b.merges} · BEHIND ${b.behind}`}>
                    {i > 0 && <span className="faint"> · </span>}
                    {aptOf(b.airport)} <b>{b.perMerge === null ? "—" : b.perMerge}</b>
                  </span>
                ))
              : "—"}
          </li>
          <li>
            <span className="atfm-head-mini">DIRTY(겹침 예측 가능)</span>
            {brief.data.dirty?.length
              ? brief.data.dirty.map((d, i) => (
                  <span key={d.airport} title="7일 동안 DIRTY가 된 PR 수 / 그때 파일이 겹치는 다른 열린 PR이 있어 DISPATCH가 볼 수 있었던 수">
                    {i > 0 && <span className="faint"> · </span>}
                    {aptOf(d.airport)} <b>{d.seen}/{d.dirty}</b>
                  </span>
                ))
              : "—"}
          </li>
          <li>
            <span className="atfm-head-mini">되돌린 CLASSIFY</span>
            S2로 붙인 라벨이 7일 안에 사라짐 <b>{brief.data.undone}</b>건
          </li>
        </ul>
      </details>
    </section>
  );
}

// GROUND STOP 절: 걸린 것, 켤 수 있는 스위치, 수동 선언, AIRPORT별 main CI. 예외가 있으면 맨 위 AtfmAlert가, 없으면 READINESS 안 패널이 그린다
function GroundStopSection({ atfm, now }: { atfm: AtfmState; now: number }) {
  const { brief, busy, act } = atfm;
  if (!brief) return null;
  const { config, mains, groundStops } = brief;
  const setSwitch = (key: string, name: string, value: string, effect = ON_EFFECT) => {
    if (value === "on" && !confirm(`${name} GROUND STOP을 켤까요?\n\n${effect}`)) return;
    act("/api/atfm/switch", { key, value });
  };
  const airports = [...new Set(mains.map((m) => m.airport).filter((a): a is string => !!a))].sort();

  return (
    <details className="atfm-sec" open>
      <summary>
        GROUND STOP <em>{groundStops.length ? `${groundStops.length}건` : "없음"}</em>
      </summary>
      {groundStops.length ? (
        <ul className="atfm-list">
          {groundStops.map((s) => {
            const on = s.enforced && s.kind === "stop";
            const tag = on ? (s.land === false ? "ENFORCED · ASSIGN" : "ENFORCED") : s.enforced ? "GROUND DELAY" : "그림자";
            return (
              <li key={`${s.airport}|${s.trigger}|${s.text}`} className={on ? "is-enforced" : "is-shadow"} title={s.evidence.join("\n") || undefined}>
                <span className={`atfm-tag${on ? " t-on" : s.enforced ? " t-warn" : ""}`}>{tag}</span>
                <span className="apt">{s.airport}</span>
                <span className="atfm-trigger">{TRIGGER_TEXT[s.trigger] ?? s.trigger}</span>
                <span className="atfm-text">
                  {s.text}
                  {s.releasing && <span className="faint atfm-release"> · 해제 대기: {s.releasing}</span>}
                </span>
                <time className="faint atfm-at" dateTime={s.since}>
                  {timeAgo(s.since, now)}
                </time>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>출발 중지 없음</Empty>
      )}

      <div className="atfm-switches">
        <Segmented
          label="main 깨짐"
          value={config.groundStop.mainBroken}
          options={["off", "shadow", "on"]}
          disabled={busy}
          onPick={(v) => setSwitch("groundStop.mainBroken", "main 깨짐", v)}
        />
        <Segmented label="수동" value={config.groundStop.manual} options={["off", "on"]} disabled={busy} onPick={(v) => setSwitch("groundStop.manual", "수동", v)} />
        {(
          [
            ["groundStop.failureWave", "CI 실패 몰림", config.groundStop.failureWave, WAVE_ON_EFFECT],
            ["groundStop.congestion", "CI 혼잡", config.groundStop.congestion, CONGESTION_ON_EFFECT],
            ["groundStop.los", "LOS 증가", config.groundStop.los, LOS_ON_EFFECT],
          ] as const
        ).map(([key, name, v, effect]) => (
          <Segmented key={key} label={name} value={v} options={["off", "shadow", "on"]} disabled={busy} onPick={(x) => setSwitch(key, name, x, effect)} />
        ))}
      </div>

      {config.groundStop.manual === "on" && <ManualForm airports={airports} busy={busy} onSubmit={(airport, reason) => act("/api/atfm/stops", { airport, reason })} />}
      {config.manualStops.length > 0 && (
        <ul className="atfm-list atfm-manual">
          {config.manualStops.map((m) => (
            <li key={m.airport}>
              <span className="atfm-tag">수동</span>
              <span className="apt">{m.airport}</span>
              <span className="atfm-text">{m.reason}</span>
              <time className="faint atfm-at" dateTime={m.at}>
                {timeAgo(m.at, now)}
              </time>
              <button className="dp-btn atfm-mini" disabled={busy} aria-label={`${m.airport} 수동 GROUND STOP 풀기`} onClick={() => act(`/api/atfm/stops/${encodeURIComponent(m.airport)}/release`, {})}>
                풀기
              </button>
            </li>
          ))}
        </ul>
      )}

      {mains.length > 0 && (
        <p className="atfm-mains" aria-label="AIRPORT별 main CI">
          <span className="atfm-head-mini">main CI</span>
          {mains.map((m) => (
            <span
              key={`${m.repo}@${m.branch}`}
              className={`atfm-main c-${m.state}`}
              title={`${m.slug} ${m.branch}${m.sha ? ` @${m.sha.slice(0, 7)}` : ""} · 체크 ${m.checks}${m.failing.length ? `\n실패: ${m.failing.join(", ")}` : ""}`}
            >
              <b>{m.airport ?? m.slug}</b> {MAIN_TEXT[m.state]}
            </span>
          ))}
        </p>
      )}
    </details>
  );
}

// 켤 수 있는 스위치: 버튼 묶음(aria-pressed)
// 머지 슬롯 켜기 판단(7일): 같은 저장소에서 동시에 살아 있던 LAND와 머지마다 BEHIND가 된 PR(docs/atfm.md 5장 Turn-on)
function SlotFigures({ lands, behind }: { lands: AtfmBrief["data"]["lands"]; behind: AtfmBrief["data"]["behind"] }) {
  const airports = [...new Set([...lands.map((l) => l.airport), ...behind.filter((b) => b.merges > 0).map((b) => b.airport ?? "")])].filter(Boolean).sort();
  return (
    <div className="atfm-figures">
      <span className="atfm-head-mini">켜기 판단 (7일)</span>
      {airports.length ? (
        <ul className="atfm-list">
          {airports.map((a) => {
            const l = lands.find((x) => x.airport === a);
            const b = behind.find((x) => x.airport === a);
            return (
              <li key={a}>
                <span className="apt">{a}</span>
                <span className="tn" title="같은 저장소의 다른 LAND와 겹쳐 살아 있던 LAND / 나간 LAND">
                  동시 LAND {l ? `${l.concurrent}/${l.lands}` : "0/0"}
                </span>
                <span className="tn faint" title="LAND에서 머지까지 중앙값 · LAND 뒤 30분 안에 머지되지 않은 LAND">
                  LAND→머지 {l?.mergedMedianMin == null ? "—" : `${l.mergedMedianMin}분`} · 30분 초과 {l?.timeouts ?? 0} ·
                </span>
                <span className="tn faint" title={b ? `머지 ${b.merges} · BEHIND ${b.behind}` : undefined}>
                  BEHIND/머지 {b?.perMerge == null ? "—" : b.perMerge}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>7일 동안 LAND·머지 없음</Empty>
      )}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, disabled, onPick }: { label: string; value: T; options: readonly T[]; disabled?: boolean; onPick: (v: T) => void }) {
  return (
    <span className="atfm-seg" role="group" aria-label={`${label} 스위치`}>
      <span className="atfm-seg-label">{label}</span>
      {options.map((o) => (
        <button key={o} type="button" className={`atfm-seg-btn m-${o}`} aria-pressed={o === value} disabled={disabled} onClick={() => o !== value && onPick(o)}>
          {MODE_TEXT[o as StopMode] ?? o}
        </button>
      ))}
    </span>
  );
}

// 수동 GROUND STOP 선언: AIRPORT와 사유
function ManualForm({ airports, busy, onSubmit }: { airports: string[]; busy: boolean; onSubmit: (airport: string, reason: string) => Promise<boolean> }) {
  const [airport, setAirport] = useState("");
  const [reason, setReason] = useState("");
  const pick = airport || airports[0] || "";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick || busy) return;
    if (!confirm(`${pick}에 수동 GROUND STOP을 선언할까요?\n\n${ON_EFFECT}`)) return;
    if (await onSubmit(pick, reason.trim())) setReason("");
  };
  return (
    <form className="atfm-form" onSubmit={submit} aria-label="수동 GROUND STOP 선언">
      <select className="dp-input" aria-label="AIRPORT" value={pick} onChange={(e) => setAirport(e.target.value)} disabled={!airports.length}>
        {airports.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <input className="dp-input atfm-reason" aria-label="사유" placeholder="사유 (예: 배포 동결)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="submit" className="dp-btn atfm-mini t-stop" disabled={busy || !pick}>
        선언
      </button>
    </form>
  );
}

// 자동 배정·S3 대상(그림자): 건수, precision, 열린 항목, 켜기 점검
function AutoSection({ title, view, caps, withAircraft }: { title: string; view: AutoView; caps: string; withAircraft?: boolean }) {
  const eligible = view.open.filter((o) => o.eligible).length;
  const p = view.precision;
  return (
    <details className="atfm-sec">
      <summary>
        {title} <em>{MODE_TEXT[view.mode]} · 대상 {eligible}/{view.open.length}</em>
      </summary>
      <p className="atfm-line">
        판정 {p.decided}, 승인 {p.approved} ({pct(p.rate)}) · 대상이 된 적 {p.eligible} · 막았어야 할 거절 <b className={p.bad ? "atfm-bad" : undefined}>{p.bad}</b>
        <span className="faint"> · 상한 {caps}</span>
      </p>
      {view.open.length > 0 && (
        <ul className="atfm-list">
          {view.open.map((o) => (
            <li key={o.id}>
              <span className="mono faint">{o.id}</span>
              <span className="mono">{o.flight ? flightNumber(o.flight) : "—"}</span>
              {withAircraft && <span>{o.aircraft ?? "—"}</span>}
              {o.eligible ? (
                <span className="atfm-ok"><StateMark state="pass">대상</StateMark></span>
              ) : (
                <span className="atfm-codes">
                  {o.failed.map((f) => (
                    <span key={f.code} className="atfm-code" title={f.text}>
                      {f.code}
                      <span className="atfm-sr">: {f.text}</span>
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.turnOn.length > 0 && (
        <ul className="atfm-turn">
          {view.turnOn.map((r) => (
            <li key={r.id} className={`s-${r.status}`}>
              <span>{r.label}</span>
              <span className="atfm-turn-value">{r.value}</span>
              <span className="atfm-turn-target">기준 {r.target}</span>
              <span className="atfm-turn-state"><StateMark state={r.status}>{TURN_TEXT[r.status]}</StateMark></span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
