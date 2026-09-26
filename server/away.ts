import type { Snapshot } from "./model.ts";

// 원정 운항: 세션의 소속 공항(작업 폴더가 있는 저장소)이 아닌 공항의 주기장을 점유 중인 것.
// 소속을 모르는 세션(저장소 밖에서 연 세션)은 원정으로 치지 않는다. 이양된 점유는 제외한다.
// 반환: 세션 id → 원정 중인 저장소 경로들(정렬)
export function awayOperations(s: Pick<Snapshot, "sessions" | "workspaces" | "claims">): Map<string, string[]> {
  const home = new Map(s.sessions.map((x) => [x.id, x.repo]));
  const repoOf = new Map(s.workspaces.map((w) => [w.path, w.repo]));
  const away = new Map<string, Set<string>>();
  for (const c of s.claims) {
    if (c.state !== "active") continue;
    const base = home.get(c.sessionId);
    const at = repoOf.get(c.workspacePath);
    if (!base || !at || at === base) continue;
    away.set(c.sessionId, (away.get(c.sessionId) ?? new Set()).add(at));
  }
  return new Map([...away].map(([id, repos]) => [id, [...repos].sort()]));
}
