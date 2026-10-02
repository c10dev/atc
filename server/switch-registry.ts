import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeclarations } from "./declarations.ts";
import { applyOrderOf, checkValue, type SwitchDecl, type SwitchView, viewsOf } from "./switch-def.ts";

// SWITCH REGISTRY(ATC-393): server/switches/ 폴더의 파일마다 스위치 하나(default export = defineSwitch). 폴더를 읽어 목록을 만든다: 스위치를 더해도 다른 파일을 고치지 않는다.
// 시험은 임시 폴더를 더 얹어 파일 하나만 더한 레지스트리를 만든다.

export const BUILTIN_SWITCHES_DIR = join(dirname(fileURLToPath(import.meta.url)), "switches");

const isSwitchDecl = (x: unknown): x is SwitchDecl => {
  const d = x as Partial<SwitchDecl> | null;
  return Boolean(d && typeof d.key === "string" && typeof d.read === "function" && typeof d.save === "function" && d.block && typeof d.order === "number");
};

export interface SwitchRegistry {
  decls: readonly SwitchDecl[]; // 적용 순서
  views(): SwitchView[];
  has(key: string): boolean;
  // PUT 본문 → 선언된 스위치의 검사. 처음 틀린 하나의 `{키: 문구}`나 저장할 값 목록(적용 순서)
  validate(body: Record<string, unknown>): { errors: Record<string, string> } | { ok: SwitchPatch[] };
  // 저장하고 기록 줄 조각을 돌려준다
  apply(patches: readonly SwitchPatch[]): Promise<string[]>;
  rest(body: Record<string, unknown>): Record<string, unknown>; // 선언되지 않은 키
}
export interface SwitchPatch {
  decl: SwitchDecl;
  value: unknown;
}

export function makeSwitchRegistry(decls: readonly SwitchDecl[]): SwitchRegistry {
  const keys = new Set<string>();
  for (const d of decls) {
    if (keys.has(d.key)) throw new Error(`스위치 key가 겹침: ${d.key}`);
    keys.add(d.key);
  }
  const sorted = [...decls].sort((a, b) => applyOrderOf(a) - applyOrderOf(b) || a.key.localeCompare(b.key));
  return {
    decls: sorted,
    views: () => viewsOf(decls),
    has: (key) => keys.has(key),
    validate(body) {
      const ok: SwitchPatch[] = [];
      for (const d of sorted) {
        if (body[d.key] === undefined) continue;
        const r = checkValue(d, body[d.key]);
        if (!r.ok) return { errors: { [d.key]: r.error } };
        ok.push({ decl: d, value: r.value });
      }
      return { ok };
    },
    async apply(patches) {
      const parts: string[] = [];
      for (const { decl, value } of patches) {
        await decl.save(value as never);
        const line = decl.record?.(value as never);
        if (line) parts.push(line);
      }
      return parts;
    },
    rest: (body) => Object.fromEntries(Object.entries(body).filter(([k]) => !keys.has(k))),
  };
}

export async function createSwitchRegistry(extraDirs: readonly string[] = []): Promise<SwitchRegistry> {
  const all: SwitchDecl[] = [];
  for (const dir of [BUILTIN_SWITCHES_DIR, ...extraDirs]) all.push(...(await loadDeclarations(dir, isSwitchDecl, "스위치")));
  return makeSwitchRegistry(all);
}

// 서버가 쓰는 레지스트리(내장 폴더만)
export const switchRegistry: SwitchRegistry = await createSwitchRegistry();
