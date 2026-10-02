import { Fragment, useEffect, useState } from "react";
import type { MccGate } from "../../server/mcc.ts";
import type { ServerSettings } from "../../server/settings.ts";
import { modeLine, modeSegments, needsConfirm, recycleAutoGuardOf, reviewLabel, type PolicyKey } from "../../server/settings-policy.ts";
import { timeAgo } from "./derive.ts";
import { Block, EditNote, EditRow, type Save, type SaveResult, ServerRows, type Loaded } from "./SettingsServer.tsx";
import { apiGet, apiSend } from "./api.ts";

// 설정 창의 AUTOMATION 묶음(ATC-131): SUPERVISOR 정책 스위치. LANDING(AUTOLAND, MCC, REVIEW)과 OPERATIONS(FUEL, REPOSITION, CONTROL RECYCLE, JUDGES) 두 분류로 나눠 보이고, 둘 다 맨 위에 지금 모드 한 줄.
// ⚠ 모드로 올릴 때는 그 모드의 경고를 보이고 확인 버튼을 거친다(EditRow guard). 내리는 것은 전과 같이 저장한다.
// 저장 값과 PUT /api/settings는 그대로다. 관제 세션은 이 스위치를 못 바꾼다.

// 모드마다 한 줄 경고(ATC-34). merge는 vocado AGENTS.md에 SUPERVISOR가 AUTOLAND 예외를 적은 뒤에만 켠다
const AUTOLAND_WARN = {
  off: "꺼짐(기본): atc는 PR 브랜치에 아무것도 쓰지 않는다.",
  update: "⚠ CLEARED인데 behind인 PR을 LANDING SEQUENCE 순서로 AIRPORT마다 하나씩 update-branch로 갱신(팀 브랜치에 merge 커밋). 머지는 SUPERVISOR.",
  merge: "⚠ 위임된 PR(보안·Risk·HUMAN CHECK·UI change 블록 없음·FLIGHT 없음·HOLD 제외)을 정확한 head로 atc가 머지. vocado AGENTS.md에 AUTOLAND 예외를 적은 뒤에만 켤 것.",
} as const;

// AUTOLAND 머지 리뷰의 보안 위임(ATC-328)
const AUTOLAND_REVIEW_WARN = {
  off: "꺼짐(기본): 머지 리뷰 pass는 리뷰 조건만 채운다. rating:SEC·보안 게이트 PR은 SUPERVISOR가 머지한다.",
  delegate: "⚠ 이 head에 머지 리뷰 pass가 있는 rating:SEC·보안 게이트 PR을 AUTOLAND merge가 머지한다. 비밀·키·마이그레이션·SQL 경로, Risk 라벨, FLIGHT 없음은 그대로 SUPERVISOR.",
} as const;

// MCC 모드마다 한 줄(docs/mcc.md). findings 댓글은 모든 모드에서 남긴다
const MCC_WARN = {
  shadow: "기본: MCC는 INSPECTION하고 착륙·RTS는 would로만 남긴다. 머지·배포는 사용자.",
  land: "⚠ auto·flagged 등급 PR을 CI·INSPECTION pass·정확한 head로 atc가 머지. user 등급과 ESCALATE는 사용자. 배포는 사람.",
  "land+rts": "⚠ land에 더해 머지된 main을 atc-rts 유닛으로 7700에 RETURN TO SERVICE(상태 확인 실패면 ROLLBACK 후 멈춤). 시작은 서버가 스스로 한다.",
  rts: "⚠ MCC는 착륙하지 않는다(would-land만): 사용자가 손으로 머지한 main을 서버가 atc-rts 유닛으로 7700에 스스로 RETURN TO SERVICE(CI 통과, 5분 간격, 상태 확인 실패면 ROLLBACK 후 멈춤). package·유닛 파일 변경은 사람이 배포.",
} as const;

// FLEET PLAN REPOSITION 모드마다 한 줄(ATC-179, docs/fleet.md 8.6)
const REPOSITION_WARN = {
  off: "꺼짐: 쉬는 AIRCRAFT의 base를 옮기자는 제안을 내지 않는다.",
  shadow: "기본: 조건이 맞으면 \"옮겼을 것\"(would-reposition)을 FLIGHT RECORDER에만 남긴다. 아무것도 멈추거나 띄우지 않는다.",
  approval: "조건이 맞으면 FLEET PLAN에 REPOSITION 카드를 낸다. SUPERVISOR가 승인하면 그 AIRCRAFT를 멈추고 base를 바꿔 새 AIRPORT 저장소에서 다시 띄운다.",
  auto: "⚠ 카드를 승인 없이 atc가 스스로 실행한다(하루 상한, AIRCRAFT마다 minDwell, 옮길 때마다 알림). 같은 AIRCRAFT가 minDwell 안에 되돌아가려 하면 approval로 돌아온다.",
} as const;

