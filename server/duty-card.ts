// DUTY 카드와 QUEUE 줄의 보기 계산(ATC-230, docs/duty.md 3.2·5장 D3). 순수. 화면(web/src/DutyDrawer.tsx)과 시험이 같이 쓴다.
// 카드는 큐 줄 자체다: 그릴 때 지금의 큐에서 `<kind>/<key>`를 읽는다. 줄이 큐를 떠나면 회색이 된다. 스스로 다시 확인하지 않는다(서버의 답이 진실).
import type { QueueItem, QueueKind } from "./supervisor-queue.ts";

export type CardAction =
  | { type: "inline"; op: "fleet-plan" | "update" | "proposal" | "schedule" } // 이 화면의 기존 길을 부르는 버튼(SUPERVISOR의 결정)
  | { type: "link"; label: string; hash: string }; // 그 화면을 연다. 판정은 거기서 한다

export type CardView =
  | { state: "live"; item: QueueItem; actions: CardAction[] }
  | { state: "gone"; reason: "처리됨" | "큐에서 빠짐" }
  | { state: "unknown" }; // 큐를 아직 못 읽었다(회색이 아니다)

type AirportRef = { name: string; code: string; repo: string };

// 저장소 경로 끝 마디(큐의 LANDING·HUMAN CHECK key는 `<저장소>#<번호>@<head>`)
const repoName = (repo: string) => repo.replace(/\/+$/, "").split("/").pop() || repo;

// LANDING·HUMAN CHECK key → 저장소 이름과 PR 번호
export function prOfKey(key: string): { repo: string; number: number } | null {
  const m = /^(.+)#(\d+)@/.exec(key);
  return m ? { repo: m[1]!, number: Number(m[2]) } : null;
}

// DISPATCH 카드(ATC-377)를 승인·거절하면 무슨 일이 일어나는지 한 문장. 카드의 종류가 가른다: ASSIGN은 FLIGHT PLAN, launch는 세션 LAUNCH가 먼저, RELEASE는 승인에서 끝(FLIGHT PLAN 없음)
export function proposalAskOf(id: string, ask: "approve" | "reject", card: Pick<NonNullable<QueueItem["card"]>, "kind" | "launch"> | undefined): string {
  if (ask === "reject") return `${id}를 거절합니다. 같은 짝은 24시간 다시 제안하지 않습니다.`;
  if (card?.kind === "RELEASE") return `${id}를 승인하면 이 FLIGHT의 RELEASE(STAND 없이 오래 ENROUTE인 FLIGHT의 정리)가 승인됩니다. FLIGHT PLAN은 보내지 않고, Linear에서의 정리는 SUPERVISOR가 합니다.`;
  if (card?.launch) return `${id}를 승인하면 atc가 세션이 없는 AIRCRAFT를 LAUNCH하고(사용량을 씁니다), 새 세션이 뜬 뒤 DISPATCH가 FLIGHT PLAN을 보냅니다.`;
  return `${id}를 승인하면 DISPATCH가 그 AIRCRAFT에게 FLIGHT PLAN을 보냅니다.`;
}

// SCHEDULE 초안(ATC-378)을 승인·거절하면 무슨 일이 일어나는지 한 문장. TARGET·ROUTE는 적용하는 길이 아직 없어 그림자 판정(동의·거절)만 기록한다
export const NETWORK_KINDS: ReadonlySet<string> = new Set(["TARGET", "ROUTE"]);
export function scheduleAskOf(id: string, ask: "approve" | "reject", kind: string): string {
  if (NETWORK_KINDS.has(kind)) return ask === "approve" ? `${id}(${kind})에 동의로 기록합니다. 적용하는 길이 아직 없어 Linear나 FLEET에는 아무것도 쓰지 않습니다.` : `${id}(${kind})를 거절로 기록합니다. 아무것도 쓰지 않습니다.`;
  if (ask === "reject") return `${id}를 거절합니다. 아무것도 Linear에 쓰지 않습니다.`;
  if (kind === "CLOSE") return `${id}를 승인하면 이 FLIGHT를 닫아도 된다고 기록합니다. 이슈 상태는 OCC가 바꾸지 않으니, Linear에서 직접 Done으로 바꿉니다.`;
  return `${id}를 승인하면 OCC가 다음 바퀴에 ${kind} 변경을 Linear에 씁니다.`;
}

