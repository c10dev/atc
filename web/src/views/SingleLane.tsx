import { useEffect, useState } from "react";
import type { laneView } from "../../../server/codex-lane-run.ts";
import { apiGet } from "../api.ts";

// 한 레인으로 착륙(ATC-386): Codex를 쓸 수 없어 REVIEW 한 레인의 리뷰만으로 착륙한 PR의 날짜별 수와 까닭, 지금 Codex가 조용한 저장소.
// 단일 레인 착륙도 없고 조용한 저장소도 없으면 아무것도 그리지 않는다(정상 상태에 줄이 없다). 읽기만 한다.

type LaneView = ReturnType<typeof laneView>;
const CAUSE_LABEL: Record<string, string> = { lane: "저장소 무응답", silent: "PR 무응답", limit: "한도", autoland: "AUTOLAND 재리뷰" };
const repoName = (repo: string) => repo.replace(/\/+$/, "").split("/").pop() ?? repo;

export function SingleLane({ refreshKey }: { refreshKey: string }) {
  const [v, setV] = useState<LaneView | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet("/api/landing/lanes?days=7")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setV(d))
      .catch(() => alive && setV(null));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  if (!v) return null;
  const days = [...v.daily].reverse().filter((d) => d.single > 0);
  if (!days.length && !v.silentRepos.length) return null;
  return (
    <>
      <h2 className="label">
        한 레인 착륙 <em>Codex 없이 REVIEW 한 레인으로만 착륙한 PR(착륙한 날 기준, UTC)</em>
      </h2>
      <ul className="dp-misfire">
        {v.silentRepos.map((r) => (
          <li key={r.repo}>
            <span className="mono">{repoName(r.repo)}</span> Codex 무응답 <span className="faint">{r.since.slice(11, 16)}Z부터 — 기다리는 PR은 곧바로 REVIEW로</span>
          </li>
        ))}
        {days.map((d) => (
          <li key={d.day}>
            <span className="mono">{d.day}</span> 착륙 <b>{d.landed}</b> · 한 레인 <b>{d.single}</b>
            <span className="faint"> — {Object.entries(d.causes).map(([k, n]) => `${CAUSE_LABEL[k] ?? k} ${n}`).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
