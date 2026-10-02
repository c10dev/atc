import { useCallback, useEffect, useState } from "react";
import { OpenFlight } from "../FlightLink.tsx";
import { apiGet, apiSend } from "../api.ts";
import { PriorityMark } from "../ui.tsx";
import "./Release.css";

// 발권(RELEASE) 기록(ATC-362, docs/autonomy.md 원칙 1·10). Todo FLIGHT는 SUPERVISOR가 발권해야 DISPATCH가 배정한다.
// 이 화면의 클릭만 screen 발권을 만든다(서버가 Origin을 검사한다). 이미 Todo에 있던 FLIGHT는 한 번의 확인으로 일괄 발권한다.

interface Row {
  key: string;
  title: string;
  hash: string | null;
  priority: number;
  state: "unreleased" | "stale";
}
interface Released {
  key: string;
  channel: "screen" | "duty-chat" | "attested";
  at: string;
  session?: string;
}
interface ReleaseData {
  gate: { mode: "auto" | "on" | "off"; on: boolean; armedAt: string | null };
  unreleased: Row[];
  released: Released[];
  attested: Record<string, number>;
}


async function send(path: string, body: unknown) {
  const res = await apiSend("POST", path, body);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function ReleasePanel({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<ReleaseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet("/api/releases");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setData(null); // 서버에 발권 기록이 없으면(옛 서버) 아무것도 그리지 않는다
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!data) return null;
  const rows = data.unreleased;
  const attested = Object.entries(data.attested);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setConfirm(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const releaseOne = (r: Row) => run(() => send("/api/releases", { flight: r.key, hash: r.hash }));
  const releaseAll = () => run(() => send("/api/releases/bulk", { flights: rows.map((r) => ({ key: r.key, hash: r.hash })) }));

  // gate가 아직 꺼져 있으면(일괄 확인 전) 안내만: 지금은 발권 없이도 배정한다
  const gateNote = data.gate.on
    ? "발권한 FLIGHT만 배정합니다"
    : data.gate.mode === "off"
      ? "발권 gate 꺼짐(dispatch.json releaseGate) — 발권 없이도 배정합니다"
      : "일괄 확인을 하면 이때부터 발권한 FLIGHT만 배정합니다. 그 전까지는 발권 없이도 배정합니다";

  return (
    <section className="rl" aria-label="RELEASE">
      <h2 className="label">
        RELEASE <em>{gateNote}</em>
      </h2>
      {error && <p className="rl-error">{error}</p>}
      {rows.length === 0 ? (
        <p className="faint rl-none">발권을 기다리는 Todo FLIGHT 없음 · 발권됨 {data.released.length}</p>
      ) : (
        <>
          <div className="rl-bar">
            <span>
              발권 없는 Todo FLIGHT <b>{rows.length}</b>
              {data.released.length > 0 && <span className="faint"> · 발권됨 {data.released.length}</span>}
            </span>
            {confirm ? (
              <span className="rl-confirm">
                <span>
                  위 {rows.length}개의 목표·완료 기준·K 효과를 승인하고 DISPATCH가 배정하게 합니다. 이 승인은 한 번이고 이후 사람 단계는 없습니다.
                </span>
                <button type="button" className="dp-btn" disabled={busy} onClick={releaseAll}>
                  {data.gate.on ? `${rows.length}개 발권` : `${rows.length}개 발권하고 gate 켜기`}
                </button>
                <button type="button" className="dp-btn back" disabled={busy} onClick={() => setConfirm(false)}>
                  취소
                </button>
              </span>
            ) : (
              <button type="button" className="dp-btn" disabled={busy} onClick={() => setConfirm(true)}>
                모두 발권…
              </button>
            )}
          </div>
          <ul className="rl-list">
            {rows.map((r) => (
              <li key={r.key}>
                <b>
                  <OpenFlight k={r.key} />
                </b>
                <PriorityMark priority={r.priority} />
                <span className="rl-title">{r.title}</span>
                <span className="faint">{r.state === "stale" ? "발권 뒤 내용이 바뀜" : "제안"}</span>
                <button type="button" className="dp-btn" disabled={busy} onClick={() => releaseOne(r)}>
                  발권
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {attested.length > 0 && (
        <p className="faint rl-attested" title="다른 세션이 SUPERVISOR의 말을 증언한 발권. 서버는 그 말을 확인할 수 없어 표본으로 확인한다">
          attested 발권(세션별): {attested.map(([s, n]) => `${s} ${n}`).join(" · ")}
        </p>
      )}
    </section>
  );
}

