import { type ContextSize, tokensShort } from "./fuel-context.ts";
import { type FleetPlanConfig, overRefreshThreshold } from "./fleet-plan.ts";
import type { Op } from "./proposals.ts";
import { isBackground, type SessionOrigin } from "./session-origin.ts";

// FRESH START(ATC-73, docs/fleet.md 8.6 · docs/dispatch.md): 승인된 ASSIGN을 받을 AIRCRAFT의 대화가 기준(ATC-69)을 넘었으면,
// SUPERVISOR가 한 번 눌러 그 세션을 STOP하고 CREW BRIEFING + FLIGHT PLAN을 첫 프롬프트로 새로 LAUNCH한다. 여기는 순수 함수만.
// 실행(STOP·LAUNCH·기록)은 fresh-start-run.ts

export interface FreshStartFacts {
  registration: string;
  origin: SessionOrigin | null; // 살아 있는 세션의 출처. 세션이 없으면 null
  retired: boolean;
  aog: boolean;
  status: string; // AircraftView.status("idle" | …)
  flying: readonly string[]; // 쥔 STAND의 FLIGHT 키
  arrived: ReadonlySet<string>; // LOGBOOK에 ARRIVED한 FLIGHT 키
  context: Pick<ContextSize, "contextTokens" | "windowSource" | "pct"> | null;
}

export type FreshStartVerdict = { ok: true } | { ok: false; why: string };

// 할 수 있나. 아니면 화면에 보일 사유. 백그라운드 세션이고, 기준을 넘었고, 끝나지 않은 FLIGHT의 STAND가 없을 때만
export function freshStartVerdictOf(f: FreshStartFacts, cfg: Pick<FleetPlanConfig, "refreshTokens" | "refreshPct">): FreshStartVerdict {
  if (f.retired) return { ok: false, why: `${f.registration}는 RETIRED` };
  if (f.aog) return { ok: false, why: `${f.registration}는 AOG` };
  if (!f.origin) return { ok: false, why: `${f.registration} 세션이 떠 있지 않음 — LAUNCH on approve가 새로 띄운다` };
  if (!isBackground(f.origin)) return { ok: false, why: `${f.registration}는 백그라운드 세션이 아님(${f.origin}) — atc는 데스크톱·터미널 세션을 멈추지 않는다. 그 세션에서 /clear 후 CREW BRIEFING을 붙여 넣는다` };
  if (!f.context || f.context.contextTokens === null) return { ok: false, why: `${f.registration}의 대화 크기를 모름` };
  if (!overRefreshThreshold(f.context, cfg)) {
    return { ok: false, why: `대화 ${tokensShort(f.context.contextTokens)} — 기준 ${tokensShort(cfg.refreshTokens)}${f.context.windowSource === "default" ? "" : ` 또는 ${Math.round(cfg.refreshPct * 100)}%`} 아래` };
  }
  const open = f.flying.filter((k) => !f.arrived.has(k));
  if (open.length) return { ok: false, why: `끝나지 않은 FLIGHT의 STAND가 있음(${open.join(", ")})` };
  if (f.status !== "idle") return { ok: false, why: `${f.registration}가 ${f.status} — 턴이 끝난 뒤에 한다` };
  return { ok: true };
}

// 새 세션의 첫 프롬프트: CREW BRIEFING, 빈 줄, FLIGHT PLAN. 둘 다 세션끼리 주고받는 글이라 영어(ATC-126)
export const FRESH_START_DIVIDER = "— FLIGHT PLAN follows. This is a fresh session: nothing from the previous conversation carries over.";
export function freshStartPromptOf(briefing: string, message: string): string {
  return `${briefing.trimEnd()}\n\n${FRESH_START_DIVIDER}\n\n${message.trim()}`;
}

// 제안 기록의 send 항목. via로 FRESH START가 보낸 것임을 남긴다 — READBACK·DEPARTED·LOGBOOK·FUEL 귀속은 메시지로 보낸 것과 같다
export const FRESH_START_VIA = "fresh-start";
export function freshStartSendOp(id: string, at: string, message: string): Extract<Op, { op: "send" }> {
  return { op: "send", id, at, message, via: FRESH_START_VIA };
}

// FLEET 카드 LAUNCH with a FLIGHT(ATC-73): CREW BRIEFING + DIRECT 지시서(/brief?to=)
export function launchWithFlightPromptOf(briefing: string, brief: string): string {
  return `${briefing.trimEnd()}\n\n— Assignment follows.\n\n${brief.trim()}`;
}

// ── 실행 순서(입출력은 주입): STOP → LAUNCH(첫 프롬프트 = CREW BRIEFING + FLIGHT PLAN) → send 기록. 보낸 것은 LAUNCH가 성공한 뒤에만 적는다.
// STOP이 실패하면 아무것도 하지 않고, LAUNCH가 실패하면 세션은 멈춘 채다(제안은 approved 그대로 — 다시 승인할 필요 없이 LAUNCH on approve나 FLEET의 LAUNCH로 이어 간다) ──
export interface FreshStartDeps {
  stop: () => Promise<{ ok: boolean; jobId?: string; error?: string }>;
  gone: () => Promise<void>;
  launch: (promptOf: (briefing: string) => string) => Promise<{ ok: boolean; jobId?: string; error?: string }>;
  append: (ops: Op[]) => void;
  note: (line: { stage: "stop" | "launch" | "send"; ok: boolean; jobId?: string; error?: string }) => void; // FLIGHT RECORDER dispatch 줄
  now: () => string;
}
export interface FreshStartResult {
  ok: boolean;
  status: 200 | 502;
  stage?: "stop" | "launch";
  jobId?: string;
  error?: string;
}
export async function runFreshStart(id: string, message: string, d: FreshStartDeps): Promise<FreshStartResult> {
  const stopped = await d.stop().catch((e: Error) => ({ ok: false, error: e.message }) as { ok: boolean; jobId?: string; error?: string });
  d.note({ stage: "stop", ok: stopped.ok, ...(stopped.jobId ? { jobId: stopped.jobId } : {}), ...(stopped.error ? { error: stopped.error } : {}) });
  if (!stopped.ok) return { ok: false, status: 502, stage: "stop", error: `STOP 실패 — ${stopped.error ?? "원인 모름"}. 세션은 그대로다` };
  await d.gone();
  const launched = await d.launch((b) => freshStartPromptOf(b, message)).catch((e: Error) => ({ ok: false, error: e.message }) as { ok: boolean; jobId?: string; error?: string });
  d.note({ stage: "launch", ok: launched.ok, ...(launched.jobId ? { jobId: launched.jobId } : {}), ...(launched.error ? { error: launched.error } : {}) });
  if (!launched.ok) return { ok: false, status: 502, stage: "launch", error: `세션은 멈췄고 LAUNCH가 실패함 — ${launched.error ?? "원인 모름"}. FLIGHT PLAN은 보내지 않았다(제안은 approved 그대로)` };
  d.append([freshStartSendOp(id, d.now(), message)]);
  d.note({ stage: "send", ok: true, ...(launched.jobId ? { jobId: launched.jobId } : {}) });
  return { ok: true, status: 200, ...(launched.jobId ? { jobId: launched.jobId } : {}) };
}
