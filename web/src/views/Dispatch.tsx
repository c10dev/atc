import { nextLaunchLabel } from "../../../server/launch-note.ts";
import { createContext, Fragment, type KeyboardEvent, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ArrivalSuggestion } from "../../../server/standfree.ts";
import type { DispatchConfig, Plan } from "../../../server/dispatch.ts";
import type { Proposal } from "../../../server/proposals.ts";
import type { LaunchCap } from "../../../server/dispatch-launch.ts";
import type { Delivery } from "../../../server/session-origin.ts";
import { flightNumber } from "../aviation.ts";
import { OpenFlight } from "../FlightLink.tsx";
import { timeAgo } from "../derive.ts";
import { atfmAlertOf, dispatchLineParts } from "../readiness-line.ts";
import { PriorityMark } from "../ui.tsx";
import { useAlerts } from "../alerts-runtime.ts";
import { proposalAlertKey } from "../dispatch-alerts.ts";
import { AtfmAlert, AtfmPanel, useAtfm } from "./Atfm.tsx";
import { type ReadinessItem, Readiness2b } from "./Readiness2b.tsx";
import { BriefingLines, CardDetails, type CardBrief, FactsLine } from "./DispatchBriefing.tsx";
import { FollowingAlert, FollowingPanel, useFollowing } from "./Following.tsx";
import { ReadinessFold, useFoldOpen } from "./ReadinessFold.tsx";
import { BriefsPanel } from "./Briefs.tsx";
import "./Dispatch.css";

// 2단계 DISPATCH. shadow(2a): 제안은 화면에만 보이고 아무에게도 보내지 않는다.
// approval(2b): SUPERVISOR가 승인하면 OCC 세션(DISPATCH)이 FLIGHT PLAN을 CAPTAIN에게 보낸다.

interface FlightInfo {
  title: string;
  state: string;
  priority: number;
  project: string | null;
  url: string | null;
  cls?: string; // "BUILD · M · SEC" (docs/fleet.md 4장)
  clsDefault?: boolean; // 라벨이 없어 기본값으로 본 분류
  tails?: string[]; // TAIL ASSIGNMENT
}

// CROSSCHECK: 다른 모델(CROSSCHECK 세션)이 열린 제안에 남긴 임시 판정. 사람 판정을 대신하지 않는다.
interface Crosscheck {
  by: string;
  model?: string; // 표시한 모델 id. 옛 기록·옛 서버는 "unknown" 또는 없음
  verdict: "agree" | "disagree";
  reason: string;
  at: string;
  reasonCodes?: string[]; // disagree의 거절 사유 칩. 옛 mark·옛 서버는 없음
}
interface CrosscheckRate {
  marked: number;
  matched: number;
  rate: number | null;
}
// 판정 계열 Jev의 DISPATCH mark(ATC-88, server/proposals.ts judgesBriefOf). 닫힌 제안(RECENT)에만 온다 — 열린 카드는 쏠림을 막으려 숨긴다
interface JudgeRate {
  marked: number;
  matched: number;
  rate: number | null;
}
interface JudgeMark {
  family: string;
  model: string;
  run: string;
  ready: number;
  prerequisite: number;
  sameArea: { score: number; level: number; confidence: number | null } | null;
  withheld: string | null;
  recentWithheld: string | null;
  sent: string[];
}
interface Judges {
  mode: string;
  marks: Record<string, JudgeMark[]>;
  hidden: number;
  stats: { judged: number; ready: JudgeRate; prerequisite: JudgeRate; sameArea: JudgeRate };
}
// 서버 타입에 아직 없을 수 있어 따로 읽는다(옛 서버면 null)
const markOf = (p: Proposal): Crosscheck | null => (p as unknown as { crosscheck?: Crosscheck | null }).crosscheck ?? null;
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
// 거절 사유 코드(서버가 목록을 준다)
interface ReasonCode {
  code: string;
  label: string;
}
// 판정 기록. reasonCodes는 거절에만, reason은 자유 메모만(저장할 사유 문장은 서버가 만든다)
interface VerdictInput {
  via: Via;
  reasonCodes?: string[];
  reason: string | null;
}
// 서버 타입에 아직 없을 수 있어 따로 읽는다(옛 기록·옛 서버면 없음)
const viaOf = (p: Proposal): Via | null => (p as unknown as { via?: Via | null }).via ?? null;
const codesOf = (p: Proposal): string[] => (p as unknown as { reasonCodes?: string[] | null }).reasonCodes ?? [];
// PREFLIGHT 줄 설명(툴팁)
const PREFLIGHT_NOTE =
  "HELD: CROSSCHECK FLIGHT 칩이나 OCC HOLD로 판정 전에 빠진 제안(대기열로 돌렸거나 확정했어도 셈). 판정 건수·합의율에는 넣지 않는다. 준비율: HOLD 없이 판정까지 가서 준비 안 됨 거절이 아닌 제안 ÷ (그것 + HELD + 준비 안 됨 거절) — 티켓 공급 품질";
// 준비 안 됨 거절 줄 설명(툴팁)
const NOT_READY_NOTE =
  "사유 칩이 모두 FLIGHT 칩(이미 완료됨·상위 이슈·선행 대기·사람 결정·우선순위 미정·저장소 밖)인 거절. 팀 선택이 아니라 티켓 문제라 판정 건수·합의율에서 뺀다. AIRCRAFT 부적합·기타·칩 없음이 섞이면 게이트에 센다";
// 한 번 클릭 비율 설명(툴팁·안내 문장)
const BLIND_NOTE =
  "blind 표본(카드의 약 1/5, 제안 ID로 정함)에서 CROSSCHECK를 보지 않고 낸 판정의 합의율. 전체 합의율보다 크게 낮으면 한 번 클릭을 기본값처럼 따르고 있다는 뜻(anchoring 점검)";
const ONE_CLICK_NOTE = "사람 판정 가운데 CROSSCHECK에 동의 버튼 한 번으로 낸 비율 — 어떻게 판정했는지 기록된 판정만 셈. blind 카드 판정은 한 번 클릭이 막혀 있어 뺀다";

// SUPERVISOR CONFIRM AT AIRCRAFT(ATC-120, server/supervisor-confirm.ts confirmViewOf). 승인을 막지 않는다. 옛 서버면 없음
interface ConfirmView {
  paths: string[];
  line: string; // SUPERVISOR가 그 AIRCRAFT 세션에 붙여 넣을 한 줄
  open: string; // 그 세션을 여는 법
}

interface Brief {
  mode: DispatchConfig["mode"];
  at: string;
  plan: Plan;
  open: Proposal[];
  held: Proposal[];
  waiting?: Record<string, string>; // /clear 뒤 첫 메시지를 기다리는 AIRCRAFT의 제안 id → 글(ATC-91), LAUNCH 뒤 새 세션 대기(ATC-129). 옛 서버면 없음
  launch?: Record<string, string>; // launch 카드 id → "LAUNCH on approve" 또는 상한 대기 글(ATC-129). 옛 서버면 없음
  launchCap?: LaunchCap; // 백그라운드 세션 + 승인된 LAUNCH / ATC_MAX_LAUNCHED(ATC-129). 옛 서버면 없음
  briefs?: Record<string, CardBrief>; // 열린·HELD 카드의 사실 줄과 본문 첫 문장(옛 서버면 없음)
  inFlight: Proposal[];
  confirm?: Record<string, ConfirmView>; // 제안 id → SUPERVISOR CONFIRM 표시(ATC-120)
  delivery?: Record<string, Delivery>; // 2b 전달(ATC-76): AIRCRAFT 세션 이름 → 출처·permission mode·OCC mode. 옛 서버면 없음
  arrivalCandidates?: ArrivalSuggestion[]; // STAND 없는 FLIGHT의 ARRIVED 후보(ATC-72). 옛 서버면 없음
  overdue: string[];
  recent: Proposal[];
  judges?: Judges; // 판정 계열(ATC-88). 옛 서버면 없음
  flights: Record<string, FlightInfo>;
  gate: {
    decided: number;
    agreed: number;
    agreement: number | null;
    target: { decided: number; agreement: number };
    ready: boolean;
    // 참고용, 게이트 기준 아님. byModel·oneClick은 옛 서버면 없음
    crosscheck?: CrosscheckRate & { byModel?: Record<string, CrosscheckRate>; oneClick?: { count: number; decided: number } };
    blind?: { decided: number; agreed: number; agreement: number | null }; // blind 표본 합의율(옛 서버면 없음)
    reasonCounts?: Record<string, number>; // 거절 사유 코드별 건수(옛 서버면 없음)
    // PREFLIGHT(게이트 밖): HOLD된 제안 수와 준비율(옛 서버면 없음)
    preflight?: { held: number; holding: number; passed: number; notReady?: number; readyRate: number | null };
    notReady?: number; // 준비 안 됨 거절(칩이 모두 FLIGHT 칩): 게이트에서 뺀 판정 수(옛 서버면 없음)
  };
  gate3: {
    dispatched: number;
    readBack: number;
    departed: number;
    declined: number;
    readbackRate: number | null;
    readbackMedianMin: number | null;
    departedRate: number | null;
    target: { dispatched: number; readback: number; departed: number };
    ready: boolean;
    standFree?: { readBack: number; arrived: number; timely?: { within: number; total: number; rate: number | null } | null }; // STAND 없는 FLIGHT: 표시만(옛 서버면 없음)
  };
  config: DispatchConfig;
  readiness2b?: { items: ReadinessItem[] }; // 2b 켜기 점검표(옛 서버면 없음)
  reasonCodes?: ReasonCode[]; // 거절 사유 칩 목록(옛 서버면 없음)
  reasonStats?: ReasonStat[]; // 거절 사유별 건수·예시·planner가 거르나(옛 서버면 없음)
}

