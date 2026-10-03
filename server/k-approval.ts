import { type K3Declaration, releaseIdOf } from "./k3-allow.ts";
import { migrationPathOf, secretPathOf } from "./landing.ts";
import { type ReleaseChannel, type ReleaseView, releaseStateOf } from "./release.ts";

// K 승인이 착륙까지(ATC-391, docs/autonomy.md 6장 "The three kept gates, declared at release"). 순수 함수만.
// SUPERVISOR는 K1–K3를 발권할 때 한 번 승인한다. 승인한 것을 그대로 만든 user 등급 PR은 다른 PR처럼 MCC가 착륙시킨다. 선언을 넘는 변경이나 의심은 SUPERVISOR에게 돌아온다.
// 이 함수는 landBlocksOf(mcc.ts)의 L3("user 등급 — 사용자가 머지")를 풀지 말지만 정한다. INSPECTION pass(L6)·CI(L4)·그 밖의 조건은 그대로 landBlocksOf가 본다.
//
// 선언은 ATC-372가 읽는 모양 하나뿐이다: 이슈 본문 `## K effects`의 `K3[<라벨>]: <바꾸는 통제> | files: <경로, …>` 줄(k3-allow.ts). K1(마이그레이션·상태 기록)과 K2(비밀·권리)를 읽는 선언은 아직 없어서,
// 그런 경로가 diff에 있으면 이 길로는 착륙시키지 않는다(SUPERVISOR 몫). 선언한 파일 밖의 user 등급 파일이 있으면 선언을 넘은 것이다(새 화살).

// 이 검사 자체를 바꾸는 파일(스스로를 승인하지 않는다, 원칙 3). 둘로 나눈다:
//  CHECK_CORE: 검사의 규칙과 길 그 자체. 이 파일을 고친 PR은 **어느 착륙 등급이든** SUPERVISOR 몫이다(landBlocksOf가 모든 등급에 L3를 건다).
//    landing-tier에서 대부분 auto·flagged라서, 여기를 user 등급 판정에만 맡기면 규칙을 푸는 PR이 INSPECTION 한 번으로 착륙한다. 이 목록 파일도 목록에 든다.
//  CHECK_CONTEXT: 검사가 기대는 곳(스위치를 바꾸는 길, 선언을 읽는 곳, 경로 규칙, CI). 많은 PR이 건드려서(server/index.ts는 거의 모든 라우트 PR) 모든 등급에 L3를 걸지 않고,
//    user 등급 PR이 K 승인으로 착륙하려 할 때만 막는다(check-itself).
// 경로가 `/`로 끝나면 그 폴더 전체
export const CHECK_CORE: readonly string[] = [
  "server/k-approval.ts",
  "server/k3-allow.ts",
  "server/mcc.ts",
  "server/mcc-run.ts",
  "server/land-by.ts",
  "server/release.ts",
  "server/release-run.ts",
  "server/release-store.ts",
];
export const CHECK_CONTEXT: readonly string[] = [
  "server/origin.ts", // 스위치를 SUPERVISOR만 바꾸게 하는 검사
  "server/supervisor-auth.ts",
  "server/settings.ts", // 스위치를 쓰는 길
  "server/index.ts", // supervisorGate를 거는 곳
  "server/landing.ts", // migrationPathOf·secretPathOf: k1-k2를 가르는 규칙
  "server/sources/linear.ts", // K3 선언과 발권 해시를 읽는 곳
  ".github/", // L4가 보는 CI 체크 자체
  "deploy/",
  "mcc/", // MCC의 매뉴얼·inspector·guard
];
export const CHECK_PATHS: readonly string[] = [...CHECK_CORE, ...CHECK_CONTEXT];
const hit = (paths: readonly string[], files: readonly string[]) => files.find((f) => paths.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p))) ?? null;
export const checkPathOf = (files: readonly string[]): string | null => hit(CHECK_PATHS, files); // user 등급 PR의 K 승인 판정이 쓴다(check-itself)
export const corePathOf = (files: readonly string[]): string | null => hit(CHECK_CORE, files); // 모든 등급의 L3(mcc-run.ts judge)

export type KCode = "off" | "check-itself" | "no-flight" | "flight-closed" | "no-release" | "stale" | "attested-only" | "no-declaration" | "unreadable-declaration" | "beyond-declaration" | "k1-k2";
export type KVerdict =
  | { ok: true; release: string; flight: string; channel: ReleaseChannel; effects: string[]; files: string[] }
  | { ok: false; code: KCode; why: string; files?: string[] };

export interface KInput {
  mode: "on" | "off";
  flight: string | null;
  files: readonly string[];
  userFiles: readonly string[]; // landing-tier가 user로 본 파일
  declared: readonly K3Declaration[] | undefined; // 이슈 본문의 읽힌 K3 선언
  unparsed: number; // 읽히지 않은 K3 줄 수
  stateType?: string | null; // FLIGHT 이슈의 상태 종류. unstarted·started만 열린 FLIGHT고, 끝났거나 모르면 발권은 K 권한을 주지 않는다
  hash: string | null | undefined; // 지금 이슈 본문의 해시
  releases: ReleaseView | null | undefined;
}

const no = (code: KCode, why: string, files?: string[]): KVerdict => ({ ok: false, code, why, ...(files ? { files } : {}) });
const short = (files: readonly string[]) => files.slice(0, 4).join(", ") + (files.length > 4 ? ` 외 ${files.length - 4}개` : "");

