import { createContext, type KeyboardEvent, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RoutePayload, TargetPayload } from "../../../server/network-drafts.ts";
import type { ClassifyPayload, ClosePayload, NewPayload, PrioritizePayload, ScheduleOp } from "../../../server/schedule.ts";
import { flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import { formatClock, useSettings } from "../settings.ts";
import { PriorityMark } from "../ui.tsx";
import "./Schedule.css";

// OCC SCHEDULE — OCC가 Linear에 쓸 변경(CLASSIFY 라벨, PRIORITIZE 우선순위, NEW 새 이슈, CLOSE 닫기)을 초안으로 남긴다.
// CLOSE는 이슈 상태를 바꾸는 일이라 OCC가 발부하지 않고, 승인되면 SUPERVISOR가 Linear에서 직접 Done으로 바꾼다.
// S1(shadow): SUPERVISOR는 "승인했을 것 / 거절했을 것"만 표시하고 아무것도 Linear에 쓰지 않는다.
// S2(approval): 승인한 작업을 OCC가 발부받아 Linear에 쓴다(linear-guard가 입력을 비교). 기본은 S1.
// TARGET·ROUTE(ATC-25)는 AIRCRAFT의 FLEET TARGETS·ROUTE 변경 제안이다. 적용하는 길이 아직 없어 모드와 상관없이 그림자 판정만 받는다.
// 설계: docs/occ.md 5~7장, docs/fleet.md 4·6장·7.4.

interface FlightInfo {
  title: string;
  state: string;
  priority: number;
  project: string | null;
  url: string | null;
  cls: string; // "BUILD · M · SEC"
  labels: string[];
}

type Mode = "shadow" | "approval";
// 판정 버튼 문구가 모드를 따르게(S1 "승인했을 것", S2 "승인")
const ModeContext = createContext<Mode>("shadow");

// CROSSCHECK: 다른 모델(CROSSCHECK 세션)이 열린 초안에 남긴 임시 판정. 사람 판정을 대신하지 않는다.
interface Crosscheck {
  by: string;
  model?: string; // 표시한 모델 id. 옛 기록·옛 서버는 "unknown" 또는 없음
  verdict: "agree" | "disagree";
  reason: string;
  at: string;
}
interface CrosscheckRate {
  marked: number;
  matched: number;
  rate: number | null;
}
// 판정 계열(ATC-36, server/judges/store.ts judgesViewOf와 같은 모양). mark는 SUPERVISOR가 판정한 초안에만 온다(쏠림 방지)
interface JudgeMark {
  family: string;
  verdict: "agree" | "disagree";
  reason: string;
  model: string;
  run: "replay" | "shadow";
  at: string;
  withheld: string | null;
}
interface Judges {
  modes: Record<string, "off" | "replay" | "shadow">;
  rate: Record<string, CrosscheckRate>;
  marks: Record<string, JudgeMark[]>;
  hidden: number; // 아직 판정하지 않은 초안의 mark 수(보이지 않음)
}
// 서버 타입에 아직 없을 수 있어 따로 읽는다(옛 서버면 null)
const markOf = (op: ScheduleOp): Crosscheck | null => (op as unknown as { crosscheck?: Crosscheck | null }).crosscheck ?? null;
const modelOf = (m: Crosscheck) => m.model || "unknown";
// 모델 계열(서버 modelFamily와 같다): claude-ocx-opencode-go--muse-spark-1.3-contributor[1m] → muse-spark-1.3
function modelLabel(id: string): string {
  let s = id.replace(/^claude-ocx-/, "");
  const cut = s.indexOf("--");
  if (cut >= 0 && cut + 2 < s.length) s = s.slice(cut + 2);
  s = s.replace(/\[[^\]]*\]$/, "").replace(/-contributor$/, "");
  return s || id;
}
// 모델별 일치: 표시 많은 순(같으면 이름순)
const byModelRows = (byModel: Record<string, CrosscheckRate> | undefined) =>
  Object.entries(byModel ?? {}).sort(([a, x], [b, y]) => y.marked - x.marked || a.localeCompare(b));
// "짧은 이름 (전체 id)", 같으면 하나만
const modelText = (id: string) => (modelLabel(id) === id ? id : `${modelLabel(id)} (${id})`);
// 툴팁·aria-label: "CROSSCHECK agree · 모델 (전체 id) — 사유"
const xcTitle = (m: Crosscheck) => `CROSSCHECK ${m.verdict} · ${modelText(modelOf(m))} — ${m.reason}`;

// 판정을 어떻게 했는지: CROSSCHECK에 동의 버튼 한 번(crosscheck) 또는 직접(manual). 옛 기록은 없음
type Via = "crosscheck" | "manual";
const viaOf = (op: ScheduleOp): Via | null => (op as unknown as { via?: Via | null }).via ?? null;
// 한 번 클릭 비율 설명(툴팁·안내 문장)
const ONE_CLICK_NOTE = "사람 판정 가운데 CROSSCHECK에 동의 버튼 한 번으로 낸 비율 — 어떻게 판정했는지 기록된 판정만 셈";

interface Brief {
  mode: Mode;
  open: ScheduleOp[];
  inProgress: ScheduleOp[];
  recent: ScheduleOp[];
  changes: Record<string, string[]>;
  gate: {
    decided: number;
    agreed: number;
    agreement: number | null;
    target: { decided: number; agreement: number };
    ready: boolean;
    // 참고용, 게이트 기준 아님. byModel·oneClick은 옛 서버면 없음
    crosscheck?: CrosscheckRate & { byModel?: Record<string, CrosscheckRate>; oneClick?: { count: number; decided: number } };
    // TARGET·ROUTE 그림자 판정(게이트와 따로). 옛 서버면 없음
    network?: Record<"TARGET" | "ROUTE", { decided: number; agreed: number; agreement: number | null }>;
  };
  limit: number;
  candidates: { classify: string[]; prioritize: string[]; close?: string[] }; // close는 옛 서버면 없음
  close?: Record<string, { pr: ClosePayload["pr"]; mergedAt: string; link: "fixes" | "part-of" | "none" | null }>;
  closeManual?: ScheduleOp[]; // SUPERVISOR가 Linear에서 직접 Done으로 바꿀 CLOSE
  flights: Record<string, FlightInfo>;
  slips?: Slip[] | null; // WAYPOINT 지연 경고(ATC-24). 옛 서버면 없고, 마일스톤을 못 읽었으면 null
  judges?: Judges; // 판정 계열(ATC-36). 옛 서버면 없음
}

// server/waypoint-slips.ts Slip과 같은 모양(fresh·reportedAt은 brief가 더함)
interface Slip {
  key: string;
  code: "target-passed" | "eta-after-target" | "linear-overdue";
  route: string;
  waypoint: string;
  targetDate: string | null;
  eta: string | null;
  days: number | null;
  text: string;
  fresh: boolean;
  reportedAt: string | null;
}

