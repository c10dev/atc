import { inSequence, pullKey } from "./landing.ts";
import type { Clearance, PullRequest, Snapshot, TrafficEvent } from "./model.ts";

// GO AROUND(ATC-128): PR이 base와 충돌(DIRTY)하거나 뒤처졌을 때(BEHIND), 또는 LAND 문구가 "앞 PR 머지 뒤 rebase"라고 한 그 앞 PR이
// 머지됐을 때, 그 PR의 STAND를 쥔 세션에 줄 행동 지시. 순수 함수만 둔다. atc는 감지하고 알릴 뿐 충돌을 스스로 풀지 않는다.
// 설계: controller/CLAUDE.md "GO AROUND", docs/dispatch.md "LANDING SEQUENCE".

type Draft = Omit<TrafficEvent, "id" | "at">;
export type GoAroundReason = "dirty" | "behind" | "prevMerged";

// 지금 이 PR이 base와 어긋난 이유. 충돌이 뒤처짐보다 먼저다
export function conflictOf(p: Pick<PullRequest, "blocks">): "dirty" | "behind" | null {
  const codes = p.blocks.map((b) => b.code);
  return codes.includes("dirty") ? "dirty" : codes.includes("behind") ? "behind" : null;
}

// 두 PR이 함께 고친 파일. 하나라도 목록을 못 읽었으면 빈 목록(모름)
export function sharedFiles(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  if (!a || !b) return [];
  const set = new Set(b);
  return a.filter((f) => set.has(f)).sort();
}

const MAX_FILES = 8;
const prList = (nums: readonly number[]) => nums.map((n) => `#${n}`).join(", ");

// CLEARANCE 본문(영어, ATC-126). TOWER는 landingQueue[].goAround.text를 고치지 않고 그대로 `atcctl issue … "GO AROUND" -- <text>`로 보낸다.
// 본문의 `head <7자리>`는 어느 head에 대한 지시인지 적는 표지다: 같은 head에는 한 번만 내고, 새로 push한 head에는 다시 낸다.
export function goAroundTextOf(x: { reason: GoAroundReason; pr: number; head: string; flight: string | null; merged: readonly number[]; shared: readonly string[] }): string {
  const who = `PR #${x.pr}${x.flight ? ` (${x.flight})` : ""} head ${x.head.slice(0, 7)}`;
  const after = x.merged.length ? ` after ${prList(x.merged)} merged` : "";
  const cause =
    x.reason === "prevMerged"
      ? `${who}: the PR ahead of it in the LANDING SEQUENCE${x.merged.length ? ` (${prList(x.merged)})` : ""} has merged, so origin/main moved.`
      : x.reason === "dirty"
        ? `${who} conflicts with base${after}.`
        : `${who} is behind base${after}.`;
  const files = x.shared.length ? ` Shared files: ${x.shared.slice(0, MAX_FILES).join(", ")}${x.shared.length > MAX_FILES ? ` (+${x.shared.length - MAX_FILES} more)` : ""}.` : "";
  return `GO AROUND: ${cause}${files} Merge origin/main, resolve, run the checks, push (--force-with-lease only). Keep the merged PR's behaviour. If the two PRs change the same behaviour differently, answer UNABLE with the reason.`;
}

// 두 스냅샷 사이의 GO AROUND 이벤트. events.ts의 diffLanding 쪽에서 부른다.
//   landing.conflict: DIRTY·BEHIND가 새로 생겼거나(전에 없었거나 head가 바뀌었거나) 이미 그런 채 SEQUENCE에 들어옴. head마다 한 번
//   landing.prevMerged: CLEARED 순서에서 바로 앞이던 PR이 열린 목록에서 사라짐(머지). 같은 PR에 conflict가 나갔으면 내지 않는다
export function goAroundEvents(prev: Snapshot, next: Snapshot): Draft[] {
  const was = new Map(prev.pulls.filter(inSequence).map((p) => [pullKey(p), p]));
  const is = new Map(next.pulls.filter(inSequence).map((p) => [pullKey(p), p]));
  const nextOpen = new Set(next.pulls.map(pullKey));
  const ref = (p: PullRequest) => ({ repo: p.repo, pull: p.number, ticketKey: p.ticketKey ?? undefined, workspacePath: p.standPath ?? undefined, head: p.head.slice(0, 7) });
  // 지난 스냅샷에서 CLEARED였다가 열린 목록에서 사라진 PR = 착륙한 PR(착륙 순서를 받는 건 CLEARED뿐이라 머지로 본다)
  const landed = prev.pulls.filter((x) => x.landing === "CLEARED" && !nextOpen.has(pullKey(x)));
  const prevCleared = prev.pulls.filter((x) => x.landing === "CLEARED");
  const out: Draft[] = [];
  for (const [key, p] of is) {
    const before = was.get(key);
    const now = conflictOf(p);
    if (now && (!before || before.head !== p.head || conflictOf(before) !== now)) {
      const merged = landed.filter((m) => m.repo === p.repo && m.base === p.base);
      const mergedNums = merged.map((m) => m.number);
      const shared = [...new Set(merged.flatMap((m) => sharedFiles(p.changed, m.changed)))].sort();
      out.push({ ...ref(p), kind: "landing.conflict", blocks: p.blocks.map((b) => b.code), merged: mergedNums, shared, message: goAroundTextOf({ reason: now, pr: p.number, head: p.head, flight: p.ticketKey, merged: mergedNums, shared }) });
      continue;
    }
    if (!before || before.head !== p.head || before.landing !== "CLEARED") continue;
    const lane = prevCleared.filter((x) => x.repo === p.repo && x.base === p.base);
    const i = lane.findIndex((x) => pullKey(x) === key);
    const ahead = i > 0 ? lane[i - 1] : undefined;
    if (ahead && !nextOpen.has(pullKey(ahead))) {
      const shared = sharedFiles(p.changed, ahead.changed);
      out.push({ ...ref(p), kind: "landing.prevMerged", merged: [ahead.number], shared, message: goAroundTextOf({ reason: "prevMerged", pr: p.number, head: p.head, flight: p.ticketKey, merged: [ahead.number], shared }) });
    }
  }
  return out;
}