// CONTROL RECYCLE 모드마다 한 줄(ATC-166, docs/control-recycle.md)
const RECYCLE_WARN = {
  off: "꺼짐(기본): 컨텍스트가 CAP을 넘어도 atc는 관제 세션을 건드리지 않는다. MCC는 MCC LOG에 STOP·LAUNCH를 청한다.",
  shadow: "CAP을 넘고 안전한 순간이면 \"재시작했을 것\"을 FLIGHT RECORDER에만 남긴다(control recycle, would). 세션은 그대로.",
  on: "⚠ CAP을 넘고 턴 사이이며 안전한 순간이면 atc가 그 관제 세션을 STOP하고 같은 ACCOUNT로 LAUNCH한다(FLEET의 버튼과 같은 길, 한 번에 한 세션, 3시간에 한 번). 결과는 FLIGHT RECORDER와 SUPERVISOR ALERT로 남는다.",
} as const;

// DUTY 스위치(ATC-220, docs/duty.md)
const DUTY_WARN = {
  off: "꺼짐(기본): 헤더에 DUTY가 보이지 않고, 글을 보내도 받지 않는다. 켜 둔 프로세스가 있으면 끝난다.",
  on: "⚠ 헤더의 DUTY 서랍에서 글을 보내면 이 서버가 `claude -p` 프로세스를 띄운다(ACCOUNT의 FUEL을 쓴다). 유휴 시간이 지나면 끝나고 다음 글이 이어서 띄운다. DUTY는 읽기만 하고, 글은 소리로 읽지 않는다.",
} as const;

// DUTY REVIEW 스위치(ATC-396, docs/duty.md): 서버가 SUPERVISOR의 글 없이 DUTY 점검 턴을 시작한다
const DUTY_REVIEW_WARN = {
  off: "꺼짐: 서버가 DUTY 턴을 스스로 시작하지 않는다. 점검과 병목 분석은 SUPERVISOR가 DUTY 채팅에서 부탁해야 한다.",
  on: "⚠ 기본: 정기적으로, 또는 놀고 있는 AIRCRAFT가 일감을 두고 이어지거나 leak이 오래 열려 있으면 서버가 DUTY 턴을 시작한다(DUTY가 켜져 있을 때, ACCOUNT의 FUEL을 쓴다). DUTY는 채팅에 한국어 요약을 남기고 제안을 Backlog 이슈로만 만든다. Todo로 올려 쏘는 것은 RELEASE 화면에서 SUPERVISOR가 한다.",
} as const;

