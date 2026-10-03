import { sameStand } from "./go-around.ts";
import { infoTextOf } from "./landing-en.ts";
import type { Clearance, PullRequest, ReviewFindings } from "./model.ts";

// FIX(ATC-270): APPROACH PR의 현재 head에 review-findings 막힘이 있으면 그 PR의 STAND를 쥔 세션에 줄 행동 지시. 순수 함수만 둔다.
// 막힘의 지적 자료(`blocks[].findings`)와 이미 나간 CLEARANCE에서 매번 상태로 다시 만든다. 서버가 재시작돼 이벤트가 사라져도(`reset: true`) 남는다.
// 설계: controller/CLAUDE.md "FIX", docs/dispatch.md "LANDING SEQUENCE". GO AROUND(go-around.ts)와 같은 꼴.

const reNew = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// 지적 본문에서 P0·P1이 적힌 줄. 줄 단위로 못 찾으면(형식이 다르면) 본문 전체를 그대로 준다. 자르지 않는다
export function criticalLinesOf(text: string | null, p0: number, p1: number): string[] {
  if (!text || !(p0 || p1)) return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /\bP[01]\b/.test(l));
  return lines.length ? lines : [text.trim()];
}

const RE_REVIEW: Record<ReviewFindings["source"], string> = {
  mcc: "MCC re-inspects the new head",
  review: "the landing review re-reviews the new head",
  codex: "Codex re-reviews the new head",
  carried: "a re-review of the new head follows",
};

// CLEARANCE 본문(영어, ATC-126). TOWER는 landingQueue[].fix.text를 고치지 않고 그대로 `atcctl issue … FIX -- <text>`로 보낸다.
// 끝의 `head <7자리>`는 어느 head에 대한 지시인지 적는 표지다: 같은 head에는 한 번만 내고, 새로 push한 head에는 지적이 있으면 다시 낸다.
export function fixTextOf(x: { pr: number; head: string; flight: string | null; url: string; findings: ReviewFindings; en: string }): string {
  const f = x.findings;
  const who = `PR #${x.pr}${x.flight ? ` (${x.flight})` : ""}`;
  const head = x.head.slice(0, 7);
  const tail = `Fix them on the same branch, or say in the PR body why one stays (PILOT'S DISCRETION); run the checks and push; ${RE_REVIEW[f.source]}. Reply READBACK, or UNABLE with the reason. head ${head}`;
  // Codex의 P3만 남은 경우: 코드를 고칠 일이 아니라 스레드를 해결하거나 답글을 다는 일이다
  if (f.p3Only) return `FIX ${who}: ${x.en}. Resolve each thread or reply to it on the PR (${x.url}); no code change is needed for P3. Reply READBACK, or UNABLE with the reason. head ${head}`;
  if (!f.counts) return `FIX ${who}: ${x.en}. ${tail}`;
  const [p0, p1, p2] = f.counts;
  const crit = criticalLinesOf(f.text, p0, p1);
  const lines = crit.length ? ` ${crit.map((l) => l.replace(/[.\s]+$/, "")).join("; ")}.` : "";
  const rest = p2 > 0 ? ` ${reNew(p2, "P2 finding")} in the full text on the PR: ${x.url}.` : ` Details on the PR: ${x.url}.`;
  return `FIX ${who}: ${f.by ?? "review"} returned FINDINGS on head ${head} (P0 ${p0} · P1 ${p1} · P2 ${p2}).${lines}${rest} ${tail}`;
}

// 이 head에 이미 나간 FIX(취소되지 않은 것)
export function fixSent(p: Pick<PullRequest, "head" | "standPath" | "ticketKey" | "createdAt">, clearances: readonly Clearance[]): Clearance | undefined {
  const mark = `head ${p.head.slice(0, 7)}`;
  return clearances.find((c) => c.type === "FIX" && !c.cancelledAt && c.at >= p.createdAt && c.text.includes(mark) && sameStand(c, p));
}

// 한 시간 안에 같은 PR에 FIX가 이만큼 나갔으면 다음은 SUPERVISOR 몫이다(고치고 또 지적받기를 되풀이하는 PR)
export const REPEAT_MS = 60 * 60_000;
export const REPEAT_MAX = 3;
export function fixRecent(p: Pick<PullRequest, "standPath" | "ticketKey" | "createdAt">, clearances: readonly Clearance[], now: number): Clearance[] {
  return clearances.filter((c) => c.type === "FIX" && !c.cancelledAt && c.at >= p.createdAt && now - Date.parse(c.at) < REPEAT_MS && sameStand(c, p));
}