const slipCode: Record<Slip["code"], string> = { "target-passed": "목표일 지남", "eta-after-target": "ETA 늦음", "linear-overdue": "Linear overdue" };

type Clock = "utc" | "local";

// server/dispatch.ts PRIORITY_NAME과 같은 값(서버 모듈을 번들에 넣지 않으려고 따로 둠)
const PRIORITY_NAME: Record<number, string> = { 0: "없음", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };

const statusText: Record<ScheduleOp["status"], string> = {
  draft: "DRAFT",
  agreed: "승인했을 것",
  disagreed: "거절했을 것",
  approved: "APPROVED",
  rejected: "REJECTED",
  released: "RELEASED",
  applied: "APPLIED",
  superseded: "SUPERSEDED",
  expired: "EXPIRED",
};

// 거절 사유 칩. 고른 라벨 뒤에 선택 메모를 붙여 "라벨 — 메모"로 기록한다.
const REJECT_REASONS: Record<ScheduleOp["kind"], string[]> = {
  CLASSIFY: ["FLIGHT TYPE이 다름", "WAKE가 다름", "TYPE RATING이 빠지거나 넘침", "근거가 본문과 맞지 않음", "지금 분류할 필요 없음"],
  PRIORITIZE: ["우선순위가 더 높아야 함", "우선순위가 더 낮아야 함", "근거가 본문과 맞지 않음", "지금 정할 필요 없음"],
  NEW: ["중복임", "본문 템플릿 부족", "프로젝트·라벨이 다름", "티켓 없이 AD HOC로 충분", "지금 만들 필요 없음"],
  CLOSE: ["Part of — 일부만 끝남", "남은 작업이 있음", "PR이 되돌려졌거나 불완전", "지금 닫을 필요 없음"],
  TARGET: ["목표가 너무 높음", "목표가 너무 낮음", "근거 기간이 짧음", "지금 바꿀 필요 없음"],
  ROUTE: ["이 AIRCRAFT에 맞지 않는 ROUTE", "ROUTE가 아직 끝나지 않음", "다른 AIRCRAFT가 맡는 게 나음", "지금 바꿀 필요 없음"],
};

// TARGET·ROUTE: FLIGHT가 아니라 AIRCRAFT 하나에 대한 초안. 모드와 상관없이 그림자 판정
const isNetworkOp = (op: Pick<ScheduleOp, "kind">) => op.kind === "TARGET" || op.kind === "ROUTE";
const regOf = (op: ScheduleOp) => (op.payload as TargetPayload | RoutePayload).registration;
const num = (n: number | null | undefined) => (n == null ? "없음" : String(n));

// PR 한 줄: "vocado_nextjs#400"
const prName = (p: ClosePayload["pr"]) => `${p.repo.split("/").pop()}#${p.number}`;

// 화면에 보이는 작업 이름. NEW가 만드는 FLIGHT는 AD HOC FLIGHT.
const kindCode = (kind: ScheduleOp["kind"]) => (kind === "NEW" ? "AD HOC FLIGHT" : kind);

// 초안의 대상: FLIGHT 번호, NEW는 아직 없는 이슈라 제목
const subjectOf = (op: ScheduleOp) => (isNetworkOp(op) ? regOf(op) : op.flight ? flightNumber(op.flight) : `"${(op.payload as NewPayload).title}"`);

// NEW 라벨: type:·wake:·rating:·tail:
const newLabels = (p: NewPayload) =>
  [p.type && `type:${p.type}`, p.wake && `wake:${p.wake}`, ...(p.ratings ?? []).map((r) => `rating:${r}`), p.tail && `tail:${p.tail}`].filter(Boolean) as string[];

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