// 하루 세기(ATC-396): 점검, 만든 제안, 발권된 제안, 버려진 제안
interface ReviewView {
  on: boolean;
  dutyEnabled: boolean;
  linear: boolean;
  last: { id: string; at: string; trigger: string; detail: string } | null;
  days: { day: string; reviews: number; proposals: number; fired: number; discarded: number }[];
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

// DUTY CHARTER 스위치(ATC-233, docs/duty.md 3.4·D5): DUTY가 만들고 SUPERVISOR가 확정한 CHARTER REQUEST를 OCC가 읽는 정도
const DUTY_CHARTER_WARN = {
  off: "꺼짐(기본): 확정한 요청은 줄에 서지만 OCC의 schedule brief에는 나오지 않는다(카드에 \"switch is off — kept as a draft\").",
  shadow: "OCC가 schedule brief의 duty 구역으로 요청을 읽고, 만들었을 초안을 charter-seen으로 기록만 한다. schedule draft NEW는 하지 않는다. 아래에서 기록을 본다.",
  on: "⚠ OCC가 확정된 요청을 CHARTER REQUEST로 처리한다: schedule wip → schedule draft NEW(AD HOC FLIGHT 초안, 판정은 여전히 SUPERVISOR). 요청 글은 데이터로만 읽는다.",
} as const;

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

// 판정 계열 모드마다 한 줄(ATC-36). replay·shadow는 티켓 제목과 허용한 칸이 TypeSafe로 나간다(데이터 반출)
const JUDGE_WARN = {
  off: "꺼짐(기본): 아무것도 읽거나 보내지 않는다.",
  replay: "⚠ SUPERVISOR가 판정한 지난 CLASSIFY 초안과 DISPATCH ASSIGN을 합쳐 1분에 3건씩 다시 판정한다. 제목과 목표·수정 허용 범위·완료 기준이 TypeSafe로 나간다(rating:SEC·Risk:* 티켓은 제목만). ASSIGN은 그 AIRCRAFT의 지난 atc FLIGHT 3개의 제목도 나가고, atc AIRCRAFT의 턴이 끝날 때는 CAPTAIN의 마지막 메시지(경로·URL을 가리고 최대 1,500자)가 나간다.",
  shadow: "⚠ 새 CLASSIFY 초안, 열린 DISPATCH ASSIGN, 끝난 atc AIRCRAFT 턴마다 판정해 둔다(결과는 SUPERVISOR 판정 뒤에만 보임). 반출 범위는 replay와 같다.",
} as const;

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
        <button className="config-btn is-danger" onClick={() => void clear()} disabled={busy}>
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

const REVIEW_WARN = {
  exclude: "기본: 보안 규칙(라벨·경로·키워드)에 걸린 PR은 REVIEW 세션에 보내지 않고 SUPERVISOR 리뷰로.",
  deepseek: "⚠ 보안 PR도 REVIEW 세션(Claude Sonnet)이 리뷰한다. .env·비밀·키 경로와 FLIGHT 없는 PR은 계속 보내지 않는다. 저장 값 이름 deepseek은 옛 이름이다.",
} as const;
const REVIEW_LABELS = { deepseek: reviewLabel("deepseek") };
const AUTO_REVERT_WARN = {
  off: "off: main이 빨개져도 atc는 되돌리지 않는다. GROUND STOP과 MCC 멈춤은 사람이 읽고 푼다.",
  on: "⚠ 기본 켜짐. lander가 머지해 main을 빨갛게 만든 PR을 atc가 되돌리는 PR을 연다(AIRPORT마다 하나, 같은 리뷰·CI로 착륙, 다음 초록 head가 GROUND STOP을 푼다). 되돌리기 전에 실패한 체크를 같은 head에서 한 번 다시 돌려 flake면 아무것도 하지 않고, 다시 빨갛고 그 PR 자신의 head가 초록이었을 때만 되돌린다. 사람의 머지·마이그레이션(K1)·user 등급(K3) PR은 되돌리지 않고 DUTY에게 알린다. 1시간 안에 빨간 head가 둘이면 멈추고 AUTOLAND merge → update, MCC 착륙 끔으로 내린다.",
} as const;
const AUTO_APPROVE_WARN = {
  off: "off(기본): ASSIGN과 SCHEDULE 초안은 SUPERVISOR가 하나씩 누른다.",
  shadow: "shadow: 서버가 조건을 갖춘 카드를 \"승인했을 것\"이라고 auto-approve.jsonl에만 적는다. 아무것도 승인하지 않는다.",
  on: "⚠ 서버가 SETTLED 열린 ASSIGN(LAUNCH 아님)과 SCHEDULE 초안을 스스로 승인한다(via auto, CROSSCHECK는 은퇴해 mark를 보지 않는다). blind 표본·HELD·주의(caution) 카드와 FUEL hold인 AIRCRAFT는 SUPERVISOR 몫이고, 하루 상한을 넘으면 기다린다.",
} as const;
const SCHEDULE_AUTO_WARN = {
  off: "off: SCHEDULE 초안은 SUPERVISOR(또는 일치 기반 자동 승인)가 승인한다.",
  on: "⚠ 기본: 서버가 열린 SCHEDULE 초안 CLASSIFY·TAIL·CLOSE·WAYPOINT·NEW를 사람 판정 없이 승인한다(via auto). NEW는 Backlog에 제안으로만 생기고 SUPERVISOR가 풀어 준다. ROUTE·TARGET·PRIORITIZE는 제안으로 남는다. 하루 상한을 넘으면 기다린다.",
} as const;
const EFFECT_CHECK_WARN = {
  off: "off: 배포한 FLIGHT의 평결을 내지 않는다. 이미 낸 평결은 그대로 보인다.",
  on: "기본: 배포한 FLIGHT가 작업 지시서 `## Measure`에 적은 것(leak·misfire·알림·CLEARANCE 수)을 배포 앞뒤 같은 기간으로 견줘 improved·not improved·worse·too little data 하나를 남긴다. 재기만 하고 아무것도 바꾸지 않는다. not improved·worse는 HOME에 보이고 틀렸다고 표시할 수 있다(그 수가 오작동 카운터).",
} as const;
const FLEET_PLAN_AUTO_WARN = {
  off: "off: FLEET PLAN 제안은 SUPERVISOR가 FLEET 화면에서 승인한다.",
  on: "⚠ 기본: 서버가 FLEET PLAN 제안 LAUNCH·STOP·RESTART·REFRESH·AOG를 사람 승인 없이 실행한다(세션을 띄우고 멈춘다). FUEL hold·ATC_MAX_LAUNCHED·하루 상한을 지키고, ENTRY·ACCOUNT CHANGE·REPOSITION·RETIRE·RETURN은 제안으로 남는다.",
} as const;
const AUTO_DISPATCH_WARN = {
  off: "off: 열린 ASSIGN·launch 카드는 SUPERVISOR가 DISPATCH 화면에서 하나씩 누르고(아래 두 줄이 정한 만큼은 조건을 갖춘 카드를 서버가 승인), 큐와 알림에 다시 나타난다.",
  on: "⚠ 기본: 서버가 DISPATCH의 필터(SETTLED, HELD 아님, 발권된 FLIGHT)와 상한(FUEL hold, ATC_MAX_LAUNCHED, 하루 상한, 실패 뒤 대기)을 통과한 모든 ASSIGN·launch 카드를 blind 표본·SUPERVISOR 없이 승인한다(via auto). 못 가는 카드는 만료되고 planner가 다시 제안한다. 잘못된 승인은 아래 MISFIRE로 센다.",
} as const;
const AUTO_LAUNCH_WARN = {
  off: "off(기본): launch 카드(ABSENT·RESUME)는 SUPERVISOR가 화면에서 승인한다.",
  shadow: "shadow: 승인과 LAUNCH 조건을 모두 갖춘 launch 카드를 \"띄웠을 것\"이라고 auto-approve.jsonl에만 적는다. 아무것도 띄우지 않는다.",
  on: "⚠ 서버가 launch 카드를 스스로 승인하고 세션을 띄운다(사용량을 쓴다). blind·HELD 아님, 상한(ATC_MAX_LAUNCHED)이 안 참, ACCOUNT가 FUEL hold 아님, LAUNCH 막힘 아님, 실패한 REGISTRATION은 쉼, 하루 상한 안일 때만.",
} as const;

const fuelWarn = (f: { infoPct: number; holdPct: number }) =>
  ({
    off: `off(기본): FUEL은 FLEET 줄과 TOWER·OCC INFO(${f.infoPct}%)에만 보인다. statusline hook이 있어야 값이 들어온다.`,
    on: `⚠ ACCOUNT가 한도의 ${f.holdPct}% 이상을 쓰면 reset까지 DISPATCH가 그 ACCOUNT의 AIRCRAFT를 건너뛴다. ${f.infoPct}%부터 TOWER·OCC에 INFO.`,
  }) as const;

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

// 고르는 중인 값의 경고 줄과, ⚠ 모드로 올리는 것이라 확인이 필요한지
const guardOf = (key: PolicyKey, current: string, lines: Record<string, string>) => (to: string) => (lines[to] ? { line: `${to} ${lines[to]}`, warn: needsConfirm(key, current, to) } : null);

// 두 분류 맨 위의 지금 정책 한 줄(모든 스위치). ⚠ 모드는 호박색
function PolicyLine({ server }: { server: Loaded }) {
  return (
    <ServerRows server={server}>
      {(s) => (
        <p className="automation-line" aria-label="지금 정책">
          {modeSegments(s).map((x, i) => (
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

export function LandingSettings({ server, save }: { server: Loaded; save: Save }) {
  return (
    <>
      <PolicyLine server={server} />

      <Block code="AUTOLAND" label="착륙 자동화(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) => (
            <>
              <EditRow
                label="AUTOLAND"
                env="autoland.mode"
                value={s.autoland.mode}
                note={`autoland.json · 맡은 AIRPORT ${s.autoland.airports.join(", ") || "없음"} · 이 화면(또는 SUPERVISOR의 API)에서만 바꾼다 — 관제 세션은 못 바꿈`}
                input={{ kind: "select", options: ["off", "update", "merge"] }}
                guard={guardOf("autoland", s.autoland.mode, AUTOLAND_WARN)}
                onSave={(v) => save({ autolandMode: v as "off" | "update" | "merge" })}
              />
              <ModeLines modes={["off", "update", "merge"] as const} current={s.autoland.mode} lines={AUTOLAND_WARN} />
              <EditRow
                label="머지 리뷰 위임"
                env="autoland.reviewedSecurity"
                value={s.autoland.reviewedSecurity}
                note="autoland.json · 맡은 AIRPORT에서 REVIEW 세션이 atc에 남긴 이 head의 머지 리뷰 pass가 착륙 리뷰다. 이 스위치는 보안 게이트 PR까지 위임할지 정한다 — 이 화면에서만 바꾼다, 관제 세션은 못 바꿈"
                input={{ kind: "select", options: ["off", "delegate"] }}
                guard={guardOf("autolandReview", s.autoland.reviewedSecurity, AUTOLAND_REVIEW_WARN)}
                onSave={(v) => save({ autolandReviewedSecurity: v as "off" | "delegate" })}
              />
              <ModeLines modes={["off", "delegate"] as const} current={s.autoland.reviewedSecurity} lines={AUTOLAND_REVIEW_WARN} />
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
          )}
        </ServerRows>
      </Block>

      <Block code="MCC" label="atc 착륙·RETURN TO SERVICE(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) => (
            <>
              <EditRow
                label="MCC"
                env="mcc.mode"
                value={s.mcc.mode}
                note={`mcc.json · 맡은 AIRPORT ${s.mcc.airport} · 이 화면에서만 바꾼다 — MCC 세션은 못 바꿈. ROLLBACK 뒤 멈춘 RTS는 모드를 다시 고르면 풀린다`}
                input={{ kind: "select", options: ["shadow", "land", "land+rts", "rts"] }}
                guard={guardOf("mcc", s.mcc.mode, MCC_WARN)}
                onSave={(v) => save({ mccMode: v as "shadow" | "land" | "land+rts" | "rts" })}
              />
              <ModeLines modes={["shadow", "land", "land+rts", "rts"] as const} current={s.mcc.mode} lines={MCC_WARN} />
            </>
          )}
        </ServerRows>
        <MccGatePanel />
      </Block>

      <Block code="MIGRATE" label="마이그레이션 리허설(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) => (
            <>
              {s.migrate.airports.length === 0 && <p className="mcc-gate-note">hostedDb가 있는 AIRPORT 없음(airports.json)</p>}
              {s.migrate.airports.map((a) => (
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
          )}
        </ServerRows>
      </Block>

      <Block code="AUTO REVERT" label="main이 빨개지면 lander 머지 자동 되돌림(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) =>
            s.autoRevert ? (
              <>
                <EditRow
                  label="AUTO REVERT"
                  env="autoRevert"
                  value={s.autoRevert.mode}
                  note={`auto-revert.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈${s.autoRevert.stopped.length ? ` · 멈춤: ${s.autoRevert.stopped.map((x) => `${x.airport}(${x.detail})`).join(", ")} — 스위치를 다시 고르면 풀린다` : ""}`}
                  input={{ kind: "select", options: ["off", "on"] }}
                  guard={guardOf("autoRevert", s.autoRevert.mode, AUTO_REVERT_WARN)}
                  onSave={(v) => save({ autoRevert: v as "off" | "on" })}
                />
                <ModeLines modes={["off", "on"] as const} current={s.autoRevert.mode} lines={AUTO_REVERT_WARN} />
                {s.autoRevert.days.some((d) => d.reverts + d.flakes + d.misfires + d.holds + d.stops > 0) ? (
                  <ul className="dp-misfire">
                    {[...s.autoRevert.days]
                      .reverse()
                      .filter((d) => d.reverts + d.flakes + d.misfires + d.holds + d.stops > 0)
                      .map((d) => (
                        <li key={d.day}>
                          <span className="mono">{d.day}</span> revert <b>{d.reverts}</b> · flake 잡음 <b>{d.flakes}</b> · misfire <b>{d.misfires}</b>
                          {d.holds + d.stops > 0 ? <span className="faint"> — 알림 {d.holds} · 멈춤 {d.stops}</span> : null}
                        </li>
                      ))}
                  </ul>
                ) : null}
              </>
            ) : null
          }
        </ServerRows>
      </Block>

      <Block code="REVIEW" label="Codex 한도 때 착륙 리뷰">
        <ServerRows server={server}>
          {(s) => (
            <>
              <EditRow
                label="보안 PR"
                env="externalReview.security"
                value={s.review.security}
                note="dispatch.json · 저장 값은 exclude 또는 deepseek(옛 이름)이고, 화면에는 sonnet (deepseek)으로 보인다"
                input={{ kind: "select", options: ["exclude", "deepseek"], labels: REVIEW_LABELS }}
                guard={guardOf("review", s.review.security, REVIEW_WARN)}
                onSave={(v) => save({ reviewSecurity: v as "exclude" | "deepseek" })}
              />
              <ModeLines modes={["exclude", "deepseek"] as const} current={s.review.security} lines={REVIEW_WARN} />
            </>
          )}
        </ServerRows>
      </Block>
      <EditNote />
    </>
  );
}

export function OperationsSettings({ server, save }: { server: Loaded; save: Save }) {
  return (
    <>
      <PolicyLine server={server} />

      <Block code="FUEL" label="사용 한도 HOLD(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) => {
            const lines = fuelWarn({ infoPct: s.fuel?.infoPct ?? 80, holdPct: s.fuel?.holdPct ?? 95 });
            const cur = s.fuel?.hold ? "on" : "off";
            return (
              <>
                <EditRow
                  label="DISPATCH HOLD"
                  env="fuel.hold"
                  value={cur}
                  note="dispatch.json · 이 화면에서만 바꾼다"
                  input={{ kind: "select", options: ["off", "on"] }}
                  guard={guardOf("fuelHold", cur, lines)}
                  onSave={(v) => save({ fuelHold: v as "off" | "on" })}
                />
                <ModeLines modes={["off", "on"] as const} current={cur} lines={lines} />
              </>
            );
          }}
        </ServerRows>
      </Block>

      <Block code="EFFECT CHECK" label="배포 효과 확인(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) =>
            s.effectCheck ? (
              <>
                <EditRow
                  label="평결"
                  env="effect-check.on"
                  value={s.effectCheck}
                  note="effect-check.json · 평결은 effect-verdicts.jsonl에 추가만 한다 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈"
                  input={{ kind: "select", options: ["off", "on"] }}
                  guard={guardOf("effectCheck", s.effectCheck, EFFECT_CHECK_WARN)}
                  onSave={(v) => save({ effectCheck: v as "off" | "on" })}
                />
                <ModeLines modes={["off", "on"] as const} current={s.effectCheck} lines={EFFECT_CHECK_WARN} />
              </>
            ) : null
          }
        </ServerRows>
      </Block>

      <Block code="SCHEDULE·FLEET PLAN AUTO" label="SCHEDULE·FLEET PLAN 사람 없이 적용(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) =>
            s.autonomyAuto ? (
              <>
                <EditRow
                  label="SCHEDULE"
                  env="schedule.auto"
                  value={s.autonomyAuto.schedule}
                  note="schedule.json · 하루 상한은 dispatch.json autoApproveMax · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈"
                  input={{ kind: "select", options: ["off", "on"] }}
                  guard={guardOf("scheduleAuto", s.autonomyAuto.schedule, SCHEDULE_AUTO_WARN)}
                  onSave={(v) => save({ scheduleAuto: v as "off" | "on" })}
                />
                <ModeLines modes={["off", "on"] as const} current={s.autonomyAuto.schedule} lines={SCHEDULE_AUTO_WARN} />
                <EditRow
                  label="FLEET PLAN"
                  env="fleet-plan.auto"
                  value={s.autonomyAuto.fleetPlan}
                  note="fleet-plan.json · 하루 LAUNCH 상한은 autoLaunchMax, 전체는 autoApproveMax · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈"
                  input={{ kind: "select", options: ["off", "on"] }}
                  guard={guardOf("fleetPlanAuto", s.autonomyAuto.fleetPlan, FLEET_PLAN_AUTO_WARN)}
                  onSave={(v) => save({ fleetPlanAuto: v as "off" | "on" })}
                />
                <ModeLines modes={["off", "on"] as const} current={s.autonomyAuto.fleetPlan} lines={FLEET_PLAN_AUTO_WARN} />
              </>
            ) : null
          }
        </ServerRows>
      </Block>

      <Block code="AUTO APPROVE" label="DISPATCH 자동 운항·일치 기반 자동 승인(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) =>
            s.dispatchAuto ? (
              <>
                <EditRow
                  label="DISPATCH 자동 운항"
                  env="autoDispatch"
                  value={s.dispatchAuto.auto}
                  note="dispatch.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈. ASSIGN·launch 카드의 승인에서 사람을 뺀다"
                  input={{ kind: "select", options: ["off", "on"] }}
                  guard={guardOf("autoDispatch", s.dispatchAuto.auto, AUTO_DISPATCH_WARN)}
                  onSave={(v) => save({ autoDispatch: v as "off" | "on" })}
                />
                <ModeLines modes={["off", "on"] as const} current={s.dispatchAuto.auto} lines={AUTO_DISPATCH_WARN} />
                <EditRow
                  label="ASSIGN·SCHEDULE"
                  env="autoApprove"
                  value={s.dispatchAuto.approve}
                  note={`dispatch.json · 하루 ${s.dispatchAuto.approveMax}건까지(굴러가는 24시간) · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈`}
                  input={{ kind: "select", options: ["off", "shadow", "on"] }}
                  guard={guardOf("autoApprove", s.dispatchAuto.approve, AUTO_APPROVE_WARN)}
                  onSave={(v) => save({ autoApprove: v as "off" | "shadow" | "on" })}
                />
                <ModeLines modes={["off", "shadow", "on"] as const} current={s.dispatchAuto.approve} lines={AUTO_APPROVE_WARN} />
                <EditRow
                  label="launch 카드"
                  env="autoApproveLaunch"
                  value={s.dispatchAuto.launch}
                  note={`dispatch.json · 하루 ${s.dispatchAuto.launchMax}번까지, 실패한 REGISTRATION은 ${s.dispatchAuto.backoffMin}분 쉼 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈`}
                  input={{ kind: "select", options: ["off", "shadow", "on"] }}
                  guard={guardOf("autoApproveLaunch", s.dispatchAuto.launch, AUTO_LAUNCH_WARN)}
                  onSave={(v) => save({ autoApproveLaunch: v as "off" | "shadow" | "on" })}
                />
                <ModeLines modes={["off", "shadow", "on"] as const} current={s.dispatchAuto.launch} lines={AUTO_LAUNCH_WARN} />
              </>
            ) : null
          }
        </ServerRows>
      </Block>