interface ReasonStat {
  code: string;
  label: string;
  count: number;
  examples: string[];
  auto: "auto" | "partial" | "manual";
  how: string;
}

const AUTO_TEXT: Record<ReasonStat["auto"], string> = { auto: "자동 거름", partial: "일부 거름", manual: "사람만" };

// arrived는 옛 서버 타입에 없을 수 있어 따로 더한다
const statusText: Record<Proposal["status"] | "arrived", string> = {
  proposed: "PROPOSED",
  agreed: "승인했을 것",
  disagreed: "거절했을 것",
  approved: "APPROVED",
  rejected: "REJECTED",
  sent: "SENT · READBACK 대기",
  accepted: "READBACK",
  declined: "DECLINED · UNABLE",
  departed: "DEPARTED",
  arrived: "ARRIVED",
  superseded: "SUPERSEDED",
  expired: "EXPIRED",
  recalling: "RECALL 중",
  recalled: "RECALLED",
};

// STAND 없는 FLIGHT(SURVEY·CHECK)의 흐름: READBACK에서 바로 DEPARTED(departedVia "readback"), ARRIVED는 OCC가 기록.
// 서버 타입에 아직 없을 수 있어 따로 읽는다(옛 서버·옛 기록이면 없음)
interface Lifecycle {
  departedVia?: "readback" | "stand" | null;
  arrivedNote?: string | null; // CAPTAIN이 남긴 보고 한 줄 또는 링크
  arrivedUrl?: string | null; // 보고 안 첫 http(s) 링크
}
const lifeOf = (p: Proposal) => p as unknown as Lifecycle;
// SETTLED(ATC-117): 열린·HELD 제안에 서버가 붙인다. settled가 false면 OCC가 아직 메모·BRIEFING을 달지 않는다(옛 서버는 필드가 없음 → 대기 표시 없음)
const settleOf = (p: Proposal) => p as unknown as { settled?: boolean; settlesInMin?: number };
const waitText = (p: Proposal) => `메모 대기 (${settleOf(p).settlesInMin ?? 0}분 뒤)`;
const standFreeDeparted = (p: Proposal) => p.status === "departed" && !p.departedStand && lifeOf(p).departedVia === "readback";

// RECALL은 보냈거나(sent) READBACK 받은(accepted) FLIGHT PLAN, 그리고 STAND 없이 DEPARTED한 것에만
const canRecall = (p: Proposal) => p.status === "sent" || p.status === "accepted" || standFreeDeparted(p);
const RECALL_MAX = 300;
// 늦음 표시: 상태마다 무엇을 기다리는지
const overdueText = (p: Proposal) =>
  p.status === "recalling" ? "RECALL READBACK 없음 10분+" : p.status === "sent" ? "NO READBACK" : p.status === "departed" ? "NO ARRIVAL 24h+" : "NO DEPARTURE";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// 2b 전달(ATC-76): 카드·IN FLIGHT 줄이 AIRCRAFT의 permission mode 경고를 읽는다
// LAUNCH ACCOUNT(AIRCRAFT용, ATC-257): launch 카드를 승인하면 이 ACCOUNT로 뜬다. 없으면 각 home
const LaunchAcctCtx = createContext<string | null>(null);
const DeliveryCtx = createContext<Record<string, Delivery>>({});
function DeliveryWarn({ aircraft }: { aircraft: string | null | undefined }) {
  const d = useContext(DeliveryCtx)[aircraft ?? ""];
  if (!d?.warn) return null;
  return (
    <span className="dp-delivery mono" title={d.warn.title}>
      {d.warn.label}
    </span>
  );
}

// SUPERVISOR CONFIRM(ATC-120): 카드·IN FLIGHT 줄이 표시를 읽는다
const ConfirmCtx = createContext<Record<string, ConfirmView>>({});

// 이 AIRCRAFT가 SUPERVISOR의 go를 세션 안에서 직접 묻는다는 표시와 붙여 넣을 한 줄. atc는 그 go를 대신 보내지 않는다
function SupervisorConfirm({ id }: { id: string }) {
  const v = useContext(ConfirmCtx)[id];
  const [copied, setCopied] = useState(false);
  if (!v) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(v.line);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 복사가 막힌 환경: 아래 글을 직접 고른다
    }
  };
  return (
    <div className="dp-confirm" role="group" aria-label={`${id} SUPERVISOR CONFIRM AT AIRCRAFT`}>
      <p className="dp-confirm-head">
        <span className="dp-confirm-mark">SUPERVISOR CONFIRM AT AIRCRAFT</span>
        <span className="dp-confirm-note">승인은 그대로 됩니다. AIRCRAFT가 이 파일 앞에서 직접 묻습니다.</span>
      </p>
      <ul className="dp-confirm-paths mono" aria-label="사용자 등급 예측 경로">
        {v.paths.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <div className="dp-confirm-paste">
        <code className="dp-confirm-line mono">{v.line}</code>
        <button type="button" className="dp-btn dp-confirm-copy" onClick={copy} aria-label={`${id}의 붙여 넣을 한 줄 복사`}>
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
      <p className="dp-confirm-open faint">{v.open}</p>
    </div>
  );
}

