// NEEDS YOU 힌트(ATC-252): 백그라운드 AIRCRAFT가 `EnterWorktree path=`로 .claude/worktrees 밖에 들어가려다 승인에서 멈춘 경우. 순수
export const STAND_NEEDS_HINT = "STAND outside .claude/worktrees — attach and approve; see CREW BRIEFING";

export function standNeedsHint(needs: string | null | undefined): string | null {
  return needs && /entering worktree/i.test(needs) ? STAND_NEEDS_HINT : null;
}
