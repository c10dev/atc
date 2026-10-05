// 정리 줄(`alert|cleanup`)에 실리는 남은 STAND(ATC-543). 순수
// 닫힌(Done·Canceled·Duplicate) FLIGHT의 STAND와 종료된 세션이 점유했던 STAND를, 경로·변경 수·미푸시 커밋 수와 함께 보인다.
// 둘 다 0일 때만 `git -C <checkout> worktree remove <path>`를 보인다. atc는 이 명령을 실행하지 않는다

const CLOSED = new Set(["completed", "canceled", "duplicate"]);

export interface CleanupStand {
  path: string;
  name: string;
  flight: string | null;
  why: "closed-flight" | "ended-claim" | "unattended";
  changes: number | null; // 커밋 안 된 변경 파일 수(모르면 null)
  unpushed: number | null; // 어느 원격에도 없는 커밋 수(모르면 null)
  command: string | null; // 둘 다 0일 때만
  lost: string | null; // 명령이 없을 때: 지우면 잃는 것
}

export interface CleanupWs {
  path: string;
  name?: string;
  repo?: string;
  isMain?: boolean;
  ticketKey: string | null;
  dirty?: number | null;
  unpushed?: number | null;
}

// 셸이 풀지 않게 작은따옴표로 감싼다
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const nameOfPath = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

export function removeCommandOf(w: Pick<CleanupWs, "path" | "repo" | "dirty" | "unpushed">): { command: string | null; lost: string | null } {
  const changes = w.dirty ?? null;
  const unpushed = w.unpushed ?? null;
  if (changes === 0 && unpushed === 0 && w.repo) return { command: `git -C ${q(w.repo)} worktree remove ${q(w.path)}`, lost: null };
  const parts: string[] = [];
  if (changes === null) parts.push("변경 수를 모름");
  else if (changes > 0) parts.push(`커밋 안 된 변경 ${changes}개`);
  if (unpushed === null) parts.push("미푸시 커밋 수를 모름");
  else if (unpushed > 0) parts.push(`푸시 안 된 커밋 ${unpushed}개`);
  if (!w.repo) parts.push("본 체크아웃을 모름");
  return { command: null, lost: `지우면 ${parts.join(", ")}` };
}

export function standOf(w: CleanupWs, why: CleanupStand["why"]): CleanupStand {
  const { command, lost } = removeCommandOf(w);
  return { path: w.path, name: w.name || nameOfPath(w.path), flight: w.ticketKey, why, changes: w.dirty ?? null, unpushed: w.unpushed ?? null, command, lost };
}

// 닫힌 FLIGHT의 남은 STAND: 본 체크아웃이 아니고, 살아 있는 세션이 점유하지 않는다
export function closedFlightStandsOf(inp: {
  workspaces: readonly CleanupWs[];
  tickets: readonly { key: string; stateType: string }[];
  held: ReadonlySet<string>; // 살아 있는 세션이 지금 점유한 STAND 경로
}): CleanupStand[] {
  const out: CleanupStand[] = [];
  for (const w of inp.workspaces) {
    if (w.isMain || !w.ticketKey || inp.held.has(w.path)) continue;
    const t = inp.tickets.find((x) => x.key === w.ticketKey);
    if (t && CLOSED.has(t.stateType)) out.push(standOf(w, "closed-flight"));
  }
  return out;
}

// 한 STAND의 줄: "TEAM_x-stand — 변경 0 · 미푸시 0 → git -C … worktree remove …" 또는 "… — 지우면 …"
export const standLineOf = (s: CleanupStand): string => `${s.path} — 변경 ${s.changes ?? "?"} · 미푸시 ${s.unpushed ?? "?"} → ${s.command ?? s.lost}`;
