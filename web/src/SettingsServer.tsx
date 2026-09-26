import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import type { Snapshot } from "../../server/model.ts";
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
  const states = snapshot?.columns.map((c) => c.name) ?? [];
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
                label="LANDING 상태"
                env="ATC_LANDING_STATE"
                value={s.linear.landingState}
                note="이 상태의 FLIGHT가 LANDING SEQUENCE에 들어감"
                input={
                  states.length
                    ? { kind: "select", options: states.includes(s.linear.landingState) ? states : [s.linear.landingState, ...states] }
                    : { kind: "text", maxLength: 64 }
                }
                onSave={(v) => save({ landingState: v })}
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
