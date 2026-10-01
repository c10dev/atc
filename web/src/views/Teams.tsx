import { useState } from "react";
import type { AutolandView, PullTagKind } from "../../../server/autoland.ts";
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
import { OpenFlight } from "../FlightLink.tsx";
import { activeFirst, hasActiveClaim, type Index, isGateCleanup, sortSessions, timeAgo } from "../derive.ts";
import { formatClock, useSettings } from "../settings.ts";
import { attachCommandOf } from "../../../server/session-origin.ts";
import { ActivityLine, AirportCode, AwayTag, NeedsYou, SessionPlace } from "../ui.tsx";
import { type MilestoneData, useMilestones } from "../useMilestones.ts";
import { FlightProgressBar } from "./FlightProgress.tsx";
import { HumanCheckQueue, HumanCheckTag } from "./HumanCheck.tsx";
import "./Teams.css";

const BAYS: AircraftStatus[] = ["airborne", "holding", "nordo", "parked"];
const agentCode = { claude: "CLD", codex: "CDX" } as const;

export function Teams({ snapshot, idx, now }: { snapshot: Snapshot; idx: Index; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const all = sortSessions(snapshot.sessions, idx);
  const visible = showAll ? all : all.filter((s) => s.status === "busy" || idx.claimsBySession.has(s.id) || s.job?.state === "blocked") // blocked job은 PARKED여도 보인다(NEEDS YOU, ATC-99);
  const hidden = all.length - visible.length;
  const nameOf = (id: string) => {
    const s = idx.sessionById.get(id);
    return s ? callsign(s) : id.slice(0, 8);
  };

  const bays = new Map<AircraftStatus, Session[]>(BAYS.map((b) => [b, []]));
  // Dark cockpit(ATC-111): 쥔 STAND가 모두 ARRIVED·취소 FLIGHT의 것인 AIRCRAFT는 bay에서 빼 맨 아래 GATE CLEANUP에 모은다
  const cleanup = visible.filter((s) => isGateCleanup(s, idx));
  const cleanupIds = new Set(cleanup.map((s) => s.id));
  for (const s of visible) if (!cleanupIds.has(s.id)) bays.get(aircraftStatus(s, hasActiveClaim(idx.claimsBySession.get(s.id))))!.push(s);
  // 옛 서버 스냅샷에는 pulls·github가 없다
  const pulls = snapshot.pulls ?? [];
  const github = snapshot.github ?? null;
  const landing = landingIndex(pulls, snapshot.autoland);
  const ms = useMilestones(snapshot.at.slice(0, 16)); // 진행 막대(ATC-211): 스냅샷이 바뀌는 분마다 한 번

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
      {github && !github.enabled && github.reason && (
        <p className="ls-stale" title={github.reason}>
          GitHub off · PR 상태를 읽지 않음
        </p>
      )}
      {github?.error && (
        <p className="ls-stale" title={github.error}>
          GitHub 조회 실패 · PR 상태가 오래됐을 수 있음
        </p>
      )}
      <HumanCheckQueue pulls={pulls} idx={idx} nameOf={nameOf} />
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
                  ms={ms}
                  clearances={snapshot.clearances.filter((c) => c.to === s.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
      {cleanup.length > 0 && (
        <details className="bay bay-gate">
          <summary className="label" title="쥔 STAND가 모두 ARRIVED·취소된 FLIGHT의 것인 AIRCRAFT. 워크트리를 치우면 사라진다">
            GATE CLEANUP <em>{cleanup.length}</em>
          </summary>
          <div className="bay-rail">
            {cleanup.map((s) => (
              <Strip
                key={s.id}
                session={s}
                status={aircraftStatus(s, true)}
                idx={idx}
                now={now}
                nameOf={nameOf}
                landing={landing}
                ms={ms}
                clearances={snapshot.clearances.filter((c) => c.to === s.id)}
              />
            ))}
          </div>
        </details>
      )}
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
  ms,
  clearances,
}: {
  session: Session;
  status: AircraftStatus;
  idx: Index;
  now: number;
  nameOf: (id: string) => string;
  landing: LandingIndex;
  ms: MilestoneData;
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
          <NeedsYou job={s.job} attach={s.jobId ? attachCommandOf(s.jobId, s.attachDir) : null} />
        </div>
        <ActivityLine activity={s.activity} now={now} />
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
                {ws?.ticketKey && ms.progress.get(ws.ticketKey) && (
                  <div className="leg-progress">
                    <FlightProgressBar progress={ms.progress.get(ws.ticketKey)!} milestones={ms.flights.get(ws.ticketKey) ?? null} clock={clock}>
                      {ms.progress.get(ws.ticketKey)!.segment === "landing" &&
                        (landing.byStand.get(c.workspacePath) ?? []).map((pr) => (
                          <span key={prKey(pr)} className="flp-tags">
                            <LandingBadge pr={pr} />
                            <AutolandTag pr={pr} landing={landing} />
                          </span>
                        ))}
                    </FlightProgressBar>
                  </div>
                )}
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
  autoland: AutolandView | null; // AUTOLAND(ATC-34). 옛 서버 스냅샷에는 없다
}

const prKey = (p: PullRequest) => `${p.repo}#${p.number}`;

// LANDING SEQUENCE: CLEARED를 readyAt 이른 순으로. readyAt이 없으면 뒤로
function landingIndex(pulls: PullRequest[], autoland?: AutolandView): LandingIndex {
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
  return { byStand, seq: new Map(cleared.map((p, i) => [prKey(p), i + 1])), autoland: autoland ?? null };
}

function blocksTip(pr: PullRequest): string {
  return pr.blocks.map((b) => `· ${b.text}`).join("\n");
}

// CLEARED TO LAND(호박) 또는 APPROACH(시안) + 막는 조건 수
function LandingBadge({ pr }: { pr: PullRequest }) {
  const cleared = pr.landing === "CLEARED";
  const n = pr.blocks.length;
  // 쌓인 PR(base가 기본 브랜치가 아님, ATC-29): CLEARED가 되지 않는다. 사슬을 함께 보인다
  if (pr.blocks.some((b) => b.code === "stacked")) {
    return (
      <span className="pr-badge is-approach" title={`STACKED: ${blocksTip(pr)}`}>
        STACKED{pr.stack ? ` ${pr.stack.chain.map((x) => `#${x}`).join(" → ")}` : ""}
      </span>
    );
  }
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
// 리뷰어 이름은 모델 계열 앞머리, claude- 는 뗀다(서버 reviewerOf와 같다): claude-sonnet-5-5 → SONNET, 옛 deepseek-v4.1-flash → DEEPSEEK
const reviewerOf = (family: string) => {
  const f = family.replace(/^claude-/i, "");
  return (f.split(/[-.\s]/)[0] || family).toUpperCase();
};
function ExtReviewTag({ pr }: { pr: PullRequest }) {
  const m = pr.extReview;
  if (!m) return null;
  // 스위치로 보낸 보안 PR(ATC-30)은 "보안, "을 붙여 외부 리뷰에 기댄 착륙임을 보인다
  const codex = `${m.security ? "보안, " : ""}${pr.codexUnavailable?.why === "silent" ? "Codex 무응답" : pr.codexUnavailable?.why === "autoland" ? "AUTOLAND 재리뷰" : "Codex 한도"}`;
  const r = m.review;
  const who = r ? reviewerOf(r.family) : "";
  const text =
    m.status === "pass" ? `REVIEW: ${who} (${codex})` : m.status === "findings" ? `${who} 지적 (${codex})` : m.status === "waiting" ? `${codex} · 착륙 리뷰 대기` : `외부 리뷰 제외 — ${m.reason}`;
  const sec = m.security ? `보안 PR(${m.security}) — 설정 externalReview.security가 deepseek(옛 이름)이라 REVIEW 세션으로 보냄\n` : "";
  const tip = r
    ? `${sec}착륙 리뷰 ${r.verdict} · ${r.family} (${r.model}) · ${r.at}\nP0 ${r.p0} · P1 ${r.p1} · P2 ${r.p2}\n${r.text}`
    : m.status === "excluded"
      ? "착륙 리뷰에서 빠진 PR(비밀·키 경로, FLIGHT 없음, 스위치가 exclude면 보안 규칙) — Codex나 SUPERVISOR 리뷰"
      : `${sec}REVIEW 세션(Claude Sonnet)이 이 head를 리뷰하면 CLEARED TO LAND 근거가 된다`;
  return (
    <span className={`pr-extreview is-${m.status}`} title={tip}>
      {text}
    </span>
  );
}

// main 병합만 한 head에 이어받은 이전 커밋의 리뷰(ATC-31). SUPERVISOR가 물려받은 리뷰임을 알아보게
function CarriedTag({ pr }: { pr: PullRequest }) {
  const c = pr.carried;
  if (!c) return null;
  const who = c.by === "human" ? "HUMAN" : c.by === "codex" ? "CODEX" : "REVIEW";
  const from = c.from.slice(0, 7);
  return (
    <span
      className={`pr-extreview ${c.findings ? "is-findings" : "is-pass"}`}
      title={`${from}의 리뷰를 이어받음: 그 뒤 커밋은 main 병합뿐이고 PR의 변경(바뀐 파일과 blob)이 그대로다${c.findings ? " — 그 리뷰의 지적도 그대로 남는다" : ""}`}
    >
      {c.findings ? `${who} 지적 (carried from ${from})` : `REVIEW: ${who} (carried from ${from}, main merge only)`}
    </span>
  );
}

// Codex P3 지적만 남고 모두 해결·답글이면 착륙을 막지 않는다(ATC-28). 그때 남은 수를 보인다
function CodexP3Tag({ pr }: { pr: PullRequest }) {
  const f = pr.codexFindings;
  if (!f?.ok) return null;
  return (
    <span className="pr-extreview is-p3" title="Codex가 현재 head에 P3(사소한) 지적만 남겼고, 스레드가 모두 해결·답글됨 — 착륙은 막지 않는다">
      Codex P3 {f.p3}건(해결됨) — 착륙 막지 않음
    </span>
  );
}

// AUTOLAND(ATC-34): 이 PR에 AUTOLAND가 할 일, 또는 손대지 않는 까닭
const AUTOLAND_TIP: Record<PullTagKind, string> = {
  update: "AUTOLAND가 이 PR을 GitHub update-branch(expected_head_sha)로 갱신한다 — CI가 통과하면 CLEARED",
  inflight: "AUTOLAND가 갱신함 — 새 head의 CI를 기다린다(AIRPORT마다 하나씩)",
  queued: "CLEARED인데 behind만 남음 — LANDING SEQUENCE 순서로 하나씩 갱신한다",
  merge: "AUTOLAND merge: 위임된 PR이라 정확한 head로 머지한다",
  delegated: "AUTOLAND merge 대상(위임된 PR)",
  supervisor: "AUTOLAND가 머지하지 않는다 — SUPERVISOR가 머지",
  excluded: "AUTOLAND가 손대지 않는다",
  waiting: "AUTOLAND 대기",
  review: "AUTOLAND가 갱신한 head에 리뷰가 이어지지 않아 재리뷰를 요청함: codex는 PR 댓글 @codex review, 30분 무응답·한도면 REVIEW 대기열",
};
function AutolandTag({ pr, landing }: { pr: PullRequest; landing: LandingIndex }) {
  const t = landing.autoland?.pulls[prKey(pr)];
  if (!t) return null;
  return (
    <span className={`pr-autoland is-${t.kind}`} title={AUTOLAND_TIP[t.kind]}>
      {t.text}
    </span>
  );
}

// SUPERVISOR의 HOLD: merge 모드에서 AUTOLAND가 이 PR을 머지하지 않는다. CLEARED여도 다음 PR 갱신을 막지 않는다
function HoldButton({ pr, landing }: { pr: PullRequest; landing: LandingIndex }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = landing.autoland;
  if (!a || a.mode === "off" || pr.draft || !a.airports.some((x) => x.repo === pr.repo)) return null;
  const held = a.holds.includes(prKey(pr));
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/autoland/hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: pr.repo, number: pr.number, hold: !held }),
      });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
    setBusy(false);
  };
  return (
    <button
      className={`pr-hold${held ? " is-held" : ""}`}
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={held}
      title={error ?? (held ? "HOLD 풀기: AUTOLAND merge가 다시 이 PR을 머지할 수 있다" : "HOLD: AUTOLAND가 이 PR을 머지하지 않는다(SUPERVISOR가 머지)")}
    >
      {held ? "HOLD ✓" : "HOLD"}
    </button>
  );
}