// 여러 날에 걸친 기록이므로 시각 앞에 날짜를 붙인다(설정한 시간대 기준).
function stamp(iso: string, clock: Clock): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = clock === "utc" ? iso.slice(5, 10) : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${formatClock(iso, clock)}`;
}

// 초안이 적용할 값 한 줄: "type:MAINT · wake:M · rating:SEC", "priority High"
function payloadText(op: ScheduleOp): string {
  if (op.kind === "NEW") {
    const p = op.payload as NewPayload;
    return [p.project, p.milestone && `WAYPOINT ${p.milestone.name}`, p.priority && `priority ${PRIORITY_NAME[p.priority]}`, ...newLabels(p)].filter(Boolean).join(" · ");
  }
  if (op.kind === "PRIORITIZE") return `priority ${PRIORITY_NAME[(op.payload as PrioritizePayload).priority]}`;
  if (op.kind === "TARGET") {
    const t = op.payload as TargetPayload;
    return [
      t.flightsPerWeek !== undefined && `flightsPerWeek ${num(t.from.flightsPerWeek)} → ${num(t.flightsPerWeek)}`,
      t.onTime !== undefined && `onTime ${t.from.onTime == null ? "없음" : pct(t.from.onTime)} → ${t.onTime == null ? "없음" : pct(t.onTime)}`,
    ].filter(Boolean).join(" · ");
  }
  if (op.kind === "ROUTE") {
    const r = op.payload as RoutePayload;
    return [...(r.add ?? []).map((x) => `+ ${x}`), ...(r.remove ?? []).map((x) => `− ${x}`)].join(" · ");
  }
  if (op.kind === "CLOSE") {
    const c = op.payload as ClosePayload;
    return [`→ Done`, `PR ${prName(c.pr)}`, c.partOf ? "Part of(일부만)" : c.fixes ? "Fixes" : "본문에 Fixes 없음"].join(" · ");
  }
  const p = op.payload as ClassifyPayload;
  return [p.type && `type:${p.type}`, p.wake && `wake:${p.wake}`, ...(p.ratings ?? []).map((r) => `rating:${r}`)].filter(Boolean).join(" · ");
}

// FLIGHT에 붙은 type:·wake: 라벨. Linear 라벨 그룹은 "type:BUILD"처럼 온다.
const axisLabel = (labels: string[], axis: "type" | "wake") => labels.find((l) => new RegExp(`^${axis}\\s*:`, "i").test(l.trim())) ?? null;

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
  return data;
}

export function Schedule({ refreshKey, now }: { refreshKey: string; now: number }) {
  const { clock } = useSettings();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const draftsHead = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/schedule/brief");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBrief(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // 판정 기록. 카드가 사라지면 초점은 DRAFTS 제목으로. 409·404는 위 알림, 그 밖의 실패는 카드 안에.
  const verdict = async (op: ScheduleOp, v: "agree" | "disagree", reason: string | null, via: Via) => {
    const approval = brief?.mode === "approval" && !isNetworkOp(op);
    if (approval && v === "agree" && !confirm(`${op.id} ${subjectOf(op)}를 승인하면 OCC가 다음 바퀴에 Linear에 씁니다. 승인할까요?`)) return null;
    try {
      if (approval) await post(`/api/schedule/ops/${op.id}/${v === "agree" ? "approve" : "reject"}`, { reason, via });
      else await post(`/api/schedule/ops/${op.id}/verdict`, { verdict: v, reason, via });
      const word = approval ? (v === "agree" ? "승인" : "거절") : v === "agree" ? "승인했을 것" : "거절했을 것";
      setNotice({ tone: "ok", text: `${op.id} ${subjectOf(op)} — ${word}으로 기록함` });
      await load();
      draftsHead.current?.focus();
      return null;
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409 || err.status === 404) {
        setNotice({ tone: "error", text: `${op.id}: ${err.message} — 목록을 새로 불러옴` });
        await load();
        draftsHead.current?.focus();
        return null;
      }
      return err.message;
    }
  };

  // S1 ↔ S2 전환(SUPERVISOR). 켜기 전 점검 상태와 준비할 것을 확인 창에 보인다.
  const switchMode = async () => {
    if (!brief) return;
    const next: Mode = brief.mode === "shadow" ? "approval" : "shadow";
    const text =
      next === "approval"
        ? `S2(승인 운용)를 켤까요?\n\n켜면 승인한 SCHEDULE 작업을 OCC가 Linear에 씁니다(linear-guard가 입력을 비교).\nS2 진입 점검: 판정 ${brief.gate.decided}/${brief.gate.target.decided}건, 합의율 ${pct(brief.gate.agreement)} (기준 ${brief.gate.target.agreement * 100}%) — ${brief.gate.ready ? "충족" : "아직 미달"}\n준비: vocado CLAUDE.md의 "Linear에는 리더만 쓴다" 규칙 변경, Linear에 rating:SEC·UI·DATA·DOCS 라벨.`
        : "S1(그림자 운용)로 돌아갈까요? 이미 발부한 작업은 그대로 두고, 새로 발부하지 않습니다(linear-guard가 모든 쓰기를 막음).";
    if (!confirm(text)) return;
    try {
      await post("/api/schedule/mode", { mode: next });
      setNotice({ tone: "ok", text: `SCHEDULE 모드: ${next === "approval" ? "S2 승인 운용" : "S1 그림자 운용"}` });
      await load();
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  };

  if (!brief) return <p className="empty">{error ? `불러오지 못함: ${error}` : "불러오는 중…"}</p>;
  const { gate, flights } = brief;
  // FLIGHT 링크: brief에 있으면 그 주소, 없으면 아는 Linear 주소에서 키만 바꿔 만든다
  const base = Object.values(flights).map((f) => f.url?.match(/^https:\/\/linear\.app\/[^/]+\/issue\//)?.[0]).find(Boolean);
  const hrefOf = (key: string) => flights[key]?.url ?? (base ? `${base}${key}` : null);

  return (
    <ModeContext.Provider value={brief.mode}>
    <section className="schedule">
      <div className="toolbar">
        {brief.mode === "shadow" ? (
          <span className="muted">
            <span className="sc-mode">SHADOW</span> OCC S1 · OCC가 Linear에 쓸 변경을 초안으로 남긴다. 판정은 초안 품질을 재는 데만 쓰고{" "}
            <b className="sc-strong">Linear에는 아무것도 쓰지 않는다.</b> CLASSIFY·PRIORITIZE는 atc 신호에서, AD HOC FLIGHT 초안은
            SUPERVISOR가 OCC 세션에 낸 CHARTER REQUEST에서 나온다.
          </span>
        ) : (
          <span className="muted">
            <span className="sc-mode m-approval">APPROVAL</span> OCC S2 · <b className="sc-strong">승인한 작업은 OCC가 Linear에 쓴다.</b>{" "}
            atc가 쓸 내용(CALL)을 만들고, linear-guard가 그 입력과 한 글자도 다르지 않은 쓰기만 통과시킨다.
          </span>
        )}
        <button className="sc-btn sc-mode-switch" onClick={switchMode}>
          {brief.mode === "shadow" ? "S2 승인 운용 켜기" : "S1 그림자 운용으로"}
        </button>
      </div>
      {error && (
        <p className="sc-error" role="alert">
          새로 고침 실패: {error}
        </p>
      )}
      <p className={`sc-notice${notice ? ` t-${notice.tone}` : ""}`} role="status" aria-live="polite">
        {notice?.text}
      </p>

      <Gate gate={gate} judges={brief.judges} />

      {(brief.slips?.length ?? 0) > 0 && (
        <>
          <h2 className="label">
            LATE WAYPOINTS <em>ETA가 목표일을 넘거나 목표일이 지난 WAYPOINT — OCC가 새 경고를 한 번 보고한다. 자세한 것은 NETWORK 탭 ROUTE MAP</em>
          </h2>
          <ul className="sc-slips">
            {brief.slips!.map((x) => (
              <li key={x.key}>
                <span className={`sc-slip-code c-${x.code}`}>{slipCode[x.code]}</span>
                <span className="sc-slip-where">
                  {x.route} · <b>{x.waypoint}</b>
                </span>
                <span className="mono faint">
                  목표 {x.targetDate ?? "—"} · ETA {x.eta ?? "모름"}
                  {x.days != null && ` · ${x.days}일`}
                </span>
                <span className="faint">
                  {x.reportedAt ? (
                    <time dateTime={x.reportedAt} title={stamp(x.reportedAt, clock)}>
                      OCC 보고 {timeAgo(x.reportedAt, now)}
                    </time>
                  ) : (
                    "OCC 보고 전"
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="faint sc-slips-more">
            <a href="#network">NETWORK → ROUTE MAP</a>
          </p>
        </>
      )}

      <h2 className="label" ref={draftsHead} tabIndex={-1}>
        DRAFTS{" "}
        <em>
          열린 초안 {brief.open.length} / {brief.limit}
          {brief.open.length >= brief.limit && " · 가득 참 — 판정해야 OCC가 새 초안을 쓴다"}
        </em>
      </h2>
      {brief.open.length ? (
        <div className="sc-cards">
          {brief.open.map((op) =>
            op.kind === "NEW" ? (
              <NewCard key={op.id} op={op} flights={flights} hrefOf={hrefOf} now={now} clock={clock} onVerdict={verdict} />
            ) : isNetworkOp(op) ? (
              <NetworkCard key={op.id} op={op} changes={brief.changes[op.id] ?? []} now={now} clock={clock} onVerdict={verdict} />
            ) : (
              <DraftCard key={op.id} op={op} flight={flights[op.flight ?? ""]} changes={brief.changes[op.id] ?? []} now={now} clock={clock} onVerdict={verdict} />
            ),
          )}
        </div>
      ) : (
        <p className="empty">열린 초안 없음 — OCC가 아직 초안을 쓰지 않았거나 모두 판정했다.</p>
      )}

      {(brief.mode === "approval" || brief.inProgress.length > 0) && (
        <>
          <h2 className="label">
            IN PROGRESS <em>승인됨(APPROVED) → OCC가 발부(RELEASED) → Linear에 보이면 APPLIED</em>
          </h2>
          {brief.inProgress.length ? (
            <table className="sc-table">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">종류</th>
                  <th scope="col">FLIGHT</th>
                  <th scope="col">상태</th>
                  <th scope="col">바뀔 것</th>
                  <th scope="col">언제</th>
                </tr>
              </thead>
              <tbody>
                {brief.inProgress.map((op) => (
                  <tr key={op.id} className={`s-${op.status}`}>
                    <td className="sc-c-id mono" data-label="ID">{op.id}</td>
                    <td className={`sc-c-kind k-${op.kind}`} data-label="종류">{kindCode(op.kind)}</td>
                    <td className="sc-c-flight" data-label="FLIGHT">{subjectOf(op)}</td>
                    <td className="sc-c-status sc-result" data-label="상태">
                      {statusText[op.status]}
                      <span className="faint">
                        {op.kind === "CLOSE" ? " · SUPERVISOR가 Linear에서 Done" : op.status === "approved" ? " · 발부 대기" : ` · CALL ${op.calls?.length ?? 0}건, 반영 대기`}
                      </span>
                    </td>
                    <td className="sc-c-reason" data-label="바뀔 것">{(brief.changes[op.id] ?? []).join(" ") || "—"}</td>
                    <td className="sc-c-at faint" data-label="언제">
                      <time dateTime={op.statusAt} title={stamp(op.statusAt, clock)}>
                        {timeAgo(op.statusAt, now)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">진행 중인 작업 없음</p>
          )}
        </>
      )}

      {(brief.closeManual?.length ?? 0) > 0 && (
        <>
          <h2 className="label">
            LINEAR에서 직접 DONE <em>승인한 CLOSE — vocado 규칙상 OCC는 이슈 상태를 바꾸지 않는다. 닫으면 다음 새로 고침에서 빠진다</em>
          </h2>
          <ul className="sc-close-manual">
            {brief.closeManual!.map((op) => {
              const c = op.payload as ClosePayload;
              const f = flights[op.flight ?? ""];
              return (
                <li key={op.id}>
                  <span className="mono faint">{op.id}</span>
                  {f?.url ? (
                    <a className="mono sc-fn" href={f.url} target="_blank" rel="noreferrer" title={`${op.flight} — Linear에서 열기`}>
                      {flightNumber(op.flight ?? "")}
                    </a>
                  ) : (
                    <span className="mono sc-fn">{flightNumber(op.flight ?? "")}</span>
                  )}
                  <span className="sc-close-title">{f?.title ?? op.flight}</span>
                  <span className="faint">{f?.state ?? "?"} → Done</span>
                  <a className="mono" href={c.pr.url} target="_blank" rel="noreferrer">
                    PR {prName(c.pr)}
                  </a>
                  <span className="faint">{statusText[op.status]}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h2 className="label">
        CANDIDATES <em>계획 단계(Todo·Backlog)에서 OCC가 초안을 쓸 FLIGHT, CLOSE는 PR이 머지됐는데 열린 FLIGHT · 열린 초안이 있는 것은 뺌</em>
      </h2>
      <div className="sc-cands">
        <Candidates kind="CLASSIFY" note="type:·wake: 라벨이 없음" keys={brief.candidates.classify} flights={flights} />
        <Candidates kind="PRIORITIZE" note="우선순위가 없음" keys={brief.candidates.prioritize} flights={flights} />
        {brief.candidates.close && (
          <Candidates
            kind="CLOSE"
            note="LOGBOOK ARRIVED, Linear는 열림"
            keys={brief.candidates.close}
            flights={flights}
            metaOf={(k) => {
              const c = brief.close?.[k];
              return c ? `PR ${prName(c.pr)} · 머지 ${stamp(c.mergedAt, clock)} · ${c.link === "fixes" ? "Fixes" : "본문에 Fixes 없음"}` : null;
            }}
          />
        )}
      </div>

      <h2 className="label">
        RECENT <em>최근 7일 닫힌 초안</em>
      </h2>
      {brief.recent.length ? (
        <table className="sc-table">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">종류</th>
              <th scope="col">FLIGHT</th>
              <th scope="col">결과</th>
              <th scope="col">언제</th>
              <th scope="col">사유</th>
            </tr>
          </thead>
          <tbody>
            {brief.recent.map((op) => (
              <tr key={op.id} className={`s-${op.status}`}>
                <td className="sc-c-id mono" data-label="ID">{op.id}</td>
                <td className={`sc-c-kind k-${op.kind}`} data-label="종류">{kindCode(op.kind)}</td>
                <td className="sc-c-flight" data-label="FLIGHT">
                  {isNetworkOp(op) ? (
                    <span className="mono">{regOf(op)}</span>
                  ) : op.flight ? (
                    <span className="mono" title={flights[op.flight]?.title ?? op.flight}>
                      {flightNumber(op.flight)}
                    </span>
                  ) : (
                    <span className="sc-new-subject">{(op.payload as NewPayload).title}</span>
                  )}
                  <span className="sc-payload">{payloadText(op)}</span>
                </td>
                <td className="sc-c-status sc-result" data-label="결과">{statusText[op.status]}</td>
                <td className="sc-c-at faint" data-label="언제">
                  <time dateTime={op.statusAt} title={stamp(op.statusAt, clock)}>
                    {timeAgo(op.statusAt, now)}
                  </time>
                </td>
                <td className="sc-c-reason" data-label="사유">
                  {viaOf(op) === "crosscheck" && (
                    <span className="sc-via" title="CROSSCHECK에 동의 버튼 한 번으로 기록한 판정">
                      1-CLICK
                    </span>
                  )}
                  {op.verdictReason ?? <span className="faint">—</span>}
                  <CrosscheckMini m={markOf(op)} />
                  {brief.judges?.marks[op.id]?.map((m) => <JudgeMini key={m.family} m={m} />)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty">최근 7일 동안 닫힌 초안 없음</p>
      )}
    </section>
    </ModeContext.Provider>
  );
}

function Gate({ gate, judges }: { gate: Brief["gate"]; judges?: Judges }) {
  const enough = gate.decided >= gate.target.decided;
  const rateOk = gate.agreement !== null && gate.agreement >= gate.target.agreement;
  const rows = [
    {
      label: "판정한 초안",
      value: `${gate.decided} / ${gate.target.decided}`,
      target: `≥ ${gate.target.decided}건`,
      state: enough ? "pass" : "fail",
      fill: Math.min(1, gate.decided / gate.target.decided),
    },
    {
      label: `합의율 · 승인했을 것 ${gate.agreed} · 거절했을 것 ${gate.decided - gate.agreed}`,
      value: pct(gate.agreement),
      target: `≥ ${Math.round(gate.target.agreement * 100)}%`,
      state: gate.decided < 5 ? "insufficient" : rateOk ? "pass" : "fail",
      fill: gate.agreement ?? 0,
    },
  ] as const;
  const mark = { pass: "✓ 충족", fail: "✗ 미달", insufficient: "○ 데이터 부족" } as const;
  const xc = gate.crosscheck; // 옛 서버면 없음
  const one = xc?.oneClick;
  // 켜져 있거나 mark가 있는 판정 계열만(기본 off라 보통은 없음)
  const judgeRows = Object.entries(judges?.rate ?? {}).filter(([f, r]) => judges!.modes[f] !== "off" || r.marked > 0);
  return (
    <div className="sc-gate">
      <h2 className="label">
        STAGE S2 <em>승인 운용 진입 점검 · {gate.ready ? "준비됨" : "아직"}</em>
      </h2>
      <ul>
        {rows.map((r) => (
          <li key={r.label} className={`s-${r.state}`}>
            <span className="sc-gate-label">{r.label}</span>
            <span className="sc-gate-value">{r.value}</span>
            <span className="sc-gate-target">기준 {r.target}</span>
            <span className="sc-gate-state">{mark[r.state]}</span>
            <span className="sc-gate-bar" aria-hidden>
              <span style={{ width: `${r.fill * 100}%` }} />
            </span>
          </li>
        ))}
        {xc && (
          <li className="s-info sc-gate-xc">
            <span className="sc-gate-label">
              CROSSCHECK 일치 {xc.matched}/{xc.marked}
            </span>
            <span className="sc-gate-value">{pct(xc.rate)}</span>
            <span className="sc-gate-target">기준 없음</span>
            <span className="sc-gate-state">참고</span>
          </li>
        )}
        {xc &&
          byModelRows(xc.byModel).map(([id, r]) => (
            <li key={id} className="s-info sc-gate-xc-model" title={`CROSSCHECK 일치 · 모델 계열 ${id}${id === "unknown" ? " (모델 기록 전의 mark — ATFM 기준에 세지 않음)" : " (경로별 이름을 묶음 — 원래 이름은 칩에)"} · ${r.matched}/${r.marked}`}>
              <span className="sc-gate-label">
                <span className="sc-gate-xc-name">└ {modelLabel(id)}</span>
                <span className="sc-gate-xc-count">
                  {r.matched}/{r.marked}
                </span>
              </span>
              <span className="sc-gate-value">{pct(r.rate)}</span>
            </li>
          ))}
        {gate.network &&
          (["TARGET", "ROUTE"] as const)
            .filter((k) => gate.network![k].decided > 0)
            .map((k) => (
              <li key={k} className="s-info sc-gate-net" title={`${k} 초안의 그림자 판정 — S2 게이트와 CROSSCHECK 일치에 세지 않음`}>
                <span className="sc-gate-label">
                  {k} 판정 {gate.network![k].agreed}/{gate.network![k].decided}
                </span>
                <span className="sc-gate-value">{pct(gate.network![k].agreement)}</span>
                <span className="sc-gate-target">게이트와 따로</span>
                <span className="sc-gate-state">참고</span>
              </li>
            ))}
        {judgeRows.map(([f, r]) => (
          <li key={f} className="s-info sc-gate-judge" title={`판정 계열 ${f}의 CLASSIFY 분류가 SUPERVISOR 판정과 맞은 비율(replay 포함) — 게이트에 세지 않음. mark는 판정한 초안에만 보임`}>
            <span className="sc-gate-label">
              {f.toUpperCase()} 일치 {r.marked > 0 ? `${r.matched}/${r.marked}` : "— (아직 없음)"}
            </span>
            <span className="sc-gate-value">{pct(r.rate)}</span>
            <span className="sc-gate-target">게이트와 따로</span>
            <span className="sc-gate-state">{judges!.modes[f]}</span>
          </li>
        ))}
        {one && (
          <li className="s-info sc-gate-one" title={ONE_CLICK_NOTE}>
            <span className="sc-gate-label">한 번 클릭 {one.decided > 0 ? `${one.count}/${one.decided}` : "— (아직 없음)"}</span>
            <span className="sc-gate-value">{one.decided > 0 ? pct(one.count / one.decided) : "—"}</span>
            <span className="sc-gate-target">기준 없음</span>
            <span className="sc-gate-state">참고</span>
          </li>
        )}
      </ul>
      <p className="sc-gate-note faint">
        S1 그림자 운용: 판정은 합의율 측정용이다. S2(승인 운용)부터 승인한 초안만 linear-guard를 거쳐 Linear에 쓴다. 판정 없이 3일이 지나면 EXPIRED.
        {xc && " CROSSCHECK 일치는 참고용이다 — 게이트에는 사람 판정만 셈."}
        {one && ` 한 번 클릭: ${ONE_CLICK_NOTE}.`}
        {judgeRows.length > 0 && ` 판정 계열(${judgeRows.map(([f]) => f.toUpperCase()).join(", ")})은 CLASSIFY만 잰다. mark는 판정한 초안에만 보이고, 게이트와 초안 상태에는 영향이 없다${judges!.hidden ? ` (판정 전이라 숨긴 mark ${judges!.hidden}건)` : ""}.`}
      </p>
    </div>
  );
}

function DraftCard({
  op,
  flight,
  changes,
  now,
  clock,
  onVerdict,
}: {
  op: ScheduleOp;
  flight: FlightInfo | undefined;
  changes: string[];
  now: number;
  clock: Clock;
  onVerdict: OnVerdict;
}) {
  const v = useVerdict(op, onVerdict);
  const key = op.flight ?? "";
  const labels = flight?.labels ?? [];
  const clsDefault = Boolean(flight) && (!axisLabel(labels, "type") || !axisLabel(labels, "wake"));

  const titleId = `sc-${op.id}-title`;
  return (
    <article className={`sc-card k-${op.kind}`} aria-labelledby={titleId} aria-busy={v.busy}>
      <header className="sc-card-head">
        <span className="sc-kind">{op.kind}</span>
        <span className="mono faint">{op.id}</span>
        <time className="faint sc-age" dateTime={op.at} title={`초안 작성 ${stamp(op.at, clock)}`}>
          {timeAgo(op.at, now)}
        </time>
      </header>
      <h3 className="sc-flight" id={titleId}>
        {flight?.url ? (
          <a className="mono sc-fn" href={flight.url} target="_blank" rel="noreferrer" title={`${key} — Linear에서 열기`}>
            {flightNumber(key)}
          </a>
        ) : (
          <span className="mono sc-fn">{flightNumber(key)}</span>
        )}
        {flight && <PriorityMark priority={flight.priority} />}
        <span className="sc-title" title={flight?.title}>
          {flight?.title ?? "FLIGHT 정보 없음"}
        </span>
      </h3>

      <dl className="sc-facts">
        <dt>지금</dt>
        <dd>
          {op.kind === "CLASSIFY" ? (
            <span className={`sc-class${clsDefault ? " is-default" : ""}`} title="FLIGHT TYPE · WAKE · 필요한 TYPE RATING">
              {flight?.cls ?? "—"}
              {clsDefault && <span className="faint"> (기본값 — 라벨 없음)</span>}
            </span>
          ) : op.kind === "CLOSE" ? (
            <span>
              <a className="mono" href={(op.payload as ClosePayload).pr.url} target="_blank" rel="noreferrer">
                PR {prName((op.payload as ClosePayload).pr)}
              </a>{" "}
              머지 {stamp((op.payload as ClosePayload).mergedAt, clock)}
              {(op.payload as ClosePayload).partOf ? (
                <span className="sc-partof"> · Part of — 일부만</span>
              ) : (op.payload as ClosePayload).fixes ? (
                <span className="faint"> · Fixes</span>
              ) : (
                <span className="faint"> · 본문에 Fixes 없음</span>
              )}
            </span>
          ) : (
            <span>priority {flight ? PRIORITY_NAME[flight.priority] ?? "없음" : "—"}</span>
          )}
          {flight && <span className="faint"> · {flight.state}</span>}
        </dd>
        <dt>바뀜</dt>
        <dd>
          {changes.length ? (
            <ul className="sc-changes">
              {changes.map((c) => (
                <li key={c} className="sc-change">
                  {op.kind === "CLASSIFY" ? `+ ${c}` : c}
                </li>
              ))}
            </ul>
          ) : (
            <span className="faint">바뀔 것 없음 — 다음 새로 고침에서 SUPERSEDED</span>
          )}
        </dd>
        <dt>근거</dt>
        <dd className="sc-reason">{op.reason}</dd>
      </dl>

      {changes.length > 0 && <ManualHint op={op} changes={changes} labels={labels} />}

      <VerdictActions op={op} v={v} now={now} clock={clock} />
    </article>
  );
}

// TARGET·ROUTE 초안 카드: 지금 값, 바뀔 것, OCC 근거, atc가 초안을 쓸 때 붙인 숫자(NETWORK와 같은 계산)
function NetworkCard({ op, changes, now, clock, onVerdict }: { op: ScheduleOp; changes: string[]; now: number; clock: Clock; onVerdict: OnVerdict }) {
  const v = useVerdict(op, onVerdict);
  const titleId = `sc-${op.id}-title`;
  const target = op.kind === "TARGET" ? (op.payload as TargetPayload) : null;
  const route = op.kind === "ROUTE" ? (op.payload as RoutePayload) : null;
  const rows = (target ?? route)!.evidence.routes;
  return (
    <article className={`sc-card k-${op.kind}`} aria-labelledby={titleId} aria-busy={v.busy}>
      <header className="sc-card-head">
        <span className="sc-kind">{op.kind}</span>
        <span className="mono faint">{op.id}</span>
        <time className="faint sc-age" dateTime={op.at} title={`초안 작성 ${stamp(op.at, clock)}`}>
          {timeAgo(op.at, now)}
        </time>
      </header>
      <h3 className="sc-flight" id={titleId}>
        <a className="mono sc-fn" href="#fleet" title="FLEET 탭에서 보기">
          ✈ {regOf(op)}
        </a>
        <span className="sc-title">{target ? "TARGETS 변경" : "ROUTE 변경"}</span>
      </h3>

      <dl className="sc-facts">
        <dt>지금</dt>
        <dd>
          {target ? (
            <span className="mono">
              flightsPerWeek {num(target.from.flightsPerWeek)} · onTime {target.from.onTime == null ? "없음" : pct(target.from.onTime)}
            </span>
          ) : (
            <span>{route!.from.length ? route!.from.join(" · ") : "ROUTE 없음"}</span>
          )}
        </dd>
        <dt>바뀜</dt>
        <dd>
          {changes.length ? (
            <ul className="sc-changes">
              {changes.map((c) => (
                <li key={c} className="sc-change">
                  {c}
                </li>
              ))}
            </ul>
          ) : (
            <span className="faint">바뀔 것 없음 — 다음 새로 고침에서 SUPERSEDED</span>
          )}
        </dd>
        <dt>근거</dt>
        <dd className="sc-reason">{op.reason}</dd>
        <dt>숫자</dt>
        <dd className="sc-net-evidence">
          {target && (
            <p className="mono">
              14일 ARRIVED {target.evidence.arrived14} · 이번 주 {target.evidence.aircraft.actuals.weekDone} · 정시율 {pct(target.evidence.aircraft.actuals.onTimeRate)} · 주별{" "}
              {target.evidence.weekly.map((w) => w.arrived).join(" · ")}
            </p>
          )}
          {route && route.evidence.where.length > 0 && (
            <p>
              <span className="faint">14일 ARRIVED가 간 곳 </span>
              {route.evidence.where.map((w) => `${w.project ?? "AD HOC·모름"} ${w.arrived}`).join(" · ")}
            </p>
          )}
          {rows.length > 0 && (
            <ul className="sc-net-routes">
              {rows.map((r) => (
                <li key={r.project}>
                  <span>{r.project}</span>
                  <span className="mono faint">
                    대기 {r.open.todo} · 진행 {r.open.inProgress + r.open.inReview} · 14일 ARRIVED {r.arrived14}
                    {r.aircraft.length > 0 && ` · ${r.aircraft.join(" ")}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="faint">초안을 쓸 때 atc가 붙인 숫자(NETWORK 탭과 같은 계산)</p>
        </dd>
      </dl>

      <p className="sc-manual faint">
        그림자 판정만 — 승인해도 FLEET에 쓰지 않는다. 당장 바꾸려면 <a href="#fleet">FLEET 탭</a>에서 직접.
      </p>

      <VerdictActions op={op} v={v} now={now} clock={clock} />
    </article>
  );
}

