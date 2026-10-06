import { useCallback, useEffect, useState } from "react";
import type { ChangeLine, Field } from "../../server/squelch-switch.ts";
import { apiGet, apiSend } from "./api.ts";
import { timeAgo } from "./derive.ts";

// SQUELCH 스위치(ATC-552, docs/squelch.md "Switch as built"): 설정 창 CONTROL 블록. 관제 세션 역할마다 mode·heartbeatMin·fingerprint를 고친다.
// 서버가 SUPERVISOR 화면(Origin)에서 온 요청만 받는다. 지금 값과 마지막 바뀜을 보이고, 끄기 단추는 모든 역할을 shadow·v1로 한 번에 돌린다.

type RoleView = { mode: string; modeOwn: boolean; heartbeatMin: number; fingerprint: string; last: Partial<Record<Field, ChangeLine>> };
interface SwitchData {
  globalMode: string;
  roles: Record<string, RoleView>;
  changes7d: number;
  recent: ChangeLine[];
}
const MODES = ["off", "shadow", "on"];
const FINGERPRINTS = ["v1", "v2"];
const lastOf = (r: RoleView): ChangeLine | null => Object.values(r.last).reduce<ChangeLine | null>((a, l) => (l && (!a || Date.parse(l.t) > Date.parse(a.t)) ? l : a), null);

export function SquelchSwitch() {
  const [d, setD] = useState<SwitchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet("/api/squelch-switch");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setD((await r.json()) as SwitchData);
    } catch (e) {
      setError(`SQUELCH를 읽지 못함(/api/squelch-switch) — ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const send = async (method: "PUT" | "POST", path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend(method, path, body);
      const j = (await r.json().catch(() => ({}))) as SwitchData & { error?: string };
      if (!r.ok) setError(j.error ?? `HTTP ${r.status}`);
      else setD(j);
    } catch {
      setError("서버에 연결할 수 없음");
    } finally {
      setBusy(false);
    }
  };
  const set = (role: string, patch: Record<string, unknown>) => send("PUT", `/api/squelch-switch/${role}`, patch);

  if (!d) return error ? <p className="conn-error">{error}</p> : <p className="settings-hint">SQUELCH 읽는 중…</p>;
  const anyLive = Object.values(d.roles).some((r) => r.mode !== "shadow" || r.fingerprint !== "v1");
  return (
    <div className="squelch-switch" data-code="SQUELCH">
      <p className="settings-hint">
        SQUELCH(관제 세션 tick 앞의 걸러내기): 역할마다 mode·heartbeatMin·fingerprint. 틀린 값이 저장돼 있으면 shadow·50분·v1로 읽어 tick은 늘 돈다. 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈. 이번 주 바뀐 횟수 <b>{d.changes7d}</b>
      </p>
      <ul className="dp-misfire">
        {Object.entries(d.roles).map(([role, r]) => {
          const last = lastOf(r);
          return (
            <li key={role} data-role={role}>
              <b>{role}</b>{" "}
              <select className="mono" aria-label={`SQUELCH mode — ${role}`} value={r.mode} disabled={busy} onChange={(e) => void set(role, { mode: e.target.value })}>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {!r.modeOwn && <span className="faint"> (전체 {d.globalMode})</span>}{" "}
              <input
                type="number"
                min={1}
                max={720}
                step={1}
                aria-label={`SQUELCH heartbeatMin — ${role}`}
                key={`${role}-${r.heartbeatMin}`}
                defaultValue={r.heartbeatMin}
                disabled={busy}
                style={{ width: "5em" }}
                onBlur={(e) => Number(e.target.value) !== r.heartbeatMin && void set(role, { heartbeatMin: Number(e.target.value) })}
              />
              분{" "}
              <select className="mono" aria-label={`SQUELCH fingerprint — ${role}`} value={r.fingerprint} disabled={busy} onChange={(e) => void set(role, { fingerprint: e.target.value })}>
                {FINGERPRINTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <span className="faint"> · 마지막 바뀜 {last ? `${timeAgo(last.t, Date.now())} · ${last.field} ${last.from} → ${last.to}` : "—"}</span>
            </li>
          );
        })}
      </ul>
      <p className="settings-hint">
        <button type="button" className="btn" disabled={busy || !anyLive} onClick={() => void send("POST", "/api/squelch-switch/off")}>
          끄기 — 모두 shadow·v1로
        </button>
      </p>
      {error && <p className="is-warn">{error}</p>}
    </div>
  );
}