// 브리핑의 landingQueue[].fix(ATC-270).
//   action "send": TOWER가 holders에게 FIX로 text 그대로 보낸다 · "sent": 이 head에는 이미 나갔다 · "supervisor": 보내지 않고 SUPERVISOR 몫
//   (holder 없음, 또는 한 시간 안에 REPEAT_MAX번째 FIX)
export interface Fix {
  source: ReviewFindings["source"];
  text: string;
  head: string;
  action: "send" | "sent" | "supervisor";
  why: "no-holder" | "repeat" | null;
  clearance: string | null; // "sent"의 CLEARANCE id, "supervisor"(repeat)의 마지막 FIX id
}

export function fixOf(p: PullRequest, x: { clearances: readonly Clearance[]; holders: number; now: number }): Fix | null {
  if (p.landing !== "APPROACH") return null;
  const b = p.blocks.find((k) => k.code === "review-findings" && k.findings);
  if (!b?.findings) return null;
  const head = p.head.slice(0, 7);
  const text = fixTextOf({ pr: p.number, head: p.head, flight: p.ticketKey, url: p.url, findings: b.findings, en: b.en });
  const base = { source: b.findings.source, text, head };
  const sent = fixSent(p, x.clearances);
  if (sent) return { ...base, action: "sent", why: null, clearance: sent.id };
  if (!x.holders) return { ...base, action: "supervisor", why: "no-holder", clearance: null };
  const recent = fixRecent(p, x.clearances, x.now);
  if (recent.length >= REPEAT_MAX) return { ...base, action: "supervisor", why: "repeat", clearance: recent.at(-1)!.id };
  return { ...base, action: "send", why: null, clearance: null };
}

// APPROACH INFO(막힘 알림)도 상태로 정한다. 지적(review-findings)은 FIX가 맡으니 INFO에서 뺀다.
// 예전 규칙(events.ts diffLanding)처럼 알릴 막힘(코드)이 새로 생길 때만 보낸다. 본문에는 막힘마다 head·체크 이름·시간이 들어 있어 흔들리므로
// 본문이 아니라 본문 끝의 `[blocks: a,b]` 표지(코드 집합)로 마지막 INFO와 견준다. 체크 진행·머지 계산·LOS·충돌·뒤처짐은 알리지 않는다
export const QUIET_CODES = new Set(["checks-pending", "merge-unknown", "los", "dirty", "behind"]);
export interface Info {
  text: string;
  action: "send" | "sent" | "log";
  clearance: string | null;
}
const MARK = /\[blocks: ([a-z0-9,-]+)\]\s*$/;
// handoff(ATC-513): AUTOLAND가 CLEARED PR을 SUPERVISOR에게 넘겼다. 팀이 할 일은 없다는 INFO를 head마다 한 번만 보낸다(표지가 `autoland-<head 7자리>`라 같은 head에는 다시 가지 않는다)
export const handoffInfoText = (n: number) => `PR #${n} is CLEARED, but AUTOLAND handed it to the SUPERVISOR to merge. Nothing for the team to do; no LAND will come.`;
export function infoOf(p: PullRequest, x: { clearances: readonly Clearance[]; holders: number; handoff?: boolean }): Info | null {
  let text: string;
  let codes: string[];
  if (x.handoff && p.landing === "CLEARED") {
    codes = [`autoland-${p.head.slice(0, 7)}`];
    text = `${handoffInfoText(p.number)} [blocks: ${codes.join(",")}]`;
  } else {
    if (p.landing !== "APPROACH") return null;
    const live = p.blocks.filter((b) => !b.findings && !QUIET_CODES.has(b.code));
    if (!live.length) return null;
    codes = [...new Set(live.map((b) => b.code))].sort();
    text = `${infoTextOf(p.number, live.map((b) => b.en))} [blocks: ${codes.join(",")}]`;
  }
  const infos = (c: Clearance) => c.type === "INFO" && !c.cancelledAt && c.at >= p.createdAt && sameStand(c, p);
  // handoff는 이 head의 표지가 붙은 INFO가 하나라도 나갔으면 이미 나간 것(그 뒤에 다른 INFO가 나가도 다시 보내지 않는다)
  const last = x.handoff && p.landing === "CLEARED" ? x.clearances.findLast((c) => infos(c) && c.text.includes(`[blocks: ${codes[0]}]`)) : x.clearances.findLast(infos);
  // 마지막 INFO가 이 코드를 모두 알렸으면 이미 나간 것(표지가 없는 옛 INFO는 알 수 없어 다시 보낸다)
  const told = new Set(last?.text.match(MARK)?.[1]?.split(",") ?? []);
  if (last && codes.every((c) => told.has(c))) return { text, action: "sent", clearance: last.id };
  if (!x.holders) return { text, action: "log", clearance: null };
  return { text, action: "send", clearance: null };
}