type OnVerdict = (op: ScheduleOp, v: "agree" | "disagree", reason: string | null, via: Via) => Promise<string | null>;

// 카드 하나의 판정 상태(기록 중, 실패, 거절 사유 입력)
function useVerdict(op: ScheduleOp, onVerdict: OnVerdict) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const rejectBtn = useRef<HTMLButtonElement>(null);
  const submit = async (v: "agree" | "disagree", reason: string | null, via: Via = "manual") => {
    setBusy(true);
    setError(null);
    const err = await onVerdict(op, v, reason, via);
    // 성공하면 카드가 사라진다. 실패만 여기서 보인다.
    setBusy(false);
    if (err) setError(err);
  };
  const closeReject = () => {
    setRejecting(false);
    requestAnimationFrame(() => rejectBtn.current?.focus());
  };
  return { busy, error, rejecting, setRejecting, submit, closeReject, rejectBtn };
}

// 닫힌 초안에 남은 CROSSCHECK 표시(흐리게)
function CrosscheckMini({ m }: { m: Crosscheck | null }) {
  if (!m) return null;
  return (
    <span className={`sc-xc-mini v-${m.verdict}`} title={xcTitle(m)} aria-label={xcTitle(m)}>
      CROSSCHECK {m.verdict}
    </span>
  );
}