export function Dispatch({ refreshKey, now }: { refreshKey: string; now: number }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 판정을 보내는 중인 제안(두 번 누름 방지)
  const atfm = useAtfm(refreshKey);
  const following = useFollowing(refreshKey);
  const [foldOpen, setFoldOpen] = useFoldOpen("dispatch");
  const [launchAcct, setLaunchAcct] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/fleet/launch-accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setLaunchAcct(d?.launchAccount?.aircraft ?? null))
      .catch(() => alive && setLaunchAcct(null));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dispatch/brief");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBrief(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  // 제안은 스냅샷을 바꾸지 않고 5분 주기로 생기므로, 제안 알림(pending|proposal|)이 늘거나 줄 때도 다시 읽는다(ATC-212)
  const proposalKey = proposalAlertKey(useAlerts().items);
  useEffect(() => {
    load();
  }, [load, refreshKey, proposalKey]);

  // CROSSCHECK 판정을 그대로 기록한다(한 번 클릭). disagree면 CROSSCHECK 사유와 사유 칩(reasonCodes)을 거절 사유로 쓴다.
  // 칩이 없는 옛 mark는 칩 없이(사유 문장에서 추정하지 않는다)
  const acceptCrosscheck = (p: Proposal, m: Crosscheck) =>
    submit(p, m.verdict, { via: "crosscheck", reason: m.verdict === "disagree" ? m.reason : null, ...(m.verdict === "disagree" && m.reasonCodes?.length ? { reasonCodes: m.reasonCodes } : {}) });

  // shadow: 그림자 판정(verdict), approval: 실제 승인·거절. 성공하면 true
  const submit = async (p: Proposal, v: "agree" | "disagree", input: VerdictInput) => {
    const sc = brief?.confirm?.[p.id];
    const scText = sc ? `\n\nSUPERVISOR CONFIRM AT AIRCRAFT — ${sc.paths.join(", ")}\n${p.aircraftName}가 이 파일을 고치기 전에 세션에서 직접 SUPERVISOR의 go를 묻습니다. 승인은 막히지 않습니다. 그때 붙여 넣을 한 줄:\n${sc.line}\n(${sc.open})` : "";
    const ask = p.launch
      ? `${p.id}를 승인하면 atc가 세션이 없는 ${p.aircraftName}를 LAUNCH하고, 새 세션이 뜬 뒤 DISPATCH가 FLIGHT PLAN을 보냅니다${p.resume ? "(RESUME — 끊긴 FLIGHT를 이어서)" : ""}.${scText}\n\n승인할까요?`
      : `${p.id}를 승인하면 DISPATCH가 ${p.aircraftName}에게 FLIGHT PLAN을 보냅니다.${scText}\n\n승인할까요?`;
    if (v === "agree" && brief?.mode === "approval" && p.kind === "ASSIGN" && !confirm(ask)) return false;
    const payload = { via: input.via, reason: input.reason, ...(v === "disagree" && input.reasonCodes ? { reasonCodes: input.reasonCodes } : {}) };
    setBusy(p.id);
    try {
      if (brief?.mode === "approval") await post(`/api/dispatch/proposals/${p.id}/${v === "agree" ? "approve" : "reject"}`, payload);
      else await post(`/api/dispatch/proposals/${p.id}/verdict`, { verdict: v, ...payload });
      await load();
      return true;
    } catch (e) {
      // launch 카드는 LAUNCH가 실패하면 서버가 카드를 닫는다(ATC-129). 다시 읽어 RECENT로 옮기고 오류는 남긴다
      if (p.launch) await load();
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  // SUPERVISOR가 FLIGHT PLAN을 거둬들인다(RECALL). OCC가 CAPTAIN에게 RECALL 문구를 보내고 READBACK을 기다린다. 성공하면 true
  const recall = async (p: Proposal, reason: string) => {
    const how =
      brief?.mode === "approval"
        ? `OCC가 ${p.aircraftName}의 CAPTAIN에게 RECALL 문구를 보내고, CAPTAIN은 작업을 멈추고 ${p.departedStand === null && p.status === "departed" ? "그때까지의 결과를 남깁니다" : "STAND를 그대로 둡니다"}.`
        : `지금은 2a라 OCC가 보내지 않습니다 — ${p.aircraftName}의 CAPTAIN에게 직접 알리세요. CAPTAIN은 작업을 멈추고 ${p.departedStand === null && p.status === "departed" ? "그때까지의 결과를 남깁니다" : "STAND를 그대로 둡니다"}.`;
    if (!confirm(`${p.id}(${flightNumber(p.flight)})를 RECALL할까요?\n\n${how}\nCAPTAIN이 RECALL을 READBACK하면 ${flightNumber(p.flight)}는 다시 후보가 됩니다.\n\n사유: ${reason}`)) return false;
    setBusy(p.id);
    try {
      await post(`/api/dispatch/proposals/${p.id}/recall`, { reason });
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  // SUPERVISOR가 승인됐지만 아직 안 보낸 카드를 닫는다(ATC-272). 확인 단계는 카드 안(InFlightRow)에서 거친다. 성공하면 true
  const cancel = async (p: Proposal) => {
    setBusy(p.id);
    try {
      await post(`/api/dispatch/proposals/${p.id}/cancel`, {});
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      await load();
      return false;
    } finally {
      setBusy(null);
    }
  };

  // HELD(PREFLIGHT) 한 번 클릭: 대기열로(같은 제안을 판정 대기로) | FLIGHT 보류 확정(모든 AIRCRAFT에서 24시간, 이슈가 바뀌면 풀림)
  const heldAction = async (p: Proposal, action: "requeue" | "confirm-hold") => {
    setBusy(p.id);
    setError(null);
    try {
      await post(`/api/dispatch/proposals/${p.id}/${action}`, {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const switchMode = async () => {
    if (!brief) return;
    const next = brief.mode === "shadow" ? "approval" : "shadow";
    const text =
      next === "approval"
        ? `2b(승인 운용)를 켤까요?\n\n켜면 승인한 제안이 OCC 세션을 거쳐 CAPTAIN(팀 세션)에게 FLIGHT PLAN으로 나갑니다.\n2b 진입 점검: 판정 ${brief.gate.decided}/${brief.gate.target.decided}건, 합의율 ${pct(brief.gate.agreement)} (기준 ${brief.gate.target.agreement * 100}%) — ${brief.gate.ready ? "충족" : "아직 미달"}\n팀 세션의 CLAUDE.md에 [DISPATCH D-xxxx] READBACK 규칙이 있는지도 확인하세요.`
        : "2a(그림자 운용)로 돌아갈까요? 이미 보낸 FLIGHT PLAN은 그대로 두고, 새로 보내지는 않습니다.";
    if (!confirm(text)) return;
    try {
      await post("/api/dispatch/mode", { mode: next });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // 예외의 "전체 FLIGHT FOLLOWING" 링크: READINESS를 펴고 그 패널로 스크롤
  const openFollowing = () => {
    setFoldOpen(true);
    requestAnimationFrame(() => document.getElementById("ff-title")?.scrollIntoView({ block: "start" }));
  };

  if (!brief) return <p className="empty">{error ? `불러오지 못함: ${error}` : "불러오는 중…"}</p>;
  const { plan, gate, flights } = brief;
  const codes = brief.reasonCodes ?? [];
  const labelOf = (code: string) => codes.find((c) => c.code === code)?.label ?? code;
  // CROSSCHECK가 아직 안 본 제안은 뒤로(PREFLIGHT 거름이 돌기 전에 판정하지 않게). 안정 정렬이라 나머지 순서는 서버 그대로
  const byMarked = (a: Proposal, b: Proposal) => Number(!markOf(a)) - Number(!markOf(b));
  const assign = brief.open.filter((p) => p.kind === "ASSIGN").sort(byMarked);
  const isBlindCard = (p: Proposal) => Boolean(brief.briefs?.[p.id]?.blind);
  // 동의 묶음(ATC-6): CROSSCHECK가 agree한 열린 ASSIGN(blind 제외)은 맨 위에 한 줄씩. 나머지는 펼친 카드로
  const agreeLane = assign.filter((p) => !isBlindCard(p) && markOf(p)?.verdict === "agree");
  const expanded = assign.filter((p) => !agreeLane.includes(p));
  const release = brief.open.filter((p) => p.kind === "RELEASE").sort(byMarked);

  return (
    <LaunchAcctCtx.Provider value={launchAcct}>
    <DeliveryCtx.Provider value={brief.delivery ?? {}}>
    <ConfirmCtx.Provider value={brief.confirm ?? {}}>
    <section className="dispatch">
      <div className="toolbar">
        <span className="muted">
          <span className={`dp-mode m-${brief.mode}`}>{brief.mode === "shadow" ? "SHADOW" : "APPROVAL"}</span> 5분마다 계획
          {brief.mode === "shadow" ? " · 아무에게도 보내지 않음" : " · 승인한 제안은 CAPTAIN에게 FLIGHT PLAN으로 나감"} · 계산 {timeAgo(brief.at, now)}
        </span>
        <button className={`dp-btn dp-mode-switch${brief.mode === "shadow" ? "" : " back"}`} onClick={switchMode}>
          {brief.mode === "shadow" ? "2b 승인 운용 켜기" : "2a 그림자 운용으로"}
        </button>
      </div>
      {error && (
        <p className="dp-error" role="alert">
          {error}
        </p>
      )}

      <AtfmAlert atfm={atfm} now={now} />
      <FollowingAlert brief={following} now={now} onOpenFull={openFollowing} />

      <div className="dp-slots" aria-label="슬롯">
        {plan.slots.map((s) => (
          <span key={s.airport} className="dp-slot">
            <b>{s.airport}</b> AIRBORNE {s.airborne} + 계획 {s.planned} / {s.limit}
          </span>
        ))}
        <span className="dp-slot">
          열린 ASSIGN {assign.length} / {brief.config.slots.openProposals}
        </span>
        <span className="dp-slot">
          열린 RELEASE {release.length} / {brief.config.slots.openReleases}
        </span>
        {brief.launchCap && (brief.launchCap.pending > 0 || brief.launchCap.full) && (
          <span
            className={`dp-slot${brief.launchCap.full ? " is-full" : ""}`}
            title={`LAUNCH 상한(ATC_MAX_LAUNCHED): 살아 있는 백그라운드 세션 ${brief.launchCap.launched} + 승인됐지만 아직 세션이 없는 LAUNCH ${brief.launchCap.pending}${brief.launchCap.full ? " — 찼다. 자리가 나면 launch 카드를 승인한다" : ""}`}
          >
            <b>LAUNCH</b> {brief.launchCap.launched + brief.launchCap.pending} / {brief.launchCap.max}
          </span>
        )}
      </div>

      <h2 className="label">
        ASSIGN <em>FLIGHT → AIRCRAFT</em>
      </h2>
      {agreeLane.length > 0 && (
        <AgreeLane
          items={agreeLane}
          mode={brief.mode}
          busy={busy}
          onAgree={(p) => acceptCrosscheck(p, markOf(p)!)}
          renderCard={(p) => (
            <Card p={p} flight={flights[p.flight]} info={brief.briefs?.[p.id]} waiting={brief.waiting?.[p.id]} launch={brief.launch?.[p.id]} now={now} onVerdict={submit} onAccept={acceptCrosscheck} codes={codes} mode={brief.mode} busy={busy === p.id} />
          )}
          flights={flights}
        />
      )}
      {expanded.length ? (
        <div className="dp-cards">
          {expanded.map((p) => (
            <Card key={p.id} p={p} flight={flights[p.flight]} info={brief.briefs?.[p.id]} waiting={brief.waiting?.[p.id]} launch={brief.launch?.[p.id]} now={now} onVerdict={submit} onAccept={acceptCrosscheck} codes={codes} mode={brief.mode} busy={busy === p.id} />
          ))}
        </div>
      ) : agreeLane.length ? null : (
        <p className="empty">열린 ASSIGN 제안 없음 — 배정할 수 있는 AIRCRAFT나 FLIGHT가 없거나 슬롯이 찼다.</p>
      )}

      {brief.held.length > 0 && (
        <>
          <h2 className="label">
            HELD <em>PREFLIGHT — 아직 시작할 상태가 아님(CROSSCHECK FLIGHT 칩 · OCC HOLD). 판정하지 않고 대기열로 돌리거나 확정</em>
          </h2>
          <div className="dp-cards">
            {brief.held.map((p) => (
              <Card key={p.id} p={p} flight={flights[p.flight]} info={brief.briefs?.[p.id]} waiting={brief.waiting?.[p.id]} launch={brief.launch?.[p.id]} now={now} onVerdict={submit} onHeld={heldAction} codes={codes} mode={brief.mode} held busy={busy === p.id} />
            ))}
          </div>
        </>
      )}

      <h2 className="label">
        RELEASE <em>STAND 없이 {brief.config.releaseDays}일 넘게 ENROUTE</em>
      </h2>
      {release.length ? (
        <div className="dp-cards">
          {release.map((p) => (
            <Card key={p.id} p={p} flight={flights[p.flight]} info={brief.briefs?.[p.id]} waiting={brief.waiting?.[p.id]} launch={brief.launch?.[p.id]} now={now} onVerdict={submit} onAccept={acceptCrosscheck} codes={codes} mode={brief.mode} busy={busy === p.id} />
          ))}
        </div>
      ) : (
        <p className="empty">열린 RELEASE 제안 없음</p>
      )}

      {brief.inFlight.length > 0 && (
        <>
          <h2 className="label">
            IN FLIGHT <em>승인 뒤 진행 중</em>
          </h2>
          <table className="dp-table dp-inflight">
            <thead>
              <tr>
                <th>ID</th>
                <th>FLIGHT</th>
                <th>AIRCRAFT</th>
                <th>상태</th>
                <th>언제부터</th>
                <th>
                  <span className="dp-sr">조치</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {brief.inFlight.map((p) => (
                <InFlightRow key={p.id} p={p} flight={flights[p.flight]} waiting={brief.waiting?.[p.id]} now={now} overdue={brief.overdue.includes(p.id)} mode={brief.mode} busy={busy === p.id} onRecall={recall} onCancel={cancel} candidate={(brief.arrivalCandidates ?? []).find((c) => c.proposal === p.id)} />
              ))}
            </tbody>
          </table>
        </>
      )}
      <DirectCandidates candidates={(brief.arrivalCandidates ?? []).filter((c) => !c.proposal)} now={now} />

      <div className="dp-grid">
        <div>
          <h2 className="label">AIRCRAFT</h2>
          <ul className="dp-list">
            {[...plan.aircraft].sort((a, b) => Number(b.available && !b.reserved) - Number(a.available && !a.reserved) || a.callsign.localeCompare(b.callsign)).map((a) => (
              <li key={a.id} className={a.available && !a.reserved ? "is-available" : ""}>
                <b>{a.callsign}</b> <span className="faint">{a.name}</span>
                <span className="dp-list-note">{a.reserved ? `진행 중인 제안 ${a.reserved}` : a.available ? `가능 · ${a.reason}` : a.reason}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="label">HOLD_DEPARTURE · 제외</h2>
          <ul className="dp-list">
            {plan.hold.map((h) => (
              <li key={h.flight}>
                <b><OpenFlight k={h.flight} /></b>
                <span className="dp-list-note">HOLD_DEPARTURE — {h.why ?? `${h.blockedBy.map(flightNumber).join(", ")}에 막힘`}</span>
              </li>
            ))}
            {(plan.overlapHolds ?? []).filter((h) => !h.enforced).map((h) => (
              <li key={`ov-${h.flight}`}>
                <b><OpenFlight k={h.flight} /></b>
                <span className="dp-list-note">shadow — {h.why} (파일 겹침 HOLD 꺼짐, 켜면 대기)</span>
              </li>
            ))}
            {plan.excluded.map((e) => (
              <li key={e.flight}>
                <b><OpenFlight k={e.flight} /></b>
                <span className="dp-list-note">{e.reason}</span>
              </li>
            ))}
            {!plan.hold.length && !plan.excluded.length && !(plan.overlapHolds ?? []).some((h) => !h.enforced) && <li className="faint">없음</li>}
          </ul>
        </div>
      </div>

      <h2 className="label">
        RECENT <em>최근 7일</em>
      </h2>
      {brief.recent.length ? (
        <table className="dp-table dp-recent">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">종류</th>
              <th scope="col">FLIGHT</th>
              <th scope="col">AIRCRAFT</th>
              <th scope="col">결과</th>
              <th scope="col">사유</th>
              <th scope="col">언제</th>
            </tr>
          </thead>
          <tbody>
            {brief.recent.map((p) => (
              <tr key={p.id} className={`s-${p.status}`}>
                <td className="dp-c-id mono">{p.id}</td>
                <td className="dp-c-kind mono">{p.kind}</td>
                <td className="dp-c-flight mono"><OpenFlight k={p.flight} /></td>
                <td className="dp-c-air">{p.aircraftName ?? "—"}</td>
                <td className="dp-c-result dp-result">
                  <StatusLabel p={p} />
                </td>
                <td className="dp-c-reason dp-reason" data-label="사유">
                  <RecentReason p={p} labelOf={labelOf} />
                  <CrosscheckMini m={markOf(p)} />
                  {brief.judges?.marks[p.id]?.map((m) => <JudgeMini key={m.family} m={m} />)}
                </td>
                <td className="dp-c-at faint">{timeAgo(p.statusAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty">아직 결정된 제안 없음</p>
      )}

      <ReadinessFold id="dp-readiness" open={foldOpen} onOpenChange={setFoldOpen} parts={dispatchLineParts(brief)}>
        {brief.readiness2b?.items?.length ? <Readiness2b items={brief.readiness2b.items} mode={brief.mode} /> : null}
        <Gate gate={gate} labelOf={labelOf} stats={brief.reasonStats} judges={brief.judges} />
        {(brief.mode === "approval" || brief.gate3.dispatched > 0) && <Gate3 gate={brief.gate3} />}
        <AtfmPanel atfm={atfm} now={now} alertShown={atfmAlertOf(atfm.brief).active} />
        <FollowingPanel brief={following} now={now} />
        <BriefsPanel refreshKey={refreshKey} />

      </ReadinessFold>

    </section>
    </ConfirmCtx.Provider>
    </DeliveryCtx.Provider>
    </LaunchAcctCtx.Provider>
  );
}

// IN FLIGHT 한 줄. sent·accepted면 RECALL… 버튼, 누르면 아래 줄에 사유 폼이 열린다
function InFlightRow({
  p,
  flight,
  now,
  overdue,
  mode,
  busy,
  onRecall,
  onCancel,
  candidate,
  waiting,
}: {
  p: Proposal;
  flight: FlightInfo | undefined;
  waiting?: string;
  now: number;
  overdue: boolean;
  mode: DispatchConfig["mode"];
  busy: boolean;
  onRecall: (p: Proposal, reason: string) => Promise<boolean>;
  onCancel: (p: Proposal) => Promise<boolean>;
  candidate?: ArrivalSuggestion;
}) {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const closeCancel = () => {
    setCancelling(false);
    requestAnimationFrame(() => cancelBtn.current?.focus());
  };
  const btn = useRef<HTMLButtonElement>(null);
  const formId = `dp-${p.id}-recall`;
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => btn.current?.focus());
  };
  return (
    <Fragment>
      <tr className={`s-${p.status}${overdue ? " is-overdue" : ""}`}>
        <td className="dp-c-id mono">{p.id}</td>
        <td className="dp-c-flight mono" title={flight?.title}>
          <OpenFlight k={p.flight} />
        </td>
        <td className="dp-c-air">
          {p.aircraftName} <DeliveryWarn aircraft={p.aircraftName} />
          {waiting && (
            <span className="dp-wait" title={waitTitle(waiting)}>
              {waiting}
            </span>
          )}
          <LaunchLines p={p} launch={undefined} now={now} />
        </td>
        <td className="dp-c-result dp-result">
          {p.status === "recalling" ? (
            <span className="dp-recall">
              <span className="dp-recall-mark">RECALL</span>
              <span className="dp-recall-text">
                READBACK 대기 · 요청 <time dateTime={p.statusAt}>{timeAgo(p.statusAt, now)}</time>
              </span>
              {p.recallReason && <span className="dp-recall-reason">사유: {p.recallReason}</span>}
            </span>
          ) : (
            <StatusLabel p={p} />
          )}
          {p.status === "sent" && p.standbyAt && (
            <span className="dp-wait" title="CAPTAIN이 STANDBY로 답함: 받았지만 시간이 필요함. READBACK overdue는 첫 STANDBY부터 10분(한 번만)">
              STANDBY <time dateTime={p.standbyAt}>{timeAgo(p.standbyAt, now)}</time>
            </span>
          )}
          {p.status === "sent" && p.awaitSupervisor && (
            <span className="dp-await" title={`CAPTAIN이 READBACK도 거절도 아닌 채 SUPERVISOR의 go를 기다림: ${p.awaitSupervisor.reason}. SUPERVISOR가 그 세션에서 직접 go를 친다(atc는 대신 보내지 않는다)`}>
              AWAITING SUPERVISOR <time dateTime={p.awaitSupervisor.at}>{timeAgo(p.awaitSupervisor.at, now)}</time>
              <span className="dp-await-reason">{p.awaitSupervisor.reason}</span>
            </span>
          )}
          {(p.status === "approved" || p.status === "sent") && <SupervisorConfirm id={p.id} />}
          {candidate && <CandidateLine c={candidate} now={now} />}
          {overdue && <span className="dp-overdue">{overdueText(p)}</span>}
        </td>
        <td className="dp-c-at faint">{timeAgo(p.statusAt, now)}</td>
        <td className="dp-c-act">
          {canRecall(p) && !open && (
            <button
              ref={btn}
              className="dp-btn dp-recall-btn"
              disabled={busy}
              aria-label={`${p.id} ${flightNumber(p.flight)} RECALL — 사유 입력`}
              onClick={() => setOpen(true)}
            >
              RECALL…
            </button>
          )}
          {p.status === "approved" && !cancelling && (
            <button
              ref={cancelBtn}
              className="dp-btn dp-recall-btn"
              disabled={busy}
              aria-label={`${p.id} ${flightNumber(p.flight)} CANCEL — 확인`}
              onClick={() => setCancelling(true)}
            >
              CANCEL…
            </button>
          )}
        </td>
      </tr>
      {cancelling && p.status === "approved" && (
        <tr className="dp-recall-row">
          <td colSpan={6}>
            <form
              className="dp-reject dp-recall-form"
              aria-label={`${p.id} CANCEL 확인`}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeCancel();
                }
              }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!busy && (await onCancel(p))) setCancelling(false);
              }}
            >
              <p className="dp-recall-help">
                {p.id}(<OpenFlight k={p.flight} />)는 아직 {p.aircraftName}에 보내지 않았다. CANCEL하면 카드가 SUPERVISOR 취소로 닫히고 AIRCRAFT와 FLIGHT가 풀린다. 같은 짝은 24시간 다시 제안하지 않는다.
              </p>
              <div className="dp-actions">
                <button type="button" className="dp-btn" autoFocus onClick={closeCancel} disabled={busy}>
                  취소
                </button>
                <button type="submit" className="dp-btn dp-recall-btn is-confirm" disabled={busy}>
                  CANCEL 확인
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
      {open && canRecall(p) && (
        <tr className="dp-recall-row">
          <td colSpan={6}>
            <RecallForm id={formId} p={p} mode={mode} busy={busy} onCancel={close} onSubmit={async (reason) => (await onRecall(p, reason)) && setOpen(false)} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// RECALL 사유 폼(필수, 300자 이내). Escape는 취소하고 RECALL 버튼으로 초점을 돌린다
function RecallForm({
  id,
  p,
  mode,
  busy,
  onCancel,
  onSubmit,
}: {
  id: string;
  p: Proposal;
  mode: DispatchConfig["mode"];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const inputId = `${id}-reason`;
  const helpId = `${id}-help`;
  const text = reason.trim();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <form
      id={id}
      className="dp-reject dp-recall-form"
      aria-label={`${p.id} RECALL 사유`}
      onKeyDown={onKey}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && text) onSubmit(text);
      }}
    >
      <p id={helpId} className="dp-recall-help">
        {mode === "approval" ? "OCC가 CAPTAIN에게 RECALL 문구를 보내고, " : "지금은 2a라 OCC가 보내지 않는다 — CAPTAIN에게 직접 알린다. "}
        CAPTAIN은 작업을 멈추고 {p.departedStand === null && p.status === "departed" ? "그때까지의 결과를 남긴다" : "STAND를 그대로 둔다"}. RECALL을 READBACK하면 <OpenFlight k={p.flight} />는 다시 후보가 된다.
      </p>
      <label className="dp-memo-label" htmlFor={inputId}>
        RECALL 사유 <span className="faint">(필수 · CAPTAIN에게 그대로 전달)</span>
      </label>
      <textarea
        id={inputId}
        className="dp-input dp-textarea"
        value={reason}
        autoFocus
        required
        rows={2}
        maxLength={RECALL_MAX}
        aria-describedby={helpId}
        placeholder="예: 우선순위가 바뀌어 다른 AIRCRAFT에 맡김"
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="dp-actions">
        <span className="faint dp-count" aria-live="polite">
          {reason.length}/{RECALL_MAX}
        </span>
        <button type="button" className="dp-btn" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="submit" className="dp-btn dp-recall-btn is-confirm" disabled={busy || !text}>
          RECALL 요청
        </button>
      </div>
    </form>
  );
}

// ARRIVED 후보(ATC-72): atc가 찾은 흔적. OCC가 증거를 열어 확인하고 command로 ARRIVED를 적는다(atc는 스스로 적지 않는다)
const KIND_TEXT: Record<ArrivalSuggestion["kind"], string> = {
  "check-review": "대상 PR 리뷰",
  "check-comment": "대상 PR 댓글",
  "survey-docs-pr": "문서 PR 머지",
  "survey-comment": "GitHub 댓글",
  "survey-linear-comment": "Linear 댓글",
};
function CandidateLine({ c, now }: { c: ArrivalSuggestion; now: number }) {
  return (
    <span className="dp-life dp-candidate" title={`${c.reason}\nOCC 확인 뒤: ${c.command}`}>
      <span className="dp-candidate-mark">ARRIVED 후보</span>
      <span className="dp-life-note">
        {KIND_TEXT[c.kind]} · <time dateTime={c.evidence.at}>{timeAgo(c.evidence.at, now)}</time>
      </span>
      <a className="dp-life-link" href={c.evidence.url} target="_blank" rel="noreferrer" aria-label={`${c.flight} ARRIVED 후보 증거 열기 (새 탭)`}>
        증거 ↗
      </a>
    </span>
  );
}
// 직접 배정(D-xxxx 없음)의 ARRIVED 후보: IN FLIGHT 표에 없으니 따로 보인다
function DirectCandidates({ candidates, now }: { candidates: ArrivalSuggestion[]; now: number }) {
  if (!candidates.length) return null;
  return (
    <>
      <h2 className="label">
        ARRIVED 후보 <em>직접 배정 · STAND 없음 · OCC가 확인</em>
      </h2>
      <ul className="dp-candidates">
        {candidates.map((c) => (
          <li key={`${c.flight}|${c.aircraft}`}>
            <span className="mono"><OpenFlight k={c.flight} /></span> <span>{c.aircraft}</span> <span className="faint">{c.type}</span> <CandidateLine c={c} now={now} />
            <span className="dp-candidate-reason">{c.reason}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// 기다림 글의 설명: LAUNCH 뒤 새 세션 대기(ATC-129)와 /clear 뒤 첫 메시지 대기(ATC-91)
const waitTitle = (w: string) =>
  w.startsWith("LAUNCHING")
    ? "승인 때 atc가 이 AIRCRAFT를 LAUNCH했다. 새 세션이 뜨면 OCC가 FLIGHT PLAN을 보낸다 — 유예 안에 뜨지 않으면 LAUNCH 실패로 닫힌다"
    : "세션이 /clear로 끝났고 새 세션이 첫 메시지를 받을 때까지 이 제안은 닫히지 않는다";

// LAUNCH on approve·RESUME(ATC-129): 세션이 없는 백그라운드 AIRCRAFT의 카드. launch는 서버 글 — 이것이면 승인 때 띄우고, 아니면 상한 대기 글
const LAUNCH_TEXT = "LAUNCH on approve"; // server/dispatch-launch.ts와 같은 글
const utc = (iso: string) => `${iso.slice(11, 16)}Z`;
function LaunchLines({ p, launch, now }: { p: Proposal; launch: string | undefined; now: number }) {
  const r = p.resume;
  const failed = p.launched && !p.launched.ok ? p.launched : null;
  const text = p.status === "proposed" ? launch : undefined; // 승인 뒤에는 기다림 글(waiting)이 대신한다
  const next = nextLaunchLabel(useContext(LaunchAcctCtx));
  if (!r && !text && !failed) return null;
  return (
    <div className="dp-launch">
      {(r || text) && (
        <p className="dp-launch-head">
          {r && (
            <span className="dp-resume-mark" title="사용 한도로 끊긴 FLIGHT — reset이 지났고 새 턴이 없다. 승인하면 LAUNCH하고 FLIGHT PLAN이 처음부터가 아니라 이어서 하라고 적는다">
              RESUME after LIMIT
            </span>
          )}
          {text &&
            (text === LAUNCH_TEXT ? (
              <span className="dp-launch-text" title="이 AIRCRAFT는 세션이 없다(백그라운드 세션이 쉬다 거둬짐). 승인하면 FLEET LAUNCH와 같은 옵션으로 띄운 뒤 FLIGHT PLAN을 보낸다">
                absent · {text}
                {next && <> · <span className="mono" title="설정 → ACCOUNTS의 LAUNCH ACCOUNT. 승인하면 각 home 대신 이 ACCOUNT로 뜬다">{next}</span></>}
              </span>
            ) : (
              <span className="dp-launch-text is-full">{text}</span>
            ))}
        </p>
      )}
      {r && (
        <dl className="dp-resume" aria-label="RESUME">
          <dt>STAND</dt>
          <dd className="mono" title={r.stand ?? undefined}>
            {r.stand ?? <span className="faint">모름</span>}
          </dd>
          <dt>브랜치</dt>
          <dd className="mono">{r.branch ?? <span className="faint">모름</span>}</dd>
          <dt>커밋</dt>
          <dd>
            {r.commit ? (
              <>
                <span className="mono">{r.commit.sha}</span>
                {r.commit.at && <span className="faint"> · {timeAgo(r.commit.at, now)}</span>}
                {r.commit.pushed === true && <span className="dp-fact-ok"> · pushed</span>}
                {r.commit.pushed === false && <span className="dp-fact-warn"> · origin에 아직 없음</span>}
              </>
            ) : (
              <span className="faint">없음 — 워크트리를 찾지 못함</span>
            )}
          </dd>
          {r.report && (
            <>
              <dt>마지막 보고</dt>
              <dd>{r.report}</dd>
            </>
          )}
          <dt>LIMIT</dt>
          <dd className="mono">
            cut {utc(r.cutAt)} · reset {utc(r.resetsAt)}
          </dd>
        </dl>
      )}
      {failed && (
        <p className="dp-launch-fail">
          <span className="dp-caution">LAUNCH 실패</span> {failed.error ?? "원인 모름"} <span className="faint">· {timeAgo(failed.at, now)}</span>
        </p>
      )}
    </div>
  );
}

// 상태 글자. STAND 없이 DEPARTED면 "READBACK으로 착수", ARRIVED면 CAPTAIN 보고(글 또는 링크)를 붙인다
function StatusLabel({ p }: { p: Proposal }) {
  const text = statusText[p.status] ?? String(p.status).toUpperCase();
  if (standFreeDeparted(p))
    return (
      <span className="dp-life">
        {text}
        <span className="dp-life-note" title="STAND가 필요 없는 FLIGHT(SURVEY·CHECK) — READBACK을 받은 때를 DEPARTED로 봄">
          READBACK으로 착수 · STAND 없음
        </span>
      </span>
    );
  if ((p.status as string) !== "arrived") return <>{text}</>;
  const { arrivedNote: note, arrivedUrl: url } = lifeOf(p);
  // 보고가 링크 하나뿐이면 링크만 보인다
  const bare = !!url && note?.trim() === url;
  return (
    <span className="dp-life">
      {text}
      {note && !bare && <span className="dp-life-note dp-life-report">{note}</span>}
      {url && (
        <a className="dp-life-link" href={url} target="_blank" rel="noreferrer" title={url} aria-label={`${p.id} ARRIVED 보고 열기 (새 탭)`}>
          보고 ↗
        </a>
      )}
      {!note && !url && <span className="dp-life-note">보고 없음</span>}
    </span>
  );
}

// 최근 결정의 사유: 사유 칩, 한 번 클릭 표시, 사유 문장
function RecentReason({ p, labelOf }: { p: Proposal; labelOf: (code: string) => string }) {
  const codes = codesOf(p);
  const oneClick = viaOf(p) === "crosscheck";
  // RECALLED는 SUPERVISOR의 RECALL 사유를 보인다
  if (p.status === "recalled") return <>{p.recallReason ?? p.reason ?? "—"}</>;
  if (!codes.length && !oneClick) return <>{p.reason ?? "—"}</>;
  // 서버가 "라벨 · 라벨 — 메모"로 적으니 칩과 겹치는 앞부분은 떼고 메모만 보인다(라벨이 바뀌었으면 전체)
  const head = codes.map(labelOf).join(" · ");
  const text = !codes.length || !p.reason ? p.reason : p.reason === head ? null : p.reason.startsWith(`${head} — `) ? p.reason.slice(head.length + 3) : p.reason;
  return (
    <>
      <span className="dp-recent-tags">
        {oneClick && (
          <span className="dp-via" title="CROSSCHECK에 동의 버튼 한 번으로 기록한 판정">
            1-CLICK
          </span>
        )}
        {codes.map((c) => (
          <span key={c} className="dp-reason-tag" title={c}>
            {labelOf(c)}
          </span>
        ))}
      </span>
      {text && <span className="dp-reason-text">{text}</span>}
    </>
  );
}

// 거절 사유 폼(SCHEDULE 탭과 같은 모양): 여러 칩 + 메모. Escape는 취소하고 거절 버튼으로 초점을 돌린다.
function RejectForm({
  p,
  codes,
  mode,
  busy,
  onCancel,
  onSubmit,
}: {
  p: Proposal;
  codes: ReasonCode[];
  mode: DispatchConfig["mode"];
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (reasonCodes: string[], memo: string | null) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [memo, setMemo] = useState("");
  const memoId = `dp-${p.id}-memo`;
  const has = picked.length > 0 || memo.trim() !== "";
  // 칩 순서는 서버 목록 순서를 따른다
  const toggle = (code: string) => setPicked((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : codes.map((c) => c.code).filter((c) => c === code || cur.includes(c))));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  const word = mode === "approval" ? "거절" : "거절했을 것";
  return (
    <form
      className="dp-reject"
      onKeyDown={onKey}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit(picked, memo.trim() || null);
      }}
    >
      {codes.length > 0 && (
        <div className="dp-chips" role="group" aria-label={`${p.id} 거절 사유 고르기(여러 개)`}>
          {codes.map((c) => (
            <button type="button" key={c.code} className={`dp-chip${picked.includes(c.code) ? " is-on" : ""}`} aria-pressed={picked.includes(c.code)} onClick={() => toggle(c.code)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <label className="dp-memo-label" htmlFor={memoId}>
        거절 사유 <span className="faint">(선택이지만 남겨 주세요 — DISPATCH가 다음 계획에 반영)</span>
      </label>
      <input id={memoId} className="dp-input" value={memo} autoFocus maxLength={400} placeholder="예: 선행 FLIGHT가 아직 ENROUTE" onChange={(e) => setMemo(e.target.value)} />
      <div className="dp-actions">
        <button type="button" className="dp-btn" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="submit" className="dp-btn disagree is-confirm" disabled={busy}>
          {has ? `${word} 기록` : `사유 없이 ${word} 기록`}
        </button>
      </div>
    </form>
  );
}

// 닫힌 제안에 남은 CROSSCHECK 표시(흐리게)
function CrosscheckMini({ m }: { m: Crosscheck | null }) {
  if (!m) return null;
  return (
    <span className={`dp-xc-mini v-${m.verdict}`} title={xcTitle(m)} aria-label={xcTitle(m)}>
      CROSSCHECK {m.verdict}
    </span>
  );
}

// Jev의 세 답(툴팁): 확률은 yes 확률, Same area는 5단계 점수. 보낸 칸과 안 보낸 이유도 적는다
const judgeTitle = (m: JudgeMark) =>
  [
    `${m.family.toUpperCase()} · ${m.model} · ${m.run}`,
    `Ready ${pct(m.ready)} · Prerequisite ${pct(m.prerequisite)} · Same area ${m.sameArea ? `${m.sameArea.score.toFixed(1)} (${pct(m.sameArea.level)})` : `안 물음${m.recentWithheld ? ` — ${m.recentWithheld}` : ""}`}`,
    `보냄: ${m.sent.join(", ")}${m.withheld ? ` · 본문 안 보냄(${m.withheld})` : ""}`,
  ].join("\n");

// 닫힌 제안에 남은 Jev 표시(그림자 전용, 판정 뒤에만 보인다)
function JudgeMini({ m }: { m: JudgeMark }) {
  return (
    <span className="dp-xc-mini dp-judge-mini" title={judgeTitle(m)} aria-label={judgeTitle(m)}>
      {m.family.toUpperCase()}
    </span>
  );
}

// 열린 제안의 CROSSCHECK 칩: "CROSSCHECK agree · 사유"(길면 두 줄에서 자르고 전체는 title)
function CrosscheckChip({ m, now, labelOf }: { m: Crosscheck; now: number; labelOf: (code: string) => string }) {
  const chips = (m.reasonCodes ?? []).map(labelOf);
  return (
    <p className={`dp-xc v-${m.verdict}`} title={`CROSSCHECK ${m.verdict} · ${modelText(modelOf(m))} · ${m.by} · ${m.at}\n${chips.length ? `[${chips.join(" · ")}] ` : ""}${m.reason}`}>
      <span className="dp-xc-mark">CROSSCHECK</span>
      <b className="dp-xc-verdict">{m.verdict}</b>
      {chips.length > 0 && <span className="dp-xc-codes">{chips.join(" · ")}</span>}
      <span className="dp-xc-reason">· {m.reason}</span>
      {/* 어느 모델이 표시했는지: 시각 옆에 흐리게 */}
      <span className="dp-xc-meta">
        <span className="dp-xc-model" title={modelOf(m)}>
          {modelLabel(modelOf(m))}
        </span>
        <time className="dp-xc-at" dateTime={m.at}>
          {timeAgo(m.at, now)}
        </time>
      </span>
    </p>
  );
}

function Gate({ gate, labelOf, stats, judges }: { gate: Brief["gate"]; labelOf: (code: string) => string; stats?: ReasonStat[]; judges?: Judges }) {
  const enough = gate.decided >= gate.target.decided;
  const rateOk = gate.agreement !== null && gate.agreement >= gate.target.agreement;
  const rows = [
    {
      label: "판정한 제안(HELD·준비 안 됨 제외)",
      value: `${gate.decided}건`,
      target: `≥ ${gate.target.decided}건`,
      state: enough ? "pass" : "fail",
    },
    {
      label: "합의율(승인했을 것 비율)",
      value: gate.agreement === null ? "—" : `${Math.round(gate.agreement * 100)}%`,
      target: `≥ ${gate.target.agreement * 100}%`,
      state: gate.decided < 5 ? "insufficient" : rateOk ? "pass" : "fail",
    },
  ] as const;
  const mark = { pass: "✓ 충족", fail: "✗ 미달", insufficient: "○ 데이터 부족" } as const;
  const xc = gate.crosscheck; // 옛 서버면 없음
  const one = xc?.oneClick;
  const pf = gate.preflight; // 옛 서버면 없음
  // 거절 사유 코드별 건수: 많은 순(같으면 코드순), 0건은 뺀다
  const reasons = Object.entries(gate.reasonCounts ?? {})
    .filter(([, n]) => n > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  return (
    <div className="dp-gate">
      <h2 className="label">
        STAGE 2b <em>승인 운용 진입 점검 · {gate.ready ? "준비됨" : "아직"}</em>
      </h2>
      <ul>
        {rows.map((r) => (
          <li key={r.label} className={`s-${r.state}`}>
            <span className="dp-gate-label">{r.label}</span>
            <span className="dp-gate-value">{r.value}</span>
            <span className="dp-gate-target">기준 {r.target}</span>
            <span className="dp-gate-state">{mark[r.state]}</span>
          </li>
        ))}
        {pf && (
          <li className="s-info dp-gate-pf" title={PREFLIGHT_NOTE}>
            <span className="dp-gate-label">
              PREFLIGHT HELD {pf.held}건{pf.holding ? ` (지금 ${pf.holding})` : ""}
            </span>
            <span className="dp-gate-value">준비율 {pf.readyRate === null ? "—" : `${pf.passed}/${pf.passed + pf.held + (pf.notReady ?? 0)} ${pct(pf.readyRate)}`}</span>
            <span className="dp-gate-target">게이트 밖</span>
            <span className="dp-gate-state">참고</span>
          </li>
        )}
        {gate.notReady !== undefined && (
          <li className="s-info dp-gate-notready" title={NOT_READY_NOTE}>
            <span className="dp-gate-label">준비 안 됨 거절 {gate.notReady}건</span>
            <span className="dp-gate-value">—</span>
            <span className="dp-gate-target">게이트 제외</span>
            <span className="dp-gate-state">참고</span>
          </li>
        )}
        {gate.blind && (
          <li className="s-info dp-gate-blind" title={BLIND_NOTE}>
            <span className="dp-gate-label">
              BLIND 합의율 {gate.blind.decided > 0 ? `${gate.blind.agreed}/${gate.blind.decided}` : "— (아직 없음)"}
            </span>
            <span className="dp-gate-value">{pct(gate.blind.agreement)}</span>
            <span className="dp-gate-target">전체 합의율과 비교</span>
            <span className="dp-gate-state">참고</span>
          </li>
        )}
        {xc && (
          <li className="s-info dp-gate-xc">
            <span className="dp-gate-label">
              CROSSCHECK 일치 {xc.matched}/{xc.marked}
            </span>
            <span className="dp-gate-value">{pct(xc.rate)}</span>
            <span className="dp-gate-target">기준 없음</span>
            <span className="dp-gate-state">참고</span>
          </li>
        )}
        {xc &&
          byModelRows(xc.byModel).map(([id, r]) => (
            <li key={id} className="s-info dp-gate-xc-model" title={`CROSSCHECK 일치 · 모델 계열 ${id}${id === "unknown" ? " (모델 기록 전의 mark — ATFM 기준에 세지 않음)" : " (경로별 이름을 묶음 — 원래 이름은 칩에)"} · ${r.matched}/${r.marked}`}>
              <span className="dp-gate-label">
                <span className="dp-gate-xc-name">└ {modelLabel(id)}</span>
                <span className="dp-gate-xc-count">
                  {r.matched}/{r.marked}
                </span>
              </span>
              <span className="dp-gate-value">{pct(r.rate)}</span>
            </li>
          ))}
        {judges && (judges.mode !== "off" || judges.stats.judged > 0) &&
          (
            [
              ["Ready = no → 거절", judges.stats.ready, "Ready가 no인 제안 가운데 SUPERVISOR가 거절한 것"],
              ["Prerequisite = yes → 선행 대기", judges.stats.prerequisite, "Prerequisite가 yes인 제안 가운데 waiting-on-prior 칩이 달렸거나 OCC가 HOLD한 것"],
              ["Same area 가까움 → 승인", judges.stats.sameArea, "Same area가 가깝다(≥ 50%)고 본 제안 가운데 SUPERVISOR가 승인한 것"],
            ] as const
          ).map(([label, r, note]) => (
            <li key={label} className="s-info dp-gate-judge" title={`JEV(그림자 전용) · ${note} · 게이트에 세지 않음`}>
              <span className="dp-gate-label">
                JEV {label} {r.matched}/{r.marked}
              </span>
              <span className="dp-gate-value">{pct(r.rate)}</span>
              <span className="dp-gate-target">기준 없음</span>
              <span className="dp-gate-state">참고</span>
            </li>
          ))}
        {one && (
          <li className="s-info dp-gate-one" title={ONE_CLICK_NOTE}>
            <span className="dp-gate-label">
              한 번 클릭 {one.decided > 0 ? `${one.count}/${one.decided}` : "— (아직 없음)"}
            </span>
            <span className="dp-gate-value">{one.decided > 0 ? pct(one.count / one.decided) : "—"}</span>
            <span className="dp-gate-target">기준 없음</span>
            <span className="dp-gate-state">참고</span>
          </li>
        )}
      </ul>
      {stats ? (
        <div className="dp-gate-rules">
          <p className="dp-gate-reasons-head">거절 사유 → 배정 규칙</p>
          <ul>
            {[...stats]
              .sort((a, b) => b.count - a.count || stats.indexOf(a) - stats.indexOf(b))
              .map((r) => (
                <li key={r.code} className={r.count ? undefined : "faint"}>
                  <span className="dp-gate-rule-label">{r.label}</span>
                  <b>{r.count}</b>
                  <span className={`dp-gate-auto a-${r.auto}`} title={r.how}>
                    {AUTO_TEXT[r.auto]}
                  </span>
                  {r.examples.length > 0 && <span className="faint dp-gate-rule-ex">{r.examples.map(flightNumber).join(", ")}</span>}
                </li>
              ))}
          </ul>
        </div>
      ) : reasons.length > 0 && (
        <p className="dp-gate-reasons">
          <span className="dp-gate-reasons-head">거절 사유</span>
          {reasons.map(([code, n], i) => (
            <span key={code} className="dp-gate-reason" title={code}>
              {i > 0 && <span className="faint"> · </span>}
              {labelOf(code)} <b>{n}</b>
            </span>
          ))}
        </p>
      )}
      {xc && (
        <p className="dp-gate-note faint">
          CROSSCHECK 일치는 참고용이다 — 게이트에는 사람 판정만 셈.
          {one && ` 한 번 클릭: ${ONE_CLICK_NOTE}.`}
        </p>
      )}
    </div>
  );
}

function Gate3({ gate }: { gate: Brief["gate3"] }) {
  const mark = { pass: "✓ 충족", fail: "✗ 미달", insufficient: "○ 데이터 부족" } as const;
  const few = gate.dispatched < 3;
  const rows = [
    { label: "보낸 FLIGHT PLAN", value: `${gate.dispatched}건`, target: `≥ ${gate.target.dispatched}건`, state: gate.dispatched >= gate.target.dispatched ? "pass" : "fail" },
    {
      label: `READBACK 비율 · 중앙값 ${gate.readbackMedianMin === null ? "—" : `${gate.readbackMedianMin}분`}`,
      value: pct(gate.readbackRate),
      target: `≥ ${gate.target.readback * 100}%`,
      state: few ? "insufficient" : gate.readbackRate !== null && gate.readbackRate >= gate.target.readback ? "pass" : "fail",
    },
    {
      label: gate.standFree ? "READBACK 뒤 DEPARTED 비율 (STAND FLIGHT)" : "READBACK 뒤 DEPARTED 비율",
      value: pct(gate.departedRate),
      target: `≥ ${gate.target.departed * 100}%`,
      state: few ? "insufficient" : gate.departedRate !== null && gate.departedRate >= gate.target.departed ? "pass" : "fail",
    },
  ] as const;
  return (
    <div className="dp-gate">
      <h2 className="label">
        STAGE 3 <em>ATFM 진입 점검 · DECLINED {gate.declined} · {gate.ready ? "준비됨" : "아직"}</em>
      </h2>
      <ul>
        {rows.map((r) => (
          <li key={r.label} className={`s-${r.state}`}>
            <span className="dp-gate-label">{r.label}</span>
            <span className="dp-gate-value">{r.value}</span>
            <span className="dp-gate-target">기준 {r.target}</span>
            <span className="dp-gate-state">{mark[r.state]}</span>
          </li>
        ))}
        {gate.standFree && gate.standFree.readBack > 0 && (
          <li className="s-info dp-gate-sub" title="STAND 없는 FLIGHT(SURVEY·CHECK)는 READBACK에서 바로 DEPARTED — 게이트 비율에 세지 않음">
            <span className="dp-gate-label">
              └ STAND 없는 FLIGHT · READBACK {gate.standFree.readBack} · ARRIVED {gate.standFree.arrived}
            </span>
            <span className="dp-gate-value">
              {gate.standFree.arrived}/{gate.standFree.readBack}
            </span>
            <span className="dp-gate-target">기준 없음</span>
            <span className="dp-gate-state">참고</span>
          </li>
        )}
        {gate.standFree?.timely && gate.standFree.timely.total > 0 && (
          <li className="s-info dp-gate-sub" title="일이 끝난 시각(ARRIVED 후보의 증거, 보고만이면 ARRIVED 시각)에서 24시간 안에 ARRIVED한 비율. 24시간 넘게 확인 안 된 후보는 놓친 것(최근 30일)">
            <span className="dp-gate-label">└ STAND 없는 FLIGHT · 일이 끝난 뒤 24시간 안 ARRIVED</span>
            <span className="dp-gate-value">
              {gate.standFree.timely.within}/{gate.standFree.timely.total}
            </span>
            <span className="dp-gate-target">기준 없음</span>
            <span className="dp-gate-state">참고</span>
          </li>
        )}
      </ul>
    </div>
  );
}

// 동의 묶음(ATC-6): CROSSCHECK가 agree한 카드를 한 줄씩. [동의]는 한 번 클릭(via crosscheck)으로 agree 판정.
// 한 번에 하나씩만 — "모두 동의"는 두지 않는다. 줄을 펼치면 전체 카드(거절은 거기서 칩과 함께)
function AgreeLane({
  items,
  flights,
  mode,
  busy,
  onAgree,
  renderCard,
}: {
  items: Proposal[];
  flights: Record<string, FlightInfo>;
  mode: DispatchConfig["mode"];
  busy: string | null;
  onAgree: (p: Proposal) => void;
  renderCard: (p: Proposal) => ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="dp-agree" aria-label="CROSSCHECK 동의 묶음">
      <p className="dp-agree-head">
        CROSSCHECK 동의 <b>{items.length}</b> <span className="faint">— 한 줄씩 확인하고 [동의]. 거절은 펼쳐서</span>
      </p>
      <ul className="dp-agree-list">
        {items.map((p) => {
          const f = flights[p.flight];
          const what = p.briefing?.what ?? f?.title ?? p.flight;
          const isOpen = open === p.id;
          return (
            <li key={p.id} className={`dp-agree-row${isOpen ? " is-open" : ""}`}>
              <div className="dp-agree-line">
                <button
                  type="button"
                  className="dp-agree-toggle"
                  aria-expanded={isOpen}
                  aria-controls={`agree-${p.id}`}
                  aria-label={`${p.id} ${isOpen ? "접기" : "카드 펼치기"}`}
                  onClick={() => setOpen(isOpen ? null : p.id)}
                >
                  {isOpen ? "▾" : "▸"}
                </button>
                <span className="dp-agree-what" title={what}>
                  {what}
                  {!p.briefing && <span className="faint"> {settleOf(p).settled === false ? `(${waitText(p)})` : "(BRIEFING 대기)"}</span>}
                </span>
                <span className="mono dp-agree-fn"><OpenFlight k={p.flight} /></span>
                <span className="dp-agree-ac">
                  → <b>{p.aircraftName}</b>
                </span>
                <button
                  type="button"
                  className="dp-btn agree dp-agree-btn"
                  disabled={busy === p.id}
                  title={`CROSSCHECK agree대로 ${mode === "approval" ? "승인" : "승인했을 것"}으로 기록(한 번 클릭)`}
                  onClick={() => onAgree(p)}
                >
                  동의
                </button>
              </div>
              {isOpen && (
                <div id={`agree-${p.id}`} className="dp-agree-card">
                  {renderCard(p)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Card({
  p,
  flight,
  info,
  now,
  onVerdict,
  onAccept,
  codes,
  mode,
  held,
  onHeld,
  busy,
  waiting,
  launch,
}: {
  p: Proposal;
  flight: FlightInfo | undefined;
  waiting?: string;
  launch?: string; // "LAUNCH on approve" 또는 상한 대기 글(ATC-129)
  info?: CardBrief;
  now: number;
  onVerdict: (p: Proposal, v: "agree" | "disagree", input: VerdictInput) => Promise<boolean>;
  onAccept?: (p: Proposal, m: Crosscheck) => void; // HELD 카드에는 없음
  codes: ReasonCode[];
  mode: DispatchConfig["mode"];
  held?: boolean;
  onHeld?: (p: Proposal, action: "requeue" | "confirm-hold") => void;
  busy?: boolean;
}) {
  const max = Math.max(1, ...p.factors.map((f) => Math.abs(f.points)));
  // HELD 카드에도 보인다(누가·칩·이유). 한 번 클릭 버튼은 대기열 카드에만. blind 카드는 판정 전까지 숨긴다(ATC-6)
  const blind = !held && Boolean(info?.blind);
  const marked = markOf(p);
  const xc = blind ? null : marked;
  const labelOf = (c: string) => codes.find((r) => r.code === c)?.label ?? c;
  const [rejecting, setRejecting] = useState(false);
  const rejectBtn = useRef<HTMLButtonElement>(null);
  const closeReject = () => {
    setRejecting(false);
    requestAnimationFrame(() => rejectBtn.current?.focus());
  };
  // 거절 기록. 성공하면 카드가 사라지고, 실패하면 폼을 그대로 둔다(오류는 위에)
  const reject = async (reasonCodes: string[], reason: string | null) => {
    await onVerdict(p, "disagree", { via: "manual", reasonCodes, reason });
  };
  return (
    <article className={`dp-card k-${p.kind}${p.caution ? " is-caution" : ""}${held ? " is-held" : ""}`}>
      <header className="dp-card-head">
        <span className="dp-kind">{p.kind}</span>
        <span className="mono faint">{p.id}</span>
        <span className="faint dp-age">{timeAgo(p.at, now)}</span>
        {p.caution && <span className="dp-caution">CAUTION</span>}
      </header>
      <div className="dp-flight">
        <a className="mono dp-fn" href={flight?.url ?? undefined} target="_blank" rel="noreferrer" title={p.flight}>
          {flightNumber(p.flight)}
        </a>
        {flight && <PriorityMark priority={flight.priority} />}
        <span className="dp-title">{flight?.title ?? p.flight}</span>
      </div>
      <BriefingLines p={p} title={flight?.title ?? null} info={info} />
      <FactsLine info={info} now={now} aircraft={p.kind === "ASSIGN" ? p.aircraftName : null} showCrosscheck={!xc && !blind} />
      {flight?.cls && (
        <p className={`dp-class${flight.clsDefault ? " is-default" : ""}`} title={flight.clsDefault ? "type:·wake: 라벨이 없어 기본값(BUILD · M)으로 봄" : "FLIGHT TYPE · WAKE · 필요한 TYPE RATING"}>
          {flight.cls}
          {flight.tails?.length ? ` · ${flight.tails.map((n) => `tail:${n}`).join(", ")}` : ""}
          {flight.clsDefault && <span className="faint"> (기본값)</span>}
        </p>
      )}
      <div className="dp-target">
        {p.kind === "ASSIGN" ? (
          <>
            → <b>{p.aircraftName}</b> <span className="apt">{p.airport}</span> <DeliveryWarn aircraft={p.aircraftName} />
            {waiting && (
              <span className="dp-wait" title={waitTitle(waiting)}>
                {waiting}
              </span>
            )}
          </>
        ) : (
          <>Todo로 되돌릴지 확인 {flight && <span className="faint">· 지금 {flight.state}</span>}</>
        )}
        <span className="dp-score" title="점수">
          {p.score}
        </span>
      </div>
      {p.kind === "ASSIGN" && <LaunchLines p={p} launch={launch} now={now} />}
      {p.kind === "ASSIGN" && <SupervisorConfirm id={p.id} />}
      {p.holdAt && (
        <p className="dp-hold">
          <span className="dp-hold-mark">{p.preflight ? "PREFLIGHT" : "HOLD"}</span>
          {p.preflight
            ? `CROSSCHECK(${modelLabel(p.preflight.model)})가 FLIGHT 칩으로 disagree: ${p.preflight.codes.map(labelOf).join(" · ")} — FLIGHT가 수정되면 다시 검토`
            : p.hold.length
              ? `선행 FLIGHT ${p.hold.map(flightNumber).join(", ")}가 끝난 뒤`
              : "OCC: 사람 결정·외부 입력 대기 — 사유는 메모, FLIGHT가 수정되면 다시 검토"}
        </p>
      )}
      {blind ? (
        <p className="dp-blind" title="blind 표본: 약 5장에 1장은 판정할 때까지 CROSSCHECK 판정을 숨긴다(제안 ID로 정함). 이 카드의 판정은 anchoring 점검에 쓰인다">
          <span className="dp-blind-mark">BLIND</span>
          {marked ? "CROSSCHECK 판정 숨김 — 카드를 보고 직접 판정" : "CROSSCHECK 대기 — 판정이 와도 숨긴다"}
        </p>
      ) : xc ? (
        <CrosscheckChip m={xc} now={now} labelOf={labelOf} />
      ) : (
        !held && (
          <p className="dp-xc-wait" title="CROSSCHECK가 아직 이 제안을 보지 않음 — FLIGHT 자체의 문제는 CROSSCHECK가 걸러 HELD로 보낸다">
            CROSSCHECK 대기
          </p>
        )
      )}
      {held ? (
        <div className="dp-actions">
          <button className="dp-btn requeue" disabled={busy} title="HOLD를 풀고 이 제안을 판정 대기열로 돌린다(24시간은 지금부터)" onClick={() => onHeld?.(p, "requeue")}>
            대기열로
          </button>
          {!p.hold.length && (
            <button
              className="dp-btn confirm-hold"
              disabled={busy}
              title="FLIGHT 보류 확정 — 이 FLIGHT를 모든 AIRCRAFT에서 24시간 빼고(이슈가 바뀌면 그 전에 풀림) 제안을 닫는다. 사람 판정(게이트)에는 세지 않음"
              onClick={() => onHeld?.(p, "confirm-hold")}
            >
              FLIGHT 보류 확정
            </button>
          )}
        </div>
      ) : rejecting ? (
        <RejectForm p={p} codes={codes} mode={mode} busy={busy} onCancel={closeReject} onSubmit={reject} />
      ) : (
        <div className="dp-actions">
          <button className="dp-btn agree" disabled={busy} onClick={() => onVerdict(p, "agree", { via: "manual", reason: null })}>
            {mode === "approval" ? "승인" : "승인했을 것"}
          </button>
          <button ref={rejectBtn} className="dp-btn disagree" disabled={busy} onClick={() => setRejecting(true)}>
            {mode === "approval" ? "거절…" : "거절했을 것…"}
          </button>
          {xc && onAccept && (
            <button
              className={`dp-btn dp-xc-accept v-${xc.verdict}`}
              disabled={busy}
              title={`CROSSCHECK 판정(${xc.verdict})대로 ${xc.verdict === "agree" ? (mode === "approval" ? "승인" : "승인했을 것") : mode === "approval" ? "거절" : "거절했을 것"} 기록${xc.verdict === "disagree" ? ` — 사유는 CROSSCHECK 사유${xc.reasonCodes?.length ? `, 칩 ${xc.reasonCodes.map((c) => codes.find((r) => r.code === c)?.label ?? c).join(" · ")}` : ""}` : ""}`}
              onClick={() => onAccept(p, xc)}
            >
              CROSSCHECK에 동의
            </button>
          )}
        </div>
      )}
      <CardDetails flight={p.flight}>
        <table className="dp-factors">
          <tbody>
            {p.factors.map((f) => (
              <tr key={f.id}>
                <td>{f.label}</td>
                <td className="dp-factor-detail">{f.detail}</td>
                <td className="dp-factor-bar" aria-hidden>
                  <span className={f.points < 0 ? "neg" : ""} style={{ width: `${(Math.abs(f.points) / max) * 100}%` }} />
                </td>
                <td className="num">{f.points > 0 ? `+${f.points}` : f.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {p.note ? (
          <p className="dp-note">
            {p.caution && <span className="dp-caution">CAUTION</span>} {p.note}
          </p>
        ) : (
          settleOf(p).settled === false && <p className="dp-note faint">{waitText(p)}</p>
        )}
      </CardDetails>
    </article>
  );
}
