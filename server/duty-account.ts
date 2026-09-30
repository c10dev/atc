// DUTY ACCOUNT(ATC-242, docs/duty.md "DUTY ACCOUNT as built"): DUTY가 돌 ACCOUNT를 설정 창에서 고르는 일. 순수.
// duty.json의 `account`에 쓴다. --resume은 설정 폴더를 넘어서 되지 않으므로(docs/accounts.md 1) ACCOUNT가 바뀌면 다음 spawn은 새 대화다.
import type { AccountFolder } from "./accounts.ts";

// 실제로 쓸 폴더. 등록된 라벨이면 그것, 아니면 ~/.claude(기본 폴더)로 돌아가고 경고한다. 기본 폴더도 없으면 null
export function effectiveDutyFolder(label: string, folders: readonly AccountFolder[], defaultDir: string): { folder: AccountFolder | null; warning: string | null } {
  const hit = folders.find((f) => f.label === label);
  if (hit) return { folder: hit, warning: null };
  const fallback = folders.find((f) => f.dir === defaultDir) ?? null;
  return { folder: fallback, warning: `DUTY ACCOUNT ${label}가 등록부에 없음 — ${fallback ? `${fallback.label}(~/.claude)로 돌린다` : "돌릴 폴더가 없다"}` };
}

// PUT /api/settings의 dutyAccount 검사. 등록된 라벨만. 빈 값·모르는 라벨은 거절
export function dutyAccountPatchOf(raw: unknown, registered: readonly string[]): { ok: true; label: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "등록부의 ACCOUNT 라벨이어야 함" };
  const label = raw.trim();
  if (!registered.includes(label)) return { ok: false, error: `등록되지 않은 ACCOUNT: ${label}${registered.length ? ` (등록: ${registered.join(", ")})` : ""}` };
  return { ok: true, label };
}

// 다음 spawn이 --resume을 써도 되는가. 저장된 대화가 시작된 ACCOUNT(없으면 옛 파일: 예전처럼 이어 간다)가 지금 ACCOUNT와 같을 때만
export const canResumeOn = (startedOn: string | null, account: string): boolean => startedOn === null || startedOn === account;