// 큐 줄 하나의 버튼. 인라인은 FLEET PLAN(동의·거절·승인), UPDATE, DISPATCH 카드(승인·거절, ATC-377), SCHEDULE 초안(승인·거절, ATC-378)뿐. GO는 서버에 SUPERVISOR의 길이 없어 AIRCRAFT 링크다
export function actionsOf(item: Pick<QueueItem, "kind" | "key">, airports: readonly AirportRef[]): CardAction[] {
  switch (item.kind) {
    case "FLEET PLAN":
      return [{ type: "inline", op: "fleet-plan" }];
    case "UPDATE":
      return [{ type: "inline", op: "update" }];
    case "PROPOSAL":
      return [{ type: "inline", op: "proposal" }]; // 자동 운항이 꺼져 있거나 RELEASE 카드: 큐 줄에서 승인·거절(ATC-377)
    case "SCHEDULE":
      return [{ type: "inline", op: "schedule" }]; // 큐 줄에서 승인·거절(ATC-378). SCHEDULE 탭은 없다
    case "HUMAN CHECK":
      return [{ type: "link", label: "HOME에서 확인", hash: "#home" }];
    case "RELAY": // key가 LANDING과 같은 `<저장소>#<번호>@…`
    case "LANDING": {
      const pr = prOfKey(item.key);
      const ap = pr && airports.find((a) => repoName(a.repo) === pr.repo || a.name === pr.repo);
      return [pr && ap ? { type: "link", label: `PR #${pr.number} 열기`, hash: `#pr/${ap.code}/${pr.number}` } : { type: "link", label: "FLIGHTS에서 보기", hash: "#flights" }];
    }
    case "UNDELIVERED":
      return [{ type: "link", label: "AIRCRAFT 보기(FLEET)", hash: "#fleet" }];
    case "BACKLOG":
      return [{ type: "link", label: "RELEASE에서 발권·버리기", hash: "#release" }]; // 제안(ATC-401): 한 번의 클릭으로 쏘거나 버린다
    case "NEEDS YOU":
    case "GO":
      return [{ type: "link", label: "AIRCRAFT 보기(FLEET)", hash: "#fleet" }];
  }
}

// items: 지금의 큐(아직 못 읽었으면 null). handled: 이 화면에서 누른 결정이 받아들여졌다
export function cardViewOf(ref: { queueKind: string; key: string }, items: readonly QueueItem[] | null, handled: boolean, airports: readonly AirportRef[]): CardView {
  if (handled) return { state: "gone", reason: "처리됨" };
  if (items === null) return { state: "unknown" };
  const item = items.find((i) => i.kind === ref.queueKind && i.key === ref.key);
  if (!item) return { state: "gone", reason: "큐에서 빠짐" };
  return { state: "live", item, actions: actionsOf(item, airports) };
}

// QUEUE 줄 머리: `QUEUE 4 · PROPOSAL 1 · FLEET PLAN 1`(0인 kind는 뺀다, 순서는 서버가 준 counts의 순서).
// 화면에서 쓰는 파일이라 supervisor-queue.ts를 값으로 들이지 않는다(그쪽은 node 모듈을 끌어온다)
export function queueHeadOf(counts: Partial<Record<QueueKind, number>>, total: number): string {
  const parts = Object.entries(counts).filter(([, n]) => (n ?? 0) > 0).map(([k, n]) => `${k} ${n}`);
  return `QUEUE ${total}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
}

// 카드가 "처리됨"인지 기억하는 키
export const cardKey = (c: { queueKind: string; key: string }) => `${c.queueKind}/${c.key}`;