// 판정 계열 mark(판정한 초안에만): "JEV agree", 툴팁에 분류와 반출 범위
function JudgeMini({ m }: { m: JudgeMark }) {
  const title = `${m.family.toUpperCase()} ${m.verdict} · ${m.model} · ${m.run} — ${m.reason}${m.withheld ? ` · 본문 안 보냄(${m.withheld})` : ""}`;
  return (
    <span className={`sc-xc-mini sc-judge-mini v-${m.verdict}`} title={title} aria-label={title}>
      {m.family.toUpperCase()} {m.verdict}
    </span>
  );
}

// 열린 초안의 CROSSCHECK 칩: "CROSSCHECK agree · 사유"(길면 두 줄에서 자르고 전체는 title)
function CrosscheckChip({ m, now, clock }: { m: Crosscheck; now: number; clock: Clock }) {
  return (
    <p className={`sc-xc v-${m.verdict}`} title={`CROSSCHECK ${m.verdict} · ${modelText(modelOf(m))} · ${m.by} · ${stamp(m.at, clock)}\n${m.reason}`}>
      <span className="sc-xc-mark">CROSSCHECK</span>
      <b className="sc-xc-verdict">{m.verdict}</b>
      <span className="sc-xc-reason">· {m.reason}</span>
      {/* 어느 모델이 표시했는지: 시각 옆에 흐리게 */}
      <span className="sc-xc-meta">
        <span className="sc-xc-model" title={modelOf(m)}>
          {modelLabel(modelOf(m))}
        </span>
        <time className="sc-xc-at" dateTime={m.at}>
          {timeAgo(m.at, now)}
        </time>
      </span>
    </p>
  );
}

