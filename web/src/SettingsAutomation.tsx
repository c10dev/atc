import { useEffect, useState } from "react";
import type { MccGate } from "../../server/mcc.ts";
import type { ServerSettings } from "../../server/settings.ts";
import { modeLine, modeSegments, needsConfirm, reviewLabel, type PolicyKey } from "../../server/settings-policy.ts";
import { timeAgo } from "./derive.ts";
import { Block, EditNote, EditRow, type Save, type SaveResult, ServerRows, type Loaded } from "./SettingsServer.tsx";

// 설정 창의 AUTOMATION 탭(ATC-131): SUPERVISOR 정책 스위치(AUTOLAND, MCC, JEV, FUEL HOLD, REVIEW). 맨 위에 지금 모드 한 줄.
// ⚠ 모드로 올릴 때는 그 모드의 경고를 보이고 확인 버튼을 거친다(EditRow guard). 내리는 것은 전과 같이 저장한다.
// 저장 값과 PUT /api/settings는 그대로다. 관제 세션은 이 스위치를 못 바꾼다.

// 모드마다 한 줄 경고(ATC-34). merge는 vocado AGENTS.md에 SUPERVISOR가 AUTOLAND 예외를 적은 뒤에만 켠다
const AUTOLAND_WARN = {
  off: "꺼짐(기본): atc는 PR 브랜치에 아무것도 쓰지 않는다.",
  update: "⚠ CLEARED인데 behind인 PR을 LANDING SEQUENCE 순서로 AIRPORT마다 하나씩 update-branch로 갱신(팀 브랜치에 merge 커밋). 머지는 SUPERVISOR.",
  merge: "⚠ 위임된 PR(보안·Risk·HUMAN CHECK·UI change 블록 없음·FLIGHT 없음·HOLD 제외)을 정확한 head로 atc가 머지. vocado AGENTS.md에 AUTOLAND 예외를 적은 뒤에만 켤 것.",
} as const;

// MCC 모드마다 한 줄(docs/mcc.md). findings 댓글은 모든 모드에서 남긴다
const MCC_WARN = {
  shadow: "기본: MCC는 INSPECTION하고 착륙·RTS는 would로만 남긴다. 머지·배포는 사용자.",
  land: "⚠ auto·flagged 등급 PR을 CI·INSPECTION pass·정확한 head로 atc가 머지. user 등급과 ESCALATE는 사용자. 배포는 사람.",
  "land+rts": "⚠ land에 더해 머지된 main을 atc-rts 유닛으로 7700에 RETURN TO SERVICE(상태 확인 실패면 ROLLBACK 후 멈춤). 시작은 서버가 스스로 한다.",
  rts: "⚠ MCC는 착륙하지 않는다(would-land만): 사용자가 손으로 머지한 main을 서버가 atc-rts 유닛으로 7700에 스스로 RETURN TO SERVICE(CI 통과, 5분 간격, 상태 확인 실패면 ROLLBACK 후 멈춤). package·유닛 파일 변경은 사람이 배포.",
} as const;

// 판정 계열 모드마다 한 줄(ATC-36). replay·shadow는 티켓 제목과 허용한 칸이 TypeSafe로 나간다(데이터 반출)
const JUDGE_WARN = {
  off: "꺼짐(기본): 아무것도 읽거나 보내지 않는다.",
  replay: "⚠ SUPERVISOR가 판정한 지난 CLASSIFY 초안과 DISPATCH ASSIGN을 합쳐 1분에 3건씩 다시 판정한다. 제목과 목표·수정 허용 범위·완료 기준이 TypeSafe로 나간다(rating:SEC·Risk:* 티켓은 제목만). ASSIGN은 그 AIRCRAFT의 지난 atc FLIGHT 3개의 제목도 나가고, atc AIRCRAFT의 턴이 끝날 때는 CAPTAIN의 마지막 메시지(경로·URL을 가리고 최대 1,500자)가 나간다.",
  shadow: "⚠ 새 CLASSIFY 초안, 열린 DISPATCH ASSIGN, 끝난 atc AIRCRAFT 턴마다 판정해 둔다(결과는 SUPERVISOR 판정 뒤에만 보임). 반출 범위는 replay와 같다.",
} as const;

// AUTOLAND GROUND STOP: main의 post-merge Application Check가 빨가 두 모드가 멈춤. SUPERVISOR가 확인하고 푼다
function GroundStopRow({ stop, check, refresh }: { stop: ServerSettings["autoland"]["groundStops"][number]; check: string; refresh: () => Promise<SaveResult> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/autoland/groundstop/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ airport: stop.airport }),
      });
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
    fetch("/api/mcc/gate")
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

// 고르는 중인 값의 경고 줄과, ⚠ 모드로 올리는 것이라 확인이 필요한지
const guardOf = (key: PolicyKey, current: string, lines: Record<string, string>) => (to: string) => (lines[to] ? { line: `${to} ${lines[to]}`, warn: needsConfirm(key, current, to) } : null);

export function AutomationSettings({ server, save }: { server: Loaded; save: Save }) {
  return (
    <>
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
              {s.autoland.groundStops.map((g) => (
                <GroundStopRow key={g.airport} stop={g} check={s.autoland.applicationCheck} refresh={() => save({})} />
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
