import { Fragment, type ReactNode, useEffect, useState } from "react";
import type { KDay } from "../../server/k-approval.ts";
import type { RemovalStats } from "../../server/removal-rule.ts";
import type { MccGate } from "../../server/mcc.ts";
import type { ServerSettings } from "../../server/settings.ts";
import { modeLine, modeSegments, needsConfirm, recycleAutoGuardOf } from "../../server/settings-policy.ts";
import type { SwitchView } from "../../server/switch-def.ts";
import { timeAgo } from "./derive.ts";
import { Block, EditNote, EditRow, type Save, type SaveResult, ServerRows, type Loaded } from "./SettingsServer.tsx";
import { apiGet, apiSend } from "./api.ts";

// 설정 창의 AUTOMATION 묶음(ATC-131): SUPERVISOR 정책 스위치. LANDING(AUTOLAND, MCC, REVIEW, CODEX LANE)과 OPERATIONS(FUEL, REPOSITION, CONTROL RECYCLE, JUDGES) 두 분류로 나눠 보이고, 둘 다 맨 위에 지금 모드 한 줄.
// ⚠ 모드로 올릴 때는 그 모드의 경고를 보이고 확인 버튼을 거친다(EditRow guard). 내리는 것은 전과 같이 저장한다.
// 저장 값과 PUT /api/settings는 그대로다. 관제 세션은 이 스위치를 못 바꾼다.
// 스위치 줄·값·경고·⚠ 모드는 서버의 선언(server/switches/, GET /api/settings의 switches)을 그대로 그린다(ATC-393): 스위치를 더해도 이 파일을 고치지 않는다.
// 아래 EXTRAS는 그 스위치 줄 뒤에 붙는 자기 데이터가 있는 화면(GROUND STOP, 세션별 CAP …)이고, 없는 스위치는 줄만 그려진다.

