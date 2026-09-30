import { useEffect, useState } from "react";
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
    </Block>
  );
}