// LANDING SEQUENCE 머리: AIRPORT마다 AUTOLAND가 다음에 할 일
function AutolandStatus({ autoland, idx }: { autoland: AutolandView | null; idx: Index }) {
  if (!autoland || autoland.mode === "off" || !autoland.airports.length) return null;
  return (
    <ul className="ls-autoland" aria-label={`AUTOLAND ${autoland.mode}`}>
      {autoland.airports.map((a) => (
        <li key={a.airport} className={`is-${a.status}`}>
          <span className="ls-autoland-mode">{autoland.mode.toUpperCase()}</span>
          <AirportCode airport={idx.airportByRepo.get(a.repo)} /> {a.text}
        </li>
      ))}
    </ul>
  );
}

// airport가 있으면 번호는 PR 서랍(#pr/…)을 열고, GitHub는 옆의 ↗로 연다
function PrLink({ pr, airport }: { pr: PullRequest; airport?: string }) {
  const ext = (
    <a
      className="pr-num"
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`PR #${pr.number}: ${pr.title}`}
      title={`${pr.title}\n${pr.base} ← ${pr.branch}`}
    >
      {airport ? "↗" : `#${pr.number}`}
    </a>
  );
  return airport ? (
    <>
      <a className="pr-num" href={`#pr/${airport}/${pr.number}`} title={`PR #${pr.number} 서랍 열기`}>
        #{pr.number}
      </a>{" "}
      {ext}
    </>
  ) : (
    ext
  );
}