// 발권 때 승인한 K 효과 안에서 만든 PR인가. ok면 L3를 풀고, 아니면 이유를 L3 문구에 붙인다
export function kApprovalOf(x: KInput): KVerdict {
  if (x.mode === "off") return no("off", "K 승인 착륙 스위치가 꺼져 있음");
  const self = checkPathOf(x.files);
  if (self) return no("check-itself", `이 검사 자체를 바꾸는 PR(${self}) — 늘 사용자가 머지`);
  // 선언을 읽을 수 없는 K 종류: 마이그레이션·SQL(K1), 비밀·키 경로(K2)
  const k12 = migrationPathOf([...x.files]) ?? secretPathOf(x.files);
  if (k12) return no("k1-k2", `K1·K2 경로(${k12})는 아직 이 길로 착륙시키지 않음 — 사용자가 머지`);
  if (!x.flight) return no("no-flight", "PR에 FLIGHT가 없어 발권 기록을 찾을 수 없음");
  // 한 발권은 FLIGHT가 열려 있는 동안만 K 권한을 준다: 끝났거나 취소된 FLIGHT의 이름을 빌려 같은 파일을 다시 고치는 PR은 새 화살이다
  // 열려 있다고 아는 FLIGHT만(unstarted·started). 모르는 상태(없음·null·낯선 값)는 닫는 쪽으로 틀린다
  if (x.stateType !== "unstarted" && x.stateType !== "started") return no("flight-closed", `${x.flight}의 상태가 열려 있지 않거나 알 수 없음(${x.stateType ?? "모름"}) — 그 발권은 착륙시키지 않음`);
  const state = releaseStateOf(x.flight, x.hash, x.releases);
  if (state === "unreleased") return no("no-release", `${x.flight}에 발권 기록이 없음`);
  if (state === "stale") return no("stale", `${x.flight}는 발권 뒤 목표·완료 기준·K 효과가 바뀜 — 다시 발권`);
  const record = x.releases!.records[x.flight]!;
  // 화면 클릭과 DUTY 채팅만 서버가 확인할 수 있는 길이다. attested는 agent가 쓸 수 있는 글이라 K 권한을 실어 주지 않는다: SUPERVISOR가 RELEASE 화면에서 한 번 더 눌러야 한다(발권 때의 일)
  const confirmed = record.kConfirm !== undefined && record.kConfirm.hash === record.hash;
  if (record.channel === "attested" && !confirmed) return no("attested-only", `${x.flight}의 발권은 attested뿐 — SUPERVISOR가 RELEASE 화면에서 K 효과를 한 번 확인해야 함`);
  if (x.unparsed > 0) return no("unreadable-declaration", `${x.flight}의 K3 선언 ${x.unparsed}줄을 읽지 못함 — 선언 모양을 고쳐 다시 발권`);
  const declared = x.declared ?? [];
  if (!declared.length) return no("no-declaration", `${x.flight}에 읽히는 K3 선언이 없음 — 발권 때 선언한 K 효과가 있어야 함`);
  const covered = new Set(declared.flatMap((d) => d.files));
  const beyond = x.userFiles.filter((f) => !covered.has(f));
  if (beyond.length) return no("beyond-declaration", `선언한 파일 밖의 user 등급 변경: ${short(beyond)} — 새 화살(SUPERVISOR)`, beyond);
  const files = x.userFiles.filter((f) => covered.has(f));
  return { ok: true, release: releaseIdOf(x.flight, record), flight: x.flight, channel: record.channel, effects: declared.map((d) => `K3[${d.label}] ${d.control}`), files: [...files] };
}

// L3 문구에 붙이는 한 줄
export const kWhyOf = (v: KVerdict | null | undefined): string => (v && !v.ok ? `K 승인 아님: ${v.why}` : "");

// ── 센다(ATC-391): K 승인으로 착륙한 PR과 그 뒤 ──
// 착륙한 날 기준. reverted: 그 PR의 자동 되돌림 PR이 열렸다(auto-revert.jsonl의 revert-opened). rolledBack: 착륙한 뒤 처음 나온 RTS 결과가 ROLLBACK이다(그 PR을 실은 배포가 되돌려짐).
// 사람이 GitHub에서 손으로 되돌린 것은 알 수 없어 세지 못한다.
export interface KLanded {
  at: string;
  pr: number;
  release: string;
}
export interface KDay {
  day: string; // 착륙한 UTC 날짜
  landed: number;
  reverted: number;
  rolledBack: number;
}
export function kLandDaysOf(
  lands: readonly KLanded[],
  reverts: readonly { op: string; pr?: number }[],
  rts: readonly { at: string; result: string }[],
  days: number,
  now: number,
): KDay[] {
  const out = new Map<string, KDay>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    out.set(day, { day, landed: 0, reverted: 0, rolledBack: 0 });
  }
  const revertedPrs = new Set(reverts.filter((l) => l.op === "revert-opened" && l.pr != null).map((l) => l.pr as number));
  const outcomes = rts.filter((r) => r.result === "ok" || r.result === "rollback").sort((a, b) => a.at.localeCompare(b.at));
  const seen = new Set<string>();
  for (const l of lands) {
    const d = out.get(l.at.slice(0, 10));
    if (!d || seen.has(`${l.pr}`)) continue;
    seen.add(`${l.pr}`);
    d.landed++;
    if (revertedPrs.has(l.pr)) d.reverted++;
    if (outcomes.find((r) => r.at > l.at)?.result === "rollback") d.rolledBack++;
  }
  return [...out.values()];
}