function VerdictActions({ op, v, now, clock }: { op: ScheduleOp; v: ReturnType<typeof useVerdict>; now: number; clock: Clock }) {
  const ctxMode = useContext(ModeContext);
  const mode = isNetworkOp(op) ? "shadow" : ctxMode; // TARGET·ROUTE는 S2에서도 그림자 판정
  const xc = markOf(op);
  // CROSSCHECK 판정을 그대로 기록한다. disagree면 CROSSCHECK 사유를 거절 사유로 쓴다.
  const word = xc?.verdict === "agree" ? (mode === "approval" ? "승인" : "승인했을 것") : mode === "approval" ? "거절" : "거절했을 것";
  return (
    <>
      {xc && <CrosscheckChip m={xc} now={now} clock={clock} />}
      {v.error && (
        <p className="sc-card-error" role="alert">
          기록하지 못함: {v.error}
        </p>
      )}
      {v.rejecting ? (
        <RejectForm op={op} busy={v.busy} onCancel={v.closeReject} onSubmit={(reason) => v.submit("disagree", reason)} />
      ) : (
        <div className="sc-actions">
          <button className="sc-btn agree" disabled={v.busy} onClick={() => v.submit("agree", null)}>
            {mode === "approval" ? "승인" : "승인했을 것"}
          </button>
          <button ref={v.rejectBtn} className="sc-btn disagree" disabled={v.busy} onClick={() => v.setRejecting(true)}>
            {mode === "approval" ? "거절…" : "거절했을 것…"}
          </button>
          {xc && (
            <button
              className={`sc-btn sc-xc-accept v-${xc.verdict}`}
              disabled={v.busy}
              title={`CROSSCHECK 판정(${xc.verdict})대로 ${word} 기록${xc.verdict === "disagree" ? " — 사유는 CROSSCHECK 사유" : ""}`}
              onClick={() => v.submit(xc.verdict, xc.verdict === "disagree" ? xc.reason : null, "crosscheck")}
            >
              CROSSCHECK에 동의
            </button>
          )}
        </div>
      )}
    </>
  );
}

