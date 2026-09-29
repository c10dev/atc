import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import type { Snapshot } from "../../server/model.ts";
import type { MccGate } from "../../server/mcc.ts";
import type { ServerSettings, SettingsErrors, SettingsPatch } from "../../server/settings.ts";
import { callsign } from "./aviation.ts";
import { timeAgo } from "./derive.ts";

// 설정 창의 LINEAR, AGENTS 탭. 서버 설정을 읽고 고친다.
// 저장하면 서버가 .env.local에 쓰고 실행 중인 설정에도 바로 반영한다(재시작 필요 없음).

type Loaded = { state: "loading" } | { state: "error" } | { state: "ready"; data: ServerSettings };
type SaveResult = { ok: true } | { ok: false; error: string };
export type Save = (patch: SettingsPatch) => Promise<SaveResult>;

export function useServerSettings(): { server: Loaded; save: Save } {
  const [server, setServer] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: ServerSettings) => alive && setServer({ state: "ready", data }))
      .catch(() => alive && setServer({ state: "error" }));
    return () => {
      alive = false;
    };
  }, []);

  const save: Save = async (patch) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (res.ok) {
        setServer({ state: "ready", data: body as ServerSettings });
        return { ok: true };
      }
      const errors = (body.errors ?? {}) as SettingsErrors;
      return { ok: false, error: Object.values(errors)[0] ?? body.error ?? `HTTP ${res.status}` };
    } catch {
      return { ok: false, error: "서버에 연결할 수 없음" };
    }
  };
  return { server, save };
}

export function LinearSettings({ snapshot, server, save }: { snapshot: Snapshot | null; server: Loaded; save: Save }) {
  const linear = snapshot?.linear;
  const status = !linear ? null : !linear.enabled ? "off" : linear.error ? "error" : "on";
  const now = Date.now();
  return (
    <>
      <Block code="CONNECTION" label="연결">
        <div className="conn">
          <StatusChip tone={status === "on" ? "ok" : status === "error" ? "bad" : "mute"}>
            {status === "on" ? "CONNECTED" : status === "error" ? "ERROR" : status === "off" ? "NOT CONNECTED" : "—"}
          </StatusChip>
          <span className="conn-meta">
            {linear?.fetchedAt
              ? `${timeAgo(linear.fetchedAt, now)} 동기화`
              : status === "on"
                ? "불러오는 중"
                : status === "off"
                  ? "브랜치에서 찾은 FLIGHT만 표시"
                  : ""}
          </span>
        </div>
        {linear?.error && <p className="conn-error">{linear.error}</p>}
        {snapshot && status === "on" && (
          <p className="settings-hint">
            FLIGHT {snapshot.tickets.length}개 · 상태 {snapshot.columns.length}개를 불러옴
          </p>
        )}
      </Block>

      <Block code="WORKSPACE" label="Linear 설정">
        <ServerRows server={server}>
          {(s) => (
            <>
              <SecretRow label="API KEY" env="LINEAR_API_KEY" isSet={s.linear.apiKeySet} save={save} />
              <EditRow
                label="TEAM"
                env="LINEAR_TEAM_KEY"
                value={s.linear.teamKey}
                note={`티켓 ${s.linear.teamKey}-191 → FLIGHT ${s.linear.teamKey}191. 브랜치의 ${s.linear.teamKey.toLowerCase()}-<번호>로 티켓을 찾음`}
                input={{ kind: "text", upper: true, maxLength: 10 }}
                onSave={(v) => save({ teamKey: v })}
              />
              <EditRow
                label="TEAMS"
                env="LINEAR_TEAM_KEYS"
                value={s.linear.teamKeys.join(", ")}
                note={`읽는 팀 전부(쉼표로 구분, 예: VOC, ATC). ${s.linear.teamKey}가 맨 앞. 다른 팀은 보여 주기만 하고, DISPATCH·SCHEDULE 후보는 dispatch.json의 candidateTeams(비면 ${s.linear.teamKey}만)`}
                input={{ kind: "text", upper: true, maxLength: 60 }}
                onSave={(v) => save({ teamKeys: v })}
              />
            </>
          )}
        </ServerRows>
      </Block>
      <EditNote />
    </>
  );
}