      <Block code="REPOSITION" label="쉬는 AIRCRAFT의 소속 AIRPORT 옮기기(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) =>
            s.fleetPlan ? (
              <>
                <EditRow
                  label="REPOSITION"
                  env="fleet-plan.reposition"
                  value={s.fleetPlan.reposition}
                  note={`fleet-plan.json · 자동일 때 하루 ${s.fleetPlan.repositionDailyMax}건까지 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈`}
                  input={{ kind: "select", options: ["off", "shadow", "approval", "auto"] }}
                  guard={guardOf("reposition", s.fleetPlan.reposition, REPOSITION_WARN)}
                  onSave={(v) => save({ fleetPlanReposition: v as "off" | "shadow" | "approval" | "auto" })}
                />
                <ModeLines modes={["off", "shadow", "approval", "auto"] as const} current={s.fleetPlan.reposition} lines={REPOSITION_WARN} />
              </>
            ) : (
              <p className="settings-hint">서버가 REPOSITION을 아직 모름(옛 서버)</p>
            )
          }
        </ServerRows>
      </Block>

      <Block code="CONTROL RECYCLE" label="관제 세션 자동 재시작(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) =>
            s.controlRecycle ? (
              <>
                <EditRow
                  label="CONTROL RECYCLE"
                  env="controlRecycle.mode"
                  value={s.controlRecycle.mode}
                  note={`control-recycle.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 같은 세션은 ${s.controlRecycle.cooldownHours}시간에 한 번`}
                  input={{ kind: "select", options: ["off", "shadow", "on"] }}
                  guard={guardOf("recycle", s.controlRecycle.mode, RECYCLE_WARN)}
                  onSave={(v) => save({ controlRecycleMode: v as "off" | "shadow" | "on" })}
                />
                <ModeLines modes={["off", "shadow", "on"] as const} current={s.controlRecycle.mode} lines={RECYCLE_WARN} />
                <RecycleSessions caps={s.controlRecycle.caps} auto={s.controlRecycle.auto} save={save} />
              </>
            ) : (
              <p className="settings-hint">서버가 CONTROL RECYCLE을 아직 모름(옛 서버)</p>
            )
          }
        </ServerRows>
      </Block>

      <Block code="DUTY" label="DUTY 채팅(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) =>
            s.duty ? (
              <>
                <EditRow
                  label="DUTY"
                  env="duty.enabled"
                  value={s.duty.enabled ? "on" : "off"}
                  note={`duty.json · 유휴 ${s.duty.idleMin}분 뒤 프로세스 종료 · 이 화면에서만 바꾼다`}
                  input={{ kind: "select", options: ["off", "on"] }}
                  guard={guardOf("duty", s.duty.enabled ? "on" : "off", DUTY_WARN)}
                  onSave={(v) => save({ dutyEnabled: v as "off" | "on" })}
                />
                <ModeLines modes={["off", "on"] as const} current={s.duty.enabled ? "on" : "off"} lines={DUTY_WARN} />
                <DutyAccountRow current={s.duty.account} warning={s.duty.accountWarning} save={save} />
                <EditRow
                  label="DUTY REVIEW"
                  env="duty.review"
                  value={s.duty.review ? "on" : "off"}
                  note="duty.json · 서버가 스스로 DUTY 점검 턴을 시작한다(주기·트리거) · 이 화면에서만 바꾼다(SUPERVISOR 전용)"
                  input={{ kind: "select", options: ["off", "on"] }}
                  guard={guardOf("dutyReview", s.duty.review ? "on" : "off", DUTY_REVIEW_WARN)}
                  onSave={(v) => save({ dutyReview: v as "off" | "on" })}
                />
                <ModeLines modes={["off", "on"] as const} current={s.duty.review ? "on" : "off"} lines={DUTY_REVIEW_WARN} />
                {s.duty.enabled && <DutyReviewRecord on={s.duty.review} />}
                <EditRow
                  label="DUTY CHARTER"
                  env="duty.charter"
                  value={s.duty.charter}
                  note="duty.json · DUTY가 만든 CHARTER REQUEST를 SUPERVISOR가 카드에서 확정하면 OCC가 다음 tick에 schedule brief로 읽는다 · 이 화면에서만 바꾼다(atcctl에는 명령이 없다)"
                  input={{ kind: "select", options: ["off", "shadow", "on"] }}
                  guard={guardOf("dutyCharter", s.duty.charter, DUTY_CHARTER_WARN)}
                  onSave={(v) => save({ dutyCharter: v as "off" | "shadow" | "on" })}
                />
                <ModeLines modes={["off", "shadow", "on"] as const} current={s.duty.charter} lines={DUTY_CHARTER_WARN} />
                {s.duty.charter !== "off" && <CharterShadowRecord mode={s.duty.charter} />}
              </>
            ) : (
              <p className="settings-hint">서버가 DUTY를 아직 모름(옛 서버)</p>
            )
          }
        </ServerRows>
      </Block>

      <Block code="JUDGES" label="판정 계열(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) =>
            s.judges ? (
              <>
                <EditRow
                  label="JEV"
                  env="judges.jev"
                  value={s.judges.jev.mode}
                  note={`judges.json · 엔진 ${s.judges.jev.engine}${s.judges.jev.engine === "jev" ? ` · TYPESAFE_API_KEY ${s.judges.jev.apiKeySet ? "있음" : "없음"}` : " (녹화 응답, 네트워크 없음)"} · 이 화면(또는 SUPERVISOR의 API)에서만 바꾼다 — 관제 세션은 못 바꿈`}
                  input={{ kind: "select", options: ["off", "replay", "shadow"] }}
                  guard={guardOf("jev", s.judges.jev.mode, JUDGE_WARN)}
                  onSave={(v) => save({ judgesJev: v as "off" | "replay" | "shadow" })}
                />
                <ModeLines modes={["off", "replay", "shadow"] as const} current={s.judges.jev.mode} lines={JUDGE_WARN} />
                {(s.judges.jev.lastRunAt || s.judges.jev.lastError) && (
                  <p className="settings-hint">
                    마지막 실행 {s.judges.jev.lastRunAt ? timeAgo(s.judges.jev.lastRunAt, Date.now()) : "—"} · 이번 실행 뒤 mark {s.judges.jev.judged}건
                    {s.judges.jev.lastError && ` · 오류: ${s.judges.jev.lastError}`}
                  </p>
                )}
              </>
            ) : null
          }
        </ServerRows>
      </Block>

      <EditNote />
    </>
  );
}
