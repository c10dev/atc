import { join } from "node:path";

// DUTY L1의 STAND(D7a, docs/duty.md 3.4): `.claude/worktrees/duty-<이름>`, 브랜치 `claude/duty-<이름>`. 순수 판정만 있다.
// git 명령은 서버가 돌린다(duty-stand-run.ts). 모델은 이름만 준다. duty/guard.mjs의 STAND_DIR·DUTY_BRANCH와 같은 모양이다(duty-stand.test.ts가 맞춘다).
export const STAND_NAME_MAX = 40;
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type NameParse = { ok: true; name: string } | { ok: false; error: string };

// 소문자·숫자·하이픈, 40자까지. ATC key(`atc-<n>`)는 넣지 않는다(설계 PR의 제목·브랜치에 key를 쓰지 않는 규칙, 루트 CLAUDE.md)
export function standNameOf(raw: unknown): NameParse {
  if (typeof raw !== "string" || !raw) return { ok: false, error: "이름이 필요함(소문자·숫자·하이픈)" };
  if (raw.length > STAND_NAME_MAX) return { ok: false, error: `이름은 ${STAND_NAME_MAX}자까지` };
  if (!NAME.test(raw)) return { ok: false, error: "이름은 소문자·숫자·하이픈만(앞뒤·겹친 하이픈 없이)" };
  if (/^atc-\d/.test(raw) || /(^|-)atc-\d+(-|$)/.test(raw)) return { ok: false, error: "이름에 ATC key(atc-<n>)를 넣지 않는다 — 설계 PR의 브랜치에는 key를 쓰지 않는다" };
  return { ok: true, name: raw };
}

export const standDirName = (name: string) => `duty-${name}`;
export const standBranch = (name: string) => `claude/duty-${name}`;
export const standPath = (repo: string, name: string) => join(repo, ".claude", "worktrees", standDirName(name));

// `git worktree list --porcelain`의 worktree 경로들(순수)
export function worktreePaths(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
}

// stand-done: 없애도 되나. 지금 STAND로 등록돼 있어야 하고, 고치던 것이 없거나(clean) 브랜치가 이미 origin/main에 들어간(merged) 때만.
export interface StandFacts {
  registered: boolean;
  dirty: boolean;
  merged: boolean;
}
export type DoneVerdict = { ok: true; force: boolean } | { ok: false; status: 404 | 409; error: string };
export function standDoneVerdict(f: StandFacts): DoneVerdict {
  if (!f.registered) return { ok: false, status: 404, error: "그런 DUTY STAND가 없음" };
  if (f.dirty && !f.merged) return { ok: false, status: 409, error: "커밋하지 않은 변경이 있고 아직 머지되지 않았다 — 커밋·푸시하거나 SUPERVISOR에게 알린다" };
  return { ok: true, force: f.dirty };
}
