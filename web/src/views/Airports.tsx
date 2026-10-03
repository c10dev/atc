import { type FormEvent, useCallback, useEffect, useState } from "react";
import { awayOperations } from "../../../server/away.ts";
import type { AirportStatus, Snapshot } from "../../../server/model.ts";
import { callsign } from "../aviation.ts";
import "./Airports.css";
import { apiSend, type ApiMethod } from "../api.ts";

const statusLabel = { open: "OPEN", closed: "CLOSED", missing: "MISSING" } as const;
const MAX_AC = 4;

async function api(method: string, path: string, body?: unknown) {
  const res = await apiSend(method as ApiMethod, path, body || undefined);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// AIRPORT(저장소) 등록부. ~/projects 아래는 자동 개설, 그 밖은 여기서 개설한다.
export function Airports({ snapshot }: { snapshot: Snapshot }) {
  const [airports, setAirports] = useState<AirportStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState<{ id: string; code: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setAirports((await api("GET", "/api/airports")).airports);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // 스냅샷의 AIRPORT 구성이 바뀌면(자동 개설·이동) 목록도 다시 읽는다.
  const openKey = snapshot.airports.map((a) => `${a.id}:${a.code}:${a.repo}`).join("|");
  useEffect(() => {
    load();
  }, [load, openKey]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act(() => api("POST", "/api/airports", { path: path.trim(), code: code.trim() || undefined }));
    if (ok) setPath(""), setCode("");
  };

  const saveCode = async () => {
    if (!editing) return;
    const ok = await act(() => api("PATCH", `/api/airports/${encodeURIComponent(editing.id)}`, { code: editing.code }));
    if (ok) setEditing(null);
  };

  const stands = (repo: string) => snapshot.workspaces.filter((w) => w.repo === repo && !w.isMain).length;
  const aircraft = (repo: string) => snapshot.sessions.filter((s) => s.repo === repo && s.status !== "dead");
  const away = awayOperations(snapshot);
  const codeOf = (repo: string) => airports?.find((a) => a.repo === repo)?.code ?? repo.split("/").pop();
  // 다른 AIRPORT 소속인데 이 AIRPORT의 STAND에서 작업 중인 AIRCRAFT
  const visitors = (repo: string) =>
    snapshot.sessions.filter((s) => s.status !== "dead" && (away.get(s.id) ?? []).includes(repo));

  return (
    <section className="airports">
      <div className="toolbar">
        <span className="muted">
          ~/projects 아래 저장소는 자동으로 개설된다. AIRPORT는 첫 커밋으로 알아보므로 폴더를 옮기거나 이름을 바꿔도 같은
          AIRPORT 코드로 이어진다.
        </span>
      </div>

      <form className="apt-form" onSubmit={submit}>
        <h2 className="label">OPEN AIRPORT</h2>
        <input
          className="apt-input apt-path"
          placeholder="/home/c10/어딘가/저장소 (워크트리나 하위 폴더도 됨)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          aria-label="저장소 경로"
          required
        />
        <input
          className="apt-input apt-code-input"
          placeholder="코드"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
          aria-label="AIRPORT 코드 (비우면 자동)"
        />
        <button className="btn is-primary" type="submit">
          OPEN
        </button>
      </form>

      {error && (
        <p className="apt-error" role="alert">
          {error}
        </p>
      )}

      <h2 className="label">
        AIRPORTS <em>{airports?.length ?? "…"}</em>
      </h2>
      <table className="apt-table">
        <thead>
          <tr>
            <th>코드</th>
            <th>이름</th>
            <th>경로</th>
            <th>상태</th>
            <th title="ON이면 팀이 머지하고(TOWER가 LAND를 낸다), OFF면 SUPERVISOR만 머지한다">팀 머지</th>
            <th className="num">STAND</th>
            <th>AIRCRAFT</th>
            <th aria-label="동작" />
          </tr>
        </thead>
        <tbody>
          {airports?.map((a) => {
            const ac = a.status === "open" ? aircraft(a.repo) : [];
            const visiting = a.status === "open" ? visitors(a.repo) : [];
            const label = (id: string, name: string) => {
              const out = away.get(id);
              return out?.length ? `${name} → ${out.map(codeOf).join(",")}` : name;
            };
            return (
              <tr key={a.id} className={`is-${a.status}`}>
                <td>
                  {editing?.id === a.id ? (
                    <span className="apt-edit">
                      <input
                        className="apt-input apt-code-input"
                        value={editing.code}
                        autoFocus
                        aria-label={`${a.name} 새 코드`}
                        onChange={(e) =>
                          setEditing({ id: a.id, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveCode();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                      <button className="btn" onClick={saveCode}>
                        저장
                      </button>
                    </span>
                  ) : (
                    <button
                      className="apt-code"
                      title="코드 바꾸기"
                      onClick={() => setEditing({ id: a.id, code: a.code })}
                    >
                      {a.code}
                    </button>
                  )}
                </td>
                <td>{a.name}</td>
                <td className="mono apt-path-cell" title={a.id}>
                  {a.repo}
                  {!a.discovered && a.status !== "missing" && <span className="apt-tag">수동</span>}
                </td>
                <td>
                  <span className={`apt-status s-${a.status}`}>{statusLabel[a.status]}</span>
                </td>
                <td>
                  <button
                    className="btn"
                    aria-pressed={a.teamsMerge !== false}
                    title="누르면 팀 머지와 SUPERVISOR만 머지를 바꾼다"
                    onClick={() => act(() => api("PATCH", `/api/airports/${encodeURIComponent(a.id)}`, { teamsMerge: a.teamsMerge === false }))}
                  >
                    {a.teamsMerge !== false ? "ON" : "OFF"}
                  </button>
                </td>
                <td className="num mono">{a.status === "open" ? stands(a.repo) : "—"}</td>
                <td className="apt-ac" title={ac.map((s) => label(s.id, callsign(s))).join(", ")}>
                  {ac.length ? (
                    <>
                      {ac.slice(0, MAX_AC).map((s) => label(s.id, callsign(s))).join(", ")}
                      {ac.length > MAX_AC && <span className="faint"> 외 {ac.length - MAX_AC}</span>}
                    </>
                  ) : (
                    !visiting.length && <span className="faint">—</span>
                  )}
                  {visiting.length > 0 && (
                    <div className="apt-visiting" title="다른 AIRPORT 소속, 이 AIRPORT의 STAND에서 작업 중">
                      TRANSIENT {visiting.map((s) => `${callsign(s)}(${s.repo ? codeOf(s.repo) : "?"})`).join(", ")}
                    </div>
                  )}
                </td>
                <td>
                  <div className="apt-actions">
                  {a.status === "closed" ? (
                    <button className="btn" onClick={() => act(() => api("PATCH", `/api/airports/${encodeURIComponent(a.id)}`, { closed: false }))}>
                      REOPEN
                    </button>
                  ) : (
                    <button
                      className="btn"
                      onClick={() => act(() => api("PATCH", `/api/airports/${encodeURIComponent(a.id)}`, { closed: true }))}
                    >
                      CLOSE
                    </button>
                  )}
                  {!a.discovered && (
                    <button
                      className="btn is-danger"
                      onClick={() => {
                        if (confirm(`${a.code} ${a.name} AIRPORT를 등록부에서 지울까요? 저장소 폴더는 그대로 둡니다.`))
                          act(() => api("DELETE", `/api/airports/${encodeURIComponent(a.id)}`));
                      }}
                    >
                      삭제
                    </button>
                  )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
