import { useState } from "react";
import type { Claim, Clearance, LandingBlockCode, PullRequest, Session, Snapshot } from "../../../server/model.ts";
import {
  type AircraftStatus,
  aircraftStatus,
  aircraftStatusCode,
  aircraftStatusLabel,
  callsign,
  flightNumber,
  flightPhase,
} from "../aviation.ts";
import { activeFirst, hasActiveClaim, type Index, sortSessions, timeAgo } from "../derive.ts";
import { formatClock, useSettings } from "../settings.ts";
import { AirportCode, AwayTag, SessionPlace } from "../ui.tsx";
import "./Teams.css";

const BAYS: AircraftStatus[] = ["airborne", "holding", "nordo", "parked"];
const agentCode = { claude: "CLD", codex: "CDX" } as const;

export function Teams({ snapshot, idx, now }: { snapshot: Snapshot; idx: Index; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const all = sortSessions(snapshot.sessions, idx);
  const visible = showAll ? all : all.filter((s) => s.status === "busy" || idx.claimsBySession.has(s.id));
  const hidden = all.length - visible.length;
  const nameOf = (id: string) => {
    const s = idx.sessionById.get(id);
    return s ? callsign(s) : id.slice(0, 8);
  };

  const bays = new Map<AircraftStatus, Session[]>(BAYS.map((b) => [b, []]));
  for (const s of visible) bays.get(aircraftStatus(s, hasActiveClaim(idx.claimsBySession.get(s.id))))!.push(s);
  // 옛 서버 스냅샷에는 pulls·github가 없다
  const pulls = snapshot.pulls ?? [];
  const github = snapshot.github ?? null;
  const landing = landingIndex(pulls);

  return (
    <section>
      <div className="toolbar">
        <span className="muted">
          AIRCRAFT {visible.length}대{hidden > 0 && !showAll ? ` · PARKED ${hidden}대 숨김` : ""}
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          PARKED AIRCRAFT 포함
        </label>
      </div>
      {github?.error && (
        <p className="ls-stale" title={github.error}>
          GitHub 조회 실패 · PR 상태가 오래됐을 수 있음
        </p>
      )}
      <LandingSequence pulls={pulls} landing={landing} idx={idx} nameOf={nameOf} />
      {BAYS.map((bay) => {
        const sessions = bays.get(bay)!;
        if (!sessions.length) return null;
        return (
          <div key={bay} className={`bay bay-${bay}`}>
            <h2 className="label">
              {aircraftStatusCode[bay]}{" "}
              <em>{sessions.length}</em>
            </h2>
            <div className="bay-rail">
              {sessions.map((s) => (
                <Strip
                  key={s.id}
                  session={s}
                  status={bay}
                  idx={idx}
                  now={now}
                  nameOf={nameOf}
                  landing={landing}
                  clearances={snapshot.clearances.filter((c) => c.to === s.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Strip({
  session: s,
  status,
  idx,
  now,
  nameOf,
  landing,
  clearances,
}: {
  session: Session;
  status: AircraftStatus;
  idx: Index;
  now: number;
  nameOf: (id: string) => string;
  landing: LandingIndex;
  clearances: Clearance[];
}) {
  const { clock } = useSettings();
  const claims = activeFirst(idx.claimsBySession.get(s.id) ?? []);
  const sign = callsign(s);
  const conflicts = (c: Claim) =>
    c.state === "active" && (idx.alertsByWorkspace.get(c.workspacePath) ?? []).some((a) => a.kind === "conflict");
  const los = claims.some(conflicts);

  return (
    <article className={`strip is-${status}${los ? " is-los" : ""}`}>
      <div className="holder" title={aircraftStatusLabel[status]} />
      <div className="strip-id">
        <div className="cs" title={s.name}>
          {sign}
          <span className="type">{agentCode[s.agent]}</span>
          <AwayTag airports={idx.awayBySession.get(s.id)} />
        </div>
        <div className="sub">
          {sign !== s.name && `${s.name} · `}
          <SessionPlace session={s} idx={idx} /> · {timeAgo(s.lastActiveAt, now)}
        </div>
        <ClearanceStamps clearances={clearances} now={now} />
      </div>
      <div className="strip-legs">
        {claims.length ? (
          claims.map((c) => {
            const ws = idx.wsByPath.get(c.workspacePath);
            const ticket = ws?.ticketKey ? idx.ticketByKey.get(ws.ticketKey) : undefined;
            const others = conflicts(c)
              ? (idx.claimsByWorkspace.get(c.workspacePath) ?? [])
                  .filter((o) => o.sessionId !== s.id && o.state === "active")
                  .map((o) => nameOf(o.sessionId))
              : [];
            return (
              <div key={c.workspacePath} className={`leg${c.state === "handed-off" ? " is-handed-off" : ""}`}>
                <div className="cell">
                  <span className="cap">STAND</span>
                  <div className="val" title={ws?.branch ? `${c.workspacePath}\n${ws.branch}` : c.workspacePath}>
                    <AirportCode airport={ws ? idx.airportByRepo.get(ws.repo) : undefined} />{" "}
                    {ws?.name ?? c.workspacePath.split("/").pop()}
                  </div>
                  <div className="sub">{ws?.branch ?? (ws ? `detached ${ws.head}` : "")}</div>
                </div>
                <div className="cell">
                  <span className="cap">FLIGHT</span>
                  {ws?.ticketKey ? (
                    <>
                      <a
                        className="val big"
                        href={ticket?.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        title={ticket ? `${ws.ticketKey} · ${flightPhase(ticket)}` : ws.ticketKey}
                      >
                        {flightNumber(ws.ticketKey)}
                      </a>
                      {ticket && <div className="sub">{flightPhase(ticket)}</div>}
                    </>
                  ) : (
                    <div className="val big none" title="티켓 없는 작업(AD HOC). 브랜치 claude/<slug>">
                      AD HOC
                    </div>
                  )}
                </div>
                <div className="cell cell-route">
                  <span className="cap">ROUTE</span>
                  <div className="route" title={ticket?.title}>
                    {ticket?.title ?? <span className="none">AD HOC — 티켓 없는 작업</span>}
                  </div>
                </div>
                <div className="cell">
                  <span className="cap">LAST CONTACT</span>
                  <div className="val" title={timeAgo(c.lastAt, now)}>
                    {formatClock(c.lastAt, clock)}
                  </div>
                  <div className="sub">{timeAgo(c.lastAt, now)}</div>
                </div>
                <div className="cell cell-remarks">
                  {(landing.byStand.get(c.workspacePath) ?? []).map((pr) => (
                    <PrLanding key={prKey(pr)} pr={pr} landing={landing} />
                  ))}
                  {others.length > 0 && (
                    <span className="stamp red" title={`${others.join(", ")}와 같은 STAND`}>
                      LOS {others.join(", ")}
                    </span>
                  )}
                  {c.state === "handed-off" && (
                    <span className="stamp blue">→ {c.handedOffTo ? nameOf(c.handedOffTo) : "?"} HANDOFF</span>
                  )}
                  {ws && s.repo && ws.repo !== s.repo && c.state === "active" && (
                    <span className="stamp away" title="소속 AIRPORT 밖 STAND">OUTSTATION</span>
                  )}
                  {ws?.dirty ? <span className="stamp amber">Δ {ws.dirty}</span> : null}
                  {c.source === "transcript" && <span className="stamp dashed">ESTIMATED TRACK</span>}
                  {c.source === "cwd" && <span className="stamp dashed">CWD</span>}
                </div>
              </div>
            );
          })
        ) : (
          <div className="leg is-empty">
            <div className="cell">
              <span className="cap">STAND</span>
              <div className="sub">배정된 STAND 없음</div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

interface LandingIndex {
  byStand: Map<string, PullRequest[]>;
  seq: Map<string, number>; // CLEARED PR의 LANDING SEQUENCE 순번(1부터)
}

const prKey = (p: PullRequest) => `${p.repo}#${p.number}`;

// LANDING SEQUENCE: CLEARED를 readyAt 이른 순으로. readyAt이 없으면 뒤로
function landingIndex(pulls: PullRequest[]): LandingIndex {
  const byStand = new Map<string, PullRequest[]>();
  for (const p of pulls) {
    if (!p.standPath) continue;
    const list = byStand.get(p.standPath);
    if (list) list.push(p);
    else byStand.set(p.standPath, [p]);
  }
  const cleared = pulls
    .filter((p) => p.landing === "CLEARED")
    .sort(
      (a, b) =>
        (a.readyAt ?? "\uffff").localeCompare(b.readyAt ?? "\uffff") ||
        a.repo.localeCompare(b.repo) ||
        a.number - b.number,
    );
  return { byStand, seq: new Map(cleared.map((p, i) => [prKey(p), i + 1])) };
}

function blocksTip(pr: PullRequest): string {
  return pr.blocks.map((b) => `· ${b.text}`).join("\n");
}

// CLEARED TO LAND(호박) 또는 APPROACH(시안) + 막는 조건 수
function LandingBadge({ pr }: { pr: PullRequest }) {
  const cleared = pr.landing === "CLEARED";
  const n = pr.blocks.length;
  return (
    <span
      className={`pr-badge ${cleared ? "is-cleared" : "is-approach"}`}
      title={cleared ? "CLEARED TO LAND: 머지할 수 있음" : `APPROACH: 막는 조건 ${n}개\n${blocksTip(pr)}`}
    >
      {cleared ? "CLEARED TO LAND" : "APPROACH"}
      {!cleared && n > 0 && <b className="pr-count">{n}</b>}
    </span>
  );
}

// Codex 한도 때 착륙 리뷰 상태(ATC-7·27). Codex를 쓸 수 있으면 없음
// 리뷰어 이름은 모델 계열 앞머리(서버 reviewerOf와 같다): deepseek-v4.1-flash → DEEPSEEK
const reviewerOf = (family: string) => (family.split(/[-.\s]/)[0] || family).toUpperCase();
function ExtReviewTag({ pr }: { pr: PullRequest }) {
  const m = pr.extReview;
  if (!m) return null;
  const codex = pr.codexUnavailable?.why === "silent" ? "Codex 무응답" : "Codex 한도";
  const r = m.review;
  const who = r ? reviewerOf(r.family) : "";
  const text =
    m.status === "pass" ? `REVIEW: ${who} (${codex})` : m.status === "findings" ? `${who} 지적 (${codex})` : m.status === "waiting" ? `${codex} · 착륙 리뷰 대기` : `외부 리뷰 제외 — ${m.reason}`;
  const tip = r
    ? `착륙 리뷰 ${r.verdict} · ${r.family} (${r.model}) · ${r.at}\nP0 ${r.p0} · P1 ${r.p1} · P2 ${r.p2}\n${r.text}`
    : m.status === "excluded"
      ? "보안·기밀 작업은 외부 모델에 보내지 않는다 — Codex나 SUPERVISOR 리뷰"
      : "REVIEW 세션(DeepSeek)이 이 head를 리뷰하면 CLEARED TO LAND 근거가 된다";
  return (
    <span className={`pr-extreview is-${m.status}`} title={tip}>
      {text}
    </span>
  );
}

function PrLink({ pr }: { pr: PullRequest }) {
  return (
    <a
      className="pr-num"
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`PR #${pr.number}: ${pr.title}`}
      title={`${pr.title}\n${pr.base} ← ${pr.branch}`}
    >
      #{pr.number}
    </a>
  );
}

// 막는 조건의 짧은 이름(STAND 줄용). 전체 문장은 툴팁과 펼침에
const blockShort: Record<LandingBlockCode, string> = {
  draft: "DRAFT",
  "checks-pending": "CI 진행 중",
  "checks-failed": "CI 실패",
  "no-checks": "CI 없음",
  "no-review": "리뷰 없음",
  "review-stale": "리뷰 옛 커밋",
  "review-findings": "리뷰 지적",
  "changes-requested": "변경 요청",
  behind: "BEHIND",
  dirty: "충돌",
  blocked: "BLOCKED",
  "merge-unknown": "계산 중",
  los: "LOS",
};

// 막는 조건: 짧은 이름 한 줄, 펼치면(키보드로도) 전체 문장
function BlockList({ pr }: { pr: PullRequest }) {
  if (pr.landing === "CLEARED" || !pr.blocks.length) return null;
  return (
    <details className="pr-more">
      <summary title={blocksTip(pr)}>{pr.blocks.map((b) => blockShort[b.code] ?? b.code).join(" · ")}</summary>
      <ul className="pr-blocks">
        {pr.blocks.map((b) => (
          <li key={b.code}>{b.text}</li>
        ))}
      </ul>
    </details>
  );
}

// STAND 줄의 PR 착륙 상태
function PrLanding({ pr, landing }: { pr: PullRequest; landing: LandingIndex }) {
  const seq = landing.seq.get(prKey(pr));
  return (
    <div className="pr-land">
      <div className="pr-head">
        <LandingBadge pr={pr} />
        <PrLink pr={pr} />
        <ExtReviewTag pr={pr} />
        {seq && landing.seq.size > 1 && (
          <span className="pr-seq" title={`LANDING SEQUENCE ${landing.seq.size}개 중 ${seq}번째`}>
            SEQ {seq}
          </span>
        )}
      </div>
      <BlockList pr={pr} />
    </div>
  );
}

// 열린 PR 전체. TOWER landingQueue와 같은 순서: CLEARED(readyAt 순) 다음 APPROACH(연 순서).
// CLEARED만 펼쳐 두고 APPROACH와 Draft(순서 밖)는 접어 둔다.
function LandingSequence({
  pulls,
  landing,
  idx,
  nameOf,
}: {
  pulls: PullRequest[];
  landing: LandingIndex;
  idx: Index;
  nameOf: (id: string) => string;
}) {
  if (!pulls.length) return null;
  const byOpened = (a: PullRequest, b: PullRequest) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number;
  const seqOf = (p: PullRequest) => landing.seq.get(prKey(p)) ?? 0;
  const cleared = pulls.filter((p) => p.landing === "CLEARED").sort((a, b) => seqOf(a) - seqOf(b));
  const approach = pulls.filter((p) => p.landing !== "CLEARED" && !p.draft).sort(byOpened);
  const drafts = pulls.filter((p) => p.landing !== "CLEARED" && p.draft).sort(byOpened);

  const row = (pr: PullRequest) => {
    const seq = landing.seq.get(prKey(pr));
    const ws = pr.standPath ? idx.wsByPath.get(pr.standPath) : undefined;
    const holders = pr.standPath
      ? (idx.claimsByWorkspace.get(pr.standPath) ?? [])
          .filter((c) => c.state === "active")
          .map((c) => nameOf(c.sessionId))
      : [];
    const ticket = pr.ticketKey ? idx.ticketByKey.get(pr.ticketKey) : undefined;
    return (
      <li key={prKey(pr)} className={`ls-row${seq ? " is-cleared" : ""}`}>
        <div className="ls-status">
          <span className="ls-seq" title={seq ? `LANDING SEQUENCE ${seq}번째` : undefined}>
            {seq ?? "—"}
          </span>
          <LandingBadge pr={pr} />
        </div>
        <div className="ls-flight" title={ticket?.title}>
          <AirportCode airport={idx.airportByRepo.get(pr.repo)} />{" "}
          {pr.ticketKey ? flightNumber(pr.ticketKey) : <span className="faint">AD HOC</span>}
        </div>
        <div className="ls-pr">
          <div className="ls-title">
            <PrLink pr={pr} /> <ExtReviewTag pr={pr} /> <span title={pr.title}>{pr.title}</span>
          </div>
          {pr.landing !== "CLEARED" && pr.blocks.length > 0 && (
            <ul className="ls-blocks">
              {pr.blocks.map((b) => (
                <li key={b.code}>{b.text}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="ls-stand" title={pr.standPath ?? `${pr.branch}: 체크아웃한 STAND 없음`}>
          {holders.length ? holders.join(", ") : <span className="faint">{ws ? ws.name : "STAND 없음"}</span>}
        </div>
      </li>
    );
  };

  return (
    <div className="bay ls">
      <h2 className="label">
        LANDING SEQUENCE <em>CLEARED TO LAND {cleared.length}</em>
      </h2>
      {cleared.length > 0 && <ol className="ls-list">{cleared.map(row)}</ol>}
      {approach.length > 0 && (
        <details className="ls-group">
          <summary>APPROACH PR {approach.length}개 · 막는 조건이 남음</summary>
          <ol className="ls-list">{approach.map(row)}</ol>
        </details>
      )}
      {drafts.length > 0 && (
        <details className="ls-group is-draft">
          <summary>DRAFT PR {drafts.length}개 · LANDING SEQUENCE에 들지 않음</summary>
          <ol className="ls-list">{drafts.map(row)}</ol>
        </details>
      )}
    </div>
  );
}

const OVERDUE_MS = 10 * 60_000;
const RECENT_READBACK_MS = 30 * 60_000;

// CLEARANCE: READBACK 대기(파랑), 10분 넘게 NO READBACK(주황), 최근 30분 안에 READBACK 받음(점선)
function ClearanceStamps({ clearances, now }: { clearances: Clearance[]; now: number }) {
  const { clock } = useSettings();
  const shown = clearances.filter(
    (c) => !c.cancelledAt && (!c.readbackAt || now - Date.parse(c.readbackAt) < RECENT_READBACK_MS),
  );
  if (!shown.length) return null;
  return (
    <div className="sub">
      {shown.map((c) => {
        const overdue = !c.readbackAt && now - Date.parse(c.at) > OVERDUE_MS;
        const tone = c.readbackAt ? "dashed" : overdue ? "amber" : "blue";
        const state = c.readbackAt ? "READBACK" : overdue ? "NO READBACK" : "READBACK 대기";
        return (
          <span key={c.id} className={`stamp ${tone}`} title={`${c.text}\n${formatClock(c.at, clock)} 발부 · ${state}`}>
            {c.id} {c.type} · {state}
          </span>
        );
      })}
    </div>
  );
}