// FLIGHT 키 링크(주소를 모르면 글자만)
function FlightLink({ k, hrefOf, title }: { k: string; hrefOf: (key: string) => string | null; title?: string }) {
  const href = hrefOf(k);
  return href ? (
    <a className="mono sc-key" href={href} target="_blank" rel="noreferrer" title={title ? `${k} ${title}` : `${k} — Linear에서 열기`}>
      {flightNumber(k)}
    </a>
  ) : (
    <span className="mono sc-key">{flightNumber(k)}</span>
  );
}

// NEW: CHARTER REQUEST로 만들 AD HOC FLIGHT 초안
function NewCard({
  op,
  flights,
  hrefOf,
  now,
  clock,
  onVerdict,
}: {
  op: ScheduleOp;
  flights: Record<string, FlightInfo>;
  hrefOf: (key: string) => string | null;
  now: number;
  clock: Clock;
  onVerdict: OnVerdict;
}) {
  const v = useVerdict(op, onVerdict);
  const p = op.payload as NewPayload;
  const labels = newLabels(p);
  const relations = [
    ...(p.parent ? [["parent", [p.parent]] as const] : []),
    ...(p.related?.length ? [["related", p.related] as const] : []),
    ...(p.blockedBy?.length ? [["blocked by", p.blockedBy] as const] : []),
  ];
  const lines = p.body.split("\n").length;
  const titleId = `sc-${op.id}-title`;
  return (
    <article className="sc-card k-NEW" aria-labelledby={titleId} aria-busy={v.busy}>
      <header className="sc-card-head">
        <span className="sc-kind">{kindCode(op.kind)}</span>
        <span className="mono faint">{op.id}</span>
        <time className="faint sc-age" dateTime={op.at} title={`초안 작성 ${stamp(op.at, clock)}`}>
          {timeAgo(op.at, now)}
        </time>
      </header>
      <h3 className="sc-flight" id={titleId}>
        <span className="sc-new-title">{p.title}</span>
        {p.priority ? <PriorityMark priority={p.priority} /> : null}
      </h3>

      <dl className="sc-facts">
        <dt>프로젝트</dt>
        <dd>{p.project}</dd>
        {p.milestone && (
          <>
            <dt>WAYPOINT</dt>
            <dd>
              {p.milestone.name}
              {p.gap && <span className="faint"> · 완료 기준에서 올린 초안(WAYPOINT gap)</span>}
            </dd>
          </>
        )}
        <dt>priority</dt>
        <dd>{p.priority ? PRIORITY_NAME[p.priority] : <span className="faint">없음</span>}</dd>
        <dt>라벨</dt>
        <dd>
          {labels.length ? (
            <ul className="sc-changes">
              {labels.map((l) => (
                <li key={l} className="sc-change">
                  {l}
                </li>
              ))}
            </ul>
          ) : (
            <span className="faint">없음 — 기본값 BUILD · M</span>
          )}
        </dd>
        {relations.length > 0 && (
          <>
            <dt>관계</dt>
            <dd>
              <ul className="sc-rels">
                {relations.map(([name, keys]) => (
                  <li key={name}>
                    <span className="faint">{name}</span>{" "}
                    {keys.map((k) => (
                      <FlightLink key={k} k={k} hrefOf={hrefOf} title={flights[k]?.title} />
                    ))}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt>비슷한</dt>
        <dd>
          {p.similar.length ? (
            <ul className="sc-similar">
              {p.similar.map((x) => (
                <li key={x.key}>
                  <FlightLink k={x.key} hrefOf={hrefOf} />
                  <span className="sc-similar-title">{x.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="faint">비슷한 FLIGHT 없음</span>
          )}
        </dd>
        <dt>근거</dt>
        <dd className="sc-reason">{op.reason}</dd>
      </dl>

      <details className="sc-body">
        <summary>본문 {lines}줄</summary>
        <pre className="sc-pre" tabIndex={0} aria-label={`${op.id} 본문`}>
          {p.body}
        </pre>
      </details>

      <div className="sc-hint">
        <span className="sc-hint-head">LINEAR 수동 반영</span>
        <span>Linear에 손으로 만들 때 이 제목·본문·라벨을 쓰세요.</span>
        <div className="sc-copy-row">
          <CopyButton label="제목 복사" text={p.title} />
          <CopyButton label="본문 복사" text={p.body} />
        </div>
        <span>
          프로젝트 <code>{p.project}</code>
          {p.milestone && (
            <>
              {" "}
              · 마일스톤 <code>{p.milestone.name}</code>
            </>
          )}
          {p.priority ? (
            <>
              {" "}
              · Priority <code>{PRIORITY_NAME[p.priority]}</code>
            </>
          ) : null}
          {labels.length > 0 && (
            <>
              {" "}
              · 라벨 {labels.map((l) => <code key={l} className="sc-hint-code">{l}</code>)}
            </>
          )}
        </span>
        <span className="faint sc-hint-note">SHADOW — atc는 Linear에 쓰지 않음. S2부터는 승인한 초안을 OCC가 Linear Todo에 만들어 FILED가 된다.</span>
      </div>

      <VerdictActions op={op} v={v} now={now} clock={clock} />
    </article>
  );
}

// 클립보드 복사. 못 쓰는 창이면 직접 선택하라고 알린다.
function CopyButton({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <span className="sc-copy">
      <button type="button" className="sc-btn sc-copy-btn" onClick={copy}>
        {label}
      </button>
      <span className={`sc-copy-state t-${state}`} role="status" aria-live="polite">
        {state === "ok" ? "복사함" : state === "fail" ? "복사 못 함 — 본문을 펼쳐 직접 선택하세요" : ""}
      </span>
    </span>
  );
}

// SUPERVISOR가 Linear에서 손으로 반영한다면 무엇을 누르는지. 그림자 운용이므로 atc는 쓰지 않는다.
function ManualHint({ op, changes, labels }: { op: ScheduleOp; changes: string[]; labels: string[] }) {
  if (op.kind === "CLOSE") {
    return (
      <div className="sc-hint">
        <span className="sc-hint-head">LINEAR 수동 반영</span>
        <span>
          {op.flight} → Status <code>Done</code>
        </span>
        <span className="faint sc-hint-note">CLOSE는 S2에서도 OCC가 쓰지 않음 — 승인하면 SUPERVISOR가 Linear에서 직접</span>
      </div>
    );
  }
  if (op.kind === "PRIORITIZE") {
    const to = PRIORITY_NAME[(op.payload as PrioritizePayload).priority];
    return (
      <div className="sc-hint">
        <span className="sc-hint-head">LINEAR 수동 반영</span>
        <span>
          {op.flight} → Priority <code>{to}</code>
        </span>
        <span className="faint sc-hint-note">atc는 Linear에 쓰지 않음 — 승인했을 것이어도 그대로 둔다</span>
      </div>
    );
  }
  return (
    <div className="sc-hint">
      <span className="sc-hint-head">LINEAR 수동 반영</span>
      <span>
        {op.flight} 라벨 추가{" "}
        {changes.map((c) => {
          const axis = c.startsWith("type:") ? "type" : c.startsWith("wake:") ? "wake" : null;
          const old = axis ? axisLabel(labels, axis) : null;
          return (
            <span key={c} className="sc-hint-label">
              <code>{c}</code>
              {old && <span className="faint"> ({old} 대신 — 그룹은 하나만)</span>}
            </span>
          );
        })}
      </span>
      <span className="faint sc-hint-note">atc는 Linear에 쓰지 않음 — 승인했을 것이어도 그대로 둔다</span>
    </div>
  );
}

function RejectForm({ op, busy, onCancel, onSubmit }: { op: ScheduleOp; busy: boolean; onCancel: () => void; onSubmit: (reason: string | null) => void }) {
  const [chip, setChip] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const reason = [chip, memo.trim()].filter(Boolean).join(" — ");
  const memoId = `sc-${op.id}-memo`;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <form
      className="sc-reject"
      onKeyDown={onKey}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit(reason || null);
      }}
    >
      <div className="sc-chips" role="group" aria-label={`${op.id} 거절 사유 고르기`}>
        {REJECT_REASONS[op.kind].map((r) => (
          <button type="button" key={r} className={`sc-chip${chip === r ? " is-on" : ""}`} aria-pressed={chip === r} onClick={() => setChip(chip === r ? null : r)}>
            {r}
          </button>
        ))}
      </div>
      <label className="sc-memo-label" htmlFor={memoId}>
        거절 사유 <span className="faint">(선택이지만 남겨 주세요 — OCC가 다음 초안에 반영)</span>
      </label>
      <input id={memoId} className="sc-input" value={memo} autoFocus maxLength={400} placeholder="예: 본문에 migration이 있어 rating:SEC 필요" onChange={(e) => setMemo(e.target.value)} />
      <div className="sc-actions">
        <button type="button" className="sc-btn" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="submit" className="sc-btn disagree is-confirm" disabled={busy}>
          {reason ? "거절했을 것 기록" : "사유 없이 거절 기록"}
        </button>
      </div>
    </form>
  );
}

function Candidates({
  kind,
  note,
  keys,
  flights,
  metaOf,
}: {
  kind: ScheduleOp["kind"];
  note: string;
  keys: string[];
  flights: Record<string, FlightInfo>;
  metaOf?: (key: string) => string | null;
}) {
  return (
    <div className={`sc-cand k-${kind}`}>
      <h3 className="sc-cand-head">
        <span className="sc-kind">{kind}</span>
        <b className="sc-cand-count">{keys.length}</b>
        <span className="faint">{note}</span>
      </h3>
      {keys.length ? (
        <ul className="sc-cand-list">
          {keys.map((k) => {
            const f = flights[k];
            return (
              <li key={k}>
                {f?.url ? (
                  <a className="mono sc-cand-fn" href={f.url} target="_blank" rel="noreferrer" title={`${k} — Linear에서 열기`}>
                    {flightNumber(k)}
                  </a>
                ) : (
                  <span className="mono sc-cand-fn">{flightNumber(k)}</span>
                )}
                <span className="sc-cand-title">
                  {f?.title ?? k}
                </span>
                {metaOf ? (
                  <span className="faint sc-cand-meta">{[f?.state, metaOf(k)].filter(Boolean).join(" · ")}</span>
                ) : (
                  f && <span className="faint sc-cand-meta">{kind === "CLASSIFY" ? f.cls : `priority ${PRIORITY_NAME[f.priority] ?? "없음"}`}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty">후보 없음</p>
      )}
    </div>
  );
}
