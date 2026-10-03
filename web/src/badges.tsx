import type { Airport, Session } from "../../server/model.ts";
import { pendingNeedsOf } from "../../server/pending.ts";
import type { Job } from "../../server/job-state.ts";
import { jobKnownText } from "../../server/job-age.ts";
import { type Activity, activityParts } from "../../server/activity.ts";
import { standNeedsHint } from "../../server/stand-hint.ts";
import { callsign } from "./aviation.ts";
import { type Index, sessionLocation } from "./derive.ts";
import "./badges.css";
import { dotShapeOf, PHASE_SHAPE } from "./kit/dot.ts";

// 저장소 = AIRPORT 코드(대문자 4자). 마우스를 올리면 저장소 이름과 경로.
// plain: 툴팁 없이(FIDS처럼 줄마다 붙는 곳. 저장소 경로는 숫자뿐인 툴팁이라 화면에 두지 않는다)
export function AirportCode({ airport, plain = false }: { airport: Airport | null | undefined; plain?: boolean }) {
  if (!airport) return null;
  return (
    <span className="apt" title={plain ? undefined : `${airport.name} (${airport.repo})`}>
      {airport.code}
    </span>
  );
}

// OUTSTATION: 소속 AIRPORT 밖 STAND를 점유 중일 때 "OUTSTATION TNNS". 낱말 자체가 상태라 툴팁이 없어도 읽힌다(ATC-418)
export function AwayTag({ airports }: { airports: Airport[] | undefined }) {
  if (!airports?.length) return null;
  return (
    <span className="away-tag">
      OUTSTATION
      {airports.map((a) => (
        <AirportCode key={a.id} airport={a} />
      ))}
    </span>
  );
}

// 세션 위치: "VCDO TWR"(본 체크아웃), "VCDO vocado-voc-187"(워크트리), 저장소 밖이면 폴더 이름.
export function SessionPlace({ session, idx }: { session: Session; idx: Index }) {
  const { airport, place } = sessionLocation(session, idx);
  return (
    <>
      <AirportCode airport={airport} /> {place}
    </>
  );
}

// 세션 배지의 상태 낱말(ATC-418): 점 색만으로 상태를 말하지 않도록 이름 옆에 글자로도 보인다(원칙 2)
const statusLabel = { busy: "AIRBORNE", idle: "IDLE", dead: "NORDO" } as const;

export function StatusDot({ status, label }: { status: Session["status"]; label?: string }) {
  const text = label ?? statusLabel[status];
  return <span className={`dot dot-${status}`} data-shape={dotShapeOf(status)} title={text} aria-label={text} />;
}

export function SessionBadge({ session }: { session: Session }) {
  const state = statusLabel[session.status];
  return (
    <span className={`session-badge is-${session.status}`} title={session.name}>
      <StatusDot status={session.status} label={state} />
      {callsign(session)}
      <span className="sb-state">{state}</span>
    </span>
  );
}

// Linear 우선순위: 1 긴급, 2 높음, 3 보통, 4 낮음.
const PRIORITY = [
  null,
  { code: "URG", label: "긴급" },
  { code: "HIGH", label: "높음" },
  { code: "MED", label: "보통" },
  { code: "LOW", label: "낮음" },
];

export function PriorityMark({ priority }: { priority: number }) {
  const p = PRIORITY[priority];
  if (!p) return null;
  return (
    <span className={`prio prio-${priority}`} title={`우선순위 ${p.label}`} aria-label={`우선순위 ${p.label}`}>
      {p.code}
    </span>
  );
}

// NEEDS YOU(ATC-99): 백그라운드 job이 blocked면 사람의 답을 기다린다. needs가 글, 기다린 시각은 화면에 짧게 옆으로. 읽기만 한다
// attach: 카드가 복사하는 것과 같은 명령(ATC-301, 기본이 아닌 폴더면 CLAUDE_CONFIG_DIR가 붙는다) — 툴팁에 남긴다(카드에는 눈에 보인다)
export function NeedsYou({ job, attach, className = "" }: { job: Job | null | undefined; attach?: string | null; className?: string }) {
  if (job?.state !== "blocked") return null;
  const since = job.since ? `${job.since.slice(11, 16)}Z` : null;
  return (
    <span className={`needs-you mono ${className}`.trim()} title={[job.detail, attach].filter(Boolean).join(" — ") || undefined}>
      NEEDS YOU{job.needs ? <span className="needs-you-text"> · {job.needs}</span> : null}
      {standNeedsHint(job.needs) ? <span className="needs-you-text"> · {standNeedsHint(job.needs)}</span> : null}
      {since ? <span className="needs-you-when"> · {since}</span> : null}
    </span>
  );
}