export function AgentSettings({ snapshot, server, save }: { snapshot: Snapshot | null; server: Loaded; save: Save }) {
  const sessions = snapshot?.sessions ?? [];
  const count = (agent: "claude" | "codex") => {
    const list = sessions.filter((s) => s.agent === agent);
    return { total: list.length, busy: list.filter((s) => s.status === "busy").length };
  };
  const claude = count("claude");
  const codex = count("codex");
  const teams = sessions.filter((s) => callsign(s) !== s.name).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Block code="SOURCES" label="에이전트">
        <ServerRows server={server}>
          {(s) => (
            <>
              <AgentRow name="Claude Code" code="CLD" present={s.agents.claude.present} dir={s.agents.claude.sessionsDir} total={claude.total} busy={claude.busy}>
                <StatusChip tone={s.agents.claude.claimHook ? "ok" : "bad"}>
                  {s.agents.claude.claimHook ? "CLAIM HOOK ✓" : "CLAIM HOOK 없음"}
                </StatusChip>
              </AgentRow>
              <AgentRow name="Codex" code="CDX" present={s.agents.codex.present} dir={s.agents.codex.sessionsDir} total={codex.total} busy={codex.busy} />
            </>
          )}
        </ServerRows>
      </Block>

      <Block code="CONTROL" label="관제 세션 띄우기·멈추기(SUPERVISOR 전용)">
        <ControlSessions />
      </Block>

      <Block code="STANDS" label="점유 규칙">
        <ServerRows server={server}>
          {(s) => (
            <>
              <EditRow
                label="STAND 점유 유지"
                env="ATC_CLAIM_TTL_MIN"
                value={String(s.agents.claimTtlMin)}
                unit="분"
                note="마지막으로 건드린 뒤 이 시간이 지나면 점유가 풀림(5–1440)"
                input={{ kind: "number", min: 5, max: 1440 }}
                onSave={(v) => save({ claimTtlMin: Number(v) })}
              />
              <EditRow
                label="HANDOFF 유예"
                env="ATC_HANDOFF_GRACE_MIN"
                value={String(s.agents.handoffGraceMin)}
                unit="분"
                note="앞 세션이 이 안에 손을 떼면 HANDOFF, 더 겹치면 충돌(0–120)"
                input={{ kind: "number", min: 0, max: 120 }}
                onSave={(v) => save({ handoffGraceMin: Number(v) })}
              />
              <EditRow
                label="AIRPORT 폴더"
                env="ATC_PROJECTS_DIR"
                value={s.agents.projectsDir}
                note="이 폴더 아래 git 저장소를 AIRPORT로 찾음"
                input={{ kind: "text", mono: true, maxLength: 400 }}
                onSave={(v) => save({ projectsDir: v })}
              />
            </>
          )}
        </ServerRows>
      </Block>

      <Block code="REVIEW" label="Codex 한도 때 착륙 리뷰">
        <ServerRows server={server}>
          {(s) => (
            <EditRow
              label="보안 PR"
              env="externalReview.security"
              value={s.review.security}
              note={
                s.review.security === "deepseek"
                  ? "deepseek(dispatch.json, 옛 이름): 보안 PR도 REVIEW 세션(Claude Sonnet)이 리뷰함. .env·비밀·키 경로와 FLIGHT 없는 PR은 계속 보내지 않음"
                  : "dispatch.json. exclude(기본): 보안 규칙(라벨·경로·키워드)에 걸린 PR은 REVIEW 세션에 보내지 않고 SUPERVISOR 리뷰로. deepseek(옛 이름)으로 바꾸면 보안 PR도 REVIEW(Claude Sonnet)가 리뷰함"
              }
              input={{ kind: "select", options: ["exclude", "deepseek"] }}
              onSave={(v) => save({ reviewSecurity: v as "exclude" | "deepseek" })}
            />
          )}
        </ServerRows>
      </Block>

      <Block code="FUEL" label="사용 한도 HOLD(SUPERVISOR 전용)">
        <ServerRows server={server}>
          {(s) => (
            <EditRow
              label="DISPATCH HOLD"
              env="fuel.hold"
              value={s.fuel?.hold ? "on" : "off"}
              note={
                s.fuel?.hold
                  ? `on(dispatch.json): ACCOUNT가 한도의 ${s.fuel.holdPct}% 이상을 쓰면 reset까지 DISPATCH가 그 ACCOUNT의 AIRCRAFT를 건너뜀. ${s.fuel.infoPct}%부터 TOWER·OCC에 INFO`
                  : `off(기본, dispatch.json): FUEL은 FLEET 줄과 TOWER·OCC INFO(${s.fuel?.infoPct ?? 80}%)에만 보임. on이면 ${s.fuel?.holdPct ?? 95}% 이상인 ACCOUNT의 AIRCRAFT를 DISPATCH가 건너뜀. statusline hook이 있어야 값이 들어옴`
              }
              input={{ kind: "select", options: ["off", "on"] }}
              onSave={(v) => save({ fuelHold: v as "off" | "on" })}
            />
          )}
        </ServerRows>
      </Block>

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
                onSave={(v) => save({ autolandMode: v as "off" | "update" | "merge" })}
              />
              <ul className="autoland-modes">
                {(["off", "update", "merge"] as const).map((m) => (
                  <li key={m} className={m === s.autoland.mode ? "is-current" : undefined}>
                    <b>{m}</b> {AUTOLAND_WARN[m]}
                  </li>
                ))}
              </ul>
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
                input={{ kind: "select", options: ["shadow", "land", "land+rts"] }}
                onSave={(v) => save({ mccMode: v as "shadow" | "land" | "land+rts" })}
              />
              <ul className="autoland-modes">
                {(["shadow", "land", "land+rts"] as const).map((m) => (
                  <li key={m} className={m === s.mcc.mode ? "is-current" : undefined}>
                    <b>{m}</b> {MCC_WARN[m]}
                  </li>
                ))}
              </ul>
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
                  onSave={(v) => save({ judgesJev: v as "off" | "replay" | "shadow" })}
                />
                <ul className="autoland-modes">
                  {(["off", "replay", "shadow"] as const).map((m) => (
                    <li key={m} className={m === s.judges.jev.mode ? "is-current" : undefined}>
                      <b>{m}</b> {JUDGE_WARN[m]}
                    </li>
                  ))}
                </ul>
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

      <Block code="CALLSIGNS" label="콜사인">
        {teams.length ? (
          <ul className="callsigns">
            {teams.slice(0, 8).map((s) => (
              <li key={s.id}>
                <span className="mono faint">{s.name}</span> → <b>{callsign(s)}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-hint">TEAM_A 같은 세션 이름이 ALPHA 같은 음성 알파벳 콜사인으로 보입니다.</p>
        )}
        <p className="settings-hint">세션 이름 TEAM_&lt;글자&gt; → 음성 알파벳. 그 밖의 이름은 그대로.</p>
      </Block>
      <EditNote />
    </>
  );
}

type Input =
  | { kind: "text"; upper?: boolean; mono?: boolean; maxLength: number }
  | { kind: "number"; min: number; max: number }
  | { kind: "select"; options: string[] };

// 값을 보여 주다가 "편집"을 누르면 입력 칸이 된다. Enter 저장, Esc 취소(설정 창은 닫히지 않음).
function EditRow({
  label,
  env,
  value,
  unit,
  note,
  input,
  onSave,
}: {
  label: string;
  env: string;
  value: string;
  unit?: string;
  note?: string;
  input: Input;
  onSave: (value: string) => Promise<SaveResult>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = draft !== null;
  const mono = input.kind === "text" && input.mono;

  const cancel = () => {
    setDraft(null);
    setError(null);
  };
  const submit = async () => {
    if (draft === null) return;
    if (draft.trim() === value) return cancel();
    setBusy(true);
    const res = await onSave(draft.trim());
    setBusy(false);
    if (res.ok) cancel();
    else setError(res.error);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") void submit();
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    }
  };

  return (
    <div className={`config-row${editing ? " is-editing" : ""}`}>
      <dt>
        {label}
        <code className="config-env">{env}</code>
      </dt>
      {editing ? (
        <dd className="config-edit">
          {input.kind === "select" ? (
            <select value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} autoFocus aria-label={label}>
              {input.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              className={mono ? "mono" : undefined}
              type={input.kind === "number" ? "number" : "text"}
              min={input.kind === "number" ? input.min : undefined}
              max={input.kind === "number" ? input.max : undefined}
              maxLength={input.kind === "text" ? input.maxLength : undefined}
              value={draft}
              onChange={(e) => setDraft(input.kind === "text" && input.upper ? e.target.value.toUpperCase() : e.target.value)}
              onKeyDown={onKey}
              autoFocus
              aria-label={label}
              aria-invalid={Boolean(error)}
            />
          )}
          {unit && <span className="config-unit">{unit}</span>}
          <button className="config-btn is-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "저장 중" : "저장"}
          </button>
          <button className="config-btn" onClick={cancel} disabled={busy}>
            취소
          </button>
        </dd>
      ) : (
        <dd className={mono ? "mono" : undefined}>
          <span className="config-value" title={value}>
            {value}
            {unit && ` ${unit}`}
          </span>
          <button className="config-btn" onClick={() => setDraft(value)} aria-label={`${label} 편집`}>
            편집
          </button>
        </dd>
      )}
      {error ? <p className="config-note is-error">{error}</p> : note && <p className="config-note">{note}</p>}
    </div>
  );
}

// API 키: 값은 한 번 저장하면 화면에 다시 보이지 않는다. 바꾸거나 지울 수만 있다(지우기는 한 번 더 확인).
function SecretRow({ label, env, isSet, save }: { label: string; env: string; isSet: boolean; save: Save }) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode("view");
    setDraft("");
    setError(null);
  };
  const run = async (patch: SettingsPatch) => {
    setBusy(true);
    const res = await save(patch);
    setBusy(false);
    if (res.ok) reset();
    else setError(res.error);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && draft.trim()) void run({ apiKey: draft });
    if (e.key === "Escape") {
      e.stopPropagation();
      reset();
    }
  };

  return (
    <div className={`config-row${mode !== "view" ? " is-editing" : ""}`}>
      <dt>
        {label}
        <code className="config-env">{env}</code>
      </dt>
      {mode === "edit" ? (
        <dd className="config-edit">
          <input
            className="mono"
            type="password"
            placeholder="lin_api_…"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            autoFocus
            aria-label="새 API 키"
            aria-invalid={Boolean(error)}
          />
          <button className="config-btn is-primary" onClick={() => void run({ apiKey: draft })} disabled={busy || !draft.trim()}>
            {busy ? "저장 중" : "저장"}
          </button>
          <button className="config-btn" onClick={reset} disabled={busy}>
            취소
          </button>
        </dd>
      ) : mode === "confirm-delete" ? (
        <dd className="config-edit">
          <span className="config-value tone-bad">Linear 연결이 끊깁니다</span>
          <button className="config-btn is-danger" onClick={() => void run({ apiKey: null })} disabled={busy} autoFocus>
            {busy ? "삭제 중" : "삭제"}
          </button>
          <button className="config-btn" onClick={reset} disabled={busy}>
            취소
          </button>
        </dd>
      ) : (
        <dd>
          <span className={`config-value tone-${isSet ? "ok" : "bad"}`}>{isSet ? "설정됨" : "없음"}</span>
          <button className="config-btn" onClick={() => setMode("edit")}>
            {isSet ? "바꾸기" : "입력"}
          </button>
          {isSet && (
            <button className="config-btn" onClick={() => setMode("confirm-delete")}>
              삭제
            </button>
          )}
        </dd>
      )}
      {error ? (
        <p className="config-note is-error">{error}</p>
      ) : (
        <p className="config-note">저장한 키는 화면에 다시 보이지 않습니다. .env.local은 본인만 읽도록(600) 저장됩니다.</p>
      )}
    </div>
  );
}

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
  "land+rts": "⚠ land에 더해 머지된 main을 atc-rts 유닛으로 7700에 RETURN TO SERVICE(상태 확인 실패면 ROLLBACK 후 멈춤).",
} as const;

