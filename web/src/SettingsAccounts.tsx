import { useEffect, useState } from "react";
import { ApplyNow } from "./ApplyNow.tsx";
import type { AddPreview, AddResult } from "../../server/account-add.ts";
import type { FolderHealth } from "../../server/account-health.ts";
import type { LoginView } from "../../server/account-login.ts";
import type { MemoryFolderView } from "../../server/account-memory.ts";
import type { AccountsRegistry } from "../../server/accounts.ts";
import { Block, StatusChip } from "./SettingsServer.tsx";

// AGENTS 탭의 ACCOUNTS 블록(ATC-146, docs/accounts.md). 라벨과 Claude Code 설정 폴더만 적는다(email·토큰은 없다). 저장은 SUPERVISOR만(서버가 Origin을 본다).
// 폴더마다 로그인 여부(loggedIn·authMethod만)와 atc statusline·hook이 걸려 있는지를 보이고, 없으면 경고한다. 막지는 않는다.
interface AccountsState {
  registry: AccountsRegistry;
  folders: FolderHealth[];
}
interface Row {
  label: string;
  configDir: string;
  maxLaunched: string; // ACCOUNT별 백그라운드 세션 상한(ATC-147). 비우면 없음
}

export function AccountsBlock() {
  const [data, setData] = useState<AccountsState | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [memory, setMemory] = useState<MemoryFolderView[]>([]); // ATC-191: 폴더별 memory 상태
  const [sharing, setSharing] = useState(false);
  const loadMemory = () =>
    fetch("/api/accounts/memory")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { memory: MemoryFolderView[] }) => setMemory(d.memory))
      .catch(() => {});
  const shareMemory = async () => {
    setSharing(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/memory", { method: "POST", headers: { "Content-Type": "application/json" } });
      const body = await res.json();
      if (res.ok) setMemory((body as { memory: MemoryFolderView[] }).memory);
      else setError(body.error ?? `HTTP ${res.status}`);
    } catch {
      setError("서버에 연결할 수 없음");
    } finally {
      setSharing(false);
    }
  };
  const [logins, setLogins] = useState<Record<string, LoginView>>({}); // 이 화면에서 LOGIN을 마친 폴더(줄이 LOGGED IN으로 바뀐 뒤에도 온보딩 결과를 보인다)
  const load = (d: AccountsState) => {
    setData(d);
    setRows(Object.entries(d.registry).map(([label, e]) => ({ label, configDir: e.configDir, maxLaunched: e.maxLaunched ? String(e.maxLaunched) : "" })));
  };
  const reload = () =>
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: AccountsState) => load(d))
      .then(loadMemory)
      .catch(() => setError("ACCOUNTS를 읽지 못함"));
  useEffect(() => {
    let alive = true;
    void loadMemory();
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: AccountsState) => alive && load(d))
      .catch(() => alive && setError("ACCOUNTS를 읽지 못함"));
    return () => {
      alive = false;
    };
  }, []);

  const dirty = data ? JSON.stringify(rows.map((r) => [r.label.trim(), r.configDir.trim(), r.maxLaunched.trim()])) !== JSON.stringify(Object.entries(data.registry).map(([l, e]) => [l, e.configDir, e.maxLaunched ? String(e.maxLaunched) : ""])) : false;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const accounts = Object.fromEntries(rows.filter((r) => r.label.trim() || r.configDir.trim()).map((r) => [r.label.trim(), { configDir: r.configDir.trim(), ...(r.maxLaunched.trim() ? { maxLaunched: Number(r.maxLaunched) } : {}) }]));
      const res = await fetch("/api/accounts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accounts }) });
      const body = await res.json();
      if (res.ok) load(body as AccountsState);
      else setError(body.error ?? `HTTP ${res.status}`);
    } catch {
      setError("서버에 연결할 수 없음");
    } finally {
      setSaving(false);
    }
  };
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Block code="ACCOUNTS" label="ACCOUNT 폴더(ATC-146)">
      <p className="settings-hint">
        ACCOUNT는 라벨과 Claude Code 설정 폴더다(예: acct-1 = ~/.claude-acct-1). atc는 등록된 모든 폴더의 세션·FUEL을 읽고, 세션의 ACCOUNT는 그 세션 파일이 있는 폴더로 정한다. <span className="mono">~/.claude</span>는 등록하지 않아도
        읽는다. email·토큰은 저장하지 않는다.
      </p>
      {data?.folders.map((f) => (
        <div key={f.dir} className="acct-folder">
          <span className="mono">
            <b>{f.label}</b> {f.dir}
            {!f.registered && <span className="faint"> (등록 안 됨, 기본 폴더)</span>}
          </span>
          <div className="acct-chips">
            <StatusChip tone={f.loggedIn === true ? "ok" : f.loggedIn === false ? "bad" : "mute"}>
              {f.loggedIn === true ? `LOGGED IN${f.authMethod ? ` · ${f.authMethod}` : ""}` : f.loggedIn === false ? "NOT LOGGED IN" : "LOGIN ?"}
            </StatusChip>
            <StatusChip tone={f.statusline ? "ok" : "mute"}>{f.statusline ? "STATUSLINE ✓" : "STATUSLINE 없음"}</StatusChip>
            <StatusChip tone={f.healthHook ? "ok" : "mute"}>{f.healthHook ? "HEALTH HOOK ✓" : "HEALTH HOOK 없음"}</StatusChip>
            <StatusChip tone={f.claimHook ? "ok" : "mute"}>{f.claimHook ? "CLAIM HOOK ✓" : "CLAIM HOOK 없음"}</StatusChip>
          </div>
          <MemoryLine view={memory.find((m) => m.dir === f.dir)} sharing={sharing} onShare={shareMemory} />
          {f.registered && f.loggedIn === false && (
            <LoginPanel
              label={f.label}
              onDone={(v) => {
                setLogins((m) => ({ ...m, [f.label]: v }));
                void reload();
              }}
            />
          )}
          {f.loggedIn === true && logins[f.label] && <p className="settings-hint">{loginNote(logins[f.label])}</p>}
          {f.warnings.length > 0 && (
            <ul className="settings-hint acct-warn">
              {f.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <h4 className="label acct-registry">
        REGISTRY <em>fleet.json의 ACCOUNT 목록 · 상한은 ACCOUNT별 백그라운드 세션 수</em>
      </h4>
      {rows.map((r, i) => (
        <div key={i} className="acct-edit">
          <input className="mono" aria-label="ACCOUNT 라벨" placeholder="acct-1" maxLength={24} value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
          <input className="mono" aria-label="설정 폴더" placeholder="/home/…/.claude-acct-1" maxLength={400} value={r.configDir} onChange={(e) => set(i, { configDir: e.target.value })} />
          <input className="mono acct-cap" aria-label="ACCOUNT별 세션 상한" title="이 ACCOUNT의 백그라운드 세션 상한(비우면 기계 전체 상한만)" placeholder="상한" inputMode="numeric" maxLength={3} value={r.maxLaunched} onChange={(e) => set(i, { maxLaunched: e.target.value.replace(/\D/g, "") })} />
          <button type="button" className="config-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            삭제
          </button>
        </div>
      ))}
      <div className="acct-actions">
        <button type="button" className="config-btn" onClick={() => setRows([...rows, { label: "", configDir: "", maxLaunched: "" }])}>
          + ACCOUNT
        </button>
        <button type="button" className="config-btn is-primary" disabled={!dirty || saving} onClick={save}>
          저장
        </button>
        {error && <span className="settings-hint acct-err"> {error}</span>}
      </div>
      <LaunchAccountRow registryKey={data ? Object.keys(data.registry).join(",") : ""} />
      <AddAccount dirty={dirty} folders={data?.folders ?? []} onAdded={(d) => {
          load(d);
          void loadMemory();
        }}
      />
    </Block>
  );
}

// SHARE MEMORY(ATC-191): 폴더의 Claude Code memory가 ~/.claude 것과 같은가. 충돌은 파일 이름만 보인다(내용은 서버도 열지 않는다)
function MemoryLine({ view, sharing, onShare }: { view: MemoryFolderView | undefined; sharing: boolean; onShare: () => void }) {
  if (!view) return null;
  return (
    <div className="acct-chips">
      <StatusChip tone={view.status === "shared" ? "ok" : view.status === "conflict" ? "bad" : "mute"}>{view.status === "shared" ? "MEMORY shared ✓" : view.status === "conflict" ? "MEMORY conflict" : "MEMORY separate"}</StatusChip>
      {view.status !== "shared" && (
        <button type="button" className="config-btn" disabled={sharing} onClick={onShare} title="빈 memory 폴더를 ~/.claude 것으로 잇는다. 파일이 든 폴더는 건드리지 않는다">
          SHARE MEMORY
        </button>
      )}
      {view.conflicts.length > 0 && (
        <ul className="settings-hint acct-warn">
          {view.conflicts.map((c) => (
            <li key={c.key}>
              ⚠ <span className="mono">{c.key}</span>에 이미 memory가 있어 잇지 않음: <span className="mono">{c.names.join(", ") || "(폴더가 아님)"}</span>. 직접 합친 뒤 폴더를 치우면 다음 SHARE MEMORY가 잇는다.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ADD ACCOUNT(ATC-186, docs/accounts.md 4절): 폴더 만들기 → ~/.claude/settings.json 복사 → 등록을 한 번에. 로그인과 온보딩은 터미널에 남는다.
// env는 키 이름만 받는다(값은 서버 밖으로 나오지 않는다). 체크를 풀면 그 키는 새 폴더에 옮기지 않는다
function AddAccount({ dirty, folders, onAdded }: { dirty: boolean; folders: FolderHealth[]; onAdded: (d: AccountsState) => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AddPreview | null>(null);
  const [label, setLabel] = useState("");
  const [dir, setDir] = useState("");
  const [homeLabel, setHomeLabel] = useState("");
  const [drop, setDrop] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AddResult | null>(null);

  const loadPreview = () =>
    fetch("/api/accounts/add")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((p: AddPreview) => {
        setPreview(p);
        setHomeLabel(p.suggestHomeLabel ?? "");
      })
      .catch(() => setError("미리보기를 읽지 못함"));
  const start = () => {
    setOpen(true);
    setDone(null);
    setError(null);
    void loadPreview();
  };
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), ...(dir.trim() ? { configDir: dir.trim() } : {}), ...(preview?.homeLabel ? {} : { homeLabel: homeLabel.trim() }), dropEnv: drop }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      onAdded({ registry: body.registry, folders: body.folders });
      setDone(body.result as AddResult);
      setLabel("");
      setDir("");
      setDrop([]);
      void loadPreview(); // 이제 ~/.claude가 등록됐을 수 있다
    } catch {
      setError("서버에 연결할 수 없음");
    } finally {
      setBusy(false);
    }
  };
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

  if (!open)
    return (
      <div className="acct-actions">
        <button type="button" className="config-btn is-primary" onClick={start}>
          ADD ACCOUNT
        </button>
        <span className="settings-hint">폴더를 만들고 settings.json을 복사하고 등록한다. 로그인은 그다음 그 줄의 LOGIN으로.</span>
      </div>
    );

  const p = preview;
  const placeholder = p ? `${p.home}/.claude-${label.trim() || "<라벨>"}` : "";
  return (
    <div className="acct-add">
      <h4 className="label">ADD ACCOUNT</h4>
      {!p && !error && <p className="settings-hint">불러오는 중…</p>}
      {p && (
        <>
          <div className="acct-edit">
            <input className="mono" aria-label="새 ACCOUNT 라벨" placeholder="acct-1" maxLength={24} value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} />
            <input className="mono" aria-label="새 설정 폴더" placeholder={placeholder} maxLength={400} value={dir} onChange={(e) => setDir(e.target.value)} />
          </div>
          {p.homeLabel ? (
            <p className="settings-hint">
              <span className="mono">{p.claudeDir}</span>는 <b className="mono">{p.homeLabel}</b>로 등록돼 있다.
            </p>
          ) : (
            <div className="acct-edit">
              <label className="settings-hint" htmlFor="acct-home-label">
                <span className="mono">~/.claude</span> 라벨도 함께 등록(FLEET 프로필이 쓰는 라벨)
              </label>
              <input id="acct-home-label" className="mono acct-home" maxLength={24} value={homeLabel} onChange={(e) => setHomeLabel(e.target.value.toLowerCase())} />
            </div>
          )}
          <p className="settings-hint">
            <span className="mono">{p.claudeDir}/settings.json</span>을 통째로 복사한다(statusline·hook·권한·env). 폴더에 자기 hook·env·권한이 있는 settings.json이 있으면 두고 등록만 한다.
            {(!p.source.statusline || !p.source.claimHook || !p.source.healthHook) && <span className="acct-err"> 원본에도 atc statusline·hook이 다 걸려 있지 않다.</span>}
          </p>
          {p.envKeys.length > 0 && (
            <fieldset className="acct-env">
              <legend className="settings-hint">옮길 env(값은 보이지 않는다). 프록시·BASE_URL은 이 ACCOUNT도 같은 길로 나갈 때만.</legend>
              {p.envKeys.map((k) => (
                <label key={k} className="mono">
                  <input type="checkbox" checked={!drop.includes(k)} onChange={(e) => setDrop(e.target.checked ? drop.filter((x) => x !== k) : [...drop, k])} /> {k}
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
      <div className="acct-actions">
        <button type="button" className="config-btn is-primary" disabled={!p || busy || !label.trim() || dirty} title={dirty ? "위 등록 칸의 바뀐 것을 먼저 저장하거나 되돌린다" : undefined} onClick={add}>
          {busy ? "만드는 중…" : "만들고 등록"}
        </button>{" "}
        <button type="button" className="config-btn" onClick={() => setOpen(false)}>
          닫기
        </button>
        {error && <span className="settings-hint acct-err"> {error}</span>}
      </div>
      {done && (
        <div className="acct-done" role="status">
          <p className="settings-hint">
            <b className="mono">{done.label}</b> → <span className="mono">{done.dir}</span>: 폴더 {done.folder === "created" ? "만듦" : "있던 것"}, settings.json{" "}
            {done.settings === "copied" ? "복사함" : done.settings === "replaced" ? "바꿔 씀" : "그대로 둠(폴더 자기 설정)"}
            {done.backup && (
              <>
                {" "}
                (옛 파일 <span className="mono">{done.backup}</span>)
              </>
            )}
            , 등록함{done.homeRegistered && <> · <span className="mono">~/.claude</span>는 {done.homeRegistered}</>}. memory: {done.memory ? `${done.memory.linked}곳 이음${done.memory.conflicts ? `, 충돌 ${done.memory.conflicts}` : ""}` : "잇지 못함(SHARE MEMORY로 다시)"}.
          </p>
          {folders.find((f) => f.dir === done.dir)?.loggedIn === true ? (
            <p className="settings-hint">
              이 폴더는 LOGGED IN이다. LOGIN 버튼이 아니라 터미널로 로그인했다면, 첫 화면을 끝내려고 <code className="mono">CLAUDE_CONFIG_DIR={done.dir} claude</code>를 한 번 연다.
            </p>
          ) : (
            <>
              <p className="settings-hint">
                이제 위 <b className="mono">{done.label}</b> 줄의 <b>LOGIN</b>: 브라우저에서 로그인하고 받은 코드를 붙여 넣으면 된다. 첫 화면과 AIRPORT 신뢰 표시도 atc가 해 둔다.
              </p>
              <p className="settings-hint">
                터미널로 하려면 <code className="mono">{done.loginCommand}</code>{" "}
                <button type="button" className="config-btn" onClick={() => copy(done.loginCommand)}>
                  복사
                </button>{" "}
                (URL은 <kbd>c</kbd>로 복사) 뒤 그 폴더로 <code className="mono">claude</code>를 한 번 연다.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// LOGIN(ATC-187): 서버가 그 폴더에서 claude auth login을 띄우고 URL을 준다. 브라우저에서 로그인해 받은 코드를 붙여 넣으면 끝.
// 코드는 서버가 그 프로세스에만 넘기고 남기지 않는다. 로그인되면 서버가 .claude.json에 첫 화면·AIRPORT 신뢰 표시만 해 둔다
function LoginPanel({ label, onDone }: { label: string; onDone: (v: LoginView) => void }) {
  const [view, setView] = useState<LoginView | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/accounts/${encodeURIComponent(label)}/login`;
  useEffect(() => {
    let alive = true;
    fetch(base)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { login: LoginView | null } | null) => alive && d?.login && setView(d.login))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [base]);
  const call = async (method: "POST" | "DELETE", path = "", body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? `HTTP ${res.status}`);
        return null;
      }
      return d as { login?: LoginView | null };
    } catch {
      setError("서버에 연결할 수 없음");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    const d = await call("POST");
    if (d?.login) setView(d.login);
  };
  const submit = async () => {
    const d = await call("POST", "/code", { code });
    if (d?.login) {
      setView(d.login);
      setCode("");
      if (d.login.state === "done") onDone(d.login);
    }
  };
  const cancel = async () => {
    await call("DELETE");
    setView(null);
    setCode("");
  };

  const s = view?.state;
  return (
    <div className="acct-login">
      {(!view || s === "failed") && (
        <>
          <button type="button" className="config-btn is-primary" disabled={busy} onClick={start}>
            {busy ? "시작하는 중…" : s === "failed" ? "다시 LOGIN" : "LOGIN"}
          </button>
          {s === "failed" && view?.error && <span className="settings-hint acct-err"> {view.error}</span>}
        </>
      )}
      {s === "starting" && <span className="settings-hint">시작하는 중…</span>}
      {s === "waiting-code" && view?.url && (
        <>
          <p className="settings-hint">
            ① <a href={view.url} target="_blank" rel="noreferrer noopener">브라우저에서 {label} 계정으로 로그인 ↗</a> ② 페이지에 나온 코드를 붙여 넣는다(10분 안).
          </p>
          <div className="acct-edit">
            <input className="mono" aria-label={`${label} 로그인 코드`} placeholder="코드" autoComplete="off" spellCheck={false} maxLength={2048} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && code.trim() && void submit()} />
            <button type="button" className="config-btn is-primary" disabled={busy || !code.trim()} onClick={submit}>
              {busy ? "확인하는 중…" : "확인"}
            </button>
            <button type="button" className="config-btn" disabled={busy} onClick={cancel}>
              취소
            </button>
          </div>
        </>
      )}
      {s === "verifying" && <span className="settings-hint">확인하는 중…</span>}
      {s === "done" && view && <span className="settings-hint">{loginNote(view)}</span>}
      {error && <span className="settings-hint acct-err"> {error}</span>}
    </div>
  );
}

const loginNote = (v: LoginView) =>
  `로그인됨${v.onboarding === "marked" ? " · 첫 화면과 AIRPORT 신뢰 표시함" : v.onboarding === "failed" || v.onboarding === "kept" ? " · 첫 화면 표시를 못 함 — 그 폴더로 claude를 한 번 연다" : ""}.`;

// LAUNCH ACCOUNT(ATC-239, docs/accounts.md): 이름을 대지 않은 다음 LAUNCH(AIRCRAFT, 관제 세션)가 쓸 ACCOUNT를 종류마다 하나 고른다.
// 각 AIRCRAFT의 home(프로필 account)은 그대로고 "각 home"으로 되돌리면 전과 같다. 돌고 있는 세션은 옮기지 않는다(그것은 ACCOUNT CHANGE).
// 거절 사유가 있는 ACCOUNT(로그인 안 됨, FUEL hold, 상한)는 고를 수 없고 사유를 보인다. 저장은 SUPERVISOR만: JSON Content-Type을 꼭 보낸다(서버가 이 화면 Origin과 JSON을 본다).
interface LaunchAccountsView {
  launchAccount: { aircraft: string | null; control: string | null };
  launchAccountWarnings: string[];
  accounts: { label: string; refused: string | null }[];
}
function LaunchAccountRow({ registryKey }: { registryKey: string }) {
  const [view, setView] = useState<LaunchAccountsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"aircraft" | "control" | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/fleet/launch-accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: LaunchAccountsView) => alive && setView(d))
      .catch(() => alive && setError("LAUNCH ACCOUNT를 읽지 못함"));
    return () => {
      alive = false;
    };
  }, [registryKey]);
  const change = async (kind: "aircraft" | "control", value: string) => {
    setSaving(kind);
    setError(null);
    try {
      const res = await fetch("/api/fleet/launch-account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [kind]: value || null }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setView((v) => (v ? { ...v, launchAccount: body.launchAccount, launchAccountWarnings: [] } : v));
      else setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
    } catch {
      setError("서버에 연결할 수 없음");
    } finally {
      setSaving(null);
    }
  };
  if (!view || view.accounts.length === 0) return null;
  const select = (kind: "aircraft" | "control", label: string) => (
    <label className="acct-launch-row">
      <span>{label}</span>
      <select className="mono" aria-label={`LAUNCH ACCOUNT — ${label}`} value={view.launchAccount[kind] ?? ""} disabled={saving !== null} onChange={(e) => void change(kind, e.target.value)}>
        <option value="">각 home (프로필)</option>
        {view.accounts.map((x) => (
          <option key={x.label} value={x.label} disabled={x.refused !== null && x.label !== view.launchAccount[kind]}>
            {x.label}
            {x.refused ? ` — ${x.refused}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <h4 className="label acct-registry">
        LAUNCH ACCOUNT <em>이름을 대지 않은 다음 LAUNCH가 쓴다 · 돌고 있는 세션은 옮기지 않는다 · 각 AIRCRAFT의 home은 그대로</em>
      </h4>
      {select("aircraft", "AIRCRAFT")}
      {select("control", "관제 세션")}
      <ApplyNow refreshKey={view.launchAccount} />
      <p className="settings-hint">
        다음 LAUNCH에만 적용된다. 지금 돌고 있는 세션까지 옮기려면 APPLY NOW(확인 창에서 STOP → LAUNCH, 캐시는 식는다). FLEET의 LAUNCH 칸에서 ACCOUNT를 직접 고르거나, ACCOUNT CHANGE를 승인하거나, 한도 뒤 RESUME은 이 설정보다 먼저 쓴다. AIRCRAFT를 켜 두면 FLEET PLAN의 ACCOUNT CHANGE는 프로필 home 대신 이 ACCOUNT를 기준으로 제안하고, 새 AIRCRAFT(ENTRY)도 여기서 난다.
      </p>
      {view.launchAccountWarnings.map((w) => (
        <p key={w} className="settings-hint acct-err">
          ⚠ {w}
        </p>
      ))}
      {error && <p className="settings-hint acct-err">{error}</p>}
    </>
  );
}