// PENDING approval(ATC-327): 세션이 도구 승인 프롬프트에 서 있고 Claude Code가 청하는 것을 적어 두었으면(state가 working이어도) 그 한 줄을 보인다.
// NEEDS YOU와 같은 모양, 색은 --blue(사람의 결정을 기다림, 오류가 아님). attach: 카드가 복사하는 것과 같은 명령. 읽기만 한다 — 승인은 SUPERVISOR가 그 세션에서 한다
export function PendingApproval({ job, health, attach, className = "" }: { job: Job | null | undefined; health?: { code: string } | null; attach?: string | null; className?: string }) {
  const needs = pendingNeedsOf({ health, job });
  if (!needs) return null;
  return (
    <span className={`needs-you is-pending mono ${className}`.trim()} title={`SUPERVISOR가 \`${attach || "claude attach <id>"}\`로 붙어 승인하거나 거절한다`}>
      PENDING<span className="needs-you-text"> · {needs}</span>
    </span>
  );
}

// ACTIVITY(ATC-97): "Bash · Run the test suite · 12s". 도구가 돌면 tool, 모델 대기는 model, idle은 흐리게. 본문은 없다
// 단계는 색이 아니라 점의 모양으로도 보이고(ATC-412: tool 찬 원, model 빈 원, idle 막대) 낭독기에는 글로 읽힌다. 툴팁에만 있지 않다
// 툴팁은 phase 낱말(tool·model·idle)의 뜻풀이 — 값이 아니라 읽는 법이라 남긴다(ATC-418)
const PHASE_TIP = { tool: "도구 실행 중", model: "도구 결과 뒤 모델 응답 대기", idle: "턴이 끝나 쉬는 중" } as const;
export function ActivityLine({ activity, now, className = "" }: { activity: Activity | null | undefined; now: number; className?: string }) {
  if (!activity) return null;
  const { what, ago } = activityParts(activity, now);
  return (
    <span className={`activity is-${activity.phase} ${className}`.trim()} title={`ACTIVITY — ${PHASE_TIP[activity.phase]}`}>
      <span className="dot activity-dot" data-shape={PHASE_SHAPE[activity.phase]} aria-hidden="true" />
      <span className="sr-only">{PHASE_TIP[activity.phase]}: </span>
      {what && <span className="activity-what">{what}</span>}
      <span className="activity-ago">{what ? " · " : ""}{ago}</span>
    </span>
  );
}

// working 중인 백그라운드 job의 한 줄(Claude Code가 적은 detail)
// 지금 하는 일이 아니라 job이 마지막으로 적은 것이라 나이를 붙인다(ATC-369): "… · last known, 17 h ago"
// detail과 나이는 화면에, "지금 하는 일이 아니다"라는 뜻풀이만 툴팁에 (ATC-418)
export function JobDetail({ job, now = Date.now() }: { job: Job | null | undefined; now?: number }) {
  if (job?.state !== "working") return null;
  const st = job.settled;
  if (st) {
    // ATC-133: 파일은 blocked로 남았지만 이미 일하는 job. 파일의 원래 모습을 툴팁에 남긴다
    const hm = (t: string | null) => (t ? `${t.slice(11, 16)}Z` : "");
    const tip = `job 파일은 blocked${st.since ? ` since ${hm(st.since)}` : ""}${st.resumedAt ? `, working since ${hm(st.resumedAt)}` : ""}${st.reason === "tempo" ? " (tempo active)" : " (이후 턴 있음)"}`;
    return <span className="job-detail faint" title={tip}>working</span>;
  }
  if (!job.detail) return null;
  return (
    <span className="job-detail faint" title="백그라운드 job의 detail(Claude Code가 마지막으로 적은 한 줄). 지금 하는 일이 아니다">
      {job.detail} · {jobKnownText(job, now)}
    </span>
  );
}

// suggestedReply: 복사만 한다. atc는 어디에도 보내지 않는다. 보내지 않는다는 것도 화면에 보인다(ATC-418)
export function SuggestedReply({ job }: { job: Job | null | undefined }) {
  if (job?.state !== "blocked" || !job.suggestedReply) return null;
  const copy = () => void navigator.clipboard?.writeText(job.suggestedReply!).catch(() => {});
  return (
    <p className="needs-you-reply">
      <span className="faint">제안된 답 (atc는 보내지 않는다 — 복사해 그 세션에 붙여 넣는다) </span>
      <code>{job.suggestedReply}</code>{" "}
      <button type="button" className="needs-you-copy" onClick={copy}>
        복사
      </button>
    </p>
  );
}
