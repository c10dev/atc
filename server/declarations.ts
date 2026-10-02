import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// SWITCH·JOB REGISTRY(ATC-393)가 같이 쓴다: 폴더 안의 .ts 파일(시험 파일·.d.ts 제외)을 이름 순으로 읽어 default export를 모은다.
// default export가 선언이 아니면 어느 파일인지 적어 던진다
export async function loadDeclarations<T>(dir: string, isDecl: (x: unknown) => x is T, what: string): Promise<T[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts")).sort();
  const out: T[] = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(join(dir, f)).href)) as { default?: unknown };
    if (!isDecl(mod.default)) throw new Error(`${join(dir, f)}: default export가 ${what} 선언이 아님`);
    out.push(mod.default);
  }
  return out;
}
