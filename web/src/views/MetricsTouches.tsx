import { useEffect, useState } from "react";
import type { Category, TouchesView } from "../../../server/touches.ts";
import { apiGet } from "../api.ts";
import { Empty } from "../kit/Empty.tsx";
import { Loading } from "../kit/Loading.tsx";
import { TableScroll } from "../kit/TableScroll.tsx";
import "./MetricsTouches.css";

// METRICS → TOUCHES(ATC-512, docs/autonomy.md 원칙 1): UTC 하루마다 머지된 PR 하나당 SUPERVISOR가 손댄 횟수. 읽기만 한다.
// 어느 범주가 gate인지는 서버(touches.ts)가 autonomy.md에서 옮겨 보낸다. 기록이 없는 범주는 0이 아니라 "not recorded".
const DAYS = 14;
const num = (x: number | null) => (x === null ? "—" : String(x));

export function MetricsTouches({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<TouchesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet(`/api/touches?days=${DAYS}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: TouchesView) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const gates = data?.categories.filter((c) => c.side === "gate") ?? [];
  const leaks = data?.categories.filter((c) => c.side === "leak") ?? [];
  const hasAny = data?.rows.some((r) => r.landed > 0 || r.touches > 0) ?? false;
  const cell = (r: TouchesView["rows"][number], id: Category) => num(r.counts[id]);

  return (
    <section aria-label="TOUCHES">
      <div className="toolbar">
        <span className="muted">머지된 PR 하나당 SUPERVISOR가 손댄 횟수 · 지난 {DAYS}일(UTC 하루 단위)</span>
      </div>
      {error && (
        <p className="mx-error" role="alert">
          TOUCHES를 불러오지 못함: {error}
        </p>
      )}
      {!data ? (
        !error && <Loading>불러오는 중…</Loading>
      ) : (
        <>
          <p className="muted">
            gate: {gates.map((c) => c.label).join(", ")} — 세 gate K1–K3는 릴리스 때 선언해 한 번 승인한다(docs/autonomy.md 2절). 그 밖은 leak: {leaks.map((c) => c.label).join(", ")}.
          </p>
          {!hasAny ? (
            <Empty>지난 {DAYS}일 동안 기록된 착륙도 손길도 없음.</Empty>
          ) : (
            <TableScroll label="날짜별 TOUCHES 표">
              <table className="kit-table" aria-label="날짜별 TOUCHES">
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2}>DAY</th>
                    <th scope="col" rowSpan={2} className="num">LANDED</th>
                    <th scope="colgroup" colSpan={gates.length} className="mt-group">GATE</th>
                    <th scope="colgroup" colSpan={leaks.length} className="mt-group mt-split">LEAKS</th>
                    <th scope="col" rowSpan={2} className="num mt-split">TOUCHES</th>
                    <th scope="col" rowSpan={2} className="num">PER PR</th>
                    <th scope="col" rowSpan={2} className="num">LEAKS PER PR</th>
                  </tr>
                  <tr>
                    {[...gates, ...leaks].map((c) => (
                      <th key={c.id} scope="col" className={c.id === leaks[0]?.id ? "num mt-split" : "num"}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.day}>
                      <td className="mono">{r.day}</td>
                      <td className="num">{r.landed}</td>
                      {[...gates, ...leaks].map((c) => (
                        <td key={c.id} className={c.id === leaks[0]?.id ? "num mt-split" : "num"}>
                          {c.source ? cell(r, c.id) : <span className="faint">not recorded</span>}
                        </td>
                      ))}
                      <td className="num mt-split">{r.touches}</td>
                      <td className="num">{num(r.perPr)}</td>
                      <td className="num">{num(r.leaksPerPr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          <h2 className="label">
            읽는 곳 <em>범주마다</em>
          </h2>
          <ul className="muted">
            {data.categories.map((c) => (
              <li key={c.id}>
                <span className="mono">{c.label}</span> ({c.side}) — {c.source ? <span className="mono">{c.source}</span> : "not recorded"}
                {c.note ? ` · ${c.note}` : ""}
              </li>
            ))}
            <li>
              <span className="mono">LANDED</span> — <span className="mono">mcc.jsonl</span> land ok와 <span className="mono">autoland.jsonl</span> merge ok. GitHub에서 직접 한 머지는 세지 않는다.
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
