import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { type ControlList, controlPollDue, CONTROL_POLL_MS, controlRowOf } from "../../../../server/control-view.ts";
import { EditRow, type SaveResult } from "../../SettingsServer.tsx";
import { JobDetail, NeedsYou } from "../../ui.tsx";

// FLEET 탭의 CONTROL SESSIONS(ATC-130, docs/fleet.md 8.5.1). 설정 창 AGENTS에 있던 것을 옮겼다. 동작은 그대로.
// 줄마다 live 배지. TOWER·OCC·MCC·CROSSCHECK·REVIEW는 atc가 그 폴더에서 `claude --bg`로 띄운다(ocx·tmux LAUNCH는 2026-09-29에 끊음).
// ENGINEERING은 배지만. tmux pane에서 손으로 연 세션도 STOP한다(그 pane만 닫음, 묻고 나서). 데스크톱 세션은 그 창에서 닫는다.
// 새로 읽기: FLEET가 보이는 동안 60초에 한 번(탭을 막 열어도 마지막 읽은 지 60초 전이면 그 값을 보인다), LAUNCH·STOP 뒤에는 곧장.
type ControlAccounts = { labeled: boolean; rows: { name: string; label: string | null; account: string | null }[] };

// 탭을 오가도 60초 안에는 다시 읽지 않도록 모듈에 둔다
const memo: { list: ControlList | null; accounts: ControlAccounts | null; at: number | null } = { list: null, accounts: null, at: null };

export function ControlSessions() {
  const [list, setList] = useState<ControlList | null>(memo.list);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ControlAccounts | null>(memo.accounts);
  const inflight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inflight.current || !controlPollDue(memo.at, Date.now(), force)) return;
    inflight.current = true;
    memo.at = Date.now();
    fetch("/api/control/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((a: ControlAccounts | null) => {
        if (!a) return;
        memo.accounts = a;
        setAccounts(a);
      })
      .catch(() => {});
    try {
      const res = await fetch("/api/control/sessions");
      const body = await res.json();
      if (res.ok) {
        memo.list = body as ControlList;
        setList(body as ControlList);
        setError(null);
      } else setError(body.error ?? `HTTP ${res.status}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
    inflight.current = false;
  }, []);
  // #fleet/control로 오면(설정 창의 안내, 헤더 CONTROL 띠) 이 구역으로 스크롤하고 초점을 둔다
  const ready = list !== null || error !== null;
  useEffect(() => {
    const go = () => {
      if (location.hash.slice(1) !== "fleet/control") return;
      const el = document.getElementById("control");
      el?.scrollIntoView({ block: "start" });
      el?.focus({ preventScroll: true });
    };
    go();
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, [ready]);
  // 처음과 60초마다. 숨겨진 탭(브라우저)은 건너뛴다
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, CONTROL_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const act = async (name: string, op: "launch" | "stop", tmux?: string | null) => {
    if (tmux && !window.confirm(`${name}: tmux ${tmux}의 pane을 닫습니다. 대화 기록은 남고 claude --resume으로 다시 열 수 있습니다.`)) return;
    setBusy(name);
    setError(null);
    try {
      const res = await fetch(`/api/control/${encodeURIComponent(name)}/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) setError(`${name}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
    await load(true);
    setBusy(null);
  };
  // ACCOUNT(ATC-60): 관제 세션도 FUEL에서 그 ACCOUNT에 센다. 라벨만 둔다(fleet.json control)
  const saveAccount = async (name: string, v: string): Promise<SaveResult> => {
    try {
      const res = await fetch(`/api/control/${encodeURIComponent(name)}/account`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: v || null }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; accounts?: ControlAccounts };
      if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      if (body.accounts) {
        memo.accounts = body.accounts;
        setAccounts(body.accounts);
      }
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

  const heading = (
    <h2 className="label">
      CONTROL SESSIONS <em>{list?.sessions.length ?? ""}</em>
    </h2>
  );
  // 세션 목록을 못 읽어도 ACCOUNT 라벨은 보이고 고칠 수 있다
  if (!list)
    return (
      <section className="fl-control" id="control" tabIndex={-1}>
        {heading}
        {error ? (
          <dl className="config-rows">
            <p className="conn-error">{error}</p>
            {accounts?.rows.map((r) => accountRow(r.name))}
          </dl>
        ) : (
          <p className="settings-hint">불러오는 중…</p>
        )}
      </section>
    );
  const shown = new Set(list.sessions.map((c) => c.name));
  return (
    <section className="fl-control" id="control" tabIndex={-1}>
      {heading}
      <dl className="config-rows">
        {/* 맨 위: 재시작하면 모든 백그라운드 세션이 함께 멈춘다 */}
        {list.daemonInService && (
          <p className="config-note is-error">
            백그라운드 세션 daemon이 atc 서비스 안에서 돌고 있음 — atc를 재시작하면(배포·RTS) 모든 백그라운드 세션이 함께 멈춘다. 재시작한 뒤 LAUNCH하면 daemon이 서비스 밖(systemd scope)에서 뜬다
          </p>
        )}
        {list.sessions.map((c) => {
          const r = controlRowOf(c);
          return (
            <Fragment key={c.name}>
              <div className="config-row">
                <dt>
                  {r.name} <code className="config-env">{r.dir}</code>
                </dt>
                <dd>
                  {r.action?.kind === "stop" ? (
                    <button className="config-btn is-danger" onClick={() => void act(r.name, "stop", r.action?.kind === "stop" ? r.action.tmux : null)} disabled={busy !== null}>
                      STOP
                    </button>
                  ) : r.action?.kind === "launch" ? (
                    <button className="config-btn is-primary" onClick={() => void act(r.name, "launch")} disabled={busy !== null || r.action.disabled} title={r.action.title ?? undefined}>
                      LAUNCH
                    </button>
                  ) : null}
                </dd>
                <p className="config-note">
                  <span className={`session-badge ${r.tone === "busy" ? "is-busy" : r.tone === "other" ? "" : "is-dead"}`}>{r.badge}</span>
                  {r.detail ? ` · ${r.detail}` : ""}
                  {r.needs ? <> · <NeedsYou job={r.needs} /></> : r.working ? <> · <JobDetail job={r.working} /></> : null}
                  {r.how ? (
                    <>
                      {" "}· {r.how} · 첫 메시지 <code>{c.prompt}</code>
                    </>
                  ) : (
                    " · 이름으로 알아본다"
                  )}
                  {r.launchOff ? <span className="is-error"> · LAUNCH 꺼짐: {r.launchOff}</span> : null}
                  {/* STALE(ATC-93): 멈췄는데 Claude Code가 아직 목록에 둔 job. live가 아니고 LAUNCH를 막지 않는다 */}
                  {r.stale.length > 0 && (
                    <span className="config-stale" title="claude agents --json에 pid·status 없이 남은 멈춘 background job">
                      {" "}· <span className="session-badge">STALE {r.stale.join(", ")}</span> Claude Code가 멈춘 job을 아직 목록에 둠 — 무시해도 된다
                    </span>
                  )}
                </p>
              </div>
              {accountRow(c.name)}
            </Fragment>
          );
        })}
        <p className="config-note">모델은 폴더의 .claude/settings.json이 정한다: TOWER·OCC·REVIEW Claude Sonnet, MCC·CROSSCHECK Claude Opus</p>
        {accounts?.rows.filter((r) => !shown.has(r.name)).map((r) => accountRow(r.name))}
        {error && <p className="config-note is-error">{error}</p>}
      </dl>
    </section>
  );
}
