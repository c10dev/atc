import { useEffect, useState } from "react";
import { CONTROL_ROLES, perWorking, sharePct } from "../../../server/control-share.ts";
import type { ControlView } from "../../../server/control-share-run.ts";
import { apiGet } from "../api.ts";
import { Empty } from "../kit/Empty.tsx";
import { Loading } from "../kit/Loading.tsx";
import { TableScroll } from "../kit/TableScroll.tsx";

// METRICS → CONTROL(ATC-551, docs/control-plane.md W8): 날마다·역할마다 관제 세션이 전체 토큰에서 차지하는 몫과, 일을 한 관제 turn(도구 호출 3번 이상) 하나의 토큰. 읽기만 한다.
// 같은 두 숫자를 작업 지시서 `## Measure`의 `control:<이름>`으로 잴 수 있다(docs/control-plane.md "W8 as built").
const DAYS = 14;
const COLS = ["all", ...CONTROL_ROLES] as const;
const label = (c: string) => c.toUpperCase();
const pct = (x: number | null) => (x === null ? "—" : `${x}%`);
const tok = (x: number | null) => (x === null ? "—" : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}K` : String(x));

export function MetricsControl({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<ControlView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet(`/api/control-share?days=${DAYS}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ControlView) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const rows = data ? [...data.rows].reverse() : [];
  const cellOf = (r: ControlView["rows"][number], c: string) => {
    const x = c === "all" ? Object.values(r.roles).reduce((a, k) => ({ tokens: a.tokens + k.tokens, working: a.working + k.working, turns: a.turns + k.turns }), { tokens: 0, working: 0, turns: 0 }) : (r.roles[c] ?? { tokens: 0, working: 0, turns: 0 });
    return { share: sharePct(x.tokens, r.all), per: perWorking(x.tokens, x.working), working: x.working, turns: x.turns };
  };

  return (
    <section aria-label="CONTROL">
      <div className="toolbar">
        <span className="muted">관제 세션의 토큰 몫과 일을 한 turn당 토큰 · 지난 {DAYS}일(UTC 하루 단위){data ? ` · ${data.at.slice(0, 16).replace("T", " ")}Z 읽음` : ""}</span>
      </div>
      {error && (
        <p className="mx-error" role="alert">
          CONTROL을 불러오지 못함: {error}
        </p>
      )}
      {!data ? (
        !error && <Loading>불러오는 중…</Loading>
      ) : rows.length === 0 ? (
        <Empty>지난 {DAYS}일 동안 읽을 대화 기록이 없음.</Empty>
      ) : (
        <>
          <h2 className="label">
            CONTROL SHARE <em>관제 토큰 ÷ 모든 토큰</em>
          </h2>
          <Table title="날짜별 CONTROL SHARE 표" cols={COLS} total={(c) => pct(data.total[c]?.share ?? null)} rows={rows} cell={(r, c) => pct(cellOf(r, c).share)} />
          <h2 className="label">
            TOKENS PER WORKING TURN <em>그날 그 역할의 토큰 ÷ 도구 호출 3번 이상인 turn 수</em>
          </h2>
          <Table title="날짜별 TOKENS PER WORKING TURN 표" cols={COLS} total={(c) => tok(data.total[c]?.perWorking ?? null)} rows={rows} cell={(r, c) => tok(cellOf(r, c).per)} />
          <h2 className="label">
            읽는 곳 <em>새로 나가는 데이터는 없다</em>
          </h2>
          <ul className="muted">
            <li>토큰: FUEL이 읽는 대화 기록의 사용량(CREW 포함). 관제 세션은 관제 폴더(controller·mcc·occ·crosscheck·review)에서 연 세션이다.</li>
            <li>turn: 사용자 차례 하나(사람·다른 세션의 메시지)와 다음 차례 전까지. 일을 한 turn은 도구 호출 3번 이상(docs/squelch.md의 opens 표와 같은 문턱). 일을 한 turn이 없으면 —.</li>
            <li>Measure 이름: <span className="mono">control:share</span>, <span className="mono">control:tokens-per-turn</span>, 역할마다 <span className="mono">share-&lt;role&gt;</span>·<span className="mono">tokens-per-turn-&lt;role&gt;</span>.</li>
          </ul>
        </>
      )}
    </section>
  );
}

function Table({ title, cols, rows, cell, total }: { title: string; cols: readonly string[]; rows: ControlView["rows"]; cell: (r: ControlView["rows"][number], c: string) => string; total: (c: string) => string }) {
  return (
    <TableScroll label={title}>
      <table className="kit-table" aria-label={title}>
        <thead>
          <tr>
            <th scope="col">DAY</th>
            {cols.map((c) => (
              <th key={c} scope="col" className="num">
                {c === "all" ? "ALL CONTROL" : label(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{rows.length}일</th>
            {cols.map((c) => (
              <td key={c} className="num">
                <b>{total(c)}</b>
              </td>
            ))}
          </tr>
          {rows.map((r) => (
            <tr key={r.day}>
              <td className="mono">{r.day}</td>
              {cols.map((c) => (
                <td key={c} className="num">
                  {cell(r, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