// 판정 계열 모드마다 한 줄(ATC-36). replay·shadow는 티켓 제목과 허용한 칸이 TypeSafe로 나간다(데이터 반출)
const JUDGE_WARN = {
  off: "꺼짐(기본): 아무것도 읽거나 보내지 않는다.",
  replay: "⚠ SUPERVISOR가 판정한 지난 CLASSIFY 초안을 1분에 3건씩 다시 판정한다. 제목과 목표·수정 허용 범위·완료 기준이 TypeSafe로 나간다(rating:SEC·Risk:* 티켓은 제목만).",
  shadow: "⚠ 새 CLASSIFY 초안마다 판정해 둔다(결과는 SUPERVISOR 판정 뒤에만 보임). 반출 범위는 replay와 같다.",
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

// 관제 세션(docs/fleet.md 8.5.1). 줄마다 live 배지. TOWER·OCC·MCC·CROSSCHECK·REVIEW는 atc가 그 폴더에서 `claude --bg`로 띄운다
// (ocx·tmux LAUNCH는 2026-09-29에 끊음). ENGINEERING은 배지만. tmux pane에서 손으로 연 세션도 STOP한다(그 pane만 닫음, 묻고 나서).
// 데스크톱 세션은 그 창에서 닫는다
type ControlLive = { id?: string; name?: string; kind: string; status?: string; tmux?: string };
type ControlAccounts = { labeled: boolean; rows: { name: string; label: string | null; account: string | null }[] };
type ControlSession = { name: string; dir: string | null; prompt: string | null; launch: "bg" | null; blocked: string | null; live: ControlLive[] };
type ControlList = { daemonInService?: boolean; sessions: ControlSession[] };
function ControlSessions() {
  const [list, setList] = useState<ControlList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ControlAccounts | null>(null);
  const load = async () => {
    fetch("/api/control/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((a: ControlAccounts | null) => a && setAccounts(a))
      .catch(() => {});
    try {
      const res = await fetch("/api/control/sessions");
      const body = await res.json();
      if (res.ok) {
        setList(body as ControlList);
        setError(null);
      } else setError(body.error ?? `HTTP ${res.status}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const act = async (name: string, op: "launch" | "stop", tmux?: string) => {
    if (tmux && !window.confirm(`${name}: tmux ${tmux}의 pane을 닫습니다. 대화 기록은 남고 claude --resume으로 다시 열 수 있습니다.`)) return;
    setBusy(name);
    setError(null);
    try {
      const res = await fetch(`/api/control/${encodeURIComponent(name)}/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) setError(`${name}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
    await load();
    setBusy(null);
  };
  // ACCOUNT(ATC-60): 관제 세션도 FUEL에서 그 ACCOUNT에 센다. 라벨만 둔다(fleet.json control)
  const saveAccount = async (name: string, v: string): Promise<SaveResult> => {
    try {
      const res = await fetch(`/api/control/${encodeURIComponent(name)}/account`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: v || null }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; accounts?: ControlAccounts };
      if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      if (body.accounts) setAccounts(body.accounts);
      return { ok: true };
    } catch {
      return { ok: false, error: "서버에 연결할 수 없음" };
    }
  };
  const accountRow = (name: string) => {
    const a = accounts?.rows.find((r) => r.name === name);
    if (!a) return null;
    return (
      <EditRow
        key={`${name}-account`}
        label={`${name} ACCOUNT`}
        env={`fleet.json control.${name}`}
        value={a.label ?? ""}
        note={
          a.label
            ? `FUEL에서 ACCOUNT ${a.label}에 센다. 비우면 ${accounts?.labeled ? "default" : "자기 이름으로 따로"}`
            : a.account
              ? `라벨 없음 — ACCOUNT ${a.account}로 센다. 사용 한도를 같이 쓰는 AIRCRAFT와 같은 라벨(main, pro-2 …). email은 쓰지 않는다`
              : "라벨 없음 — 어느 AIRCRAFT에도 ACCOUNT가 없어 이 세션 이름으로 따로 센다"
        }
        input={{ kind: "text", mono: true, maxLength: 24 }}
        onSave={(v) => saveAccount(name, v.toLowerCase())}
      />
    );
  };
  // 세션 목록을 못 읽어도 ACCOUNT 라벨은 보이고 고칠 수 있다
  if (!list)
    return error ? (
      <dl className="config-rows">
        <p className="conn-error">{error}</p>
        {accounts?.rows.map((r) => accountRow(r.name))}
      </dl>
    ) : (
      <p className="settings-hint">불러오는 중…</p>
    );
  const shown = new Set(list.sessions.map((c) => c.name));
  return (
    <dl className="config-rows">
      {list.sessions.map((c) => {
        const bg = c.live.find((l) => l.kind === "background" && l.id);
        const tmux = bg ? undefined : c.live.find((l) => l.tmux);
        const other = c.live.find((l) => l !== bg);
        // live 배지: BG <id>, tmux <세션>, interactive(데스크톱 등), not running
        const badge = bg ? `BG ${bg.id}` : tmux ? `tmux ${tmux.tmux}` : other ? "interactive" : "not running";
        const detail = bg ? bg.status : tmux ? [tmux.name ?? tmux.kind, tmux.status].filter(Boolean).join(" · ") : other ? `${other.name ?? other.kind} · 데스크톱 세션은 그 창에서 닫는다` : undefined;
        const how = c.launch === "bg" ? (tmux ? "tmux에서 연 세션" : "claude --bg") : null;
        return (
          <Fragment key={c.name}>
          <div className="config-row">
            <dt>
              {c.name} <code className="config-env">{c.dir ? `${c.dir}/` : "저장소 뿌리"}</code>
            </dt>
            <dd>
              {c.launch === null ? null : bg || tmux ? (
                <button className="config-btn is-danger" onClick={() => void act(c.name, "stop", tmux?.tmux)} disabled={busy !== null}>
                  STOP
                </button>
              ) : (
                <button className="config-btn is-primary" onClick={() => void act(c.name, "launch")} disabled={busy !== null || Boolean(other) || Boolean(c.blocked)} title={c.blocked ?? undefined}>
                  LAUNCH
                </button>
              )}
            </dd>
            <p className="config-note">
              <span className={`session-badge ${bg || tmux ? "is-busy" : other ? "" : "is-dead"}`}>{badge}</span>
              {detail ? ` · ${detail}` : ""}
              {how ? (
                <>
                  {" "}· {how} · 첫 메시지 <code>{c.prompt}</code>
                </>
              ) : (
                " · 이름으로 알아본다"
              )}
              {c.blocked && c.launch !== null ? <span className="is-error"> · LAUNCH 꺼짐: {c.blocked}</span> : null}
            </p>
          </div>
          {accountRow(c.name)}
          </Fragment>
        );
      })}
      {list.daemonInService && (
        <p className="config-note is-error">
          백그라운드 세션 daemon이 atc 서비스 안에서 돌고 있음 — atc를 재시작하면(배포·RTS) 모든 백그라운드 세션이 함께 멈춘다. 재시작한 뒤 LAUNCH하면 daemon이 서비스 밖(systemd scope)에서 뜬다
        </p>
      )}
      <p className="config-note">모델은 폴더의 .claude/settings.json이 정한다: TOWER·OCC·REVIEW Claude Sonnet, MCC·CROSSCHECK Claude Opus</p>
      {accounts?.rows.filter((r) => !shown.has(r.name)).map((r) => accountRow(r.name))}
      {error && <p className="config-note is-error">{error}</p>}
    </dl>
  );
}

function Block({ code, label, children }: { code: string; label: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="label">
        {code} <em>{label}</em>
      </h3>
      {children}
    </section>
  );
}

function ServerRows({ server, children }: { server: Loaded; children: (s: ServerSettings) => ReactNode }) {
  if (server.state === "loading") return <p className="settings-hint">불러오는 중…</p>;
  if (server.state === "error") return <p className="conn-error">서버가 설정을 알려주지 않음(/api/settings). 서버를 다시 시작하면 보입니다.</p>;
  return <dl className="config-rows">{children(server.data)}</dl>;
}

function AgentRow({
  name,
  code,
  present,
  dir,
  total,
  busy,
  children,
}: {
  name: string;
  code: string;
  present: boolean;
  dir: string;
  total: number;
  busy: number;
  children?: ReactNode;
}) {
  return (
    <div className="agent-row">
      <div className="agent-row-head">
        <span className="type">{code}</span>
        <b>{name}</b>
        <span className="agent-count">{present ? `세션 ${total}개${busy ? ` · AIRBORNE ${busy}` : ""}` : "설치 안 됨"}</span>
      </div>
      <div className="agent-row-meta">
        <code className="config-env" title={dir}>
          {dir}
        </code>
        {children}
      </div>
    </div>
  );
}

function StatusChip({ tone, children }: { tone: "ok" | "bad" | "mute"; children: ReactNode }) {
  return <span className={`status-chip tone-${tone}`}>{children}</span>;
}

function EditNote() {
  return <p className="settings-foot">저장하면 .env.local에 쓰고 서버에 바로 반영됩니다(재시작 필요 없음).</p>;
}
