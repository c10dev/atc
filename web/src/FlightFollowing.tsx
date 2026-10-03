import { useEffect, useState } from "react";
import type { PullRequest } from "../../server/model.ts";
import type { FollowBundle, FollowRow } from "../../server/follow.ts";
import { clock, followRowOf, STAGE_LABEL, stagesShown } from "../../server/follow-view.ts";
import { apiGet } from "./api.ts";
import { BlockList, LandingBadge } from "./views/Teams.tsx";
import "./FlightFollowing.css";

// FLIGHT 서랍의 따라가기 절(ATC-492, docs/flights-list.md 3.3): FLIGHTS 목록 줄이 보이던 설명과 길을 서랍이 넘겨받는다.
// 번들에 따라가는 FLIGHT에만 그린다(아니면 아무것도 그리지 않는다). 상태 버튼(Todo로)은 서랍의 "상태 이동", CANCEL·RECALL은 "배정 기록"이 이미 갖고 있어 겹쳐 그리지 않는다.
// 단계·글은 서버가 센 GET /api/follow의 줄 그대로다.

export function FlightFollowing({ k, pulls, refreshKey }: { k: string; pulls: PullRequest[]; refreshKey: string }) {
  const [row, setRow] = useState<FollowRow | null>(null);
  useEffect(() => {
    let live = true;
    apiGet("/api/follow")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { bundles?: FollowBundle[] } | null) => {
        if (live) setRow(followRowOf(d?.bundles, k));
      })
      .catch(() => live && setRow(null));
    return () => {
      live = false;
    };
  }, [k, refreshKey]);
  if (!row) return null;
  const pull = pulls.find((p) => p.ticketKey === k && !p.draft);
  const look = row.next?.kind === "look" ? row.next : null;
  const times = stagesShown(row);
  return (
    <>
      <h3 className="dr-h">따라가는 상태</h3>
      <div className="ff">
        <p className="ff-now">
          <span className={row.stuck ? "ff-stuck" : undefined}>{row.now}</span>
          {look && (
            <a className="dr-btn" href={look.href ?? undefined}>
              {look.label}
            </a>
          )}
        </p>
        {row.stuck && (
          <p className="ff-issue is-warn">
            <span className="tag" data-tone="amber">막힘</span> {row.stuck.text}
          </p>
        )}
        {row.issues.map((i) => (
          <p key={i.code} className={`ff-issue is-${i.severity}`}>
            <span className="tag" data-tone={i.severity === "warn" ? "amber" : "cyan"}>{i.code}</span> {i.text}
          </p>
        ))}
        {pull && (
          <p className="ff-pull">
            <LandingBadge pr={pull} />
            <BlockList pr={pull} />
          </p>
        )}
        <ol className="ff-times">
          {times.map((s) => {
            const c = row.stages[s];
            return (
              <li key={s} className={c.done ? "is-done" : s === row.current ? "is-now" : ""}>
                <span>{STAGE_LABEL[s]}</span>
                <span className="mono faint">{c.at ? clock(c.at) : c.done ? "✓" : "—"}</span>
              </li>
            );
          })}
        </ol>
        {row.history.length > 0 && (
          <details className="ff-hist">
            <summary>기록 {row.history.length}</summary>
            <ol>
              {row.history.map((h, i) => (
                <li key={i}>
                  <span className="mono faint">{clock(h.at)}</span> {h.text}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </>
  );
}
