import { useEffect, useState } from "react";
import type { AddPreview, AddResult } from "../../server/account-add.ts";
import type { FolderHealth } from "../../server/account-health.ts";
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
  const load = (d: AccountsState) => {
    setData(d);
    setRows(Object.entries(d.registry).map(([label, e]) => ({ label, configDir: e.configDir, maxLaunched: e.maxLaunched ? String(e.maxLaunched) : "" })));
  };
  useEffect(() => {
    let alive = true;
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
          </span>{" "}
          <StatusChip tone={f.loggedIn === true ? "ok" : f.loggedIn === false ? "bad" : "mute"}>
            {f.loggedIn === true ? `LOGGED IN${f.authMethod ? ` · ${f.authMethod}` : ""}` : f.loggedIn === false ? "NOT LOGGED IN" : "LOGIN ?"}
          </StatusChip>{" "}
          <StatusChip tone={f.statusline ? "ok" : "mute"}>{f.statusline ? "STATUSLINE ✓" : "STATUSLINE 없음"}</StatusChip>{" "}
          <StatusChip tone={f.healthHook ? "ok" : "mute"}>{f.healthHook ? "HEALTH HOOK ✓" : "HEALTH HOOK 없음"}</StatusChip>{" "}
          <StatusChip tone={f.claimHook ? "ok" : "mute"}>{f.claimHook ? "CLAIM HOOK ✓" : "CLAIM HOOK 없음"}</StatusChip>
          {f.warnings.length > 0 && (
            <ul className="settings-hint acct-warn">
              {f.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {rows.map((r, i) => (
        <div key={i} className="acct-edit">
          <input className="mono" aria-label="ACCOUNT 라벨" placeholder="acct-1" maxLength={24} value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
          <input className="mono" aria-label="설정 폴더" placeholder="/home/…/.claude-acct-1" maxLength={400} value={r.configDir} onChange={(e) => set(i, { configDir: e.target.value })} />
          <input className="mono acct-cap" aria-label="ACCOUNT별 세션 상한" title="이 ACCOUNT의 백그라운드 세션 상한(비우면 기계 전체 상한만)" placeholder="상한" inputMode="numeric" maxLength={3} value={r.maxLaunched} onChange={(e) => set(i, { maxLaunched: e.target.value.replace(/\D/g, "") })} />
          <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            삭제
          </button>
        </div>
      ))}
      <div className="acct-actions">
        <button type="button" onClick={() => setRows([...rows, { label: "", configDir: "", maxLaunched: "" }])}>
          + ACCOUNT
        </button>{" "}
        <button type="button" disabled={!dirty || saving} onClick={save}>
          저장
        </button>
        {error && <span className="settings-hint acct-err"> {error}</span>}
      </div>
      <AddAccount dirty={dirty} onAdded={load} />
    </Block>
  );
}

// ADD ACCOUNT(ATC-186, docs/accounts.md 4절): 폴더 만들기 → ~/.claude/settings.json 복사 → 등록을 한 번에. 로그인과 온보딩은 터미널에 남는다.
// env는 키 이름만 받는다(값은 서버 밖으로 나오지 않는다). 체크를 풀면 그 키는 새 폴더에 옮기지 않는다
function AddAccount({ dirty, onAdded }: { dirty: boolean; onAdded: (d: AccountsState) => void }) {
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
        <button type="button" onClick={start}>
          ADD ACCOUNT
        </button>{" "}
        <span className="settings-hint">폴더를 만들고 settings.json을 복사하고 등록한다. 로그인은 그다음 터미널에서.</span>
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
        <button type="button" disabled={!p || busy || !label.trim() || dirty} title={dirty ? "위 등록 칸의 바뀐 것을 먼저 저장하거나 되돌린다" : undefined} onClick={add}>
          {busy ? "만드는 중…" : "만들고 등록"}
        </button>{" "}
        <button type="button" onClick={() => setOpen(false)}>
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
            , 등록함{done.homeRegistered && <> · <span className="mono">~/.claude</span>는 {done.homeRegistered}</>}.
          </p>
          <p className="settings-hint">남은 것은 터미널에서(atc는 로그인 정보를 다루지 않는다):</p>
          <ol className="settings-hint acct-next">
            <li>
              로그인: <code className="mono">{done.loginCommand}</code>{" "}
              <button type="button" onClick={() => copy(done.loginCommand)}>
                복사
              </button>{" "}
              — 위 폴더 줄이 이미 LOGGED IN이면 건너뛴다. URL은 <kbd>c</kbd>로 복사한다(줄바꿈된 URL은 redirect_uri missing으로 실패).
            </li>
            <li>
              온보딩: <code className="mono">CLAUDE_CONFIG_DIR={done.dir} claude</code>를 한 번 열어 첫 화면과 atc 체크아웃 신뢰를 끝낸다(docs/accounts.md 4절 2).
            </li>
            <li>위 폴더 줄에 LOGGED IN과 STATUSLINE·HOOK ✓가 뜨는지 본다.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