// 그림자 기록(ATC-233): OCC가 본 요청 수, 만들었을 초안, 그 뒤 SUPERVISOR가 직접 낸 첫 NEW 초안
interface CharterRecord {
  mode: string;
  shadowRecord: { seen: number; queued: number; items: { id: string; at: string; text: string; would: string; laterNew: { id: string; title: string } | null }[] };
}
function CharterShadowRecord({ mode }: { mode: string }) {
  const [rec, setRec] = useState<CharterRecord | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet("/api/duty/charters")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CharterRecord) => alive && setRec(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode]);
  if (!rec) return null;
  const r = rec.shadowRecord;
  return (
    <div className="config-note" aria-label="DUTY CHARTER 그림자 기록">
      <p>
        그림자 기록: 줄에 선 요청 {r.queued}건 중 OCC가 본 것 {r.seen}건. 기준 숫자는 아직 없다(SUPERVISOR가 만족하면 on으로 올리고 Linear에 적는다).
      </p>
      {r.items.length > 0 && (
        <ul className="config-list">
          {r.items.map((i) => (
            <li key={i.id}>
              <code>{i.id}</code> {i.text}
              <br />
              OCC가 만들었을 초안: {i.would}
              <br />
              {i.laterNew ? (
                <>
                  이후 SUPERVISOR가 낸 NEW 초안: <code>{i.laterNew.id}</code> {i.laterNew.title}
                </>
              ) : (
                "이후 SUPERVISOR가 낸 NEW 초안: 없음"
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// AUTOLAND GROUND STOP: main의 post-merge 체크(applicationCheck: 체크 런 이름이나 워크플로 이름)가 빨가 두 모드가 멈춤. SUPERVISOR가 확인하고 푼다
function GroundStopRow({ stop, check, refresh }: { stop: ServerSettings["autoland"]["groundStops"][number]; check: string; refresh: () => Promise<SaveResult> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend("POST", "/api/autoland/groundstop/clear", { airport: stop.airport });
      if (res.ok) await refresh();
      else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
    setBusy(false);
  };
  return (
    <div className="config-row">
      <dt>
        GROUND STOP <code className="config-env">{stop.airport}</code>
      </dt>
      <dd>
        <button className="btn is-danger" onClick={() => void clear()} disabled={busy}>
          풀기
        </button>
      </dd>
      <p className="config-note is-error">
        {error ?? `main ${stop.failing.join(", ") || check} 실패(${stop.sha.slice(0, 7)}) — AUTOLAND 두 모드 모두 멈춤. main을 확인한 뒤 SUPERVISOR가 푼다`}
      </p>
    </div>
  );
}

// MCC SHADOW GATE(docs/mcc.md 9장): land로 올릴 근거. 읽기만 — 모드는 위 MCC 줄에서 SUPERVISOR가 바꾼다
type GateLoaded = { state: "loading" } | { state: "error"; error: string } | { state: "ready"; gate: MccGate & { error: string | null } };
const GATE_MISS: Record<MccGate["misses"][number]["kind"], string> = { findings: "findings", "no-inspection": "no-inspection", "reverted-would-land": "reverted" };
const MISS_SHOWN = 8;
function MccGatePanel() {
  const [g, setG] = useState<GateLoaded>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    apiGet("/api/mcc/gate")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`)))
      .then((gate: MccGate & { error: string | null }) => alive && setG({ state: "ready", gate }))
      .catch((e) => alive && setG({ state: "error", error: typeof e === "string" ? e : "서버에 연결할 수 없음" }));
    return () => {
      alive = false;
    };
  }, []);
  if (g.state === "loading") return <p className="settings-hint">SHADOW GATE 계산 중…</p>;
  if (g.state === "error") return <p className="conn-error">SHADOW GATE를 읽지 못함(/api/mcc/gate) — {g.error}</p>;
  const x = g.gate;
  const started = x.since !== null;
  const rows = [
    { label: "판단한 atc PR", note: "머지된 head에 INSPECTION·ESCALATE", value: `${x.prs}건`, target: `≥ ${x.target.prs}건`, state: x.prs >= x.target.prs ? "pass" : "fail" },
    { label: "shadow 기간", note: "첫 MCC 기록부터", value: `${x.days}일`, target: `≥ ${x.target.days}일`, state: x.days >= x.target.days ? "pass" : "fail" },
    { label: "would-land 되돌림", note: "would-land·LANDED였는데 되돌린 PR", value: `${x.reverted}건`, target: `${x.target.reverted}건`, state: !x.wouldLand ? "insufficient" : x.reverted <= x.target.reverted ? "pass" : "fail" },
  ] as const;
  const mark = { pass: "✓ 충족", fail: "✗ 미달", insufficient: "○ 데이터 부족" } as const;
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = (iso: string) => {
    const d = new Date(iso);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return (
    <div className="mcc-gate">
      <h4 className="label">
        SHADOW GATE <em>land로 올리기 전 점검 · {x.ready ? "준비됨" : "아직"}</em>
      </h4>
      {!started ? (
        <p className="mcc-gate-note">아직 MCC 기록이 없음 — MCC가 INSPECTION을 남기면 그때부터 잰다</p>
      ) : (
        <>
          <ul>
            {rows.map((r) => (
              <li key={r.label} className={`s-${r.state}`}>
                <span className="mcc-gate-label" title={r.note}>
                  {r.label}
                </span>
                <span className="mcc-gate-value">{r.value}</span>
                <span className="mcc-gate-target">{r.target}</span>
                <span className="mcc-gate-state">{mark[r.state]}</span>
              </li>
            ))}
          </ul>
          <p className="mcc-gate-note">
            {x.airport} · {clock(x.since!)}부터 머지 {x.merged}건 · would-land {x.wouldLand}건 · 불일치 {x.misses.length}건. 불일치는 SUPERVISOR가 사유를 보고 판단한다. 충족돼도 모드는 위 MCC 줄에서 직접 올린다
          </p>
          {x.misses.length > 0 && (
            <ul className="mcc-gate-misses">
              {x.misses.slice(0, MISS_SHOWN).map((m) => (
                <li key={`${m.pr}-${m.kind}`} className={`k-${m.kind}`}>
                  <a href={m.url} target="_blank" rel="noreferrer">
                    #{m.pr}
                  </a>
                  <b>{GATE_MISS[m.kind]}</b>
                  <span title={m.title}>{m.text}</span>
                </li>
              ))}
              {x.misses.length > MISS_SHOWN && <li className="mcc-gate-more">외 {x.misses.length - MISS_SHOWN}건 — /api/mcc/gate</li>}
            </ul>
          )}
        </>
      )}
      {x.error && <p className="conn-error">{x.error} — head 없이 머지 전 마지막 INSPECTION으로 맞춤</p>}
    </div>
  );
}

// 지금 모드의 경고 한 줄만 보이고 나머지는 접는다. 고르는 중인 모드의 줄은 EditRow가 보인다
function ModeLines<T extends string>({ modes, current, lines }: { modes: readonly T[]; current: T; lines: Record<T, string> }) {
  const others = modes.filter((m) => m !== current);
  return (
    <>
      <ul className="autoland-modes">
        <li className="is-current">
          <b>{current}</b> {lines[current]}
        </li>
      </ul>
      {others.length > 0 && (
        <details className="mode-others">
          <summary>다른 모드 {others.length}개</summary>
          <ul className="autoland-modes">
            {others.map((m) => (
              <li key={m}>
                <b>{m}</b> {lines[m]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

// 세션마다 지금 컨텍스트와 CAP(k 토큰). 컨텍스트는 대화 기록의 마지막 요청(mcc/context-cap.mjs와 같은 합). 0이면 그 세션은 재시작하지 않는다
type RecycleView = { sessions: { name: string; cap: number | null; auto: boolean; context: number | null; over: boolean; running: boolean }[]; recycling: string | null; recent: { t: string; session: string; result: string; mode: string; contextBefore: number }[] };
const kOf = (n: number | null) => (n === null ? "—" : `${Math.round(n / 1000)}k`);
function RecycleSessions({ caps, auto, save }: { caps: Record<string, number | null>; auto: Record<string, boolean>; save: Save }) {
  const [v, setV] = useState<RecycleView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      apiGet("/api/control/recycle")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((x: RecycleView) => alive && (setV(x), setErr(null)))
        .catch((e) => alive && setErr(e instanceof Error ? e.message : "읽지 못함"));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [caps, auto]);
  if (err) return <p className="conn-error">컨텍스트를 읽지 못함(/api/control/recycle) — {err}</p>;
  if (!v) return <p className="settings-hint">컨텍스트 읽는 중…</p>;
  return (
    <>
      {v.sessions.map((x) => (
        <Fragment key={x.name}>
        <EditRow
          label={x.name}
          env="cap"
          value={x.cap === null ? "0" : String(Math.round(x.cap / 1000))}
          unit="k 토큰"
          note={`지금 컨텍스트 ${kOf(x.context)}${x.running ? "" : " (세션 없음)"} · CAP ${x.cap === null ? "없음(0)" : kOf(x.cap)}${x.over ? " · CAP 초과" : ""}${v.recycling === x.name ? " · 재시작 중" : ""}`}
          input={{ kind: "number", min: 0, max: 900 }}
          onSave={(t) => save({ controlRecycleCaps: { [x.name]: Number(t) === 0 ? null : Number(t) * 1000 } })}
        />
        <EditRow
          label={`${x.name} 재시작`}
          env="auto"
          value={x.auto ? "auto" : "alert"}
          note={x.auto ? "CAP을 넘으면 atc가 안전한 순간에 재시작한다(스위치가 shadow·on일 때)" : "CAP을 넘어도 재시작하지 않고 알림만 한다(OCC: 미기록 CAPTAIN 보고 틈이 닫힐 때까지)"}
          input={{ kind: "select", options: ["auto", "alert"], labels: { auto: "auto (재시작)", alert: "alert (알림만)" } }}
          guard={(to) => recycleAutoGuardOf(x.name, x.auto, to === "auto" ? "auto" : "alert")}
          onSave={(t) => save({ controlRecycleAuto: { [x.name]: t === "auto" } })}
        />
        </Fragment>
      ))}
      {v.recent.length > 0 && (
        <details className="mode-others">
          <summary>최근 24시간 재시작 기록 {v.recent.length}건</summary>
          <ul className="autoland-modes">
            {v.recent.map((r) => (
              <li key={`${r.t}${r.session}`}>
                <b>{r.session}</b> {r.result}
                {r.mode === "shadow" ? "(shadow)" : ""} · {kOf(r.contextBefore)} · {timeAgo(r.t, Date.now())}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

// DUTY ACCOUNT(ATC-242, docs/duty.md): DUTY가 돌 ACCOUNT. 바꾸면 다음 메시지부터 새 ACCOUNT의 새 대화(--resume은 폴더를 넘지 못한다).
// 로그인 안 된 ACCOUNT는 고를 수 없다. FUEL hold는 고를 수 있고 경고만 한다(DUTY는 SUPERVISOR의 글에만 돈다: 막으면 DUTY가 아예 없을 수 있다).
interface DutyAccountChoice {
  label: string;
  loggedIn: boolean | null;
  refused: string | null;
}
function DutyAccountRow({ current, warning, save }: { current: string; warning: string | null; save: Save }) {
  const [accounts, setAccounts] = useState<DutyAccountChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet("/api/fleet/launch-accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { accounts: DutyAccountChoice[] }) => alive && setAccounts(d.accounts))
      .catch(() => alive && setAccounts([]));
    return () => {
      alive = false;
    };
  }, [current]);
  const change = async (label: string) => {
    setBusy(true);
    setError(null);
    const res = await save({ dutyAccount: label });
    setBusy(false);
    if (!res.ok) setError(res.error);
  };
  const cur = accounts?.find((a) => a.label === current);
  const hold = cur?.refused && cur.loggedIn !== false ? cur.refused : null;
  return (
    <>
      <label className="acct-launch-row">
        <span>DUTY ACCOUNT</span>
        <select className="mono" aria-label="DUTY ACCOUNT" value={current} disabled={busy || !accounts?.length} onChange={(e) => void change(e.target.value)}>
          {!accounts?.some((a) => a.label === current) && <option value={current}>{current}</option>}
          {(accounts ?? []).map((a) => (
            <option key={a.label} value={a.label} disabled={a.loggedIn === false && a.label !== current}>
              {a.label}
              {a.loggedIn === false ? " — 로그인되어 있지 않음" : a.refused && a.refused.startsWith("FUEL") ? ` — ⚠ ${a.refused}` : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-hint">
        duty.json · 다음 메시지부터 그 ACCOUNT에서 새 대화로 시작한다(브리프와 decisions는 이어진다, 대화는 NEW SHIFT처럼 새로). 돌고 있는 턴은 옛 ACCOUNT에서 끝난다. 관제 세션의 ACCOUNT는 AGENTS 탭의 LAUNCH ACCOUNT(ATC-239)에서 따로 고른다: DUTY는 LAUNCH하는 세션이 아니라 이 설정을 쓴다.
      </p>
      {hold && <p className="settings-hint acct-err">⚠ {current}: {hold}. DUTY는 SUPERVISOR의 글에만 돌아서 막지는 않는다 — FUEL이 남은 ACCOUNT가 있으면 그쪽을 고른다.</p>}
      {warning && <p className="settings-hint acct-err">⚠ {warning}</p>}
      {error && <p className="settings-hint acct-err">{error}</p>}
    </>
  );
}

// 고르는 중인 값의 경고 줄과, ⚠ 모드로 올리는 것이라 확인이 필요한지(선언의 warn·risky)
const guardOf = (sw: SwitchView) => (to: string) => (sw.warn[to] ? { line: `${to} ${sw.warn[to]}`, warn: needsConfirm(sw, sw.value, to) } : null);

// 선언된 스위치 하나: 줄(EditRow)과 값마다 한 줄 경고(ModeLines). 보이는 이름만 있는 값은 display
function SwitchRow({ sw, save }: { sw: SwitchView; save: Save }) {
  if (!sw.row) return null;
  return (
    <>
      <EditRow
        label={sw.row.label}
        env={sw.row.env}
        value={sw.value}
        note={sw.row.note}
        input={{ kind: "select", options: [...sw.values], ...(Object.keys(sw.display).length ? { labels: sw.display } : {}) }}
        guard={guardOf(sw)}
        onSave={(v) => save({ [sw.key]: v })}
      />
      <ModeLines modes={sw.values} current={sw.value} lines={sw.warn} />
    </>
  );
}

// 마이그레이션 리허설(ATC-368): AIRPORT마다 줄 하나. 자료(data)는 스위치 선언이 준다
interface MigrateView {
  tokenSet: boolean;
  airports: { code: string; enabled: boolean; why: string | null }[];
}
function MigrateRows({ sw, save }: { sw: SwitchView; save: Save }) {
  const m = sw.data as MigrateView;
  return (
    <>
      {m.airports.length === 0 && <p className="mcc-gate-note">hostedDb가 있는 AIRPORT 없음(airports.json)</p>}
      {m.airports.map((a) => (
        <EditRow
          key={a.code}
          label={a.code}
          env={`migrate.${a.code}`}
          value={a.enabled ? "on" : "off"}
          note={
            a.why
              ? `켤 수 없음 — ${a.why}`
              : "⚠ 켜면 AUTOLAND 주기가 CLEARED PR의 새 마이그레이션을 시험 DB에 먼저 적용하고, 통과하면 호스팅 제공자에 이미 있는 PITR·최근 백업을 확인한 뒤(atc가 만들지 않음) 실전 DB에 적용한다. 실전 적용 전의 실패는 실전이 그대로이고 PR은 머지되지 않는다. 실전 적용이 중간에 실패하거나 적용 뒤 검사가 실패하면 실전이 바뀐 채로 남고(live-changed, 자동 복원 없음) 사람이 복원을 정한다. 시험 DB는 실패해도 되돌리지 않아, 다음 리허설 전에 실전에서 다시 가져와야 한다. 이 화면에서만 바꾼다 — 세션은 못 바꿈"
          }
          input={{ kind: "select", options: ["off", "on"] }}
          onSave={(v) => save({ migrateRehearsal: { [a.code]: v === "on" } })}
        />
      ))}
    </>
  );
}
// 기본 줄(EditRow 하나) 대신 자기 줄을 그리는 스위치. 키는 스위치 key
// DUTY 컨텍스트 CAP(ATC-496, docs/duty.md): 머리줄의 `context 365k/…k`가 쓰는 CAP. 비우면(0) 모델로 정한다([1m]이면 1000k, 아니면 250k)
type DutyCapData = { cap: number; source: "duty.json" | "model" | "default"; note: string | null; model: string | null; configured: number | null };
const CAP_SOURCE: Record<DutyCapData["source"], string> = { "duty.json": "duty.json의 cap", model: "모델로 정함([1m])", default: "기본값" };
function DutyCapRow({ sw, save }: { sw: SwitchView; save: Save }) {
  const d = sw.data as DutyCapData | undefined;
  if (!d) return null;
  return (
    <>
      <EditRow
        label="DUTY CAP"
        env="duty.cap"
        value={d.configured === null ? "0" : String(Math.round(d.configured / 1000))}
        unit="k 토큰"
        note={`지금 CAP ${kOf(d.cap)} (${CAP_SOURCE[d.source]})${d.model ? ` · 모델 ${d.model}` : " · 모델 아직 모름"} · 0이면 모델로 정한다`}
        input={{ kind: "number", min: 0, max: 1000 }}
        onSave={(t) => save({ [sw.key]: Number(t) === 0 ? null : Number(t) * 1000 })}
      />
      {d.note && <p className="settings-hint acct-err">⚠ {d.note}</p>}
    </>
  );
}

const CUSTOM_ROWS: Record<string, (sw: SwitchView, save: Save) => ReactNode> = {
  migrateRehearsal: (sw, save) => <MigrateRows sw={sw} save={save} />,
  dutyCap: (sw, save) => <DutyCapRow sw={sw} save={save} />,
};

// 스위치 줄 뒤에 붙는, 자기 데이터가 있는 화면. 키는 스위치 key
// DUTY REVIEW 기록(ATC-396): 마지막 점검과 하루 세기(점검, 만든 제안, 발권된 제안, 버려진 제안)
interface ReviewView {
  on: boolean;
  dutyEnabled: boolean;
  linear: boolean;
  last: { id: string; at: string; trigger: string; detail: string } | null;
  days: { day: string; reviews: number; proposals: number; fired: number; discarded: number }[];
  empty?: { on: boolean; reviews: number; wasted: number; discarded: number };
}
// empty 트리거의 오발 세기(ATC-470): 헛턴(READY도 안 짚고 이슈도 안 올림)과 올린 이슈가 버려진 점검
function EmptyReviewRecord({ on }: { on: boolean }) {
  const [v, setV] = useState<ReviewView["empty"] | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet("/api/duty/review")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ReviewView) => alive && setV(d.empty ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [on]);
  if (!v) return null;
  return (
    <div className="config-note" aria-label="DUTY REVIEW EMPTY 오발">
      <p>
        empty 점검 {v.reviews} · 헛턴 {v.wasted} · 이슈가 버려진 점검 {v.discarded}
      </p>
    </div>
  );
}
function DutyReviewRecord({ on }: { on: boolean }) {
  const [v, setV] = useState<ReviewView | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet("/api/duty/review")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ReviewView) => alive && setV(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [on]);
  if (!v) return null;
  const days = v.days.slice(-7);
  return (
    <div className="config-note" aria-label="DUTY REVIEW 기록">
      <p>
        {v.last ? `마지막 점검 ${v.last.id} · ${v.last.trigger} · ${v.last.detail}` : "아직 점검한 적 없음"}
        {!v.dutyEnabled && " · DUTY가 꺼져 있어 돌지 않는다"}
        {v.dutyEnabled && !v.linear && " · Linear 쓰기(duty.json l1)가 꺼져 있어 제안은 채팅 요약에만 남는다"}
      </p>
      {days.length > 0 && (
        <ul className="config-list" aria-label="하루 세기(Z)">
          {days.map((d) => (
            <li key={d.day}>
              <code>{d.day}</code> 점검 {d.reviews} · 제안 {d.proposals} · 발권 {d.fired} · 버림 {d.discarded}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// AUTO REVERT 하루 세기(ATC-394): 최근 7일의 revert·flake 잡음·misfire와 알림·멈춤 수. 자료는 스위치 선언의 data가 준다
interface RevertDayView {
  day: string;
  reverts: number;
  flakes: number;
  misfires: number;
  holds: number;
  stops: number;
}
function AutoRevertDays({ days }: { days: RevertDayView[] }) {
  const shown = [...days].reverse().filter((d) => d.reverts + d.flakes + d.misfires + d.holds + d.stops > 0);
  if (!shown.length) return null;
  return (
    <ul className="dp-misfire">
      {shown.map((d) => (
        <li key={d.day}>
          <span className="mono">{d.day}</span> revert <b>{d.reverts}</b> · flake 잡음 <b>{d.flakes}</b> · misfire <b>{d.misfires}</b>
          {d.holds + d.stops > 0 ? <span className="faint"> — 알림 {d.holds} · 멈춤 {d.stops}</span> : null}
        </li>
      ))}
    </ul>
  );
}
function KApprovalDays({ days }: { days: KDay[] }) {
  const shown = [...days].reverse().filter((d) => d.landed > 0);
  if (!shown.length) return null;
  return (
    <ul className="dp-misfire">
      {shown.map((d) => (
        <li key={d.day}>
          <span className="mono">{d.day}</span> K 승인 착륙 <b>{d.landed}</b> · revert <b>{d.reverted}</b> · ROLLBACK <b>{d.rolledBack}</b>
        </li>
      ))}
    </ul>
  );
}
// 지우기 규칙(ATC-495)의 숫자: 총 ESCALATE 수는 늘 보여, 오작동 0이 "한 번도 안 울렸다"로 읽히지 않게 한다
function RemovalGuardStats({ d }: { d: RemovalStats & { headsKnown: boolean } }) {
  return (
    <ul className="dp-misfire">
      <li>
        지우기 ESCALATE 전체 <b>{d.total}</b> · 최근 7일 <b>{d.last7d}</b>
      </li>
      <li>
        오작동(같은 head 그대로 착륙) <b>{d.misfires}</b>
        <span className="faint">
          {" "}
          — head가 바뀐 뒤 머지 {d.changed} · 대기 {d.waiting} · MCC 착륙 {d.landedByMcc}
          {d.headsKnown ? "" : " · 머지 head는 MCC 큐를 읽은 뒤 알 수 있음"}
        </span>
      </li>
    </ul>
  );
}
// VERIFY GATE 세기(ATC-517): 줄 선 실행·가장 긴 기다림·한도 실패·바로 실행·죽은 명령이 놓은 슬롯. 0도 보여 "한 번도 안 울렸다"와 구분한다
interface GateCounts {
  runs: number;
  waited: number;
  longestWaitMs: number;
  waitLimitFails: number;
  fallbacks: number;
  killedReleases: number;
  desktopRuns: number;
  transportFailed: number;
  remoteCommandFails: number;
  localFallbacks: Record<"desktop-absent" | "transport-error" | "not-listed" | "switch-off", number>;
  lostMidway: number;
}
interface VerifyGateData {
  total: GateCounts;
  last7d: GateCounts;
  slots: number;
  waitLimitSec: number;
  testConcurrency: number;
  where: string;
  remote: { mode: "on" | "off"; configured: boolean; probeSec: number };
  repos?: RepoCount[];
}
// 저장소별 실행 수(ATC-526): 폴더 이름만. 기록이 없으면 줄을 그리지 않는다
interface RepoCount {
  repo: string;
  total: number;
  last7d: number;
}
function RepoCounts({ repos, noun }: { repos?: RepoCount[]; noun: string }) {
  if (!repos || repos.length === 0) return null;
  return (
    <li>
      저장소별 {noun}(전체 / 최근 7일):{" "}
      {repos.map((r, i) => (
        <span key={r.repo}>
          {i > 0 ? " · " : ""}
          {r.repo} <b>{r.total}</b> / <b>{r.last7d}</b>
        </span>
      ))}
    </li>
  );
}
function VerifyGateStats({ d }: { d: VerifyGateData }) {
  const row = (label: string, c: GateCounts) => (
    <li>
      {label} 실행 <b>{c.runs}</b> · 줄 섬 <b>{c.waited}</b> · 가장 긴 기다림 <b>{Math.round(c.longestWaitMs / 1000)}초</b> · 한도 실패 <b>{c.waitLimitFails}</b> · 바로 실행(문 고장) <b>{c.fallbacks}</b> · 죽은 명령이 놓은 슬롯 <b>{c.killedReleases}</b>
    </li>
  );
  // 데스크톱 실행(ATC-518): 0도 보여 "한 번도 안 일어났다"와 구분한다
  const remoteRow = (label: string, c: GateCounts) => (
    <li>
      {label} 데스크톱 <b>{c.desktopRuns}</b> · 전송 실패 <b>{c.transportFailed}</b> · 데스크톱에서 명령 실패 <b>{c.remoteCommandFails}</b> · 도중에 잃음 <b>{c.lostMidway}</b> · 로컬로 돈 사유: 데스크톱 없음 <b>{c.localFallbacks["desktop-absent"]}</b> · 전송 오류 <b>{c.localFallbacks["transport-error"]}</b> · 목록에 없음 <b>{c.localFallbacks["not-listed"]}</b> · 스위치 꺼짐 <b>{c.localFallbacks["switch-off"]}</b>
    </li>
  );
  return (
    <ul className="dp-misfire">
      {row("전체", d.total)}
      {row("최근 7일", d.last7d)}
      {remoteRow("전체", d.total)}
      {remoteRow("최근 7일", d.last7d)}
      <RepoCounts repos={d.repos} noun="실행" />
      <li className="faint">
        동시 {d.slots}건 · 기다림 한도 {Math.round(d.waitLimitSec / 60)}분 · node --test 프로세스 {d.testConcurrency}개 · 실행 위치 {d.where} · 원격 {d.remote.mode} · 데스크톱 접속 정보 {d.remote.configured ? "있음" : "없음"} · 닿는지 보는 한도 {d.remote.probeSec}초
      </li>
    </ul>
  );
}
// BROWSER GATE 세기(ATC-520): 기다린 요청·가장 긴 기다림·busy 답·세션이 끝난 뒤 놓은 슬롯·바로 띄운 수. 0도 보여 "한 번도 안 울렸다"와 구분한다
interface BrowserCounts {
  requests: number;
  waited: number;
  longestWaitMs: number;
  busyAnswers: number;
  releasedAfterEnd: number;
  fallbacks: number;
}
interface BrowserGateData {
  total: BrowserCounts;
  last7d: BrowserCounts;
  slots: number;
  waitLimitSec: number;
  where: string;
  repos?: RepoCount[];
}
function BrowserGateStats({ d }: { d: BrowserGateData }) {
  const row = (label: string, c: BrowserCounts) => (
    <li>
      {label} 요청 <b>{c.requests}</b> · 기다림 <b>{c.waited}</b> · 가장 긴 기다림 <b>{Math.round(c.longestWaitMs / 1000)}초</b> · busy 답 <b>{c.busyAnswers}</b> · 세션이 끝난 뒤 놓은 슬롯 <b>{c.releasedAfterEnd}</b> · 바로 실행(문 고장) <b>{c.fallbacks}</b>
    </li>
  );
  return (
    <ul className="dp-misfire">
      {row("전체", d.total)}
      {row("최근 7일", d.last7d)}
      <RepoCounts repos={d.repos} noun="요청" />
      <li className="faint">
        동시 {d.slots}개 · busy 답까지 {d.waitLimitSec}초 · 실행 위치 {d.where}
      </li>
    </ul>
  );
}
// AUTOLAND 넘김 세기(ATC-513): 넘긴 (PR, head) 수, (a) SUPERVISOR 몫 LANDING 줄이 머지 없이 닫힌 PR 수, (b) 넘겼는데도 팀으로 나간 LAND 수(0이어야 한다). 0도 보여 "한 번도 안 울렸다"와 구분한다
interface HandoffCounts {
  marked: number;
  closedWithoutMerge: number;
  landSent: number;
}
interface HandoffData {
  total: HandoffCounts;
  last7d: HandoffCounts;
}
function HandoffStats({ d }: { d: HandoffData }) {
  const row = (label: string, c: HandoffCounts) => (
    <li>
      {label} 넘김 <b>{c.marked}</b> · 머지 없이 닫힘 <b>{c.closedWithoutMerge}</b> · 그래도 팀으로 나간 LAND <b>{c.landSent}</b>
    </li>
  );
  return (
    <ul className="dp-misfire">
      {row("전체", d.total)}
      {row("최근 7일", d.last7d)}
      <li className="faint">팀으로 나간 LAND는 0이어야 한다. 0이 아니면 TOWER가 이 규칙을 따르지 않은 것이다.</li>
    </ul>
  );
}

// CONTROL STOP CHECK(ATC-521): 막은 STOP·중복 경고 수와 틀린 판정(오탐) 수, 열린 중복, 최근 결정(오탐 표시 단추). 서버가 센 것을 그대로 그린다
interface StopCheckCounts {
  blocked: number;
  duplicates: number;
  dismissed: number;
  contradicted: number;
  falseAlarms: number;
  share: number | null;
}
interface StopCheckData {
  last7d: StopCheckCounts;
  last30d: StopCheckCounts;
  open: { control: string; jobs: { id: string; account: string | null; state: string | null }[] }[];
  recent: { t: string; event: "blocked" | "duplicate"; session: string; jobIds: string[]; detail?: string; marked: boolean }[];
}
function StopCheckStats({ d, refresh }: { d: StopCheckData; refresh: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const row = (label: string, c: StopCheckCounts) => (
    <li>
      {label} 막은 STOP <b>{c.blocked}</b> · 중복 경고 <b>{c.duplicates}</b> · SUPERVISOR가 오탐 표시 <b>{c.dismissed}</b> · 검사가 나중에 틀렸다고 드러난 것 <b>{c.contradicted}</b> · 오탐 몫 <b>{c.share === null ? "—" : `${Math.round(c.share * 100)}%`}</b>
    </li>
  );
  const dismiss = async (t: string) => {
    setError(null);
    try {
      await apiSend("POST", "/api/control-stop-check/dismiss", { t });
      refresh();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };
  return (
    <ul className="dp-misfire">
      {row("최근 7일", d.last7d)}
      {row("최근 30일", d.last30d)}
      {d.open.map((o) => (
        <li key={o.control}>
          지금 중복: <b>{o.control}</b> · {o.jobs.map((j) => `${j.id}(${j.account ?? "—"}, ${j.state ?? "?"})`).join(", ")}
        </li>
      ))}
      {d.recent.map((r) => (
        <li key={r.t} className="faint">
          {timeAgo(r.t, Date.now())} · {r.event === "blocked" ? "STOP 확인 못 함" : "중복 경고"} · {r.session} · {r.jobIds.join(", ")}
          {r.marked ? (
            " · 오탐 표시됨"
          ) : (
            <>
              {" · "}
              <button type="button" className="btn" onClick={() => void dismiss(r.t)}>
                오탐으로 표시
              </button>
            </>
          )}
        </li>
      ))}
      {error && <li className="is-warn">{error}</li>}
    </ul>
  );
}
// CHAT RELEASE 세기(ATC-471): 최근 7일에 `create --release`로 발권한 수와, 그 가운데 첫 LAUNCH 전에 SUPERVISOR가 버렸거나 Backlog로 되돌렸거나 거둔 수(오작동). 0도 보인다
interface ChatCreateData {
  on: boolean;
  released: number;
  misfires: string[];
}
function ChatReleaseStats({ d }: { d: ChatCreateData }) {
  return (
    <ul className="dp-misfire">
      <li>
        최근 7일 이 길로 발권 <b>{d.released}</b> · 첫 LAUNCH 전에 버림·Backlog로 되돌림·거둠 <b>{d.misfires.length}</b>
        {d.misfires.length > 0 && ` (${d.misfires.join(", ")})`}
      </li>
    </ul>
  );
}
const switchOf = (s: ServerSettings, key: string) => s.switches.find((x) => x.key === key);

const EXTRAS: Record<string, (s: ServerSettings, save: Save) => ReactNode> = {
  autolandReviewedSecurity: (s, save) => (
    <>
      {s.autoland.groundStops.map((g) => (
        <GroundStopRow key={g.airport} stop={g} check={s.autoland.applicationCheck} refresh={() => save({})} />
      ))}
      {s.autoland.applicationCheckWarnings.map((w) => (
        <div className="config-row" key={`check-${w.airport}`}>
          <dt>
            GROUND STOP 체크 <code className="config-env">{w.airport}</code>
          </dt>
          <dd>
            <code className="config-env">{w.check}</code>
          </dd>
          <p className="config-note is-warn">
            main({w.sha.slice(0, 7)})에 이 이름의 체크 런도 워크플로도 없음 — 이 체크가 실패해도 GROUND STOP이 걸리지 않는다. autoland.json의 applicationCheck를 체크 런 이름이나 워크플로 이름에 맞춘다
          </p>
        </div>
      ))}
    </>
  ),
  controlRecycleMode: (s, save) => <RecycleSessions caps={s.controlRecycle.caps} auto={s.controlRecycle.auto} save={save} />,
  dutyEnabled: (s, save) => <DutyAccountRow current={s.duty.account} warning={s.duty.accountWarning} save={save} />,
  autoRevert: (s) => {
    const days = (switchOf(s, "autoRevert")?.data as { days?: RevertDayView[] } | undefined)?.days;
    return days ? <AutoRevertDays days={days} /> : null;
  },
  redMain: (s) => {
    const d = switchOf(s, "redMain")?.data as { raised: number; closedBySelf: number; closedBySwitch: number; open: number; days: number } | undefined;
    return d ? (
      <p className="settings-hint">
        최근 {d.days}일 올린 줄 <b>{d.raised}</b> · 스스로 닫힌 줄 <b>{d.closedBySelf}</b> · 스위치로 내린 줄 <b>{d.closedBySwitch}</b> · 지금 열린 줄 <b>{d.open}</b>
      </p>
    ) : null;
  },
  staleReply: (s) => {
    const d = switchOf(s, "staleReply")?.data as { refused: number; clearance: number; flightPlan: number; crewChange: number; days: number } | undefined;
    return d ? (
      <p className="settings-hint">
        최근 {d.days}일 거절한 답 <b>{d.refused}</b> · CLEARANCE <b>{d.clearance}</b> · FLIGHT PLAN <b>{d.flightPlan}</b> · CREW CHANGE <b>{d.crewChange}</b>
      </p>
    ) : null;
  },
  mccKApproval: (s) => {
    const days = (switchOf(s, "mccKApproval")?.data as { days?: KDay[] } | undefined)?.days;
    return days ? <KApprovalDays days={days} /> : null;
  },
  removalGuard: (s) => {
    const d = switchOf(s, "removalGuard")?.data as (RemovalStats & { headsKnown: boolean }) | undefined;
    return d ? <RemovalGuardStats d={d} /> : null;
  },
  verifyGate: (s) => {
    const d = switchOf(s, "verifyGate")?.data as VerifyGateData | undefined;
    return d ? <VerifyGateStats d={d} /> : null;
  },
  chatRelease: (s) => {
    const d = switchOf(s, "chatRelease")?.data as ChatCreateData | undefined;
    return d ? <ChatReleaseStats d={d} /> : null;
  },
  browserGate: (s) => {
    const d = switchOf(s, "browserGate")?.data as BrowserGateData | undefined;
    return d ? <BrowserGateStats d={d} /> : null;
  },
  autolandHandoff: (s) => {
    const d = switchOf(s, "autolandHandoff")?.data as HandoffData | undefined;
    return d ? <HandoffStats d={d} /> : null;
  },
  controlStopCheck: (s, save) => {
    const d = switchOf(s, "controlStopCheck")?.data as StopCheckData | undefined;
    return d ? <StopCheckStats d={d} refresh={() => save({})} /> : null;
  },
  dutyReview: (s) => (switchOf(s, "dutyEnabled")?.value === "on" ? <DutyReviewRecord on={switchOf(s, "dutyReview")?.value === "on"} /> : null),
  dutyReviewEmpty: (s) => (switchOf(s, "dutyEnabled")?.value === "on" ? <EmptyReviewRecord on={switchOf(s, "dutyReviewEmpty")?.value === "on"} /> : null),
  dutyCharter: (s) => (s.duty.charter !== "off" ? <CharterShadowRecord mode={s.duty.charter} /> : null),
  judgesJev: (s) =>
    s.judges.jev.lastRunAt || s.judges.jev.lastError ? (
      <p className="settings-hint">
        마지막 실행 {s.judges.jev.lastRunAt ? timeAgo(s.judges.jev.lastRunAt, Date.now()) : "—"} · 이번 실행 뒤 mark {s.judges.jev.judged}건
        {s.judges.jev.lastError && ` · 오류: ${s.judges.jev.lastError}`}
      </p>
    ) : null,
};
// 블록 뒤(줄 밖)에 붙는 화면. 키는 블록 코드
const BLOCK_EXTRAS: Record<string, () => ReactNode> = { MCC: () => <MccGatePanel /> };

// 두 분류 맨 위의 지금 정책 한 줄(모든 스위치). ⚠ 모드는 호박색
function PolicyLine({ server }: { server: Loaded }) {
  return (
    <ServerRows server={server}>
      {(s) => (
        <p className="automation-line" aria-label="지금 정책">
          {modeSegments(s.switches).map((x, i) => (
            <span key={x.key}>
              {i > 0 && " · "}
              <span className={x.warn ? "is-warn" : undefined} title={modeLine([x])}>
                {x.label} <b>{x.value}</b>
                {x.warn && " ⚠"}
              </span>
            </span>
          ))}
        </p>
      )}
    </ServerRows>
  );
}

// 한 분류의 블록들: 선언의 block.code마다 한 블록, 블록은 가장 앞선 스위치의 순서(order)대로, 줄은 스위치 순서대로
function SwitchBlocks({ group, server, save }: { group: SwitchView["group"]; server: Loaded; save: Save }) {
  const switches = server.state === "ready" ? server.data.switches.filter((x) => x.group === group && x.row) : [];
  const codes = [...new Set([...switches].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).map((x) => x.block.code))];
  // 서버 설정을 읽기 전(불러오는 중·오류)에는 블록 제목을 모른다: 안내 한 줄만
  if (server.state !== "ready") return <ServerRows server={server}>{() => null}</ServerRows>;
  return (
    <>
      {codes.map((code) => {
        const mine = switches.filter((x) => x.block.code === code).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
        const first = mine[0];
        return (
          <Block key={code} code={code} label={first?.block.windowLabel ?? first?.block.label ?? code}>
            <ServerRows server={server}>
              {(s) =>
                mine.map((sw) => (
                  <Fragment key={sw.key}>
                    {CUSTOM_ROWS[sw.key] ? CUSTOM_ROWS[sw.key](sw, save) : <SwitchRow sw={sw} save={save} />}
                    {EXTRAS[sw.key]?.(s, save)}
                  </Fragment>
                ))
              }
            </ServerRows>
            {BLOCK_EXTRAS[code]?.()}
          </Block>
        );
      })}
    </>
  );
}
export function LandingSettings({ server, save }: { server: Loaded; save: Save }) {
  return (
    <>
      <PolicyLine server={server} />
      <SwitchBlocks group="landing" server={server} save={save} />
      <EditNote />
    </>
  );
}

export function OperationsSettings({ server, save }: { server: Loaded; save: Save }) {
  return (
    <>
      <PolicyLine server={server} />
      <SwitchBlocks group="operations" server={server} save={save} />
      <EditNote />
    </>
  );
}
