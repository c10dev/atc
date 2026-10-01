// DUTY 카드와 QUEUE 줄의 보기 계산(ATC-230, docs/duty.md 3.2·5장 D3). 순수. 화면(web/src/DutyDrawer.tsx)과 시험이 같이 쓴다.
// 카드는 큐 줄 자체다: 그릴 때 지금의 큐에서 `<kind>/<key>`를 읽는다. 줄이 큐를 떠나면 회색이 된다. 스스로 다시 확인하지 않는다(서버의 답이 진실).
import type { QueueItem, QueueKind } from "./supervisor-queue.ts";

export type CardAction =
  | { type: "inline"; op: "fleet-plan" | "update" } // 이 화면의 기존 길을 부르는 버튼(SUPERVISOR의 결정)
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

// 큐 줄 하나의 버튼. 인라인은 FLEET PLAN(동의·거절·승인)과 UPDATE뿐. GO는 서버에 SUPERVISOR의 길이 없어 AIRCRAFT 링크다
export function actionsOf(item: Pick<QueueItem, "kind" | "key">, airports: readonly AirportRef[]): CardAction[] {
  switch (item.kind) {
    case "FLEET PLAN":
      return [{ type: "inline", op: "fleet-plan" }];
    case "UPDATE":
      return [{ type: "inline", op: "update" }];
    case "PROPOSAL":
      return [{ type: "link", label: "DISPATCH에서 판정", hash: "#dispatch" }];
    case "SCHEDULE":
      return [{ type: "link", label: "SCHEDULE에서 판정", hash: "#schedule" }];
    case "HUMAN CHECK":
      return [{ type: "link", label: "STRIPS에서 보기", hash: "#strips" }];
    case "RELAY": // key가 LANDING과 같은 `<저장소>#<번호>@…`
    case "LANDING": {
      const pr = prOfKey(item.key);
      const ap = pr && airports.find((a) => repoName(a.repo) === pr.repo || a.name === pr.repo);
      return [pr && ap ? { type: "link", label: `PR #${pr.number} 열기`, hash: `#pr/${ap.code}/${pr.number}` } : { type: "link", label: "STRIPS에서 보기", hash: "#strips" }];
    }
    case "UNDELIVERED":
      return [{ type: "link", label: "AIRCRAFT 보기(FLEET)", hash: "#fleet" }];
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
