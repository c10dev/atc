// UPDATE bar(ATC-82, docs/mcc.md 6장 뒤 "UPDATE bar as built"): 서비스가 origin/main보다 뒤일 때 화면 상단에 알리고
// SUPERVISOR가 RETURN TO SERVICE를 시작한다. 이 파일은 순수 계산만: 화면도 import하므로 node 모듈을 부르지 않는다.
import type { CiState, RtsRecord } from "./mcc.ts";

export interface RangePr {
  number: number;
  title: string;
}

// 머지 커밋 메시지들에서 PR(번호, 제목). atc는 merge 커밋을 쓴다("Merge pull request #7 from a/b\n\n제목").
// 스쿼시("제목 (#7)")도 읽는다. 같은 번호는 한 번만, 오래된 것부터
export function prsOfMessages(messages: readonly string[]): RangePr[] {
  const out: RangePr[] = [];
  for (const m of messages) {
    const [first = "", ...rest] = m.split("\n");
    const merge = first.match(/^Merge pull request #(\d+) from \S+/);
    const squash = first.match(/^(.*\S)\s+\(#(\d+)\)$/);
    const pr: RangePr | null = merge
      ? { number: Number(merge[1]), title: rest.find((l) => l.trim())?.trim() ?? first }
      : squash
        ? { number: Number(squash[2]), title: squash[1] }
        : null;
    if (pr && !out.some((p) => p.number === pr.number)) out.push(pr);
  }
  return out;
}

// deploy/rts.mjs planRts의 시그니처(deploy/는 사용자 등급이라 런타임에 읽는다)
export type PlanRts = (x: {
  branch: string;
  dirty: boolean;
  head: string;
  service: string | null;
  target: string;
  ancestor: boolean;
  ci: string;
  files: string[];
}) => { action: "go" | "noop" | "refuse"; reason: string };

// 시작하기 전에 알 수 있는 거절: 범위가 package*.json이나 deploy/*.service·*.timer를 바꾸면 사람이 배포한다.
// planRts를 그대로 부른다(체크아웃 상태는 정상이라 가정하고 범위만 본다) — 같은 규칙이 두 곳에 있지 않게
export function rangeRefusalOf(planRts: PlanRts, deployed: string, main: string, files: readonly string[]): string | null {
  const plan = planRts({ branch: "main", dirty: false, head: deployed, service: deployed, target: main, ancestor: true, ci: "ok", files: [...files] });
  return plan.action === "refuse" ? plan.reason : null;
}

export type UpdateKind =
  | "current" // 서비스가 최신(또는 비교할 수 없음): 막대 없음
  | "available" // [업데이트] 버튼
  | "waiting" // 곧 됨: CI 진행 중
  | "manual" // 사람이 배포(범위 사유, 시험 서버)
  | "starting" // 시작을 눌렀고 rts.jsonl이 아직 running이 아님
  | "running"
  | "refused" // 마지막 시도를 RTS가 거절함
  | "failed"
  | "rollback";

export interface UpdateInput {
  deployed: string | null;
  main: string | null;
  mainCi: CiState;
  due: { due: boolean; why: string }; // rtsDueOf
  stop: string | null; // rtsStopOf(진행 중·ROLLBACK 뒤 멈춤)
  last: RtsRecord | null; // rts.jsonl 마지막 줄
  lastStartAt: string | null; // mcc.jsonl의 마지막 rts 시작
  rangeRefusal: string | null;
  guard: string | null; // 이 서버가 유닛을 시작할 수 없는 사유(시험 서버)
  now: number;
}

export const STARTING_MS = 2 * 60_000; // 시작한 뒤 rts.jsonl에 running이 보이기를 기다리는 시간

const same = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

export function updateStateOf(x: UpdateInput): { kind: UpdateKind; why: string } {
  const { last } = x;
  if (last?.result === "running") return { kind: "running", why: `RTS 진행 중(${last.to.slice(0, 7)})` };
  if (x.stop) return { kind: "rollback", why: x.stop };
  if (!x.deployed || !x.main) return { kind: "current", why: x.due.why };
  if (same(x.deployed, x.main)) return { kind: "current", why: "서비스가 최신" };
  const started = x.lastStartAt ? Date.parse(x.lastStartAt) : NaN;
  if (Number.isFinite(started) && x.now - started < STARTING_MS && !(last && Date.parse(last.at) >= started)) return { kind: "starting", why: "RTS를 시작함" };
  // 마지막 시도가 지금 main을 향한 거절·실패이고 이 시작의 결과일 때만 사유를 보인다
  if (last && (last.result === "refused" || last.result === "failed") && same(last.to, x.main) && Number.isFinite(started) && Date.parse(last.at) >= started)
    return { kind: last.result, why: last.detail ?? (last.result === "refused" ? "RTS가 거절함" : "RTS 실패") };
  if (x.rangeRefusal) return { kind: "manual", why: x.rangeRefusal };
  if (x.guard) return { kind: "manual", why: x.guard };
  if (!x.due.due) return { kind: "waiting", why: x.due.why };
  return { kind: "available", why: x.due.why };
}

export interface UpdateStatus {
  kind: UpdateKind;
  why: string;
  deployed: string | null; // 서비스가 시작한 커밋(전체)
  main: string | null;
  mainCi: CiState;
  prs: RangePr[] | null; // 둘 사이에 머지된 PR. 읽지 못했으면 null
  refusal: string | null; // 시작 전에 아는 거절(범위)
  last: RtsRecord | null;
  auto?: { on: boolean; nextAt: string | null }; // 자동 배포(ATC-84, mcc 모드 rts·land+rts): 켜짐이고 5분 간격을 기다리는 중이면 다음 시각
  at: string;
}

// 화면이 그리는 상태. status는 서버, 나머지는 이 탭이 아는 것
export type BarKind = UpdateKind | "restarting" | "done";
export interface BarInput {
  status: UpdateStatus | null; // 마지막으로 받은 것(재시작 중엔 옛 것)
  connection: "connecting" | "live" | "lost";
  clicked: boolean; // 이 탭에서 [업데이트]를 눌렀다
  seenBusy: boolean; // 이 탭이 starting·running·restarting을 본 적이 있다(끝나면 done)
}
export function barKindOf(x: BarInput): BarKind | null {
  const kind = x.status?.kind;
  const busy = kind === "starting" || kind === "running";
  // 재시작 중: 연결이 끊겼고 RTS를 하던 참이면 "연결 끊김"이 아니라 재시작으로 보인다
  if (x.connection === "lost" && (busy || x.seenBusy)) return "restarting";
  if (!kind) return null;
  if (kind === "available" && x.clicked) return "starting";
  if (kind === "current") return x.seenBusy ? "done" : null;
  return kind;
}