export const sameStand = (c: Clearance, p: Pick<PullRequest, "standPath" | "ticketKey">) => Boolean((p.standPath && c.stand === p.standPath) || (!c.stand && p.ticketKey && c.flight === p.ticketKey));

// 이 head에 이미 나간 GO AROUND(취소되지 않은 것)
export function goAroundSent(p: Pick<PullRequest, "head" | "standPath" | "ticketKey" | "createdAt">, clearances: readonly Clearance[]): Clearance | undefined {
  const mark = `head ${p.head.slice(0, 7)}`;
  return clearances.find((c) => c.type === "GO AROUND" && !c.cancelledAt && c.at >= p.createdAt && c.text.includes(mark) && sameStand(c, p));
}

// 같은 PR에 한 시간 안에 GO AROUND가 이미 나갔으면 두 번째는 SUPERVISOR 몫이다(head가 달라도)
export const REPEAT_MS = 60 * 60_000;
export function goAroundRecent(p: Pick<PullRequest, "standPath" | "ticketKey" | "createdAt">, clearances: readonly Clearance[], now: number): Clearance | undefined {
  return clearances.findLast((c) => c.type === "GO AROUND" && !c.cancelledAt && c.at >= p.createdAt && now - Date.parse(c.at) < REPEAT_MS && sameStand(c, p));
}

// 브리핑의 landingQueue[].goAround(ATC-128). 상태에서 다시 만들어서 서버가 재시작돼 `reset: true`가 돼도(이벤트가 사라져도) 남는다.
// 원인 글은 이번 브리핑 이벤트에 있으면 그것을, 없으면 상태로 지은 글을 쓴다(머지된 PR·겹친 파일을 모르면 빼고).
//   action "send": TOWER가 holders에게 GO AROUND로 text 그대로 보낸다 · "sent": 이 head에는 이미 나갔다 · "supervisor": 보내지 않고 SUPERVISOR 몫
//   (한 시간 안 두 번째, 또는 holder 없음)
export interface GoAround {
  reason: GoAroundReason;
  text: string;
  head: string;
  action: "send" | "sent" | "supervisor";
  why: "no-holder" | "repeat" | null;
  clearance: string | null; // "sent"의 CLEARANCE id, "supervisor"(repeat)의 앞선 CLEARANCE id
}

const AHEAD = /PR ahead \(#(\d+)\)/;

export function goAroundOf(
  p: PullRequest,
  x: { clearances: readonly Clearance[]; events: readonly TrafficEvent[]; pulls: readonly PullRequest[]; lastLand: Clearance | undefined; holders: number; now: number },
): GoAround | null {
  const conflict = conflictOf(p);
  const aheadNr = Number(x.lastLand?.text.match(AHEAD)?.[1]) || null;
  // 앞 PR이 열린 목록에서 사라졌다 = 머지. LAND 글이 "앞 PR 머지 뒤 rebase"라고 했던 PR만
  const prevMerged = !conflict && p.landing === "CLEARED" && aheadNr != null && !x.pulls.some((o) => o.repo === p.repo && o.number === aheadNr);
  const reason: GoAroundReason | null = conflict ?? (prevMerged ? "prevMerged" : null);
  if (!reason) return null;
  const head = p.head.slice(0, 7);
  const kind = reason === "prevMerged" ? "landing.prevMerged" : "landing.conflict";
  const ev = x.events.findLast((e) => e.repo === p.repo && e.pull === p.number && e.head === head && e.kind === kind);
  const text = ev?.message ?? goAroundTextOf({ reason, pr: p.number, head: p.head, flight: p.ticketKey, merged: reason === "prevMerged" && aheadNr ? [aheadNr] : [], shared: [] });
  // 충돌·뒤처짐은 head마다 한 번. 앞 PR 머지는 그 LAND 뒤 PR마다 한 번(새 head를 push해도 다시 내지 않는다)
  const sent =
    reason === "prevMerged"
      ? x.clearances.find((c) => c.type === "GO AROUND" && !c.cancelledAt && x.lastLand && c.at >= x.lastLand.at && sameStand(c, p))
      : goAroundSent(p, x.clearances);
  if (sent) return { reason, text, head, action: "sent", why: null, clearance: sent.id };
  if (!x.holders) return { reason, text, head, action: "supervisor", why: "no-holder", clearance: null };
  const recent = goAroundRecent(p, x.clearances, x.now);
  if (recent) return { reason, text, head, action: "supervisor", why: "repeat", clearance: recent.id };
  return { reason, text, head, action: "send", why: null, clearance: null };
}
