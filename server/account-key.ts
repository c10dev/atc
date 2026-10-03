import { type AccountFolder, DEFAULT_FOLDER_LABEL } from "./accounts.ts";
import { accountOf, type FleetFile } from "./crew.ts";

// 사용 한도로 붙드는 ACCOUNT(ATC-51)의 키(ATC-490). 같은 폴더를 가리키는 라벨은 같은 ACCOUNT다 — FLEET 경보와 DISPATCH의 ACCOUNT HOLD가 이 한 함수를 쓴다.
// 순수 함수: 폴더 목록(accountFolders())은 부르는 쪽이 넘긴다. fleet.json의 profile 라벨은 고치지 않는다.

// 라벨 → 그 폴더의 등록부 라벨. `default`는 ~/.claude이고, 등록부가 ~/.claude를 가리키는 항목이 있으면 그 항목과 같은 ACCOUNT다(docs/accounts.md "`~/.claude` without an entry").
// 폴더를 모르는 라벨(등록부가 비었거나 옛 라벨)은 그대로 둔다
export function canonicalAccount(label: string, folders: readonly AccountFolder[], defaultDir?: string): string {
  const folder = folders.find((f) => f.label === label) ?? (label === DEFAULT_FOLDER_LABEL && defaultDir ? folders.find((f) => f.dir === defaultDir) : undefined);
  if (!folder) return label;
  return folders.find((f) => f.dir === folder.dir && f.registered)?.label ?? folder.label;
}

// 붙들 때 쓰는 ACCOUNT: 세션이 실제로 도는 폴더의 라벨(관찰한 값)이 먼저, 없으면 home 라벨(fleet.json). 라벨을 쓰지 않는 등록부(accountOf가 null)는 null — 계정을 모른다
export function holdAccountOf(
  fleet: Pick<FleetFile, "aircraft" | "control">,
  who: { name: string; account?: string | null },
  folders: readonly AccountFolder[],
  defaultDir?: string,
): string | null {
  const home = accountOf(fleet, who.name);
  if (home === null) return null;
  return canonicalAccount(who.account ?? home, folders, defaultDir);
}
