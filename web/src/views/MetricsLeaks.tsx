import { useEffect, useState } from "react";
import type { LeakKindRow, LeakView } from "../../../server/leaks.ts";
import { apiGet } from "../api.ts";
import "./MetricsLeaks.css";
import { Empty } from "../kit/Empty.tsx";

// LEAKS(ATC-363, docs/autonomy.md): 릴리스 뒤에도 사람이 거친 단계를 kind별로 센 7일 표. 읽기만 한다.
// "통제 있음"은 그 gate 행을 대신할 통제가 이미 도는 것, "통제 없음"은 아직 없어 사람이 붙잡힌 것(그 통제가 서면 사라질 것).

const minText = (m: number) => (m >= 120 ? `${Math.round(m / 60)}시간` : `${m}분`);
const stamp = (iso: string) => `${iso.slice(0, 16).replace("T", " ")}Z`;

export function MetricsLeaks({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<LeakView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet("/api/leaks?days=7")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return (
    <section className="ml" aria-label="LEAKS">
      <div className="toolbar">
        <span className="muted">
          릴리스 뒤 사람이 거친 단계 · 7일{data ? ` · ${stamp(data.at)} 읽음` : ""}
          {data && data.totals.count > 0 ? ` · ${data.totals.count}건 ${minText(data.totals.heldMin)} 붙잡음${data.totals.openNow ? ` · 지금 ${data.totals.openNow}건 열림` : ""}` : ""}
        </span>
      </div>
      {error && (
        <p className="mx-error" role="alert">
          LEAKS를 불러오지 못함: {error}
        </p>
      )}
      {!data ? (
        <Empty>불러오는 중…</Empty>
      ) : data.totals.count === 0 ? (
        <Empty>7일 동안 기록된 leak 없음.</Empty>
      ) : (
        <>
          <Group title="통제 없음" note="이 통제가 서면 사라질 단계" rows={data.missing} />
          <Group title="통제 있음" note="통제가 이미 도는데 사람이 거친 단계" rows={data.exists} />
        </>
      )}
    </section>
  );
}

function Group({ title, note, rows }: { title: string; note: string; rows: LeakKindRow[] }) {
  if (!rows.length) return null;
  return (
    <>
      <h2 className="label">
        {title} <em>{note}</em>
      </h2>
      <ul className="ml-list">
        {rows.map((r) => (
          <li key={`${r.kind}|${r.gate}|${r.control}`} className="ml-row">
            <div className="ml-head">
              <span className="mono ml-kind">{r.kind}</span>
              <span className="mono faint">
                {r.gate} · {r.control}
              </span>
            </div>
            <div className="ml-num mono">
              <b>{r.count}</b>건 · {minText(r.heldMin)}
              {r.openNow ? <span className="faint"> · 열림 {r.openNow}</span> : null}
            </div>
            <div className="ml-work faint">{r.work.join(" · ")}</div>
          </li>
        ))}
      </ul>
    </>
  );
}