// 막는 조건의 짧은 이름(STAND 줄용). 전체 문장은 툴팁과 펼침에
const blockShort: Record<LandingBlockCode, string> = {
  stacked: "STACKED",
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
        <CarriedTag pr={pr} />
        <CodexP3Tag pr={pr} />
        <HumanCheckTag pr={pr} />
        <AutolandTag pr={pr} landing={landing} />
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
          {pr.ticketKey ? <OpenFlight k={pr.ticketKey} /> : <span className="faint">AD HOC</span>}
        </div>
        <div className="ls-pr">
          <div className="ls-title">
            <PrLink pr={pr} airport={idx.airportByRepo.get(pr.repo)?.code} /> <ExtReviewTag pr={pr} /> <CarriedTag pr={pr} /> <CodexP3Tag pr={pr} /> <HumanCheckTag pr={pr} /> <AutolandTag pr={pr} landing={landing} />{" "}
            <HoldButton pr={pr} landing={landing} /> <span title={pr.title}>{pr.title}</span>
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
      <AutolandStatus autoland={landing.autoland} idx={idx} />
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

// CLEARANCE: 답 대기(파랑), 10분 넘게 답 없음(주황), UNABLE(빨강), 최근 30분 안에 답 받음(점선).
// 답(ATC-122): W/U는 READBACK·UNABLE, R은 ROGER가 닫는다. 첫 STANDBY부터 10분을 한 번 다시 센다
function ClearanceStamps({ clearances, now }: { clearances: Clearance[]; now: number }) {
  const { clock } = useSettings();
  const answeredAt = (c: Clearance) => c.readbackAt ?? c.unableAt ?? null;
  const shown = clearances.filter((c) => {
    const at = answeredAt(c);
    return !c.cancelledAt && (!at || now - Date.parse(at) < RECENT_READBACK_MS);
  });
  if (!shown.length) return null;
  return (
    <div className="sub">
      {shown.map((c) => {
        const base = c.standbyAt && c.standbyAt >= c.at ? c.standbyAt : c.at;
        const overdue = !answeredAt(c) && now - Date.parse(base) > OVERDUE_MS;
        const tone = c.unableAt ? "red" : c.readbackAt ? "dashed" : overdue ? "amber" : "blue";
        // 도장은 좁은 칸이라 짧게. UNABLE 사유는 제목(title)에
        const state = c.unableAt
          ? "UNABLE"
          : c.readbackAt
            ? (c.ackWord ?? "READBACK")
            : overdue
              ? "NO READBACK"
              : c.standbyAt
                ? "STANDBY"
                : "READBACK 대기";
        return (
          <span key={c.id} className={`stamp ${tone}`} title={`${c.text}\n${formatClock(c.at, clock)} 발부 · ${state}${c.unableReason ? ` — ${c.unableReason}` : ""}`}>
            {c.id} {c.type} · {state}
          </span>
        );
      })}
    </div>
  );
}
